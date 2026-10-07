// Alət reyestri: JARVIS-in istifadə edə biləcəyi hər alət burada təsvir olunur.
//
// Hər alətin: ad, təsvir, giriş sxemi, çıxış sxemi, icazələr, risk, vaxt limiti,
// təkrar cəhd sayı və təsdiq tələbi var. Alət yalnız run() vasitəsilə çağırılır və
// giriş yoxlanır, icazə yoxlanır, təsdiq tələb olunarsa alət İCRA OLUNMUR (təsdiq qeydi açılır),
// çıxış yoxlanır, nəticə audit jurnalına yazılır.

import { validate } from "../validate.js";
import { RISKS, RISK_POLICY, DEFAULT_PERMISSIONS, APPROVAL_ONLY_PERMISSIONS, FORBIDDEN_PERMISSIONS } from "../policy.js";
import { toAppError } from "../errors.js";

const NO_RETRY = new Set(["VALIDATION_ERROR", "SECURITY_ERROR", "PERMISSION_ERROR", "AUTH_ERROR", "NOT_FOUND", "CONFLICT", "APPROVAL_REQUIRED"]);
const NAME_RE = /^[a-z][a-z0-9_.]{1,62}$/;

// approval: { kind?, build(input, ctx) -> {content, payload}, describe(payload), execute(input, ctx) }
// Yalnız describe+execute verilsə build avtomatik qurulur: payload = { input }, content = describe(payload).
function normalizeApproval(a) {
  if (!a) return null;
  if (typeof a.build === "function") return a;
  if (typeof a.describe === "function") {
    return { ...a, build: (input) => { const payload = { input }; return { content: String(a.describe(payload)).slice(0, 4000), payload }; } };
  }
  return null;
}

export class ToolRegistry {
  // sleep: təkrar cəhd gecikməsi (testdə sıfırlanır)
  constructor({ audit = null, approvals = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.audit = audit;
    this.approvals = approvals;
    this.sleep = sleep;
    this.tools = new Map();
    this.kinds = new Map(); // təsdiq növü -> alət
  }

  register(def) {
    if (!def || !NAME_RE.test(def.name || "")) throw new Error("alət adı düzgün deyil");
    if (this.tools.has(def.name)) throw new Error("alət artıq var: " + def.name);
    if (!def.description) throw new Error(def.name + ": təsvir yoxdur");
    if (typeof def.handler !== "function") throw new Error(def.name + ": handler yoxdur");
    if (!def.inputSchema || !def.outputSchema) throw new Error(def.name + ": giriş və çıxış sxemi məcburidir");
    if (!RISKS.includes(def.risk)) throw new Error(def.name + ": risk düzgün deyil");
    const permissions = Array.isArray(def.permissions) ? def.permissions : [];
    if (permissions.some((p) => FORBIDDEN_PERMISSIONS.includes(p))) throw new Error(def.name + ": qadağan olunmuş icazə");

    const needsApproval = RISK_POLICY[def.risk].approval || permissions.some((p) => APPROVAL_ONLY_PERMISSIONS.includes(p));
    if (needsApproval && def.requiresApproval !== true) throw new Error(def.name + ": bu alət üçün requiresApproval:true olmalıdır");
    if (permissions.some((p) => APPROVAL_ONLY_PERMISSIONS.includes(p)) && def.risk !== "high") throw new Error(def.name + ": belə alətin riski high olmalıdır");

    const tool = {
      name: def.name,
      description: String(def.description),
      inputSchema: def.inputSchema,
      outputSchema: def.outputSchema,
      permissions,
      risk: def.risk,
      timeoutMs: Math.min(60000, Math.max(1000, def.timeoutMs || 10000)),
      retries: Math.min(2, Math.max(0, def.retries | 0)),
      backoffMs: Math.min(5000, Math.max(0, def.backoffMs === undefined ? 300 : def.backoffMs | 0)),
      requiresApproval: def.requiresApproval === true,
      auditEvent: String(def.auditEvent || "tool." + def.name).slice(0, 60),
      handler: def.handler,
      approval: normalizeApproval(def.approval),
    };
    if (tool.approval) {
      tool.approval = { ...tool.approval, kind: tool.approval.kind || tool.name };
      if (tool.approval.execute !== undefined && typeof tool.approval.execute !== "function") throw new Error(def.name + ": approval.execute funksiya olmalıdır");
      if (tool.approval.execute && typeof tool.approval.describe !== "function") throw new Error(def.name + ": approval.execute üçün approval.describe məcburidir (xülasə = icra)");
      if (this.kinds.has(tool.approval.kind)) throw new Error("təsdiq növü artıq var: " + tool.approval.kind);
      this.kinds.set(tool.approval.kind, tool);
    }
    if (tool.requiresApproval && !tool.approval) {
      // strukturlu qeyd olmadan icra mümkün deyil: yalnız "əl ilə" qeyd açılır
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  byKind(kind) {
    return this.kinds.get(kind) || null;
  }

  has(name) {
    return this.tools.has(name);
  }

  // Açıq siyahı (handler olmadan)
  list() {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      permissions: t.permissions,
      risk: t.risk,
      timeoutMs: t.timeoutMs,
      retries: t.retries,
      requiresApproval: t.requiresApproval,
      auditEvent: t.auditEvent,
      executable: !!(t.approval && t.approval.execute),
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
    }));
  }

