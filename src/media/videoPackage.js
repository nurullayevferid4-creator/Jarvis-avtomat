// Video paketi v1: CLAUDE AI VIDEO STUDIO → Instapilot AI / JARVIS ötürmə müqaviləsi (docs/VIDEO-PAKET.md).
// Paket qovluğu: video.mp4 + caption.txt + meta.json. Bu modul təmiz funksiyalardır, fayl sistemi və şəbəkə yoxdur:
// meta yoxlaması, məzmun hash-i (təsdiqi məzmuna bağlayır), təsdiq qeydi, nəticə qeydi və JARVIS social.publish qaralaması.
import { AppError } from "../errors.js";
import { canonicalJson, sha256Hex } from "../social/canon.js";
import { platformFit } from "./rules.js";

export const PACKAGE_VERSION = 1;
export const PACKAGE_FILES = Object.freeze({ video: "video.mp4", caption: "caption.txt", meta: "meta.json" });
export const PLATFORMS = Object.freeze(["instagram", "tiktok", "youtube", "telegram"]);
export const PRIVACY = Object.freeze(["private", "unlisted", "public"]);
export const STATUSES = Object.freeze(["pending_approval", "approved", "published", "partial", "failed"]);
export const RESULT_STATUSES = Object.freeze(["published", "failed", "unknown"]);

// Video Studio-nun yayımdan əvvəlki yoxlama siyahısı (video-yayim-qaydalari skili). Hamısı true olmalıdır.
export const QA_CHECKS = Object.freeze({
  hook_first_3s: "hook ilk 1-3 saniyədədir",
  subtitles_az_checked: "Azərbaycan altyazısı (ə ı ğ ş ç ö ü) əllə yoxlanıb",
  one_message_one_cta: "bir mesaj, bir CTA",
  licenses_ok: "musiqi, şrift, şəkil lisenziyası aydındır",
  no_foreign_brand: "başqasının loqosu və hesabı yoxdur",
  audio_peak_ok: "səs piki -1 dB-dən aşağıdır",
  watched_on_phone: "telefonda başdan sona izlənib",
});

const PACKAGE_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const ACCOUNT_RE = /^@[A-Za-z0-9._]{1,60}$/;
const MEDIA_ID_RE = /^[a-f0-9]{24}$/;
const MAX_HASHTAGS = 8; // Fərid-in kontent paketi qaydası: 5-8 hashtag

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v.trim() : "");

// Təsdiqin bağlandığı məzmun. status, approval, results buraya daxil deyil: onlar məzmun deyil, vəziyyətdir.
export function contentOf(meta) {
  const m = isObj(meta) ? meta : {};
  return {
    version: m.version,
    package_id: m.package_id,
    video_sha256: m.video_sha256,
    caption_sha256: m.caption_sha256,
    targets: Array.isArray(m.targets) ? m.targets.map((t) => ({ platform: t && t.platform, account: t && t.account })) : [],
    privacy: m.privacy || "private",
    title: m.title || "",
    description: m.description || "",
    hashtags: Array.isArray(m.hashtags) ? m.hashtags : [],
    schedule_at: m.schedule_at || null,
    made_for_kids: m.made_for_kids === true,
    ai_generated: m.ai_generated === true,
  };
}

export async function contentHash(meta) {
  return await sha256Hex(canonicalJson(contentOf(meta)));
}

