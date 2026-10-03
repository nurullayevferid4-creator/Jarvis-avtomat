// Alət reyestri: JARVIS-in istifadə edə biləcəyi hər alət burada təsvir olunur.
//
// Hər alətin: ad, təsvir, giriş sxemi, çıxış sxemi, icazələr, risk, vaxt limiti,
// təkrar cəhd sayı və təsdiq tələbi var. Alət yalnız run() vasitəsilə çağırılır və
// giriş yoxlanır, icazə yoxlanır, təsdiq tələb olunarsa alət İCRA OLUNMUR (təsdiq qeydi açılır),
// çıxış yoxlanır, nəticə audit jurnalına yazılır.

import { validate } from "../validate.js";
import { RISKS, RISK_POLICY, DEFAULT_PERMISSIONS, APPROVAL_ONLY_PERMISSIONS, FORBIDDEN_PERMISSIONS } from "../policy.js";

const NAME_RE = /^[a-z][a-z0-9_.]{1,62}$/;

export class ToolRegistry {
  constructor({ audit = null, approvals = null } = {}) {
    this.audit = audit;
    this.approvals = approvals;
    this.tools = new Map();
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
      requiresApproval: def.requiresApproval === true,
      handler: def.handler,
    };
    this.tools.set(tool.name, tool);
    return this;
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
      const rec = await approvals.create({ action: tool.name, content: JSON.stringify(input), risk: tool.risk, source: "tool" });
      await this._log("tool.pending_approval", { tool: name, approval_id: rec.id });
      return { ok: false, status: "pending_approval", approval_id: rec.id };
    }

    const started = Date.now();
    let lastError = "";
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
          return { ok: false, status: "timeout", error: lastError };
        }
        if (e && e.name === "UnsafeUrlError") break; // təkrarın mənası yoxdur
      } finally {
        clearTimeout(timer);
      }
    }
    await this._log("tool.error", { tool: name, error: lastError });
    return { ok: false, status: "error", error: lastError };
  }
}