  async _log(event, data) {
    if (this.audit) await this.audit.log(event, data);
  }

  // Qaytarır: { ok, status, output?, errors?, error?, approval_id? }
  // status: done | not_found | invalid_input | denied | pending_approval | invalid_output | timeout | error
  async run(name, input, ctx = {}) {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, status: "not_found" };

    const inCheck = validate(tool.inputSchema, input);
    if (!inCheck.ok) {
      await this._log("tool.invalid_input", { tool: name });
      return { ok: false, status: "invalid_input", errors: inCheck.errors };
    }

    const granted = ctx.permissions || DEFAULT_PERMISSIONS;
    const missing = tool.permissions.filter((p) => !granted.includes(p) && !APPROVAL_ONLY_PERMISSIONS.includes(p));
    if (missing.length) {
      await this._log("tool.denied", { tool: name, missing });
      return { ok: false, status: "denied", error: "icazə yoxdur: " + missing.join(", ") };
    }

    if (tool.requiresApproval) {
      const approvals = ctx.approvals || this.approvals;
      if (!approvals) return { ok: false, status: "error", error: "təsdiq mərkəzi qoşulmayıb, alət icra olunmadı" };
      let content = JSON.stringify(input);
      let kind = null;
      let payload = null;
      if (tool.approval) {
        // Strukturlu təsdiq: payload və hash qeydə yazılır, sonradan dəyişdirilə bilməz.
        try {
          const b = await tool.approval.build(input, ctx); // build asinxron ola bilər (məs. lead limitləri bazadan yoxlanır)
          content = b.content;
          payload = b.payload;
          kind = tool.approval.kind || tool.name;
        } catch (e) {
          await this._log("tool.invalid_input", { tool: name });
          return { ok: false, status: "invalid_input", errors: [String((e && e.message) || "sorğu düzgün deyil").slice(0, 200)] };
        }
      }
      const rec = await approvals.create({ action: tool.name, content, risk: tool.risk, source: (ctx.source ? "tool:" + String(ctx.source).slice(0, 40) : "tool"), kind, payload, origin: ctx.origin || null });
      await this._log("tool.pending_approval", { tool: name, approval_id: rec.id });
      return { ok: false, status: "pending_approval", approval_id: rec.id };
    }

    const started = Date.now();
    let lastError = "";
    let lastErr = null;
    for (let attempt = 0; attempt <= tool.retries; attempt++) {
      let timer;
      try {
        const out = await Promise.race([
          tool.handler(input, ctx),
          new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("vaxt limiti aşıldı"), { timeout: true })), tool.timeoutMs); }),
        ]);
        const outCheck = validate(tool.outputSchema, out);
        if (!outCheck.ok) {
          await this._log("tool.invalid_output", { tool: name });
          return { ok: false, status: "invalid_output", errors: outCheck.errors };
        }
        await this._log("tool.done", { tool: name, ms: Date.now() - started, attempts: attempt + 1 });
        return { ok: true, status: "done", output: out };
      } catch (e) {
        lastError = String((e && e.message) || e).slice(0, 200);
        if (e && e.timeout) {
          await this._log("tool.timeout", { tool: name });
          return { ok: false, status: "timeout", error: lastError, error_code: "TIMEOUT" };
        }
        if (e && e.name === "UnsafeUrlError") { lastErr = toAppError(e, name); break; } // təkrarın mənası yoxdur
        lastErr = toAppError(e, name);
        if (NO_RETRY.has(lastErr.code)) break; // qəti xətalar təkrarlanmır; yan təsirsiz oxuma alətləri qalan hallarda təkrarlana bilər
        if (attempt < tool.retries && tool.backoffMs) await this.sleep(tool.backoffMs * 2 ** attempt + Math.floor(Math.random() * 50));
      } finally {
        clearTimeout(timer);
      }
    }
    // Jurnala texniki təfərrüat, istifadəçiyə yalnız təhlükəsiz mesaj (naməlum xətanın mətni çıxmır)
    await this._log("tool.error", { tool: name, error: lastError, code: lastErr && lastErr.code });
    return { ok: false, status: "error", error: lastErr ? lastErr.toPublic().message : "Daxili xəta baş verdi. Əməliyyat tamamlanmadı.", error_code: lastErr ? lastErr.code : "INTERNAL_ERROR" };
  }
}
