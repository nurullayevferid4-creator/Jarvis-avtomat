// ICP (ideal müştəri profili), uyğunluq yoxlaması (qualify) və izahlı bal (score). Hamısı deterministikdir:
// model çağırışı yoxdur, eyni giriş həmişə eyni nəticə verir.
//
// ICP konfiqurasiya olunur: registerLeadTools(registry, { icp: { qr_menu: {...} } }) ilə üstündən yazılır.
// Aşağıdakı standart siyahılar SAHİBİN məhsulları üçün başlanğıc fərziyyədir, ölçülmüş bazar məlumatı deyil.

import { normalize } from "../util.js";

const FOLD = { "ə": "e", "ı": "i", "ö": "o", "ü": "u", "ş": "s", "ç": "c", "ğ": "g" };
export function fold(s) {
  return normalize(s).replace(/[əıöüşçğ]/g, (c) => FOLD[c]);
}

function hasTerm(text, term) {
  const t = fold(term);
  if (!t) return false;
  if (t.length <= 3) return (" " + text + " ").includes(" " + t + " ");
  return text.includes(t);
}

function countTerms(text, terms) {
  return (terms || []).filter((t) => hasTerm(text, t)).length;
}

export const DEFAULT_ICPS = {
  qr_menu: {
    product: "qr_menu",
    label: "QR Menu",
    target_categories: ["restoran", "restaurant", "kafe", "cafe", "coffee", "qəhvə", "bar", "pub", "bistro", "pizza", "burger", "sushi", "fast food", "fastfood", "çayxana", "yeməkxana", "lounge", "bakery", "çörək", "pastry", "şirniyyat", "catering"],
    adjacent_categories: ["salon", "bərbər", "barber", "beauty", "gözəllik", "spa", "mağaza", "shop", "store"],
    exclude_categories: ["bank", "sığorta", "insurance", "dövlət", "government"],
    need_keywords: ["menyu", "menu", "qr", "rəqəmsəl", "digital", "sifariş", "order", "çatdırılma", "delivery", "qiymət siyahısı", "price list", "kağız"],
    locations_primary: ["bakı", "baku", "baki"],
    locations_secondary: ["sumqayıt", "gəncə", "lənkəran", "şəki", "mingəçevir", "naxçıvan", "azərbaycan", "azerbaijan"],
    min_confidence: 0.3,
    min_score: 40,
  },
  fn_parfum: {
    product: "fn_parfum",
    label: "FN Parfum",
    target_categories: ["parfum", "perfume", "ətriyyat", "etriyyat", "kosmetika", "cosmetics", "hədiyyə", "gift", "concept store", "butik", "boutique"],
    adjacent_categories: ["gözəllik salonu", "beauty", "salon", "mağaza", "shop", "store", "otel", "hotel"],
    exclude_categories: ["bank", "sığorta", "insurance", "dövlət", "government"],
    need_keywords: ["parfum", "perfume", "ətir", "hədiyyə", "gift", "kolleksiya", "collection", "topdan", "wholesale", "yeni məhsul"],
    locations_primary: ["bakı", "baku", "baki"],
    locations_secondary: ["sumqayıt", "gəncə", "azərbaycan", "azerbaijan"],
    min_confidence: 0.3,
    min_score: 40,
  },
};

export function resolveIcp(product, overrides = {}) {
  const base = DEFAULT_ICPS[product];
  if (!base) return null;
  const o = overrides && overrides[product] ? overrides[product] : {};
  const merged = { ...base };
  for (const k of Object.keys(base)) if (o[k] !== undefined && typeof o[k] === typeof base[k]) merged[k] = o[k];
  return merged;
}

// Qaytarır: { qualified, reasons:[...], category_fit: 'primary'|'adjacent'|'none' }
export function qualifyLead(lead, icp) {
  const reasons = [];
  const cat = fold(lead.category || "");
  let fit = "none";
  if (cat && countTerms(cat, icp.exclude_categories)) {
    reasons.push("Kateqoriya ICP-dən xaric edilib: " + lead.category);
  } else if (cat && countTerms(cat, icp.target_categories)) fit = "primary";
  else if (cat && countTerms(cat, icp.adjacent_categories)) fit = "adjacent";
  if (fit === "none" && !reasons.length) reasons.push(cat ? "Kateqoriya ICP-ə uyğun deyil: " + lead.category : "Kateqoriya göstərilməyib");

  const loc = fold(lead.location || "");
  if (loc && (icp.locations_primary.length || icp.locations_secondary.length)) {
    if (!countTerms(loc, icp.locations_primary) && !countTerms(loc, icp.locations_secondary)) reasons.push("Məkan ICP hüdudlarından kənardadır: " + lead.location);
  }
  if (lead.confidence < icp.min_confidence) reasons.push("Məlumat etibarlılığı aşağıdır (" + lead.confidence + " < " + icp.min_confidence + ")");
  return { qualified: reasons.length === 0, reasons, category_fit: fit };
}

// 0-100 bal, hər amilin izahı ilə. Maksimum cəmi 100: 30+20+15+10+15+10.
export function scoreLead(lead, icp) {
  const factors = [];
  const add = (id, label, points, max, detail) => factors.push({ id, label, points, max, detail });

  const q = qualifyLead(lead, icp);
  const catPts = q.category_fit === "primary" ? 30 : q.category_fit === "adjacent" ? 15 : 0;
  add("category_fit", "Kateqoriya uyğunluğu", catPts, 30, q.category_fit === "primary" ? "əsas hədəf kateqoriya" : q.category_fit === "adjacent" ? "yaxın kateqoriya" : "uyğun deyil");

  const need = fold((lead.need || "") + " " + (lead.category || ""));
  const hits = countTerms(need, icp.need_keywords);
  add("need_signal", "Ehtiyac siqnalı", hits >= 2 ? 20 : hits === 1 ? 12 : 0, 20, hits ? hits + " açar söz uyğun gəldi" : "ehtiyac mətnində siqnal yoxdur");

  const c = lead.public_contact;
  const goodContact = c && c.listed_publicly === true && c.value;
  const route = goodContact ? 15 : lead.website || lead.instagram || lead.tiktok ? 8 : 0;
  add("reachability", "İctimai əlaqə yolu", route, 15, goodContact ? "ictimai biznes kontaktı var" : route ? "yalnız sayt/sosial profil var" : "əlaqə yolu yoxdur");

  const presence = Math.min(10, (lead.website ? 5 : 0) + (lead.instagram ? 5 : 0) + (lead.tiktok ? 3 : 0));
  add("online_presence", "Onlayn mövcudluq", presence, 10, [lead.website && "sayt", lead.instagram && "instagram", lead.tiktok && "tiktok"].filter(Boolean).join(", ") || "yoxdur");

  const loc = fold(lead.location || "");
  const locPts = countTerms(loc, icp.locations_primary) ? 15 : countTerms(loc, icp.locations_secondary) ? 8 : 0;
  add("location_fit", "Məkan uyğunluğu", locPts, 15, locPts === 15 ? "əsas bölgə" : locPts ? "ikinci dərəcəli bölgə" : loc ? "bölgə ICP-də yoxdur" : "məkan göstərilməyib");

  const confPts = Math.round(Math.min(1, Math.max(0, lead.confidence)) * 10);
  add("confidence", "Məlumat etibarlılığı", confPts, 10, "confidence=" + lead.confidence);

  const score = Math.min(100, factors.reduce((a, f) => a + f.points, 0));
  return { score, factors };
}
