// Təsdiq mərkəzi: xarici təsiri olan hər iş burada "gözləyir" siyahısına düşür.
// Fərid APPROVE / REJECT / EDIT edir.
//
// DİQQƏT: "approve" ÖZÜ heç nəyi icra ETMİR. Adi qeydlərdə təsdiqdən sonra icra Fərid-in özündədir
// (execution:"manual"). Yalnız strukturlu qeydlər (kind:"social.publish", payload + payload_hash) üçün
// icranı ayrıca src/social/flow.js həyata keçirir: o, qeydin "approved" olduğunu və hash-in
// dəyişmədiyini yoxlayır. Təsdiq mərkəzinin özündə şəbəkə çağırışı yoxdur.
//
// Qorumalar:
//  - Qərar yarışı: eyni qeyd üçün eyni anda "approve" və "reject" gəlsə, koordinatorda yalnız biri qalib gəlir.
//  - Mənşə bağlaması: Telegram-dan yaranan qeydi yalnız həmin çat (və ya parollu UI sahibi) təsdiq edə bilər.
//  - Bir dəfəlik icra: claimExecution() koordinatorda atomik "bir dəfə" markeri qoyur; ikinci çağırış CONFLICT alır.
//  - Qeyd hash-i və xülasə hash-i: icra anında payload və göstərilən xülasə dəyişməyibsə icra gedir.

import { RISKS, APPROVAL_TTL_DAYS } from "../policy.js";
import { makeId, isValidId } from "../state/store.js";
import { payloadHash } from "../social/canon.js";
import { MemoryCoordinator } from "../coord/coordinator.js";
import { AppError } from "../errors.js";

const DAY_MS = 86400000;
const MAX_CONTENT = 4000;
// Təsdiqdən sonra icraya başlamaq üçün pəncərə. Keçərsə qeyd icra oluna bilməz, yenisi hazırlanmalıdır.
export const EXEC_WINDOW_MS = 30 * 60 * 1000;

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Kim icazə verə bilər: origin yoxdursa hər autentifikasiyalı aktor; origin varsa yalnız həmin çat və ya UI sahibi.
export function actorAllowed(rec, actor) {
  const o = rec.origin;
  if (!o || !o.chat_id) return true;
  if (!actor) return false;
  if (actor.channel === "ui") return true;
  return actor.channel === o.channel && String(actor.chat_id) === String(o.chat_id);
}

function cleanActor(actor) {
  if (!actor) return null;
  return { channel: String(actor.channel || "").slice(0, 20), chat_id: actor.chat_id === undefined || actor.chat_id === null ? undefined : String(actor.chat_id).slice(0, 30), user_id: actor.user_id === undefined || actor.user_id === null ? undefined : String(actor.user_id).slice(0, 30) };
}

export class ApprovalCenter {
  constructor(store, audit = null, now = () => Date.now(), coord = null) {
    this.store = store;
    this.audit = audit;
    this.now = now;
    this.coord = coord || new MemoryCoordinator(now);
    this.events = null; // istəyə bağlı EventBus (approval.created/decided)
  }

  async _emit(type, data) {
    if (!this.events) return;
    try {
      await this.events.emit(type, data);
    } catch (e) {
      /* hadisə yazılmasa təsdiq axını dayanmasın */
    }
  }

  async _log(event, data) {
    if (this.audit) await this.audit.log(event, data);
  }

  async create({ action, content, risk = "medium", source = "system", kind = null, payload = null, origin = null }) {
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
      origin: cleanActor(origin),
      created_by: cleanActor(origin),
    };
    rec.summary_hash = await sha256Hex(rec.content);
    if (kind) {
      rec.kind = String(kind).slice(0, 40);
      rec.payload = payload || {};
      rec.payload_hash = await payloadHash(rec.payload);
    }
    await this.store.putDoc("approval", id, rec, 30 * 86400);
    await this._log("approval.created", { id, action: a, risk, source: rec.source });
    await this._emit("approval.created", { id, action: a, risk, kind: rec.kind || null });
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
  async decide(id, { decision, content, actor } = {}) {
    const rec = await this.get(id);
    if (!rec) return { ok: false, error: "not_found" };
    if (!actorAllowed(rec, actor)) {
      await this._log("approval.denied_actor", { id, decision, actor: cleanActor(actor) });
      return { ok: false, error: "forbidden_origin" };
    }
    if (rec.status !== "pending") return { ok: false, error: "already_decided", record: rec };
    if (this._expired(rec)) {
      rec.status = "expired";
      await this.store.putDoc("approval", id, rec, 30 * 86400);
      await this._log("approval.expired", { id });
      return { ok: false, error: "expired", record: rec };
    }

    // Qərar yarışı: yalnız ilk approve/reject keçir (koordinatorda atomik).
    if ((decision === "approve" || decision === "reject") && !(await this.coord.once("decide:" + id, { meta: decision }))) {
      const cur = (await this.get(id)) || rec;
      return { ok: false, error: "already_decided", record: cur };
    }

    const at = new Date(this.now()).toISOString();
    if (decision === "approve") {
      rec.status = "approved";
      rec.decided_at = at;
      rec.decided_by = cleanActor(actor);
      rec.execution = rec.kind ? "pending" : "manual"; // "pending": social flow icra edəcək; "manual": icra Fərid-in özündədir
    } else if (decision === "reject") {
      rec.status = "rejected";
      rec.decided_at = at;
      rec.decided_by = cleanActor(actor);
    } else if (decision === "edit") {
      if (rec.kind) return { ok: false, error: "edit_not_supported" }; // strukturlu qeyd: rədd edin və yenisini hazırlayın
      const c = String(content || "").trim();
      if (!c) return { ok: false, error: "content_required" };
      rec.content = c.slice(0, MAX_CONTENT);
      rec.revisions += 1;
    } else {
      return { ok: false, error: "bad_decision" };
    }

    await this.store.putDoc("approval", id, rec, 30 * 86400);
    await this._log("approval." + decision, { id, action: rec.action, risk: rec.risk, status: rec.status });
    if (decision === "approve" || decision === "reject") await this._emit("approval.decided", { id, status: rec.status });
    return { ok: true, record: rec };
  }

