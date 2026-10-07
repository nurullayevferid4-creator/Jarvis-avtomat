// AgentRegistry: agentlərin açıq siyahısı və icra qapısı.
//  - "implemented" agent yalnız öz capabilities siyahısındakı alətləri çağıra bilər (alətlər ToolRegistry-dən keçir:
//    giriş/icazə/təsdiq yoxlamaları orada işləyir). Agent təsdiq qapısını keçə bilməz.
//  - "interface_only" agent İŞƏ DÜŞMÜR: AppError("VALIDATION_ERROR", "Bu agent hələ qoşulmayıb"). Saxta agent yoxdur.
//  - HUMAN_APPROVAL_ONLY siniflərindən (pul, geri ödəniş, hesab dəyişikliyi və s.) heç biri agent tərəfindən avtomatik icra olunmur.

import { AppError } from "../errors.js";
import { AGENT_DEFINITIONS, HUMAN_APPROVAL_ONLY } from "./definitions.js";
import { buildManagerReport } from "./manager.js";

export class AgentRegistry {
  constructor({ tools = null, events = null, providers = {}, now = () => Date.now(), definitions = AGENT_DEFINITIONS } = {}) {
    this.tools = tools;
    this.events = events;
    this.providers = providers;
    this.now = now;
    this.defs = new Map(definitions.map((d) => [d.id, Object.freeze({ ...d })]));
    this.humanOnly = new Set(HUMAN_APPROVAL_ONLY.map((x) => x.id));
  }

  list() {
    return [...this.defs.values()].map((d) => ({ ...d, capabilities: [...d.capabilities], requiresApprovalFor: [...d.requiresApprovalFor] }));
  }

  get(id) {
    const d = this.defs.get(String(id));
    if (!d) throw new AppError("NOT_FOUND", "Agent tapılmadı: " + String(id).slice(0, 40));
    return d;
  }

  humanApprovalOnly() {
    return HUMAN_APPROVAL_ONLY.map((x) => ({ ...x }));
  }

  isHumanApprovalOnly(actionId) {
    return this.humanOnly.has(String(actionId));
  }

  // request: { tool, input } və ya (yalnız manager üçün) { task: "report" }
  async run(id, request = {}, ctx = {}) {
    const d = this.get(id);
    if (d.status !== "implemented") throw new AppError("VALIDATION_ERROR", "Bu agent hələ qoşulmayıb");

    let result;
    if (request.task !== undefined) {
      if (d.id !== "manager" || request.task !== "report") throw new AppError("VALIDATION_ERROR", "Bu agent belə tapşırığı dəstəkləmir: " + String(request.task).slice(0, 40));
      result = { ok: true, status: "done", output: await buildManagerReport({ providers: this.providers, now: this.now }) };
    } else {
      const tool = String(request.tool || "");
      if (this.isHumanApprovalOnly(tool)) throw new AppError("SECURITY_ERROR", "Bu əməliyyat yalnız insan təsdiqi ilə icra olunur");
      if (!d.capabilities.includes(tool)) throw new AppError("PERMISSION_ERROR", "Bu agentin belə imkanı yoxdur: " + tool.slice(0, 60));
      if (!this.tools || !this.tools.has(tool)) throw new AppError("NOT_FOUND", "Alət qoşulmayıb: " + tool);
      result = await this.tools.run(tool, request.input || {}, ctx);
    }
    if (this.events) {
      try {
        await this.events.emit("agent.run", { agent: d.id, tool: request.tool, task: request.task, status: result.status });
      } catch (e) {
        /* hadisə yazılmasa əsas iş dayanmasın */
      }
    }
    return result;
  }
}
