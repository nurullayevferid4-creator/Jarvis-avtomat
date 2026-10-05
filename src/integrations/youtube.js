// YouTube (Data API v3) adapteri: kanal və video OXUMA. Yükləmə/idarəetmə (upload, update, delete) yalnız interfeysdir.
// OAuth2: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN (hamısı yalnız Cloudflare Secret).
// Access token hər çağırışda refresh token ilə alınır (yaddaşda saxlanmır, heç yerə yazılmır, cavabda yoxdur).
//
// Rəsmi sənəd yoxlaması (2026-10-05, developers.google.com, WebFetch xülasəsi; canlı hesabla sınanmayıb):
//  - Token yeniləmə: POST https://oauth2.googleapis.com/token, application/x-www-form-urlencoded,
//    client_id, client_secret, grant_type=refresh_token, refresh_token -> { access_token, expires_in, scope, token_type }.
//    (Veb-server səhifəsinin yeniləmə bölməsi alətə görünmədi; endpoint və parametrlər native-app və limited-input səhifələrindən təsdiqləndi.)
//  - GET https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true (1 kvota vahidi)
//  - GET .../youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=<uploads>&maxResults<=50&pageToken (1 vahid)
//  - GET .../youtube/v3/videos?part=...&id=<video id> (1 vahid; id sayının maksimumu sənəddə yazılmayıb: bir id istifadə olunur)
//  - Başlıq: "Authorization: Bearer <access_token>". Scope: youtube.readonly ("View your YouTube account"); metod üzrə ən az scope sənəddə birmənalı deyil.
//  - Standart kvota: gündə 10 000 vahid (search.list və videos.insert 2026-06-01-dən ayrı kovalardadır).
//  - "Testing" statuslu OAuth tətbiqində refresh token 7 gün sonra bitir: tətbiqi "In production" etmək lazımdır.
//  - YAZMA (videos.update, rəsmi sənəd 2026-10-05, WebFetch xülasəsi): PUT https://www.googleapis.com/youtube/v3/videos?part=snippet, gövdə {id, snippet{title, categoryId, ...}};
//    snippet yenilənəndə title və categoryId məcburidir və verilməyən dəyişdirilə bilən sahələr SİLİNİR. Ona görə əvvəl GET videos?part=snippet, sonra mövcud snippet ilə
//    birləşdirilmiş tam snippet göndərilir (title, description, tags, categoryId, defaultLanguage). Scope: youtube və ya youtube.force-ssl (readonly YETMİR: refresh token
//    yeni scope ilə yenidən alınmalıdır). Kvota: 50 vahid. YOXLANMAYIB: dəyişdirilə bilən snippet sahələrinin tam siyahısı (yuxarıdakı 5 sahə seçilib).
//  - Yükləmə (videos.insert, resumable) və silmə kodlaşdırılmayıb: Worker-də böyük bayt axını/mənbə faylı və yoxlanmamış layihədə private məhdudiyyəti.
//  - videos.insert: yoxlanmamış API layihələrində yüklənən videolar private olur (audit lazımdır). Bu əməliyyatlar alət kimi qeydə alınmır.

import { IntegrationAdapter, PAGE_INPUT, EMPTY_INPUT, idSchema, pick } from "./Integration.js";
import { IntegrationError } from "./errors.js";

export const YT_API = "https://www.googleapis.com/youtube/v3";
export const YT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{1,200}$/;
const PLAYLIST_RE = /^[A-Za-z0-9_-]{5,64}$/;

export const YOUTUBE_OPERATIONS = {
  "channel.get": { kind: "read", description: "Kanal məlumatı (ad, statistika)", input: EMPTY_INPUT },
  "videos.list": { kind: "read", description: "Kanalın yüklənmiş videoları", input: PAGE_INPUT },
  "video.get": { kind: "read", description: "Bir videonun məlumatı", input: { type: "object", properties: { video_id: idSchema }, required: ["video_id"], additionalProperties: false } },
  "video.upload": { kind: "write", description: "Video yükləmə (hazırlanmayıb)", input: { type: "object", properties: { title: { type: "string", maxLength: 100 } }, additionalProperties: false } },
  "video.update": { kind: "write", description: "Video redaktəsi: başlıq, təsvir, teqlər (mövcud snippet saxlanılır; kvota 50)", input: { type: "object", properties: { video_id: idSchema, title: { type: "string", minLength: 1, maxLength: 100 }, description: { type: "string", maxLength: 5000 }, tags: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 60 } } }, required: ["video_id"], additionalProperties: false } },
  "video.delete": { kind: "write", description: "Video silmə (hazırlanmayıb)", input: { type: "object", properties: { video_id: idSchema }, additionalProperties: false } },
};

async function accessToken({ env, call }) {
  const body = new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: env.YOUTUBE_REFRESH_TOKEN }).toString();
  const d = await call(YT_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!d || typeof d.access_token !== "string" || !d.access_token || d.token_type !== "Bearer") throw new Error("bad shape");
  return d.access_token;
}

