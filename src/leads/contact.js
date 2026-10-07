// PREPARE MESSAGE və CONTACT mərhələləri. JARVIS heç vaxt lead-ə özü mesaj göndərmir.
//
//  prepareMessageStage : anti-spam qaydalarını yoxlayır, qaralama yaradır, lead-i "awaiting_approval"-a keçirir,
//                        təsdiq qeydi üçün { content, payload } qaytarır (qeydi registry yaradır).
//  recordManualContact : sahib təsdiq edəndən sonra çağırılır. YALNIZ "əl ilə göndərildi" qeydi yazır:
//                        şəbəkə çağırışı yoxdur, nəticə mətni "manual send recorded"-dir ("sent" deyil).

import { AppError } from "../errors.js";
import { detectInjection } from "../security/sanitize.js";
import { makeId } from "../state/store.js";
import { APPROVAL_TTL_DAYS } from "../policy.js";
import { CONTACT_CHANNELS } from "./model.js";
import { buildOutreachMessage, describeOutreach, validateOutreachMessage, resolveSender } from "./outreach.js";
import { getBrand } from "../marketing/brands.js";
import { MIN_OUTREACH_SCORE, OUTREACH_COOLDOWN_DAYS } from "./limits.js";

const DAY_MS = 86400000;

export function lastOutreachTs(lead) {
  let last = 0;
  for (const o of lead.outreach || []) if (o.state !== "cancelled") last = Math.max(last, Date.parse(o.ts) || 0);
  return last;
}

export function availableChannels(lead) {
  const out = [];
  const c = lead.public_contact;
  if (c && c.listed_publicly === true && c.value && CONTACT_CHANNELS.includes(c.channel)) out.push(c.channel);
  if (lead.instagram) out.push("instagram_dm");
  if (lead.website) out.push("website_form");
  if (lead.tiktok) out.push("tiktok_dm");
  return [...new Set(out)];
}

// Gözləyən qaralamanı ləğv edir (lead-in statusunu dəyişmir; çağıran dəyişir)
export function cancelPendingOutreach(lead) {
  for (const o of lead.outreach || []) if (o.state === "prepared") o.state = "cancelled";
  lead.draft = null;
}

function setStatus(lead, status, reason, iso) {
  lead.status = status;
  lead.history = [...(lead.history || []), { ts: iso, status, reason: String(reason).slice(0, 160) }].slice(-30);
}

