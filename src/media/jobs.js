// Video iş axını (job modeli):
//   UPLOAD → VALIDATE → ANALYZE → PLAN EDIT → PROCESS → VERIFY OUTPUT → STORE → RETURN RESULT
//
// İş statusu: QUEUED → RUNNING → SUCCESS | FAILED (FAILED retriable isə retry() ilə QUEUED-ə qayıdır).
// Sahələr: id, type, status, created_at, started_at, finished_at, attempts, error, result.
//
// QAYDALAR:
//  - "Video hazırdır" YALNIZ nəticə fayl yenidən analiz edilib hədəfə uyğun çıxdıqdan sonra (SUCCESS + verified:true).
//  - Emal lazımdırsa və xarici emal xidməti qoşulmayıbsa iş FAILED olur, redaktə planı nəticədə qalır; saxta uğur yoxdur.
//  - Redaktə lazım deyilsə emal addımı "skipped" olur, nəticə orijinal fayldır (processed:false).
//  - Eyni iş eyni anda iki yerdə irəliləmir (koordinator kilidi). Emal xidmətinə təkrar göndərmə yalnız hesablamadır, dərc deyil.

import { AppError, toAppError } from "../errors.js";
import { makeId, isValidId } from "../state/store.js";
import { platformFit, editPlan, verifyAgainstTarget } from "./rules.js";
import { analyzeMp4 } from "./mp4.js";
import { MAX_VIDEO_BYTES } from "./rules.js";

const STAGES = ["validate", "analyze", "plan", "process", "verify", "store"];
const JOB_TTL = 30 * 86400;
const MAX_ATTEMPTS = 3;
const POLL_MS = 5000;
const MAX_WAIT_MS = 20 * 60 * 1000; // emal xidməti bu müddətdə bitirməsə iş FAILED(TIMEOUT)

