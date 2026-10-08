// Rəsmi TikTok API imkanlarının reyestri. Bu fayl sistemin "nəyi edə bilərəm" sualına YEGANƏ cavabdır.
// Qayda: burada olmayan və ya status-u SUPPORTED olmayan heç bir funksiya şəbəkəyə çıxmır (client.js bunu məcbur edir).
// Hər SUPPORTED qeyd rəsmi developers.tiktok.com səhifəsindən oxunub (source sahəsi). Yoxlama tarixi: 2026-10-08.

export const STATUS = Object.freeze({
  SUPPORTED: "SUPPORTED",
  // Rəsmi API var, amma TikTok-un məhdudiyyəti ilə (məs. audit olunmamış app yalnız SELF_ONLY paylaşa bilər)
  SUPPORTED_RESTRICTED: "SUPPORTED_RESTRICTED",
  UNSUPPORTED: "UNSUPPORTED_BY_TIKTOK_API",
});

export const API_BASE = "https://open.tiktokapis.com";
export const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const BUSINESS_DOCS = "https://business-api.tiktok.com/portal/docs";

const DOC = "https://developers.tiktok.com/doc/";

// Display API sahələri və tələb etdiyi scope (tiktok-api-v2-get-user-info)
export const USER_FIELDS = Object.freeze({
  open_id: "user.info.basic",
  union_id: "user.info.basic",
  avatar_url: "user.info.basic",
  display_name: "user.info.basic",
  bio_description: "user.info.profile",
  profile_deep_link: "user.info.profile",
  is_verified: "user.info.profile",
  username: "user.info.profile",
  follower_count: "user.info.stats",
  following_count: "user.info.stats",
  likes_count: "user.info.stats",
  video_count: "user.info.stats",
});

// Video Object sahələri (tiktok-api-v2-video-object). Saves/reach/retention BURADA YOXDUR.
export const VIDEO_FIELDS = Object.freeze([
  "id", "create_time", "cover_image_url", "share_url", "video_description", "duration",
  "height", "width", "title", "embed_html", "embed_link", "like_count", "comment_count", "share_count", "view_count",
]);

export const DEFAULT_SCOPES = Object.freeze(["user.info.basic", "user.info.profile", "user.info.stats", "video.list", "video.publish", "video.upload"]);

