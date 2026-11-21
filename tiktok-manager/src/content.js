// Kontent obyektləri: ideya qiymətləndirmə, video paketi (hook → ssenari → səhnələr → voice-over → caption → hashtag → CTA),
// paket yoxlaması və manual paylaşım paketi. Mətni Claude (skill-lər) yazır; bu modul strukturu və qaydaları məcbur edir.
import { scanText, checkBusinessFacts, checkAd } from "./policy.js";

export const CAPTION_MAX = 2200; // Direct Post: title ≤ 2200 UTF-16 rune
export const PRIVACY_LEVELS = Object.freeze(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]);

// "Yüksək baxış potensialı" balı: şəffaf düstur, zəmanət deyil.
export function scoreIdea(idea, analysis) {
  const s = idea.signals || {};
  const clamp = (x) => Math.max(0, Math.min(5, Number(x) || 0));
  let data = 2.5, basis = "hesab məlumatı yoxdur (neytral)";
  if (analysis && analysis.n && analysis.groups) {
    const row = analysis.groups.hook_pattern.find((g) => g.key === idea.hook_pattern);
    if (row && row.reliable && analysis.median_views) {
      data = clamp(2.5 * (row.median_views / analysis.median_views));
      basis = "bu hook tipi hesabda median " + row.median_views + " baxış (n=" + row.n + ")";
    } else if (row) basis = "bu hook tipi üçün nümunə azdır (n=" + row.n + ")";
  }
  const parts = { hook_strength: clamp(s.hook_strength), audience_fit: clamp(s.audience_fit), shareability: clamp(s.shareability), production_ease: clamp(s.production_ease), data_support: data };
  const w = { hook_strength: 0.3, audience_fit: 0.25, shareability: 0.2, production_ease: 0.1, data_support: 0.15 };
  const score = Math.round(Object.keys(w).reduce((t, k) => t + parts[k] * w[k], 0) * 20);
  const label = score >= 70 ? "yüksək baxış potensialı" : score >= 45 ? "orta baxış potensialı" : "aşağı baxış potensialı";
  return { score, label, parts, data_basis: basis, disclaimer: "Qiymətləndirmədir, viral zəmanəti deyil." };
}

export function rankIdeas(ideas, analysis) {
  return (ideas || []).map((i) => ({ ...i, potential: scoreIdea(i, analysis) })).sort((a, b) => b.potential.score - a.potential.score);
}

const utf16Len = (s) => String(s || "").length;

