// ApprovalExecutor: təsdiqlənmiş alət çağırışının icrası.
//
//   Task -> Approval required -> Pending -> Fərid approve edir (API/UI) -> İCAZƏNİN TƏKRAR YOXLANMASI
//        -> Tool execution -> Audit -> Result
//
// Qaydalar (hamısı testlərlə yoxlanır):
//  - İcra yalnız qeyd "approved" + execution "awaiting" olanda və təsdiqdən sonra EXEC_WINDOW_MS ərzində mümkündür.
//  - Rədd edilmiş, gözləyən, vaxtı keçmiş, artıq icra olunmuş qeyd icra olunmur.
//  - Qeyd icradan əvvəl "running"-ə keçirilir: eyni qeyd ikinci dəfə icra olunmur (tək istifadəlik).
//  - Giriş təsdiq anındakı heş ilə uyğun olmalıdır, alətin icazələri təkrar yoxlanır, ApprovalProof etibarlı olmalıdır.
//  - Audit jurnalına yalnız alət adı, status və qeyd id-si yazılır. Giriş və nəticə məzmunu yazılmır.
//  - Nəticə xülasəsi qeydə yazılmazdan əvvəl açar/token naxışlarından təmizlənir və qısaldılır.

import { mintProof, consumeProof, hashInput } from "./proof.js";
import { ApprovalCenter } from "./center.js";
import { redact } from "../audit/log.js";

export const EXEC_WINDOW_MS = 15 * 60 * 1000; // təsdiqdən sonra icra üçün pəncərə
const MAX_RESULT_JSON = 1500;

// Nəticəni qeydə yazmaq üçün qısa, təmizlənmiş xülasə. Tam nəticə yalnız cavabda qaytarılır.
export function summarizeResult(output) {
  let s;
  try {
    s = JSON.stringify(redact(output));
  } catch (e) {
    return null;
  }
  return s && s.length > MAX_RESULT_JSON ? s.slice(0, MAX_RESULT_JSON) + "…" : s;
}

export class ApprovalExecutor {
  // tools: ToolRegistry, approvals: ApprovalCenter, ctxFactory: () => alət kontekstı (permissions, integrations, storage, ...)
  constructor({ tools, approvals, audit = null, ctxFactory = () => ({}), now = () => Date.now() }) {
    if (!tools || typeof tools.executeApproved !== "function") throw new Error("ApprovalExecutor: tools lazımdır");
    if (!approvals || typeof approvals.claimExecution !== "function") throw new Error("ApprovalExecutor: approvals lazımdır");
    this.tools = tools;
    this.approvals = approvals;
    this.audit = audit;
    this.ctxFactory = ctxFactory;
    this.now = now;
  }

  async _log(event, data) {
    if (this.audit) await this.audit.log(event, data);
  }

  // Qaytarır: { ok, status, record?, output?, error? }
  // status: not_found | not_tool_call | not_approved | already_executed | expired_window | done | failed | denied | proof_rejected | ...
  async executeApproved(id) {
    const rec = await this.approvals.get(id);
    if (!rec) return { ok: false, status: "not_found" };
    if (!ApprovalCenter.isToolCall(rec)) return { ok: false, status: "not_tool_call" };
    if (rec.status !== "approved") return { ok: false, status: "not_approved", record: rec };
    if (rec.execution !== "awaiting") return { ok: false, status: "already_executed", record: rec };
    const decidedAt = Date.parse(rec.decided_at || "");
    if (!Number.isFinite(decidedAt) || this.now() - decidedAt > EXEC_WINDOW_MS) {
      await this._log("execution.window_expired", { id, tool: rec.tool });
      return { ok: false, status: "expired_window", record: rec };
    }

    // Giriş heş-i, icazələr və sübut registrdə yoxlanır. Burada icradan əvvəl qeyd "running"-ə keçirilir.
    const claimed = await this.approvals.claimExecution(id);
    if (!claimed) return { ok: false, status: "already_executed", record: rec };

    const proof = mintProof({ approvalId: id, tool: claimed.tool, inputHash: claimed.input_hash || (await hashInput(claimed.input)), expiresAt: this.now() + EXEC_WINDOW_MS });
    let res;
    try {
      res = await this.tools.executeApproved(claimed, this.ctxFactory(), proof);
    } catch (e) {
      res = { ok: false, status: "error", error: String((e && e.message) || e).slice(0, 200) };
    } finally {
      consumeProof(proof); // sübut tək istifadəlikdir
    }

    const result = res.ok ? { status: "done", summary: summarizeResult(res.output) } : { status: res.status, error: String(res.error || (res.errors && res.errors[0]) || "").slice(0, 200) };
    const finished = await this.approvals.finishExecution(id, { ok: !!res.ok, result });
    await this._log("execution." + (res.ok ? "done" : "failed"), { id, tool: claimed.tool, status: res.status });
    return { ok: !!res.ok, status: res.ok ? "done" : res.status, record: finished || claimed, output: res.ok ? res.output : undefined, error: res.ok ? undefined : result.error };
  }
}
