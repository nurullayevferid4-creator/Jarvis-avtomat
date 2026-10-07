// Telegram Bot API. Həm kanala paylaşım (TELEGRAM_CHANNEL_ID), həm də JARVIS-in öz mesajları üçündür.
// Rəsmi sənədə görə: setWebhook (secret_token, X-Telegram-Bot-Api-Secret-Token), sendMessage (≤4096),
// inline klaviatura (callback_data 1–64 bayt), answerCallbackQuery, getFile.
// Mesajlar parse_mode olmadan düz mətn kimi göndərilir (markup inyeksiyası olmasın).

import { BaseAdapter } from "./Base.js";
import { SocialError } from "../errors.js";
import { socialFetch, redactText } from "../http.js";
import { composeCaption, normalizeHashtags } from "../request.js";
import { cleanEnvValue } from "../../security/envvalue.js";

const MAX_TEXT = 4096;
export const WEBHOOK_UPDATES = ["message", "callback_query"];

export function classifyTelegramError(status, json) {
  const code = Number((json && json.error_code) || status);
  const desc = redactText((json && json.description) || "Telegram API xətası");
  const extra = { platform: "telegram", httpStatus: status, platformCode: code || null, retriable: false };
  if (code === 401) return new SocialError("token_expired", "Telegram bot tokeni etibarsızdır", extra);
  if (code === 403) return new SocialError("permission_denied", "Telegram icazəsi yoxdur (bot bloklanıb və ya kanalda admin deyil): " + desc, extra);
  if (code === 409) return new SocialError("conflict", "Telegram 409 Conflict qaytardı: " + desc, extra);
  if (code === 429) {
    const e = new SocialError("rate_limited", "Telegram limitinə dəyildi: " + desc, { ...extra, retriable: true });
    const ra = Number(json && json.parameters && json.parameters.retry_after);
    if (ra > 0) e.retryAfter = Math.min(ra, 3600);
    return e;
  }
  if (code === 400) return new SocialError("invalid_request", "Telegram sorğunu qəbul etmədi: " + desc, extra);
  if (code >= 500) return new SocialError("api_error", "Telegram müvəqqəti xətası: " + desc, { ...extra, retriable: true });
  return new SocialError("api_error", "Telegram xətası: " + desc, extra);
}

function textWithTags(caption, hashtags, max) {
  const tags = normalizeHashtags(hashtags).map((t) => "#" + t);
  let text = String(caption || "").trim();
  for (const t of tags) {
    const next = text ? text + (text.endsWith(t) ? "" : " ") + t : t;
    if (next.length > max) break;
    text = next;
  }
  return text.slice(0, max);
}

export class TelegramAdapter extends BaseAdapter {
  constructor(ctx) {
    super("telegram", ctx);
    this.safeToRestartStart = false;
  }

  token() {
    const t = cleanEnvValue(this.env.TELEGRAM_BOT_TOKEN);
    if (!t) throw new SocialError("not_connected", "TELEGRAM_BOT_TOKEN təyin edilməyib", { platform: "telegram" });
    return t;
  }

