// Agent reyestrinin giriş nöqtəsi.
//   const agents = createAgentRegistry({ tools, store, providers: { leads, approvals, jobs }, now });
//   registerAgentTools(tools, agents);   // agents.list və manager.report alətləri (icazələr: read.agents, read.reports)
// deps.events verilməsə və deps.store varsa EventBus avtomatik qurulur (agents.events).

import { AgentRegistry } from "./registry.js";
import { createEventBus } from "./events.js";

export function createAgentRegistry(deps = {}) {
  const events = deps.events || (deps.store ? createEventBus({ store: deps.store, now: deps.now }) : null);
  const reg = new AgentRegistry({ tools: deps.tools || null, events, providers: deps.providers || {}, now: deps.now || (() => Date.now()) });
  reg.events = events;
  return reg;
}

export { AgentRegistry } from "./registry.js";
export { registerAgentTools, AGENT_PERMISSIONS } from "./tools.js";
export { createEventBus, KNOWN_EVENT_TYPES } from "./events.js";
export { buildManagerReport, MANAGER_RULES } from "./manager.js";
export { AGENT_DEFINITIONS, HUMAN_APPROVAL_ONLY } from "./definitions.js";
export { createApprovalProvider, createJobProvider, createShopifyProvider } from "./providers.js";
export { registerOpsTools, OPS_PERMISSIONS, ORDER_TOOLS, LOGISTICS_TOOLS, SELLER_TOOLS, SUPPORT_TOOLS, FRAUD_TOOLS } from "./ops.js";
