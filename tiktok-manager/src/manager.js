// TikTok Manager: orkestr. Mürəkkəb əmri addımlara parçalayır, hər addımı skill-ə bağlayır və
// yalnız 3 yerdə dayanır: (1) xarici icra (publish/DM/şərh) təsdiqi, (2) uydurula bilməyən biznes faktı, (3) qoşulmamış hesab.
import { capability } from "./capabilities.js";

export const SKILLS = Object.freeze([
  "tiktok-account-analyzer", "tiktok-strategy", "tiktok-research", "tiktok-content-planner", "tiktok-video-ideas",
  "tiktok-hooks", "tiktok-script-writer", "tiktok-video-production", "tiktok-caption", "tiktok-hashtags",
  "tiktok-ad-creator", "tiktok-publisher", "tiktok-comments", "tiktok-dm", "tiktok-leads", "tiktok-sales",
  "tiktok-analytics", "tiktok-humanizer", "tiktok-growth", "tiktok-manager",
]);

const step = (n, skill, action, opts = {}) => ({ n, skill, action, auto: !opts.approval, approval_required: !!opts.approval, capability: opts.capability || null, when: opts.when || null });

const GROW = [
  step(1, "tiktok-account-analyzer", "Hesabı analiz et (profil, bio, follower, videolar)"),
  step(2, "tiktok-analytics", "Mövcud kontentin performansını analiz et (hansı hook/mövzu/uzunluq/CTA işləyir)"),
  step(3, "tiktok-analytics", "Follower artımını snapshot-lardan yoxla"),
  step(4, "tiktok-research", "Auditoriyanı və bazarı müəyyən et (yalnız real data + mənbəli araşdırma)"),
  step(5, "tiktok-strategy", "Strategiya qur (KPI: views → engagement → followers → profile visits → leads → sales)"),
  step(5, "tiktok-content-planner", "Kontent təqvimi (çoxlu video üçün)"),
  step(6, "tiktok-video-ideas", "Video ideyaları yarat və 'baxış potensialı' ilə qiymətləndir"),
  step(7, "tiktok-video-ideas", "Ən güclü ideyanı seç"),
  step(8, "tiktok-hooks", "Hook hazırla (3–5 variant, ən yaxşısı seçilir)"),
  step(9, "tiktok-script-writer", "Ssenari hazırla"),
  step(10, "tiktok-video-production", "Səhnələri və voice-over-u hazırla"),
  step(11, "tiktok-caption", "Caption hazırla"),
  step(12, "tiktok-hashtags", "Hashtag strategiyası"),
  step(13, "tiktok-sales", "CTA hazırla"),
  step(14, "tiktok-ad-creator", "Satış/reklam məqsədi varsa satış elementlərini əlavə et", { when: "goal in [sales, leads, product, service, dm, traffic]" }),
  step(15, "tiktok-humanizer", "Mətni təbii, insan dilinə uyğunlaşdır"),
  step(16, "tiktok-publisher", "Paylaşım paketini hazırla (DRAFT → REVIEW)"),
  step(17, "tiktok-publisher", "Təsdiqdən sonra real paylaş", { approval: true, capability: "post.video.direct" }),
  step(18, "tiktok-analytics", "Nəticələri izlə (video.query snapshot-ları)"),
  step(19, "tiktok-growth", "Nəticələrə əsasən növbəti videoları optimallaşdır"),
].map((s, i) => ({ ...s, n: i + 1 }));

