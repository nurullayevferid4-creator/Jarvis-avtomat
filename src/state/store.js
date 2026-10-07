// Söhbət yaddaşı, iş tarixçəsi və ümumi sənəd anbarı.
// KV (JARVIS_KV) varsa orada, yoxdursa yaddaşda saxlanılır (Worker yenidən başlayanda silinir).
// KV açar adları ("state", "job:...") köhnə versiya ilə eynidir ki, mövcud məlumat itməsin.
// Yeni sənədlər "<növ>:<id>" açarı ilə saxlanılır (approval, audit, knowledge).

const mem = { state: null, jobs: [], docs: {}, raw: new Map() };

// Yalnız bu növlərə icazə var. Açar adı kənardan gələn mətnlə düzəldilmir.
export const DOC_KINDS = new Set(["approval", "audit", "knowledge", "socialjob", "lead", "event", "mediajob"]);

// "Xam" açarlar: siyahıya düşməyən, adı əvvəlcədən məlum olan qeydlər (sosial token, OAuth state,
// Telegram update təkrarı, aktiv iş indeksi). Açar adı yalnız bu naxışlara uyğun ola bilər:
// kənardan gələn mətnlə açar düzəldilmir.
const RAW_KEY_RE = /^(secret:(instagram|tiktok|youtube|telegram|shopify)|oauthstate:[0-9a-f]{32}|tgupdate:\d{1,15}|socialidx|shwebhook:[A-Za-z0-9-]{8,64}|mediaidx|mediameta:[0-9a-f]{24}|mediajobidx|leadidx|eventidx|dailyreport:\d{4}-\d{2}-\d{2}|autostate|autohist|autolock:[a-z0-9_.]{3,40}:\d{10,14}|conv:(ui|telegram:-?\d{1,15}))$/;
const ID_RE = /^\d{13}-[0-9a-f]{6}$/;
const MEM_DOC_LIMIT = 500;
const LIST_MAX = 40; // KV oxumaları Cloudflare-də alt sorğu sayılır (pulsuz planda 50 limit)

// KV eyni açara təxminən saniyədə 1 yazı icazə verir; artığına 429 qaytarır. Qısa gecikmə ilə 3 cəhd edilir.
// Başqa xətalar (və ya cəhdlər bitəndə 429) olduğu kimi atılır: yazıldı kimi göstərilmir.
let kvSleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function _setKvSleepForTests(fn) { kvSleep = fn || ((ms) => new Promise((r) => setTimeout(r, ms))); }
async function kvPut(kv, key, value, opts) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await kv.put(key, value, opts);
    } catch (e) {
      const rate = /429|too many requests|rate limit/i.test(String((e && e.message) || e));
      if (!rate || attempt >= 2) throw e;
      await kvSleep(1100 * (attempt + 1));
    }
  }
}

export function isValidId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

// Yeni sənəd identifikatoru. Ən yeni sənəd KV siyahısında ən əvvəl gəlir.
export function makeId(now = Date.now()) {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return String(9999999999999 - now).padStart(13, "0") + "-" + rand;
}

function needRaw(key) {
  if (typeof key !== "string" || !RAW_KEY_RE.test(key)) throw new Error("xam açar adı düzgün deyil");
}

function need(kind, id) {
  if (!DOC_KINDS.has(kind)) throw new Error("naməlum sənəd növü");
  if (id !== undefined && !isValidId(id)) throw new Error("sənəd id-si düzgün deyil");
}

export function createStore(env) {
  return {
    async load() {
      if (env.JARVIS_KV) {
        const s = await env.JARVIS_KV.get("state", "json");
        return s || { history: [], pending: null };
      }
      if (!mem.state) mem.state = { history: [], pending: null };
      return mem.state;
    },

    async save(s) {
      if (env.JARVIS_KV) await kvPut(env.JARVIS_KV, "state", JSON.stringify(s));
      else mem.state = s;
    },

    async saveJob(job) {
      if (env.JARVIS_KV) {
        const key = "job:" + String(9999999999999 - Date.now());
        await kvPut(env.JARVIS_KV, key, JSON.stringify(job), { expirationTtl: 60 * 60 * 24 * 30 });
      } else {
        mem.jobs.unshift(job);
        mem.jobs = mem.jobs.slice(0, 20);
      }
    },

    async listJobs() {
      if (!env.JARVIS_KV) return mem.jobs;
      const l = await env.JARVIS_KV.list({ prefix: "job:", limit: 20 });
      const out = [];
      for (const k of l.keys) {
        const j = await env.JARVIS_KV.get(k.name, "json");
        if (j) out.push(j);
      }
      return out;
    },

    // Ümumi sənədlər
    async putDoc(kind, id, doc, ttlSeconds) {
      need(kind, id);
      if (env.JARVIS_KV) {
        const opts = ttlSeconds ? { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) } : undefined;
        await kvPut(env.JARVIS_KV, kind + ":" + id, JSON.stringify(doc), opts);
        return;
      }
      if (!mem.docs[kind]) mem.docs[kind] = new Map();
      const m = mem.docs[kind];
      m.set(id, doc);
      if (m.size > MEM_DOC_LIMIT) {
        const oldest = [...m.keys()].sort().pop(); // ən böyük id = ən köhnə sənəd
        m.delete(oldest);
      }
    },

    async getDoc(kind, id) {
      need(kind, id);
      if (env.JARVIS_KV) return await env.JARVIS_KV.get(kind + ":" + id, "json");
      const m = mem.docs[kind];
      return (m && m.get(id)) || null;
    },

    // Xam qeydlər (token, OAuth state və s.). Siyahılanmır, yalnız adı ilə oxunur.
    async getRaw(key) {
      needRaw(key);
      if (env.JARVIS_KV) return await env.JARVIS_KV.get(key, "json");
      const e = mem.raw.get(key);
      if (!e) return null;
      if (e.exp && Date.now() >= e.exp) {
        mem.raw.delete(key);
        return null;
      }
      return e.value;
    },

    async putRaw(key, value, ttlSeconds) {
      needRaw(key);
      if (env.JARVIS_KV) {
        const opts = ttlSeconds ? { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) } : undefined;
        await kvPut(env.JARVIS_KV, key, JSON.stringify(value), opts);
        return;
      }
      mem.raw.set(key, { value, exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
    },

    async deleteRaw(key) {
      needRaw(key);
      if (env.JARVIS_KV) await env.JARVIS_KV.delete(key);
      else mem.raw.delete(key);
    },

    // Ən yenidən köhnəyə doğru
    async listDocs(kind, limit = 30) {
      need(kind);
      const n = Math.min(LIST_MAX, Math.max(1, limit | 0));
      if (!env.JARVIS_KV) {
        const m = mem.docs[kind];
        if (!m) return [];
        return [...m.keys()].sort().slice(0, n).map((k) => m.get(k));
      }
      const l = await env.JARVIS_KV.list({ prefix: kind + ":", limit: n });
      const out = [];
      for (const k of l.keys) {
        const d = await env.JARVIS_KV.get(k.name, "json");
        if (d) out.push(d);
      }
      return out;
    },
  };
}

export function _resetMemoryForTests() {
  mem.state = null;
  mem.jobs = [];
  mem.docs = {};
  mem.raw = new Map();
}
