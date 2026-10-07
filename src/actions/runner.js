// ActionRunner: TƏSDİQLƏNMİŞ strukturlu qeydi (kind + payload) real icra edir.
//
// Axın: approve (aktor yoxlanır) -> claimExecution (atomik bir dəfəlik iddia) -> xülasə=icra yoxlaması
//       -> giriş sxemi yoxlaması -> icra (vaxt limiti) -> nəticə + audit.
//
// Qaydalar:
//  - Təsdiq olmadan icra YOXDUR: claimExecution status:"approved" tələb edir.
//  - Xülasə 1:1: icra anında approval.describe(payload) yenidən hesablanır və qeyddəki mətnlə eyni olmalıdır.
//  - İki eyni vaxtlı icradan yalnız biri keçir (koordinator "once" markeri). İkincisi CONFLICT alır.
//  - Avtomatik təkrar YOXDUR: şəbəkə/vaxt xətasında yazının baş verib-vermədiyi bilinmir -> status "unknown".
//    Yenidən cəhd üçün yeni təsdiq lazımdır (iki dəfə yaratma/dərc qarşısı).
//  - İdempotentlik açarı (təsdiq id-si) handler-ə verilir; xarici API dəstəkləyirsə istifadə edir.

import { validate } from "../validate.js";
import { AppError, toAppError } from "../errors.js";

const MAX_RESULT = 1500;
const UNKNOWN_CODES = new Set(["TIMEOUT", "NETWORK_ERROR"]);

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new AppError("TIMEOUT", "İcra vaxt limitini aşdı", { source: "runner" })), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export function createActionRunner({ approvals, registry, audit = null }) {
  async function log(event, data) {
    if (audit) await audit.log(event, data);
  }

  // Təsdiq qeydi açır (qaralama). Heç nə icra olunmur.
  async function propose(toolName, input, { origin = null, source = "api", ctx = {} } = {}) {
    const r = await registry.run(toolName, input, { ...ctx, approvals, origin, source });
    return r; // { status:"pending_approval", approval_id } və ya xəta
  }

  // Təsdiqlənmiş qeydi icra edir. actor: { channel:"ui"|"telegram", chat_id? }
  async function execute(approvalId, { actor, ctx = {} } = {}) {
    const rec = await approvals.get(approvalId);
    if (!rec) return { ok: false, status: "not_found", error: { code: "NOT_FOUND", message: "Təsdiq qeydi tapılmadı" } };
    const tool = rec.kind ? registry.byKind(rec.kind) : null;
    if (!tool || !tool.approval || !tool.approval.execute) {
      return { ok: false, status: "not_executable", error: { code: "VALIDATION_ERROR", message: "Bu qeyd üçün avtomatik icra yoxdur" } };
    }

    // Xülasə = icra: göstərilən mətn payload-dan yenidən çıxarılır
    let expected;
    try {
      expected = String(tool.approval.describe(rec.payload)).slice(0, 4000);
    } catch (e) {
      await log("action.blocked", { approval_id: rec.id, reason: "describe_failed" });
      return { ok: false, status: "blocked", error: { code: "VALIDATION_ERROR", message: "Qeyd oxuna bilmədi" } };
    }
    if (expected !== rec.content) {
      await log("action.blocked", { approval_id: rec.id, reason: "summary_mismatch" });
      return { ok: false, status: "blocked", error: { code: "SECURITY_ERROR", message: "Təsdiq xülasəsi icra ediləcək əməliyyatla uyğun gəlmir" } };
    }

    const claim = await approvals.claimExecution(rec.id, { actor, kind: rec.kind });
    if (!claim.ok) {
      const code = claim.error === "already_executed" ? "CONFLICT" : claim.error === "forbidden_origin" ? "PERMISSION_ERROR" : claim.error === "not_found" ? "NOT_FOUND" : claim.error.startsWith("not_approved") ? "APPROVAL_REQUIRED" : "SECURITY_ERROR";
      await log("action.blocked", { approval_id: rec.id, reason: claim.error });
      return { ok: false, status: claim.error === "already_executed" ? "already_executed" : "blocked", error: { code, message: claim.error }, record: claim.record };
    }

    // Konvensiya: strukturlu alət qeydinin payload-u { input, ... } formasındadır.
    const input = rec.payload && rec.payload.input;
    const check = validate(tool.inputSchema, input);
    if (!check.ok) {
      const err = { code: "VALIDATION_ERROR", message: "Payload sxemə uyğun deyil: " + check.errors.join("; ").slice(0, 200) };
      await approvals.finishExecution(rec.id, "failed", { error: err });
      await log("action.failed", { approval_id: rec.id, tool: tool.name, code: err.code });
      return { ok: false, status: "failed", error: err };
    }

    const started = Date.now();
    try {
      const out = await withTimeout(Promise.resolve(tool.approval.execute(input, { ...ctx, idempotencyKey: rec.id, approvalId: rec.id, actor })), tool.timeoutMs);
      const outCheck = validate(tool.outputSchema, out);
      if (!outCheck.ok) {
        // İcra olunub, amma cavab gözlənilən formada deyil: nəticə bilinmir, uğur elan etmirik
        const err = { code: "PROVIDER_ERROR", message: "İcra cavabı gözlənilən formada deyil, nəticəni yoxlayın" };
        await approvals.finishExecution(rec.id, "unknown", { error: err });
        await log("action.unknown", { approval_id: rec.id, tool: tool.name, reason: "invalid_output" });
        return { ok: false, status: "unknown", error: err };
      }
      const summary = JSON.stringify(out).slice(0, MAX_RESULT);
      await approvals.finishExecution(rec.id, "done", { result: { summary, ms: Date.now() - started } });
      await log(tool.auditEvent + ".executed", { approval_id: rec.id, tool: tool.name, ms: Date.now() - started });
      return { ok: true, status: "done", output: out };
    } catch (e) {
      const err = toAppError(e, tool.name);
      const unknown = UNKNOWN_CODES.has(err.code) || err.code === "INTERNAL_ERROR";
      const pub = err.toPublic();
      await approvals.finishExecution(rec.id, unknown ? "unknown" : "failed", { error: pub });
      await log(tool.auditEvent + (unknown ? ".unknown" : ".failed"), { approval_id: rec.id, tool: tool.name, code: err.code, detail: err.detail || undefined });
      return { ok: false, status: unknown ? "unknown" : "failed", error: pub, note: unknown ? "Nəticə bilinmir: xarici sistemdə yoxlayın. Avtomatik təkrar edilmir." : undefined };
    }
  }

  // Təsdiq + icra bir addımda (UI və Telegram düyməsi). Reject etmir, yalnız approve.
  async function approveAndExecute(approvalId, { actor, ctx = {} } = {}) {
    const d = await approvals.decide(approvalId, { decision: "approve", actor });
    if (!d.ok) {
      const code = d.error === "forbidden_origin" ? "PERMISSION_ERROR" : d.error === "not_found" ? "NOT_FOUND" : d.error === "already_decided" ? "CONFLICT" : "VALIDATION_ERROR";
      return { ok: false, status: "not_approved", error: { code, message: d.error }, record: d.record };
    }
    return await execute(approvalId, { actor, ctx });
  }

  return { propose, execute, approveAndExecute };
}
