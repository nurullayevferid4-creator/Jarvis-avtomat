// Agent və Manager alətləri (yalnız oxuma, risk low).
// İcazə adları (DEFAULT_PERMISSIONS-a əlavə olunmalıdır): read.agents, read.reports

import { buildManagerReport } from "./manager.js";

export const AGENT_PERMISSIONS = ["read.agents", "read.reports"];

export function registerAgentTools(toolRegistry, agentRegistry) {
  toolRegistry.register({
    name: "agents.list",
    description: "Agentlərin siyahısı: rol, status (implemented/interface_only), imkanlar, təsdiq tələb edən və yalnız insan təsdiqi ilə icra olunan əməliyyatlar.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputSchema: { type: "object", required: ["agents", "human_approval_only"], properties: { agents: { type: "array" }, human_approval_only: { type: "array" } } },
    permissions: ["read.agents"],
    risk: "low",
    timeoutMs: 5000,
    requiresApproval: false,
    auditEvent: "agents.list",
    async handler() {
      return { agents: agentRegistry.list(), human_approval_only: agentRegistry.humanApprovalOnly() };
    },
  });

  toolRegistry.register({
    name: "manager.report",
    description: "Manager hesabatı: yalnız qoşulmuş providerlərin real məlumatı (təsdiqlər, işlər, lead funnel), risklər və qaydalarla çıxarılan tövsiyələr. Qoşulmayan bölmə 'qoşulmayıb' yazır, sıfır göstərmir.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputSchema: { type: "object", required: ["generated_at", "sections", "risks", "recommendations", "not_connected", "human_approval_only"], properties: { generated_at: { type: "string" }, sections: { type: "object" }, risks: { type: "array" }, recommendations: { type: "array" }, not_connected: { type: "array" }, human_approval_only: { type: "array" }, note: { type: "string" } } },
    permissions: ["read.reports"],
    risk: "low",
    timeoutMs: 20000,
    requiresApproval: false,
    auditEvent: "manager.report",
    async handler() {
      return await buildManagerReport({ providers: agentRegistry.providers, now: agentRegistry.now });
    },
  });
  return ["agents.list", "manager.report"];
}