export const CAPABILITIES = Object.freeze({
  "oauth.authorize": {
    feature: "Hesabı qoşmaq (OAuth avtorizasiya linki)", api: "Login Kit",
    method: "GET", url: AUTHORIZE_URL, scope: null, account: "istənilən TikTok hesabı", token: "client_key",
    limits: "—", status: STATUS.SUPPORTED, source: DOC + "oauth-user-access-token-management",
  },
  "oauth.token": {
    feature: "Kodu tokenə dəyişmək / tokeni yeniləmək", api: "Login Kit",
    method: "POST", endpoint: "/v2/oauth/token/", contentType: "application/x-www-form-urlencoded", scope: null,
    account: "istənilən", token: "client_key + client_secret",
    limits: "access_token 24 saat (86400 s), refresh_token 365 gün; refresh zamanı yeni refresh_token gələ bilər",
    status: STATUS.SUPPORTED, source: DOC + "oauth-user-access-token-management",
  },
  "oauth.revoke": {
    feature: "Girişi ləğv etmək", api: "Login Kit",
    method: "POST", endpoint: "/v2/oauth/revoke/", contentType: "application/x-www-form-urlencoded", scope: null,
    account: "istənilən", token: "client_key + client_secret + access_token",
    limits: "—", status: STATUS.SUPPORTED, source: DOC + "oauth-user-access-token-management",
  },
  "user.info": {
    feature: "Profil, bio, follower/like/video sayı", api: "Display API",
    method: "GET", endpoint: "/v2/user/info/", scope: "user.info.basic | user.info.profile | user.info.stats (sahəyə görə)",
    account: "istənilən", token: "user access_token (Bearer)",
    limits: "600 sorğu/dəqiqə (sliding window), aşanda 429 rate_limit_exceeded",
    status: STATUS.SUPPORTED, source: DOC + "tiktok-api-v2-get-user-info",
  },
  "video.list": {
    feature: "Hesabın ictimai videoları + views/likes/comments/shares", api: "Display API",
    method: "POST", endpoint: "/v2/video/list/", scope: "video.list",
    account: "istənilən", token: "user access_token (Bearer)",
    limits: "max_count ≤ 20 hər səhifədə, cursor ilə səhifələmə; 600 sorğu/dəqiqə",
    status: STATUS.SUPPORTED, source: DOC + "tiktok-api-v2-video-list",
  },
  "video.query": {
    feature: "Konkret videoların məlumatını yeniləmək", api: "Display API",
    method: "POST", endpoint: "/v2/video/query/", scope: "video.list",
    account: "istənilən (video həmin istifadəçiyə məxsus olmalıdır)", token: "user access_token (Bearer)",
    limits: "bir sorğuda ≤ 20 video_id; 600 sorğu/dəqiqə",
    status: STATUS.SUPPORTED, source: DOC + "tiktok-api-v2-video-query",
  },
  "post.creator_info": {
    feature: "Paylaşımdan əvvəl creator məlumatı (privacy seçimləri, max müddət)", api: "Content Posting API",
    method: "POST", endpoint: "/v2/post/publish/creator_info/query/", scope: "video.publish",
    account: "istənilən", token: "user access_token (Bearer)", limits: "20 sorğu/dəqiqə/token",
    status: STATUS.SUPPORTED, source: DOC + "content-posting-api-reference-query-creator-info",
  },
  "post.video.direct": {
    feature: "Videonu birbaşa paylaşmaq (Direct Post)", api: "Content Posting API",
    method: "POST", endpoint: "/v2/post/publish/video/init/", scope: "video.publish",
    account: "istənilən; audit olunmamış app yalnız private hesab/SELF_ONLY", token: "user access_token (Bearer)",
    limits: "6 sorğu/dəqiqə/token; gündəlik paylaşım limiti (spam_risk_too_many_posts); upload_url 1 saat etibarlı; chunk 5–64 MB (son ≤128 MB), ≤1000 chunk, video ≤4 GB",
    status: STATUS.SUPPORTED_RESTRICTED,
    restriction: "Audit olunmamış app-in paylaşımları yalnız private (SELF_ONLY) olur. İctimai paylaşım üçün TikTok audit-i lazımdır.",
    source: DOC + "content-posting-api-reference-direct-post",
  },
  "post.video.inbox": {
    feature: "Videonu TikTok inbox-una göndərmək (istifadəçi tətbiqdə tamamlayır)", api: "Content Posting API",
    method: "POST", endpoint: "/v2/post/publish/inbox/video/init/", scope: "video.upload",
    account: "istənilən", token: "user access_token (Bearer)", limits: "6 sorğu/dəqiqə/token; upload_url 1 saat",
    status: STATUS.SUPPORTED, source: DOC + "content-posting-api-reference-upload-video",
  },
  "post.photo": {
    feature: "Foto karusel paylaşımı (≤35 şəkil, URL ilə)", api: "Content Posting API",
    method: "POST", endpoint: "/v2/post/publish/content/init/", scope: "video.publish və ya video.upload",
    account: "istənilən", token: "user access_token (Bearer)",
    limits: "6 sorğu/dəqiqə/token; şəkil URL-ləri verifikasiya olunmuş domendə olmalıdır",
    status: STATUS.SUPPORTED_RESTRICTED, restriction: "Verifikasiya olunmuş domen (URL ownership) lazımdır.",
    source: DOC + "content-posting-api-reference-photo-post",
  },
  "post.status": {
    feature: "Paylaşım statusunu izləmək", api: "Content Posting API",
    method: "POST", endpoint: "/v2/post/publish/status/fetch/", scope: "video.upload / video.publish",
    account: "istənilən", token: "user access_token (Bearer)", limits: "30 sorğu/dəqiqə/token",
    status: STATUS.SUPPORTED, source: DOC + "content-posting-api-reference-get-video-status",
  },

  // ---- Login Kit / Display / Content Posting API ilə MÜMKÜN OLMAYANLAR ----
  "comments.read": unsupported("Şərhləri oxumaq",
    "Display API şərh mətni vermir, yalnız comment_count. Research API yalnız akademik tədqiqatçılar üçündür.",
    "TikTok API for Business (Organic API) rəsmi sənədlərində Business hesabının öz videolarındakı şərhləri oxumaq üçün səhifə var ('Get comments on an owned video'). Ayrıca Business developer app, Business hesab və TikTok təsdiqi tələb edir; endpoint detalları bu mühitdən sənəd gövdəsi oxuna bilmədiyi üçün yoxlanmayıb və kodda YOXDUR."),
  "comments.reply": unsupported("Şərhə cavab göndərmək",
    "Login Kit / Content Posting API-də şərh yazmaq yoxdur.",
    "TikTok API for Business sənədlərində 'Reply to a comment' səhifəsi var (Business hesab + Business app). Kodda YOXDUR, yoxlanmayıb."),
  "dm.read": unsupported("DM oxumaq",
    "Login Kit / Display API DM vermir. Data Portability API (portability.directmessages.*) yalnız istifadəçinin öz məlumat ixracıdır, canlı inbox deyil.",
    "TikTok Business Messaging API rəsmi olaraq mövcuddur: yalnız uyğun (eligible) Business hesablar və TikTok təsdiqli app üçün, bazar/region məhdudiyyəti ilə. Kodda YOXDUR."),
  "dm.send": unsupported("DM göndərmək",
    "Login Kit / Display / Content Posting API DM göndərmir.",
    "Business Messaging API (yuxarıdakı kimi məhdud giriş). Kodda YOXDUR. Kütləvi/soyuq DM hər halda qadağandır."),
  "insights.saves": unsupported("Saves (favorites) sayı", "Video Object-də saves/favorites sahəsi yoxdur.", "Business API video insights (user.insights/video.insights scope) — yoxlanmayıb."),
  "insights.reach": unsupported("Reach / impressions", "Display API vermir.", "Business API insights — yoxlanmayıb."),
  "insights.retention": unsupported("Retention / izlənmə müddəti", "Display API vermir.", "Business API 'Video Insights reports' — yoxlanmayıb."),
  "insights.profile_views": unsupported("Profil baxışları", "Display API vermir.", "Business API profil insights — yoxlanmayıb."),
  "insights.audience": unsupported("Auditoriya demoqrafiyası (ölkə, yaş, cins)", "Display API vermir.", "Business API insights — yoxlanmayıb."),
  "insights.follower_history": unsupported("Follower artım tarixçəsi",
    "API yalnız cari follower_count verir. Sistem artımı öz snapshot-larından hesablayır (analytics.js).", null),
  "video.file": unsupported("Video faylını yükləyib görüntü/səs analizi",
    "Display API video faylı vermir; yalnız cover_image_url (6 saat TTL), share_url, embed. Görüntü/ilk 1–3 saniyə analizi üçün faylı istifadəçi özü verməlidir.", null),
  "trends.discover": unsupported("Trend hashtag/səs/mövzu kəşfi",
    "Rəsmi trend API-si yoxdur (Research API akademikdir). TikTok Creative Center veb-saytdır, API deyil: əl ilə yoxlanır.", null),
  "profile.update": unsupported("Bio/profil dəyişmək", "Rəsmi API-də profil yazma endpoint-i yoxdur.", null),
  "post.schedule": unsupported("Gələcək vaxta planlı paylaşım", "Content Posting API-də schedule parametri yoxdur. Sistem təsdiqli paketi saxlayır, icra əl ilə/cron ilə edilir.", null),
  "engagement.automation": unsupported("Avtomatik like/follow/unfollow/şərh",
    "Rəsmi API yoxdur və bu SİYASƏTLƏ QADAĞANDIR (fake engagement, spam).", null),
});

