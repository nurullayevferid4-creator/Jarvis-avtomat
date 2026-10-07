// OpenAI-ın SƏS xidmətləri: danışığı mətnə çevirmək (STT) və cavabı səsləndirmək (TTS).
// Bu, köməkçi AI deyil, səs interfeysidir, ona görə adapterdən ayrıdır.
// Formatlar (whisper-1, tts-1) köhnə işləyən koddan olduğu kimi saxlanılıb;
// rəsmi sənədlə təzədən yoxlanmayıb və real API ilə sınaqdan keçməyib.

import { httpRequest } from "../guards/http.js";
import { DEFAULTS } from "../config.js";
import { b64 } from "../util.js";
import { AppError } from "../errors.js";
import { providerHttpError } from "../providers/http.js";
import { openaiKey } from "../security/envvalue.js";

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

export async function diagnoseStt(env, timeoutMs) {
  try {
    await stt(env, new Blob([silentWav()], { type: "audio/wav" }), timeoutMs);
    return { ok: true, http: 200, reason: "ok", message: "OpenAI səs tanıma bu açarla işləyir (whisper-1, az)." };
  } catch (e) {
    const http = Number(String((e && e.message) || "").match(/\b(\d{3})\b/)?.[1]) || 0;
    return { ok: false, http, reason: (e && e.reason) || (e && e.code) || "error", message: String((e && e.message) || "xəta").slice(0, 200) };
  }
}