export function createMediaJobs({ store, coord, library, media, processor, audit = null, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const log = async (e, d) => { if (audit) await audit.log(e, d); };

  async function idx() {
    const v = await store.getRaw("mediajobidx");
    return v && Array.isArray(v.ids) ? v.ids.filter(isValidId) : [];
  }
  async function idxSet(ids) {
    await store.putRaw("mediajobidx", { ids: ids.slice(-50) });
  }
  const save = async (job) => { job.updated_at = now(); await store.putDoc("mediajob", job.id, job, JOB_TTL); };

  async function submitVideoJob({ media_id, platform = "instagram", goal = "" }) {
    const m = await library.get(media_id);
    if (!m) throw new AppError("NOT_FOUND", "Belə media tapılmadı");
    if (m.kind !== "video") throw new AppError("VALIDATION_ERROR", "Bu media video deyil");
    if (!["instagram", "tiktok", "youtube", "telegram"].includes(platform)) throw new AppError("VALIDATION_ERROR", "platforma: instagram, tiktok, youtube və ya telegram");
    const t = now();
    const job = {
      id: makeId(t),
      type: "video.prepare",
      status: "QUEUED",
      created_at: t,
      started_at: null,
      finished_at: null,
      attempts: 0,
      error: null,
      result: null,
      input: { media_id, platform, goal: String(goal || "").slice(0, 300) },
      stages: Object.fromEntries(STAGES.map((s) => [s, { status: "pending" }])),
      state: {},
    };
    await save(job);
    await idxSet([...(await idx()), job.id]);
    await log("media.job_created", { id: job.id, platform });
    return job;
  }

  const stage = (job, name, status, info) => { job.stages[name] = { status, at: now(), ...(info ? { info } : {}) }; };

  function fail(job, e) {
    const err = toAppError(e, "media");
    job.status = "FAILED";
    job.error = { ...err.toPublic(), stage: STAGES.find((s) => job.stages[s].status === "running") || null };
    job.finished_at = now();
    for (const s of STAGES) if (job.stages[s].status === "running") job.stages[s] = { status: "failed", at: now() };
  }

  async function run(job, deadline) {
    const input = job.input;
    const m = await library.get(input.media_id);
    if (!m) throw new AppError("NOT_FOUND", "Giriş videosu tapılmadı (silinib?)", { retryable: false });
    if (!job.stages.validate.status || job.stages.validate.status === "pending") {
      job.stages.validate = { status: "running" };
      if (!m || m.kind !== "video") throw new AppError("NOT_FOUND", "Giriş videosu tapılmadı");
      const size = await media.size(m.id);
      if (!size || size !== m.size) throw new AppError("VALIDATION_ERROR", "Giriş faylı anbarda yoxdur və ya dəyişib");
      if (size > MAX_VIDEO_BYTES) throw new AppError("VALIDATION_ERROR", "Video 64 MB-dan böyükdür");
      stage(job, "validate", "done");
      await save(job);
    }
    if (job.stages.analyze.status === "pending") {
      job.stages.analyze = { status: "running" };
      // Metadata yükləmə zamanı çıxarılıb, amma real fayldan yenidən oxunur (sənəd ilə fayl uyğun olmalıdır)
      const a = await analyzeMp4(library.reader(m.id, m.size));
      job.state.analysis = a;
      stage(job, "analyze", "done", { duration_s: a.duration_s, size: a.width + "x" + a.height, codec: a.video.codec });
      await save(job);
    }
    if (job.stages.plan.status === "pending") {
      job.stages.plan = { status: "running" };
      const fit = platformFit(job.state.analysis, input.platform, { size: m.size });
      if (!fit.ok) throw new AppError("VALIDATION_ERROR", "Video platformaya uyğun deyil: " + fit.blockers.join("; "), { retryable: false });
      job.state.fit = { warnings: fit.warnings, ops: fit.ops };
      job.state.plan = editPlan(fit, job.state.analysis);
      stage(job, "plan", "done", { needs_processing: job.state.plan.needs_processing, summary: job.state.plan.summary });
      await save(job);
    }
    const plan = job.state.plan;
    if (job.stages.process.status === "pending" || job.stages.process.status === "running") {
      if (!plan.needs_processing) {
        stage(job, "process", "skipped", { reason: "redaktə lazım deyil" });
        stage(job, "verify", "skipped");
        stage(job, "store", "skipped");
        job.status = "SUCCESS";
        job.finished_at = now();
        job.result = { media_id: m.id, processed: false, verified: true, analysis: job.state.analysis, warnings: job.state.fit.warnings, note: "Video redaktə tələb etmədi, orijinal fayl istifadə olunacaq. Dərc üçün ayrıca təsdiq lazımdır." };
        await save(job);
        return;
      }
      job.stages.process = { status: "running", at: now() };
      if (!processor || !processor.configured) {
        // Plan hazırdır, amma emal etmək mümkün deyil: dürüst nəticə
        job.result = { processed: false, verified: false, partial: { plan: plan.summary, ops: plan.ops, warnings: job.state.fit.warnings, analysis: job.state.analysis } };
        throw new AppError("AUTH_ERROR", "Video emal xidməti qoşulmayıb: plan hazırdır, amma video redaktə OLUNMADI (VIDEO_PROCESSOR_URL/VIDEO_PROCESSOR_TOKEN)", { retryable: false });
      }
      job.stages.process = { status: "running", at: job.stages.process.at || now() };
      if (!job.state.ext_id) {
        const inputUrl = await media.signedUrl(m.id, m.ext, 3600);
        const r = await processor.submit({ input_url: inputUrl, ops: plan.ops });
        job.state.ext_id = r.id;
        job.state.submitted_at = now();
        await save(job);
      }
      for (;;) {
        const st = await processor.status(job.state.ext_id);
        if (st.status === "failed") throw new AppError("PROVIDER_ERROR", "Video emal alınmadı: " + (st.error || "naməlum səbəb"), { retryable: true, source: "video_processor" });
        if (st.status === "done") break;
        if (now() - job.state.submitted_at > MAX_WAIT_MS) throw new AppError("TIMEOUT", "Video emalı çox çəkdi", { retryable: true, source: "video_processor" });
        if (now() + POLL_MS >= deadline) { await save(job); return; } // növbəti çağırışda (cron/UI) davam
        await sleep(POLL_MS);
      }
      stage(job, "process", "done", { ext_id: job.state.ext_id });
      await save(job);
    }
    if (job.stages.verify.status === "pending") {
      job.stages.verify = { status: "running" };
      const out = await processor.output(job.state.ext_id, { maxBytes: MAX_VIDEO_BYTES });
      let derived;
      try {
        derived = await library.ingest({ body: out.body, contentType: "video/mp4", length: out.length, filename: "processed.mp4", source: "derived", derivedFrom: m.id });
      } catch (e) {
        throw new AppError("VALIDATION_ERROR", "Emal nəticəsi yoxlanışdan keçmədi: " + toAppError(e).message, { retryable: true, source: "video_processor" });
      }
      const v = verifyAgainstTarget(derived.analysis, plan.target);
      if (!v.ok) {
        await library.remove(derived.id);
        throw new AppError("VALIDATION_ERROR", "Emal nəticəsi hədəfə uyğun deyil: " + v.problems.join("; "), { retryable: true, source: "video_processor" });
      }
      job.state.derived_id = derived.id;
      stage(job, "verify", "done", { ok: true });
      stage(job, "store", "done", { media_id: derived.id });
      job.status = "SUCCESS";
      job.finished_at = now();
      job.result = { media_id: derived.id, processed: true, verified: true, ops: plan.ops, analysis: derived.analysis, warnings: job.state.fit.warnings, original_media_id: m.id, note: "Nəticə yenidən analiz edilib. Dərc üçün ayrıca təsdiq lazımdır." };
      await save(job);
    }
  }

  async function advance(id, { deadlineMs = 20000 } = {}) {
    if (!isValidId(id)) return null;
    try {
      return await coord.withLock("mediajob:" + id, async () => {
        const job = await store.getDoc("mediajob", id);
        if (!job) return null;
        if (job.status === "SUCCESS" || job.status === "FAILED") return job;
        if (job.status === "QUEUED") {
          job.status = "RUNNING";
          job.started_at = job.started_at || now();
          job.attempts += 1;
          await save(job);
        }
        try {
          await run(job, now() + deadlineMs);
        } catch (e) {
          fail(job, e);
          await log("media.job_failed", { id: job.id, code: job.error.code, stage: job.error.stage });
          await save(job);
        }
        if (job.status === "SUCCESS") await log("media.job_done", { id: job.id, processed: job.result.processed });
        return job;
      }, { ttlMs: 60000, waitMs: 0 });
    } catch (e) {
      if (e && e.code === "CONFLICT") return await store.getDoc("mediajob", id); // başqa çağırış işləyir
      throw e;
    }
  }

  // Yalnız retriable xətalı FAILED iş yenidən növbəyə qoyulur (maksimum 3 cəhd). Uğursuz mərhələdən davam edir.
  async function retry(id) {
    const job = await store.getDoc("mediajob", id);
    if (!job) throw new AppError("NOT_FOUND", "İş tapılmadı");
    if (job.status !== "FAILED") throw new AppError("CONFLICT", "Yalnız uğursuz iş təkrarlana bilər");
    if (!job.error || !job.error.retryable) throw new AppError("VALIDATION_ERROR", "Bu xəta təkrarla düzəlmir");
    if (job.attempts >= MAX_ATTEMPTS) throw new AppError("VALIDATION_ERROR", "Maksimum cəhd sayı doldu");
    for (const s of STAGES) if (job.stages[s].status === "failed" || job.stages[s].status === "running") job.stages[s] = { status: "pending" };
    if (job.stages.process.status === "pending") delete job.state.ext_id; // yeni emal göndəriləcək
    job.status = "QUEUED";
    job.error = null;
    job.finished_at = null;
    await save(job);
    await idxSet([...new Set([...(await idx()), id])]);
    return job;
  }

  async function tick({ deadlineMs = 20000 } = {}) {
    const ids = await idx();
    const keep = [];
    const out = [];
    for (const id of ids) {
      const j = await advance(id, { deadlineMs });
      if (j && (j.status === "QUEUED" || j.status === "RUNNING")) keep.push(id);
      if (j) out.push({ id, status: j.status });
    }
    await idxSet(keep);
    try { await library.cleanupDerived(); } catch (e) { /* təmizlik xətası işi dayandırmır */ }
    return out;
  }

  return { submitVideoJob, advance, retry, tick, get: (id) => (isValidId(id) ? store.getDoc("mediajob", id) : null), list: (limit = 15) => store.listDocs("mediajob", limit) };
}

export const publicJob = (j) => (j ? { id: j.id, type: j.type, status: j.status, created_at: j.created_at, started_at: j.started_at, finished_at: j.finished_at, attempts: j.attempts, error: j.error, result: j.result, input: j.input, stages: j.stages, plan: j.state && j.state.plan ? { needs_processing: j.state.plan.needs_processing, summary: j.state.plan.summary } : null } : null);