function unsupported(feature, reason, businessPath) {
  return { feature, api: "—", method: null, endpoint: null, scope: null, account: null, token: null, limits: null,
    status: STATUS.UNSUPPORTED, reason, business_api: businessPath, source: businessPath ? BUSINESS_DOCS : null };
}

export function capability(id) {
  const c = CAPABILITIES[id];
  if (!c) return { id, feature: id, status: STATUS.UNSUPPORTED, reason: "Reyestrdə yoxdur: uydurma API çağırışına icazə verilmir" };
  return { id, ...c };
}

export function isCallable(id) {
  const c = CAPABILITIES[id];
  return !!c && (c.status === STATUS.SUPPORTED || c.status === STATUS.SUPPORTED_RESTRICTED) && !!(c.endpoint || c.url);
}

export function listCapabilities() {
  return Object.keys(CAPABILITIES).map((id) => capability(id));
}

// Scope-dan asılı olaraq hansı user sahələrini istəmək olar
export function userFieldsFor(scopes) {
  const have = new Set(scopes || []);
  return Object.keys(USER_FIELDS).filter((f) => have.has(USER_FIELDS[f]));
}

export function capabilitiesMarkdown() {
  const rows = listCapabilities().map((c) => "| `" + c.id + "` | " + c.feature + " | " + (c.endpoint ? "`" + c.method + " " + c.endpoint + "`" : c.url ? "`" + c.method + " " + c.url + "`" : "—") +
    " | " + (c.scope || "—") + " | " + (c.limits || "—") + " | **" + c.status + "** |");
  return "| ID | Funksiya | Endpoint | Scope | Limit | Status |\n|---|---|---|---|---|---|\n" + rows.join("\n");
}
