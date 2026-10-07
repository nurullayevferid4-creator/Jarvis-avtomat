// Koordinator: bir neçə Worker nüsxəsi arasında ATOMİK kilid və "bir dəfə" markeri.
//
// Niyə lazımdır: Cloudflare KV-də atomik "yoxla-və-yaz" yoxdur, iki nüsxə eyni anda eyni təsdiqi
// icra edə bilərdi. Durable Object bir açar üçün sorğuları ardıcıl icra edir, buna görə burada
// get+put arasında başqa sorğu girə bilmir.
//
// İki implementasiya eyni məntiqi (applyOp) işlədir:
//   - JarvisCoordinator: Durable Object (production, env.COORD bağlanıbsa)
//   - MemoryCoordinator: tək proses daxilində (lokal test və DO bağlanmayıbsa; nüsxələr arası qorumur)
// DO əlçatmaz olarsa sistem "bağlı" davranır: icra ETMİR (fail closed), saxta uğur vermir.

import { AppError } from "../errors.js";

const KEY_RE = /^[a-z][a-z0-9_.:-]{1,120}$/i;

function checkKey(key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) throw new AppError("VALIDATION_ERROR", "koordinator açarı düzgün deyil");
}

// storage: { get(key), put(key, value), delete(key) } (asinxron). Bu funksiyada storage-dan başqa await YOXDUR.
export async function applyOp(storage, op, now) {
  checkKey(op.key);
  const rec = await storage.get(op.key);
  const live = rec && (!rec.until || rec.until > now);
  switch (op.op) {
    case "lock": {
      const owner = String(op.owner || "");
      if (!owner) throw new AppError("VALIDATION_ERROR", "owner lazımdır");
      const ttl = Math.min(Math.max(Number(op.ttlMs) || 30000, 1000), 600000);
      if (live && rec.owner !== owner) return { ok: false, holder_until: rec.until };
      await storage.put(op.key, { owner, until: now + ttl, kind: "lock" });
      return { ok: true, until: now + ttl };
    }
    case "unlock": {
      if (live && rec.kind === "lock" && rec.owner === String(op.owner || "")) await storage.delete(op.key);
      return { ok: true };
    }
    case "once": {
      // İlk çağıran qalib gəlir. ttlMs verilməsə marker daimidir (təsdiq icrası üçün).
      if (live) return { ok: true, first: false, at: rec.at };
      const until = op.ttlMs ? now + Math.max(1000, Number(op.ttlMs)) : 0;
      await storage.put(op.key, { kind: "once", at: now, until, meta: op.meta ? String(op.meta).slice(0, 200) : undefined });
      return { ok: true, first: true, at: now };
    }
    case "peek":
      return { ok: true, exists: !!live, record: live ? rec : null };
    case "forget": {
      await storage.delete(op.key);
      return { ok: true };
    }
    default:
      throw new AppError("VALIDATION_ERROR", "naməlum koordinator əməliyyatı");
  }
}

// ---- Durable Object (wrangler.toml-da COORD kimi bağlanır) ----
export class JarvisCoordinator {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== "POST") return new Response("method", { status: 405 });
    let op;
    try {
      op = await request.json();
    } catch (e) {
      return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
    }
    try {
      const res = await applyOp(this.state.storage, op, Date.now());
      return Response.json(res);
    } catch (e) {
      const code = e instanceof AppError ? e.code : "INTERNAL_ERROR";
      return Response.json({ ok: false, error: code }, { status: e instanceof AppError ? e.httpStatus : 500 });
    }
  }
}

// ---- Müştərilər ----
class Base {
  // Kilidi almağa çalışır (gözləmədən). Alınmasa false.
  async tryLock(key, owner, ttlMs = 30000) {
    const r = await this.call({ op: "lock", key, owner, ttlMs });
    return r.ok === true;
  }
  async unlock(key, owner) {
    await this.call({ op: "unlock", key, owner });
  }
  // true yalnız bu açar üçün İLK çağıran üçün. Başqaları false alır.
  async once(key, { ttlMs = 0, meta } = {}) {
    const r = await this.call({ op: "once", key, ttlMs, meta });
    return r.first === true;
  }
  async peek(key) {
    return await this.call({ op: "peek", key });
  }
  async forget(key) {
    await this.call({ op: "forget", key });
  }

  // fn-i kilid altında icra edir. Kilid waitMs ərzində alınmasa CONFLICT atır.
  async withLock(key, fn, { ttlMs = 30000, waitMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const owner = crypto.randomUUID();
    const t0 = Date.now();
    for (;;) {
      if (await this.tryLock(key, owner, ttlMs)) break;
      if (Date.now() - t0 >= waitMs) throw new AppError("CONFLICT", "Əməliyyat başqa çağırış tərəfindən icra olunur", { retryable: true });
      await sleep(Math.min(100, Math.max(10, waitMs / 20)));
    }
    try {
      return await fn();
    } finally {
      try {
        await this.unlock(key, owner);
      } catch (e) {
        /* kilid ttl ilə özü açılacaq */
      }
    }
  }
}

export class MemoryCoordinator extends Base {
  constructor(now = () => Date.now()) {
    super();
    this.kind = "memory";
    this.map = new Map();
    this.now = now;
    // Eyni proses daxilində əməliyyatlar ardıcıl getsin (DO davranışı ilə eyni).
    this.chain = Promise.resolve();
  }
  call(op) {
    const run = this.chain.then(() => applyOp(this.storage(), op, this.now()));
    this.chain = run.catch(() => {});
    return run;
  }
  storage() {
    return {
      get: async (k) => this.map.get(k),
      put: async (k, v) => { this.map.set(k, v); },
      delete: async (k) => { this.map.delete(k); },
    };
  }
}

export class DoCoordinator extends Base {
  constructor(ns, name = "global") {
    super();
    this.kind = "durable_object";
    this.stub = ns.get(ns.idFromName(name));
  }
  async call(op) {
    let res;
    try {
      res = await this.stub.fetch("https://coord.internal/op", { method: "POST", body: JSON.stringify(op), headers: { "content-type": "application/json" } });
    } catch (e) {
      throw new AppError("NETWORK_ERROR", "Koordinator əlçatmazdır, əməliyyat icra edilmədi", { retryable: true, detail: String(e && e.message) });
    }
    let j = null;
    try {
      j = await res.json();
    } catch (e) { /* aşağıda */ }
    if (!res.ok || !j || j.ok === false && j.error) throw new AppError("INTERNAL_ERROR", "Koordinator xətası", { detail: j && j.error });
    return j;
  }
}

let sharedMemory = null;
// env.COORD (Durable Object bağlaması) varsa DO, yoxsa proses-daxili yaddaş.
export function createCoordinator(env) {
  if (env && env.COORD && typeof env.COORD.idFromName === "function") return new DoCoordinator(env.COORD);
  if (!sharedMemory) sharedMemory = new MemoryCoordinator();
  return sharedMemory;
}
export function resetSharedCoordinatorForTests() {
  sharedMemory = null;
}
