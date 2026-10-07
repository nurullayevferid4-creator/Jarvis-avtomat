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

export function buildContext(env) {
  const store = createStore(env);
  const audit = createAudit(store);
  const coord = createCoordinator(env);
  const approvals = new ApprovalCenter(store, audit, () => Date.now(), coord);
  const knowledge = new KnowledgeBase(store, audit);
  const hub = createSocialHub(env, store);
  const flow = createSocialFlow({ env, store, approvals, audit, hub, coord });
  const tools = createDefaultToolRegistry({ audit, approvals });
  const runner = createActionRunner({ approvals, registry: tools, audit });
  return { env, store, audit, coord, approvals, knowledge, hub, flow, tools, runner };
}
