// Lead sisteminin giriş nöqtəsi. Qoşulma: registerLeadTools(registry, { store, coord, events, sender, leadSources, icp, now }).
// İcazə adları (DEFAULT_PERMISSIONS-a əlavə olunmalıdır): LEAD_PERMISSIONS = ["read.leads", "write.leads"].

export { registerLeadTools, LEAD_PERMISSIONS, presentLead } from "./tools.js";
export { createLeadRepo } from "./repo.js";
export { LeadSource, NotConfiguredLeadSource, StaticLeadSource } from "./sources.js";
export { DEFAULT_ICPS, resolveIcp, qualifyLead, scoreLead } from "./icp.js";
export { LEAD_STATUSES, SOURCE_TYPES, RESEARCH_SOURCE_TYPES, CONTACT_CHANNELS, STATUS_TRANSITIONS, parseCandidate, filterCandidate } from "./model.js";
export { researchStage, filterStage, qualifyStage, scoreStage, saveStage } from "./pipeline.js";
export { prepareMessageStage, recordManualContact } from "./contact.js";
export { MAX_RESEARCH_BATCH, MAX_DRAFTS_PER_DAY, OUTREACH_COOLDOWN_DAYS } from "./limits.js";
