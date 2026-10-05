// Alət reyestrinə qoşulan yeni alətlər: inteqrasiyalar (Instagram, TikTok, YouTube, Telegram, Shopify), Storage, LearningAgent, SalesAgent.
//
// Qaydalar:
//  - Hər alətin giriş və çıxış sxemi var (reyestr validasiyası saxlanılır).
//  - Oxuma alətləri "low" riskdədir və təsdiqsiz işləyir. Şəxsi məlumat oxuyan alət (shopify.customers.list) və hər yazma alət təsdiq tələb edir.
//  - Yazma/təsir alətləri (telegram.message.send, sales.message.send, learning.apply_rule) YALNIZ ApprovalExecutor ilə icra olunur və ctx.approvalProof tələb edir.
//  - Endpoint-i rəsmi sənədlə yoxlanmayan yazma əməliyyatı üçün alət QEYDƏ ALINMIR (yalnız verified:true olanlar).
//  - Alətlər icazələri ctx.permissions ilə yoxlanır (bax grantedPermissions). Bu icazələr secret oxumaq/dəyişdirməyi əhatə etmir.

import { DEFAULT_PERMISSIONS } from "../policy.js";
import { ToolRegistry } from "./registry.js";
import { createDefaultToolRegistry } from "./builtin.js";
import { ADAPTER_CLASSES } from "../integrations/registry.js";
import { IntegrationError } from "../integrations/errors.js";
import { LEAD_SCHEMA } from "../agents/SalesAgent.js";
import { AgentError, scrub } from "../agents/common.js";
import { isValidId } from "../state/store.js";
import { validate } from "../validate.js";

export const INTEGRATION_READ_PERMISSIONS = Object.freeze(["read.instagram", "read.tiktok", "read.youtube", "read.telegram", "read.shopify"]);
export const SENSITIVE_READ_PERMISSIONS = Object.freeze(["read.shopify.pii"]);
export const AGENT_PERMISSIONS = Object.freeze(["read.learning", "write.learning", "write.learning.rules", "read.leads", "write.leads", "draft.sales"]);
export const STORAGE_PERMISSIONS = Object.freeze(["read.storage", "write.storage"]);

// Standart olaraq verilən icazələr. REVOKED_PERMISSIONS (Worker dəyişəni, vergüllə) ilə hər biri sistemdən çıxarıla bilər:
// çıxarılan icazə həm yeni çağırışı, həm də artıq təsdiqlənmiş çağırışın icrasını bloklayır (icazənin təkrar yoxlanması).
export function revokedPermissions(env = {}) {
  return String(env.REVOKED_PERMISSIONS || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
}

export function grantedPermissions(env = {}) {
  const revoked = new Set(revokedPermissions(env));
  return [...DEFAULT_PERMISSIONS, ...INTEGRATION_READ_PERMISSIONS, ...SENSITIVE_READ_PERMISSIONS, ...AGENT_PERMISSIONS, ...STORAGE_PERMISSIONS].filter((p) => !revoked.has(p));
}

const OBJ = { type: "object" };
const RESULT_SCHEMA = { type: "object", required: ["mock", "integration", "op", "data"], properties: { mock: { type: "boolean" }, integration: { type: "string" }, op: { type: "string" }, data: OBJ } };

// Əməliyyat -> alətin icazəsi, riski. Dəqiq siyahı: yeni əməliyyat avtomatik "açıq" olmur.
const INTEGRATION_TOOL_META = {
  "shopify.customers.list": { permissions: ["read.shopify.pii"], risk: "medium", requiresApproval: true },
};

function integrationTools(reg) {
  for (const [id, Cls] of Object.entries(ADAPTER_CLASSES)) {
    const probe = new Cls({ env: {} });
    const verified = new Set(probe.status().verifiedEndpoints);
    for (const [op, def] of Object.entries(probe.operations)) {
      if (!verified.has(op)) continue; // yoxlanmamış endpoint: alət yoxdur
      const name = id + "." + op;
      const isWrite = def.kind === "write";
      const meta = INTEGRATION_TOOL_META[name] || (isWrite ? { permissions: ["send.message"], risk: "high", requiresApproval: true } : { permissions: ["read." + id], risk: "low", requiresApproval: false });
      reg.register({
        name,
        description: def.description + " [" + id + "]",
        inputSchema: def.input,
        outputSchema: RESULT_SCHEMA,
        permissions: meta.permissions,
        risk: meta.risk,
        requiresApproval: meta.requiresApproval,
        timeoutMs: 20000,
        retries: 0,
        async handler(input, ctx) {
          const adapter = ctx.integrations && ctx.integrations.get(id);
          if (!adapter) throw new IntegrationError("not_configured", "inteqrasiya reyestri qoşulmayıb", { integration: id, op });
          const r = isWrite ? await adapter.runApproved(op, input, ctx.approvalProof) : await adapter.run(op, input);
          return { mock: r.mock === true, integration: id, op, data: r.data && typeof r.data === "object" ? r.data : { value: r.data } };
        },
      });
    }
  }
}

function need(ctx, key) {
  if (!ctx[key]) throw new AgentError("not_found", key + " qoşulmayıb");
  return ctx[key];
}

const NOTE_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,60}$/;

