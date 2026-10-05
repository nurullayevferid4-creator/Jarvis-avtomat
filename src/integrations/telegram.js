// Telegram Bot API adapteri: update qəbulu (webhook + getUpdates), bot məlumatı, fayl məlumatı, mesaj göndərmə (YALNIZ təsdiqlə).
// Secret: TELEGRAM_BOT_TOKEN (Cloudflare Secret), TELEGRAM_WEBHOOK_SECRET (Cloudflare Secret, webhook autentifikasiyası).
// Gizli olmayan: TELEGRAM_ALLOWED_CHAT_IDS (vergüllə ayrılmış çat id-ləri). Allowlist boşdursa HEÇ BİR çat qəbul olunmur (fail-closed).
//
// Rəsmi sənəd yoxlaması (2026-10-05, core.telegram.org/bots/api və /bots/faq, WebFetch xülasəsi; səhifə yarımçıq göründü; canlı hesabla sınanmayıb):
//  TƏSDİQLƏNDİ:  ünvan "https://api.telegram.org/bot<token>/METHOD_NAME"; cavab {ok, result, description, error_code, parameters.retry_after};
//    getMe -> User; getUpdates (offset, limit 1-100, timeout, allowed_updates; "outgoing webhook qurulubsa işləmir");
//    setWebhook (url, secret_token 1-256 simvol [A-Za-z0-9_-], başlıq "X-Telegram-Bot-Api-Secret-Token", portlar 443/80/88/8443);
//    sendMessage (məcburi: chat_id, text; Message qaytarır); getFile (file_id -> File{file_id,file_unique_id,file_size?,file_path?});
//    FAQ: bir çatda saniyədə ~1 mesaj, qrupda dəqiqədə 20, kütləvi göndərmədə ~30/san; yükləmə 20 MB, göndərmə 50 MB.
//  TƏSDİQLƏNMƏDİ (kodlaşdırılmayıb): fayl yükləmə ünvanı və etibarlılıq müddəti; sendMessage mətn limiti (4096 məlum, amma səhifədə görünmədi: 4000 ilə məhdudlaşdırılır);
//    Voice obyektinin sahələri; botun heç vaxt yazmamış istifadəçiyə mesaj göndərə bilib-bilməməsi.
//  Səs mesajı: update-dəki voice.file_id qəbul olunur və getFile ilə metadata alınır; faylın özü YÜKLƏNMİR (ünvan yoxlanmayıb).

import { IntegrationAdapter, EMPTY_INPUT, idSchema, pick } from "./Integration.js";
import { IntegrationError } from "./errors.js";
import { cleanText } from "../security/sanitize.js";

export const TG_HOST = "api.telegram.org";
const TOKEN_RE = /^\d{3,15}:[A-Za-z0-9_-]{10,128}$/; // yalnız yol-inyeksiyasından qorunmaq üçün giriş süzgəci
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

