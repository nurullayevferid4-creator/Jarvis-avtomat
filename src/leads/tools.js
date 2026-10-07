// Lead alətləri. Hamısı "low" risklidir (yalnız daxili məlumat), istisna: lead.outreach.prepare.
//
// lead.outreach.prepare: risk high, icazə send.message, həmişə təsdiq tələb edir. Alət heç nə GÖNDƏRMİR:
//   - qaralama yaradır və lead-i "awaiting_approval"-a keçirir,
//   - təsdiq qeydi (kind "lead.outreach") açır,
//   - sahib təsdiq edəndə approval.execute YALNIZ "əl ilə göndərildi" qeydini yazır (contacted_manually).
//
// İcazə adları (src/policy.js DEFAULT_PERMISSIONS-a əlavə olunmalıdır): read.leads, write.leads.

import { AppError } from "../errors.js";
import { wrapExternal } from "../security/sanitize.js";
import { createLeadRepo } from "./repo.js";
import { LEAD_STATUSES, CONTACT_CHANNELS, ENTITY_TYPES, FLOW_ONLY_STATUSES, canTransition, parseCandidate, leadKeys } from "./model.js";
import { resolveIcp, scoreLead, qualifyLead, DEFAULT_ICPS } from "./icp.js";
import { researchStage, filterStage, saveStage, rescorePath, applyStatusPath } from "./pipeline.js";
import { prepareMessageStage, recordManualContact, cancelPendingOutreach } from "./contact.js";
import { describeOutreach } from "./outreach.js";
import { MAX_RESEARCH_BATCH, MAX_RESEARCH_SAVED_PER_DAY, MAX_DRAFTS_PER_DAY, OUTREACH_COOLDOWN_DAYS, MIN_OUTREACH_SCORE, limitMin } from "./limits.js";

export const LEAD_PERMISSIONS = ["read.leads", "write.leads"];
const PRODUCTS = Object.keys(DEFAULT_ICPS);

const candidateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    business_name: { type: "string", maxLength: 120 },
    contact_name: { type: "string", maxLength: 80 },
    public_contact: {
      type: "object",
      additionalProperties: false,
      properties: { channel: { type: "string", maxLength: 30 }, value: { type: "string", maxLength: 200 }, listed_publicly: { type: "boolean" } },
    },
    website: { type: "string", maxLength: 500 },
    instagram: { type: "string", maxLength: 200 },
    tiktok: { type: "string", maxLength: 200 },
    category: { type: "string", maxLength: 60 },
    location: { type: "string", maxLength: 100 },
    need: { type: "string", maxLength: 500 },
    source: {
      type: "object",
      additionalProperties: false,
      properties: { url: { type: "string", maxLength: 500 }, source_type: { type: "string", maxLength: 40 }, note: { type: "string", maxLength: 200 } },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    entity_type: { type: "string", enum: ENTITY_TYPES },
    notes: { type: "string", maxLength: 1000 },
    next_action: { type: "string", maxLength: 200 },
  },
};

const reasonSchema = { type: "array", items: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } };
const idProp = { type: "string", minLength: 10, maxLength: 24 };
const productProp = { type: "string", enum: PRODUCTS };

// Xarici mətn modelə yalnız <external_content> qutusunda çıxır. Saxlanan məlumat dəyişmir.
function ext(text, source) {
  if (!text) return "";
  return wrapExternal(text, { source, maxLen: 1500 }).text;
}

function presentName(doc) {
  const t = String(doc.business_name || "");
  return (doc.injection_findings || []).length ? ext(t, "lead.business_name") : t;
}