function api(call, token, path, params) {
  const x = new URL(YT_API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") x.searchParams.set(k, String(v));
  return call(x.toString(), { headers: { authorization: "Bearer " + token } });
}

const stats = (s) => pick(s, ["viewCount", "subscriberCount", "hiddenSubscriberCount", "videoCount", "likeCount", "commentCount"], 30);

const ENDPOINTS = {
  "channel.get": {
    verified: true,
    async exec({ env, call }) {
      const t = await accessToken({ env, call });
      const d = await api(call, t, "/channels", { part: "snippet,statistics,contentDetails", mine: "true" });
      const c = d && Array.isArray(d.items) ? d.items[0] : null;
      if (!c) throw new Error("no channel");
      return { id: String(c.id || "").slice(0, 64), title: String((c.snippet && c.snippet.title) || "").slice(0, 200), statistics: stats(c.statistics) };
    },
  },
  "videos.list": {
    verified: true,
    async exec({ input, env, call }) {
      const t = await accessToken({ env, call });
      const ch = await api(call, t, "/channels", { part: "contentDetails", mine: "true" });
      const uploads = ch && ch.items && ch.items[0] && ch.items[0].contentDetails && ch.items[0].contentDetails.relatedPlaylists && ch.items[0].contentDetails.relatedPlaylists.uploads;
      if (typeof uploads !== "string" || !PLAYLIST_RE.test(uploads)) throw new Error("no uploads");
      const d = await api(call, t, "/playlistItems", { part: "snippet,contentDetails", playlistId: uploads, maxResults: input.limit || 10, pageToken: input.after });
      if (!d || !Array.isArray(d.items)) throw new Error("bad shape");
      const items = d.items.slice(0, 50).map((it) => ({
        video_id: String((it.contentDetails && it.contentDetails.videoId) || "").slice(0, 30),
        title: String((it.snippet && it.snippet.title) || "").slice(0, 300),
        published_at: String((it.contentDetails && it.contentDetails.videoPublishedAt) || (it.snippet && it.snippet.publishedAt) || "").slice(0, 40),
      }));
      return { items, next: typeof d.nextPageToken === "string" ? d.nextPageToken.slice(0, 200) : null };
    },
  },
  "video.get": {
    verified: true,
    async exec({ input, env, call }) {
      const t = await accessToken({ env, call });
      const d = await api(call, t, "/videos", { part: "snippet,statistics,contentDetails", id: input.video_id });
      const v = d && Array.isArray(d.items) ? d.items[0] : null;
      if (!v) throw new Error("no video");
      return { id: String(v.id || "").slice(0, 30), title: String((v.snippet && v.snippet.title) || "").slice(0, 300), published_at: String((v.snippet && v.snippet.publishedAt) || "").slice(0, 40), duration: String((v.contentDetails && v.contentDetails.duration) || "").slice(0, 30), statistics: stats(v.statistics) };
    },
  },
  "video.update": {
    verified: true,
    async exec({ input, env, call }) {
      const t = await accessToken({ env, call });
      const cur = await api(call, t, "/videos", { part: "snippet", id: input.video_id });
      const sn = cur && Array.isArray(cur.items) && cur.items[0] && cur.items[0].snippet;
      if (!sn || typeof sn.title !== "string" || typeof sn.categoryId !== "string") throw new Error("no snippet");
      const tags = input.tags !== undefined ? input.tags : Array.isArray(sn.tags) ? sn.tags : undefined;
      const next = {
        title: input.title !== undefined ? input.title : sn.title,
        description: input.description !== undefined ? input.description : typeof sn.description === "string" ? sn.description : "",
        categoryId: sn.categoryId,
        ...(tags !== undefined ? { tags } : {}),
        ...(typeof sn.defaultLanguage === "string" ? { defaultLanguage: sn.defaultLanguage } : {}),
      };
      const d = await call(YT_API + "/videos?part=snippet", { method: "PUT", headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: JSON.stringify({ id: input.video_id, snippet: next }) });
      if (!d || typeof d !== "object" || d.error || typeof d.id !== "string") throw new Error("bad shape");
      return { updated: true, id: d.id.slice(0, 30), title: String((d.snippet && d.snippet.title) || next.title).slice(0, 300) };
    },
  },
};

export class YouTubeAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "youtube", label: "YouTube (oxuma + təsdiqli video redaktəsi)", operations: YOUTUBE_OPERATIONS, endpoints: ENDPOINTS, allowedHosts: ["www.googleapis.com", "oauth2.googleapis.com"], ...opts });
  }
  _precheck(op, input, ctx) {
    if (op === "video.update") {
      if (!VIDEO_ID_RE.test(input.video_id)) throw new IntegrationError("invalid_input", "video id düzgün deyil", ctx);
      if (input.title === undefined && input.description === undefined && input.tags === undefined) throw new IntegrationError("invalid_input", "heç bir dəyişiklik verilməyib", ctx);
    }
    if (op === "video.get" && !VIDEO_ID_RE.test(input.video_id)) throw new IntegrationError("invalid_input", "video id düzgün deyil", ctx);
    if (op === "videos.list" && input.after !== undefined && !TOKEN_RE.test(input.after)) throw new IntegrationError("invalid_input", "after düzgün deyil", ctx);
  }
  get mockHandlers() {
    return {
      "channel.get": () => ({ id: "mock_channel_1", title: "mock kanal", statistics: { videoCount: "1" } }),
      "videos.list": (i) => ({ items: [{ video_id: "mock_yt_1", title: "mock video" }].slice(0, i.limit || 25), next: null }),
      "video.get": (i) => ({ id: i.video_id, title: "mock video" }),
      "video.update": (i) => ({ updated: true, id: i.video_id, title: i.title || "mock video" }),
    };
  }
}
