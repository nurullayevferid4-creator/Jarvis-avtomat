// Deterministik ŞABLON paketləri. Model olmadıqda və ya model nəticəsi rədd edildikdə istifadə olunur.
// Şablon real məlumata görə fərdiləşdirilmir və AI tərəfindən yazılmayıb: çıxışda source:"template" ilə işarələnir.
// Bütün mətn Azərbaycan dilindədir. Qiymət, endirim, stok və nəticə iddiası YOXDUR: yalnız sahibin verdiyi faktlar yazılır.

import { stripUnsafe, normalizeHashtags } from "./safety.js";
import { PLATFORMS } from "./safety.js";

const HOOKS = {
  qr_menu: [
    "Menyunuzu müştərinin telefonuna necə çatdırırsınız?",
    "QR kodu oxut, menyu telefonunda açılsın.",
    "Müştəri menyunu soruşanda nə cavab verirsiniz?",
    "Bu QR kod nəyə aparır? Özünüz baxın.",
    "Kağız menyuya alternativ axtarırsınız?",
    "Masadakı QR kod menyunu necə açır? Göstərək.",
    "Menyunuz telefonda necə görünür? Yoxlayın.",
  ],
  fn_parfum: [
    "Ən sevdiyiniz qoxu ailəsi hansıdır? Şərhdə yazın.",
    "Hədiyyə üçün parfum seçmək çətindir? Gəlin birlikdə düşünək.",
    "Parfumu necə seçirsiniz: ad, qoxu, yoxsa tövsiyə?",
    "Bu həftə hansı qoxunu sınamaq istərdiniz?",
    "Sizcə parfum şəxsiyyəti göstərir? Fikrinizi yazın.",
  ],
};

const CAPTION_BODIES = {
  qr_menu: [
    "Müştəri masadakı QR kodu telefonla oxudur və menyu telefonunda açılır.",
    "Menyunu telefonda açmaq üçün QR kodu oxutmaq kifayətdir.",
    "QR menyu: masadakı kodu oxut, menyunu telefonunda gör.",
  ],
  fn_parfum: [
    "Parfum seçimi şəxsi zövq məsələsidir. Sizin sevdiyiniz qoxu hansıdır?",
    "Hədiyyə üçün parfum axtarırsınız? Sualınızı yazın, birlikdə seçək.",
    "Qoxu seçərkən nələrə fikir verirsiniz? Şərhdə bölüşün.",
  ],
};

function topicText(topic) {
  const t = stripUnsafe(topic || "").replace(/\s+/g, " ").slice(0, 80).trim();
  return t;
}

export function factLines(facts = {}) {
  const f = facts || {};
  const out = [];
  if (f.product_name) out.push(String(f.product_name));
  if (f.price) out.push("Qiymət: " + f.price);
  if (f.discount) out.push("Endirim: " + f.discount);
  if (f.delivery) out.push("Çatdırılma: " + f.delivery);
  if (f.stock) out.push("Stok: " + f.stock);
  return out.map((x) => stripUnsafe(x).slice(0, 120));
}

export function ctaFor(brand, facts = {}) {
  if (brand.id === "qr_menu") return "Nümunə menyuya baxın: " + brand.page_url;
  const link = facts && typeof facts.link === "string" && /^https:\/\//.test(facts.link) ? facts.link : "";
  return link ? "Ətraflı: " + link : "Sual və sifariş üçün DM yazın.";
}

export function templateHooks({ brand, count = 5, topic }) {
  const base = HOOKS[brand.id] || HOOKS.fn_parfum;
  const out = [];
  for (let i = 0; i < count; i++) out.push(base[i % base.length]);
  return [...new Set(out)].slice(0, count);
}

export function templateCaptions({ brand, platform = "instagram", count = 3, topic, offer, facts }) {
  const bodies = CAPTION_BODIES[brand.id] || CAPTION_BODIES.fn_parfum;
  const t = topicText(topic);
  const cta = ctaFor(brand, facts);
  const lines = factLines(facts);
  const o = offer ? stripUnsafe(offer).slice(0, 200) : "";
  const out = [];
  for (let i = 0; i < Math.min(count, bodies.length * 2); i++) {
    const parts = [];
    if (t) parts.push(t + ".");
    parts.push(bodies[i % bodies.length]);
    if (o) parts.push(o);
    if (lines.length) parts.push(lines.join("\n"));
    parts.push(cta);
    out.push({ text: parts.join("\n"), cta });
  }
  const seen = new Set();
  return out.filter((c) => !seen.has(c.text) && seen.add(c.text)).slice(0, count);
}

export function templateHashtags({ brand, topic, platform = "instagram", count = 12 }) {
  const t = topicText(topic).split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
  const max = platform === "youtube" ? 15 : 30;
  return normalizeHashtags([...brand.base_hashtags, ...t], Math.min(count, max));
}