export function presentLead(doc) {
  // Şübhəli izlər tapılıbsa bütün sərbəst mətn sahələri qutuda verilir
  const flagged = (doc.injection_findings || []).length > 0;
  const f = (v, label) => (flagged && v ? ext(String(v), label) : v || "");
  const pc = doc.public_contact ? { ...doc.public_contact, value: f(doc.public_contact.value, "lead.public_contact") } : null;
  return {
    id: doc.id,
    business_name: presentName(doc),
    contact_name: f(doc.contact_name, "lead.contact_name"),
    public_contact: pc,
    website: doc.website || "",
    instagram: doc.instagram || "",
    tiktok: doc.tiktok || "",
    category: f(doc.category, "lead.category"),
    location: f(doc.location, "lead.location"),
    need: ext(doc.need, "lead.need"),
    source: doc.source || null,
    confidence: doc.confidence,
    entity_type: doc.entity_type || "unknown",
    status: doc.status,
    notes: ext(doc.notes, "lead.notes"),
    next_action: f(doc.next_action, "lead.next_action"),
    score: typeof doc.score === "number" ? doc.score : null,
    score_factors: doc.score_factors || [],
    qualification: doc.qualification || null,
    icp_product: doc.icp_product || null,
    injection_findings: doc.injection_findings || [],
    warnings: doc.warnings || [],
    draft: doc.draft ? { id: doc.draft.id, channel: doc.draft.channel, message: doc.draft.message, state: doc.draft.state, created_at: doc.draft.created_at, sent_by_jarvis: false } : null,
    outreach: (doc.outreach || []).map((o) => ({ draft_id: o.draft_id, ts: o.ts, channel: o.channel, state: o.state })),
    history: (doc.history || []).slice(-10),
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

function brief(doc) {
  return { id: doc.id, business_name: presentName(doc), status: doc.status, score: typeof doc.score === "number" ? doc.score : null, category: doc.category || "", location: doc.location || "", next_action: (doc.injection_findings || []).length ? ext(doc.next_action, "lead.next_action") : String(doc.next_action || "").slice(0, 200), updated_at: doc.updated_at };
}

const summarizeReasons = (r) => r.map((x) => ({ code: x.code, message: x.message }));

export function registerLeadTools(registry, deps = {}) {
  const now = deps.now || (() => Date.now());
  const repo = deps.repo || createLeadRepo({ store: deps.store, now, coord: deps.coord || null, tzOffsetMin: deps.tzOffsetMin });
  const sources = deps.leadSources || {};
  const defaultProduct = PRODUCTS.includes(deps.defaultProduct) ? deps.defaultProduct : "qr_menu";
  const limits = {
    maxDraftsPerDay: limitMin(deps.limits && deps.limits.maxDraftsPerDay, MAX_DRAFTS_PER_DAY),
    cooldownDays: Math.max(OUTREACH_COOLDOWN_DAYS, Number(deps.limits && deps.limits.cooldownDays) || 0), // 30 gündən az ola bilməz
    minScore: Math.max(MIN_OUTREACH_SCORE, Number(deps.limits && deps.limits.minScore) || 0),
    maxResearchSavedPerDay: limitMin(deps.limits && deps.limits.maxResearchSavedPerDay, MAX_RESEARCH_SAVED_PER_DAY),
  };
  const events = deps.events || null;
  const emit = async (type, data) => {
    if (!events) return;
    try {
      await events.emit(type, data);
    } catch (e) {
      /* hadisə yazılmasa əsas iş dayanmasın */
    }
  };
  // Tranzaksiya daxilində hadisələr növbəyə qoyulur, tranzaksiya bitəndən sonra yazılır (abunəçi lead alətini çağırsa kilid qarşılıqlı bloklanmasın)
  const emitAll = async (q) => {
    for (const [type, data] of q) await emit(type, data);
  };
  const icpFor = (product) => {
    const icp = resolveIcp(product || defaultProduct, deps.icp);
    if (!icp) throw new AppError("VALIDATION_ERROR", "Naməlum məhsul/ICP: " + product);
    return icp;
  };
  const outDeps = { now, limits, sender: deps.sender || {}, defaultProduct };

  // ---- lead.research ----
  registry.register({
    name: "lead.research",
    description: "Açıq mənbə ünvanı olan namizədləri (ən çox " + MAX_RESEARCH_BATCH + ") süzgəcdən keçirir, ICP-yə görə qiymətləndirir və saxlayır. Özü axtarış etmir: namizədlər hazır verilir və ya qoşulmuş LeadSource-dan gəlir. dry_run=true saxlamır.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { product: productProp, source_id: { type: "string", maxLength: 40 }, query: { type: "string", maxLength: 200 }, candidates: { type: "array", maxItems: MAX_RESEARCH_BATCH, items: candidateSchema }, dry_run: { type: "boolean" } },
    },
    outputSchema: {
      type: "object",
      required: ["dry_run", "batch_size", "accepted", "rejected"],
      properties: { dry_run: { type: "boolean" }, product: { type: "string" }, batch_size: { type: "integer" }, truncated: { type: "boolean" }, accepted: { type: "array" }, rejected: { type: "array" }, note: { type: "string" } },
    },
    permissions: ["write.leads"],
    risk: "low",
    timeoutMs: 20000,
    requiresApproval: false,
    auditEvent: "lead.research",
    async handler(input) {
      const product = input.product || defaultProduct;
      const icp = icpFor(product);
      const hasCands = Array.isArray(input.candidates) && input.candidates.length > 0;
      if (!hasCands && !input.source_id) throw new AppError("VALIDATION_ERROR", "candidates və ya source_id verilməlidir");
      let source = null;
      if (input.source_id) {
        source = sources[input.source_id];
        if (!source) throw new AppError("NOT_FOUND", "LeadSource qoşulmayıb: " + input.source_id);
      }
      const stage = await researchStage({ source, query: input.query, candidates: input.candidates || [], product });
      const dry = input.dry_run === true;
      const accepted = [];
      const rejected = [...stage.rejected];
      const q = [];

      await repo.tx(async (tx) => {
        const entries = await tx.entries();
        let room = limits.maxResearchSavedPerDay - (await tx.researchSavedToday());
        const batchKeys = []; // dry_run zamanı partiya daxili təkrar
        for (const raw of stage.candidates) {
          const f = filterStage(raw, [...entries, ...batchKeys], { requirePublicSourceUrl: true });
          const name = String((f.lead && f.lead.business_name) || (raw && raw.business_name) || "").slice(0, 60);
          if (!f.pass) {
            rejected.push({ business_name: f.findings && f.findings.length ? ext(name, "candidate.name") : name, reasons: summarizeReasons(f.reasons) });
            continue;
          }
          if (!dry && room <= 0) {
            rejected.push({ business_name: name, reasons: [{ code: "daily_research_cap", message: "Gündəlik araşdırma limiti dolub (" + limits.maxResearchSavedPerDay + ")" }] });
            continue;
          }
          if (dry) {
            const q = qualifyLead(f.lead, icp);
            const s = scoreLead(f.lead, icp);
            batchKeys.push({ id: "dry", st: "new", ...f.keys });
            accepted.push({ id: null, business_name: name, status: q.qualified ? "scored" : "filtered_out", score: s.score });
            continue;
          }
          const doc = await saveStage(tx, f, { icp, product, via: "lead.research" });
          room -= 1;
          await tx.logResearchSaved(1);
          accepted.push({ id: doc.id, business_name: presentName(doc), status: doc.status, score: doc.score });
          q.push(["lead.created", { lead_id: doc.id, status: doc.status, via: "lead.research" }]);
        }
      });
      await emitAll(q);

      return {
        dry_run: dry,
        product,
        batch_size: stage.candidates.length,
        truncated: stage.truncated,
        accepted,
        rejected,
        note: stage.truncated ? "Partiya " + MAX_RESEARCH_BATCH + " lead ilə məhdudlaşdırıldı, artıqlar emal edilmədi" : "",
      };
    },
  });

  // ---- lead.save ----
  registry.register({
    name: "lead.save",
    description: "Tək lead-i süzgəcdən keçirib saxlayır (sahibin əl ilə və ya tövsiyə mənbəli lead-ləri üçün də). Süzgəcdən keçməyən namizəd SAXLANMIR, səbəblər qaytarılır.",
    inputSchema: { type: "object", required: ["lead"], additionalProperties: false, properties: { lead: candidateSchema, product: productProp } },
    outputSchema: { type: "object", required: ["saved"], properties: { saved: { type: "boolean" }, id: { type: "string" }, status: { type: "string" }, score: { type: "integer" }, reasons: { type: "array" }, warnings: { type: "array" } } },
    permissions: ["write.leads"],
    risk: "low",
    timeoutMs: 10000,
    requiresApproval: false,
    auditEvent: "lead.save",
    async handler(input) {
      const product = input.product || defaultProduct;
      const icp = icpFor(product);
      const q = [];
      const out = await repo.tx(async (tx) => {
        const f = filterStage(input.lead, await tx.entries());
        if (!f.pass) return { saved: false, reasons: summarizeReasons(f.reasons), warnings: f.warnings || [] };
        const doc = await saveStage(tx, f, { icp, product, via: "lead.save" });
        q.push(["lead.created", { lead_id: doc.id, status: doc.status, via: "lead.save" }]);
        return { saved: true, id: doc.id, status: doc.status, score: doc.score, warnings: f.warnings || [] };
      });
      await emitAll(q);
      return out;
    },
  });

  // ---- lead.filter (dry-run) ----
  registry.register({
    name: "lead.filter",
    description: "Namizədi SAXLAMADAN süzgəcdən, ICP uyğunluğundan və bal hesablamasından keçirir (dry-run).",
    inputSchema: { type: "object", required: ["candidate"], additionalProperties: false, properties: { candidate: candidateSchema, product: productProp } },
    outputSchema: { type: "object", required: ["pass", "dry_run"], properties: { pass: { type: "boolean" }, dry_run: { type: "boolean" }, reasons: { type: "array" }, warnings: { type: "array" }, qualified: { type: "boolean" }, qualification_reasons: { type: "array" }, score: { type: "integer" }, score_factors: { type: "array" }, would_status: { type: "string" }, duplicate_of: { type: "string" } } },
    permissions: ["read.leads"],
    risk: "low",
    timeoutMs: 8000,
    requiresApproval: false,
    auditEvent: "lead.filter",
    async handler(input) {
      const icp = icpFor(input.product);
      const f = filterStage(input.candidate, await repo.entries());
      const out = { pass: f.pass, dry_run: true, reasons: summarizeReasons(f.reasons), warnings: f.warnings || [] };
      if (f.duplicate_of) out.duplicate_of = f.duplicate_of;
      if (f.pass) {
        const q = qualifyLead(f.lead, icp);
        const s = scoreLead(f.lead, icp);
        Object.assign(out, { qualified: q.qualified, qualification_reasons: q.reasons, score: s.score, score_factors: s.factors, would_status: q.qualified ? "scored" : "filtered_out" });
      }
      return out;
    },
  });

  // ---- lead.list ----
  registry.register({
    name: "lead.list",
    description: "Lead-lərin qısa siyahısı (ən yenidən köhnəyə). Status və ya ad parçası ilə süzmək olar.",
    inputSchema: { type: "object", additionalProperties: false, properties: { status: { type: "string", enum: LEAD_STATUSES }, query: { type: "string", maxLength: 80 }, limit: { type: "integer", minimum: 1, maximum: 40 } } },
    outputSchema: { type: "object", required: ["items", "total_matching"], properties: { items: { type: "array" }, total_matching: { type: "integer" } } },
    permissions: ["read.leads"],
    risk: "low",
    timeoutMs: 10000,
    requiresApproval: false,
    auditEvent: "lead.list",
    async handler(input) {
      const r = await repo.list({ status: input.status, query: input.query, limit: input.limit || 20 });
      return { items: r.items.map(brief), total_matching: r.total_matching };
    },
  });

  // ---- lead.get ----
  registry.register({
    name: "lead.get",
    description: "Tək lead-in tam məlumatı. Qeyd və ehtiyac mətni etibarsız xarici məlumat kimi <external_content> qutusunda verilir.",
    inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: idProp } },
    outputSchema: { type: "object", required: ["lead"], properties: { lead: { type: "object" } } },
    permissions: ["read.leads"],
    risk: "low",
    timeoutMs: 8000,
    requiresApproval: false,
    auditEvent: "lead.get",
    async handler(input) {
      const d = await repo.getLead(input.id);
      if (!d) throw new AppError("NOT_FOUND", "Lead tapılmadı");
      return { lead: presentLead(d) };
    },
  });

  // ---- lead.score ----
  registry.register({
    name: "lead.score",
    description: "Mövcud lead-in ICP uyğunluğunu və 0-100 balını yenidən hesablayıb yazır (amillərin izahı ilə). Yalnız erkən mərhələ statusları (new/qualified/scored/filtered_out) dəyişir.",
    inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: idProp, product: productProp } },
    outputSchema: { type: "object", required: ["id", "score", "status", "factors"], properties: { id: { type: "string" }, score: { type: "integer" }, status: { type: "string" }, qualified: { type: "boolean" }, factors: { type: "array" } } },
    permissions: ["write.leads"],
    risk: "low",
    timeoutMs: 8000,
    requiresApproval: false,
    auditEvent: "lead.score",
    async handler(input) {
      return await repo.tx(async (tx) => {
        const d = await tx.getLead(input.id);
        if (!d) throw new AppError("NOT_FOUND", "Lead tapılmadı");
        const product = input.product || d.icp_product || defaultProduct;
        const icp = icpFor(product);
        const q = qualifyLead(d, icp);
        const s = scoreLead(d, icp);
        d.score = s.score;
        d.score_factors = s.factors;
        d.qualification = { qualified: q.qualified, reasons: q.reasons, category_fit: q.category_fit };
        d.icp_product = product;
        const path = rescorePath(d.status, q.qualified);
        if (path && path.length) applyStatusPath(d, path, "yenidən qiymətləndirildi: bal " + s.score, new Date(now()).toISOString());
        await tx.putLead(d);
        return { id: d.id, score: s.score, status: d.status, qualified: q.qualified, factors: s.factors };
      });
    },
  });

  // ---- lead.update_status ----
  registry.register({
    name: "lead.update_status",
    description: "Lead statusunu cədvəl üzrə dəyişir (replied, won, lost və s.). awaiting_approval və contacted_manually yalnız outreach təsdiq axını ilə, do_not_contact isə lead.do_not_contact ilə qoyulur.",
    inputSchema: { type: "object", required: ["id", "status"], additionalProperties: false, properties: { id: idProp, status: { type: "string", enum: LEAD_STATUSES }, note: { type: "string", maxLength: 200 }, next_action: { type: "string", maxLength: 200 } } },
    outputSchema: { type: "object", required: ["id", "status", "previous_status"], properties: { id: { type: "string" }, status: { type: "string" }, previous_status: { type: "string" } } },
    permissions: ["write.leads"],
    risk: "low",
    timeoutMs: 8000,
    requiresApproval: false,
    auditEvent: "lead.update_status",
    async handler(input) {
      if (FLOW_ONLY_STATUSES.includes(input.status)) {
        throw new AppError("VALIDATION_ERROR", input.status === "do_not_contact" ? "do_not_contact üçün lead.do_not_contact alətini istifadə edin" : '"' + input.status + '" statusu yalnız lead.outreach.prepare təsdiq axını ilə qoyulur');
      }
      const q = [];
      const out = await repo.tx(async (tx) => {
        const d = await tx.getLead(input.id);
        if (!d) throw new AppError("NOT_FOUND", "Lead tapılmadı");
        const prev = d.status;
        if (prev === input.status) return { id: d.id, status: d.status, previous_status: prev };
        if (!canTransition(prev, input.status)) throw new AppError("VALIDATION_ERROR", "Status keçidi icazəli deyil: " + prev + " -> " + input.status);
        const iso = new Date(now()).toISOString();
        if ((prev === "awaiting_approval" || prev === "approved") && input.status !== "approved") cancelPendingOutreach(d); // gözləyən qaralama ləğv: 30 gün saatı da dayanır
        d.status = input.status;
        d.history = [...(d.history || []), { ts: iso, status: input.status, reason: (input.note || "əl ilə dəyişdirildi").slice(0, 160) }].slice(-30);
        if (input.next_action) d.next_action = input.next_action.slice(0, 200);
        await tx.putLead(d);
        q.push(["lead.status_changed", { lead_id: d.id, from: prev, to: input.status }]);
        return { id: d.id, status: d.status, previous_status: prev };
      });
      await emitAll(q);
      return out;
    },
  });

  // ---- lead.do_not_contact ----
  registry.register({
    name: "lead.do_not_contact",
    description: "Lead-i do_not_contact siyahısına qoyur (geri qaytarılmır, gözləyən qaralama ləğv edilir). id və ya (sayt/instagram/tiktok/ad+məkan) verilir: siyahıda olmayan biznes üçün blok qeydi yaradılır.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: idProp, reason: { type: "string", maxLength: 200 }, business_name: { type: "string", maxLength: 120 }, website: { type: "string", maxLength: 500 }, instagram: { type: "string", maxLength: 200 }, tiktok: { type: "string", maxLength: 200 }, location: { type: "string", maxLength: 100 } },
    },
    outputSchema: { type: "object", required: ["id", "status", "created_block_entry"], properties: { id: { type: "string" }, status: { type: "string" }, created_block_entry: { type: "boolean" } } },
    permissions: ["write.leads"],
    risk: "low",
    timeoutMs: 8000,
    requiresApproval: false,
    auditEvent: "lead.do_not_contact",
    async handler(input) {
      const reason = (input.reason || "sahib tərəfindən do_not_contact").slice(0, 160);
      const q = [];
      const out = await repo.tx(async (tx) => {
        const iso = new Date(now()).toISOString();
        let target = null;
        let created = false;
        if (input.id) {
          target = await tx.getLead(input.id);
          if (!target) throw new AppError("NOT_FOUND", "Lead tapılmadı");
        } else {
          const stub = parseCandidate({ business_name: input.business_name, website: input.website, instagram: input.instagram, tiktok: input.tiktok, location: input.location });
          if (!stub.ok) throw new AppError("VALIDATION_ERROR", "Blok qeydi düzgün deyil: " + stub.errors.join("; ").slice(0, 150));
          const k = leadKeys(stub.lead);
          if (!k.wk && !k.ik && !k.tk && !k.nk) throw new AppError("VALIDATION_ERROR", "id və ya sayt/instagram/tiktok/(ad+məkan) verilməlidir");
          const hit = (await tx.entries()).find((e) => (k.wk && e.wk === k.wk) || (k.ik && e.ik === k.ik) || (k.tk && e.tk === k.tk) || (k.nk && e.nk === k.nk));
          if (hit) target = await tx.getLead(hit.id);
          if (!target) {
            target = await tx.insertLead(
              { ...stub.lead, business_name: stub.lead.business_name || "(blok qeydi)", source: { url: "", source_type: "manual_owner", note: "do_not_contact blok qeydi" }, next_action: "Əlaqə qadağandır", score: null, draft: null, injection_findings: stub.findings || [] },
              [{ status: "new", reason: "blok qeydi" }],
            );
            created = true;
          }
        }
        if (target.status !== "do_not_contact") {
          const prev = target.status;
          cancelPendingOutreach(target);
          target.status = "do_not_contact";
          target.next_action = "Əlaqə qadağandır";
          target.history = [...(target.history || []), { ts: iso, status: "do_not_contact", reason }].slice(-30);
          await tx.putLead(target);
          q.push(["lead.do_not_contact", { lead_id: target.id, from: prev }]);
        }
        return { id: target.id, status: "do_not_contact", created_block_entry: created };
      });
      await emitAll(q);
      return out;
    },
  });

  // ---- lead.outreach.prepare (YALNIZ təsdiq qeydi açır) ----
  registry.register({
    name: "lead.outreach.prepare",
    description: "Lead üçün outreach qaralaması hazırlayır və təsdiq qeydi açır. JARVIS mesajı GÖNDƏRMİR: sahib mətni özü göndərir, sonra təsdiq verəndə yalnız 'manual send recorded' qeydi yazılır. Limitlər: gündə max " + MAX_DRAFTS_PER_DAY + " qaralama, lead başına " + OUTREACH_COOLDOWN_DAYS + " gündə 1, do_not_contact bloklanır.",
    inputSchema: {
      type: "object",
      required: ["lead_id"],
      additionalProperties: false,
      properties: { lead_id: idProp, channel: { type: "string", enum: CONTACT_CHANNELS }, product: productProp, message: { type: "string", maxLength: 1000 }, draft_id: { type: "string", maxLength: 24 }, lead_label: { type: "string", maxLength: 120 } },
    },
    outputSchema: { type: "object", required: ["ok", "lead_id", "status", "result", "sent_by_jarvis"], properties: { ok: { type: "boolean" }, lead_id: { type: "string" }, status: { type: "string" }, result: { type: "string" }, sent_by_jarvis: { type: "boolean" }, channel: { type: "string" } } },
    permissions: ["send.message", "write.leads"],
    risk: "high",
    requiresApproval: true,
    timeoutMs: 15000,
    auditEvent: "lead.outreach",
    approval: {
      kind: "lead.outreach",
      // Qaralama və limitlər burada (asinxron) hazırlanır; təsdiq qeydini registry yaradır.
      async build(input) {
        const r = await repo.tx(async (tx) => await prepareMessageStage(tx, outDeps, input));
        await emit("lead.outreach_prepared", { lead_id: r.lead.id, draft_id: r.draft.id, channel: r.draft.channel });
        return { content: r.content, payload: r.payload };
      },
      describe: (payload) => describeOutreach(payload),
      // Təsdiqdən sonra: YALNIZ əl ilə göndərmənin qeydi. Şəbəkə çağırışı yoxdur.
      async execute(input, ctx) {
        const out = await repo.tx(async (tx) => await recordManualContact(tx, outDeps, input, ctx));
        await emit("lead.contacted_manually", { lead_id: out.lead_id, channel: out.channel });
        return { ok: true, lead_id: out.lead_id, status: out.status, result: out.result, sent_by_jarvis: false, channel: out.channel };
      },
    },
    async handler() {
      // Bura heç vaxt çatmır: təsdiq tələb edən alətlər registry-də icra olunmur.
      throw new AppError("APPROVAL_REQUIRED", "lead.outreach.prepare yalnız təsdiq axını ilə işləyir");
    },
  });

  return {
    repo,
    limits,
    toolNames: ["lead.research", "lead.save", "lead.filter", "lead.list", "lead.get", "lead.score", "lead.update_status", "lead.do_not_contact", "lead.outreach.prepare"],
    // Manager hesabatı üçün provayder (yalnız indeks sahələri)
    provider: { async list() { return await repo.summaryRows(); } },
  };
}
