// Agentlər üçün ortaq köməkçilər. Yazıları saxlamazdan əvvəl mətn təmizlənir və açara oxşar dəyərlər gizlədilir.
// Qeyd: bu ilkin qoruyucu süzgəcdir. Yaddaş üçün daha geniş maskalama ayrıca PR-dadır (PR #6), bu fayl ona toxunmur.

import { cleanText } from "../security/sanitize.js";
import { makeId } from "../state/store.js";

export const MASK = "[gizlədildi]";

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}/g, // API açar formatları
  /\bBearer\s{1,3}[A-Za-z0-9._~+\/=-]{12,}/gi,
  /\b(?:ghp|gho|ghs|github_pat|xox[bp]|AIza)[A-Za-z0-9_-]{10,}/g,
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, // Telegram bot tokeni forması
  /\b(?:token|secret|password|passcode|api[_ -]?key|parol|açar)\s{0,3}[:=]\s{0,3}\S{1,200}/gi,
];

export function scrub(text, maxLen = 500) {
  let t = cleanText(text, maxLen * 4).text;
  for (const re of SECRET_PATTERNS) t = t.replace(re, MASK);
  return t.slice(0, maxLen).trim();
}

export { makeId };

export class AgentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentError";
    this.code = code; // invalid_input | approval_required | forbidden_target | not_found | disabled | invalid_state
  }
}
