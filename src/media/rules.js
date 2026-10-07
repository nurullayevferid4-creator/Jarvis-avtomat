// Platforma uyğunluğu: video analizi → bloklayıcılar, xəbərdarlıqlar və lazım olan redaktə əməliyyatları.
// DİQQƏT: aşağıdakı müddət/ölçü həddləri "tövsiyə"dir və rəsmi sənəddən bu sessiyada yoxlanmayıb (platformalar
// qaydaları dəyişir). Yalnız "blocker" sayılanlar (fayl oxunmur, video treki yoxdur, 64 MB aşımı) sərtdir.

export const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

// Tövsiyə olunan həddlər (verified:false)
export const RECOMMENDED = {
  instagram: { maxDuration: 90, minDuration: 3, aspect: [0.5, 0.6], note: "Reels üçün 9:16 tövsiyə olunur" },
  tiktok: { maxDuration: 600, minDuration: 1, aspect: [0.5, 0.6], note: "TikTok üçün 9:16 tövsiyə olunur" },
  youtube: { maxDuration: 180, minDuration: 1, aspect: [0.5, 0.6], note: "YouTube Shorts üçün 9:16 və ≤ 3 dəqiqə tövsiyə olunur; daha uzun/üfüqi video adi video kimi yüklənir" },
  telegram: { maxDuration: 3600, minDuration: 0, aspect: null, note: "" },
};
const SUPPORTED_VIDEO = new Set(["h264", "hevc"]);

// analysis: analyzeMp4 nəticəsi; kind: "video"|"image". Qaytarır { ok, blockers[], warnings[], ops[], recommended }
export function platformFit(analysis, platform, { size } = {}) {
  const rec = RECOMMENDED[platform];
  if (!rec) return { ok: false, blockers: ["naməlum platforma"], warnings: [], ops: [] };
  const blockers = [];
  const warnings = [];
  const ops = [];
  const sz = size || (analysis && analysis.size) || 0;
  if (sz > MAX_VIDEO_BYTES) blockers.push("fayl 64 MB-dan böyükdür (JARVIS limiti)");
  if (!analysis || !analysis.video) {
    blockers.push("video analizi yoxdur");
    return { ok: false, blockers, warnings, ops, recommended: rec };
  }
  if (!SUPPORTED_VIDEO.has(analysis.video.codec)) {
    warnings.push("video kodek " + analysis.video.codec + ": H.264 tövsiyə olunur");
    ops.push({ op: "transcode", codec: "h264" });
  }
  if (analysis.audio && analysis.audio.codec !== "aac") {
    warnings.push("audio kodek " + analysis.audio.codec + ": AAC tövsiyə olunur");
    ops.push({ op: "transcode_audio", codec: "aac" });
  }
  if (!analysis.audio && platform !== "telegram") warnings.push("videoda səs yoxdur");
  if (analysis.container === "mov") {
    warnings.push("MOV konteyner: MP4 tövsiyə olunur");
    ops.push({ op: "remux", container: "mp4" });
  }
  if (rec.maxDuration && analysis.duration_s > rec.maxDuration) {
    warnings.push("müddət " + analysis.duration_s + " san: tövsiyə olunan maksimum " + rec.maxDuration + " san");
    ops.push({ op: "trim", max_seconds: rec.maxDuration });
  }
  // Minimum müddət də yoxlanmamış tövsiyədir: bloklamır, xəbərdarlıq edir
  if (rec.minDuration && analysis.duration_s < rec.minDuration) warnings.push("müddət " + analysis.duration_s + " san: platforma minimumu təxminən " + rec.minDuration + " san ola bilər");
  if (rec.aspect && (analysis.aspect < rec.aspect[0] || analysis.aspect > rec.aspect[1])) {
    warnings.push("en/boy nisbəti " + analysis.aspect + ": 9:16 (≈0.5625) tövsiyə olunur. " + rec.note);
    ops.push({ op: "reframe", aspect: "9:16" });
  }
  if (!analysis.faststart) warnings.push("faststart yoxdur (moov faylın sonundadır): bəzi platformalarda emal ləng ola bilər");
  if (!analysis.faststart && !ops.some((o) => o.op === "transcode" || o.op === "reframe" || o.op === "trim")) ops.push({ op: "faststart" });
  return { ok: blockers.length === 0, blockers, warnings, ops, recommended: rec };
}

// Redaktə planı: əməliyyatlar birləşdirilir (bir ffmpeg keçidi). Boşdursa emal LAZIM DEYİL.
export function editPlan(fit, analysis) {
  const ops = [];
  for (const o of fit.ops) if (!ops.some((x) => x.op === o.op)) ops.push(o);
  const needsProcessing = ops.length > 0;
  return { needs_processing: needsProcessing, ops, summary: needsProcessing ? ops.map(describeOp).join("; ") : "Redaktə lazım deyil: video platforma tövsiyələrinə uyğundur", target: targetSpec(ops, analysis) };
}

function describeOp(o) {
  switch (o.op) {
    case "trim": return "ilk " + o.max_seconds + " saniyəyə kəs";
    case "reframe": return "9:16 kadrlaşdır (mərkəzdən kəsmə)";
    case "transcode": return "videonu " + o.codec.toUpperCase() + "-ə çevir";
    case "transcode_audio": return "səsi " + o.codec.toUpperCase() + "-ə çevir";
    case "remux": return "MP4 konteynerə köçür";
    case "faststart": return "faststart (moov əvvələ)";
    default: return o.op;
  }
}

// Emaldan sonra yoxlanacaq hədəf göstəriciləri (VERIFY mərhələsi)
function targetSpec(ops, a) {
  const t = { container: "mp4" };
  const trim = ops.find((o) => o.op === "trim");
  if (trim) t.max_duration_s = trim.max_seconds + 1;
  if (ops.some((o) => o.op === "reframe")) t.aspect = [0.55, 0.57];
  if (ops.some((o) => o.op === "transcode")) t.video_codec = "h264";
  if (ops.some((o) => o.op === "transcode_audio") && a && a.audio) t.audio_codec = "aac";
  return t;
}

// Emal nəticəsi hədəfə uyğundurmu? Qaytarır { ok, problems[] }
export function verifyAgainstTarget(analysis, target) {
  const problems = [];
  if (!analysis) return { ok: false, problems: ["nəticə analiz edilmədi"] };
  if (target.container && analysis.container !== target.container) problems.push("konteyner " + analysis.container + " (gözlənilən " + target.container + ")");
  if (target.max_duration_s && analysis.duration_s > target.max_duration_s) problems.push("müddət " + analysis.duration_s + " san > " + target.max_duration_s);
  if (target.aspect && (analysis.aspect < target.aspect[0] || analysis.aspect > target.aspect[1])) problems.push("en/boy nisbəti " + analysis.aspect + " hədəfə uyğun deyil");
  if (target.video_codec && analysis.video.codec !== target.video_codec) problems.push("video kodek " + analysis.video.codec);
  if (target.audio_codec && analysis.audio && analysis.audio.codec !== target.audio_codec) problems.push("audio kodek " + analysis.audio.codec);
  return { ok: problems.length === 0, problems };
}
