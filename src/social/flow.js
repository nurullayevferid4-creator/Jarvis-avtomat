// Sosial paylaşım axını: təsdiq → iş (job) → platforma addımları.
//
// QAYDALAR (kodla təmin olunur, testlərlə yoxlanır):
//  1. Heç bir adapter təsdiq olmadan çağırılmır: startJob() qeydin status:"approved" olmasını və
//     payload_hash-in dəyişməməsini tələb edir. Adapter-ə yalnız advance() daxilində toxunulur.
//  2. Geri qaytarılmaz addım (Instagram media_publish, TikTok/YouTube/Telegram göndərmə) bir dəfədən çox
//     çağırılmır: addımdan əvvəl vəziyyət ("starting"/"committing") yazılır. Proses bu anda kəsilərsə
//     nəticə "unknown" olur və avtomatik təkrar EDİLMİR, Fərid platformada yoxlayır.
//  3. İş eyni id ilə (təsdiq qeydinin id-si) yaradılır: eyni təsdiq ikinci iş yarada bilməz.
//  4. Claude yalnız mətn hazırlayır (planner.js). Bu faylda model çağırışı yoxdur.

import { isValidId } from "../state/store.js";
import { normalizePublishRequest, summarizeRequest, readinessIssues } from "./request.js";
import { payloadHash } from "./canon.js";
import { SocialError, toSocialError } from "./errors.js";
import { PLATFORM_INFO } from "./platforms.js";

const JOB_TTL = 30 * 86400;
const LOCK_MS = 300000; // ən uzun platforma sorğusundan (YouTube yükləmə 240 san) uzun

// Eyni isolate daxilində eyni açar üçün çağırışları növbəyə düzür (KV-də atomik kilid yoxdur).
// DİQQƏT: bu yalnız bir Worker nüsxəsi daxilində qoruyur; nüsxələr arası tam zəmanət üçün Durable Object lazımdır.
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  const chain = prev.then(() => mine);
  locks.set(key, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chain) locks.delete(key);
  }
}
const TERMINAL = new Set(["done", "failed", "unknown"]);

export function checkDelay(platform, checks) {
  if (platform === "instagram") return checks < 3 ? 5000 : 60000;
  if (platform === "tiktok") return checks < 3 ? 5000 : 15000;
  return 5000;
}
const MAX_CHECKS = { instagram: 8, tiktok: 40, youtube: 3, telegram: 3 };

export function buildApproval(input, meta = {}) {
  const req = normalizePublishRequest(input, { strict: false });
  return { content: summarizeRequest(req), payload: { request: req, notify_chat: meta.notifyChat || null }, request: req };
}

