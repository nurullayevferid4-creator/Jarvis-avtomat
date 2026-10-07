// Kompozisiya kökü: bütün komponentlər burada bir dəfə qurulur. index.js və testlər eyni yerdən istifadə edir.
// Qeyd: Worker-də hər sorğuda yenidən qurulur (ucuzdur, vəziyyət KV/DO-dadır).

import { createStore } from "../state/store.js";
import { createAudit } from "../audit/log.js";
import { ApprovalCenter } from "../approval/center.js";
import { createCoordinator } from "../coord/coordinator.js";
import { createSocialHub } from "../social/hub.js";
import { createSocialFlow } from "../social/flow.js";
import { KnowledgeBase } from "../knowledge/KnowledgeBase.js";
import { createDefaultToolRegistry } from "../tools/builtin.js";
import { createActionRunner } from "../actions/runner.js";
import { createProviderRouter } from "../providers/router.js";
import { createShopify, registerShopifyTools } from "../shopify/index.js";
import { registerLeadTools } from "../leads/index.js";
import { registerMarketingTools } from "../marketing/index.js";
import { createMediaLibrary } from "../media/library.js";
import { createMediaJobs } from "../media/jobs.js";
import { createVideoProcessor } from "../media/processor.js";
import { registerMediaTools } from "../media/tools.js";
import { createAgentRegistry, registerAgentTools, createApprovalProvider, createJobProvider, createShopifyProvider, createEventBus } from "../agents/index.js";
import { Q_ORDERS } from "../shopify/gql.js";
import { registerOpsTools } from "../agents/ops.js";

export function buildContext(env, { fetchImpl } = {}) {
  const store = createStore(env);
  const audit = createAudit(store);
  const coord = createCoordinator(env);
  const approvals = new ApprovalCenter(store, audit, () => Date.now(), coord);
  const events = createEventBus({ store });
  approvals.events = events;
  const knowledge = new KnowledgeBase(store, audit);
  const hub = createSocialHub(env, store);
  const flow = createSocialFlow({ env, store, approvals, audit, hub, coord });
  const providers = createProviderRouter(env);
  const llm = providers.asLlm();

  const tools = createDefaultToolRegistry({ audit, approvals });
  tools.baseCtx = { knowledge };
  const shopify = createShopify({ env, store, audit, coord, fetchImpl });
  registerShopifyTools(tools, { client: shopify.client, vault: shopify.vault, audit, env });
  const library = createMediaLibrary({ media: hub.media, store, audit });
  const processor = createVideoProcessor(env, { fetchImpl });
  const mediaJobs = createMediaJobs({ store, coord, library, media: hub.media, processor, audit });
  registerMediaTools(tools, { library, jobs: mediaJobs, media: hub.media });
  const leads = registerLeadTools(tools, { store, coord, events });
  registerMarketingTools(tools, { llm });
  registerOpsTools(tools, { client: shopify.client, llm });
  const agents = createAgentRegistry({ tools, store, events, providers: { leads: leads.provider, approvals: createApprovalProvider(approvals), jobs: createJobProvider(store), shopify: createShopifyProvider(shopify.client, Q_ORDERS) } });
  registerAgentTools(tools, agents);

  const runner = createActionRunner({ approvals, registry: tools, audit });
  return { env, store, audit, coord, approvals, events, knowledge, hub, flow, providers, llm, tools, shopify, leads, agents, runner, library, mediaJobs, processor };
}
