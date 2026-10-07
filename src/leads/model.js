// Lead modeli, doğrulama və normallaşdırma. Burada heç bir şəbəkə və ya yaddaş çağırışı yoxdur.
//
// Qaydalar:
//  - Yalnız ictimai biznes məlumatı: şəxsi şəxslər, qapalı kontaktlar və alınmış siyahılar qəbul edilmir.
//  - Xarici mətn (qeyd, ehtiyac, ad) MƏLUMATDIR, əmr deyil: təmizlənir, injection izləri işarələnir, heç vaxt icra olunmur.

import { assertSafeUrl } from "../security/ssrf.js";
import { cleanText, detectInjection } from "../security/sanitize.js";
import { normalize } from "../util.js";

export const LEAD_STATUSES = ["new", "filtered_out", "qualified", "scored", "message_ready", "awaiting_approval", "approved", "contacted_manually", "replied", "won", "lost", "do_not_contact"];
export const SOURCE_TYPES = ["public_web", "public_directory", "social_public_profile", "manual_owner", "referral"];
// Araşdırma alətinin qəbul etdiyi mənbə növləri: yalnız açıq ünvanı olanlar
export const RESEARCH_SOURCE_TYPES = ["public_web", "public_directory", "social_public_profile"];
export const CONTACT_CHANNELS = ["instagram_dm", "website_form", "business_email", "business_phone", "telegram_public", "tiktok_dm", "other_public"];
export const ENTITY_TYPES = ["business", "individual", "unknown"];

// Status keçid cədvəli. do_not_contact son haldır: alətlərlə geri qaytarılmır.
export const STATUS_TRANSITIONS = {
  new: ["filtered_out", "qualified", "do_not_contact", "lost"],
  filtered_out: ["new", "do_not_contact"],
  qualified: ["scored", "filtered_out", "do_not_contact", "lost"],
  scored: ["message_ready", "qualified", "filtered_out", "do_not_contact", "lost"],
  message_ready: ["awaiting_approval", "scored", "do_not_contact", "lost"],
  awaiting_approval: ["approved", "message_ready", "contacted_manually", "do_not_contact", "lost"],
  approved: ["contacted_manually", "message_ready", "do_not_contact", "lost"],
  contacted_manually: ["replied", "won", "lost", "do_not_contact"],
  replied: ["won", "lost", "do_not_contact"],
  won: ["do_not_contact"],
  lost: ["new", "do_not_contact"],
  do_not_contact: [],
};

// Bu statuslar yalnız xüsusi axınla qoyulur (lead.update_status ilə birbaşa yox)
export const FLOW_ONLY_STATUSES = ["awaiting_approval", "contacted_manually", "do_not_contact"];

export function canTransition(from, to) {
  return (STATUS_TRANSITIONS[from] || []).includes(to);
}

// Bu hostlar paylaşılan platformalardır: "sayt" açarına yol da daxil edilir
const SHARED_HOSTS = new Set(["instagram.com", "facebook.com", "tiktok.com", "linktr.ee", "wa.me", "t.me", "youtube.com", "google.com", "goo.gl", "maps.app.goo.gl", "bio.link", "taplink.cc", "vk.com", "linkedin.com", "twitter.com", "x.com"]);

const FORBIDDEN_SOURCE_HINT = /(purchased|bought\s+list|buy\s+list|leaked|data\s?breach|dump|scraped\s+at\s+scale|satın\s*alınmış|alınmış\s+siyahı|sızdırılmış|oğurlanmış)/i;
const PRIVATE_CATEGORY = /(private|individual|personal|şəxsi|fiziki\s*şəxs|fərdi\s*şəxs)/i;

export function clip(v, max) {
  if (v === undefined || v === null) return "";
  return cleanText(String(v), max).text.replace(/\s+/g, " ").trim().slice(0, max);
}

function clipMulti(v, max) {
  if (v === undefined || v === null) return "";
  return cleanText(String(v), max).text.trim().slice(0, max);
}

// ---- açar normallaşdırması (təkrar yoxlaması üçün) ----
export function normWebsite(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch (e) {
    return "";
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".")) return "";
  if (SHARED_HOSTS.has(host)) {
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return path && path !== "/" ? host + path : "";
  }
  return host;
}