function beats(d) {
  const mid = d - 8;
  const a = 3 + Math.round(mid / 2);
  return [
    { t: [0, 3], key: "hook" },
    { t: [3, a], key: "main1" },
    { t: [a, d - 5], key: "main2" },
    { t: [d - 5, d], key: "cta" },
  ];
}
const fmt = (t) => t[0] + "-" + t[1] + " san";

export function templatePlan({ brand, input = {}, platforms = PLATFORMS, includeCardNote = false }) {
  const d = Math.min(60, Math.max(15, input.duration_sec | 0 || 25));
  const facts = input.facts || {};
  const hook = templateHooks({ brand, count: 1 })[0];
  const cta = ctaFor(brand, facts);
  const b = beats(d);
  const isQr = brand.id === "qr_menu";

  const visuals = isQr
    ? { hook: "Masadakı QR kodun yaxın planı (sahibin real çəkilişi)", main1: "Telefon QR kodu oxudur (ekran çəkilişi ilə birlikdə)", main2: "Menyu səhifəsi telefonda açılır: nümunə səhifə", cta: "Son kadr: CTA mətni və nümunə səhifənin ünvanı" }
    : { hook: "Flakonun yaxın planı (məhsul və kadrlar sahibdən)", main1: "Məhsulun təqdimatı: ad və qoxu təsviri sahibin verdiyi məlumata görə", main2: "Müştəriyə sual: hansı qoxunu sevirsiniz?", cta: "Son kadr: CTA mətni" };
  const voice = isQr
    ? { hook, main1: "QR kodu telefonla oxudursunuz.", main2: "Menyu telefonunuzda açılır.", cta: "Nümunə səhifəyə özünüz baxın." }
    : { hook, main1: "Qoxu seçərkən nələrə fikir verirsiniz?", main2: "Şərhdə sevdiyiniz qoxunu yazın.", cta: "Sual və sifariş üçün yazın." };

  const script = b.map((x) => ({ timing: fmt(x.t), visual: visuals[x.key], voiceover: voice[x.key] }));
  const shot_list = b.map((x, i) => ({ shot: i + 1, description: visuals[x.key], duration_sec: x.t[1] - x.t[0] }));

  const captions = templateCaptions({ brand, count: 1, topic: input.topic || input.goal, offer: input.offer, facts });
  const hashtags = templateHashtags({ brand, topic: input.topic, count: 12 });

  const segs = brand.segments.map((s) => s.label);
  const audience = input.audience ? stripUnsafe(input.audience).slice(0, 150) : brand.segments[0].label;
  const plan = {
    target_audience: { primary: audience, segments: segs },
    hook,
    script,
    shot_list,
    caption: captions[0].text,
    cta,
    hashtags,
    ab_ideas: [
      { variable: "Hook", variant_a: hook, variant_b: templateHooks({ brand, count: 2 })[1] || hook, measure: "ilk saniyələrdə izləmənin davam etməsi (platforma statistikası)" },
      { variable: "CTA mətni", variant_a: cta, variant_b: isQr ? "Menyunu telefonunuzda açın: " + brand.page_url : "Yazın, cavab verək.", measure: "keçid və ya mesaj sayı (platforma statistikası)" },
      { variable: "Açılış kadrı", variant_a: visuals.hook, variant_b: visuals.main1, measure: "izləmə müddəti" },
    ],
    youtube_title: (isQr ? "QR menyu: telefonda menyu necə açılır" : "Parfum seçimi: sizin sevdiyiniz qoxu hansıdır").slice(0, 100),
  };
  if (includeCardNote) plan.extra_notes = ["Rəqəmsəl vizit kartı mövzusu sahibin sorğusu ilə əlavə edilib: onu ayrıca kontent kimi planlaşdırın, məlumat və link sahibdən alınmalıdır."];
  return plan;
}

const FORMAT_BY_PLATFORM = { instagram: "reel", tiktok: "video", youtube: "short" };

// Tarix: start (YYYY-MM-DD) + i gün
export function addDays(ymd, i) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
}

export function templateCalendar({ brand, days = 7, platforms = ["instagram"], startDate, postsPerWeek = 4, themes = [] }) {
  const pillars = brand.pillars;
  const hooks = HOOKS[brand.id] || HOOKS.fn_parfum;
  const items = [];
  let k = 0;
  for (let i = 0; i < days; i++) {
    const posts = Math.floor(((i + 1) * postsPerWeek) / 7) > Math.floor((i * postsPerWeek) / 7);
    if (!posts) continue;
    const pillar = pillars[k % pillars.length];
    const platform = platforms[k % platforms.length];
    const theme = themes.length ? stripUnsafe(themes[k % themes.length]).slice(0, 80) : "";
    items.push({ day: i + 1, date: addDays(startDate, i), platform, format: pillar.format === "reel" ? FORMAT_BY_PLATFORM[platform] : pillar.format, idea: pillar.label + (theme ? " — " + theme : ""), hook: hooks[k % hooks.length] });
    k++;
  }
  return items;
}
