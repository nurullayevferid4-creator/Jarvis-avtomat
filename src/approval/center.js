// Təsdiq mərkəzi: xarici təsiri olan hər iş burada "gözləyir" siyahısına düşür.
// Fərid APPROVE / REJECT / EDIT edir.
//
// DİQQƏT: "approve" özü heç nəyi icra ETMİR. Adi qeydlərdə (source "orchestrator") təsdiqdən sonra icra
// Fərid-in özündədir (execution:"manual"). "tool_call" qeydlərində (alət çağırışı) təsdiqdən sonra
// icranı YALNIZ ApprovalExecutor edir (src/approval/executor.js) və bunun üçün qərar API/UI üzərindən (via:"api")
// verilməlidir: söhbətdəki "hə" tool_call qeydini təsdiqləyə bilməz. Rədd edilən qeyd heç vaxt icra olunmur.
// Qeyd: sistem tək istifadəçi üçündür, eyni anda iki qərarın yarışına qarşı kilid yoxdur (KV-də atomik müqayisə-yazma yoxdur).

import { RISKS, APPROVAL_TTL_DAYS } from "../policy.js";
import { makeId, isValidId } from "../state/store.js";

const DAY_MS = 86400000;
const MAX_CONTENT = 4000;
const MAX_TOOL_INPUT_JSON = 4000;
const TOOL_NAME_RE = /^[a-z][a-z0-9_.]{1,62}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

export class ApprovalCenter {
  constructor(store, audit = null, now = () => Date.now()) {
    this.store = store;
    this.audit = audit;
    this.now = now;
  }

  static isToolCall(rec) {
    return !!rec && rec.kind === "tool_call";
  }

  async _log(event, data) {
    if (this.audit) await this.audit.log(event, data);
  }

  // tool (istəyə bağlı): alət çağırışı qeydi. Onda input (obyekt) və input_hash (sha256) məcburidir.
  async create({ action, content, risk = "medium", source = "system", tool, input, input_hash, permissions }) {
    if (!RISKS.includes(risk)) throw new Error("risk düzgün deyil");
    const a = String(action || "").trim().slice(0, 200);
    if (!a) throw new Error("əməliyyat adı boşdur");
    let toolPart = null;
    if (tool !== undefined) {
      if (!TOOL_NAME_RE.test(String(tool))) throw new Error("alət adı düzgün deyil");
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("alət girişi obyekt olmalıdır");
      if (!HASH_RE.test(String(input_hash || ""))) throw new Error("input_hash düzgün deyil");
      if (JSON.stringify(input).length > MAX_TOOL_INPUT_JSON) throw new Error("alət girişi çox böyükdür");
      toolPart = {
        kind: "tool_call",
        tool: String(tool),
        input,
        input_hash: String(input_hash),
        permissions: Array.isArray(permissions) ? permissions.map((p) => String(p).slice(0, 40)).slice(0, 10) : [],
      };
    }
    const t = this.now();
    const id = makeId(t);
    const rec = {
      id,
      ts: new Date(t).toISOString(),
      status: "pending",
      action: a,
      content: String(content || "").slice(0, MAX_CONTENT),
      risk,
      source: String(source).slice(0, 60),
      revisions: 0,
      expires_at: new Date(t + APPROVAL_TTL_DAYS * DAY_MS).toISOString(),
      decided_at: null,
      execution: null,
      ...(toolPart || {}),
    };
    await this.store.putDoc("approval", id, rec, 30 * 86400);
    await this._log("approval.created", { id, action: a, risk, source: rec.source, tool: rec.tool || null });
    return rec;
  }

  async get(id) {
    if (!isValidId(id)) return null;
    return await this.store.getDoc("approval", id);
  }

  _expired(rec) {
    return rec.status === "pending" && Date.parse(rec.expires_at) < this.now();
  }

  // status verilsə yalnız o status qaytarılır. Vaxtı keçmiş gözləyənlər "expired" görünür.
  async list({ status, limit = 30 } = {}) {
    const docs = await this.store.listDocs("approval", limit);
    const view = docs.map((d) => (this._expired(d) ? { ...d, status: "expired" } : d));
    return status ? view.filter((d) => d.status === status) : view;
  }

  // decision: "approve" | "reject" | "edit" (edit üçün content məcburidir, qeyd gözləyən qalır)
  // via: "api" yalnız /api/approvals (parol + UI) yolundan verilir. tool_call qeydi başqa yoldan
  // (məs. söhbətdə "hə") qərara bağlana bilməz.
  async decide(id, { decision, content, via } = {}) {
    const rec = await this.get(id);
    if (!rec) return { ok: false, error: "not_found" };
    if (rec.status !== "pending") return { ok: false, error: "already_decided", record: rec };
    const toolCall = ApprovalCenter.isToolCall(rec);
    if (toolCall && via !== "api") return { ok: false, error: "api_required" };
    if (toolCall && decision === "edit") return { ok: false, error: "edit_not_allowed" };
    if (this._expired(rec)) {
      rec.status = "expired";
      await this.store.putDoc("approval", id, rec, 30 * 86400);
      await this._log("approval.expired", { id });
      return { ok: false, error: "expired", record: rec };
    }

    const at = new Date(this.now()).toISOString();
    if (decision === "approve") {
      rec.status = "approved";
      rec.decided_at = at;
      rec.execution = toolCall ? "awaiting" : "manual"; // tool_call: icranı yalnız ApprovalExecutor edir; adi qeyd: icra Fərid-in özündədir
    } else if (decision === "reject") {
      rec.status = "rejected";
      rec.decided_at = at;
      if (toolCall) rec.execution = "not_executed";
    } else if (decision === "edit") {
      const c = String(content || "").trim();
      if (!c) return { ok: false, error: "content_required" };
      rec.content = c.slice(0, MAX_CONTENT);
      rec.revisions += 1;
    } else {
      return { ok: false, error: "bad_decision" };
    }

    await this.store.putDoc("approval", id, rec, 30 * 86400);
    await this._log("approval." + decision, { id, action: rec.action, risk: rec.risk, status: rec.status });
    return { ok: true, record: rec };
  }

  // --- tool_call icrası (yalnız ApprovalExecutor çağırır) ---
  // Yalnız approved + awaiting vəziyyətindən "running" vəziyyətinə keçir. İkinci çağırış null qaytarır (tək istifadəlik).
  async claimExecution(id) {
    const rec = await this.get(id);
    if (!ApprovalCenter.isToolCall(rec) || rec.status !== "approved" || rec.execution !== "awaiting") return null;
    rec.execution = "running";
    rec.executed_at = new Date(this.now()).toISOString();
    await this.store.putDoc("approval", id, rec, 30 * 86400);
    return rec;
  }

  // result: qısa, gizli məlumatsız xülasə (executor süzgəcdən keçirir).
  async finishExecution(id, { ok, result }) {
    const rec = await this.get(id);
    if (!ApprovalCenter.isToolCall(rec) || rec.execution !== "running") return null;
    rec.execution = ok ? "done" : "failed";
    rec.result = result === undefined ? null : result;
    rec.finished_at = new Date(this.now()).toISOString();
    await this.store.putDoc("approval", id, rec, 30 * 86400);
    return rec;
  }
}
