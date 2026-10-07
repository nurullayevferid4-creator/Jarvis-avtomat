// STT nəticəsinin təmizlənməsi (Azərbaycan dili + qarışıq Türk/Rus/İngilis sözləri).
//
// Prinsip: KOR-KORANƏ DƏYİŞMƏ YOXDUR.
//  - Yalnız birmənalı yazılış variantları düzəldilir (məs. "instaqramda" → "Instagram-da", "carvis" → "Jarvis").
//    Bu sözlərin Azərbaycan dilində başqa mənası yoxdur.
//  - Çoxmənalı səslənmələr (məs. "ey ay" = AI?) burada dəyişmir: mətn Claude-a "[səsdən]" işarəsi və söhbət konteksti ilə
//    verilir, o, mənanı kontekstə görə özü müəyyənləşdirir və lazım olsa bir sual verir.
//  - Hər düzəliş qeyd olunur (corrections), beləcə istifadəçiyə nə eşidildiyi şəffaf göstərilir.

// Azərbaycan dilində latın adlarına qoşulan hal/mənsubiyyət şəkilçiləri (yazıda defislə: "Instagram-da")
const SUFFIX = /^(?:da|də|dan|dən|a|ə|ya|yə|ı|i|u|ü|yı|yi|yu|yü|nı|ni|nu|nü|ın|in|un|ün|nın|nin|nun|nün|la|lə|dakı|dəki|ki|çün|üçün|lar|lər|larda|lərdə|dır|dir|dur|dür|ım|im|um|üm|ımız|imiz|umuz|ümüz|sı|si|su|sü|sını|sini|sunu|sünü|sının|sinin|sunun|sünün|sına|sinə|suna|sünə|sında|sində|sunda|sündə)?$/;

// Tək söz variantları (kiçik hərflə) → kanonik yazılış
const WORDS = [
  [/^(jarvis|jarviz|jarwis|carvis|carviz|cərvis|cervis|ceyrvis|çarvis|djarvis|jervis|джарвис|жарвис)/, "Jarvis"],
  [/^(instagram|instaqram|instagraam|instaqramm|инстаграм|инстаграмм)/, "Instagram"],
  [/^(tiktok|tiktoq|тикток)/, "TikTok"],
  [/^(youtube|yutub|yutup|ютуб|ютьюб)/, "YouTube"],
  [/^(shopify|şopify|şopifay|shopifay|шопифай|шопифи)/, "Shopify"],
  [/^(telegram|teleqram|телеграм)/, "Telegram"],
  [/^(weecard|vikard|wikard)/, "WeeCard"],
  [/^(openai|опенай)/, "OpenAI"],
];

// Çoxsözlü ifadələr (ardıcıl sözlər, arada boşluq/defis) → kanonik
const PHRASES = [
  [/(^|[^\p{L}\p{N}])(?:tik[\s-]+tok|tik[\s-]+toq)(\p{L}*)/giu, "TikTok"],
  [/(^|[^\p{L}\p{N}])(?:you[\s-]+tube|yu[\s-]+tub)(\p{L}*)/giu, "YouTube"],
  [/(^|[^\p{L}\p{N}])(?:qr|kyu[\s-]*ar|ku[\s-]*ar|kü[\s-]*ar|kyu[\s-]*a|ку[\s-]*ар)[\s-]+(?:menyu|menu|menü|меню)(\p{L}*)/giu, "QR Menu"],
  [/(^|[^\p{L}\p{N}])(?:fn|ef[\s-]*en|эф[\s-]*эн)[\s-]+(?:parfum|parfüm|parfyum|парфюм)(\p{L}*)/giu, "FN Parfum"],
  [/(^|[^\p{L}\p{N}])(?:wee|vi)[\s-]+(?:card|kard)(\p{L}*)/giu, "WeeCard"],
  [/(^|[^\p{L}\p{N}])(?:open[\s-]+ai|open[\s-]+ay|opən[\s-]+ay|оупен[\s-]+ай)(\p{L}*)/giu, "OpenAI"],
  [/(^|[^\p{L}\p{N}])(?:a[\s-]+pi[\s-]+ay|ey[\s-]+pi[\s-]+ay|эй[\s-]+пи[\s-]+ай)(\p{L}*)/giu, "API"],
];

function withSuffix(canon, rest) {
  const suf = String(rest || "").toLowerCase();
  if (!suf) return { ok: true, text: canon };
  if (!SUFFIX.test(suf)) return { ok: false };
  return { ok: true, text: canon + "-" + suf };
}

// Qaytarır: { text, corrections: [{from, to}] }
export function normalizeTranscript(raw) {
  let text = String(raw || "").replace(/\s+/g, " ").trim();
  const corrections = [];
  for (const [re, canon] of PHRASES) {
    text = text.replace(re, (m, pre, rest) => {
      const w = withSuffix(canon, rest);
      if (!w.ok) return m;
      const out = pre + w.text;
      if (out.trim() !== m.trim()) corrections.push({ from: m.trim(), to: w.text });
      return out;
    });
  }
  text = text.replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu, (tok) => {
    const low = tok.toLocaleLowerCase("az").replace(/[’']/g, "");
    const plain = low.replace(/-/g, "");
    for (const [re, canon] of WORDS) {
      const m = re.exec(plain);
      if (!m) continue;
      const w = withSuffix(canon, plain.slice(m[0].length));
      if (!w.ok) return tok; // məs. "telegramma" kimi tanınmayan forma: toxunulmur
      if (w.text !== tok) corrections.push({ from: tok, to: w.text });
      return w.text;
    }
    return tok;
  });
  return { text, corrections: corrections.slice(0, 20) };
}

// STT üçün ipucu (Whisper/gpt-4o-transcribe "prompt"): terminlər + son söhbətin qısa hissəsi.
// Bu, yalnız tanıma üçün kontekstdir; model onu əmr kimi qəbul etmir.
export const STT_VOCAB = "Azərbaycan dilində danışıq; arada türk, rus və ingilis sözləri ola bilər. Adlar və terminlər: Jarvis, Instagram, TikTok, YouTube, Shopify, Telegram, QR Menu, FN Parfum, WeeCard, Claude, OpenAI, Kimi, API, AI, reels, caption, hashtag, lead, draft, kampaniya, reklam, sifariş, müştəri.";

export function sttPrompt(recent = "") {
  const r = String(recent || "").replace(/\s+/g, " ").trim().slice(-300);
  return (STT_VOCAB + (r ? " Əvvəlki söhbət: " + r : "")).slice(0, 800);
}

// Model boş/səssiz audioda bəzən ipucunun özünü (sabit lüğət hissəsini) və ya tipik "subtitr" cümlələrini qaytarır: bu, əmr deyil.
// Yalnız lüğət ipucunun SABİT hissəsi ilə üst-üstə düşmə yoxlanır; son JARVIS cavabına bənzəyən real cavab («QR Menu üçün yeni reklam»)
// və ya qısa ad siyahısı («Instagram, TikTok, YouTube») rədd edilmir.
const flat = (s) => String(s || "").toLocaleLowerCase("az").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const SCAFFOLD = ["azərbaycan dilində danışıq", "arada türk rus və ingilis sözləri", "adlar və terminlər", "əvvəlki söhbət"];
export function looksLikePromptEcho(text) {
  const t = flat(text);
  if (!t) return true;
  if (SCAFFOLD.some((p) => t.includes(p))) return true;
  const vocab = flat(STT_VOCAB);
  // Lüğətin uzun bir parçasını (6+ söz) hərfi təkrarlayırsa: ipucu əksi
  return t.split(" ").length >= 6 && vocab.includes(t);
}
