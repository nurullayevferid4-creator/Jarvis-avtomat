// TikTok (Display API v2) adapteri: hesab və video məlumatı OXUMA. Paylaşım (Content Posting API) yalnız gələcək təməldir.
// Secret adı: TIKTOK_ACCESS_TOKEN (yalnız Cloudflare Secret).
//
// Rəsmi sənəd yoxlaması (2026-10-05, developers.tiktok.com, WebFetch xülasəsi; canlı hesabla sınanmayıb):
//  - GET  https://open.tiktokapis.com/v2/user/info/?fields=...   (Bearer). user.info.basic: open_id, union_id, avatar_url, display_name.
//    Profil sahələri (bio_description, is_verified, username...) user.info.profile, statistika (follower_count, likes_count, video_count...) user.info.stats scope tələb edir
//    (köhnə scope ilə "scope_not_authorized", 401). Bu scope-ların ayrıca təsdiq tələb edib-etmədiyi sənəddə birmənalı deyil.
//  - POST https://open.tiktokapis.com/v2/video/list/?fields=...  body {cursor?, max_count<=20}, scope video.list, yalnız ictimai videolar.
//  - POST https://open.tiktokapis.com/v2/video/query/?fields=...  body {"filters":{"video_ids":[<=20]}}, scope video.list.
//  - Access token 24 saat, refresh token 365 gün. Refresh token DƏYİŞƏ bilər ("yeni qaytarılanı istifadə et"); bu mərhələdə yenilənmə kodlaşdırılmayıb:
//    token bitəndə 401 (access_token_invalid) alınır və yeni TIKTOK_ACCESS_TOKEN lazımdır.
//  - Limit: hər endpoint üçün 600 sorğu/dəq (sürüşkən pəncərə).
//  - Tətbiq (app) təsdiqi olmadan API-yə çıxış yoxdur (Login Kit + Display API, demo video, Privacy/ToS səhifələri, bir neçə gündən 2 həftəyə).
//  - Token yeniləmə (rəsmi sənəd, oauth-user-access-token-management, 2026-10-05): POST https://open.tiktokapis.com/v2/oauth/token/ (application/x-www-form-urlencoded:
//    client_key, client_secret, grant_type=refresh_token, refresh_token) -> access_token, expires_in, refresh_token, refresh_expires_in, scope. "Qaytarılan refresh_token
//    fərqli ola bilər, yenisini istifadə et": Worker Secret-i dəyişə bilmir və token saxlamaq (KV) qadağandır, ona görə rotasiya olarsa nəticədə 'refresh_token_rotated'
//    xəbərdarlığı verilir və növbəti sorğuda köhnə token keçməyə bilər (istifadəçi yeni refresh token-i Secret-ə yazmalıdır; ona yeni dəyər göstərilmir).
//  - Paylaşım (Direct Post): POST /v2/post/publish/video/init/ (scope video.publish; Bearer; application/json; charset=UTF-8):
//    post_info{privacy_level (məcburi: PUBLIC_TO_EVERYONE|MUTUAL_FOLLOW_FRIENDS|FOLLOWER_OF_CREATOR|SELF_ONLY; "creator info sorğusundakı seçimlərə uyğun olmalıdır"), title ≤2200,
//    disable_duet/stitch/comment}, source_info{source:"PULL_FROM_URL", video_url} -> data.publish_id. PULL_FROM_URL üçün URL prefiks/domen sahibliyi TikTok-da təsdiqlənməlidir.
//    Audit olunmamış tətbiq: bütün paylaşımlar yalnız özünə (SELF_ONLY) görünür. Limit: istifadəçi tokeni üçün 6 sorğu/dəq.
//    Status: POST /v2/post/publish/status/fetch/ {publish_id} -> PROCESSING_DOWNLOAD|PUBLISH_COMPLETE|FAILED|... (30/dəq).
//    YOXLANMAYIB: creator_info sorğusu (privacy_level yoxlaması); FILE_UPLOAD (parçalı yükləmə) kodlaşdırılmayıb.
//  - Qaralama (inbox) yolu: /v2/post/publish/inbox/video/init/ (video.upload) yoxlanmayıb.
//    Audit olunmamış client yalnız SELF_ONLY paylaşa bilər. Bu əməliyyatlar yoxlanmayıb və alət kimi qeydə alınmır.

import { IntegrationAdapter, PAGE_INPUT, pick } from "./Integration.js";
import { IntegrationError } from "./errors.js";
import { assertSafeUrl } from "../security/ssrf.js";

