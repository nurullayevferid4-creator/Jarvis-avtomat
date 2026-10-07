// OpenAI-ın SƏS xidmətləri: danışığı mətnə çevirmək (STT) və cavabı səsləndirmək (TTS).
// Bu, köməkçi AI deyil, səs interfeysidir, ona görə adapterdən ayrıdır.
// Formatlar (whisper-1, tts-1) köhnə işləyən koddan olduğu kimi saxlanılıb;
// rəsmi sənədlə təzədən yoxlanmayıb və real API ilə sınaqdan keçməyib.

import { httpRequest } from "../guards/http.js";
import { DEFAULTS } from "../config.js";
import { b64 } from "../util.js";
import { AppError } from "../errors.js";
import { providerHttpError } from "../providers/http.js";
import { openaiKey, inspectOpenAIKey } from "../security/envvalue.js";

// Səs xətaları da vahid kodlarla çıxır (AUTH_ERROR, RATE_LIMIT, ...), provider gövdəsi istifadəçiyə getmir.
// OpenAI xəta gövdəsindən YALNIZ səbəb növü çıxarılır; gövdənin özü (açarın maskalı hissəsi ola bilər) heç yerə getmir.
export function openaiAuthReason(status, body) {
  const b = String(body || "");
  if (status === 401 || status === 403) {
    if (/missing scopes|insufficient permissions/i.test(b)) return { reason: "missing_scopes", text: "açarın icazəsi çatmır (restricted key: «Model capabilities» / audio icazəsi verilməyib)" };
    if (/incorrect api key|invalid_api_key|invalid api key/i.test(b)) return { reason: "invalid_api_key", text: "OPENAI_API_KEY etibarsızdır (səhv yazılıb, silinib və ya ləğv edilib)" };
    if (/organization|deactivated|not active|account/i.test(b)) return { reason: "account_or_project", text: "açarın aid olduğu hesab/layihə aktiv deyil və ya giriş yoxdur" };
    if (/admin/i.test(b)) return { reason: "admin_key", text: "admin açarı model API-ləri üçün işlənə bilməz" };
    return { reason: "unauthorized", text: "OpenAI açarı qəbul etmədi" };
  }
  if (status === 429 && /insufficient_quota|quota|billing/i.test(b)) return { reason: "insufficient_quota", text: "OpenAI balansı/limiti bitib (billing)" };
  return null;
}

function audioError(label, status, body) {
  const e = providerHttpError("openai-audio", status, body);
  const why = openaiAuthReason(status, body);
  const err = new AppError(e.code, label + " " + status + (why ? ": " + why.text : ""), { source: "openai-audio", retryable: e.retryable });
  if (why) err.reason = why.reason;
  return err;
}

export async function stt(env, file, timeoutMs) {
  const type = file.type || "";
  const name = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "audio.mp4" : type.includes("ogg") ? "audio.ogg" : type.includes("wav") ? "audio.wav" : "audio.webm";
  const fd = new FormData();
  fd.append("file", file, name);
  fd.append("model", "whisper-1");
  fd.append("language", "az");
  const r = await httpRequest("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + openaiKey(env) }, body: fd }, timeoutMs);
  if (!r.ok) throw audioError("Səs tanıma xətası", r.status, r.data);
  return String(r.data.text || "").trim();
}

export async function tts(env, text, timeoutMs) {
  const r = await httpRequest(
    "https://api.openai.com/v1/audio/speech",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + openaiKey(env) },
      body: JSON.stringify({ model: "tts-1", voice: env.TTS_VOICE || DEFAULTS.ttsVoice, input: text.slice(0, 900), response_format: "mp3" }),
    },
    timeoutMs,
    "buffer",
  );
  if (!r.ok) throw audioError("Səsləndirmə xətası", r.status, typeof r.data === "string" ? r.data : "");
  return b64(r.data);
}