export function createSocialFlow({ env, store, approvals, audit = null, hub, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  async function log(event, data) {
    if (audit) await audit.log(event, data);
  }

  async function idx() {
    const v = await store.getRaw("socialidx");
    return v && Array.isArray(v.ids) ? v.ids.filter(isValidId) : [];
  }
  async function idxAdd(id) {
    const ids = await idx();
    if (!ids.includes(id)) await store.putRaw("socialidx", { ids: [...ids, id].slice(-50) });
  }
  async function idxDel(id) {
    const ids = await idx();
    if (ids.includes(id)) await store.putRaw("socialidx", { ids: ids.filter((x) => x !== id) });
  }

  async function save(job) {
    job.updated_at = now();
    await store.putDoc("socialjob", job.id, job, JOB_TTL);
  }

  // Yeni təsdiq qeydi (qaralama). Heç nə paylaşılmır.
  async function createDraft(input, meta = {}) {
    const b = buildApproval(input, meta);
    if (b.request.issues.length) throw new SocialError("invalid_request", b.request.issues.join("; ").slice(0, 280));
    const rec = await approvals.create({
      action: "social.publish",
      content: b.content,
      risk: "high",
      source: meta.source || "api",
      kind: "social.publish",
      payload: b.payload,
    });
    return rec;
  }

  function jobStatus(job) {
    const ts = Object.values(job.targets);
    if (ts.some((t) => !TERMINAL.has(t.step))) return ts.every((t) => t.step === "new") ? "queued" : "running";
    const done = ts.filter((t) => t.step === "done").length;
    if (done === ts.length) return "done";
    if (ts.some((t) => t.step === "unknown")) return done ? "partial" : "unknown";
    return done ? "partial" : "failed";
  }

  // Təsdiqdən sonra iş yaradır. Şəbəkə çağırışı yoxdur.
  async function startJob(approvalId) {
    if (!isValidId(approvalId)) return { ok: false, error: "not_found" };
    const rec = await approvals.get(approvalId);
    if (!rec) return { ok: false, error: "not_found" };
    if (rec.kind !== "social.publish") return { ok: false, error: "not_social" };
    if (rec.status !== "approved") {
      await log("social.blocked", { approval_id: rec.id, reason: "not_approved", status: rec.status });
      return { ok: false, error: "not_approved" };
    }
    if ((await payloadHash(rec.payload)) !== rec.payload_hash) {
      await log("social.blocked", { approval_id: rec.id, reason: "payload_modified" });
      await approvals.setExecution(rec.id, "blocked");
      return { ok: false, error: "payload_modified" };
    }
    const existing = await store.getDoc("socialjob", rec.id);
    if (existing) return { ok: true, job: existing, existing: true };

    const t0 = now();
    const request = rec.payload.request;
    const job = { id: rec.id, approval_id: rec.id, created_at: t0, updated_at: t0, status: "queued", request, notify_chat: rec.payload.notify_chat || null, targets: {}, lock_until: 0 };
    const issues = readinessIssues(request);
    const strictErr = issues.length ? new SocialError("invalid_request", issues.join("; ").slice(0, 280)) : null;
    for (const p of request.platforms) {
      job.targets[p] = { step: strictErr ? "failed" : "new", data: {}, attempts: 0, checks: 0, next_at: 0, error: strictErr ? strictErr.toJSON() : null };
    }
    job.status = jobStatus(job);
    await save(job);
    await approvals.setExecution(rec.id, job.status === "failed" ? "failed" : "running", { job_id: job.id });
    await log("social.job_created", { job_id: job.id, platforms: request.platforms });
    if (!TERMINAL.has(job.status)) await idxAdd(job.id);
    return { ok: true, job };
  }

  function fail(t, e, { unknownIfRetriable = false } = {}) {
    const err = toSocialError(e);
    t.error = err.toJSON();
    t.step = unknownIfRetriable && (err.retriable || err.code === "timeout") ? "unknown" : "failed";
    if (t.step === "unknown") t.note = "Nəticə bilinmir: platformada əl ilə yoxlayın, avtomatik təkrar edilmir";
  }

  async function advanceTarget(job, p, deadline) {
    const t = job.targets[p];
    const adapter = hub.adapter(p);
    const req = job.request;
    while (!TERMINAL.has(t.step) && now() < deadline) {
      if (t.next_at && now() < t.next_at) {
        const wait = t.next_at - now();
        if (now() + wait >= deadline) return; // sonrakı çağırışa (cron/əl ilə)
        await sleep(wait);
        continue;
      }
      if (t.step === "starting" || t.step === "committing") {
        // əvvəlki icra yarımçıq kəsilib: təkrar etmirik
        t.step = "unknown";
        t.note = "İcra yarımçıq kəsilib: platformada əl ilə yoxlayın, avtomatik təkrar edilmir";
        await save(job);
        break;
      }
      try {
        if (t.step === "new") {
          t.attempts += 1;
          if (!adapter.safeToRestartStart) {
            t.step = "starting";
            await save(job);
          }
          const r = await adapter.start(req, t);
          t.step = r === "done" ? "done" : r === "ready" ? "ready" : "started";
          t.next_at = t.step === "started" ? now() + checkDelay(p, 0) : 0;
        } else if (t.step === "started") {
          t.checks += 1;
          const r = await adapter.check(req, t);
          if (r === "done") t.step = "done";
          else if (r === "ready") t.step = "ready";
          else if (t.checks >= (MAX_CHECKS[p] || 6)) {
            t.step = "unknown";
            t.note = "Platforma vaxtında cavab vermədi: yoxlayın";
          } else t.next_at = now() + checkDelay(p, t.checks);
        } else if (t.step === "ready") {
          t.step = "committing";
          await save(job);
          await adapter.commit(req, t);
          t.step = "done";
        }
      } catch (e) {
        const err = toSocialError(e, p);
        const wasStart = t.step === "new" || t.step === "starting";
        if (t.step === "started" && err.retriable && t.checks < (MAX_CHECKS[p] || 6)) {
          t.error = err.toJSON();
          t.next_at = now() + checkDelay(p, t.checks);
        } else if (t.step === "new" && adapter.safeToRestartStart && err.retriable && t.attempts < 3) {
          t.error = err.toJSON();
          t.next_at = now() + 30000;
        } else if (t.step === "committing" || (wasStart && !adapter.safeToRestartStart)) {
          fail(t, err, { unknownIfRetriable: true });
        } else {
          fail(t, err);
        }
        await log("social.target_error", { job_id: job.id, platform: p, code: err.code, step: t.step });
      }
      await save(job);
    }
  }

  async function finalize(job) {
    job.status = jobStatus(job);
    job.lock_until = 0;
    await save(job);
    if (TERMINAL.has(job.status) || job.status === "partial") {
      await idxDel(job.id);
      await approvals.setExecution(job.approval_id, job.status);
      await log("social.job_finished", { job_id: job.id, status: job.status });
      await notify(job);
    }
  }

  // Təsdiq + iş yaradılması bir addımda (UI, API və Telegram eyni funksiyanı çağırır).
  // Qaytarır: { ok, record?, job?, error? }. Təsdiq alınıb iş yaranmadan proses dayansa belə, qeyd
  // aktiv indeksə yazılır və cron (tick) işi yenidən yaratmağa çalışır.
  async function approveAndStart(id) {
    if (!isValidId(id)) return { ok: false, error: "not_found" };
    return await withLock("approve:" + id, async () => {
      const rec = await approvals.get(id);
      if (!rec) return { ok: false, error: "not_found" };
      if (rec.kind !== "social.publish") return { ok: false, error: "not_social" };
      const d = await approvals.decide(id, { decision: "approve" });
      if (!d.ok) return { ok: false, error: d.error, record: d.record };
      await idxAdd(id);
      const s = await startJob(id);
      return s.ok ? { ok: true, record: (await approvals.get(id)) || d.record, job: s.job } : { ok: false, error: s.error, record: d.record };
    });
  }

  // Bir işi irəlilədir. deadlineMs: bu çağırış üçün maksimum müddət.
  async function advance(jobId, opts = {}) {
    if (!isValidId(jobId)) return null;
    return await withLock("job:" + jobId, () => advanceLocked(jobId, opts));
  }

  async function advanceLocked(jobId, { deadlineMs = 25000 } = {}) {
    const job = await store.getDoc("socialjob", jobId);
    if (!job) return null;
    if (jobStatus(job) !== "queued" && jobStatus(job) !== "running") return job;
    if (job.lock_until && job.lock_until > now()) return job; // başqa çağırış işləyir
    job.lock_until = now() + LOCK_MS;
    await save(job);
    const deadline = now() + deadlineMs;
    try {
      for (const p of Object.keys(job.targets)) await advanceTarget(job, p, deadline);
    } finally {
      await finalize(job);
    }
    return job;
  }

  async function notify(job) {
    if (!job.notify_chat) return;
    try {
      const tg = hub.adapter("telegram");
      if (!tg.configured()) return;
      await tg.sendMessage(job.notify_chat, formatResult(job));
    } catch (e) {
      /* bildiriş uğursuz olsa da iş nəticəsi dəyişmir */
    }
  }

  async function tick({ deadlineMs = 25000 } = {}) {
    const ids = await idx();
    const out = [];
    for (const id of ids) {
      let j = await advance(id, { deadlineMs });
      if (!j) {
        // təsdiq alınıb, amma iş yaranmayıb (proses dayanıb): təsdiq və hash yenidən yoxlanılır
        const s = await startJob(id);
        j = s.ok ? await advance(id, { deadlineMs }) : null;
      }
      if (j) out.push({ id: j.id, status: j.status });
      else await idxDel(id);
    }
    try {
      await hub.adapter("instagram").maybeRefresh();
    } catch (e) {
      /* token yeniləmə xətası status panelində görünəcək */
    }
    return out;
  }

  async function panel({ verify = false } = {}) {
    const platforms = await hub.statusAll({ verify });
    const pending = (await approvals.list({ status: "pending", limit: 30 })).filter((a) => a.kind === "social.publish");
    const byPlatform = {};
    for (const a of pending) for (const p of (a.payload && a.payload.request && a.payload.request.platforms) || []) byPlatform[p] = (byPlatform[p] || 0) + 1;
    for (const [p, s] of Object.entries(platforms)) s.pending_approvals = byPlatform[p] || 0;
    return {
      platforms,
      pending: pending.map((a) => ({ id: a.id, ts: a.ts, platforms: a.payload.request.platforms, summary: a.content })),
      media_store: hub.media.available,
      media_signing: hub.media.signingConfigured,
    };
  }

  async function getJob(id) {
    return isValidId(id) ? await store.getDoc("socialjob", id) : null;
  }
  async function listJobs(limit = 15) {
    return await store.listDocs("socialjob", limit);
  }

  return { createDraft, startJob, approveAndStart, advance, tick, panel, getJob, listJobs, jobStatus, notify };
}

export function formatResult(job) {
  const lines = ["Paylaşım nəticəsi:"];
  for (const [p, t] of Object.entries(job.targets)) {
    const label = PLATFORM_INFO[p].label;
    if (t.step === "done") lines.push("✅ " + label + ": paylaşıldı" + (t.post_id ? " (id: " + t.post_id + ")" : "") + (t.post_url ? "\n   " + t.post_url : "") + (t.note ? "\n   Qeyd: " + t.note : ""));
    else if (t.step === "unknown") lines.push("⚠️ " + label + ": nəticə bilinmir. " + (t.note || "Platformada yoxlayın."));
    else lines.push("❌ " + label + ": alınmadı" + (t.error ? " (" + t.error.code + "): " + t.error.message : ""));
  }
  return lines.join("\n").slice(0, 3900);
}
