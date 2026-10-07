// 24/7 avtonom rejim: job reyestri + təkrarlanan/bir dəfəlik cədvəl + retry/backoff + uğursuzluq xəbərdarlığı + tarixçə.
// Cron (wrangler.toml, 5 dəq) scheduled() içindən tick() çağırır. Job-lar YALNIZ qaralama/araşdırma edir:
// paylaşım, mesaj göndərmə, maliyyə və s. burada YOXDUR (onlar yalnız təsdiq mərkəzi ilə).
import { nextAfterRun, validSchedule } from "./schedule.js";

export const MAX_ATTEMPTS = 3;
export const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5, 10 dəq; sonra dayanır
const HIST_MAX = 40;
const JOB_TIMEOUT_MS = 20000;

export const DEFAULT_SCHEDULES = {
  "qr_menu.market_research": { kind: "daily", at: "09:00" },
  "qr_menu.lead_research": { kind: "daily", at: "10:00" },
};

const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

export async function loadState(store) {
  return (await store.getRaw("autostate")) || { jobs: {} };
}
export async function loadHistory(store) {
  return (await store.getRaw("autohist")) || [];
}

// Env: AUTONOMY_JOBS="qr_menu.market_research,qr_menu.lead_research" (standart: heç biri, yəni söndürülüb)
export function enabledTypes(env, handlers) {
  return String((env && env.AUTONOMY_JOBS) || "").split(",").map((x) => x.trim()).filter((x) => handlers[x] && DEFAULT_SCHEDULES[x]);
}

export async function tick({ store, env, handlers, notify = null, now = Date.now(), timeoutMs = JOB_TIMEOUT_MS }) {
  const state = await loadState(store);
  let hist = null;
  const ran = [];
  for (const type of enabledTypes(env, handlers)) {
    if (!state.jobs[type]) {
      const schedule = DEFAULT_SCHEDULES[type];
      state.jobs[type] = { id: type, type, schedule, enabled: true, attempts: 0, next_run_at: nextAfterRun(schedule, now - 1) };
    }
  }
  for (const job of Object.values(state.jobs)) {
    if (!job.enabled || !handlers[job.type] || !validSchedule(job.schedule) || !(job.next_run_at <= now)) continue;
    const slot = "autolock:" + job.id + ":" + job.next_run_at;
    if (await store.getRaw(slot)) continue; // eyni slot iki dəfə icra olunmur
    await store.putRaw(slot, { t: now }, 86400);
    let res;
    let err = null;
    let timer;
    try {
      res = await Promise.race([handlers[job.type](job), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("job vaxt limiti")), timeoutMs); })]);
    } catch (e) {
      err = clip((e && e.message) || e, 200);
    } finally { clearTimeout(timer); }
    hist = hist || (await loadHistory(store));
    if (!err) {
      job.attempts = 0;
      job.last_status = res && res.status === "pending" ? "pending" : "ok";
      job.last_error = undefined;
      hist.unshift({ ts: now, job: job.id, status: job.last_status, summary: clip(res && res.summary, 600) });
      advance(job, now);
    } else {
      job.attempts = (job.attempts || 0) + 1;
      job.last_error = err;
      if (job.attempts >= MAX_ATTEMPTS) {
        job.last_status = "failed";
        hist.unshift({ ts: now, job: job.id, status: "failed", summary: "Son cəhd uğursuz: " + err, attempts: job.attempts });
        advance(job, now);
        job.attempts = 0;
        if (notify) { try { await notify("⚠️ JARVIS avtonom iş uğursuz oldu: " + job.id + " (" + MAX_ATTEMPTS + " cəhddən sonra). Səbəb: " + err); } catch (e) { /* xəbərdarlıq getməsə də cron davam edir */ } }
      } else {
        job.last_status = "retry";
        hist.unshift({ ts: now, job: job.id, status: "retry", summary: err, attempts: job.attempts });
        job.next_run_at = now + BACKOFF_BASE_MS * 2 ** (job.attempts - 1);
      }
    }
    job.last_run_at = now;
    ran.push({ job: job.id, status: job.last_status });
  }
  if (hist) await store.putRaw("autohist", hist.slice(0, HIST_MAX));
  await store.putRaw("autostate", state);
  return { ran };
}

function advance(job, now) {
  const n = nextAfterRun(job.schedule, now);
  if (n === null) { job.enabled = false; job.next_run_at = null; } else job.next_run_at = n;
}

// Gündəlik hesabat üçün qısa sətirlər
export async function autonomyLines(store) {
  const state = await loadState(store);
  const hist = await loadHistory(store);
  const since = Date.now() - 24 * 3600 * 1000;
  return Object.values(state.jobs).filter((j) => j.enabled).map((j) => {
    const h = hist.find((x) => x.job === j.id && x.ts >= since);
    return "• " + j.id + ": " + (h ? h.status + (h.summary ? " — " + clip(h.summary, 120).replace(/\s+/g, " ") : "") : "son 24 saatda icra olunmayıb");
  });
}
