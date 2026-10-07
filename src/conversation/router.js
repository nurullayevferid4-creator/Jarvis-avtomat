// JARVIS Master Router-in deterministik hissəsi.
//
// Axın (Telegram, mətn və ya səs):
//   mesaj → (səs: endirmə → STT → təmizləmə) → söhbət yaddaşı (kontekst) → niyyət
//     ├─ /komanda                  → komanda
//     ├─ səsli cavab seçimi         → yaddaşa yazılır
//     ├─ açıq paylaşım istəyi       → sosial qaralama (+ yaddaşdan mövzu/media) → TƏSDİQ DÜYMƏSİ
//     └─ qalan hər şey              → Claude (lider): kontekstlə anlayır, alət/agent seçir, lazımsa bir sual verir
//   nəticə → cavab (mətn + istəyə görə səs) → yaddaş yenilənir
//
// Bu fayl yalnız qərar köməkçiləridir (şəbəkə yoxdur). Təsdiq qaydasını dəyişmir.

// Alət → agent (hesabat və iş yaddaşı üçün)
const AGENT_BY_PREFIX = [
  ["lead.", "sales"],
  ["marketing.", "marketing"],
  ["manager.", "manager"],
  ["agents.", "manager"],
  ["shopify.order", "order"],
  ["order.", "order"],
  ["logistics.", "logistics"],
  ["shopify.product", "seller"],
  ["shopify.inventory", "seller"],
  ["shopify.price", "seller"],
  ["shopify.collection", "seller"],
  ["seller.", "seller"],
  ["support.", "customer_support"],
  ["fraud.", "fraud_quality"],
  ["quality.", "fraud_quality"],
  ["social.", "marketing"],
  ["media.", "video"],
  ["knowledge.", "knowledge"],
  ["web.", "research"],
  ["shopify.", "seller"],
];

export function agentForTool(name) {
  const n = String(name || "");
  const hit = AGENT_BY_PREFIX.find(([p]) => n.startsWith(p));
  return hit ? hit[1] : null;
}

export function agentForTools(names) {
  const counts = {};
  for (const n of names || []) {
    const a = agentForTool(n);
    if (a) counts[a] = (counts[a] || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

// Nəticədən iş yaddaşına yazılacaq "hazırlanmış məzmun" (reklam mətni, caption, plan və s.)
const CONTENT_TOOLS = /^(marketing\.|shopify\.product\.prepare|lead\.outreach\.prepare|support\.draft|media\.prepare)/;
export function artifactFrom(result) {
  if (!result || !result.screen) return null;
  const tools = (result.tools || []).map((t) => t.tool);
  const contentTool = tools.find((t) => CONTENT_TOOLS.test(t));
  if (contentTool) return { kind: contentTool, text: result.screen };
  // Uzun yaradıcı cavab (məs. "reklam mətni yaz") alətsiz də məzmundur
  if ((result.mode === "task" || result.mode === "chat") && result.screen.length >= 220) return { kind: result.mode === "task" ? "task_result" : "text", text: result.screen };
  return null;
}

// "Səsli cavab vermə" / "səslə cavab ver"
export function voicePreference(text) {
  const t = String(text || "").toLocaleLowerCase("az");
  if (/(səsli|səslə|səs ilə)\s+(cavab|mesaj)\w*\s+(vermə|göndərmə|lazım deyil|istəmirəm|bağla|söndür)/.test(t) || /^\/voice\s+off/.test(t)) return false;
  if (/(səsli|səslə|səs ilə)\s+(cavab|mesaj)\w*\s+(ver|göndər|aç|istəyirəm)\b/.test(t) || /^\/voice\s+on/.test(t)) return true;
  return null;
}

// "onu/bunu/həmin/əvvəlki ... paylaş" kimi istinad: mövzu/məzmun yaddaşdan götürülməlidir
export function refersBack(text) {
  return /(^|\s)(onu|bunu|o\s|həmin|əvvəlki|əvvəlkini|sonuncu|hazırladığın|hazırladığımız|dünənki|yuxarıdakı)/i.test(String(text || ""));
}

// Media tələb edən paylaşımı gözləyən niyyət: növbəti göndərilən media ilə davam edilir (24 saat)
export const WAIT_MEDIA_MS = 24 * 3600 * 1000;
