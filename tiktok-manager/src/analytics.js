// Performans analizi YALNIZ rəsmi API-dən gələn real sahələrlə: view/like/comment/share/duration/create_time/title/description.
// Saves, reach, retention, profil baxışı, demoqrafiya Display API-də yoxdur → "unavailable" kimi qaytarılır, təxmin edilmir.

export const UNAVAILABLE_METRICS = Object.freeze({
  saves: "UNSUPPORTED_BY_TIKTOK_API (Display API saves vermir)",
  reach: "UNSUPPORTED_BY_TIKTOK_API",
  impressions: "UNSUPPORTED_BY_TIKTOK_API",
  retention: "UNSUPPORTED_BY_TIKTOK_API",
  watch_time: "UNSUPPORTED_BY_TIKTOK_API",
  profile_visits: "UNSUPPORTED_BY_TIKTOK_API",
  audience_demographics: "UNSUPPORTED_BY_TIKTOK_API",
  traffic_sources: "UNSUPPORTED_BY_TIKTOK_API",
});

export const MIN_SAMPLE = 3;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
export function median(arr) {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const round = (x, d = 4) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

const CTA_RE = /(link|bio|dm|direct|yaz|sifariş|order|şərh|comment|follow|izlə|abunə|sual|zəng|whatsapp|səbət|al\b|buy|shop)/i;
export function hookOf(v) {
  const t = String(v.title || v.video_description || "").replace(/#[^\s#]+/g, "").trim();
  if (!t) return "";
  const first = t.split(/(?<=[.!?…])\s|\n/)[0];
  return first.slice(0, 120).trim();
}
export function hashtagsOf(v) {
  const t = String(v.video_description || "") + " " + String(v.title || "");
  return [...new Set((t.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.toLowerCase()))];
}
export function hookPattern(h) {
  const s = String(h || "").toLowerCase();
  if (!s) return "hook_yoxdur";
  if (/\?$|^(niyə|necə|nə|kim|hansı|why|how|what|which|почему|как)/.test(s)) return "sual";
  if (/^\d+|\b\d+\s*(səbəb|addım|yol|səhv|tips|ways|reasons|mistakes)/.test(s)) return "rəqəm/siyahı";
  if (/^pov\b/.test(s)) return "pov";
  if (/(səhv|yanlış|etmə|mistake|don't|stop|never|heç vaxt)/.test(s)) return "səhv/xəbərdarlıq";
  if (/(sirr|gizli|secret|bilmirdin|didn't know)/.test(s)) return "maraq/sirr";
  if (/^(sən|siz|you)\b/.test(s)) return "birbaşa müraciət";
  return "bəyanat";
}
export function durationBucket(sec) {
  const d = num(sec);
  if (d == null) return "naməlum";
  if (d < 15) return "<15s";
  if (d < 30) return "15–30s";
  if (d < 60) return "30–60s";
  if (d < 180) return "1–3dəq";
  return "3dəq+";
}

export function normalizeVideo(v) {
  const views = num(v.view_count), likes = num(v.like_count), comments = num(v.comment_count), shares = num(v.share_count);
  const eng = [likes, comments, shares].every((x) => x != null) ? likes + comments + shares : null;
  const created = num(v.create_time) ? new Date(num(v.create_time) * 1000) : null;
  const hook = hookOf(v);
  return {
    id: String(v.id), created_at: created ? created.toISOString() : null,
    weekday_utc: created ? created.getUTCDay() : null, hour_utc: created ? created.getUTCHours() : null,
    duration: num(v.duration), duration_bucket: durationBucket(v.duration),
    views, likes, comments, shares,
    engagement_rate: views && eng != null ? round(eng / views) : null,
    share_rate: views && shares != null ? round(shares / views) : null,
    comment_rate: views && comments != null ? round(comments / views) : null,
    hook, hook_pattern: hookPattern(hook), has_cta: CTA_RE.test(String(v.video_description || v.title || "")),
    hashtags: hashtagsOf(v), share_url: v.share_url || null, cover_image_url: v.cover_image_url || null,
  };
}

function groupStats(items, keyFn) {
  const g = {};
  for (const it of items) for (const k of [].concat(keyFn(it))) (g[k] = g[k] || []).push(it);
  return Object.entries(g).map(([key, arr]) => ({
    key, n: arr.length, median_views: median(arr.map((x) => x.views)), median_er: round(median(arr.map((x) => x.engagement_rate))),
    reliable: arr.length >= MIN_SAMPLE,
  })).sort((a, b) => (b.median_views || 0) - (a.median_views || 0));
}

export function analyzeVideos(raw) {
  const vids = (raw || []).map(normalizeVideo).filter((v) => v.views != null);
  if (!vids.length) return { n: 0, status: "no_data", note: "API-dən heç bir video məlumatı gəlmədi: nəticə çıxarılmır.", unavailable: UNAVAILABLE_METRICS };
  const byViews = [...vids].sort((a, b) => b.views - a.views);
  const medViews = median(vids.map((v) => v.views));
  const k = Math.max(1, Math.min(5, Math.floor(vids.length / 4) || 1));
  const top = byViews.slice(0, k), bottom = byViews.slice(-k).reverse();
  const groups = {
    hook_pattern: groupStats(vids, (v) => v.hook_pattern),
    duration: groupStats(vids, (v) => v.duration_bucket),
    cta: groupStats(vids, (v) => (v.has_cta ? "CTA var" : "CTA yox")),
    hashtags: groupStats(vids, (v) => (v.hashtags.length ? v.hashtags : ["(hashtag yox)"])).filter((g) => g.n >= 2),
    weekday_utc: groupStats(vids.filter((v) => v.weekday_utc != null), (v) => String(v.weekday_utc)),
  };
  return {
    n: vids.length, status: vids.length >= 10 ? "ok" : "limited_sample",
    totals: { views: sum(vids, "views"), likes: sum(vids, "likes"), comments: sum(vids, "comments"), shares: sum(vids, "shares") },
    median_views: medViews, median_engagement_rate: round(median(vids.map((v) => v.engagement_rate))),
    top, bottom, groups, why_top_worked: explain(top, vids),
    unavailable: UNAVAILABLE_METRICS,
    caveat: "Nəticələr korrelyasiyadır, səbəb deyil. Az nümunəli qruplar (reliable:false) qərar üçün kifayət deyil. Saat/gün UTC-dədir.",
    videos: vids,
  };
}

const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);

// Top videoların ümumi xüsusiyyətləri: yalnız müşahidə olunan sahələrdən
function explain(top, all) {
  const out = [];
  const share = (arr, f) => arr.filter(f).length / arr.length;
  const feats = [
    ["CTA var", (v) => v.has_cta],
    ["hook sualdır", (v) => v.hook_pattern === "sual"],
    ["hook rəqəm/siyahıdır", (v) => v.hook_pattern === "rəqəm/siyahı"],
    ["30 saniyədən qısa", (v) => v.duration != null && v.duration < 30],
    ["60 saniyədən uzun", (v) => v.duration != null && v.duration >= 60],
  ];
  for (const [name, f] of feats) {
    const a = share(top, f), b = share(all, f);
    if (top.length >= 2 && a - b >= 0.25) out.push({ observation: "Top videoların " + Math.round(a * 100) + "%-i: " + name + " (bütün videolarda " + Math.round(b * 100) + "%)", type: "korrelyasiya" });
  }
  const medShare = median(all.map((v) => v.share_rate));
  const topShare = median(top.map((v) => v.share_rate));
  if (medShare != null && topShare != null && topShare > medShare * 1.5) out.push({ observation: "Top videolarda paylaşım nisbəti medianın " + round(topShare / (medShare || 1), 2) + " qatıdır: paylaşmağa dəyər məzmun", type: "korrelyasiya" });
  if (!out.length) out.push({ observation: "Top və orta videolar arasında müşahidə olunan sahələrdə aydın fərq yoxdur (və ya nümunə azdır).", type: "məlumat çatmır" });
  return out;
}

// Follower artımı: API tarixçə vermir, sistem öz snapshot-larından hesablayır.
export function followerGrowth(snapshots) {
  const s = (snapshots || []).filter((x) => num(x.follower_count) != null).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (s.length < 2) return { status: "insufficient_snapshots", note: "Artımı hesablamaq üçün ən azı 2 snapshot lazımdır (analiz müxtəlif günlərdə işə salınmalıdır).", snapshots: s.length };
  const a = s[0], b = s[s.length - 1];
  const days = Math.max((Date.parse(b.at) - Date.parse(a.at)) / 86400000, 1 / 24);
  const delta = b.follower_count - a.follower_count;
  return { status: "ok", from: a.at, to: b.at, start: a.follower_count, end: b.follower_count, delta, per_day: round(delta / days, 2), snapshots: s.length };
}

// Paylaşılmış videonun nəticəsi: real metrik snapshot-ları; təsdiq olunmamış nəticə yazılmır.
export function compareToBaseline(video, baseline) {
  const v = normalizeVideo(video);
  if (!baseline || baseline.median_views == null) return { video: v, verdict: "baseline_yoxdur" };
  const ratio = baseline.median_views ? v.views / baseline.median_views : null;
  return { video: v, views_vs_median: round(ratio, 2), verdict: ratio == null ? "naməlum" : ratio >= 1.5 ? "median-dan yaxşı" : ratio <= 0.5 ? "median-dan zəif" : "median səviyyəsində" };
}
