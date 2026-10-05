// LearningAgent skeleti. Bu mərhələdə HEÇ BİR AVTOMATİK öyrənmə davranışı yoxdur: heç bir metodu özü çağırılmır
// (orkestratora qoşulmayıb), model çağırmır, nəticəni yalnız çağıran kod verəndə saxlayır.
//
// Mümkün olan: nəticələri qeyd etmək, onları saymaq/təhlil etmək, təkmilləşdirmə TƏKLİFLƏRİ yaratmaq (status "proposed"),
// və YALNIZ təsdiq yoxlanışından keçəndən sonra qaydanı "approved" saxlamaq.
// Mümkün OLMAYAN (kodla bağlıdır): system prompt, secret, icazə (permission), təsdiq siyasəti və təhlükəsizlik qaydalarını dəyişmək.
// Təsdiqlənmiş qayda yalnız MƏLUMATDIR (mətn). Heç bir kod onu özü tətbiq etmir.

import { validate } from "../validate.js";
import { scrub, makeId, AgentError } from "./common.js";

export const OUTCOME_STATUSES = ["achieved", "partial", "blocked", "pending_approval", "draft_only", "failed"];
// Qaydanın nəyə aid ola biləcəyi. Qadağan hədəflər FORBIDDEN_TARGETS-dədir və heç vaxt qəbul olunmur.
export const ALLOWED_TARGETS = Object.freeze(["workflow_note", "checklist", "tool_hint"]);
export const FORBIDDEN_TARGETS = Object.freeze(["system_prompt", "secret", "secrets", "permission", "permissions", "approval_policy", "security", "policy", "tool_permissions"]);

const OUTCOME_SCHEMA = {
  type: "object",
  properties: {
    task: { type: "string", minLength: 1, maxLength: 300 },
    status: { type: "string", enum: OUTCOME_STATUSES },
    summary: { type: "string", maxLength: 600 },
    reason: { type: "string", maxLength: 200 },
    tool: { type: "string", maxLength: 60 },
  },
  required: ["task", "status"],
  additionalProperties: false,
};

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 3, maxLength: 120 },
    rationale: { type: "string", maxLength: 400 },
    target: { type: "string", minLength: 1, maxLength: 40 },
    text: { type: "string", minLength: 3, maxLength: 400 },
  },
  required: ["title", "target", "text"],
  additionalProperties: false,
};

const bad = (errors) => new AgentError("invalid_input", "giriş düzgün deyil: " + errors.slice(0, 3).join("; "));

export class LearningAgent {
  // storage: ScopedStorage("learning"). approvalCheck(approvalId) yalnız `true` qaytararsa təsdiq sayılır; standart: həmişə rədd (fail-closed).
  constructor({ storage, now = () => new Date(), approvalCheck = async () => false } = {}) {
    if (!storage || typeof storage.get !== "function" || typeof storage.put !== "function" || typeof storage.list !== "function") throw new Error("LearningAgent: storage lazımdır");
    this.storage = storage;
    this.now = now;
    this.approvalCheck = approvalCheck;
  }

  async recordOutcome(input) {
    const v = validate(OUTCOME_SCHEMA, input);
    if (!v.ok) throw bad(v.errors);
    const id = makeId(this.now().getTime());
    const rec = { id, ts: this.now().toISOString(), task: scrub(input.task, 300), status: input.status, summary: scrub(input.summary || "", 600), reason: scrub(input.reason || "", 200), tool: scrub(input.tool || "", 60) };
    await this.storage.put("outcome-" + id, rec);
    return { id };
  }

  async listOutcomes({ limit = 50 } = {}) {
    const { keys } = await this.storage.list({ prefix: "outcome-", limit });
    const out = [];
    for (const k of keys) { const r = await this.storage.get(k); if (r) out.push(r); }
    return out;
  }

  // Saf hesablama: model yoxdur, yan təsir yoxdur.
  analyze(outcomes) {
    const list = Array.isArray(outcomes) ? outcomes : [];
    const byStatus = Object.fromEntries(OUTCOME_STATUSES.map((s) => [s, 0]));
    const reasons = new Map();
    for (const o of list) {
      if (o && Object.prototype.hasOwnProperty.call(byStatus, o.status)) byStatus[o.status]++;
      if (o && (o.status === "blocked" || o.status === "failed" || o.status === "partial") && o.reason) {
        const k = String(o.reason).toLocaleLowerCase("az").slice(0, 80);
        reasons.set(k, (reasons.get(k) || 0) + 1);
      }
    }
    const total = list.length;
    const topFailures = [...reasons.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([reason, count]) => ({ reason, count }));
    return { total, byStatus, successRate: total ? Math.round((byStatus.achieved / total) * 100) / 100 : 0, topFailures };
  }

