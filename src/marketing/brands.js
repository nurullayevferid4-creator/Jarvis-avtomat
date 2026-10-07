// Biznes kontekst reyestri: hər brend üçün YALNIZ təsdiqlənmiş faktlar və qadağalar.
// Marketinq alətləri və lead outreach buradan oxuyur. Burada olmayan fakt (qiymət, stok, endirim, nəticə)
// mövcud sayılmır: ya giriş verilənlərindən gəlməlidir, ya da needs_owner_input siyahısına düşür.
//
// QR Menu: yeganə link https://weenetwork.menu/ru/menu/29. Rəqəmsəl vizit kartı (WeeCard) ayrı xidmətdir:
// istifadəçi girişində AÇIQ istənmədikcə heç bir çıxışda xatırlanmır və QR Menu ilə birləşdirilmir.

export const QR_MENU_URL = "https://weenetwork.menu/ru/menu/29";

// Açıq istək yoxdursa qadağan olunan mövzu naxışı (QR Menu üçün)
export const DIGITAL_CARD_RE = /(vizit|business\s*card|wee\s*card|weecard|digital\s*card|rəqəmsəl\s+kart|reqemsel\s+kart)/i;

export const BRANDS = {
  qr_menu: {
    id: "qr_menu",
    name: "QR Menu",
    language: "az",
    summary: "QR kod vasitəsilə telefonda açılan rəqəmsəl menyu xidməti (restoran, kafe və oxşar məkanlar üçün).",
    // Yalnız təsvir xarakterli, yoxlanıla bilən ifadələr. Qiymət, müddət, nəticə və müqayisə yoxdur.
    verified_facts: ["Müştəri masadakı QR kodu telefonla oxudur və menyu telefonunda açılır.", "Nümunə menyu səhifəsi mövcuddur."],
    allowed_links: [QR_MENU_URL],
    page_url: QR_MENU_URL,
    forbidden_pattern: DIGITAL_CARD_RE,
    forbidden_label: "rəqəmsəl vizit kartı / WeeCard",
    required_facts: [], // QR Menu üçün əlavə fakt tələb olunmur; qiymət və s. verilməsə yazılmır
    fact_keys: ["price", "offer", "setup_time", "case_study"],
    segments: [
      { id: "restaurant_owner", label: "Restoran sahibi / meneceri", needs: "Menyunun telefonda əlçatan olması", channels: ["instagram", "tiktok"], angle: "Masada QR oxu, menyu telefonda açılsın: nümunə səhifə ilə göstərmək" },
      { id: "cafe_coffee", label: "Kafe və qəhvəxana", needs: "Sürətli menyu təqdimatı", channels: ["instagram", "tiktok"], angle: "Qısa demo video: QR-dan menyuya keçid" },
      { id: "bar_lounge", label: "Bar və lounge", needs: "Menyunun vizual təqdimatı", channels: ["instagram"], angle: "Menyu səhifəsinin ekran çəkilişi" },
      { id: "fast_food_delivery", label: "Fast food və çatdırılma məkanları", needs: "Menyunun sürətli paylaşılması", channels: ["instagram", "tiktok", "youtube"], angle: "Link/QR ilə menyunu paylaşma" },
    ],
    pillars: [
      { id: "demo", label: "Demo: QR-ı oxut, menyu açılsın", format: "reel" },
      { id: "question", label: "Sual: menyunuz telefonda necə görünür?", format: "carousel" },
      { id: "faq", label: "Sahibkar sualları (cavabları sahib verir)", format: "reel" },
      { id: "sample_page", label: "Nümunə menyu səhifəsinin təqdimatı", format: "story" },
      { id: "behind", label: "Quraşdırma prosesi (yalnız sahibin real çəkilişi ilə)", format: "reel" },
    ],
    base_hashtags: ["qrmenu", "qrmenyu", "rəqəmsəlmenyu", "restoran", "kafe", "bakı", "azərbaycan"],
    needs_owner_input: [],
  },
  fn_parfum: {
    id: "fn_parfum",
    name: "FN Parfum",
    language: "az",
    summary: "Parfum brendi. Məhsul, qiymət, stok və aksiya məlumatı sahibdən gəlməlidir: reyestrdə yoxdur.",
    verified_facts: ["FN Parfum parfum brendidir."],
    allowed_links: [],
    page_url: "",
    forbidden_pattern: null,
    forbidden_label: "",
    required_facts: ["product_name", "price", "stock", "discount", "delivery", "link"],
    fact_keys: ["product_name", "price", "stock", "discount", "delivery", "link", "notes_profile"],
    segments: [
      { id: "gift_buyers", label: "Hədiyyə axtaranlar", needs: "Hədiyyə seçimində rəhbərlik", channels: ["instagram", "tiktok"], angle: "Hədiyyə seçimi sualları (məhsul adı sahibdən)" },
      { id: "fragrance_fans", label: "Parfum həvəskarları", needs: "Qoxu haqqında məlumat", channels: ["instagram", "youtube"], angle: "Qoxu təsviri məzmunu (notlar sahibdən)" },
      { id: "repeat_customers", label: "Əvvəlki müştərilər", needs: "Yeni məhsullardan xəbər", channels: ["instagram"], angle: "Yeni məhsul elanı (yalnız sahib təsdiq etdikdə)" },
    ],
    pillars: [
      { id: "question", label: "Sual: ən sevdiyiniz qoxu ailəsi hansıdır?", format: "story" },
      { id: "gift", label: "Hədiyyə seçimi sualları", format: "carousel" },
      { id: "scent_notes", label: "Qoxu notları (məlumat sahibdən)", format: "reel" },
      { id: "brand_story", label: "Brend hekayəsi (məlumat sahibdən)", format: "reel" },
    ],
    base_hashtags: ["parfum", "ətir", "fnparfum", "bakı", "azərbaycan"],
    needs_owner_input: ["product_name", "price", "stock", "discount", "delivery", "link"],
  },
};