export const PIPELINES = Object.freeze({
  grow: GROW,
  analyze: GROW.slice(0, 3),
  content: GROW.slice(5, 17),
  ad: [GROW[0], step(2, "tiktok-research", "Məhsul/xidmət faktlarını yoxla (business.json)"), step(3, "tiktok-ad-creator", "Hook → Problem → Solution → Product → Benefit → Proof (real) → CTA"), step(4, "tiktok-script-writer", "Reklam ssenarisi"), step(5, "tiktok-video-production", "Səhnələr"), step(6, "tiktok-caption", "Caption + CTA"), step(7, "tiktok-humanizer", "Təbiiləşdir"), step(8, "tiktok-publisher", "Paket (DRAFT → REVIEW)"), step(9, "tiktok-publisher", "Təsdiqdən sonra paylaş", { approval: true, capability: "post.video.direct" })],
  comments: [step(1, "tiktok-comments", "Şərhləri oxu", { capability: "comments.read" }), step(2, "tiktok-leads", "HOT/WARM/COLD təsnif et"), step(3, "tiktok-comments", "Cavab qaralamaları"), step(4, "tiktok-comments", "Təsdiqdən sonra göndər", { approval: true, capability: "comments.reply" })],
  dm: [step(1, "tiktok-dm", "DM-ləri oxu", { capability: "dm.read" }), step(2, "tiktok-leads", "Ehtiyacı və lead səviyyəsini müəyyən et"), step(3, "tiktok-sales", "Məhsula uyğunlaşdır, satışa yönləndir"), step(4, "tiktok-dm", "Cavab qaralaması"), step(5, "tiktok-dm", "Təsdiqdən sonra göndər", { approval: true, capability: "dm.send" })],
  leads: [step(1, "tiktok-leads", "Mesajları təsnif et"), step(2, "tiktok-sales", "Satış növbəti addımı")],
  publish: [step(1, "tiktok-publisher", "Paketi yoxla, DRAFT → REVIEW"), step(2, "tiktok-publisher", "Təsdiqdən sonra paylaş", { approval: true, capability: "post.video.direct" }), step(3, "tiktok-analytics", "Statusu və nəticəni izlə")],
  report: [step(1, "tiktok-analytics", "Real nəticələri yığ"), step(2, "tiktok-growth", "Növbəti addım tövsiyəsi")],
});

const INTENTS = [
  ["ad", /(reklam|\bad\b|ads|promo|tanıtım|tanitim|реклам)/i],
  ["comments", /(şərh|serh|comment|коммент)/i],
  ["dm", /(\bdm\b|mesaj|direct|сообщени|личк)/i],
  ["leads", /(lead|potensial müştəri|müştəri tap|лид)/i],
  ["publish", /(paylaş|publish|post et|yerləşdir|опублик)/i],
  ["report", /(nəticə|hesabat|report|statistika|отчет|результат)/i],
  ["analyze", /(analiz|audit|yoxla|analy[sz]e|анализ)/i],
  ["content", /(ssenari|script|video ideya|ideya|kontent|content|hook|caption)/i],
  ["grow", /(böyüt|boyut|inkişaf|artır|grow|scale|раскрут|развив)/i],
];

export function detectIntent(command) {
  const s = String(command || "");
  if (INTENTS[INTENTS.length - 1][1].test(s)) return "grow"; // "böyüt" ən geniş əmrdir, digər sözləri də ehtiva edə bilər
  for (const [name, re] of INTENTS) if (re.test(s)) return name;
  return "grow";
}

export function plan(command, state = {}) {
  const intent = detectIntent(command);
  const steps = PIPELINES[intent].map((s) => {
    const out = { ...s };
    if (s.capability) {
      const c = capability(s.capability);
      out.api_status = c.status;
      if (c.status === "UNSUPPORTED_BY_TIKTOK_API") { out.auto = false; out.fallback = "manual: istifadəçi mətni yapışdırır / əl ilə göndərir"; }
    }
    if (s.when && !state.salesGoal) out.skipped_unless = s.when;
    return out;
  });
  const blockers = [];
  if (!state.connected) blockers.push({ code: "not_connected", message: "TikTok hesabı qoşulmayıb: analiz istifadəçinin verdiyi məlumatla məhdudlaşır, API addımları işləmir." });
  if (state.missingFacts && state.missingFacts.length) blockers.push({ code: "missing_business_facts", message: "Uydurulmayacaq: " + state.missingFacts.join(", ") + ". Satış mətnlərində marker qalacaq." });
  return {
    command, intent, steps, blockers,
    stops_only_for: ["publish/DM/şərh cavabı üçün sahibin təsdiqi", "uydurula bilməyən biznes faktı"],
    execute_enabled: !!state.executeEnabled,
  };
}