function storageTools(reg) {
  reg.register({
    name: "storage.note.put",
    description: "Qısa qeyd saxlayır (açar + mətn). Yalnız qeyd bölməsinə yazır; təsdiq, audit, öyrənmə və s. məlumata toxunmur. Açar kimi görünən mətn gizlədilir.",
    inputSchema: { type: "object", required: ["key", "text"], additionalProperties: false, properties: { key: { type: "string", minLength: 1, maxLength: 61 }, text: { type: "string", minLength: 1, maxLength: 2000 } } },
    outputSchema: { type: "object", required: ["saved", "key"], properties: { saved: { type: "boolean" }, key: { type: "string" } } },
    permissions: ["write.storage"],
    risk: "low",
    async handler(input, ctx) {
      if (!NOTE_KEY_RE.test(input.key)) throw new AgentError("invalid_input", "açar yalnız kiçik hərf, rəqəm, _ və - ola bilər");
      await need(ctx, "storage").scope("memory").put("note-" + input.key, { key: input.key, text: scrub(input.text, 2000), ts: new Date().toISOString() });
      return { saved: true, key: input.key };
    },
  });
  reg.register({
    name: "storage.note.get",
    description: "Saxlanmış qeydi açarla oxuyur.",
    inputSchema: { type: "object", required: ["key"], additionalProperties: false, properties: { key: { type: "string", minLength: 1, maxLength: 61 } } },
    outputSchema: { type: "object", required: ["found"], properties: { found: { type: "boolean" }, text: { type: "string" }, ts: { type: "string" } } },
    permissions: ["read.storage"],
    risk: "low",
    async handler(input, ctx) {
      if (!NOTE_KEY_RE.test(input.key)) throw new AgentError("invalid_input", "açar düzgün deyil");
      const v = await need(ctx, "storage").scope("memory").get("note-" + input.key);
      return v ? { found: true, text: String(v.text || ""), ts: String(v.ts || "") } : { found: false };
    },
  });
  reg.register({
    name: "storage.note.list",
    description: "Saxlanmış qeydlərin açarlarını siyahılayır.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputSchema: { type: "object", required: ["keys"], properties: { keys: { type: "array" } } },
    permissions: ["read.storage"],
    risk: "low",
    async handler(input, ctx) {
      const { keys } = await need(ctx, "storage").scope("memory").list({ prefix: "note-", limit: 50 });
      return { keys: keys.map((k) => String(k).replace(/^note-/, "")) };
    },
  });
}

