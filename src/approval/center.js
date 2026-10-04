// Təsdiq mərkəzi: xarici təsiri olan hər iş burada "gözləyir" siyahısına düşür.
// Fərid APPROVE / REJECT / EDIT edir.
//
// DİQQƏT: "approve" heç nəyi icra ETMİR. Bu versiyada Shopify, Instagram və s. inteqrasiya yoxdur,
// ona görə təsdiqdən sonra da icra Fərid-in özündədir (bax TEAM.md). Qeyd yalnız "təsdiq alındı"
// deməkdir və audit jurnalında saxlanılır.
// Qeyd: sistem tək istifadəçi üçündür, eyni anda iki qərarın yarışına qarşı kilid yoxdur.

import { RISKS, APPROVAL_TTL_DAYS } from "../policy.js";
import { makeId, isValidId } from "../state/store.js";

const DAY_MS = 86400000;
const MAX_CONTENT = 4000;

export class ApprovalCenter {
  constructor(store, audit = null, now = () => Date.now()) {
    this.store = store;
    this.audit = audit;
    this.now = now;
  }

  async _log(event, data) {
    if (this.audit) await this.audit.log(event, data);
  }

  async create({ action, content, risk = "medium", source = "system" }) {
    if (!RISKS.includes(risk)) throw new Error("risk düzgün deyil");
    const a = String(action || "").trim().slice(0, 200);
    if (!a) throw new Error("əməliyyat adı boşdur");
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
    };
    await this.store.putDoc("approval", id, rec, 30 * 86400);
    await this._log("approval.created", { id, action: a, risk, source: rec.source });
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
  async decide(id, { decision, content } = {}) {
    const rec = await this.get(id);
    if (!rec) return { ok: false, error: "not_found" };
    if (rec.status !== "pending") return { ok: false, error: "already_decided", record: rec };
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
      rec.execution = "manual"; // icra Fərid-in özündədir, sistem icra etmir
    } else if (decision === "reject") {
      rec.status = "rejected";
      rec.decided_at = at;
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
}