// Diaqnostika: 1 saniyəlik səssiz WAV (16 kHz, mono). Real STT çağırışı ilə açarın audio üçün işlədiyini yoxlayır.
// Xərci saniyə əsaslı və çox kiçikdir; açar heç yerə yazılmır.
export function silentWav(seconds = 1, rate = 16000) {
  const n = Math.round(seconds * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  return buf;
}

// ---- Diaqnostika (yalnız parolla, UI düyməsi) ----
// İki real sorğu: GET /v1/models (pulsuz, yalnız autentifikasiya) və POST /v1/audio/transcriptions (1 san. səssiz WAV).
// Qaytarılan: HTTP status, OpenAI-ın error.code/type (sabit siyahı dəyərləri), x-request-id, layihə/təşkilat identifikatoru.
// QAYTARILMAYAN: açar, error.message (içində maskalı açar olur), cavab gövdəsi.
const SAFE_ENUM = /^[a-z0-9_.]{1,64}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

async function probe(fetchImpl, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    let body = "";
    try { body = await res.text(); } catch (e) { body = ""; }
    let err = null;
    try { err = JSON.parse(body).error || null; } catch (e) { err = null; }
    const h = (k) => { const v = res.headers.get(k); return v && SAFE_ID.test(v) ? v : null; };
    const code = err && typeof err.code === "string" && SAFE_ENUM.test(err.code) ? err.code : null;
    const type = err && typeof err.type === "string" && SAFE_ENUM.test(err.type) ? err.type : null;
    const why = res.ok ? null : openaiAuthReason(res.status, String((err && err.message) || "") + " " + (code || "") + " " + (type || ""));
    return {
      reached: true,
      http: res.status,
      ok: res.ok,
      reason: res.ok ? "ok" : (why && why.reason) || code || type || "http_" + res.status,
      explanation: res.ok ? null : (why && why.text) || null,
      error_code: code,
      error_type: type,
      request_id: h("x-request-id"),
      project: h("openai-project"),
      organization: h("openai-organization"),
    };
  } catch (e) {
    return { reached: false, http: 0, ok: false, reason: ctrl.signal.aborted ? "timeout" : "network_error", explanation: "OpenAI-a çatmaq olmadı", error_code: null, error_type: null, request_id: null, project: null, organization: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function diagnoseOpenAI(env, timeoutMs, fetchImpl = (...a) => globalThis.fetch(...a)) {
  const key = inspectOpenAIKey(env);
  const out = { key, header: { scheme: "Bearer", well_formed: false }, auth: null, stt: null, verdict: "", action: "" };
  if (!key.set) {
    out.verdict = "secret_missing";
    out.action = "Cloudflare → jarvis-avtomat → Settings → Variables and Secrets → OPENAI_API_KEY (Secret) əlavə et və Deploy et.";
    return out;
  }
  const auth = "Bearer " + openaiKey(env);
  out.header.well_formed = /^Bearer sk-[A-Za-z0-9_-]{8,}$/.test(auth);
  out.auth = { endpoint: "GET /v1/models", ...(await probe(fetchImpl, "https://api.openai.com/v1/models", { method: "GET", headers: { authorization: auth } }, timeoutMs)) };
  const fd = new FormData();
  fd.append("file", new Blob([silentWav()], { type: "audio/wav" }), "audio.wav");
  fd.append("model", "whisper-1");
  fd.append("language", "az");
  out.stt = { endpoint: "POST /v1/audio/transcriptions", model: "whisper-1", language: "az", ...(await probe(fetchImpl, "https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: auth }, body: fd }, timeoutMs)) };

  const a = out.auth;
  const t = out.stt;
  if (t.ok) {
    out.verdict = "ok";
    out.action = "OpenAI autentifikasiyası və səs tanıma işləyir. Telegram səsli mesajını yenidən sına.";
  } else if (key.shape === "admin") {
    out.verdict = "admin_key";
    out.action = "Admin açarı (sk-admin-) model API-ləri üçün işləmir. OpenAI → Dashboard → API keys → «Create new secret key» (layihə açarı, sk-proj-) yarat, OPENAI_API_KEY secret-inə yaz, Deploy et.";
  } else if (!t.reached) {
    out.verdict = "unreachable";
    out.action = "Worker OpenAI-a çata bilmədi (şəbəkə/vaxt). Bir az sonra yenidən yoxla.";
  } else if (t.reason === "invalid_api_key" || a.reason === "invalid_api_key") {
    out.verdict = "key_invalid";
    out.action = "OpenAI bu açarı tanımır: səhv/yarımçıq yapışdırılıb, silinib və ya ləğv edilib. OpenAI → API keys siyahısında «son 4 simvol» ilə uyğun aktiv açar yoxdursa yeni layihə açarı yarat, Cloudflare-də OPENAI_API_KEY secret-ini yenilə (dırnaqsız), Deploy et.";
  } else if (t.reason === "missing_scopes") {
    out.verdict = "missing_audio_scope";
    out.action = "Açar etibarlıdır, amma audio icazəsi yoxdur (restricted key). OpenAI → API keys → açarı redaktə et → Permissions: «All» və ya Model capabilities-də audio (transcription) icazəsi ver. Yaxud «All» icazəli yeni açar yarat.";
  } else if (t.reason === "insufficient_quota" || t.http === 429) {
    out.verdict = t.reason === "insufficient_quota" ? "billing" : "rate_limited";
    out.action = t.reason === "insufficient_quota" ? "OpenAI layihəsində kredit/billing yoxdur. OpenAI → Settings → Billing-də balans əlavə et." : "OpenAI limiti doldu, bir az sonra yenidən yoxla.";
  } else if (t.reason === "account_or_project" || t.http === 401 || t.http === 403) {
    out.verdict = "account_or_project";
    out.action = "Açar hesab/layihə səviyyəsində rədd edilir (layihə arxivlənib, təşkilatdan çıxarılıb, region dəstəklənmir və s.). OpenAI-da aktiv layihədə yeni açar yarat və OPENAI_API_KEY-i yenilə.";
  } else {
    out.verdict = "stt_error";
    out.action = "Səs tanıma sorğusu HTTP " + t.http + " qaytardı (" + t.reason + "). request_id ilə OpenAI dəstəyinə müraciət etmək olar.";
  }
  return out;
}
