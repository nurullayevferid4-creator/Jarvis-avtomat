// Instagram (Instagram Login, graph.instagram.com). Rəsmi sənədə görə:
//  - media konteyneri: POST /<IG_ID>/media (image_url və ya media_type=REELS + video_url, caption)
//  - status: GET /<container>?fields=status_code (EXPIRED/ERROR/FINISHED/IN_PROGRESS/PUBLISHED)
//  - paylaşım: POST /<IG_ID>/media_publish (creation_id)
//  - media ictimai əlçatan serverdə olmalıdır (Meta özü çəkir)
//  - token: qısa → uzun (60 gün) → yeniləmə (≥24 saat köhnə, vaxtı bitməmiş)
// Xəta kodlarının (190, 10, 4/17/32/613) təsnifatı ümumi biliyə əsaslanır, bu sessiyada sənəddən yoxlanmayıb.

import { BaseAdapter } from "./Base.js";
import { SocialError } from "../errors.js";
import { socialFetch, formBody, redactText } from "../http.js";
import { composeCaption } from "../request.js";

const OAUTH_AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const SHORT_TOKEN = "https://api.instagram.com/oauth/access_token";
// Satış sistemi: DM (manage_messages) və şərh (manage_comments) icazələri də lazımdır. Köhnə bağlantı bu icazələrsiz yaradılıbsa yenidən qoşmaq lazımdır.
export const SCOPES = ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_messages", "instagram_business_manage_comments"];
const DAY = 86400000;

export function classifyInstagramError(status, json, platform = "instagram") {
  const e = (json && json.error) || {};
  const code = Number(e.code);
  const msg = redactText(e.message || "Instagram API xətası");
  const extra = { platform, httpStatus: status, platformCode: e.code === undefined ? null : e.code, retriable: false };
  if (code === 190 || e.type === "OAuthException" && /expired|invalid.*token|session/i.test(String(e.message))) return new SocialError("token_expired", "Instagram tokeni etibarsızdır və ya vaxtı bitib", extra);
  if (code === 10 || (code >= 200 && code <= 299)) return new SocialError("permission_denied", "Instagram icazəsi çatmır: " + msg, extra);
  if ([4, 9, 17, 32, 613].includes(code) || status === 429) return new SocialError("rate_limited", "Instagram limitinə dəyildi: " + msg, { ...extra, retriable: true });
  if (code === 100 || code === 9004 || code === 9007) return new SocialError("invalid_request", "Instagram sorğunu qəbul etmədi: " + msg, extra);
  if (status >= 500 || code === 1 || code === 2) return new SocialError("api_error", "Instagram müvəqqəti xətası: " + msg, { ...extra, retriable: true });
  return new SocialError("api_error", "Instagram xətası: " + msg, extra);
}

export class InstagramAdapter extends BaseAdapter {
  constructor(ctx) {
    super("instagram", ctx);
    this.safeToRestartStart = true; // konteyner yaratmaq paylaşım deyil
  }

  get version() { return this.env.INSTAGRAM_API_VERSION || "v25.0"; }
  graph(path) { return "https://graph.instagram.com/" + this.version + path; }

  async call(url, init) {
    const r = await socialFetch(url, init, this.fopts(20000));
    if (!r.ok) throw classifyInstagramError(r.status, r.json, "instagram");
    if (!r.json) throw new SocialError("api_error", "Instagram cavabı oxunmadı", { platform: "instagram", httpStatus: r.status, retriable: true });
    if (r.json.error) throw classifyInstagramError(r.status, r.json, "instagram");
    return r.json;
  }

  authUrl(state, redirectUri) {
    this.requireConfigured();
    const p = new URLSearchParams({ client_id: this.env.INSTAGRAM_APP_ID, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(","), state });
    return OAUTH_AUTHORIZE + "?" + p.toString();
  }

