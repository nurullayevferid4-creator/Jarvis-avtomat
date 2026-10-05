// SalesAgent skeleti: satış işinin PLANLAMA və QARALAMA hissəsi. Heç nə GÖNDƏRMİR.
//
//  - Lead qiymətləndirməsi, söhbət planı, təklif qaralaması, follow-up planı: hamısı sabit qaydalarla (model çağırışı yoxdur),
//    hər nəticə "draft_only: true" daşıyır və göndərmə üçün Fərid-in təsdiqi tələb olunur.
//  - Göndərmə metodu YOXDUR: send() həmişə "disabled" xətası verir. Kütləvi göndərmə (broadcast/bulk) metodu mövcud deyil.
//  - Bu modul inteqrasiya reyestrinə (Instagram DM və s.) heç bir istinad etmir.
//  - consent: "denied" olan lead üçün heç bir əlaqə planı qurulmur (spam qarşısı).
//  - Lead məlumatı şəxsi məlumatdır: yalnız lazım olan sahələr, uzunluq məhdud, açara oxşar mətn gizlədilir.

import { validate } from "../validate.js";
import { scrub, makeId, AgentError } from "./common.js";

export const CHANNELS = ["instagram", "tiktok", "youtube", "telegram", "shopify", "other"];
export const STAGES = ["new", "qualified", "nurture", "won", "lost"];
export const CONSENT = ["unknown", "given", "denied"];
export const MAX_FOLLOWUPS = 3;
const DAY_MS = 24 * 3600 * 1000;

export const LEAD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", maxLength: 80 },
    handle: { type: "string", maxLength: 60 },
    channel: { type: "string", enum: CHANNELS },
    source: { type: "string", maxLength: 80 },
    interests: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 40 } },
    budget_azn: { type: "integer", minimum: 0, maximum: 1000000 },
    last_interaction_days: { type: "integer", minimum: 0, maximum: 3650 },
    followups_done: { type: "integer", minimum: 0, maximum: 100 },
    stage: { type: "string", enum: STAGES },
    consent: { type: "string", enum: CONSENT },
    notes: { type: "string", maxLength: 500 },
    ig_scoped_id: { type: "string", minLength: 1, maxLength: 30 },
  },
  required: ["channel"],
  additionalProperties: false,
};

const PRODUCTS_SCHEMA = {
  type: "array",
  maxItems: 5,
  items: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 80 }, price_azn: { type: "number", minimum: 0, maximum: 1000000 } }, required: ["name"], additionalProperties: false },
};

const bad = (errors) => new AgentError("invalid_input", "giriş düzgün deyil: " + errors.slice(0, 3).join("; "));

function checkLead(lead) {
  const v = validate(LEAD_SCHEMA, lead);
  if (!v.ok) throw bad(v.errors);
  if (lead.ig_scoped_id !== undefined && !/^\d{1,30}$/.test(lead.ig_scoped_id)) throw bad(["ig_scoped_id yalnız rəqəmlərdən ibarət olmalıdır"]);
  return {
    name: scrub(lead.name || "", 80), handle: scrub(lead.handle || "", 60), channel: lead.channel, source: scrub(lead.source || "", 80),
    interests: (lead.interests || []).map((x) => scrub(x, 40)), budget_azn: lead.budget_azn ?? null,
    last_interaction_days: lead.last_interaction_days ?? null, followups_done: lead.followups_done ?? 0,
    stage: lead.stage || "new", consent: lead.consent || "unknown", notes: scrub(lead.notes || "", 500),
    ...(lead.ig_scoped_id ? { ig_scoped_id: lead.ig_scoped_id } : {}),
  };
}

// CRM/lead qeydi interfeysi: storage ScopedStorage("leads").
export class LeadStore {
  constructor(storage, now = () => new Date()) {
    if (!storage || typeof storage.get !== "function" || typeof storage.put !== "function" || typeof storage.list !== "function") throw new Error("LeadStore: storage lazımdır");
    this.storage = storage;
    this.now = now;
  }
  async create(lead) {
    const clean = checkLead(lead);
    const id = makeId(this.now().getTime());
    await this.storage.put("lead-" + id, { id, created_at: this.now().toISOString(), ...clean });
    return { id };
  }
  async get(id) { return await this.storage.get("lead-" + id); }
  async list({ limit = 50 } = {}) {
    const { keys } = await this.storage.list({ prefix: "lead-", limit });
    const out = [];
    for (const k of keys) { const r = await this.storage.get(k); if (r) out.push(r); }
    return out;
  }
}

