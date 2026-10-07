// Xarici video emal xidməti ilə müqavilə (Cloudflare Worker-də ffmpeg işləmir).
// Xidmət ayrıca sahibin serverində işləyir (bax scripts/video-processor/). Worker ona YALNIZ imzalı müvəqqəti
// giriş ünvanı verir; xidmət nəticəni yükləmə üçün saxlayır, Worker onu götürüb yenidən analiz edir.
//
// Protokol (hamısı Authorization: Bearer <VIDEO_PROCESSOR_TOKEN>):
//   POST {URL}/jobs            {input_url, ops:[...]}        -> 202 {id}
//   GET  {URL}/jobs/{id}                                     -> 200 {status:"queued|running|done|failed", error?}
//   GET  {URL}/jobs/{id}/output                              -> 200 video/mp4 bayt axını (Content-Length məcburi)

import { AppError } from "../errors.js";
import { assertSafeUrl } from "../security/ssrf.js";

const ALLOWED_OPS = new Set(["trim", "reframe", "transcode", "transcode_audio", "remux", "faststart"]);

// allowInsecure: YALNIZ testlər üçün (lokal http ünvan). İstehsalda həmişə təhlükəsiz https tələb olunur.
export function createVideoProcessor(env, { fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 20000, allowInsecure = false } = {}) {
  const base = String(env.VIDEO_PROCESSOR_URL || "").replace(/\/+$/, "");
  const token = env.VIDEO_PROCESSOR_TOKEN || "";
  const configured = Boolean(base && token);

  function need() {
    if (!configured) throw new AppError("AUTH_ERROR", "Video emal xidməti qoşulmayıb (VIDEO_PROCESSOR_URL və VIDEO_PROCESSOR_TOKEN)", { source: "video_processor", retryable: false });
    try {
      if (!allowInsecure) assertSafeUrl(base);
    } catch (e) {
      throw new AppError("SECURITY_ERROR", "VIDEO_PROCESSOR_URL təhlükəsiz https ünvan deyil", { source: "video_processor" });
    }
  }

  async function call(path, init = {}) {
    need();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(base + path, { ...init, headers: { authorization: "Bearer " + token, ...(init.headers || {}) }, signal: ctrl.signal });
      if (res.status === 401 || res.status === 403) throw new AppError("AUTH_ERROR", "Video emal xidməti tokeni qəbul etmədi", { source: "video_processor" });
      if (res.status === 404) throw new AppError("NOT_FOUND", "Emal işi tapılmadı", { source: "video_processor" });
      if (res.status === 429) throw new AppError("RATE_LIMIT", "Video emal xidməti məşğuldur", { source: "video_processor" });
      if (!res.ok) throw new AppError("PROVIDER_ERROR", "Video emal xidməti xətası (" + res.status + ")", { source: "video_processor", retryable: res.status >= 500 });
      return res;
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (ctrl.signal.aborted) throw new AppError("TIMEOUT", "Video emal xidməti cavab vermədi", { source: "video_processor" });
      throw new AppError("NETWORK_ERROR", "Video emal xidmətinə qoşulmaq olmadı", { source: "video_processor", detail: String(e && e.message) });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    configured,
    async submit({ input_url, ops }) {
      for (const o of ops) if (!ALLOWED_OPS.has(o.op)) throw new AppError("VALIDATION_ERROR", "icazəsiz əməliyyat: " + o.op);
      const res = await call("/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input_url, ops }) });
      const j = await res.json().catch(() => null);
      if (!j || typeof j.id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(j.id)) throw new AppError("PROVIDER_ERROR", "Emal xidməti düzgün cavab vermədi", { source: "video_processor" });
      return { id: j.id };
    },
    async status(id) {
      const res = await call("/jobs/" + encodeURIComponent(id));
      const j = await res.json().catch(() => null);
      if (!j || !["queued", "running", "done", "failed"].includes(j.status)) throw new AppError("PROVIDER_ERROR", "Emal xidməti düzgün status vermədi", { source: "video_processor" });
      return { status: j.status, error: j.error ? String(j.error).slice(0, 200) : null };
    },
    // Qaytarır { body: ReadableStream, length }
    async output(id, { maxBytes }) {
      const res = await call("/jobs/" + encodeURIComponent(id) + "/output", {}, );
      const len = Number(res.headers.get("content-length"));
      if (!Number.isFinite(len) || len <= 0) throw new AppError("PROVIDER_ERROR", "Emal nəticəsinin ölçüsü məlum deyil", { source: "video_processor" });
      if (len > maxBytes) throw new AppError("VALIDATION_ERROR", "Emal nəticəsi çox böyükdür", { source: "video_processor" });
      return { body: res.body, length: len };
    },
  };
}
