// Rəsmi TikTok API müştərisi. YALNIZ capabilities.js-də SUPPORTED/SUPPORTED_RESTRICTED olan endpoint-ləri çağırır.
// Şəbəkə qatı (fetch) inject olunur: testlərdə mock/transport.mjs, real istifadədə globalThis.fetch.
import { API_BASE, AUTHORIZE_URL, VIDEO_FIELDS, capability, isCallable, userFieldsFor } from "./capabilities.js";
import { redact, readTokenFile, writeTokenFile } from "./config.js";

export class TikTokError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "TikTokError";
    this.code = code;
    Object.assign(this, extra);
  }
}

export const MB = 1024 * 1024;

// Media Transfer Guide: chunk 5–64 MB, son chunk ≤128 MB, 1–1000 chunk, video ≤4 GB. 64 MB-dan kiçik fayl bir parçada.
export function chunkPlan(size) {
  if (!Number.isFinite(size) || size <= 0) throw new TikTokError("invalid_request", "Video ölçüsü yanlışdır");
  if (size > 4 * 1024 * MB) throw new TikTokError("invalid_request", "TikTok limiti: video ≤ 4 GB");
  if (size <= 64 * MB) return { chunk_size: size, total_chunk_count: 1 };
  const chunk = 32 * MB;
  return { chunk_size: chunk, total_chunk_count: Math.floor(size / chunk) }; // qalıq son parçaya qoşulur (≤ 64+32 < 128 MB)
}

export class TikTokClient {
  constructor(cfg, { fetch: fetchImpl, now } = {}) {
    this.cfg = cfg;
    this.fetch = fetchImpl || globalThis.fetch;
    this.now = now || (() => Date.now());
    if (cfg.mock && !fetchImpl) throw new TikTokError("config", "TIKTOK_MOCK=1: mock transport verilməlidir, real şəbəkəyə çıxılmır");
  }

  secrets() {
    const t = this.tokenRecord();
    return [...this.cfg.secretValues(), t && t.access_token, t && t.refresh_token].filter(Boolean);
  }

  tokenRecord() {
    if (this._token) return this._token;
    const fromFile = readTokenFile(this.cfg.tokenFile);
    if (fromFile && fromFile.access_token) return (this._token = fromFile);
    const access = this.cfg.secret("TIKTOK_ACCESS_TOKEN");
    if (!access) return null;
    return (this._token = { access_token: access, refresh_token: this.cfg.secret("TIKTOK_REFRESH_TOKEN"), open_id: this.cfg.openId, expires_at: 0, scope: this.cfg.scopes.join(",") });
  }

  connected() { return !!this.tokenRecord(); }

  grantedScopes() {
    const t = this.tokenRecord();
    const s = t && t.scope ? String(t.scope).split(",").map((x) => x.trim()).filter(Boolean) : this.cfg.scopes;
    return s;
  }

  // ---- OAuth (Login Kit) ----
  authUrl(state) {
    if (!this.cfg.clientKey || !this.cfg.redirectUri) throw new TikTokError("not_configured", "TIKTOK_CLIENT_KEY və TIKTOK_REDIRECT_URI lazımdır");
    if (!state || String(state).length < 16) throw new TikTokError("invalid_request", "CSRF state ən azı 16 simvol olmalıdır");
    const p = new URLSearchParams({ client_key: this.cfg.clientKey, scope: this.cfg.scopes.join(","), response_type: "code", redirect_uri: this.cfg.redirectUri, state });
    return AUTHORIZE_URL + "?" + p.toString();
  }

