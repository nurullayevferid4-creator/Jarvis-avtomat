// Telegram Bot API. Həm kanala paylaşım (TELEGRAM_CHANNEL_ID), həm də JARVIS-in öz mesajları üçündür.
// Rəsmi sənədə görə: setWebhook (secret_token, X-Telegram-Bot-Api-Secret-Token), sendMessage (≤4096),
// inline klaviatura (callback_data 1–64 bayt), answerCallbackQuery, getFile.
// Mesajlar parse_mode olmadan düz mətn kimi göndərilir (markup inyeksiyası olmasın).

import { BaseAdapter } from "./Base.js";
import { SocialError } from "../errors.js";
import { socialFetch, redactText } from "../http.js";
import { composeCaption, normalizeHashtags } from "../request.js";

const MAX_TEXT = 4096;

export function classifyTelegramError(status, json) {
  const code = Number((json && json.error_code) || status);
  const desc = redactText((json && json.description) || "Telegram API xətası");
  const extra = { platform: "telegram", httpStatus: status, platformCode: code || null, retriable: false };
  if (code === 401) return new SocialError("token_expired", "Telegram bot tokeni etibarsızdır", extra);
  if (code === 403) return new SocialError("permission_denied", "Telegram icazəsi yoxdur (bot bloklanıb və ya kanalda admin deyil): " + desc, extra);
  if (code === 429) return new SocialError("rate_limited", "Telegram limitinə dəyildi: " + desc, { ...extra, retriable: true });
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
    const t = this.env.TELEGRAM_BOT_TOKEN;
    if (!t) throw new SocialError("not_connected", "TELEGRAM_BOT_TOKEN təyin edilməyib", { platform: "telegram" });
    return String(t);
  }

  async api(method, body) {
    const url = "https://api.telegram.org/bot" + this.token() + "/" + method;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const r = await socialFetch(url, isForm ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }, this.fopts(isForm ? 120000 : 20000));
    if (!r.ok || !r.json || r.json.ok !== true) throw classifyTelegramError(r.status, r.json);
    return r.json.result;
  }

  async sendMessage(chatId, text, extra = {}) {
    return await this.api("sendMessage", { chat_id: chatId, text: String(text).slice(0, MAX_TEXT), disable_web_page_preview: true, ...extra });
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

  async setWebhook(url) {
    if (!this.env.TELEGRAM_WEBHOOK_SECRET) throw new SocialError("not_connected", "TELEGRAM_WEBHOOK_SECRET təyin edilməyib", { platform: "telegram" });
    if (!/^https:\/\/[^\s]+$/.test(url)) throw new SocialError("invalid_request", "webhook ünvanı https olmalıdır", { platform: "telegram" });
    return await this.api("setWebhook", { url, secret_token: this.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  }

  // Sənədə uyğun: fayl yükləmə 20 MB-a qədər (getFile). Yalnız bot şəxsi çatdırma üçündür, JARVIS fayl yükləmir.

  configured() {
    return Boolean(this.env.TELEGRAM_BOT_TOKEN);
  }

  async cachedStatus() {
    if (!this.configured()) return this.baseStatus({ state: "NOT_CONNECTED", reason: "TELEGRAM_BOT_TOKEN təyin edilməyib" });
    const ids = String(this.env.TELEGRAM_ALLOWED_CHAT_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
    return this.baseStatus({
      state: "CONNECTED",
      verified: false,
      webhook_secret_set: Boolean(this.env.TELEGRAM_WEBHOOK_SECRET),
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
    const c = this.env.TELEGRAM_CHANNEL_ID;
    if (!c) throw new SocialError("not_connected", "TELEGRAM_CHANNEL_ID təyin edilməyib", { platform: "telegram" });
    return String(c);
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