export const TELEGRAM_OPERATIONS = {
  "bot.get": { kind: "read", description: "Bot məlumatı (getMe)", input: EMPTY_INPUT },
  "updates.receive": { kind: "read", description: "Yeni mesajları al (getUpdates; webhook qurulubsa işləmir). Yalnız allowlist çatlarının mesajları qaytarılır", input: { type: "object", properties: { offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  "voice.get": { kind: "read", description: "Səs mesajı faylının metadatası (getFile; fayl yüklənmir)", input: { type: "object", properties: { file_id: idSchema }, required: ["file_id"], additionalProperties: false } },
  "message.send": { kind: "write", description: "Allowlist çatına mesaj göndərmə (YALNIZ Fərid-in təsdiqi ilə)", input: { type: "object", properties: { chat_id: { type: "string", minLength: 1, maxLength: 32 }, text: { type: "string", minLength: 1, maxLength: 4000 } }, required: ["chat_id", "text"], additionalProperties: false } },
  "voice.send": { kind: "write", description: "Səs göndərmə (hazırlanmayıb)", input: { type: "object", properties: { chat_id: { type: "string", maxLength: 32 } }, additionalProperties: false } },
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
  if (m.voice && typeof m.voice.file_id === "string" && FILE_ID_RE.test(m.voice.file_id)) return { ...base, kind: "voice", fileId: m.voice.file_id };
  return { ...base, kind: "other" };
}

const base = (env) => "https://" + TG_HOST + "/bot" + env.TELEGRAM_BOT_TOKEN;

function result(d) {
  if (!d || typeof d !== "object" || d.ok !== true) throw new Error("bad shape");
  return d.result;
}

const ENDPOINTS = {
  "bot.get": {
    verified: true,
    build: (i, env) => ({ url: base(env) + "/getMe" }),
    parse: (d) => pick(result(d), ["id", "is_bot", "first_name", "username", "can_join_groups", "can_read_all_group_messages"], 100),
  },
  "updates.receive": {
    verified: true,
    build: (i, env) => {
      const q = new URLSearchParams({ timeout: "0", limit: String(i.limit || 20) });
      if (i.offset !== undefined) q.set("offset", String(i.offset));
      return { url: base(env) + "/getUpdates?" + q.toString() };
    },
    parse: (d, env) => {
      const arr = result(d);
      if (!Array.isArray(arr)) throw new Error("bad shape");
      const allowed = parseAllowedChatIds(env.TELEGRAM_ALLOWED_CHAT_IDS);
      const norm = arr.slice(0, 100).map((u) => normalizeUpdate(u, allowed));
      const maxId = arr.reduce((m, u) => (u && Number.isInteger(u.update_id) && u.update_id > m ? u.update_id : m), -1);
      return { updates: norm.filter((n) => n.ok), rejected_count: norm.filter((n) => !n.ok).length, max_update_id: maxId >= 0 ? maxId : null };
    },
  },
  "voice.get": {
    verified: true,
    build: (i, env) => ({ url: base(env) + "/getFile?file_id=" + encodeURIComponent(i.file_id) }),
    parse: (d) => {
      const f = result(d);
      return { file_id: String(f.file_id || "").slice(0, 200), file_unique_id: String(f.file_unique_id || "").slice(0, 100), file_size: Number.isInteger(f.file_size) ? f.file_size : null, downloadable: typeof f.file_path === "string" && f.file_path.length > 0 };
    },
  },
  "message.send": {
    verified: true,
    build: (i, env) => ({ url: base(env) + "/sendMessage", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: i.chat_id, text: i.text }) }),
    parse: (d) => {
      const m = result(d);
      return { sent: true, message_id: m && Number.isInteger(m.message_id) ? m.message_id : null };
    },
  },
};

export class TelegramAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "telegram", label: "Telegram Bot (qəbul, təsdiqli göndərmə)", operations: TELEGRAM_OPERATIONS, endpoints: ENDPOINTS, allowedHosts: [TG_HOST], ...opts });
  }
  get allowedChatIds() { return parseAllowedChatIds(this._env.TELEGRAM_ALLOWED_CHAT_IDS); }
  parseUpdate(update) { return normalizeUpdate(update, this.allowedChatIds); }

  // Token düzgün formada olmalıdır (yol-inyeksiyası qoruması), allowlist boş olmamalıdır (fail-closed).
  _missing() {
    const m = super._missing();
    if (!m.includes("TELEGRAM_BOT_TOKEN") && !TOKEN_RE.test(String(this._env.TELEGRAM_BOT_TOKEN || ""))) m.push("TELEGRAM_BOT_TOKEN");
    if (!m.includes("TELEGRAM_ALLOWED_CHAT_IDS") && !this.allowedChatIds.length) m.push("TELEGRAM_ALLOWED_CHAT_IDS");
    return m;
  }

  // Göndərmə yalnız allowlist çatına: şəbəkədən və sübutdan əvvəl yoxlanır.
  _precheck(op, input, ctx) {
    if (op === "message.send" && !this.allowedChatIds.includes(String(input.chat_id))) throw new IntegrationError("forbidden_target", "chat_id icazə verilən çatlar siyahısında deyil", ctx);
    if (op === "voice.get" && !FILE_ID_RE.test(input.file_id)) throw new IntegrationError("invalid_input", "file_id düzgün deyil", ctx);
  }

  // Fərid-in ÖZ çatına, onun öz mesajına cavab (webhook). Bu, HTTP cavabının Telegram-dakı ekvivalentidir: hədəf həmişə allowlist çatıdır,
  // üçüncü şəxsə mesaj göndərmək üçün istifadə oluna bilməz (precheck). Təsdiq tələb etmir, çünki yeni xarici təsir deyil, sorğuya cavabdır.
  async replyToOwner(chatId, text) {
    const input = { chat_id: String(chatId), text: String(text || "").slice(0, 4000) };
    if (!input.text) throw new IntegrationError("invalid_input", "mətn boşdur", { integration: this.id, op: "message.send" });
    return await this._execute("message.send", input, { integration: this.id, op: "message.send" });
  }

  get mockHandlers() {
    return {
      "bot.get": () => ({ id: 1, username: "mock_bot", is_bot: true }),
      "updates.receive": () => ({ updates: [], rejected_count: 0, max_update_id: null }),
      "voice.get": (i) => ({ file_id: i.file_id, file_size: 0, downloadable: false }),
      "message.send": () => ({ sent: true, message_id: 0 }),
    };
  }
}