// "@Name", "instagram.com/name/?x=1", "name" -> "name"
export function normHandle(input, hostHint) {
  let s = String(input || "").trim();
  if (!s) return "";
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+)\/@?([^/?#\s]+)/i);
  if (m) {
    const host = m[1].toLowerCase();
    if (hostHint && !host.endsWith(hostHint)) return "";
    s = m[2];
  }
  s = s.replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,40}$/.test(s) ? s : "";
}

export function normNameLocation(name, location) {
  const n = normalize(name);
  const l = normalize(location);
  return n && l ? n + "|" + l : "";
}

export function leadKeys(lead) {
  return {
    wk: normWebsite(lead.website),
    ik: normHandle(lead.instagram, "instagram.com"),
    tk: normHandle(lead.tiktok, "tiktok.com"),
    nk: normNameLocation(lead.business_name, lead.location),
  };
}

// ---- doğrulama ----
function safeHttps(u) {
  try {
    return assertSafeUrl(u).toString().slice(0, 500);
  } catch (e) {
    return "";
  }
}

function toWebsite(v) {
  const raw = String(v || "").trim();
  if (!raw) return { value: "" };
  // Sayt yalnız saxlanılır (bu sistem onu açmır). http:// yazılışı https:// kimi saxlanır ki, təkrar yoxlaması eyni açarı versin.
  const withScheme = /^http:\/\//i.test(raw) ? "https://" + raw.slice(7) : /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw;
  const safe = safeHttps(withScheme);
  return safe ? { value: safe } : { error: "sayt ünvanı etibarlı ictimai ünvan deyil" };
}

// Namizəd (xam giriş) -> təmizlənmiş lead sahələri. Qaytarır: { ok, lead, errors, findings }
// Burada YALNIZ forma yoxlanır; iş qaydaları (filtr) ayrıca funksiyadır.
export function parseCandidate(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["lead obyekt olmalıdır"], lead: null, findings: [] };
  const i = input;

  const business_name = clip(i.business_name, 120);
  const contact_name = clip(i.contact_name, 80);
  const category = clip(i.category, 60);
  const location = clip(i.location, 100);
  const need = clipMulti(i.need, 500);
  const notes = clipMulti(i.notes, 1000);
  const next_action = clip(i.next_action, 200);

  const web = toWebsite(i.website);
  if (web.error) errors.push(web.error);

  const instagram = normHandle(i.instagram, "instagram.com");
  if (i.instagram && !instagram) errors.push("instagram ünvanı düzgün deyil");
  const tiktok = normHandle(i.tiktok, "tiktok.com");
  if (i.tiktok && !tiktok) errors.push("tiktok ünvanı düzgün deyil");

  // ictimai kontakt
  let public_contact = null;
  if (i.public_contact !== undefined && i.public_contact !== null) {
    const c = i.public_contact;
    if (typeof c !== "object" || Array.isArray(c)) errors.push("public_contact obyekt olmalıdır");
    else public_contact = { channel: clip(c.channel, 30), value: clip(c.value, 200), listed_publicly: c.listed_publicly === true };
  }

  // mənbə
  let source = null;
  if (i.source !== undefined && i.source !== null) {
    const s = i.source;
    if (typeof s !== "object" || Array.isArray(s)) errors.push("source obyekt olmalıdır");
    else {
      source = { url: "", source_type: clip(s.source_type, 40), note: clip(s.note, 200) };
      if (s.url) {
        const safe = safeHttps(s.url);
        if (!safe) errors.push("source.url etibarlı açıq https ünvan deyil");
        source.url = safe;
      }
    }
  }

  let confidence = 0.5;
  if (i.confidence !== undefined && i.confidence !== null) {
    const n = Number(i.confidence);
    if (!Number.isFinite(n) || n < 0 || n > 1) errors.push("confidence 0..1 arasında olmalıdır");
    else confidence = Math.round(n * 100) / 100;
  }

  const entity_type = i.entity_type === undefined ? "unknown" : String(i.entity_type);
  if (!ENTITY_TYPES.includes(entity_type)) errors.push("entity_type düzgün deyil");

  // xarici mətndə injection izləri: yalnız işarələnir, məzmun əmr kimi icra edilmir
  const findings = [...new Set([...detectInjection(notes), ...detectInjection(need), ...detectInjection(business_name), ...detectInjection(contact_name), ...detectInjection(next_action), ...detectInjection(category), ...detectInjection(location), ...detectInjection(public_contact ? public_contact.value : "")])];

  const lead = { business_name, contact_name, public_contact, website: web.value || "", instagram, tiktok, category, location, need, source, confidence, entity_type, notes, next_action };
  return { ok: errors.length === 0, errors, lead, findings };
}

