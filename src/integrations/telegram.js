// Telegram Bot skeleti: mesaj qəbulu (update) və gələcək göndərmə/səs interfeysi.
// Secret adı: TELEGRAM_BOT_TOKEN (Cloudflare Secret). Gizli olmayan: TELEGRAM_ALLOWED_CHAT_IDS (vergüllə ayrılmış çat id-ləri).
// Allowlist boşdursa HEÇ BİR çat qəbul olunmur (fail-closed). Göndərmə (message.send, voice.send) söndürülüb.
// Endpoint-lər yoxlanmayıb: canlı çağırış söndürülüb.

import { IntegrationAdapter, EMPTY_INPUT, idSchema } from "./Integration.js";
import { cleanText } from "../security/sanitize.js";

export const TELEGRAM_OPERATIONS = {
  "bot.get": { kind: "read", description: "Bot məlumatı", input: EMPTY_INPUT },
  "updates.receive": { kind: "read", description: "Yeni mesajları al (webhook/polling üçün gələcək interfeys)", input: { type: "object", properties: { offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  "voice.get": { kind: "read", description: "Səs mesajının faylı (gələcək interfeys)", input: { type: "object", properties: { file_id: idSchema }, required: ["file_id"], additionalProperties: false } },
  "message.send": { kind: "write", description: "Mesaj göndərmə (söndürülüb)", input: { type: "object", properties: { chat_id: { type: "string", maxLength: 32 }, text: { type: "string", maxLength: 4000 } }, additionalProperties: false } },
  "voice.send": { kind: "write", description: "Səs göndərmə (söndürülüb)", input: { type: "object", properties: { chat_id: { type: "string", maxLength: 32 } }, additionalProperties: false } },
};

// "123,-456" -> ["123","-456"]; düzgün olmayan elementlər atılır.
export function parseAllowedChatIds(value) {
  return String(value || "").split(",").map((s) => s.trim()).filter((s) => /^-?\d{1,20}$/.test(s));
}

// Gələn update-i yoxlayır və normallaşdırır. Allowlist-də olmayan çat, naməlum forma: { ok:false }.
// Mətn yalnız təmizlənir (idarəedici simvollar silinir, uzunluq kəsilir). Allowlist-dəki çat Fərid-in çatıdır, amma
// mətn yenə də modelə əmr kimi yox, istifadəçi mesajı kimi gedəcək (orkestrator tərəfində).
export function normalizeUpdate(update, allowedChatIds) {
  const allowed = Array.isArray(allowedChatIds) ? allowedChatIds.map(String) : [];
  const m = update && typeof update === "object" ? update.message : null;
  if (!m || typeof m !== "object" || !m.chat || (typeof m.chat.id !== "number" && typeof m.chat.id !== "string")) return { ok: false, reason: "unsupported" };
  const chatId = String(m.chat.id);
  if (!allowed.length || !allowed.includes(chatId)) return { ok: false, reason: "chat_not_allowed" };
  const base = { ok: true, chatId, messageId: Number.isInteger(m.message_id) ? m.message_id : null, updateId: Number.isInteger(update.update_id) ? update.update_id : null };
  if (typeof m.text === "string") return { ...base, kind: "text", text: cleanText(m.text, 4000).text };
  if (m.voice && typeof m.voice.file_id === "string" && m.voice.file_id.length <= 200) return { ...base, kind: "voice", fileId: m.voice.file_id };
  return { ...base, kind: "other" };
}

export class TelegramAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "telegram", label: "Telegram Bot (yalnız qəbul)", operations: TELEGRAM_OPERATIONS, endpoints: {}, ...opts });
  }
  get allowedChatIds() { return parseAllowedChatIds(this._env.TELEGRAM_ALLOWED_CHAT_IDS); }
  parseUpdate(update) { return normalizeUpdate(update, this.allowedChatIds); }
  get mockHandlers() {
    return {
      "bot.get": () => ({ id: 1, username: "mock_bot", is_bot: true }),
      "updates.receive": () => ({ updates: [] }),
      "voice.get": (i) => ({ file_id: i.file_id, size: 0 }),
    };
  }
}