function learningTools(reg) {
  const PROPOSAL = { type: "object", required: ["title", "target", "text"], additionalProperties: false, properties: { title: { type: "string", minLength: 3, maxLength: 120 }, rationale: { type: "string", maxLength: 400 }, target: { type: "string", minLength: 1, maxLength: 40 }, text: { type: "string", minLength: 3, maxLength: 400 } } };
  reg.register({
    name: "learning.record",
    description: "İşin nəticəsini qeyd edir (uğurlu/uğursuz). Heç nəyi dəyişmir, yalnız qeyd saxlayır.",
    inputSchema: { type: "object", required: ["task", "status"], additionalProperties: false, properties: { task: { type: "string", minLength: 1, maxLength: 300 }, status: { type: "string", enum: ["achieved", "partial", "blocked", "pending_approval", "draft_only", "failed"] }, summary: { type: "string", maxLength: 600 }, reason: { type: "string", maxLength: 200 }, tool: { type: "string", maxLength: 60 } } },
    outputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    permissions: ["write.learning"],
    risk: "low",
    async handler(input, ctx) { return await need(ctx, "learning").recordOutcome(input); },
  });
  reg.register({
    name: "learning.analyze",
    description: "Son nəticələri təhlil edir və təkmilləşdirmə təklifləri hesablayır (saxlamır, tətbiq etmir).",
    inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } },
    outputSchema: { type: "object", required: ["analysis", "suggestions"], properties: { analysis: OBJ, suggestions: { type: "array" } } },
    permissions: ["read.learning"],
    risk: "low",
    async handler(input, ctx) {
      const l = need(ctx, "learning");
      const analysis = l.analyze(await l.listOutcomes({ limit: input.limit || 50 }));
      return { analysis, suggestions: l.proposeImprovements(analysis) };
    },
  });
  reg.register({
    name: "learning.propose",
    description: "Təkmilləşdirmə qaydası TƏKLİFİ saxlayır (status 'proposed'). Hədəf yalnız workflow_note, checklist, tool_hint ola bilər; system prompt, secret, icazə, təsdiq və təhlükəsizlik qadağandır.",
    inputSchema: PROPOSAL,
    outputSchema: { type: "object", required: ["id", "status"], properties: { id: { type: "string" }, status: { type: "string" } } },
    permissions: ["write.learning"],
    risk: "low",
    async handler(input, ctx) { const r = await need(ctx, "learning").saveProposal(input); return { id: r.id, status: "proposed" }; },
  });
  reg.register({
    name: "learning.list",
    description: "Təklifləri və təsdiqlənmiş qaydaları siyahılayır.",
    inputSchema: { type: "object", additionalProperties: false, properties: { what: { type: "string", enum: ["proposals", "rules"] }, limit: { type: "integer", minimum: 1, maximum: 30 } } },
    outputSchema: { type: "object", required: ["items"], properties: { items: { type: "array" } } },
    permissions: ["read.learning"],
    risk: "low",
    async handler(input, ctx) {
      const l = need(ctx, "learning");
      const limit = input.limit || 30;
      return { items: input.what === "rules" ? await l.getApprovedRules({ limit }) : await l.listProposals({ limit }) };
    },
  });
  reg.register({
    name: "learning.apply_rule",
    description: "Təklifi təsdiqlənmiş qayda kimi saxlayır. Yalnız Fərid təsdiq mərkəzində təsdiqləyəndən sonra icra olunur.",
    inputSchema: { type: "object", required: ["proposal_id"], additionalProperties: false, properties: { proposal_id: { type: "string", minLength: 5, maxLength: 64 } } },
    outputSchema: { type: "object", required: ["id", "status"], properties: { id: { type: "string" }, status: { type: "string" } } },
    permissions: ["write.learning.rules"],
    risk: "medium",
    requiresApproval: true,
    async handler(input, ctx) {
      if (!ctx.approvalProof || !isValidId(ctx.approvalProof.approvalId)) throw new AgentError("approval_required", "Fərid-in təsdiqi yoxdur");
      return await need(ctx, "learning").approveProposal(input.proposal_id, { approvalId: ctx.approvalProof.approvalId });
    },
  });
}

const PRODUCTS = { type: "array", maxItems: 5, items: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 80 }, price_azn: { type: "number", minimum: 0, maximum: 1000000 } }, required: ["name"], additionalProperties: false } };
const DAY_MS = 24 * 3600 * 1000;
export const SALES_SEND_PER_LEAD_PER_DAY = 1;
export const SALES_SEND_PER_DAY = 5;

