// Runtime yığımı: mövcud sistem (store, audit, təsdiq mərkəzi, bilik bazası) + yeni modullar (alət reyestri, inteqrasiyalar, agentlər,
// storage, ApprovalExecutor) bir yerdə. src/index.js yalnız bunu çağırır.
//
//   User -> Claude Planner -> Orchestrator -> Tool Registry -> Integration/Agent -> (Approval) -> Execution -> Result
//
// Hər sorğuda təzədən qurulur (Worker-də ucuzdur). Heç bir real xarici çağırış qurulma zamanı edilmir.

import { createStore } from "./state/store.js";
import { createAudit } from "./audit/log.js";
import { ApprovalCenter } from "./approval/center.js";
import { ApprovalExecutor } from "./approval/executor.js";
import { KnowledgeBase } from "./knowledge/KnowledgeBase.js";
import { createWiredToolRegistry, grantedPermissions, revokedPermissions } from "./tools/integrationTools.js";
import { createFoundation } from "./foundation/index.js";

const on = (v) => (v === undefined || v === null || v === "" ? true : !/^(0|false|off|no)$/i.test(String(v)));

// FEATURE_TOOLS: alətlərin orkestratora qoşulması; FEATURE_LEARNING: nəticələrin qeyd edilməsi və təsdiqlənmiş qaydaların oxunması.
export function getWiringFeatures(env = {}) {
  return { tools: on(env.FEATURE_TOOLS), learning: on(env.FEATURE_LEARNING) };
}

export function createRuntime(env, { features, wiring = getWiringFeatures(env), request, now } = {}) {
  const store = createStore(env);
  const audit = createAudit(store);
  const approvals = new ApprovalCenter(store, audit);
  const knowledge = new KnowledgeBase(store, audit);
  const approvalsOn = features ? !!features.approvals : true;

  // Öyrənmə qaydası yalnız bu yoxlama `true` qaytararsa "approved" olur: qeyd tool_call, alət learning.apply_rule, təsdiqlənmiş,
  // icra mərhələsində ("running") və giriş məhz bu təklifə aiddir.
  const approvalCheck = async (approvalId, proposal) => {
    const rec = await approvals.get(approvalId);
    return !!rec && ApprovalCenter.isToolCall(rec) && rec.tool === "learning.apply_rule" && rec.status === "approved" && rec.execution === "running" && !!rec.input && rec.input.proposal_id === proposal.id;
  };

  const foundation = createFoundation(env, { request, now, approvalCheck });
  const tools = createWiredToolRegistry({ audit, approvals: approvalsOn ? approvals : null });

  const toolCtx = () => ({
    permissions: grantedPermissions(env),
    revoked: revokedPermissions(env),
    approvals: approvalsOn ? approvals : null,
    integrations: foundation.integrations,
    storage: foundation.storage,
    knowledge,
    learning: foundation.agents.learning,
    sales: foundation.agents.sales,
    leads: foundation.leads,
  });

  const executor = new ApprovalExecutor({ tools, approvals, audit, ctxFactory: toolCtx });
  return { store, audit, approvals, knowledge, foundation, integrations: foundation.integrations, tools, toolCtx, executor, wiring };
}