export class SalesAgent {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
  }

  // Lead qiymətləndirməsi: 0-100. Model yoxdur, qaydalar aşkardır və sabitdir.
  qualifyLead(lead, { minBudgetAzn = 50, catalogKeywords = [] } = {}) {
    const l = checkLead(lead);
    if (l.consent === "denied") return { score: 0, tier: "do_not_contact", reasons: ["lead əlaqəyə razılıq verməyib"], draft_only: true };
    let score = 0;
    const reasons = [];
    if (l.budget_azn !== null && l.budget_azn >= minBudgetAzn) { score += 25; reasons.push("büdcə kifayətdir"); }
    const kws = (catalogKeywords || []).map((k) => String(k).toLocaleLowerCase("az"));
    const hits = l.interests.filter((i) => kws.some((k) => i.toLocaleLowerCase("az").includes(k))).length;
    if (hits) { score += Math.min(30, hits * 15); reasons.push(hits + " maraq kataloqla uyğundur"); }
    if (l.last_interaction_days !== null) {
      if (l.last_interaction_days <= 7) { score += 20; reasons.push("son 7 gündə əlaqə olub"); }
      else if (l.last_interaction_days <= 30) { score += 10; reasons.push("son 30 gündə əlaqə olub"); }
    }
    if (l.consent === "given") { score += 15; reasons.push("əlaqəyə razılıq verib"); }
    if (["telegram", "shopify"].includes(l.channel)) { score += 10; reasons.push("birbaşa kanal"); }
    score = Math.max(0, Math.min(100, score));
    return { score, tier: score >= 60 ? "hot" : score >= 30 ? "warm" : "cold", reasons, draft_only: true };
  }

  planConversation(lead) {
    const l = checkLead(lead);
    if (l.consent === "denied") return { blocked_reason: "consent_denied", steps: [], draft_only: true };
    const steps = [
      { goal: "Ehtiyacı anlamaq", suggestion: "Açıq sual ver: nəyə görə maraqlanır, nə vaxta lazımdır?" },
      { goal: "Uyğun təklifi göstərmək", suggestion: "Maraq dairəsinə uyğun 1-2 məhsul seç, qiyməti açıq yaz." },
      { goal: "Növbəti addımı razılaşdırmaq", suggestion: "Qərarı lead-ə burax, təzyiq göstərmə." },
    ];
    return { blocked_reason: null, steps, interests: l.interests, draft_only: true };
  }

  // Təklif QARALAMASI: sabit şablon, göndərilmir.
  generateOffer(lead, { products = [] } = {}) {
    const l = checkLead(lead);
    const pv = validate(PRODUCTS_SCHEMA, products);
    if (!pv.ok) throw bad(pv.errors);
    if (l.consent === "denied") return { blocked_reason: "consent_denied", text: "", draft_only: true, requires_approval: true };
    if (!products.length) return { blocked_reason: "no_products", text: "", draft_only: true, requires_approval: true };
    const lines = products.map((p) => "- " + scrub(p.name, 80) + (p.price_azn !== undefined ? " — " + p.price_azn + " AZN" : ""));
    const text = ["Salam" + (l.name ? ", " + l.name : "") + "!", "Maraqlandığınız məhsullar üzrə təklifimiz:", ...lines, "Sualınız olsa, məmnuniyyətlə cavablayarıq."].join("\n");
    return { blocked_reason: null, text, draft_only: true, requires_approval: true };
  }

  // Növbəti əlaqə vaxtı TƏKLİFİ. Heç nə planlaşdırılmır və göndərilmir.
  planFollowUp(lead, { now } = {}) {
    const l = checkLead(lead);
    const base = { channel: l.channel, draft_only: true, requires_approval: true };
    if (l.consent === "denied") return { ...base, blocked_reason: "consent_denied", suggested_at: null };
    if (l.stage === "won" || l.stage === "lost") return { ...base, blocked_reason: "stage_closed", suggested_at: null };
    if (l.followups_done >= MAX_FOLLOWUPS) return { ...base, blocked_reason: "followup_limit", suggested_at: null };
    const t = (now instanceof Date ? now : this.now()).getTime();
    const gapDays = [2, 5, 10][l.followups_done];
    return { ...base, blocked_reason: null, suggested_at: new Date(t + gapDays * DAY_MS).toISOString(), window_days: gapDays };
  }

  // Göndərmə bu mərhələdə mövcud deyil. Heç bir kanal, heç bir təsdiq id-si bunu açmır.
  async send() {
    throw new AgentError("disabled", "mesaj göndərmə bu mərhələdə söndürülüb (yalnız qaralama)");
  }
}