  // Təsdiq yoxlaması (iddia qoymadan): status approved, mənşə, pəncərə, payload hash, xülasə hash.
  // Şəbəkə çağırışı yoxdur. İcra edən kod HƏR icradan əvvəl bunu çağırmalıdır.
  async verifyApproved(id, { actor, kind, windowMs = EXEC_WINDOW_MS } = {}) {
    const rec = await this.get(id);
    if (!rec) return { ok: false, error: "not_found" };
    if (!rec.kind) return { ok: false, error: "not_executable", record: rec };
    if (kind && rec.kind !== kind) return { ok: false, error: "wrong_kind", record: rec };
    if (!actorAllowed(rec, actor)) {
      await this._log("approval.denied_actor", { id, op: "execute", actor: cleanActor(actor) });
      return { ok: false, error: "forbidden_origin" };
    }
    if (rec.status !== "approved") return { ok: false, error: rec.status === "pending" ? "not_approved" : "not_approved_" + rec.status, record: rec };
    if (windowMs && this.now() - Date.parse(rec.decided_at) > windowMs) {
      await this._log("approval.window_expired", { id });
      return { ok: false, error: "execution_window_expired", record: rec };
    }
    if ((await payloadHash(rec.payload)) !== rec.payload_hash) {
      await this._log("approval.payload_modified", { id });
      return { ok: false, error: "payload_modified", record: rec };
    }
    if (rec.summary_hash && (await sha256Hex(rec.content)) !== rec.summary_hash) {
      await this._log("approval.summary_modified", { id });
      return { ok: false, error: "summary_modified", record: rec };
    }
    return { ok: true, record: rec };
  }

  // İCRA İDDİASI: yalnız İLK çağıran { ok:true } alır (koordinatorda atomik "bir dəfə" markeri).
  async claimExecution(id, { actor, kind } = {}) {
    const v = await this.verifyApproved(id, { actor, kind });
    if (!v.ok) return v;
    const rec = v.record;
    const first = await this.coord.once("exec:" + id, { meta: actor ? String(actor.channel) : "system" });
    if (!first) {
      await this._log("approval.duplicate_execution", { id });
      return { ok: false, error: "already_executed", record: rec };
    }
    rec.execution = "running";
    rec.exec_started_at = new Date(this.now()).toISOString();
    await this.store.putDoc("approval", id, rec, 30 * 86400);
    await this._log("approval.execution_claimed", { id, kind: rec.kind });
    return { ok: true, record: rec };
  }

  // İcra bitdi: "done" | "failed" | "unknown". result yalnız qısa, gizli məlumatsız xülasədir.
  async finishExecution(id, status, { result = null, error = null } = {}) {
    const rec = await this.get(id);
    if (!rec) return null;
    rec.execution = ["done", "failed", "unknown"].includes(status) ? status : "unknown";
    rec.exec_finished_at = new Date(this.now()).toISOString();
    if (result) rec.result = result;
    if (error) rec.error = error;
    await this.store.putDoc("approval", id, rec, 30 * 86400);
    await this._log("approval.execution_finished", { id, status: rec.execution, error_code: error && error.code });
    return rec;
  }

  // İcra vəziyyətini yazır (yalnız social flow çağırır). Qeydin statusu/payload-u dəyişmir.
  async setExecution(id, execution, extra = {}) {
    const rec = await this.get(id);
    if (!rec) return null;
    rec.execution = String(execution).slice(0, 30);
    if (extra.job_id) rec.job_id = String(extra.job_id);
    await this.store.putDoc("approval", id, rec, 30 * 86400);
    await this._log("approval.execution", { id, execution: rec.execution });
    return rec;
  }
}
