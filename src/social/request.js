// Vahid social.publish sorğusunu yoxlayır və normallaşdırır.
// Heç bir şəbəkə çağırışı etmir. Real paylaşım yalnız təsdiqdən sonra flow.js-də olur.

import { assertSafeUrl } from "../security/ssrf.js";
import { PLATFORMS, PLATFORM_INFO, PRIVACY_LEVELS } from "./platforms.js";
import { SocialError } from "./errors.js";

export const MAX_CAPTION = 2200;
export const MAX_DESCRIPTION = 1000;
export const MAX_TITLE = 100;
export const MEDIA_ID_RE = /^[0-9a-f]{24}$/;
const TAG_RE = /^[\p{L}\p{N}_]{1,60}$/u;

export function normalizeHashtags(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const t = String(raw || "").trim().replace(/^#+/, "");
    if (!t || !TAG_RE.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// Başlıq + hashtag-lar. Platformanın uzunluq limitini aşmır (hashtag-lar kəsilir, mətn yox).
export function composeCaption(platform, caption, hashtags) {
  const info = PLATFORM_INFO[platform];
  const base = String(caption || "").trim();
  const max = info.maxCaption;
  const tags = normalizeHashtags(hashtags).slice(0, info.maxHashtags).map((t) => "#" + t);
  let text = base;
  for (const t of tags) {
    const next = text ? text + (text.includes("\n\n#") || /\s#\S+$/.test(text) ? " " : "\n\n") + t : t;
    if (next.length > max) break;
    text = next;
  }
  return text.slice(0, max);
}

function platformList(input) {
  let list = [];
  if (Array.isArray(input.platforms)) list = input.platforms;
  else if (typeof input.platform === "string") list = [input.platform];
  const out = [];
  for (const p of list) {
    const v = String(p || "").toLowerCase();
    if (!PLATFORMS.includes(v)) throw new SocialError("invalid_request", "naməlum platforma: " + v.slice(0, 20));
    if (!out.includes(v)) out.push(v);
  }
  if (!out.length) throw new SocialError("invalid_request", "ən azı bir platforma lazımdır");
  return out;
}

// Normallaşmış sorğunun icra üçün hazır olub-olmadığını yoxlayır (şəbəkəsiz). Boş massiv = hazırdır.
export function readinessIssues(req) {
  const errors = [];
  if (!req || !Array.isArray(req.platforms) || !req.platforms.length) return ["platforma yoxdur"];
  for (const p of req.platforms) {
    const info = PLATFORM_INFO[p];
    if (!info) {
      errors.push("naməlum platforma");
      continue;
    }
    const media = req.media;
    if (p !== "telegram" && !media) errors.push(info.label + ": media lazımdır");
    if (media && !info.kinds.includes(media.type)) errors.push(info.label + ": " + media.type + " dəstəklənmir");
    if (media && (p === "tiktok" || p === "youtube") && !media.id) errors.push(info.label + ": JARVIS-a yüklənmiş media (media_id) lazımdır");
    if (media && p === "instagram" && !media.url && !media.id) errors.push("Instagram: media ünvanı lazımdır");
    if (p === "youtube" && !(req.title || req.caption)) errors.push("YouTube: başlıq lazımdır");
    if (!req.caption) errors.push("caption boşdur");
  }
  return errors;
}

// Qaytarır: { platforms, caption, title, description, hashtags, media, privacy, made_for_kids }
// media: null | { id? , url?, type: "image"|"video" }
export function normalizePublishRequest(input, { strict = true, now = null } = {}) {
  if (!input || typeof input !== "object") throw new SocialError("invalid_request", "sorğu boşdur");
  const platforms = platformList(input);
  const caption = String(input.caption || "").trim();
  if (!caption) throw new SocialError("invalid_request", "caption boş ola bilməz");
  // Təsdiq qeydində hər şey görünməlidir: limitdən uzun mətn qəbul edilmir (səssiz kəsilmir).
  if (caption.length > MAX_CAPTION) throw new SocialError("invalid_request", "caption " + MAX_CAPTION + " simvoldan uzundur");
  if (input.description && String(input.description).trim().length > MAX_DESCRIPTION) throw new SocialError("invalid_request", "description " + MAX_DESCRIPTION + " simvoldan uzundur");
  if (input.title && String(input.title).trim().length > MAX_TITLE) throw new SocialError("invalid_request", "title " + MAX_TITLE + " simvoldan uzundur");
  const hashtags = normalizeHashtags(input.hashtags);

  const privacy = input.privacy === undefined ? "private" : String(input.privacy);
  if (!PRIVACY_LEVELS.includes(privacy)) throw new SocialError("invalid_request", "privacy: private, unlisted və ya public");

  // Planlaşdırılmış paylaşım (ixtiyari). Təsdiq xülasəsində və hash-də görünür; təsdiq planlaşdırılmış vaxta aiddir.
  let publishAt = null;
  if (input.publish_at !== undefined && input.publish_at !== null && input.publish_at !== "") {
    const ms = typeof input.publish_at === "number" ? input.publish_at : Date.parse(String(input.publish_at));
    const nowMs = Number.isFinite(now) ? now : Date.now();
    if (!Number.isFinite(ms)) throw new SocialError("invalid_request", "publish_at: ISO vaxt olmalıdır (məs. 2026-10-09T20:00:00+04:00)");
    if (ms < nowMs + 60000) throw new SocialError("invalid_request", "publish_at gələcək vaxt olmalıdır");
    if (ms > nowMs + 60 * 86400000) throw new SocialError("invalid_request", "publish_at 60 gündən uzaq ola bilməz");
    publishAt = Math.floor(ms);
  }

  let media = null;
  const hasId = input.media_id !== undefined && input.media_id !== "";
  const hasUrl = input.media_url !== undefined && input.media_url !== "";
  if (hasId && hasUrl) throw new SocialError("invalid_request", "media_id və media_url birlikdə verilə bilməz");
  const mtype = input.media_type === undefined ? "video" : String(input.media_type);
  if (hasId || hasUrl) {
    if (mtype !== "image" && mtype !== "video") throw new SocialError("invalid_request", "media_type: image və ya video");
    if (hasId) {
      if (!MEDIA_ID_RE.test(String(input.media_id))) throw new SocialError("invalid_request", "media_id düzgün deyil");
      media = { id: String(input.media_id), type: mtype };
    } else {
      let u;
      try {
        u = assertSafeUrl(input.media_url);
      } catch (e) {
        throw new SocialError("invalid_request", "media_url təhlükəsiz https ünvan deyil");
      }
      media = { url: u.toString(), type: mtype };
    }
  }

  let thumbnailId = null;
  if (input.thumbnail_media_id) {
    if (!MEDIA_ID_RE.test(String(input.thumbnail_media_id))) throw new SocialError("invalid_request", "thumbnail_media_id düzgün deyil");
    thumbnailId = String(input.thumbnail_media_id);
  }

  const title = input.title ? String(input.title).trim() : "";
  const description = input.description ? String(input.description).trim() : "";

  const errors = readinessIssues({ platforms, media, caption, title });
  // strict=false: təsdiq qeydi yaradılarkən çatışmazlıqlar "issues" kimi qaytarılır (icra zamanı yenidən yoxlanır)
  if (errors.length && strict) throw new SocialError("invalid_request", errors.join("; ").slice(0, 280));

  return {
    issues: errors,
    platforms,
    caption,
    title,
    description,
    hashtags,
    media,
    thumbnail_media_id: thumbnailId,
    privacy,
    made_for_kids: input.made_for_kids === true,
    publish_at: publishAt,
  };
}

// Təsdiq qeydi üçün insan oxuyan xülasə: PAYLAŞILACAQ HƏR ŞEY burada görünür (mətn, başlıq, təsvir,
// hashtag, media ünvanı, thumbnail, uşaq məzmunu işarəsi). Gizli qalan sahə olmamalıdır.
export function summarizeRequest(req) {
  const names = req.platforms.map((p) => PLATFORM_INFO[p].label).join(", ");
  const lines = ["Paylaşım: " + names, "Mətn: " + req.caption];
  if (req.publish_at) lines.push("PLANLAŞDIRILIB: " + new Date(req.publish_at + 4 * 3600000).toISOString().slice(0, 16).replace("T", " ") + " (Bakı vaxtı). Təsdiqdən dərhal paylaşılmayacaq.");
  if (req.title) lines.push("Başlıq: " + req.title);
  if (req.description) lines.push("Təsvir: " + req.description);
  if (req.hashtags.length) lines.push("Hashtag: " + req.hashtags.map((t) => "#" + t).join(" "));
  if (req.media) {
    const kind = req.media.type === "image" ? "şəkil" : "video";
    lines.push("Media: " + kind + (req.media.id ? " (yüklənmiş, id " + req.media.id + ")" : " (xarici ünvan: " + req.media.url + ")"));
  } else lines.push("Media: yoxdur");
  if (req.thumbnail_media_id) lines.push("Thumbnail: yüklənmiş şəkil (id " + req.thumbnail_media_id + ")");
  const priv = req.platforms.filter((p) => PLATFORM_INFO[p].privacy);
  const open = req.platforms.filter((p) => !PLATFORM_INFO[p].privacy);
  lines.push("Məxfilik (" + priv.map((p) => PLATFORM_INFO[p].label).join(", ") + "): " + req.privacy);
  if (open.length) lines.push("DİQQƏT: " + open.map((p) => PLATFORM_INFO[p].label).join(", ") + " üçün məxfilik seçimi yoxdur, paylaşım ictimai olur.");
  if (priv.includes("youtube")) lines.push("Uşaqlar üçün məzmun: " + (req.made_for_kids ? "bəli" : "xeyr"));
  if (req.issues && req.issues.length) lines.push("DİQQƏT, çatışmazlıq (təsdiq olunsa da paylaşılmayacaq): " + req.issues.join("; "));
  return lines.join("\n");
}
