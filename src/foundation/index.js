// Foundation: yeni modulların bir yerdən yığılması. Mövcud src/index.js bunu ÇAĞIRMIR (qoşulma sonrakı mərhələdir).
//
//   JARVIS -> (gələcək orkestrator bağlantısı) -> Integration Registry (Instagram, TikTok, YouTube, Telegram, Shopify)
//   JARVIS -> Agents (LearningAgent, SalesAgent)
//   Storage -> KVStorage / MemoryStorage

import { createStorage, describeStorage } from "../storage/index.js";
import { createIntegrationRegistry } from "../integrations/registry.js";
import { LearningAgent } from "../agents/LearningAgent.js";
import { SalesAgent, LeadStore } from "../agents/SalesAgent.js";

export function createFoundation(env = {}, { mock = false, isolated = false, request, now, approvalCheck } = {}) {
  const storage = createStorage(env, { isolated, now: now ? () => now().getTime() : undefined });
  const integrations = createIntegrationRegistry(env, { mock, request });
  return {
    storage,
    integrations,
    agents: {
      learning: new LearningAgent({ storage: storage.scope("learning"), now, approvalCheck }),
      sales: new SalesAgent({ now }),
    },
    leads: new LeadStore(storage.scope("leads"), now),
    // Yalnız adlar və true/false. Heç bir dəyər yoxdur.
    status() {
      return { phase: "foundation", wired: false, storage: describeStorage(env), integrations: integrations.statuses() };
    },
  };
}
