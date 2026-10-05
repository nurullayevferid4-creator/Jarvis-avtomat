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
//  - Paylaşım: POST /v2/post/publish/video/init/ (scope video.publish), draft: /v2/post/publish/inbox/video/init/ (video.upload).
//    Audit olunmamış client yalnız SELF_ONLY paylaşa bilər. Bu əməliyyatlar yoxlanmayıb və alət kimi qeydə alınmır.

import { IntegrationAdapter, PAGE_INPUT, pick } from "./Integration.js";
import { IntegrationError } from "./errors.js";

export const TT_BASE = "https://open.tiktokapis.com";
const CURSOR_RE = /^\d{1,16}$/;
const VIDEO_ID_RE = /^\d{1,30}$/;
const VIDEO_FIELDS = "id,title,video_description,create_time,cover_image_url,share_url,duration,like_count,comment_count,share_count,view_count";

export const TIKTOK_OPERATIONS = {
  "account.get": { kind: "read", description: "Hesab məlumatı (profil və statistika əlavə scope tələb edir)", input: { type: "object", properties: { include_profile: { type: "boolean" }, include_stats: { type: "boolean" } }, additionalProperties: false } },
  "videos.list": { kind: "read", description: "Videoların siyahısı (ictimai)", input: PAGE_INPUT },
  "videos.get": { kind: "read", description: "Seçilmiş videoların məlumatı (max 20 id)", input: { type: "object", properties: { video_ids: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 30 } } }, required: ["video_ids"], additionalProperties: false } },
  "video.publish": { kind: "write", description: "Video paylaşımı (hazırlanmayıb)", input: { type: "object", properties: { title: { type: "string", maxLength: 150 } }, additionalProperties: false } },
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
};

export class TikTokAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "tiktok", label: "TikTok (yalnız oxuma)", operations: TIKTOK_OPERATIONS, endpoints: ENDPOINTS, allowedHosts: ["open.tiktokapis.com"], ...opts });
  }
  _precheck(op, input, ctx) {
    if (op === "videos.list" && input.after !== undefined && !CURSOR_RE.test(input.after)) throw new IntegrationError("invalid_input", "after rəqəm olmalıdır", ctx);
    if (op === "videos.get" && !input.video_ids.every((v) => VIDEO_ID_RE.test(v))) throw new IntegrationError("invalid_input", "video id yalnız rəqəmlərdən ibarət olmalıdır", ctx);
  }
  get mockHandlers() {
    return {
      "account.get": () => ({ open_id: "mock_tt_1", display_name: "mock_tiktok" }),
      "videos.list": (i) => ({ items: [{ id: "mock_video_1", title: "mock video", view_count: 0 }].slice(0, i.limit || 20), next: null }),
      "videos.get": (i) => ({ items: i.video_ids.map((id) => ({ id, title: "mock video" })) }),
    };
  }
}