// deps: { now, limits:{maxDraftsPerDay, cooldownDays, minScore}, sender, defaultProduct }
export async function prepareMessageStage(tx, deps, input) {
  const t = deps.now();
  const iso = new Date(t).toISOString();
  const lead = await tx.getLead(input.lead_id);
  if (!lead) throw new AppError("NOT_FOUND", "Lead tapılmadı");

  // do_not_contact: həm sənəddə, həm indeksdə yoxlanır
  const entry = (await tx.entries()).find((e) => e.id === lead.id);
  if (lead.status === "do_not_contact" || (entry && entry.st === "do_not_contact")) {
    throw new AppError("CONFLICT", "Bu lead do_not_contact siyahısındadır: mesaj hazırlanmır");
  }

  // Təsdiq gözləyən qaralama: təzədirsə ikinci qaralama yoxdur; vaxtı keçibsə ləğv edilir
  if (lead.status === "awaiting_approval") {
    const stale = lead.draft && t - (lead.draft.created_ts || 0) > APPROVAL_TTL_DAYS * DAY_MS;
    if (!stale) throw new AppError("CONFLICT", "Bu lead üçün təsdiq gözləyən qaralama artıq var");
    cancelPendingOutreach(lead);
    setStatus(lead, "message_ready", "köhnəlmiş qaralama ləğv edildi", iso);
  }
  if (!["scored", "message_ready"].includes(lead.status)) throw new AppError("VALIDATION_ERROR", 'Outreach yalnız "scored" və ya "message_ready" lead üçün hazırlanır; cari status: ' + lead.status);
  const minScore = Math.max(deps.limits.minScore, MIN_OUTREACH_SCORE);
  if (typeof lead.score !== "number" || lead.score < minScore) throw new AppError("VALIDATION_ERROR", "Lead balı kifayət etmir (min " + minScore + ", cari " + lead.score + ")");

  // 30 gün qaydası
  const last = lastOutreachTs(lead);
  if (last && t - last < deps.limits.cooldownDays * DAY_MS) {
    throw new AppError("CONFLICT", "Bu lead-ə son " + deps.limits.cooldownDays + " gündə artıq outreach hazırlanıb (" + new Date(last).toISOString().slice(0, 10) + ")");
  }
  // Gündəlik limit
  const today = await tx.outreachToday();
  if (today >= deps.limits.maxDraftsPerDay) throw new AppError("RATE_LIMIT", "Gündəlik outreach qaralaması limiti dolub (" + deps.limits.maxDraftsPerDay + "). Sabah yenidən cəhd edin.");

  // Kanal: yalnız lead-in İCTİMAI əlaqə yolları
  const routes = availableChannels(lead);
  const channel = input.channel || routes[0];
  if (!channel || !routes.includes(channel)) throw new AppError("VALIDATION_ERROR", "Bu lead üçün ictimai əlaqə kanalı yoxdur və ya seçilən kanal uyğun deyil (mümkün: " + (routes.join(", ") || "yoxdur") + ")");

  const brandId = input.product || lead.icp_product || deps.defaultProduct;
  const built = buildOutreachMessage({ lead, brandId, sender: deps.sender, body: input.message });
  if (built.errors.length) throw new AppError("VALIDATION_ERROR", "Qaralama qaydalara uyğun deyil: " + built.errors.join("; ").slice(0, 200));

  const draft = { id: makeId(t), channel, product: brandId, message: built.message, created_at: iso, created_ts: t, state: "prepared" };
  lead.draft = draft;
  lead.outreach = [...(lead.outreach || []), { draft_id: draft.id, ts: iso, channel, state: "prepared" }].slice(-20);
  if (lead.status === "scored") setStatus(lead, "message_ready", "outreach qaralaması hazırlandı", iso);
  setStatus(lead, "awaiting_approval", "sahibin təsdiqi gözlənilir", iso);
  lead.next_action = "Mesajı özünüz göndərin, sonra təsdiq verin (əl ilə göndərmə qeydi)";
  await tx.putLead(lead);
  await tx.logOutreach(lead.id, draft.id);

  const payload = { input: { lead_id: lead.id, channel, product: brandId, message: built.message, draft_id: draft.id, lead_label: detectInjection(lead.business_name || "").length ? "(ad şübhəli mətn ehtiva edir, lead.get ilə yoxlayın)" : String(lead.business_name || "").slice(0, 120) } };
  return { content: describeOutreach(payload).slice(0, 4000), payload, lead, draft };
}

// Sahib təsdiq etdi: mesajı ÖZÜ göndərdiyini qeyd edir. Göndərmə YOXDUR.
export async function recordManualContact(tx, deps, input, ctx = {}) {
  const lead = await tx.getLead(input.lead_id);
  if (!lead) throw new AppError("NOT_FOUND", "Lead tapılmadı");
  const entry = (await tx.entries()).find((e) => e.id === lead.id);
  if (lead.status === "do_not_contact" || (entry && entry.st === "do_not_contact")) {
    throw new AppError("CONFLICT", "Lead do_not_contact siyahısına düşüb: əl ilə göndərmə qeyd edilmədi. Mesajı göndərməyin.");
  }
  if (!["awaiting_approval", "approved"].includes(lead.status) || !lead.draft || lead.draft.id !== input.draft_id || lead.draft.state !== "prepared") {
    throw new AppError("CONFLICT", "Qaralama artıq etibarsızdır (ləğv edilib və ya dəyişib). Yenidən hazırlayın.");
  }
  if (lead.draft.message !== input.message) throw new AppError("SECURITY_ERROR", "Qaralama mətni təsdiq edilmiş mətnlə uyğun gəlmir");
  const brand = getBrand(input.product || lead.draft.product);
  const errs = brand ? validateOutreachMessage(lead.draft.message, { sender: resolveSender(brand, deps.sender), brand }) : ["brend tapılmadı"];
  if (errs.length) throw new AppError("VALIDATION_ERROR", "Qaralama qaydalara uyğun deyil: " + errs.join("; ").slice(0, 200));

  const iso = new Date(deps.now()).toISOString();
  for (const o of lead.outreach || []) if (o.draft_id === lead.draft.id) Object.assign(o, { state: "manual_send_recorded", recorded_at: iso, approval_id: ctx.approvalId || null });
  lead.draft = { ...lead.draft, state: "manual_send_recorded", sent_by_jarvis: false };
  setStatus(lead, "contacted_manually", "sahib əl ilə göndərdiyini təsdiqlədi", iso);
  lead.next_action = "Cavabı gözləyin; cavab gəlsə lead.update_status ilə replied";
  await tx.putLead(lead);
  return { lead_id: lead.id, status: "contacted_manually", result: "manual send recorded", sent_by_jarvis: false, channel: lead.draft.channel };
}
