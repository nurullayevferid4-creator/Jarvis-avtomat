// Avtonom job-lar. Heç biri paylaşmır/göndərmir; nəticə yalnız tarixçəyə və gündəlik hesabata düşür.
// Real mənbə/açar yoxdursa nəticə UYDURULMUR: status "pending" + nə lazım olduğu açıq yazılır.

const RESEARCH_PROMPT = "QR Menu (restoran/kafe üçün QR menyu xidməti, Azərbaycan, Bakı) üçün bu gün aktual bazar müşahidəsi: rəqiblər, qiymət siqnalları, restoran sahiblərinin ehtiyacları. YALNIZ veb axtarışda tapdığın mənbələrə əsaslan, hər bənddə mənbə URL-i göstər, tapa bilmədiyini 'tapılmadı' yaz, heç nə uydurma. Azərbaycan dilində, ən çox 8 qısa bənd.";

// deps.research(prompt) -> { text, web } (real: OpenAI web search). Verilməsə / açar yoxdursa pending.
export function createHandlers({ env, research = null, leadSource = null } = {}) {
  return {
    "qr_menu.market_research": async () => {
      if (!research) return { status: "pending", summary: "CODE READY — REAL TEST PENDING: OPENAI_API_KEY (veb axtarış) lazımdır." };
      const r = await research(RESEARCH_PROMPT);
      if (r && r.model_only) {
        const t = String(r.text || "").trim();
        return t ? { status: "ok", summary: "[Kimi, canlı axtarış deyil — model biliyi, yoxlayın]\n" + t } : { status: "pending", summary: "Kimi boş cavab verdi." };
      }
      if (!r || !r.web) return { status: "pending", summary: "Canlı veb axtarış alınmadı, nəticə yazılmadı (uydurma yoxdur). OPENAI_WEB_SEARCH_TOOL/açarı yoxlayın." };
      const text = String(r.text || "").trim();
      if (!/https?:\/\//i.test(text)) return { status: "pending", summary: "Mənbə (URL) olmayan cavab qəbul edilmədi." };
      return { status: "ok", summary: text };
    },
    "qr_menu.lead_research": async () => {
      if (!leadSource) return { status: "pending", summary: "CODE READY — REAL TEST PENDING: lead mənbəyi qoşulmayıb. Açıq mənbə (LeadSource) təyin edilməlidir; namizəd uydurulmur." };
      const items = await leadSource.search({ query: "restoran kafe Bakı", limit: 5, product: "qr_menu" });
      return { status: "ok", summary: "Mənbədən " + items.length + " namizəd tapıldı (təsdiq olmadan əlaqə QADAĞANDIR; /leads ilə baxın)." };
    },
  };
}
