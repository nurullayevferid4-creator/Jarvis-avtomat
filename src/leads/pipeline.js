// Lead boru xətti: RESEARCH -> FILTER -> QUALIFY -> SCORE -> SAVE -> PREPARE MESSAGE -> HUMAN APPROVAL -> CONTACT.
// Hər mərhələ ayrıca, açıq funksiyadır. Qaydalar deterministikdir (model çağırışı yoxdur).
//
//  1. researchStage   : LeadSource interfeysindən (və ya hazır namizədlərdən) ən çox 10 namizəd alır. Real axtarış YOXDUR.
//  2. filterStage     : forma + iş qaydaları (mənbə, ictimai kontakt, şəxsi şəxs, təkrar, do_not_contact)
//  3. qualifyStage    : ICP-yə uyğunluq
//  4. scoreStage      : 0-100 bal, amillərin izahı ilə
//  5. saveStage       : lead-i saxlayır (tx daxilində; təkrar yoxlaması ilə eyni tranzaksiyada)
//  6. prepare message : src/leads/tools.js -> lead.outreach.prepare (qaralama + təsdiq qeydi)
//  7. human approval  : ApprovalCenter; sahib təsdiq edir
//  8. contact         : recordManualContact: yalnız "əl ilə göndərildi" qeydi, heç nə göndərilmir

import { AppError } from "../errors.js";
import { parseCandidate, filterCandidate, canTransition, RESEARCH_SOURCE_TYPES } from "./model.js";
import { qualifyLead, scoreLead } from "./icp.js";
import { MAX_RESEARCH_BATCH } from "./limits.js";

// 1) RESEARCH
// source: LeadSource (src/leads/sources.js) və ya null; candidates: hazır namizədlər (məs. sahibin və ya ChatGPT-nin tapdıqları)
export async function researchStage({ source = null, query = "", candidates = [], product = "" } = {}) {
  let raw = Array.isArray(candidates) ? [...candidates] : [];
  const rejected = [];
  if (source) {
    const found = await source.search({ query: String(query || "").slice(0, 200), limit: MAX_RESEARCH_BATCH, product });
    for (const c of Array.isArray(found) ? found : []) {
      const st = c && c.source && c.source.source_type;
      if (!source.allowedSourceTypes.includes(st) || !RESEARCH_SOURCE_TYPES.includes(st)) {
        rejected.push({ business_name: String((c && c.business_name) || "").slice(0, 60), reasons: [{ code: "source_type_not_allowed", message: "Mənbə bu LeadSource üçün icazəli növdə deyil" }] });
        continue;
      }
      raw.push(c);
    }
  }
  const truncated = raw.length > MAX_RESEARCH_BATCH;
  return { candidates: raw.slice(0, MAX_RESEARCH_BATCH), truncated, rejected };
}

// 2) FILTER. Qaytarır: { pass, reasons, warnings, lead, findings, duplicate_of, keys }
export function filterStage(rawCandidate, existingEntries, opts = {}) {
  const p = parseCandidate(rawCandidate);
  if (!p.ok) {
    return { pass: false, reasons: p.errors.map((m) => ({ code: "invalid_candidate", message: m })), warnings: [], lead: null, findings: p.findings || [], duplicate_of: null, keys: null };
  }
  const f = filterCandidate(p.lead, existingEntries, opts);
  return { ...f, lead: p.lead, findings: p.findings };
}

// 3) QUALIFY
export function qualifyStage(lead, icp) {
  return qualifyLead(lead, icp);
}

// 4) SCORE
export function scoreStage(lead, icp) {
  return scoreLead(lead, icp);
}

// 5) SAVE. filtered: filterStage nəticəsi (pass:true). tx: repo.tx daxilindəki Tx.
// ICP-yə uyğun deyilsə lead "filtered_out" statusu ilə saxlanır (təkrar araşdırılmasın deyə), uyğundursa "scored".
export async function saveStage(tx, filtered, { icp, product, via = "lead.save" }) {
  const q = qualifyStage(filtered.lead, icp);
  const s = scoreStage(filtered.lead, icp);
  const trail = [{ status: "new", reason: "yaradıldı (" + via + ")" }];
  if (q.qualified) {
    trail.push({ status: "qualified", reason: "ICP-yə uyğundur (" + q.category_fit + ")" });
    trail.push({ status: "scored", reason: "bal: " + s.score });
  } else {
    trail.push({ status: "filtered_out", reason: q.reasons.join("; ").slice(0, 150) });
  }
  const doc = await tx.insertLead(
    {
      ...filtered.lead,
      next_action: filtered.lead.next_action || (q.qualified ? "Outreach qaralaması hazırlamaq (lead.outreach.prepare)" : "ICP-yə uyğun deyil: yoxlayın və ya buraxın"),
      score: s.score,
      score_factors: s.factors,
      qualification: { qualified: q.qualified, reasons: q.reasons, category_fit: q.category_fit },
      icp_product: product,
      injection_findings: filtered.findings || [],
      warnings: filtered.warnings || [],
      draft: null,
    },
    trail,
  );
  return doc;
}

// Status yolu: bal yenidən hesablananda yalnız ilkin mərhələ statusları arasında hərəkət olunur
const EARLY = new Set(["new", "qualified", "scored", "filtered_out"]);
export function rescorePath(from, qualified) {
  if (!EARLY.has(from)) return null; // sonrakı mərhələdə status dəyişmir
  const target = qualified ? "scored" : "filtered_out";
  const path = [];
  let cur = from;
  const next = { filtered_out: "new", new: "qualified", qualified: "scored" };
  if (target === "filtered_out") return cur === "filtered_out" ? [] : ["filtered_out"];
  while (cur !== target) {
    cur = next[cur];
    if (!cur) return null;
    path.push(cur);
  }
  return path;
}

export function applyStatusPath(doc, path, reason, at) {
  for (const st of path) {
    if (!canTransition(doc.status, st)) throw new AppError("VALIDATION_ERROR", "Status keçidi mümkün deyil: " + doc.status + " -> " + st);
    doc.status = st;
    doc.history = [...(doc.history || []), { ts: at, status: st, reason: String(reason).slice(0, 160) }].slice(-30);
  }
}
