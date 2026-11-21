// Lead təsnifatı (HOT/WARM/COLD) və satış növbəti addımı. Şərh/DM mətni istifadəçidən və ya gələcəkdə rəsmi API-dən gəlir.
// Qiymət/çatdırılma/ödəniş faktı yoxdursa cavabda {{FAKT_LAZIMDIR:...}} qalır: uydurulmur.

const RX = {
  buy: /(almaq\s+istəyirəm|alıram|alacam|sifariş\s*(ver|et|edirəm|etmək)|necə\s+(al|sifariş)|hardan\s+al|i\s+want\s+to\s+buy|how\s+(can|do)\s+i\s+(buy|order)|order\s+now|хочу\s+(купить|заказать)|как\s+заказать|satın\s+almak\s+istiyorum|sipariş)/i,
  pay: /(ödəniş|kart(la)?|nağd|kaspi|pay(ment)?|оплат|ödeme)/i,
  delivery: /(çatdırılma|catdirilma|kuryer|delivery|shipping|доставк|kargo|teslimat)/i,
  contact: /(\+?\d[\d\s-]{8,}\d|whatsapp|ватсап|nömrə(m)?\s*:)/i,
  price: /(qiymət|qiymeti|neçəyə|neçəyədir|nə\s*qədər|price|how\s+much|cost|сколько|цена|fiyat|ne\s+kadar)/i,
  info: /(ətraflı|detal|məlumat|var\s*\?|stokda|ölçü|rəng|size|available|in\s+stock|info|подробн|есть\s+ли|bilgi|var\s+mı)/i,
  interest: /(maraqlıdır|istərdim|lazımdır|need\s+this|want\s+this|нужно|хочу|istiyorum)/i,
  negative: /(pis|bərbad|aldatma|fırıldaq|scam|fake|ужас|обман|rezalet|dolandırıcı|şikayət|complaint|qaytar|refund|возврат)/i,
  praise: /(əla|super|gözəl|möhtəşəm|love|amazing|great|nice|класс|супер|harika|güzel)/i,
  spam: /(follow\s*back|f4f|sub4sub|check\s+my\s+(page|profile)|free\s+followers|izləyici\s+qazan|t\.me\/|bit\.ly\/)/i,
};

export function classifyMessage(text) {
  const s = String(text || "").trim();
  const hits = Object.entries(RX).filter(([, re]) => re.test(s)).map(([k]) => k);
  const has = (k) => hits.includes(k);
  let category = "general", tier = "COLD";
  if (has("spam")) category = "spam";
  else if (has("negative")) category = "complaint";
  else if (has("buy") || has("pay") || has("contact")) { category = "purchase_intent"; tier = "HOT"; }
  else if (has("price") || has("delivery") || has("info") || has("interest")) { category = "question"; tier = "WARM"; }
  else if (has("praise")) category = "praise";
  if (category === "question" && has("delivery") && has("price")) tier = "HOT"; // həm qiymət, həm çatdırılma = alış hazırlığı
  const sentiment = category === "complaint" ? "negative" : has("praise") || tier !== "COLD" ? "positive" : "neutral";
  return { text: s, tier: category === "spam" ? "COLD" : tier, category, sentiment, signals: hits };
}

const NEXT = {
  HOT: "Dərhal cavab: sifariş/ödəniş/çatdırılma addımını ver, əlaqə kanalına yönləndir (DM / link in bio / sahibin göstərdiyi kanal).",
  WARM: "Sualı cavabla, məhsula uyğunlaşdır, yumşaq CTA ilə DM-ə və ya linkə dəvət et.",
  COLD: "Qısa təşəkkür və ya cavab yoxdur; satış təklifi göndərmə.",
};

// Cavab skeleti: yalnız business.json faktları ilə. Fakt yoxdursa açıq marker qalır, approval qapısı bunu bloklayır.
export function suggestReply(lead, facts = {}, { productName } = {}) {
  if (lead.category === "spam") return { reply: null, action: "ignore", note: "Spam: cavab verilmir" };
  if (lead.category === "complaint") return { reply: "Bağışlayın, narahatlıq üçün üzr istəyirik. Zəhmət olmasa DM-də yazın, məsələni şəxsən həll edək.", action: "escalate_to_owner", note: "Şikayət: sahib yoxlamalıdır" };
  const need = (k) => (facts && facts[k] ? String(facts[k]) : "{{FAKT_LAZIMDIR:" + k + "}}");
  const parts = [];
  const sigs = new Set(lead.signals);
  if (sigs.has("price")) parts.push("Qiymət: " + need("price") + ".");
  if (sigs.has("delivery")) parts.push("Çatdırılma: " + need("delivery") + ".");
  if (sigs.has("pay")) parts.push("Ödəniş: " + need("payment") + ".");
  if (lead.tier === "HOT") parts.push("Sifariş üçün: " + need("contact") + ".");
  else if (lead.tier === "WARM") parts.push((productName ? productName + " haqqında " : "") + "ətraflı məlumat üçün DM-ə yazın.");
  else parts.push("Təşəkkür edirik! 🙌");
  const reply = parts.join(" ");
  return { reply, action: NEXT[lead.tier], missing_facts: [...reply.matchAll(/\{\{FAKT_LAZIMDIR:(\w+)\}\}/g)].map((m) => m[1]) };
}

export function triage(messages, facts) {
  const rows = (messages || []).map((m) => {
    const lead = classifyMessage(typeof m === "string" ? m : m.text);
    return { ...(typeof m === "object" ? m : {}), ...lead, next_step: NEXT[lead.tier], suggestion: suggestReply(lead, facts) };
  });
  const order = { HOT: 0, WARM: 1, COLD: 2 };
  rows.sort((a, b) => order[a.tier] - order[b.tier]);
  return { counts: { HOT: rows.filter((r) => r.tier === "HOT").length, WARM: rows.filter((r) => r.tier === "WARM").length, COLD: rows.filter((r) => r.tier === "COLD").length }, leads: rows };
}