  async api(method, body) {
    const url = "https://api.telegram.org/bot" + this.token() + "/" + method;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const r = await socialFetch(url, isForm ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }, this.fopts(isForm ? 120000 : 20000));
    // Telegram həmişə JSON qaytarır. JSON yoxdursa cavab Telegram-dan deyil (proxy, firewall, şəbəkə bloku): bot xətası kimi göstərilmir.
    if (!r.json || typeof r.json !== "object") throw new SocialError("api_error", "Telegram API-dən Telegram cavabı gəlmədi (HTTP " + r.status + "): şəbəkə və ya proxy bloku ola bilər", { platform: "telegram", httpStatus: r.status, retriable: r.status >= 500 });
    if (!r.ok || r.json.ok !== true) throw classifyTelegramError(r.status, r.json);
    return r.json.result;
  }

  async sendMessage(chatId, text, extra = {}) {
    return await this.api("sendMessage", { chat_id: chatId, text: String(text).slice(0, MAX_TEXT), disable_web_page_preview: true, ...extra });
  }

  // Səsli mesaj (Telegram sənədi: sendVoice — OGG/OPUS). bytes: ArrayBuffer.
  async sendVoice(chatId, bytes, { caption = "" } = {}) {
    if (!bytes || !bytes.byteLength) throw new SocialError("media_error", "səs faylı boşdur", { platform: "telegram" });
    if (bytes.byteLength > 20 * 1024 * 1024) throw new SocialError("media_error", "səs faylı çox böyükdür", { platform: "telegram" });
    const fd = new FormData();
    fd.set("chat_id", String(chatId));
    if (caption) fd.set("caption", String(caption).slice(0, 1024));
    fd.set("voice", new Blob([bytes], { type: "audio/ogg" }), "jarvis.ogg");
    return await this.api("sendVoice", fd);
  }

  // "yazır…" / "səs yazır…" göstəricisi (uzun emal zamanı)
  async sendChatAction(chatId, action = "typing") {
    return await this.api("sendChatAction", { chat_id: chatId, action: action === "record_voice" ? "record_voice" : "typing" });
  }

  async answerCallbackQuery(id, text = "") {
    return await this.api("answerCallbackQuery", { callback_query_id: id, text: String(text).slice(0, 190) });
  }

  async clearButtons(chatId, messageId) {
    return await this.api("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }

  async editMessageText(chatId, messageId, text) {
    return await this.api("editMessageText", { chat_id: chatId, message_id: messageId, text: String(text).slice(0, MAX_TEXT), disable_web_page_preview: true });
  }

  // Bot API sənədinə görə bulud serverindən faylı ən çox 20 MB yükləmək olar.
  async downloadFile(fileId) {
    const info = await this.api("getFile", { file_id: String(fileId) });
    const path = String((info && info.file_path) || "");
    if (!/^[A-Za-z0-9_\-./]{1,200}$/.test(path) || path.includes("..")) throw new SocialError("media_error", "Telegram fayl yolu düzgün deyil", { platform: "telegram" });
    if (info.file_size && info.file_size > 20 * 1024 * 1024) throw new SocialError("media_error", "Telegram botu 20 MB-dan böyük faylı ala bilmir", { platform: "telegram" });
    const fetchImpl = this.ctx.fetchImpl || ((...a) => globalThis.fetch(...a));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetchImpl("https://api.telegram.org/file/bot" + this.token() + "/" + path, { signal: ctrl.signal, redirect: "manual" });
      if (!res.ok) throw new SocialError("media_error", "Telegram faylı yüklənmədi (HTTP " + res.status + ")", { platform: "telegram" });
      const bytes = await res.arrayBuffer();
      return { bytes, path };
    } catch (e) {
      if (e instanceof SocialError) throw e;
      throw new SocialError("media_error", "Telegram faylı yüklənmədi", { platform: "telegram", retriable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  async getMe() {
    return await this.api("getMe", {});
  }

  // Yalnız oxuma: Telegram-da hazırda qurulu webhook (url, pending_update_count, last_error_*, allowed_updates).
  async getWebhookInfo() {
    return (await this.api("getWebhookInfo", {})) || {};
  }

  // setWebhook mövcud webhook-u atomik əvəz edir (əvvəlcə deleteWebhook lazım deyil).
  // dropPending=true: köhnə gözləyən yeniləmələr atılır (başqa istehlakçıya aid köhnə əmrlər icra olunmasın).
  async setWebhook(url, { dropPending = true } = {}) {
    const secret = cleanEnvValue(this.env.TELEGRAM_WEBHOOK_SECRET);
    if (!secret) throw new SocialError("not_connected", "TELEGRAM_WEBHOOK_SECRET təyin edilməyib", { platform: "telegram" });
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) throw new SocialError("invalid_request", "TELEGRAM_WEBHOOK_SECRET yalnız A-Z a-z 0-9 _ - simvollarından ibarət (1-256) ola bilər", { platform: "telegram" });
    if (!/^https:\/\/[^\s]+$/.test(url)) throw new SocialError("invalid_request", "webhook ünvanı https olmalıdır", { platform: "telegram" });
    return await this.api("setWebhook", { url, secret_token: secret, allowed_updates: WEBHOOK_UPDATES, drop_pending_updates: dropPending === true });
  }

  // Yalnız adapter səviyyəsində: JARVIS webhook-u silmir (əsas giriş nöqtəsidir), lakin Bot API məntiqi tam və testlidir.
  async deleteWebhook({ dropPending = false } = {}) {
    return await this.api("deleteWebhook", { drop_pending_updates: dropPending === true });
  }

  // Sənədə uyğun: fayl yükləmə 20 MB-a qədər (getFile). Yalnız bot şəxsi çatdırma üçündür, JARVIS fayl yükləmir.

  configured() {
    return Boolean(cleanEnvValue(this.env.TELEGRAM_BOT_TOKEN));
  }

  async cachedStatus() {
    if (!this.configured()) return this.baseStatus({ state: "NOT_CONNECTED", reason: "TELEGRAM_BOT_TOKEN təyin edilməyib" });
    const ids = cleanEnvValue(this.env.TELEGRAM_ALLOWED_CHAT_IDS).split(",").map((x) => x.trim()).filter(Boolean);
    return this.baseStatus({
      state: "CONNECTED",
      verified: false,
      reason: "token Telegram-da hələ yoxlanmayıb (yalnız təyin olunub): «Telegram webhook-u yoxla» düyməsi və ya «Canlı yoxla»",
      webhook_secret_set: Boolean(cleanEnvValue(this.env.TELEGRAM_WEBHOOK_SECRET)),
      allowed_chats: ids.length,
      channel_configured: Boolean(this.env.TELEGRAM_CHANNEL_ID),
      warning: ids.length ? undefined : "TELEGRAM_ALLOWED_CHAT_IDS boşdur: bot heç kimin əmrini qəbul etməyəcək",
    });
  }

  async verifyAccount() {
    const me = await this.getMe();
    return { username: me.username || null, id: me.id || null };
  }

  channel() {
    const c = cleanEnvValue(this.env.TELEGRAM_CHANNEL_ID);
    if (!c) throw new SocialError("not_connected", "TELEGRAM_CHANNEL_ID təyin edilməyib", { platform: "telegram" });
    return c;
  }

  // Kanala paylaşım (yalnız təsdiqdən sonra flow.js çağırır)
  async start(req, t) {
    const chat = this.channel();
    let msg;
    if (!req.media) {
      msg = await this.sendMessage(chat, textWithTags(req.caption, req.hashtags, MAX_TEXT));
    } else {
      const field = req.media.type === "image" ? "photo" : "video";
      const method = req.media.type === "image" ? "sendPhoto" : "sendVideo";
      const caption = composeCaption("telegram", req.caption, req.hashtags);
      if (req.media.url) {
        msg = await this.api(method, { chat_id: chat, [field]: req.media.url, caption });
      } else {
        const head = await this.ctx.media.head(req.media.id);
        if (!head) throw new SocialError("media_error", "media tapılmadı", { platform: "telegram" });
        const bytes = await this.ctx.media.bytes(req.media.id);
        const fd = new FormData();
        fd.set("chat_id", chat);
        fd.set("caption", caption);
        fd.set(field, new Blob([bytes], { type: head.content_type }), "media." + head.ext);
        msg = await this.api(method, fd);
      }
    }
    t.post_id = String(msg.message_id);
    const un = msg.chat && msg.chat.username;
    if (un) t.post_url = "https://t.me/" + un + "/" + t.post_id;
    return "done";
  }

  async check() { return "done"; }
  async commit() { return "done"; }
}