// Yalnız meta.json strukturu. Qaytarır { blockers[], warnings[] }
export function validateMeta(meta, { now = Date.now() } = {}) {
  const blockers = [];
  const warnings = [];
  if (!isObj(meta)) return { blockers: ["meta.json obyekt deyil"], warnings };
  if (meta.version !== PACKAGE_VERSION) blockers.push("version " + PACKAGE_VERSION + " olmalıdır");
  if (!PACKAGE_ID_RE.test(str(meta.package_id))) blockers.push("package_id: kiçik hərf, rəqəm və '-' (3-64 simvol)");
  if (!SHA_RE.test(str(meta.video_sha256))) blockers.push("video_sha256 yoxdur və ya səhvdir");
  if (!SHA_RE.test(str(meta.caption_sha256))) blockers.push("caption_sha256 yoxdur və ya səhvdir");

  const targets = Array.isArray(meta.targets) ? meta.targets : [];
  if (!targets.length) blockers.push("targets boşdur: ən azı bir platforma və hesab lazımdır");
  const seen = new Set();
  for (const t of targets) {
    const p = isObj(t) ? str(t.platform) : "";
    if (!PLATFORMS.includes(p)) { blockers.push("naməlum platforma: " + (p || "(boş)")); continue; }
    if (seen.has(p)) blockers.push(p + " iki dəfə yazılıb");
    seen.add(p);
    const acc = str(t.account);
    if (p === "telegram") {
      if (!acc) blockers.push("telegram üçün kanal adı (account) yazılmayıb");
    } else if (!ACCOUNT_RE.test(acc)) {
      blockers.push(p + " üçün hesab adı '@ad' şəklində yazılmalıdır (hesablar qarışmasın)");
    }
  }

  const privacy = meta.privacy === undefined ? "private" : meta.privacy;
  if (!PRIVACY.includes(privacy)) blockers.push("privacy: private | unlisted | public");
  if (privacy === "public" && seen.has("tiktok")) {
    warnings.push("TikTok: tətbiq audit olunmayıbsa public paylaşım bloklanır, yalnız SELF_ONLY mümkündür (SOCIAL.md)");
  }
  const privateCapable = ["tiktok", "youtube"].filter((p) => seen.has(p));
  if (privacy === "private" && privateCapable.length) warnings.push("privacy private: " + privateCapable.join(", ") + " paylaşımı yalnız sənə görünəcək. Açıq paylaşım üçün Fərid public-i açıq deməlidir");

  if (meta.hashtags !== undefined && !Array.isArray(meta.hashtags)) blockers.push("hashtags siyahı olmalıdır");
  const tags = Array.isArray(meta.hashtags) ? meta.hashtags : [];
  if (tags.some((h) => typeof h !== "string" || !/^[^\s#]+$/.test(h))) blockers.push("hashtag-lar '#' və boşluq olmadan yazılır");
  if (tags.length > MAX_HASHTAGS) warnings.push(tags.length + " hashtag: Fərid qaydası 5-8 hashtag-dır");
  if (seen.has("youtube") && !str(meta.title)) blockers.push("YouTube üçün title lazımdır");

  if (meta.schedule_at !== undefined && meta.schedule_at !== null) {
    const ts = Date.parse(meta.schedule_at);
    if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(String(meta.schedule_at)) || Number.isNaN(ts)) blockers.push("schedule_at saat qurşağı ilə ISO vaxt olmalıdır (məs. 2026-11-16T19:00:00+04:00)");
    else if (ts < now) warnings.push("schedule_at keçmişdədir");
  }

  const qa = isObj(meta.qa) ? meta.qa : {};
  for (const [k, label] of Object.entries(QA_CHECKS)) if (qa[k] !== true) blockers.push("QA keçməyib: " + label);
  if (meta.ai_generated === true) warnings.push("real görünən AI insan və ya səs var: platformada 'AI ilə yaradılıb' işarəsini qoy");

  if (!STATUSES.includes(meta.status)) blockers.push("status: " + STATUSES.join(" | "));
  if (meta.status !== "pending_approval" && !isObj(meta.approval)) blockers.push("status " + meta.status + " amma approval qeydi yoxdur");
  if (meta.results !== undefined && !Array.isArray(meta.results)) blockers.push("results siyahı olmalıdır");
  return { blockers, warnings };
}

// Tam yoxlama. Fayl sistemi çağıran tərəfdədir: buraya hesablanmış hash-lər və analyzeMp4 nəticəsi gəlir.
// Qaytarır { ok, ready_to_publish, blockers[], warnings[], content_hash, platforms{} }
export async function checkPackage({ meta, caption, videoSha256, captionSha256, analysis, analysisError = null, size = 0, now = Date.now() }) {
  const { blockers, warnings } = validateMeta(meta, { now });
  if (typeof caption !== "string" || !caption.trim()) blockers.push("caption.txt boşdur");
  if (isObj(meta) && videoSha256 && meta.video_sha256 !== videoSha256) blockers.push("video.mp4 meta.json-dakı video_sha256 ilə uyğun gəlmir (fayl dəyişib)");
  if (isObj(meta) && captionSha256 && meta.caption_sha256 !== captionSha256) blockers.push("caption.txt meta.json-dakı caption_sha256 ilə uyğun gəlmir (mətn dəyişib)");
  if (analysisError) blockers.push("video oxunmadı: " + analysisError);

  const platforms = {};
  const targets = isObj(meta) && Array.isArray(meta.targets) ? meta.targets : [];
  if (analysis) {
    for (const t of targets) {
      if (!t || !PLATFORMS.includes(t.platform)) continue;
      const fit = platformFit(analysis, t.platform, { size });
      platforms[t.platform] = { account: t.account, ok: fit.ok, blockers: fit.blockers, warnings: fit.warnings };
      for (const b of fit.blockers) blockers.push(t.platform + ": " + b);
      for (const w of fit.warnings) warnings.push(t.platform + ": " + w);
    }
  }

  const hash = isObj(meta) ? await contentHash(meta) : null;
  let approvalValid = false;
  if (isObj(meta) && isObj(meta.approval)) {
    if (meta.approval.content_hash !== hash) blockers.push("məzmun təsdiqdən sonra dəyişib: yenidən təsdiq lazımdır");
    else approvalValid = true;
  }
  const ok = blockers.length === 0;
  // Nəticəsi hələ yazılmayan hədəflər. failed/unknown avtomatik təkrar olunmur: Fərid qərar verir.
  const results = isObj(meta) && Array.isArray(meta.results) ? meta.results : [];
  const pending = targets.map((t) => t && t.platform).filter((p) => PLATFORMS.includes(p) && !results.some((r) => r && r.platform === p));
  const ready = ok && approvalValid && ["approved", "partial"].includes(meta.status) && pending.length > 0;
  return { ok, ready_to_publish: ready, pending_platforms: ready ? pending : [], blockers, warnings, content_hash: hash, platforms };
}

// Fərid açıq "bəli" yazandan sonra çağırılır. Yalnız bloklayıcısı olmayan, gözləyən paket təsdiqlənir.
export function approve(meta, check, { by, at = new Date().toISOString() }) {
  if (!isObj(meta) || meta.status !== "pending_approval") throw new AppError("CONFLICT", "Yalnız pending_approval statusunda paket təsdiqlənir");
  if (!check || !check.ok) throw new AppError("VALIDATION_ERROR", "Paketdə bloklayıcı var, təsdiq olunmur");
  if (!str(by)) throw new AppError("VALIDATION_ERROR", "Kim təsdiqlədi (by) yazılmalıdır");
  return { ...meta, status: "approved", approval: { by: str(by), at, content_hash: check.content_hash } };
}

// Hər platformanın paylaşım nəticəsi. Ümumi status bütün hədəflərə görə hesablanır.
export function recordResult(meta, { platform, status, url = null, post_id = null, error = null, at = new Date().toISOString() }) {
  if (!isObj(meta) || !["approved", "partial", "published", "failed"].includes(meta.status)) throw new AppError("CONFLICT", "Nəticə yalnız təsdiqlənmiş paketə yazılır");
  const targets = (meta.targets || []).map((t) => t.platform);
  if (!targets.includes(platform)) throw new AppError("VALIDATION_ERROR", platform + " bu paketin hədəfi deyil");
  if (!RESULT_STATUSES.includes(status)) throw new AppError("VALIDATION_ERROR", "status: " + RESULT_STATUSES.join(" | "));
  if (status === "published" && !str(url) && !str(post_id)) throw new AppError("VALIDATION_ERROR", "published üçün link və ya post_id lazımdır (yoxlanmadan 'paylaşıldı' yazılmır)");
  const results = [...(Array.isArray(meta.results) ? meta.results : []).filter((r) => r.platform !== platform), { platform, status, url, post_id, error, at }];
  const done = targets.map((p) => results.find((r) => r.platform === p));
  let overall = "approved";
  if (done.every((r) => r && r.status === "published")) overall = "published";
  else if (done.every((r) => r && r.status === "failed")) overall = "failed";
  else if (done.some((r) => r)) overall = "partial";
  return { ...meta, results, status: overall };
}

// JARVIS POST /api/social/draft gövdəsi. Video əvvəl /api/media ilə yüklənməlidir (media_id).
// JARVIS öz təsdiq qeydini ayrıca açır: bu qaralama paylaşmır.
export function toSocialPublish(meta, caption, { mediaId }) {
  if (!MEDIA_ID_RE.test(str(mediaId))) throw new AppError("VALIDATION_ERROR", "media_id lazımdır: videonu əvvəl JARVIS-ə (POST /api/media) yüklə");
  const c = contentOf(meta);
  const out = {
    platforms: c.targets.map((t) => t.platform),
    caption: String(caption || "").trim(),
    hashtags: c.hashtags,
    media_id: str(mediaId),
    media_type: "video",
    privacy: c.privacy,
    made_for_kids: c.made_for_kids,
  };
  if (c.title) out.title = c.title;
  if (c.description) out.description = c.description;
  return out;
}
