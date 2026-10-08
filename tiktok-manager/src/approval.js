// DRAFT → REVIEW → APPROVE → EXECUTE. Standart: execute_enabled=false.
// Təsdiqsiz heç bir publish / DM / şərh cavabı icra olunmur. Təsdiqdən sonra payload dəyişərsə (hash) icra bloklanır.
import { createHash, randomBytes } from "node:crypto";
import { capability, isCallable, STATUS } from "./capabilities.js";
import { checkPayload } from "./policy.js";

export const KIND_CAPABILITY = Object.freeze({
  "video.publish": "post.video.direct",
  "video.inbox": "post.video.inbox",
  "photo.publish": "post.photo",
  "comment.reply": "comments.reply",
  "dm.send": "dm.send",
});

export const STATES = Object.freeze({ DRAFT: "DRAFT", REVIEW: "REVIEW", APPROVED: "APPROVED", REJECTED: "REJECTED", EXECUTED: "EXECUTED", FAILED: "FAILED", BLOCKED: "BLOCKED" });

const stable = (o) => JSON.stringify(o, Object.keys(flatKeys(o)).sort());
function flatKeys(o, acc = {}) { if (o && typeof o === "object") for (const k of Object.keys(o)) { acc[k] = 1; flatKeys(o[k], acc); } return acc; }
export const hashPayload = (kind, payload) => createHash("sha256").update(kind + "\n" + stable(payload)).digest("hex");

export class ApprovalError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class ApprovalCenter {
  constructor(workspace, accountId, cfg, { now } = {}) {
    this.ws = workspace;
    this.account = accountId;
    this.cfg = cfg;
    this.now = now || (() => new Date().toISOString());
  }

  all() { return this.ws.readJson(this.account, "approvals.json", []); }
  save(list) { this.ws.writeJson(this.account, "approvals.json", list); }
  get(id) { const r = this.all().find((x) => x.id === id); if (!r) throw new ApprovalError("not_found", "Qeyd tapılmadı: " + id); return r; }

  update(id, fn) {
    const list = this.all();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new ApprovalError("not_found", "Qeyd tapılmadı: " + id);
    list[i] = fn({ ...list[i] });
    this.save(list);
    return list[i];
  }

  // 1) DRAFT: siyasət yoxlaması dərhal işləyir
  draft(kind, payload, { facts, extraChecks } = {}) {
    if (!KIND_CAPABILITY[kind]) throw new ApprovalError("unknown_kind", "Naməlum əməliyyat növü: " + kind);
    const cap = capability(KIND_CAPABILITY[kind]);
    const violations = [...checkPayload(kind, payload, facts), ...((extraChecks && extraChecks(payload)) || [])];
    const rec = {
      id: "apr_" + randomBytes(6).toString("hex"), kind, account_id: this.account, payload,
      status: STATES.DRAFT, violations, capability: cap.id, capability_status: cap.status,
      api_supported: isCallable(cap.id), created_at: this.now(), history: [{ at: this.now(), to: STATES.DRAFT }],
    };
    if (!rec.api_supported) rec.note = STATUS.UNSUPPORTED + ": " + (cap.reason || cap.feature) + " Qaralama yalnız əl ilə istifadə üçündür.";
    const list = this.all();
    list.push(rec);
    this.save(list);
    return rec;
  }

  // 2) REVIEW: pozuntu varsa keçmir
  submit(id) {
    return this.update(id, (r) => {
      if (r.status !== STATES.DRAFT) throw new ApprovalError("bad_state", "Yalnız DRAFT review-a göndərilir (indiki: " + r.status + ")");
      if (r.violations && r.violations.length) throw new ApprovalError("policy_violation", "Siyasət pozuntusu: " + r.violations.map((v) => v.rule).join(", "));
      r.status = STATES.REVIEW;
      r.payload_hash = hashPayload(r.kind, r.payload);
      r.history.push({ at: this.now(), to: STATES.REVIEW });
      return r;
    });
  }

  // 3) APPROVE: yalnız insan (by) və yalnız REVIEW-dan
  approve(id, { by } = {}) {
    if (!by || /^(claude|agent|bot|system|auto)/i.test(String(by))) throw new ApprovalError("human_required", "Təsdiqi yalnız hesab sahibi verə bilər");
    return this.update(id, (r) => {
      if (r.status !== STATES.REVIEW) throw new ApprovalError("bad_state", "Yalnız REVIEW təsdiqlənə bilər (indiki: " + r.status + ")");
      if (hashPayload(r.kind, r.payload) !== r.payload_hash) throw new ApprovalError("payload_changed", "Payload review-dan sonra dəyişib");
      r.status = STATES.APPROVED;
      r.approved_by = String(by);
      r.approved_at = this.now();
      r.history.push({ at: this.now(), to: STATES.APPROVED, by: String(by) });
      return r;
    });
  }

  reject(id, { by, reason } = {}) {
    return this.update(id, (r) => {
      if ([STATES.EXECUTED, STATES.REJECTED].includes(r.status)) throw new ApprovalError("bad_state", "Artıq qərar verilib");
      r.status = STATES.REJECTED;
      r.history.push({ at: this.now(), to: STATES.REJECTED, by: by || null, reason: reason || null });
      return r;
    });
  }

  // 4) EXECUTE: bütün qapılar keçilməlidir; bir dəfə icra
  async execute(id, executor) {
    const r = this.get(id);
    const gate = (code, msg) => {
      this.update(id, (x) => { x.history.push({ at: this.now(), event: "execute_blocked", code }); x.last_block = code; return x; });
      throw new ApprovalError(code, msg);
    };
    if (r.status !== STATES.APPROVED) gate("not_approved", "İcra üçün APPROVED status lazımdır (indiki: " + r.status + ")");
    if (hashPayload(r.kind, r.payload) !== r.payload_hash) gate("payload_changed", "Təsdiqdən sonra payload dəyişib");
    if (!isCallable(r.capability)) gate(STATUS.UNSUPPORTED, STATUS.UNSUPPORTED + ": " + capability(r.capability).feature + " — manual paket istifadə et");
    if (!this.cfg.executeEnabled) gate("execute_disabled", "execute_enabled=false: real icra söndürülüb (TIKTOK_EXECUTE_ENABLED=true lazımdır)");
    this.update(id, (x) => { x.status = "EXECUTING"; x.history.push({ at: this.now(), to: "EXECUTING" }); return x; });
    try {
      const result = await executor(r.kind, r.payload);
      return this.update(id, (x) => { x.status = STATES.EXECUTED; x.result = result; x.history.push({ at: this.now(), to: STATES.EXECUTED }); return x; });
    } catch (e) {
      // Avtomatik təkrar YOXDUR: nəticə FAILED qalır, insan qərar verir.
      return this.update(id, (x) => { x.status = STATES.FAILED; x.error = { code: e.code || "error", message: String(e.message || e) }; x.history.push({ at: this.now(), to: STATES.FAILED }); return x; });
    }
  }
}
