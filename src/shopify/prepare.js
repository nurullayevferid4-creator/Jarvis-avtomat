// shopify.product.prepare: məhsul ideyasını yoxlanmış, normallaşmış QARALAMAYA çevirir.
//
// Tam deterministikdir: şəbəkə yoxdur, model yoxdur, yan təsir yoxdur.
// Uydurma YOXDUR: olmayan sahə (qiymət, təsvir, şəkil) heç vaxt "tamamlanmır", `missing` siyahısında bildirilir.
// Nəticə idempotentdir: prepareProduct(prepareProduct(x)) eyni qaralamanı verir.

import { assertSafeUrl } from "../security/ssrf.js";

export const LIMITS = { title: 255, handle: 100, description: 10000, tags: 20, tag: 40, variants: 20, images: 10, seoTitle: 70, seoDescription: 160, inventory: 100000, maxPrice: 9999999.99 };

const MAP = {
  "ə": "e", "Ə": "e", "ı": "i", "İ": "i", "I": "i", "ö": "o", "Ö": "o", "ü": "u", "Ü": "u", "ç": "c", "Ç": "c", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
  "ß": "ss", "æ": "ae", "Æ": "ae", "ø": "o", "Ø": "o", "đ": "d", "ł": "l", "Ł": "l",
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "j", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "x", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "", "ы": "i", "ь": "", "э": "e", "ю": "yu", "я": "ya",
};