function salesTools(reg) {
  reg.register({
    name: "lead.create",
    description: "Lead qeydi yaradır (CRM). Əlaqə razılığı (consent) 'denied' ola bilər: onda heç bir əlaqə planı qurulmur.",
    inputSchema: LEAD_SCHEMA,
    outputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    permissions: ["write.leads"],
    risk: "low",
    async handler(input, ctx) { return await need(ctx, "leads").create(input); },
  });
  reg.register({
    name: "lead.get",
    description: "Lead qeydini id ilə oxuyur.",
    inputSchema: { type: "object", required: ["lead_id"], additionalProperties: false, properties: { lead_id: { type: "string", minLength: 5, maxLength: 64 } } },
    outputSchema: { type: "object", required: ["found"], properties: { found: { type: "boolean" }, lead: OBJ } },
    permissions: ["read.leads"],
    risk: "low",
    async handler(input, ctx) {
      if (!isValidId(input.lead_id)) throw new AgentError("invalid_input", "lead_id düzgün deyil");
      const l = await need(ctx, "leads").get(input.lead_id);
      return l ? { found: true, lead: l } : { found: false };
    },
  });
  reg.register({
    name: "lead.list",
    description: "Son lead qeydlərini siyahılayır.",
    inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } },
    outputSchema: { type: "object", required: ["items"], properties: { items: { type: "array" } } },
    permissions: ["read.leads"],
    risk: "low",
    async handler(input, ctx) { return { items: await need(ctx, "leads").list({ limit: input.limit || 20 }) }; },
  });
  reg.register({
    name: "sales.pipeline",
    description: "Satış axını (YALNIZ QARALAMA): araşdırma (bilik bazası) -> lead qiymətləndirməsi -> lead balı -> söhbət planı -> təklif qaralaması -> follow-up təklifi. Heç nə göndərmir. Göndərmə ayrıca təsdiq tələb edir (sales.message.send).",
    inputSchema: { type: "object", additionalProperties: false, properties: { lead_id: { type: "string", maxLength: 64 }, lead: LEAD_SCHEMA, products: PRODUCTS, catalog_keywords: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 40 } }, min_budget_azn: { type: "integer", minimum: 0, maximum: 1000000 } } },
    outputSchema: { type: "object", required: ["draft_only", "requires_approval", "qualification", "conversation_plan", "offer", "followup", "research"], properties: { draft_only: { type: "boolean" }, requires_approval: { type: "boolean" }, qualification: OBJ, conversation_plan: OBJ, offer: OBJ, followup: OBJ, research: { type: "array" } } },
    permissions: ["draft.sales"],
    risk: "low",
    async handler(input, ctx) {
      const sales = need(ctx, "sales");
      let lead = input.lead;
      if (input.lead_id !== undefined) {
        if (lead) throw new AgentError("invalid_input", "lead_id və lead birlikdə verilə bilməz");
        if (!isValidId(input.lead_id)) throw new AgentError("invalid_input", "lead_id düzgün deyil");
        const stored = await need(ctx, "leads").get(input.lead_id);
        if (!stored) throw new AgentError("not_found", "lead tapılmadı");
        const { id, created_at, ...rest } = stored; // eslint-disable-line no-unused-vars
        // Saxlanmış qeyddə boş sahələr null ola bilər; schema onları qəbul etmir
        lead = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== undefined));
      }
      if (!lead) throw new AgentError("invalid_input", "lead və ya lead_id lazımdır");
      const v = validate(LEAD_SCHEMA, lead);
      if (!v.ok) throw new AgentError("invalid_input", "lead düzgün deyil: " + v.errors.slice(0, 2).join("; "));
      // 1) araşdırma: yalnız daxili bilik bazası (xarici sorğu yoxdur)
      let research = [];
      if (ctx.knowledge && (lead.interests || []).length && (ctx.permissions || DEFAULT_PERMISSIONS).includes("read.knowledge")) {
        const found = await ctx.knowledge.search((lead.interests || []).join(" ").slice(0, 200), { limit: 3, window: 15 });
        research = found.map((k) => ({ id: k.id, type: k.type, title: String(k.title).slice(0, 120), trust: k.trust, flagged: !!k.flagged }));
      }
      const qualification = sales.qualifyLead(lead, { minBudgetAzn: input.min_budget_azn, catalogKeywords: input.catalog_keywords });
      const conversation_plan = sales.planConversation(lead);
      const offer = sales.generateOffer(lead, { products: input.products || [] });
      const followup = sales.planFollowUp(lead);
      return { draft_only: true, requires_approval: true, qualification, conversation_plan, offer, followup, research };
    },
  });
  reg.register({
    name: "sales.message.send",
    description: "Tək lead-ə təsdiqlənmiş mesajı qeydə alır. Kütləvi göndərmə YOXDUR: bir çağırış = bir lead, gündə ümumi ≤ " + SALES_SEND_PER_DAY + ", lead başına ≤ " + SALES_SEND_PER_LEAD_PER_DAY + ". Razılığı 'denied' olan lead-ə icazə yoxdur. Kanal göndərmə endpoint-i yoxlanmadığı üçün nəticə 'sent:false, delivery:manual_required' olur (özün göndər).",
    inputSchema: { type: "object", required: ["lead_id", "text"], additionalProperties: false, properties: { lead_id: { type: "string", minLength: 5, maxLength: 64 }, text: { type: "string", minLength: 1, maxLength: 1000 } } },
    outputSchema: { type: "object", required: ["sent", "delivery", "channel"], properties: { sent: { type: "boolean" }, delivery: { type: "string" }, channel: { type: "string" }, reason: { type: "string" } } },
    permissions: ["send.message"],
    risk: "high",
    requiresApproval: true,
    async handler(input, ctx) {
      if (!ctx.approvalProof || !isValidId(ctx.approvalProof.approvalId)) throw new AgentError("approval_required", "Fərid-in təsdiqi yoxdur");
      if (!isValidId(input.lead_id)) throw new AgentError("invalid_input", "lead_id düzgün deyil");
      const leads = need(ctx, "leads");
      const lead = await leads.get(input.lead_id);
      if (!lead) throw new AgentError("not_found", "lead tapılmadı");
      if (lead.consent === "denied") throw new AgentError("forbidden_target", "lead əlaqəyə razılıq verməyib");
      if (lead.stage === "won" || lead.stage === "lost") throw new AgentError("invalid_state", "lead bağlanıb");
      // Tezlik limiti (spam qarşısı): lead başına və ümumi gündəlik
      const store = need(ctx, "storage").scope("leads");
      const now = Date.now();
      const day = new Date(now).toISOString().slice(0, 10);
      const lastKey = "sentlead-" + input.lead_id;
      const last = await store.get(lastKey);
      if (last && now - Date.parse(last.ts) < DAY_MS / SALES_SEND_PER_LEAD_PER_DAY) throw new AgentError("rate_limited", "bu lead-ə son 24 saatda artıq mesaj təsdiqlənib");
      const dayKey = "sentday-" + day;
      const counter = (await store.get(dayKey)) || { n: 0 };
      if (counter.n >= SALES_SEND_PER_DAY) throw new AgentError("rate_limited", "gündəlik mesaj limiti dolub");
      await store.put(lastKey, { ts: new Date(now).toISOString() }, { ttlSeconds: 2 * 86400 });
      await store.put(dayKey, { n: counter.n + 1 }, { ttlSeconds: 2 * 86400 });
      return { sent: false, delivery: "manual_required", channel: lead.channel, reason: "kanal göndərmə endpoint-i rəsmi sənədlə yoxlanmayıb; təsdiqlənmiş mətni özün göndər" };
    },
  });
}

// Bütün alətlər: mövcud daxili alətlər + yeni inteqrasiya/storage/agent alətləri.
export function createWiredToolRegistry({ audit = null, approvals = null } = {}) {
  const reg = createDefaultToolRegistry({ audit, approvals });
  integrationTools(reg);
  storageTools(reg);
  learningTools(reg);
  salesTools(reg);
  return reg;
}

export { ToolRegistry };
