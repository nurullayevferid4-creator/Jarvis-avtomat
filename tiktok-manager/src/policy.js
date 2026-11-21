// Təhlükəsizlik və dürüstlük siyasəti. Bu yoxlamalar approval-dan ƏVVƏL işləyir: pozuntu varsa qaralama REVIEW-a keçə bilmir.

export const FORBIDDEN_ACTIONS = Object.freeze([
  "buy_followers", "buy_likes", "buy_views", "fake_comments", "fake_likes", "fake_followers",
  "follow_unfollow", "bot_engagement", "mass_dm", "cold_dm_blast", "spam_comment", "fake_review", "engagement_pod",
]);

// Çoxdilli (az/en/ru/tr) qadağan olunmuş taktika ifadələri
const FAKE_ENGAGEMENT = [
  /\b(buy|purchase)\s+(tiktok\s+)?(followers|likes|views|comments)\b/i,
  /follower\s*(al|satın al|almaq|alın)/i,
  /(izləyici|follower|like|bəyənmə|baxış)\s*(sat[ıi]n\s*al|almaq|al[ıi]n)\b/i,
  /\bfake\s+(followers|likes|comments|engagement|reviews?)\b/i,
  /\b(saxta|uydurma)\s+(follower|izləyici|like|bəyənmə|şərh|rəy|review|müştəri|nəticə)/i,
  /\bfollow[\s/-]*unfollow\b/i,
  /\bengagement\s+pod\b/i,
  /накрут/i, /купить\s+(подписчиков|лайки|просмотры)/i,
  /takipçi\s+satın\s+al/i,
  /\b(bot|avtomat)\s*(ilə)?\s*(like|follow|şərh|comment)/i,
];

const GUARANTEE = [
  /viral\s+olacaq/i, /mütləq\s+viral/i, /zəmanətli\s+viral/i, /viral(lığa)?\s+zəmanət/i,
  /guarantee[sd]?\s+(to\s+go\s+)?viral/i, /\b100\s*%\s*viral/i, /will\s+(definitely\s+)?go\s+viral/i,
  /(milyon|million)\s+(baxış|views)\s+(zəmanət|guarantee)/i, /гарантир\w*\s+вирус/i,
];

export function scanText(text) {
  const s = String(text || "");
  const v = [];
  for (const re of FAKE_ENGAGEMENT) if (re.test(s)) v.push({ rule: "fake_engagement", match: s.match(re)[0] });
  for (const re of GUARANTEE) if (re.test(s)) v.push({ rule: "viral_guarantee", match: s.match(re)[0], hint: "\"yüksək baxış potensialı\" ifadəsini istifadə et" });
  return v;
}

export function checkAction(kind) {
  return FORBIDDEN_ACTIONS.includes(String(kind)) ? [{ rule: "forbidden_action", match: kind }] : [];
}

// Qiymət/çatdırılma/ödəniş kimi biznes faktları yalnız hesab profilində (facts) varsa istifadə oluna bilər.
const PRICE_RE = /(\d[\d\s.,]*)\s*(₼|azn|manat|\$|usd|€|eur|₺|tl|rub|₽)|(₼|\$|€|₺|₽)\s*(\d[\d.,]*)/gi;
export function checkBusinessFacts(text, facts = {}) {
  const s = String(text || "");
  const v = [];
  const known = JSON.stringify(facts || {}).toLowerCase();
  for (const m of s.matchAll(PRICE_RE)) {
    const num = (m[1] || m[4] || "").replace(/\s/g, "");
    if (!num || !known.includes(num.toLowerCase())) v.push({ rule: "unverified_price", match: m[0].trim() });
  }
  const claims = [
    [/(pulsuz|free)\s+(çatdırılma|delivery|shipping)/i, "delivery"],
    [/(kapıda|qapıda)\s+ödəniş|cash\s+on\s+delivery|nağd\s+ödəniş/i, "payment"],
    [/(\d+)\s*(gün|saat|day|hour)[a-z]*\s*(ərzində|içində|within)?\s*(çatdırılma|delivery)/i, "delivery"],
    [/(zəmanət|warranty)\s*\d+/i, "warranty"],
  ];
  for (const [re, key] of claims) if (re.test(s) && !(facts && facts[key])) v.push({ rule: "unverified_business_fact", match: s.match(re)[0], fact: key });
  return v;
}

// Reklam strukturu: Hook → Problem → Solution → Product/Service → Benefit → Proof (yalnız real) → CTA
export const AD_SECTIONS = Object.freeze(["hook", "problem", "solution", "product", "benefit", "proof", "cta"]);
export function checkAd(ad, facts = {}) {
  const v = [];
  for (const k of AD_SECTIONS) {
    if (k === "proof") continue;
    if (!ad || !String(ad[k] || "").trim()) v.push({ rule: "ad_missing_section", match: k });
  }
  if (ad && ad.proof) {
    const p = ad.proof;
    const ok = typeof p === "object" && p.text && p.evidence && p.evidence.source && p.evidence.verified === true;
    if (!ok) v.push({ rule: "unverified_proof", match: "proof", hint: "Proof yalnız real, mənbəli sübutla (evidence.source + verified:true). Yoxdursa proof-u çıxar." });
  }
  const all = ad ? AD_SECTIONS.map((k) => (typeof ad[k] === "object" ? ad[k] && ad[k].text : ad[k]) || "").join("\n") : "";
  v.push(...scanText(all), ...checkBusinessFacts(all, facts));
  return v;
}

// DM: yalnız gələn mesaja cavab, bir alıcı. Kütləvi göndəriş qadağandır.
export function checkDm(payload) {
  const v = [];
  const to = payload && payload.recipients;
  if (Array.isArray(to) && to.length !== 1) v.push({ rule: "mass_dm", match: String(to.length) + " alıcı" });
  if (!payload || !payload.in_reply_to) v.push({ rule: "cold_dm", match: "in_reply_to yoxdur", hint: "Yalnız müştərinin yazdığı mesaja cavab verilir" });
  return v;
}

export function checkPayload(kind, payload, facts) {
  const v = [...checkAction(kind)];
  const text = [payload && payload.caption, payload && payload.text, payload && payload.title, payload && payload.voiceover].filter(Boolean).join("\n");
  v.push(...scanText(text), ...checkBusinessFacts(text, facts));
  if (/\{\{FAKT_LAZIMDIR:/.test(text)) v.push({ rule: "missing_fact", match: "{{FAKT_LAZIMDIR}}", hint: "business.json-da fakt doldurulmalıdır" });
  if (kind === "dm.send") v.push(...checkDm(payload));
  if (kind === "comment.reply" && !(payload && payload.comment_id)) v.push({ rule: "comment_target_missing", match: "comment_id" });
  if (payload && payload.ad) v.push(...checkAd(payload.ad, facts));
  return v;
}