// ---- filtr (deterministik iş qaydaları) ----
// existing: [{id, st, wk, ik, tk, nk}] indeks girişləri. Qaytarır: { pass, reasons:[{code,message}], warnings, duplicate_of }
export function filterCandidate(lead, existing = [], { requirePublicSourceUrl = false } = {}) {
  const reasons = [];
  const warnings = [];
  let duplicate_of = null;
  const add = (code, message) => reasons.push({ code, message });

  // 1) mənbə
  const s = lead.source;
  if (!s || !s.source_type) add("missing_source", "Mənbə (source.source_type) göstərilməyib");
  else if (!SOURCE_TYPES.includes(s.source_type)) add("bad_source_type", "Mənbə növü icazəli deyil: " + s.source_type);
  else if (RESEARCH_SOURCE_TYPES.includes(s.source_type) && !s.url) add("missing_source", "Açıq mənbə üçün source.url məcburidir");
  else if (!RESEARCH_SOURCE_TYPES.includes(s.source_type) && !s.url && !s.note) add("missing_source", "manual_owner/referral üçün source.note (mənbənin təsviri) məcburidir");
  else if (requirePublicSourceUrl && !RESEARCH_SOURCE_TYPES.includes(s.source_type)) add("bad_source_type", "Araşdırma yalnız açıq mənbə növlərini qəbul edir");
  if (s && FORBIDDEN_SOURCE_HINT.test([s.note, lead.notes].join(" "))) add("forbidden_source", "Alınmış, sızdırılmış və ya kütləvi toplanmış siyahı qəbul edilmir");

  // 2) şəxsi şəxslər
  if (!lead.business_name) add("private_person", "Biznes adı yoxdur: yalnız biznes qəbul edilir");
  if (lead.entity_type === "individual" || PRIVATE_CATEGORY.test(lead.category || "")) add("private_person", "Fiziki/şəxsi şəxs qəbul edilmir");

  // 3) kontakt: yalnız ictimai biznes kontaktı
  const c = lead.public_contact;
  if (c) {
    if (!CONTACT_CHANNELS.includes(c.channel)) add("non_public_contact", "Kontakt kanalı ictimai biznes kanalı deyil: " + (c.channel || "boş"));
    else if (c.listed_publicly !== true) add("non_public_contact", "Kontakt ictimai dərc edilmiş kimi təsdiqlənməyib");
    else if (!c.value) add("non_public_contact", "Kontakt dəyəri boşdur");
  }
  const hasRoute = (c && CONTACT_CHANNELS.includes(c.channel) && c.listed_publicly === true && c.value) || lead.website || lead.instagram || lead.tiktok;
  if (!hasRoute) add("no_public_contact", "İctimai əlaqə yolu (kontakt, sayt, instagram və ya tiktok) yoxdur");

  // 4) təkrar və do_not_contact
  const k = leadKeys(lead);
  let firstHit = null;
  let dncHit = null;
  for (const e of existing) {
    let why = "";
    if (k.wk && e.wk === k.wk) why = "duplicate_website";
    else if (k.ik && e.ik === k.ik) why = "duplicate_instagram";
    else if (k.tk && e.tk === k.tk) why = "duplicate_tiktok";
    else if (k.nk && e.nk === k.nk) why = "duplicate_name_location";
    if (!why) continue;
    if (!firstHit) firstHit = { e, why };
    if (e.st === "do_not_contact" && !dncHit) dncHit = { e, why };
  }
  // do_not_contact uyğunluğu həmişə üstündür (başqa təkrar da olsa)
  const hit = dncHit || firstHit;
  if (hit) {
    duplicate_of = hit.e.id;
    if (hit.e.st === "do_not_contact") add("do_not_contact", "Bu biznes do_not_contact siyahısındadır (" + hit.why + ")");
    else add(hit.why, "Eyni lead artıq var: " + hit.e.id);
  }

  if (lead.entity_type === "unknown") warnings.push("entity_type məlum deyil: biznes olduğu yoxlanmalıdır");
  if (!lead.location) warnings.push("məkan göstərilməyib");
  return { pass: reasons.length === 0, reasons, warnings, duplicate_of, keys: k };
}
