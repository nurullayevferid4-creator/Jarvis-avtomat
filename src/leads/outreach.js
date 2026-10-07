// Outreach qaralaması. JARVIS mesajı GÖNDƏRMİR: yalnız mətn hazırlayır, sahib onu özü göndərir.
//
// Hər qaralamada MÜTLƏQ olan iki şey:
//   1) göndərənin aydın kimliyi ("Göndərən: Ad (Biznes)"),
//   2) imtina sətri ("Dayan" yazın).
// Bunlar mətnin sonuna kod tərəfindən əlavə olunur və doğrulanır; ixtiyari mətn bunları silə bilməz.
// Lead-in qeyd/ehtiyac mətni (xarici, etibarsız) qaralamaya DAXİL EDİLMİR.

import { getBrand } from "../marketing/brands.js";
import { cleanText, detectInjection } from "../security/sanitize.js";

export const OPT_OUT_LINE = 'İstəmirsinizsə "Dayan" yazın, bir daha yazmayacağam.';
export const SENDER_PREFIX = "Göndərən: ";
export const MESSAGE_MAX = 900;
export const BODY_MAX = 600;
const URL_RE = /(?:https?:\/\/|www\.)[^\s)>\]"']+/gi;

export function resolveSender(brand, sender = {}) {
  const name = String((sender && sender.name) || "Fərid").trim().slice(0, 60);
  const business = String((sender && sender.business) || brand.name).trim().slice(0, 60);
  const contact = sender && sender.contact ? String(sender.contact).trim().slice(0, 100) : "";
  const links = Array.isArray(sender && sender.links) ? sender.links.map(String).filter((l) => /^https:\/\//.test(l)).slice(0, 3) : [];
  return { name, business, contact, links };
}

export function buildFooter(sender) {
  const who = SENDER_PREFIX + sender.name + " (" + sender.business + ")" + (sender.contact ? ", " + sender.contact : "") + ".";
  return "\n\n—\n" + who + " Əlaqə məlumatınızı açıq biznes mənbəyindən gördüm. " + OPT_OUT_LINE;
}

function greeting(lead) {
  const flagged = detectInjection(lead.business_name || "").length > 0;
  const n = cleanText(lead.business_name || "", 60).text.replace(/[<>\n\r]/g, " ").trim();
  return n && !flagged ? "Salam, " + n + " komandası!" : "Salam!";
}

// Şablon mətn. Qiymət, nəticə və müqayisə iddiası yoxdur.
function templateBody(lead, brand, sender) {
  if (brand.id === "qr_menu") {
    return greeting(lead) + "\n" + sender.name + " yazır. QR menyu xidməti təklif edirəm: müştəri masadakı QR kodu telefonla oxudur, menyu telefonunda açılır.\nNümunə səhifə: " + brand.page_url + "\nMaraqlanırsınızsa, qısa cavab yazmağınız kifayətdir.";
  }
  return greeting(lead) + "\n" + sender.name + " yazır, " + brand.name + " brendindən. Əməkdaşlıq imkanını müzakirə etmək istəyirəm. Maraqlanırsınızsa, cavab yazın, ətraflı məlumat göndərərəm.";
}

// Qaytarır: { message, errors:[] }
export function buildOutreachMessage({ lead, brandId, sender, body }) {
  const brand = getBrand(brandId);
  const errors = [];
  if (!brand) return { message: "", errors: ["naməlum brend/məhsul: " + brandId] };
  const s = resolveSender(brand, sender);
  let text = body ? cleanText(String(body), BODY_MAX + 1).text.trim() : templateBody(lead, brand, s);
  if (body && text.length > BODY_MAX) errors.push("mətn çox uzundur (maks " + BODY_MAX + ")");
  text = text.slice(0, BODY_MAX);
  const footer = buildFooter(s);
  const message = text.includes(footer.trim()) ? text : text + footer;
  errors.push(...validateOutreachMessage(message, { sender: s, brand }));
  return { message, errors, sender: s, brand_id: brand.id };
}

// Kod səviyyəsində məcburi yoxlama (qaralama yaradanda və icra qeydində təkrar işləyir)
export function validateOutreachMessage(message, { sender, brand }) {
  const errors = [];
  const m = String(message || "");
  if (!m.trim()) errors.push("mesaj boşdur");
  if (m.length > MESSAGE_MAX) errors.push("mesaj çox uzundur (maks " + MESSAGE_MAX + ")");
  if (!m.includes(SENDER_PREFIX + sender.name)) errors.push("göndərənin kimliyi mətndə yoxdur");
  if (!m.includes(OPT_OUT_LINE)) errors.push("imtina (opt-out) sətri mətndə yoxdur");
  const allowed = new Set([...(brand.allowed_links || []), ...(sender.links || [])].map((x) => x.replace(/\/+$/, "")));
  for (const raw of m.match(URL_RE) || []) {
    const u = raw.replace(/[.,;:!?]+$/, "").replace(/\/+$/, "");
    if (!allowed.has(u)) errors.push("icazəsiz link: " + u.slice(0, 60));
  }
  if (brand.forbidden_pattern && brand.forbidden_pattern.test(m)) errors.push("mətndə qadağan mövzu var (" + brand.forbidden_label + ")");
  return errors;
}

// Təsdiq xülasəsi. Yalnız payload-dan çıxarılır (runner icradan əvvəl yenidən hesablayıb müqayisə edir).
export function describeOutreach(payload) {
  const i = (payload && payload.input) || {};
  return [
    "Lead outreach: ƏL İLƏ GÖNDƏRMƏ QEYDİ",
    "Lead: " + (i.lead_label || "?") + " (" + i.lead_id + ")",
    "Kanal: " + (i.channel || "?"),
    "",
    "Mesaj qaralaması:",
    String(i.message || ""),
    "",
    "Bu qeydi təsdiq etməklə mesajı ÖZÜNÜZ göndərdiyinizi qeyd edirsiniz. JARVIS heç nə göndərmir.",
  ].join("\n");
}
