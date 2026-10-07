// Instagram oxuma alətləri: son paylaşımların göstəriciləri və şərhlər. Yalnız GET; heç nə dərc etmir, cavab göndərmir.
// Cavab GÖNDƏRMƏ (şərhə cavab, DM) hələ yoxdur: platforma icazəsi (instagram_business_manage_comments / messaging) və
// təsdiq-icra axını lazımdır → CODE READY — REAL TEST PENDING. Burada yalnız təsnifat və qaralama var.

const norm = (s) => String(s || "").toLocaleLowerCase("az");

// Deterministik təsnifat (model çağırışı yox)
export function classifyComment(text) {
  const t = norm(text);
  if (/(https?:\/\/|www\.|\.com\b|dm\s*(me|et)|follow\s*(me|back)|giveaway|casino|crypto|bonus)/.test(t)) return "spam";
  if (/(qiym[əe]t|n[əe]\s*q[əe]d[əe]r|ne qeder|\bman[ae]t|price|how much)/.test(t)) return "price_question";
  if (/(sifari[şs]|almaq ist|al[ıi]m|order|buy|çatd[ıi]r|catdir|[üu]nvan|haradan)/.test(t)) return "buy_intent";
  if (/(pis|[şs]ikay[əe]t|gec g[əe]ldi|problem|d[üu]z[əe]lm[əe]di|yaramad[ıi]|kötü|bad)/.test(t)) return "complaint";
  if (/\?/.test(t) || /(nec[əe]|n[əe]dir|varm[ıi]|olurmu)/.test(t)) return "question";
  return "other";
}

// Etibarlı uydurma olmayan ümumi qaralama (qiymət/stok kimi fakt yoxdur); göndərilmir, təsdiq lazımdır
export function draftReply(kind) {
  switch (kind) {
    case "price_question": return "Salam! Qiymət və ətraflı məlumat üçün bizə DM yazın, sizə dəqiq cavab verək.";
    case "buy_intent": return "Salam! Sifariş üçün DM yazın, sizə kömək edək.";
    case "complaint": return "Üzr istəyirik. Problemi həll etmək üçün DM yazın, dərhal baxaq.";
    case "question": return "Salam! Sualınız üçün təşəkkürlər, DM-də ətraflı cavab verək.";
    default: return null; // spam və digər: cavab təklif olunmur
  }
}

const mediaOut = (m) => ({ id: String(m.id), type: m.media_type || null, permalink: m.permalink || null, timestamp: m.timestamp || null, likes: Number.isFinite(m.like_count) ? m.like_count : null, comments: Number.isFinite(m.comments_count) ? m.comments_count : null, caption: m.caption ? String(m.caption).slice(0, 140) : null });

export function registerInstagramReadTools(registry, { hub }) {
  const base = { risk: "low", requiresApproval: false, timeoutMs: 20000, permissions: ["read.social"] };
  const ig = () => hub.adapter("instagram");

  registry.register({
    ...base,
    name: "instagram.media.recent",
    description: "Instagram: son paylaşımlar və göstəricilər (bəyənmə, şərh sayı). Yalnız oxuma; hesab qoşulmayıbsa xəta qaytarır.",
    inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 25 } } },
    outputSchema: { type: "object", required: ["items", "totals"], properties: { items: { type: "array" }, totals: { type: "object" } } },
    async handler(input) {
      const items = (await ig().recentMedia(input.limit || 10)).map(mediaOut);
      const sum = (k) => items.reduce((a, x) => a + (x[k] || 0), 0);
      return { items, totals: { posts: items.length, likes: sum("likes"), comments: sum("comments") } };
    },
  });

  registry.register({
    ...base,
    name: "instagram.comments.review",
    description: "Instagram: bir paylaşımın şərhlərini oxuyur, təsnif edir (qiymət/sifariş/şikayət/sual/spam) və QARALAMA cavab təklif edir. Heç nə göndərilmir.",
    inputSchema: { type: "object", required: ["media_id"], additionalProperties: false, properties: { media_id: { type: "string", pattern: "^[0-9]{5,30}$" }, limit: { type: "integer", minimum: 1, maximum: 50 } } },
    outputSchema: { type: "object", required: ["items", "sent"], properties: { items: { type: "array" }, sent: { type: "boolean" }, leads: { type: "integer" }, note: { type: "string" } } },
    async handler(input) {
      const raw = await ig().mediaComments(input.media_id, input.limit || 20);
      const items = raw.map((c) => {
        const kind = classifyComment(c.text);
        return { id: String(c.id), user: c.username ? String(c.username).slice(0, 40) : null, text: String(c.text || "").slice(0, 300), kind, lead: kind === "buy_intent" || kind === "price_question", draft_reply: draftReply(kind) };
      });
      return { items, sent: false, leads: items.filter((x) => x.lead).length, note: "Cavab göndərilməyib. Göndərmə üçün təsdiq və platforma icazəsi lazımdır (REAL TEST PENDING)." };
    },
  });
}
