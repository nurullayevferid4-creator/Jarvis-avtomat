// Səs əmri: STT mətnini JARVIS əmrinə çevirir.
//   SƏS → STT → əmr təmizləmə → planner → alətlər → nəticə → Azərbaycan dilində cavab → TTS → səs
// Səslə TƏSDİQ VERİLMİR: riskli əməliyyatlar yalnız təsdiq panelindən/Telegram düyməsindən icra olunur
// (səs tanıma səhvi real əməliyyata çevrilməsin deyə).

import { AppError } from "../errors.js";

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_COMMAND_CHARS = 1500;
const AUDIO_TYPES = /^(audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|x-m4a|m4a)|video\/(webm|mp4))(;.*)?$/i;
// Səssizlikdə STT-nin uydurduğu tipik cümlələr: əmr kimi qəbul edilmir
const HALLUCINATIONS = /^(thanks for watching|thank you for watching|subtitles by.*|amara\.org.*|bye|you)\.?$/i;

export function checkAudioFile(file) {
  if (!file || typeof file === "string") throw new AppError("VALIDATION_ERROR", "Səs faylı yoxdur");
  if (!file.size) throw new AppError("VALIDATION_ERROR", "Səs faylı boşdur");
  if (file.size > MAX_AUDIO_BYTES) throw new AppError("VALIDATION_ERROR", "Səs yazısı çox uzundur (maksimum 8 MB)");
  if (file.type && !AUDIO_TYPES.test(file.type)) throw new AppError("VALIDATION_ERROR", "Səs formatı dəstəklənmir");
  return file;
}

// "Jarvis, ..." / "Jarvis ..." prefiksini ayırır. Qaytarır { text, wake }
export function parseVoiceCommand(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!t) throw new AppError("VALIDATION_ERROR", "Nə dediyini eşitmədim");
  if (HALLUCINATIONS.test(t)) throw new AppError("VALIDATION_ERROR", "Aydın əmr eşidilmədi, bir də de");
  if (t.length > MAX_COMMAND_CHARS) t = t.slice(0, MAX_COMMAND_CHARS);
  const m = /^(jarvis|jarviz|jarwis|ceyrvis|carvis|cərvis)\b[\s,.:;!-]*/i.exec(t);
  if (m) {
    const rest = t.slice(m[0].length).trim();
    if (!rest) throw new AppError("VALIDATION_ERROR", "Eşidirəm. Əmri de");
    return { text: rest, wake: true };
  }
  return { text: t, wake: false };
}

// Səsləndirilən mətn: URL, id, uzun rəqəm sətirləri oxunmur (gizli/uzun məlumat səsə çıxmasın)
export function speakable(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/g, "link ekranda")
    .replace(/\b[0-9a-f]{20,}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}
