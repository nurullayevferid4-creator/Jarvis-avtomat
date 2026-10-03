// OpenAI-ın SƏS xidmətləri: danışığı mətnə çevirmək (STT) və cavabı səsləndirmək (TTS).
// Bu, köməkçi AI deyil, səs interfeysidir, ona görə adapterdən ayrıdır.
// Formatlar (whisper-1, tts-1) köhnə işləyən koddan olduğu kimi saxlanılıb;
// rəsmi sənədlə təzədən yoxlanmayıb və real API ilə sınaqdan keçməyib.

import { httpRequest } from "../guards/http.js";
import { DEFAULTS } from "../config.js";
import { b64 } from "../util.js";

export async function stt(env, file, timeoutMs) {
  const type = file.type || "";
  const name = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "audio.mp4" : type.includes("ogg") ? "audio.ogg" : type.includes("wav") ? "audio.wav" : "audio.webm";
  const fd = new FormData();
  fd.append("file", file, name);
  fd.append("model", "whisper-1");
  fd.append("language", "az");
  const r = await httpRequest("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + env.OPENAI_API_KEY }, body: fd }, timeoutMs);
  if (!r.ok) throw new Error("Səs tanıma xətası " + r.status + ": " + r.data);
  return String(r.data.text || "").trim();
}

export async function tts(env, text, timeoutMs) {
  const r = await httpRequest(
    "https://api.openai.com/v1/audio/speech",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.OPENAI_API_KEY },
      body: JSON.stringify({ model: "tts-1", voice: env.TTS_VOICE || DEFAULTS.ttsVoice, input: text.slice(0, 900), response_format: "mp3" }),
    },
    timeoutMs,
    "buffer",
  );
  if (!r.ok) throw new Error("Səsləndirmə xətası " + r.status);
  return b64(r.data);
}
