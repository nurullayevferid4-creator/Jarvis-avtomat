// TikTok Content Posting API (Direct Post, FILE_UPLOAD). Rəsmi sənədə görə:
//  - OAuth: https://www.tiktok.com/v2/auth/authorize/ , token: POST https://open.tiktokapis.com/v2/oauth/token/
//    (access 24 saat, refresh 365 gün), scope: video.publish
//  - creator_info: POST /v2/post/publish/creator_info/query/ (privacy_level_options)
//  - init: POST /v2/post/publish/video/init/ → publish_id, upload_url (1 saat etibarlıdır)
//  - yükləmə: PUT upload_url, Content-Range: bytes a-b/total (tək parça; 206 = davam, 201 = tamam)
//  - status: POST /v2/post/publish/status/fetch/ {publish_id}
//  - Audit olunmamış tətbiq yalnız SELF_ONLY paylaşa bilir (unaudited_client_can_only_post_to_private_accounts).
//  - PULL_FROM_URL verifikasiya olunmuş domen tələb edir, bu səbəbdən JARVIS yalnız FILE_UPLOAD istifadə edir.
// "access_token_invalid", "scope_not_authorized", "rate_limit_exceeded" kodları ümumi biliyə əsaslanır.

import { BaseAdapter } from "./Base.js";
import { SocialError } from "../errors.js";
import { socialFetch, formBody, redactText } from "../http.js";
import { composeCaption } from "../request.js";
import { assertSafeUrl } from "../../security/ssrf.js";

const API = "https://open.tiktokapis.com";
const AUTHORIZE = "https://www.tiktok.com/v2/auth/authorize/";
const SCOPES = ["user.info.basic", "video.publish"];
const PRIVACY_MAP = { private: "SELF_ONLY", unlisted: "MUTUAL_FOLLOW_FRIENDS", public: "PUBLIC_TO_EVERYONE" };

export function classifyTikTokError(status, json) {
  const e = (json && json.error) || {};
  const code = String(e.code || "");
  const msg = redactText(e.message || "TikTok API xətası");
  const extra = { platform: "tiktok", httpStatus: status, platformCode: code || null, retriable: false };
  if (code === "unaudited_client_can_only_post_to_private_accounts") return new SocialError("unaudited_client", "TikTok tətbiqi hələ audit olunmayıb: yalnız şəxsi (SELF_ONLY) paylaşım mümkündür", extra);
  if (code === "privacy_level_option_mismatch") return new SocialError("invalid_request", "Seçilən məxfilik səviyyəsi bu hesab üçün icazəli deyil", extra);
  if (code === "access_token_invalid" || code === "access_token_expired" || status === 401) return new SocialError("token_expired", "TikTok tokeni etibarsızdır və ya vaxtı bitib", extra);
  if (code === "scope_not_authorized" || code === "spam_risk_user_banned_from_posting") return new SocialError("permission_denied", "TikTok icazəsi çatmır: " + msg, extra);
  if (code === "rate_limit_exceeded" || code === "spam_risk_too_many_posts" || status === 429) return new SocialError("rate_limited", "TikTok limitinə dəyildi: " + msg, { ...extra, retriable: true });
  if (status >= 500) return new SocialError("api_error", "TikTok müvəqqəti xətası: " + msg, { ...extra, retriable: true });
  return new SocialError("api_error", "TikTok xətası: " + msg, extra);
}

export class TikTokAdapter extends BaseAdapter {
  constructor(ctx) {
    super("tiktok", ctx);
    this.safeToRestartStart = false; // init+upload bitdikdən sonra TikTok özü paylaşır
  }