export function validatePackage(pkg, { facts, creatorInfo, appAudited } = {}) {
  const errors = [], warnings = [];
  const req = ["hook", "script", "scenes", "caption", "cta"];
  for (const k of req) if (!pkg || pkg[k] == null || (Array.isArray(pkg[k]) && !pkg[k].length) || pkg[k] === "") errors.push("Çatışmır: " + k);
  if (!pkg) return { ok: false, errors, warnings };

  const caption = composeCaption(pkg.caption, pkg.hashtags);
  if (utf16Len(caption) > CAPTION_MAX) errors.push("Caption + hashtag " + utf16Len(caption) + " simvoldur (limit " + CAPTION_MAX + ")");

  const scenes = pkg.scenes || [];
  let t = 0;
  for (const [i, sc] of scenes.entries()) {
    if (!(sc.start >= 0 && sc.end > sc.start)) { errors.push("Səhnə " + (i + 1) + ": vaxt yanlışdır"); continue; }
    if (Math.abs(sc.start - t) > 0.5) warnings.push("Səhnə " + (i + 1) + " əvvəlki ilə ardıcıl deyil (" + t + "s → " + sc.start + "s)");
    t = sc.end;
    if (!sc.visual) warnings.push("Səhnə " + (i + 1) + ": vizual təsvir yoxdur");
  }
  if (scenes.length && !(scenes[0].start === 0 && scenes[0].end <= 3.5)) warnings.push("Hook ilk 1–3 saniyəlik ayrıca səhnə olmalıdır");
  const total = scenes.length ? scenes[scenes.length - 1].end : null;
  if (creatorInfo && creatorInfo.max_video_post_duration_sec && total && total > creatorInfo.max_video_post_duration_sec) errors.push("Video " + total + "s, hesab limiti " + creatorInfo.max_video_post_duration_sec + "s");

  const tags = pkg.hashtags || [];
  for (const h of tags) if (!/^#[\p{L}\p{N}_]+$/u.test(h)) errors.push("Yanlış hashtag: " + h);
  if (tags.length > 8) warnings.push("Hashtag çoxdur (" + tags.length + "): 3–6 fokuslu hashtag tövsiyə olunur");

  // TikTok Content Sharing Guidelines: privacy default-suz, interaktivlik açıq seçimlə, kommersiya açıqlaması
  if (pkg.publish) {
    const p = pkg.publish;
    if (!PRIVACY_LEVELS.includes(p.privacy_level)) errors.push("privacy_level sahib tərəfindən açıq seçilməlidir (default yoxdur)");
    if (creatorInfo && Array.isArray(creatorInfo.privacy_level_options) && p.privacy_level && !creatorInfo.privacy_level_options.includes(p.privacy_level)) errors.push("Bu hesab üçün icazəli privacy: " + creatorInfo.privacy_level_options.join(", "));
    if (!appAudited && p.privacy_level && p.privacy_level !== "SELF_ONLY") errors.push("App audit olunmayıb: TikTok yalnız SELF_ONLY paylaşıma icazə verir");
    for (const k of ["allow_comment", "allow_duet", "allow_stitch"]) if (typeof p[k] !== "boolean") errors.push(k + " açıq seçilməlidir (true/false)");
    if (typeof p.commercial_content !== "boolean") errors.push("commercial_content (kommersiya açıqlaması) açıq seçilməlidir");
    if (p.commercial_content && !p.brand_organic && !p.brand_content) errors.push("Kommersiya kontenti: 'öz biznesin' və ya 'brend əməkdaşlığı' seçilməlidir");
    if (creatorInfo) {
      if (creatorInfo.comment_disabled && p.allow_comment) errors.push("Hesabda şərhlər söndürülüb: allow_comment true ola bilməz");
      if (creatorInfo.duet_disabled && p.allow_duet) errors.push("Hesabda duet söndürülüb");
      if (creatorInfo.stitch_disabled && p.allow_stitch) errors.push("Hesabda stitch söndürülüb");
    }
  }

  const text = [pkg.hook, pkg.voiceover, pkg.caption, pkg.cta, ...(pkg.script || []).map((s) => (typeof s === "string" ? s : s.text || s.voiceover || ""))].join("\n");
  const v = [...scanText(text), ...checkBusinessFacts(text, facts)];
  if (/\{\{FAKT_LAZIMDIR:/.test(text)) v.push({ rule: "missing_fact", match: "{{FAKT_LAZIMDIR}}" });
  if (pkg.ad) v.push(...checkAd(pkg.ad, facts));
  for (const x of v) errors.push("Siyasət: " + x.rule + " → \"" + x.match + "\"" + (x.hint ? " (" + x.hint + ")" : ""));
  return { ok: errors.length === 0, errors, warnings, caption_length: utf16Len(caption), duration: total };
}

export function composeCaption(caption, hashtags) {
  const tags = (hashtags || []).filter((h) => !String(caption || "").includes(h));
  return [String(caption || "").trim(), tags.join(" ")].filter(Boolean).join("\n\n");
}

// Direct Post üçün post_info: yalnız sahibin açıq seçimlərindən
export function toPostInfo(pkg) {
  const p = pkg.publish;
  return {
    title: composeCaption(pkg.caption, pkg.hashtags),
    privacy_level: p.privacy_level,
    disable_comment: !p.allow_comment, disable_duet: !p.allow_duet, disable_stitch: !p.allow_stitch,
    brand_content_toggle: !!(p.commercial_content && p.brand_content),
    brand_organic_toggle: !!(p.commercial_content && p.brand_organic),
    is_aigc: !!p.is_aigc,
    ...(Number.isInteger(p.cover_timestamp_ms) ? { video_cover_timestamp_ms: p.cover_timestamp_ms } : {}),
  };
}

// API dəstəkləmədikdə / execute söndürüləndə: əl ilə paylaşım paketi
export function manualPackage(pkg, { reason } = {}) {
  const L = ["# TikTok paylaşım paketi (manual)", ""];
  if (reason) L.push("> Səbəb: " + reason, "");
  L.push("## 1. Hook (ilk 1–3 saniyə)", pkg.hook || "-", "", "## 2. Ssenari");
  for (const s of pkg.script || []) L.push("- " + (typeof s === "string" ? s : (s.label ? "**" + s.label + ":** " : "") + (s.text || s.voiceover || "")));
  L.push("", "## 3. Səhnələr", "| # | Vaxt | Vizual | Ekran mətni | Voice-over |", "|---|---|---|---|---|");
  for (const [i, s] of (pkg.scenes || []).entries()) L.push("| " + (i + 1) + " | " + s.start + "–" + s.end + "s | " + (s.visual || "") + " | " + (s.on_screen_text || "") + " | " + (s.voiceover || "") + " |");
  L.push("", "## 4. Voice-over (tam)", pkg.voiceover || "-", "", "## 5. Caption (kopyala)", "```", composeCaption(pkg.caption, pkg.hashtags), "```", "", "## 6. CTA", pkg.cta || "-");
  if (pkg.publish) L.push("", "## 7. Paylaşım ayarları", "- Privacy: " + (pkg.publish.privacy_level || "SEÇİLMƏYİB"), "- Şərh/Duet/Stitch: " + [pkg.publish.allow_comment, pkg.publish.allow_duet, pkg.publish.allow_stitch].map((x) => (x ? "açıq" : "bağlı")).join(" / "), "- Kommersiya açıqlaması: " + (pkg.publish.commercial_content ? "bəli" : "xeyr"), "- AI-generated etiketi: " + (pkg.publish.is_aigc ? "bəli" : "xeyr"));
  L.push("", "## Əl ilə paylaşım addımları", "1. Videonu səhnə cədvəlinə görə çək/montaj et.", "2. TikTok tətbiqində + → videonu seç.", "3. Caption-u yuxarıdakı blokdan kopyala.", "4. Privacy və interaktivlik ayarlarını yuxarıdakı kimi seç.", "5. Paylaşdıqdan sonra video linkini sistemə ver ki, nəticə izlənsin (`track`).");
  return L.join("\n") + "\n";
}