export function transliterate(s) {
  let out = "";
  for (const ch of String(s === undefined || s === null ? "" : s)) {
    const lower = ch.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MAP, ch)) out += MAP[ch];
    else if (Object.prototype.hasOwnProperty.call(MAP, lower)) out += MAP[lower];
    else out += ch;
  }
  return out.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function slugify(s, max = LIMITS.handle) {
  let t = transliterate(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (t.length > max) t = t.slice(0, max).replace(/-+$/g, "");
  return t;
}

const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function cleanLine(v) {
  return String(v === undefined || v === null ? "" : v).replace(CTRL, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// --- HTML təmizləmə -----------------------------------------------------------------------------------
const ALLOWED_TAGS = new Set(["p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "u", "h2", "h3", "h4", "blockquote", "a"]);
const DROP_WITH_CONTENT = "script|style|iframe|object|embed|template|noscript|svg|math|form|textarea|select|option|head|title|meta|link|base|frame|frameset|applet";
const DROP_PAIR = new RegExp("<\\s*(" + DROP_WITH_CONTENT + ")\\b[\\s\\S]*?<\\s*/\\s*\\1\\s*>", "gi");
const DROP_OPEN_TO_END = new RegExp("<\\s*(" + DROP_WITH_CONTENT + ")\\b[\\s\\S]*$", "i");

function escapeAll(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Mövcud entity-lər (&amp; &lt; &#39;) toxunulmaz qalır, tək qalan &, <, > escape olunur
function escapeText(t) {
  return String(t).replace(/&(?![a-zA-Z]{2,8};|#\d{1,6};|#x[0-9a-fA-F]{1,6};)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function safeHref(attrs) {
  const m = String(attrs).match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/i);
  if (!m) return null;
  const v = (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] || "").trim();
  if (v.length > 500 || /[\s"'<>`\\\u0000-\u001F]/.test(v)) return null;
  if (!/^(https?:\/\/[^/]|mailto:[^@\s]+@)/i.test(v)) return null; // javascript:, data:, vbscript: və s. keçmir
  return v.replace(/&(?!amp;)/g, "&amp;");
}

export function sanitizeHtml(raw) {
  let s = String(raw === undefined || raw === null ? "" : raw).replace(CTRL, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/, "");
  for (let i = 0; i < 6; i++) {
    const prev = s;
    s = s.replace(DROP_PAIR, "");
    if (s === prev) break;
  }
  s = s.replace(DROP_OPEN_TO_END, "");
  const out = [];
  const stack = [];
  for (const part of s.split(/(<[^<>]*>)/)) {
    if (/^<[^<>]*>$/.test(part)) {
      const m = part.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>$/);
      if (!m) continue;
      const closing = m[1] === "/";
      const name = m[2].toLowerCase();
      if (!ALLOWED_TAGS.has(name)) continue;
      if (name === "br") { if (!closing) out.push("<br>"); continue; }
      if (closing) {
        const idx = stack.lastIndexOf(name);
        if (idx < 0) continue;
        while (stack.length > idx) out.push("</" + stack.pop() + ">");
        continue;
      }
      if (name === "a") {
        const href = safeHref(m[3]);
        if (!href) continue;
        out.push('<a href="' + href + '" rel="noopener noreferrer nofollow">');
        stack.push("a");
        continue;
      }
      out.push("<" + name + ">");
      stack.push(name);
    } else {
      out.push(escapeText(part));
    }
  }
  while (stack.length) out.push("</" + stack.pop() + ">");
  return out.join("").trim();
}

export function htmlToText(html) {
  return String(html || "")
    .replace(/<\/(p|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Sadə mətn -> HTML, HTML -> təmizlənmiş HTML
export function normalizeDescription(raw) {
  const s = String(raw === undefined || raw === null ? "" : raw).replace(CTRL, "").trim();
  if (!s) return "";
  if (/<\/?[a-zA-Z!]/.test(s)) return sanitizeHtml(s);
  return s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => "<p>" + escapeAll(p).replace(/\n/g, "<br>") + "</p>")
    .join("");
}

// --- Qiymət -------------------------------------------------------------------------------------------
// Qaytarır: { missing:true } | { error:"..." } | { value:"12.50" }
export function parseMoney(v) {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return { missing: true };
  let s;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { error: "qiymət düzgün ədəd deyil" };
    s = String(v);
    if (/e/i.test(s)) return { error: "qiymət düzgün ədəd deyil" };
  } else if (typeof v === "string") {
    s = v.replace(/[^\d.,-]/g, "");
  } else {
    return { error: "qiymət düzgün ədəd deyil" };
  }
  if (!s || s.includes("-")) return { error: "qiymət müsbət ədəd olmalıdır" };
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && s.indexOf(",") === lastComma ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot >= 0 && s.indexOf(".") !== lastDot) {
    return { error: "qiymət birmənalı deyil (bir neçə nöqtə)" };
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: "qiymət düzgün ədəd deyil" };
  const [i, f = ""] = s.split(".");
  if (f.length > 2) return { error: "qiymətdə 2-dən çox onluq rəqəm var" };
  if (i.length > 7) return { error: "qiymət çox böyükdür" };
  const num = Number(i + "." + (f + "00").slice(0, 2));
  if (!(num > 0)) return { error: "qiymət 0-dan böyük olmalıdır" };
  if (num > LIMITS.maxPrice) return { error: "qiymət çox böyükdür" };
  return { value: i.replace(/^0+(?=\d)/, "") + "." + (f + "00").slice(0, 2) };
}

export function moneyToCents(str) {
  const m = String(str).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(((m[2] || "") + "00").slice(0, 2));
}

// --- Əsas ---------------------------------------------------------------------------------------------
function cut(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max + 1);
  const sp = slice.lastIndexOf(" ");
  return (sp > max * 0.6 ? slice.slice(0, sp) : slice.slice(0, max)).replace(/[\s,.;:-]+$/, "");
}

export function normalizeTags(raw, issues = []) {
  let list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const c = cleanLine(t).replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!c) continue;
    if (c.length > LIMITS.tag) { issues.push({ code: "tag_too_long", field: "tags", severity: "warning", message: "Etiket çox uzundur və atıldı: " + c.slice(0, 20) + "..." }); continue; }
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  if (out.length > LIMITS.tags) { issues.push({ code: "too_many_tags", field: "tags", severity: "warning", message: "Etiket sayı " + LIMITS.tags + "-dən çoxdur, artıqları atıldı" }); out.length = LIMITS.tags; }
  return out;
}

function normalizeImages(raw, issues) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const u of list) {
    const url = typeof u === "string" ? u : u && typeof u === "object" ? u.url || u.src : "";
    try {
      const safe = assertSafeUrl(String(url).trim()).toString();
      if (!out.includes(safe)) out.push(safe);
    } catch (e) {
      issues.push({ code: "bad_image_url", field: "images", severity: "warning", message: "Şəkil ünvanı etibarsızdır (yalnız açıq https) və atıldı" });
    }
  }
  if (out.length > LIMITS.images) { issues.push({ code: "too_many_images", field: "images", severity: "warning", message: "Şəkil sayı " + LIMITS.images + "-dən çoxdur, artıqları atıldı" }); out.length = LIMITS.images; }
  return out;
}

export function prepareProduct(idea) {
  const issues = [];
  const missing = [];
  const err = (code, field, message) => issues.push({ code, field, severity: "error", message });
  const warn = (code, field, message) => issues.push({ code, field, severity: "warning", message });
  const src = idea && typeof idea === "object" && !Array.isArray(idea) ? idea : {};
  if (src !== idea) err("bad_input", "idea", "Məhsul ideyası obyekt olmalıdır");

  // başlıq
  const title = cleanLine(src.title !== undefined ? src.title : src.name);
  if (!title) missing.push("title");
  else if (title.length > LIMITS.title) err("title_too_long", "title", "Başlıq " + LIMITS.title + " simvoldan uzundur");

  // handle
  let handle = "";
  const rawHandle = src.handle !== undefined && cleanLine(src.handle) ? cleanLine(src.handle) : title;
  if (rawHandle) {
    handle = slugify(rawHandle);
    if (transliterate(rawHandle).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").length > LIMITS.handle) warn("handle_trimmed", "handle", "Handle " + LIMITS.handle + " simvola qısaldıldı");
    if (!handle && title) err("handle_empty", "handle", "Başlıqdan handle çıxarmaq mümkün olmadı (latın hərf/rəqəm yoxdur). Handle-ı əl ilə verin");
  }

  // təsvir
  const rawDesc = src.descriptionHtml !== undefined ? src.descriptionHtml : src.description;
  const descriptionHtml = normalizeDescription(rawDesc);
  if (!descriptionHtml) missing.push("description");
  else if (descriptionHtml.length > LIMITS.description) err("description_too_long", "descriptionHtml", "Təsvir " + LIMITS.description + " simvoldan uzundur");
  if (descriptionHtml && /<script|<iframe|\son\w+\s*=|javascript:/i.test(descriptionHtml)) err("unsafe_html", "descriptionHtml", "Təsvirdə təhlükəli HTML qaldı"); // əlavə təhlükəsizlik toru

  // valyuta
  let currency = null;
  if (src.currency !== undefined && src.currency !== null && String(src.currency).trim()) {
    const c = String(src.currency).trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(c)) currency = c;
    else err("bad_currency", "currency", "Valyuta 3 hərfli kod olmalıdır (məsələn AZN)");
  } else {
    warn("currency_unspecified", "currency", "Valyuta göstərilməyib: mağazanın valyutası istifadə olunacaq");
  }

  // qiymət
  let price = null;
  const pm = parseMoney(src.price);
  if (pm.error) err("bad_price", "price", pm.error);
  else if (!pm.missing) price = pm.value;

  // variantlar
  const variants = [];
  const rawVariants = Array.isArray(src.variants) ? src.variants : [];
  if (src.variants !== undefined && !Array.isArray(src.variants)) err("bad_variants", "variants", "variants massiv olmalıdır");
  if (rawVariants.length > LIMITS.variants) err("too_many_variants", "variants", "Variant sayı " + LIMITS.variants + "-dən çoxdur");
  const seenV = new Set();
  rawVariants.slice(0, LIMITS.variants).forEach((rv, i) => {
    const o = typeof rv === "string" ? { title: rv } : rv && typeof rv === "object" ? rv : {};
    const vt = cleanLine(o.title !== undefined ? o.title : o.name);
    if (!vt) { err("variant_title_missing", "variants[" + i + "].title", "Variantın adı yoxdur"); return; }
    if (vt.length > LIMITS.title) { err("variant_title_too_long", "variants[" + i + "].title", "Variant adı çox uzundur"); return; }
    if (seenV.has(vt.toLowerCase())) { err("variant_duplicate", "variants[" + i + "].title", "Variant adı təkrarlanır: " + vt.slice(0, 40)); return; }
    seenV.add(vt.toLowerCase());
    let sku = o.sku === undefined || o.sku === null ? null : cleanLine(o.sku);
    if (sku && !/^[A-Za-z0-9._\-/]{1,64}$/.test(sku)) { err("bad_sku", "variants[" + i + "].sku", "SKU yalnız hərf, rəqəm və . _ - / ola bilər (maks 64)"); sku = null; }
    let vp = null;
    const m = parseMoney(o.price);
    if (m.error) err("bad_price", "variants[" + i + "].price", m.error);
    else if (m.missing) vp = price;
    else vp = m.value;
    if (vp === null && !m.error) missing.push("variants[" + i + "].price");
    variants.push({ title: vt, price: vp, sku: sku || null });
  });
  if (!variants.length && price === null && !pm.error) missing.push("price");

  // stok
  let inventory = null;
  if (src.inventory !== undefined && src.inventory !== null && src.inventory !== "") {
    const n = typeof src.inventory === "number" ? src.inventory : /^\d{1,7}$/.test(String(src.inventory).trim()) ? Number(String(src.inventory).trim()) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.inventory) err("bad_inventory", "inventory", "Stok 0 ilə " + LIMITS.inventory + " arası tam ədəd olmalıdır");
    else inventory = n;
    if (inventory !== null && variants.length > 1) { err("inventory_multi_variant", "inventory", "Stok yalnız tək variantlı məhsul üçün dəstəklənir. Variantların stokunu məhsul yarandıqdan sonra ayrıca verin"); inventory = null; }
  }

  const images = normalizeImages(src.images, issues);
  if (!images.length) missing.push("images");
  const tags = normalizeTags(src.tags, issues);

  const productType = cleanLine(src.productType !== undefined ? src.productType : src.category).slice(0, LIMITS.title);
  const vendor = cleanLine(src.vendor).slice(0, LIMITS.title);

  // SEO: verilibsə təmizlənir, verilməyibsə başlıqdan/təsvirdən HƏRFİ çıxarılır (uydurma yoxdur)
  const seoIn = src.seo && typeof src.seo === "object" ? src.seo : {};
  let seoTitle = cleanLine(seoIn.title) || title;
  let seoDescription = cleanLine(seoIn.description) || htmlToText(descriptionHtml);
  if (seoTitle.length > LIMITS.seoTitle) { if (seoIn.title) warn("seo_title_trimmed", "seo.title", "SEO başlığı " + LIMITS.seoTitle + " simvola qısaldıldı"); seoTitle = cut(seoTitle, LIMITS.seoTitle); }
  if (seoDescription.length > LIMITS.seoDescription) { if (seoIn.description) warn("seo_description_trimmed", "seo.description", "SEO təsviri " + LIMITS.seoDescription + " simvola qısaldıldı"); seoDescription = cut(seoDescription, LIMITS.seoDescription - 3) + "..."; }

  const requiredMissing = missing.filter((m) => m === "title" || m === "price" || /^variants\[\d+\]\.price$/.test(m));
  const ready = !issues.some((i) => i.severity === "error") && requiredMissing.length === 0;
  return {
    title,
    handle,
    descriptionHtml,
    price,
    currency,
    variants,
    inventory,
    images,
    tags,
    productType,
    vendor,
    seo: { title: seoTitle, description: seoDescription },
    status: "DRAFT",
    issues,
    missing: [...new Set(missing)],
    ready,
  };
}

// Təsdiq qeydinə yalnız qaralamanın "icra olunan" sahələri düşür (issues/missing/ready düşmür)
export function pickDraft(d) {
  return { title: d.title, handle: d.handle, descriptionHtml: d.descriptionHtml, price: d.price, currency: d.currency, variants: d.variants, inventory: d.inventory, images: d.images, tags: d.tags, productType: d.productType, vendor: d.vendor, seo: d.seo };
}