  async api(path, token, body) {
    const r = await socialFetch(API + path, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body || {}),
    }, this.fopts(20000));
    const code = r.json && r.json.error && r.json.error.code;
    if (!r.ok || (code && code !== "ok")) throw classifyTikTokError(r.status, r.json);
    if (!r.json) throw new SocialError("api_error", "TikTok cavabı oxunmadı", { platform: "tiktok", httpStatus: r.status, retriable: true });
    return r.json.data || {};
  }

  authUrl(state, redirectUri) {
    this.requireConfigured();
    const p = new URLSearchParams({ client_key: this.env.TIKTOK_CLIENT_KEY, scope: SCOPES.join(","), response_type: "code", redirect_uri: redirectUri, state });
    return AUTHORIZE + "?" + p.toString();
  }

  async tokenRequest(params) {
    const r = await socialFetch(API + "/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
      body: formBody({ client_key: this.env.TIKTOK_CLIENT_KEY, client_secret: this.env.TIKTOK_CLIENT_SECRET, ...params }),
    }, this.fopts(20000));
    const j = r.json || {};
    if (!r.ok || j.error || !j.access_token) {
      const code = String(j.error || "");
      const msg = redactText(j.error_description || "TikTok token xətası");
      const extra = { platform: "tiktok", httpStatus: r.status, platformCode: code || null };
      if (code === "invalid_grant" || code === "invalid_request") throw new SocialError("token_expired", "TikTok kodu/tokeni etibarsızdır: " + msg, extra);
      throw new SocialError("api_error", "TikTok token xətası: " + msg, extra);
    }
    return j;
  }

  toRecord(j, prev = {}) {
    const t = this.now();
    return {
      ...prev,
      access_token: j.access_token,
      refresh_token: j.refresh_token || prev.refresh_token || "",
      expires_at: t + Number(j.expires_in || 86400) * 1000,
      refresh_expires_at: j.refresh_expires_in ? t + Number(j.refresh_expires_in) * 1000 : prev.refresh_expires_at || 0,
      open_id: j.open_id || prev.open_id || "",
      scope: j.scope || prev.scope || SCOPES.join(","),
      obtained_at: t,
    };
  }

  async exchangeCode(code, redirectUri) {
    this.requireConfigured();
    const clean = String(code || "").trim();
    if (!clean) throw new SocialError("invalid_request", "OAuth kodu boşdur", { platform: "tiktok" });
    const j = await this.tokenRequest({ code: clean, grant_type: "authorization_code", redirect_uri: redirectUri });
    const rec = this.toRecord(j);
    await this.ctx.vault.put("tiktok", rec);
    return { account: null, expires_at: rec.expires_at };
  }

  async refresh(rec) {
    if (!rec || !rec.refresh_token) throw new SocialError("token_expired", "TikTok tokeninin vaxtı bitib, yenidən qoşun", { platform: "tiktok" });
    if (rec.refresh_expires_at && this.now() >= rec.refresh_expires_at) throw new SocialError("token_expired", "TikTok refresh tokeninin vaxtı bitib, yenidən qoşun", { platform: "tiktok" });
    const j = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: rec.refresh_token });
    const next = this.toRecord(j, rec);
    await this.ctx.vault.put("tiktok", next);
    return next;
  }

  async creatorInfo(rec) {
    return await this.api("/v2/post/publish/creator_info/query/", rec.access_token, {});
  }

  async verifyAccount() {
    const rec = await this.validRecord();
    const c = await this.creatorInfo(rec);
    const account = { username: c.creator_username || null, nickname: c.creator_nickname || null, privacy_options: Array.isArray(c.privacy_level_options) ? c.privacy_level_options : [], max_duration_sec: c.max_video_post_duration_sec || null };
    await this.ctx.vault.put("tiktok", { ...rec, account });
    return account;
  }

  async start(req, t) {
    const rec = await this.validRecord();
    if (!req.media || !req.media.id) throw new SocialError("media_error", "TikTok üçün JARVIS_MEDIA-ya yüklənmiş video (media_id) lazımdır", { platform: "tiktok" });
    const head = await this.ctx.media.head(req.media.id);
    if (!head || head.kind !== "video") throw new SocialError("media_error", "TikTok üçün video tapılmadı", { platform: "tiktok" });

    const creator = await this.creatorInfo(rec);
    const level = PRIVACY_MAP[req.privacy] || "SELF_ONLY";
    const options = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options : [];
    if (options.length && !options.includes(level)) {
      throw new SocialError("invalid_request", "Bu TikTok hesabı üçün icazəli məxfilik: " + options.join(", "), { platform: "tiktok", platformCode: "privacy_level_option_mismatch" });
    }
    if (creator.max_video_post_duration_sec) t.data.max_duration_sec = creator.max_video_post_duration_sec;

    const bytes = await this.ctx.media.bytes(req.media.id);
    const size = bytes.byteLength;
    const postInfo = { title: composeCaption("tiktok", req.title || req.caption, req.hashtags), privacy_level: level };
    if (creator.comment_disabled) postInfo.disable_comment = true;
    if (creator.duet_disabled) postInfo.disable_duet = true;
    if (creator.stitch_disabled) postInfo.disable_stitch = true;

    const init = await this.api("/v2/post/publish/video/init/", rec.access_token, {
      post_info: postInfo,
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
    });
    if (!init.publish_id || !init.upload_url) throw new SocialError("api_error", "TikTok init cavabı natamamdır", { platform: "tiktok" });
    // upload_url yalnız TikTok domenlərinə (https, IP yox) ola bilər. Real host adları sənəddən tam yoxlanmayıb.
    let uploadHost = "";
    try { uploadHost = assertSafeUrl(init.upload_url).hostname; } catch (e) { uploadHost = ""; }
    if (!/(^|\.)tiktok[a-z0-9-]*\.com$/i.test(uploadHost)) throw new SocialError("api_error", "TikTok upload ünvanı etibarsızdır", { platform: "tiktok" });
    t.data.publish_id = String(init.publish_id);
    t.data.privacy_level = level;

    const up = await socialFetch(String(init.upload_url), {
      method: "PUT",
      headers: { "content-type": head.content_type, "content-range": "bytes 0-" + (size - 1) + "/" + size },
      body: bytes,
    }, this.fopts(120000));
    if (up.status !== 201 && up.status !== 200 && up.status !== 206) {
      throw new SocialError("api_error", "TikTok video yükləməsi alınmadı (HTTP " + up.status + ")", { platform: "tiktok", httpStatus: up.status, retriable: false });
    }
    return "waiting";
  }

  async check(req, t) {
    const rec = await this.validRecord();
    const d = await this.api("/v2/post/publish/status/fetch/", rec.access_token, { publish_id: t.data.publish_id });
    const s = String(d.status || "");
    t.data.remote_status = s;
    if (s === "PUBLISH_COMPLETE") {
      const ids = Array.isArray(d.publicaly_available_post_id) ? d.publicaly_available_post_id : [];
      if (ids.length) t.post_id = String(ids[0]);
      else t.post_id = t.data.publish_id;
      if (t.data.privacy_level === "SELF_ONLY") t.note = "TikTok-da yalnız özünüz görür (SELF_ONLY)";
      return "done";
    }
    if (s === "SEND_TO_USER_INBOX") {
      t.post_id = t.data.publish_id;
      t.note = "TikTok tətbiqinin inbox-una göndərildi, orada təsdiq lazımdır";
      return "done";
    }
    if (s === "FAILED") throw new SocialError("api_error", "TikTok paylaşımı alınmadı: " + redactText(d.fail_reason || "səbəb bilinmir", 80), { platform: "tiktok", platformCode: d.fail_reason || "FAILED" });
    return "waiting";
  }

  async commit() {
    return "done";
  }
}