export const TT_BASE = "https://open.tiktokapis.com";
const CURSOR_RE = /^\d{1,16}$/;
const VIDEO_ID_RE = /^\d{1,30}$/;
const VIDEO_FIELDS = "id,title,video_description,create_time,cover_image_url,share_url,duration,like_count,comment_count,share_count,view_count";

export const TIKTOK_OPERATIONS = {
  "account.get": { kind: "read", description: "Hesab məlumatı (profil və statistika əlavə scope tələb edir)", input: { type: "object", properties: { include_profile: { type: "boolean" }, include_stats: { type: "boolean" } }, additionalProperties: false } },
  "videos.list": { kind: "read", description: "Videoların siyahısı (ictimai)", input: PAGE_INPUT },
  "videos.get": { kind: "read", description: "Seçilmiş videoların məlumatı (max 20 id)", input: { type: "object", properties: { video_ids: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 30 } } }, required: ["video_ids"], additionalProperties: false } },
  "post.status": { kind: "read", description: "Paylaşımın vəziyyəti (publish_id ilə)", input: { type: "object", properties: { publish_id: { type: "string", minLength: 1, maxLength: 64 } }, required: ["publish_id"], additionalProperties: false } },
  "video.publish": { kind: "write", description: "Video paylaşımı (PULL_FROM_URL: sənin təsdiqlənmiş domenindəki https video ünvanı). Audit olunmamış tətbiqdə yalnız özünə görünür", input: { type: "object", properties: { video_url: { type: "string", minLength: 12, maxLength: 1000 }, title: { type: "string", maxLength: 2200 }, privacy_level: { type: "string", enum: ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"] }, disable_comment: { type: "boolean" }, disable_duet: { type: "boolean" }, disable_stitch: { type: "boolean" } }, required: ["video_url", "privacy_level"], additionalProperties: false } },
};

const headers = (env, json = false) => ({ authorization: "Bearer " + env.TIKTOK_ACCESS_TOKEN, ...(json ? { "content-type": "application/json" } : {}) });

function okBody(d) {
  if (!d || typeof d !== "object" || !d.error || d.error.code !== "ok") throw new Error("bad shape");
  return d.data || {};
}

const video = (v) => pick(v, ["id", "title", "video_description", "create_time", "cover_image_url", "share_url", "duration", "like_count", "comment_count", "share_count", "view_count"], 500);

const ENDPOINTS = {
  "account.get": {
    verified: true,
    build: (i, env) => {
      const f = ["open_id", "union_id", "avatar_url", "display_name"];
      if (i.include_profile) f.push("bio_description", "is_verified", "username", "profile_deep_link");
      if (i.include_stats) f.push("follower_count", "following_count", "likes_count", "video_count");
      return { url: TT_BASE + "/v2/user/info/?fields=" + f.join(","), headers: headers(env) };
    },
    parse: (d) => pick(okBody(d).user, ["open_id", "union_id", "avatar_url", "display_name", "bio_description", "is_verified", "username", "profile_deep_link", "follower_count", "following_count", "likes_count", "video_count"], 500),
  },
  "videos.list": {
    verified: true,
    build: (i, env) => ({
      url: TT_BASE + "/v2/video/list/?fields=" + VIDEO_FIELDS,
      method: "POST",
      headers: headers(env, true),
      body: JSON.stringify({ max_count: Math.min(i.limit || 10, 20), ...(i.after ? { cursor: Number(i.after) } : {}) }),
    }),
    parse: (d) => {
      const x = okBody(d);
      if (!Array.isArray(x.videos)) throw new Error("bad shape");
      return { items: x.videos.slice(0, 20).map(video), next: x.has_more === true && x.cursor !== undefined ? String(x.cursor) : null };
    },
  },
  "videos.get": {
    verified: true,
    build: (i, env) => ({ url: TT_BASE + "/v2/video/query/?fields=" + VIDEO_FIELDS, method: "POST", headers: headers(env, true), body: JSON.stringify({ filters: { video_ids: i.video_ids } }) }),
    parse: (d) => {
      const x = okBody(d);
      if (!Array.isArray(x.videos)) throw new Error("bad shape");
      return { items: x.videos.slice(0, 20).map(video) };
    },
  },
  "post.status": {
    verified: true,
    build: (i, env) => ({ url: TT_BASE + "/v2/post/publish/status/fetch/", method: "POST", headers: headers(env, true), body: JSON.stringify({ publish_id: i.publish_id }) }),
    parse: (d) => {
      const x = okBody(d);
      return pick(x, ["status", "fail_reason"], 200);
    },
  },
  "video.publish": {
    verified: true,
    build: (i, env) => ({
      url: TT_BASE + "/v2/post/publish/video/init/",
      method: "POST",
      headers: { ...headers(env, true), "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: { privacy_level: i.privacy_level, ...(i.title ? { title: i.title } : {}), ...(i.disable_comment !== undefined ? { disable_comment: i.disable_comment } : {}), ...(i.disable_duet !== undefined ? { disable_duet: i.disable_duet } : {}), ...(i.disable_stitch !== undefined ? { disable_stitch: i.disable_stitch } : {}) },
        source_info: { source: "PULL_FROM_URL", video_url: i.video_url },
      }),
    }),
    parse: (d) => ({ submitted: true, publish_id: String(okBody(d).publish_id || "").slice(0, 64) || null }),
  },
};

const present = (v) => typeof v === "string" && v.trim().length >= 8;
const REFRESH_OK = (e) => present(e.TIKTOK_REFRESH_TOKEN) && present(e.TIKTOK_CLIENT_KEY) && present(e.TIKTOK_CLIENT_SECRET);

export class TikTokAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "tiktok", label: "TikTok (oxuma + təsdiqli paylaşım)", operations: TIKTOK_OPERATIONS, endpoints: ENDPOINTS, allowedHosts: ["open.tiktokapis.com"], ...opts });
  }
  // Ya TIKTOK_ACCESS_TOKEN, ya da (TIKTOK_REFRESH_TOKEN + TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET) lazımdır.
  _missing() {
    const e = this._env;
    if (present(e.TIKTOK_ACCESS_TOKEN) || REFRESH_OK(e)) return [];
    return ["TIKTOK_ACCESS_TOKEN"];
  }
  // Yeniləmə credential-ları varsa hər çağırışda təzə (24 saatlıq) access token alınır; yaddaşda saxlanmır.
  async _resolveEnv(ctx) {
    const e = this._env;
    if (!REFRESH_OK(e)) return e;
    const body = new URLSearchParams({ client_key: e.TIKTOK_CLIENT_KEY, client_secret: e.TIKTOK_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: e.TIKTOK_REFRESH_TOKEN }).toString();
    const res = await this._call(TT_BASE + "/v2/oauth/token/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }, ctx);
    const d = res.data;
    if (!d || typeof d.access_token !== "string" || !d.access_token || d.error) throw new IntegrationError("upstream_error", "token yeniləmə cavabı gözlənilən formada deyil", ctx);
    this._rotated = typeof d.refresh_token === "string" && d.refresh_token !== e.TIKTOK_REFRESH_TOKEN;
    return { ...e, TIKTOK_ACCESS_TOKEN: d.access_token };
  }
  async _send(op, spec, input, ctx) {
    this._rotated = false;
    const r = await super._send(op, spec, input, ctx);
    return this._rotated ? { ...r, warning: "refresh_token_rotated" } : r;
  }
  _precheck(op, input, ctx) {
    if (op === "videos.list" && input.after !== undefined && !CURSOR_RE.test(input.after)) throw new IntegrationError("invalid_input", "after rəqəm olmalıdır", ctx);
    if (op === "videos.get" && !input.video_ids.every((v) => VIDEO_ID_RE.test(v))) throw new IntegrationError("invalid_input", "video id yalnız rəqəmlərdən ibarət olmalıdır", ctx);
    if (op === "post.status" && !/^[A-Za-z0-9._~-]{1,64}$/.test(input.publish_id)) throw new IntegrationError("invalid_input", "publish_id düzgün deyil", ctx);
    if (op === "video.publish") {
      try { assertSafeUrl(input.video_url); } catch (e) { throw new IntegrationError("invalid_input", "video_url ictimai https ünvan olmalıdır", ctx); }
    }
  }
  get mockHandlers() {
    return {
      "account.get": () => ({ open_id: "mock_tt_1", display_name: "mock_tiktok" }),
      "videos.list": (i) => ({ items: [{ id: "mock_video_1", title: "mock video", view_count: 0 }].slice(0, i.limit || 20), next: null }),
      "videos.get": (i) => ({ items: i.video_ids.map((id) => ({ id, title: "mock video" })) }),
      "post.status": () => ({ status: "PUBLISH_COMPLETE" }),
      "video.publish": () => ({ submitted: true, publish_id: "mock_publish_1" }),
    };
  }
}