export const BRAND_IDS = Object.keys(BRANDS);

// STT yanlış eşitmələri / transliterasiya (boşluq, defis və alt xətt atılmış formada)
const BRAND_ALIASES = { qaramenyu: "qr_menu", qaramenu: "qr_menu", qaramenyuu: "qr_menu", qrmenyu: "qr_menu", kyuarmenyu: "qr_menu", kyuarmenu: "qr_menu", fnparfüm: "fn_parfum", fnparfyum: "fn_parfum" };

// "QR Menu", "qr-menu", "QRMenu", "FN Parfum" → kanonik id (qr_menu, fn_parfum). Tanınmayan dəyər olduğu kimi qalır.
export function normalizeBrandId(v) {
  if (typeof v !== "string") return v;
  if (BRANDS[v]) return v;
  const key = v.toLocaleLowerCase("en").replace(/[\s_-]+/g, "_").replace(/^_+|_+$/g, "");
  if (BRANDS[key]) return key;
  const squash = key.replace(/_/g, "");
  return BRAND_IDS.find((id) => id.replace(/_/g, "") === squash) || BRAND_ALIASES[squash] || v;
}

export function getBrand(id) {
  return BRANDS[id] || null;
}

// İstifadəçi girişi rəqəmsəl vizit kartını AÇIQ istəyirmi?
export function requestsDigitalCard(input) {
  if (!input || typeof input !== "object") return false;
  if (input.include_digital_card === true) return true;
  const texts = [input.goal, input.brief, input.topic, input.offer, input.notes, input.audience, ...(Array.isArray(input.themes) ? input.themes : [])];
  if (input.facts && typeof input.facts === "object") texts.push(...Object.values(input.facts));
  return texts.some((t) => typeof t === "string" && DIGITAL_CARD_RE.test(t));
}

// Brend üçün qadağan mövzu naxışı; açıq istək varsa null (yoxlama söndürülür)
export function forbiddenFor(brand, input) {
  if (!brand.forbidden_pattern) return null;
  return requestsDigitalCard(input) ? null : brand.forbidden_pattern;
}

// Çatışmayan faktlar: required_facts-dan giriş faktlarında olmayanlar
export function missingFacts(brand, facts = {}) {
  const f = facts && typeof facts === "object" ? facts : {};
  return brand.required_facts.filter((k) => !(typeof f[k] === "string" && f[k].trim()));
}