  async exchangeCode(code, redirectUri) {
    this.requireConfigured();
    const clean = String(code || "").replace(/#_$/, "");
    if (!clean) throw new SocialError("invalid_request", "OAuth kodu boşdur", { platform: "instagram" });
    const short = await this.call(SHORT_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ client_id: this.env.INSTAGRAM_APP_ID, client_secret: this.env.INSTAGRAM_APP_SECRET, grant_type: "authorization_code", redirect_uri: redirectUri, code: clean }),
    });
    const item = Array.isArray(short.data) ? short.data[0] : short;
    if (!item || !item.access_token) throw new SocialError("api_error", "Instagram token cavabı natamamdır", { platform: "instagram" });
    const long = await this.call("https://graph.instagram.com/access_token?" + formBody({ grant_type: "ig_exchange_token", client_secret: this.env.INSTAGRAM_APP_SECRET, access_token: item.access_token }), { method: "GET" });
    const rec = {
      access_token: long.access_token,
      expires_at: this.now() + Number(long.expires_in || 5184000) * 1000,
      user_id: String(item.user_id || ""),
      scope: Array.isArray(item.permissions) ? item.permissions.join(",") : String(item.permissions || SCOPES.join(",")),
      obtained_at: this.now(),
    };
    const acc = await this.fetchAccount(rec).catch(() => null);
    if (acc) { rec.account = acc; if (acc.user_id) rec.user_id = String(acc.user_id); }
    await this.ctx.vault.put("instagram", rec);
    let webhook = "not_attempted";
    try { await this.subscribeWebhooks(); webhook = "subscribed"; } catch (e) { webhook = "failed:" + String(e.code || "error"); }
    return { account: rec.account || null, expires_at: rec.expires_at, webhook };
  }

  // Vaxtı bitməmiş, ≥24 saat köhnə uzun müddətli token yenilənir (yeni 60 gün)
  async refresh(rec) {
    if (!rec || !rec.access_token) throw new SocialError("not_connected", "Instagram hesabı qoşulmayıb", { platform: "instagram" });
    if (rec.expires_at && this.now() >= rec.expires_at) throw new SocialError("token_expired", "Instagram tokeninin vaxtı bitib, yenidən qoşun", { platform: "instagram" });
    if (rec.obtained_at && this.now() - rec.obtained_at < DAY) return rec; // 24 saatdan tez yenilənmir
    const j = await this.call("https://graph.instagram.com/refresh_access_token?" + formBody({ grant_type: "ig_refresh_token", access_token: rec.access_token }), { method: "GET" });
    const next = { ...rec, access_token: j.access_token || rec.access_token, expires_at: this.now() + Number(j.expires_in || 5184000) * 1000, obtained_at: this.now() };
    await this.ctx.vault.put("instagram", next);
    return next;
  }

  // Aylıq yeniləmə üçün: yalnız vaxtı yaxınlaşanda
  async maybeRefresh() {
    const rec = await this.record();
    if (!rec || !rec.access_token || !rec.expires_at) return false;
    if (rec.expires_at - this.now() > 10 * DAY) return false;
    await this.refresh(rec);
    return true;
  }

  async fetchAccount(rec) {
    const j = await this.call(this.graph("/me") + "?" + formBody({ fields: "user_id,username,account_type", access_token: rec.access_token }), { method: "GET" });
    return { user_id: j.user_id || j.id || null, username: j.username || null, account_type: j.account_type || null };
  }

  async verifyAccount() {
    const rec = await this.validRecord();
    const acc = await this.fetchAccount(rec);
    const next = { ...rec, account: acc };
    await this.ctx.vault.put("instagram", next);
    return acc;
  }

  async publishingLimit(rec) {
    const j = await this.call(this.graph("/" + rec.user_id + "/content_publishing_limit") + "?" + formBody({ fields: "quota_usage,config", access_token: rec.access_token }), { method: "GET" });
    const d = Array.isArray(j.data) ? j.data[0] : j;
    return { quota_usage: d && d.quota_usage, quota_total: d && d.config && d.config.quota_total };
  }

  // Oxuma (yalnız GET, heç nə dərc/göndərmir). Sahələr Instagram API-nin sənədləşdirilmiş media/comments sahələridir.
  async recentMedia(limit = 10) {
    const rec = await this.validRecord();
    const j = await this.call(this.graph("/" + rec.user_id + "/media") + "?" + formBody({ fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", limit: String(Math.min(25, Math.max(1, limit | 0))), access_token: rec.access_token }), { method: "GET" });
    return Array.isArray(j.data) ? j.data : [];
  }

  async mediaComments(mediaId, limit = 20) {
    if (!/^\d{5,30}$/.test(String(mediaId))) throw new SocialError("media_error", "media id düzgün deyil", { platform: "instagram" });
    const rec = await this.validRecord();
    const j = await this.call(this.graph("/" + mediaId + "/comments") + "?" + formBody({ fields: "id,text,username,timestamp,like_count", limit: String(Math.min(50, Math.max(1, limit | 0))), access_token: rec.access_token }), { method: "GET" });
    return Array.isArray(j.data) ? j.data : [];
  }

  async mediaUrl(req) {
    const m = req.media;
    if (!m) throw new SocialError("media_error", "Instagram üçün media lazımdır", { platform: "instagram" });
    if (m.url) return m.url;
    const head = await this.ctx.media.head(m.id);
    if (!head) throw new SocialError("media_error", "media tapılmadı", { platform: "instagram" });
    return await this.ctx.media.signedUrl(m.id, head.ext, 3600);
  }

  // ---- Satış sistemi (DM / şərh). Endpoint və sahələr ictimai biliyə əsaslanır, bu sessiyada sənəddən yoxlanmayıb. ----

  hasScope(rec, name) {
    const sc = String((rec && rec.scope) || "");
    return sc.split(/[,\s]+/).includes(name);
  }

  // Hesab məlumatı + token vaxtı + icazələr (real sorğu: yalnız oxuma). Saxta uğur yoxdur: xəta olduğu kimi qaytarılır.
  async salesStatus() {
    const rec = await this.validRecord();
    const acc = await this.fetchAccount(rec);
    const days = rec.expires_at ? Math.floor((rec.expires_at - this.now()) / DAY) : null;
    return {
      account: acc,
      expires_in_days: days,
      messaging_scope: this.hasScope(rec, "instagram_business_manage_messages"),
      comments_scope: this.hasScope(rec, "instagram_business_manage_comments"),
      publish_scope: this.hasScope(rec, "instagram_business_content_publish"),
    };
  }

  // Webhook abunəliyi (messages, comments). Meta panelində webhook ünvanı da qurulmalıdır.
  async subscribeWebhooks(fields = "messages,comments") {
    const rec = await this.validRecord();
    if (!rec.user_id) throw new SocialError("not_connected", "Instagram user_id məlum deyil, yenidən qoşun", { platform: "instagram" });
    const j = await this.call(this.graph("/" + rec.user_id + "/subscribed_apps") + "?" + formBody({ subscribed_fields: fields, access_token: rec.access_token }), { method: "POST" });
    if (j.success !== true) throw new SocialError("api_error", "Instagram webhook abunəliyi təsdiqlənmədi", { platform: "instagram" });
    return { subscribed: fields };
  }

  async userProfile(igsid) {
    if (!/^\d{5,30}$/.test(String(igsid))) return null;
    const rec = await this.validRecord();
    try {
      const j = await this.call(this.graph("/" + igsid) + "?" + formBody({ fields: "name,username", access_token: rec.access_token }), { method: "GET" });
      return { name: j.name || null, username: j.username || null };
    } catch (e) {
      return null; // profil oxunmasa lead IGSID ilə saxlanır
    }
  }

  // Son söhbətlər (polling). Hər söhbətin son mesajı.
  async recentConversations(limit = 15) {
    const rec = await this.validRecord();
    const j = await this.call(this.graph("/" + rec.user_id + "/conversations") + "?" + formBody({ platform: "instagram", fields: "id,updated_time,messages.limit(3){id,message,from,created_time}", limit: String(Math.min(25, Math.max(1, limit | 0))), access_token: rec.access_token }), { method: "GET" });
    return { own_id: String(rec.user_id), items: Array.isArray(j.data) ? j.data : [] };
  }

  // DM göndərmə. Yalnız təsdiqdən sonra çağırılmalıdır (çağıran: instagram.dm.send alətinin execute-u).
  // recipientId: sənə yazmış istifadəçinin IGSID-si (24 saat pəncərəsi); commentId: şərhə "private reply" (7 gün, bir dəfə).
  async sendDm({ recipientId = "", commentId = "", text }) {
    const rec = await this.validRecord();
    if (!this.hasScope(rec, "instagram_business_manage_messages")) throw new SocialError("permission_denied", "Instagram mesaj icazəsi (instagram_business_manage_messages) yoxdur: hesabı yenidən qoşun", { platform: "instagram" });
    const msg = String(text || "").trim();
    if (!msg || msg.length > 1000) throw new SocialError("invalid_request", "DM mətni boş və ya 1000 simvoldan uzundur", { platform: "instagram" });
    const recipient = commentId ? { comment_id: String(commentId) } : { id: String(recipientId) };
    if (!recipient.comment_id && !/^\d{5,30}$/.test(recipient.id)) throw new SocialError("invalid_request", "alıcı id-si düzgün deyil", { platform: "instagram" });
    const j = await this.call(this.graph("/" + rec.user_id + "/messages"), { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + rec.access_token }, body: JSON.stringify({ recipient, message: { text: msg } }) });
    if (!j.message_id) throw new SocialError("api_error", "Instagram message_id qaytarmadı: göndərildi deyə bilmərik", { platform: "instagram", retriable: false });
    return { message_id: String(j.message_id) };
  }

  // Ictimai şərhə cavab (yalnız təsdiqdən sonra)
  async replyToComment(commentId, text) {
    if (!/^\d{5,30}$/.test(String(commentId))) throw new SocialError("invalid_request", "şərh id-si düzgün deyil", { platform: "instagram" });
    const rec = await this.validRecord();
    if (!this.hasScope(rec, "instagram_business_manage_comments")) throw new SocialError("permission_denied", "Instagram şərh icazəsi (instagram_business_manage_comments) yoxdur: hesabı yenidən qoşun", { platform: "instagram" });
    const msg = String(text || "").trim();
    if (!msg || msg.length > 2000) throw new SocialError("invalid_request", "cavab mətni boş və ya çox uzundur", { platform: "instagram" });
    const j = await this.call(this.graph("/" + commentId + "/replies"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody({ message: msg, access_token: rec.access_token }) });
    if (!j.id) throw new SocialError("api_error", "Instagram cavab id-si qaytarmadı: göndərildi deyə bilmərik", { platform: "instagram", retriable: false });
    return { reply_id: String(j.id) };
  }

  // 1) konteyner
  async start(req, t) {
    const rec = await this.validRecord();
    if (!rec.user_id) throw new SocialError("not_connected", "Instagram user_id məlum deyil, yenidən qoşun", { platform: "instagram" });
    const caption = composeCaption("instagram", req.caption, req.hashtags);
    const url = await this.mediaUrl(req);
    const body = { caption, access_token: rec.access_token };
    if (req.media.type === "video") { body.media_type = "REELS"; body.video_url = url; }
    else body.image_url = url;
    const j = await this.call(this.graph("/" + rec.user_id + "/media"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody(body) });
    if (!j.id) throw new SocialError("api_error", "Instagram konteyner id-si gəlmədi", { platform: "instagram" });
    t.data.container_id = String(j.id);
    return "waiting";
  }

  // 2) status (təxminən dəqiqədə bir, ən çox 5 dəqiqə — flow bunu nəzarət edir)
  async check(req, t) {
    const rec = await this.validRecord();
    const j = await this.call(this.graph("/" + t.data.container_id) + "?" + formBody({ fields: "status_code", access_token: rec.access_token }), { method: "GET" });
    const s = String(j.status_code || "");
    t.data.container_status = s;
    if (s === "FINISHED") return "ready";
    if (s === "PUBLISHED") return "done";
    if (s === "ERROR" || s === "EXPIRED") throw new SocialError("api_error", "Instagram media emalı alınmadı (" + s + ")", { platform: "instagram", platformCode: s });
    return "waiting";
  }

  // 3) real paylaşım (yalnız bir dəfə çağırılır)
  async commit(req, t) {
    const rec = await this.validRecord();
    const j = await this.call(this.graph("/" + rec.user_id + "/media_publish"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: formBody({ creation_id: t.data.container_id, access_token: rec.access_token }) });
    if (!j.id) throw new SocialError("api_error", "Instagram post id-si gəlmədi", { platform: "instagram" });
    t.post_id = String(j.id);
    try {
      const p = await this.call(this.graph("/" + t.post_id) + "?" + formBody({ fields: "permalink", access_token: rec.access_token }), { method: "GET" });
      if (p.permalink) t.post_url = String(p.permalink);
    } catch (e) {
      t.note = "paylaşıldı, link alınmadı";
    }
    return "done";
  }
}