  async tokenRequest(params) {
    const secret = this.cfg.secret("TIKTOK_CLIENT_SECRET");
    if (!this.cfg.clientKey || !secret) throw new TikTokError("not_configured", "TIKTOK_CLIENT_KEY və TIKTOK_CLIENT_SECRET lazımdır");
    const body = new URLSearchParams({ client_key: this.cfg.clientKey, client_secret: secret, ...params }).toString();
    const r = await this.raw("oauth.token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" }, body });
    const j = r.json || {};
    if (!r.ok || j.error || !j.access_token) {
      throw new TikTokError(j.error === "invalid_grant" ? "token_expired" : "oauth_error", "TikTok token xətası: " + redact(j.error_description || j.error || "HTTP " + r.status, this.secrets()), { httpStatus: r.status });
    }
    const t = this.now();
    const rec = {
      access_token: j.access_token, refresh_token: j.refresh_token || "", open_id: j.open_id || "", scope: j.scope || this.cfg.scopes.join(","),
      expires_at: t + Number(j.expires_in || 86400) * 1000,
      refresh_expires_at: t + Number(j.refresh_expires_in || 31536000) * 1000, obtained_at: t,
    };
    writeTokenFile(this.cfg.tokenFile, rec);
    this._token = rec;
    return { open_id: rec.open_id, scope: rec.scope, expires_at: rec.expires_at }; // tokenlər geri qaytarılmır
  }

  exchangeCode(code) {
    if (!code) throw new TikTokError("invalid_request", "OAuth kodu boşdur");
    return this.tokenRequest({ code: decodeURIComponent(String(code)), grant_type: "authorization_code", redirect_uri: this.cfg.redirectUri });
  }

  async refresh() {
    const t = this.tokenRecord();
    if (!t || !t.refresh_token) throw new TikTokError("token_expired", "Token bitib və refresh token yoxdur: hesabı yenidən qoşun");
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  }

  async revoke() {
    const t = this.tokenRecord();
    if (!t) return { revoked: false };
    const body = new URLSearchParams({ client_key: this.cfg.clientKey, client_secret: this.cfg.secret("TIKTOK_CLIENT_SECRET"), token: t.access_token }).toString();
    const r = await this.raw("oauth.revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (!r.ok) throw new TikTokError("api_error", "Revoke alınmadı (HTTP " + r.status + ")");
    return { revoked: true };
  }

  async accessToken() {
    let t = this.tokenRecord();
    if (!t) throw new TikTokError("not_connected", "TikTok hesabı qoşulmayıb (token yoxdur)");
    if (t.expires_at && this.now() >= t.expires_at - 60000) { await this.refresh(); t = this.tokenRecord(); }
    return t.access_token;
  }

  // ---- Aşağı səviyyə ----
  async raw(capId, init, { url, query } = {}) {
    if (!isCallable(capId)) {
      const c = capability(capId);
      throw new TikTokError(c.status, "Bu funksiya rəsmi TikTok API ilə dəstəklənmir: " + c.feature, { capability: capId });
    }
    const c = capability(capId);
    let target = url || API_BASE + c.endpoint;
    if (query) target += "?" + new URLSearchParams(query).toString();
    if (!url && !target.startsWith(API_BASE + "/v2/")) throw new TikTokError("invalid_request", "Rəsmi API bazasından kənar ünvan");
    let res;
    try {
      res = await this.fetch(target, init);
    } catch (e) {
      throw new TikTokError("network", "Şəbəkə xətası: " + redact(e && e.message, this.secrets()), { retriable: true });
    }
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  }

  async api(capId, { body, query } = {}) {
    const c = capability(capId);
    const token = await this.accessToken();
    const r = await this.raw(capId, {
      method: c.method,
      headers: { authorization: "Bearer " + token, ...(c.method === "POST" ? { "content-type": "application/json; charset=UTF-8" } : {}) },
      body: c.method === "POST" ? JSON.stringify(body || {}) : undefined,
    }, { query });
    const err = r.json && r.json.error;
    if (!r.ok || (err && err.code && err.code !== "ok")) throw classify(r.status, err, this.secrets());
    return (r.json && r.json.data) || {};
  }

  // ---- Display API ----
  async userInfo() {
    const fields = userFieldsFor(this.grantedScopes());
    const d = await this.api("user.info", { query: { fields: fields.join(",") } });
    return { fields_requested: fields, user: d.user || {} };
  }

  async listVideos({ maxCount = 20, cursor } = {}) {
    const body = { max_count: Math.min(20, Math.max(1, maxCount)) };
    if (cursor) body.cursor = cursor;
    const d = await this.api("video.list", { body, query: { fields: VIDEO_FIELDS.join(",") } });
    return { videos: d.videos || [], cursor: d.cursor, has_more: !!d.has_more };
  }

  async listAllVideos(limit = 100) {
    const out = [];
    let cursor;
    for (let page = 0; page < 50 && out.length < limit; page++) {
      const r = await this.listVideos({ maxCount: 20, cursor });
      out.push(...r.videos);
      if (!r.has_more || !r.cursor) break;
      cursor = r.cursor;
    }
    return out.slice(0, limit);
  }

  async queryVideos(ids) {
    const list = [...new Set(ids)].slice(0, 20);
    const d = await this.api("video.query", { body: { filters: { video_ids: list } }, query: { fields: VIDEO_FIELDS.join(",") } });
    return d.videos || [];
  }

  // ---- Content Posting API ----
  creatorInfo() { return this.api("post.creator_info", { body: {} }); }
  initDirectPost(post_info, source_info) { return this.api("post.video.direct", { body: { post_info, source_info } }); }
  initInboxUpload(source_info) { return this.api("post.video.inbox", { body: { source_info } }); }
  fetchStatus(publish_id) { return this.api("post.status", { body: { publish_id } }); }

  async uploadVideo(uploadUrl, bytes, contentType, plan) {
    if (!/^https:\/\/[^/]*tiktok[^/]*\//i.test(String(uploadUrl))) throw new TikTokError("api_error", "upload_url TikTok domenində deyil");
    if (!["video/mp4", "video/quicktime", "video/webm"].includes(contentType)) throw new TikTokError("invalid_request", "Content-Type yalnız video/mp4, video/quicktime, video/webm");
    const size = bytes.byteLength;
    for (let i = 0; i < plan.total_chunk_count; i++) {
      const start = i * plan.chunk_size;
      const end = i === plan.total_chunk_count - 1 ? size - 1 : start + plan.chunk_size - 1;
      const part = bytes.subarray(start, end + 1);
      const r = await this.raw("post.video.direct", {
        method: "PUT",
        headers: { "content-type": contentType, "content-length": String(part.byteLength), "content-range": "bytes " + start + "-" + end + "/" + size },
        body: part,
      }, { url: uploadUrl });
      if (![200, 201, 206].includes(r.status)) throw new TikTokError("upload_failed", "Chunk " + (i + 1) + " yüklənmədi (HTTP " + r.status + ")");
    }
    return { uploaded_bytes: size };
  }
}

export function classify(status, err, secrets) {
  const code = String((err && err.code) || "");
  const msg = redact((err && err.message) || "HTTP " + status, secrets);
  const map = {
    unaudited_client_can_only_post_to_private_accounts: "unaudited_client",
    privacy_level_option_mismatch: "invalid_request",
    access_token_invalid: "token_expired",
    scope_not_authorized: "permission_denied",
    spam_risk_too_many_posts: "rate_limited",
    spam_risk_user_banned_from_posting: "permission_denied",
    reached_active_user_cap: "rate_limited",
    url_ownership_unverified: "permission_denied",
    rate_limit_exceeded: "rate_limited",
    invalid_param: "invalid_request",
  };
  const mapped = map[code] || (status === 401 ? "token_expired" : status === 429 ? "rate_limited" : status >= 500 ? "api_error" : "api_error");
  return new TikTokError(mapped, "TikTok: " + (code ? code + " — " : "") + msg, { httpStatus: status, platformCode: code || null, retriable: mapped === "rate_limited" || status >= 500, log_id: err && err.log_id });
}