  // Təkliflər yalnız "proposed" statusunda qalır. Heç nə tətbiq olunmur.
  proposeImprovements(analysis) {
    const a = analysis || { topFailures: [] };
    return (a.topFailures || []).filter((f) => f.count >= 2).map((f) => ({
      title: "Təkrarlanan problem: " + f.reason.slice(0, 60),
      rationale: f.reason.slice(0, 80) + " səbəbi " + f.count + " dəfə təkrarlanıb.",
      target: "checklist",
      text: "Bu səbəbə görə iş dayanmamış əvvəl yoxlama siyahısına bax: " + f.reason.slice(0, 120),
    }));
  }

  _checkProposal(p) {
    const v = validate(PROPOSAL_SCHEMA, p);
    if (!v.ok) throw bad(v.errors);
    const target = String(p.target).toLowerCase();
    if (FORBIDDEN_TARGETS.includes(target) || !ALLOWED_TARGETS.includes(target)) throw new AgentError("forbidden_target", "bu hədəf üçün qayda yaratmaq olmaz (system prompt, secret, icazə, təsdiq və təhlükəsizlik qadağandır)");
    return target;
  }

  async saveProposal(p) {
    const target = this._checkProposal(p);
    const id = makeId(this.now().getTime());
    const rec = { id, ts: this.now().toISOString(), status: "proposed", title: scrub(p.title, 120), rationale: scrub(p.rationale || "", 400), target, text: scrub(p.text, 400) };
    await this.storage.put("proposal-" + id, rec);
    return { id };
  }

  async getProposal(id) { return await this.storage.get("proposal-" + id); }

  async listProposals({ limit = 50 } = {}) {
    const { keys } = await this.storage.list({ prefix: "proposal-", limit });
    const out = [];
    for (const k of keys) { const r = await this.storage.get(k); if (r) out.push(r); }
    return out;
  }

  // Qayda yalnız Fərid-in təsdiqi yoxlanıb `true` qaytarılandan sonra "approved" olur. Standart yoxlama həmişə rədd edir.
  async approveProposal(id, { approvalId } = {}) {
    const p = await this.getProposal(id);
    if (!p) throw new AgentError("not_found", "təklif tapılmadı");
    if (p.status !== "proposed") throw new AgentError("invalid_state", "təklif artıq qərara bağlanıb");
    this._checkProposal({ title: p.title, rationale: p.rationale, target: p.target, text: p.text }); // saxlanmış qeyd sonradan dəyişdirilsə də qadağan hədəf keçməsin
    let ok = false;
    try { ok = (await this.approvalCheck(approvalId, p)) === true; } catch (e) { ok = false; }
    if (!ok) throw new AgentError("approval_required", "Fərid-in təsdiqi yoxdur (təsdiq mərkəzi qoşulmayıb və ya təsdiq verilməyib)");
    const at = this.now().toISOString();
    await this.storage.put("rule-" + id, { id, approved_at: at, approval_id: String(approvalId).slice(0, 64), target: p.target, text: p.text });
    await this.storage.put("proposal-" + id, { ...p, status: "approved", decided_at: at });
    return { id, status: "approved" };
  }

  async rejectProposal(id) {
    const p = await this.getProposal(id);
    if (!p) throw new AgentError("not_found", "təklif tapılmadı");
    if (p.status !== "proposed") throw new AgentError("invalid_state", "təklif artıq qərara bağlanıb");
    await this.storage.put("proposal-" + id, { ...p, status: "rejected", decided_at: this.now().toISOString() });
    return { id, status: "rejected" };
  }

  // Təsdiqlənmiş qaydalar: yalnız mətn (məlumat). Heç bir kod onları özü tətbiq etmir.
  async getApprovedRules({ limit = 50 } = {}) {
    const { keys } = await this.storage.list({ prefix: "rule-", limit });
    const out = [];
    for (const k of keys) { const r = await this.storage.get(k); if (r) out.push(r); }
    return out;
  }
}
