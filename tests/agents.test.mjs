// Agent reyestri, EventBus, Manager hesabatı və commerce interfeysləri. Şəbəkə YOXDUR.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createStore, _resetMemoryForTests } from "../src/state/store.js";
import { createAudit } from "../src/audit/log.js";
import { ApprovalCenter } from "../src/approval/center.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { MemoryCoordinator } from "../src/coord/coordinator.js";
import { DEFAULT_PERMISSIONS } from "../src/policy.js";
import { AppError } from "../src/errors.js";
import { registerLeadTools, LEAD_PERMISSIONS } from "../src/leads/index.js";
import { registerMarketingTools, MARKETING_PERMISSIONS } from "../src/marketing/index.js";
import { createAgentRegistry, registerAgentTools, AGENT_PERMISSIONS, createEventBus, buildManagerReport, createApprovalProvider, createJobProvider, AGENT_DEFINITIONS, HUMAN_APPROVAL_ONLY } from "../src/agents/index.js";
import { NotConfiguredSupplier, NotConfiguredPayment, NotConfiguredFulfillment, createNotConfiguredProviders, missingMethods, PROVIDER_CONTRACTS } from "../src/commerce/interfaces.js";

const realFetch = globalThis.fetch;
let netCalls = 0;
beforeEach(() => {
  _resetMemoryForTests();
  netCalls = 0;
  globalThis.fetch = async () => {
    netCalls++;
    throw new Error("TEST: şəbəkə çağırışı olmamalıdır");
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const PERMS = [...DEFAULT_PERMISSIONS, ...LEAD_PERMISSIONS, ...MARKETING_PERMISSIONS, ...AGENT_PERMISSIONS];
const DAY = 86400000;

function setup({ providers } = {}) {
  const clock = { t: Date.UTC(2026, 9, 7, 8, 0, 0) };
  const now = () => clock.t;
  const store = createStore({});
  const audit = createAudit(store, now);
  const coord = new MemoryCoordinator(now);
  const approvals = new ApprovalCenter(store, audit, now, coord);
  const tools = new ToolRegistry({ audit, approvals, sleep: async () => {} });
  const events = createEventBus({ store, now });
  const leads = registerLeadTools(tools, { store, coord, now, events });
  const marketing = registerMarketingTools(tools, { now });
  const agents = createAgentRegistry({ tools, store, events, now, providers: providers === undefined ? { leads: leads.provider, approvals: createApprovalProvider(approvals), jobs: createJobProvider(store) } : providers });
  const agentTools = registerAgentTools(tools, agents);
  const ctx = { permissions: PERMS, approvals };
  return { clock, now, store, audit, coord, approvals, tools, events, leads, marketing, agents, agentTools, ctx };
}

const cand = (n) => ({ business_name: "Kafe " + n, category: "kafe", location: "Bakı", website: "https://kafe" + n + ".az", instagram: "kafe" + n, need: "QR menyu", confidence: 0.8, entity_type: "business", source: { url: "https://example.com/d/" + n, source_type: "public_directory" } });

test("reyestr: 8 rol, yalnız Sales/Marketing/Manager 'implemented', qalanları 'interface_only' və imkansızdır", () => {
  const { agents } = setup();
  const list = agents.list();
  assert.deepEqual(list.map((a) => a.role), ["Sales", "Marketing", "Manager", "Order", "Logistics", "Seller", "CustomerSupport", "FraudQuality"]);
  assert.deepEqual(list.filter((a) => a.status === "implemented").map((a) => a.id), ["sales", "marketing", "manager"]);
  for (const a of list.filter((x) => x.status === "interface_only")) {
    assert.deepEqual(a.capabilities, [], a.id + " imkansızdır");
    assert.ok(a.planned_capabilities.length > 0);
    assert.ok(a.description && a.inputs && a.outputs && Array.isArray(a.requiresApprovalFor));
  }
  for (const a of list) assert.ok(a.id && a.role && a.description && a.status && Array.isArray(a.capabilities) && Array.isArray(a.requiresApprovalFor) && a.inputs && a.outputs, a.id);
  assert.ok(list.find((a) => a.id === "sales").requiresApprovalFor.includes("lead.outreach.prepare"));
});

test("interface_only agent icra olunmur: VALIDATION_ERROR 'Bu agent hələ qoşulmayıb'; naməlum agent NOT_FOUND", async () => {
  const { agents, ctx } = setup();
  for (const id of ["order", "logistics", "seller", "customer_support", "fraud_quality"]) {
    await assert.rejects(() => agents.run(id, { tool: "lead.list", input: {} }, ctx), (e) => e instanceof AppError && e.code === "VALIDATION_ERROR" && e.message === "Bu agent hələ qoşulmayıb", id);
    await assert.rejects(() => agents.run(id, { task: "report" }, ctx), (e) => e.message === "Bu agent hələ qoşulmayıb");
  }
  await assert.rejects(() => agents.run("nope", {}, ctx), (e) => e.code === "NOT_FOUND");
  assert.equal(netCalls, 0);
});

test("capabilities real alətlərlə uyğundur (saxta alət adı yoxdur)", () => {
  const { agents, tools, leads, marketing, agentTools } = setup();
  const registered = new Set(tools.list().map((t) => t.name));
  for (const a of agents.list().filter((x) => x.status === "implemented")) for (const c of a.capabilities) assert.ok(registered.has(c), a.id + " -> " + c);
  assert.deepEqual([...agents.get("sales").capabilities].sort(), [...leads.toolNames].sort());
  assert.deepEqual([...agents.get("marketing").capabilities].sort(), [...marketing.toolNames].sort());
  assert.deepEqual([...agents.get("manager").capabilities].sort(), [...agentTools].sort());
  // requiresApprovalFor-dakı alət adları (nöqtəli) həqiqətən təsdiq tələb edir
  for (const t of agents.get("sales").requiresApprovalFor) assert.equal(tools.list().find((x) => x.name === t).requiresApproval, true);
});

test("Sales agenti lead alətlərini ToolRegistry vasitəsilə işlədir; Marketing alətini və kənar alətləri işlədə bilmir; təsdiq qapısı keçilmir", async () => {
  const { agents, ctx, approvals } = setup();
  const s = await agents.run("sales", { tool: "lead.save", input: { lead: cand(1) } }, ctx);
  assert.equal(s.status, "done");
  assert.equal(s.output.saved, true);
  const l = await agents.run("sales", { tool: "lead.list", input: {} }, ctx);
  assert.equal(l.output.items.length, 1);
  await assert.rejects(() => agents.run("sales", { tool: "marketing.hooks", input: { brand: "qr_menu" } }, ctx), (e) => e.code === "PERMISSION_ERROR");
  await assert.rejects(() => agents.run("sales", { tool: "web.fetch", input: { url: "https://example.com" } }, ctx), (e) => e.code === "PERMISSION_ERROR");
  const p = await agents.run("sales", { tool: "lead.outreach.prepare", input: { lead_id: s.output.id } }, ctx);
  assert.equal(p.status, "pending_approval", "agent təsdiq qapısını keçə bilmir");
  assert.equal((await approvals.get(p.approval_id)).status, "pending");
  const m = await agents.run("marketing", { tool: "marketing.hooks", input: { brand: "qr_menu", count: 3 } }, ctx);
  assert.equal(m.status, "done");
  assert.equal(m.output.published, false);
  await assert.rejects(() => agents.run("marketing", { tool: "lead.list", input: {} }, ctx), (e) => e.code === "PERMISSION_ERROR");
  await assert.rejects(() => agents.run("manager", { task: "wat" }, ctx), (e) => e.code === "VALIDATION_ERROR");
  await assert.rejects(() => agents.run("sales", { task: "report" }, ctx), (e) => e.code === "VALIDATION_ERROR");
});

test("kritik əməliyyatlar yalnız insan təsdiqi ilə: metadata siyahısı və agent tərəfindən icra bloku", async () => {
  const { agents, ctx } = setup();
  const ids = agents.humanApprovalOnly().map((x) => x.id);
  for (const id of ["finance.payment", "finance.refund", "account.change", "price.change", "stock.change", "message.send", "publish.social"]) assert.ok(ids.includes(id), id);
  assert.deepEqual(agents.get("manager").humanApprovalOnly.sort(), ids.sort());
  assert.ok(agents.get("customer_support").humanApprovalOnly.includes("finance.refund"));
  assert.ok(agents.get("fraud_quality").humanApprovalOnly.includes("account.change"));
  assert.equal(agents.isHumanApprovalOnly("finance.refund"), true);
  assert.equal(agents.isHumanApprovalOnly("lead.list"), false);
  await assert.rejects(() => agents.run("manager", { tool: "finance.refund", input: {} }, ctx), (e) => e.code === "SECURITY_ERROR");
  assert.equal(HUMAN_APPROVAL_ONLY.length, ids.length);
  assert.equal(AGENT_DEFINITIONS.length, 8);
});

test("EventBus: append-only, sıralı, növ süzgəci, abunəçilər proses daxilində; abunəçi xətası jurnalı pozmur; gizli sahələr redaktə olunur", async () => {
  const store = createStore({});
  let t = 1_000_000_000_000;
  const bus = createEventBus({ store, now: () => t++ });
  assert.deepEqual(Object.keys(bus).sort(), ["emit", "list", "subscribe"], "dəyişdirmə/silmə metodu yoxdur");
  assert.ok(Object.isFrozen(bus));
  const seen = [];
  const un = bus.subscribe("lead.*", (e) => seen.push(e.type));
  bus.subscribe("*", () => { throw new Error("abunəçi xətası"); });
  const all = [];
  bus.subscribe("job.finished", (e) => all.push(e.data));
  const e1 = await bus.emit("lead.created", { lead_id: "a" });
  await bus.emit("job.finished", { job_id: "j1", status: "done", api_token: "SECRET-VALUE" });
  await bus.emit("shopify.order_seen", { order: 5 });
  await bus.emit("approval.created", { id: "x" });
  un();
  await bus.emit("lead.status_changed", { a: 1 });
  assert.deepEqual(seen, ["lead.created"], "abunəlikdən çıxandan sonra bildiriş yoxdur");
  assert.equal(e1.type, "lead.created");
  assert.equal(all[0].api_token, "[gizlədildi]");
  const listed = await bus.list({ limit: 10 });
  assert.equal(listed.length, 5);
  assert.deepEqual(listed.map((x) => x.type), ["lead.status_changed", "approval.created", "shopify.order_seen", "job.finished", "lead.created"], "ən yenidən köhnəyə");
  assert.equal((await bus.list({ type: "job.finished" })).length, 1);
  assert.equal(JSON.stringify(listed).includes("SECRET-VALUE"), false);
  await assert.rejects(() => bus.emit("Bad Type!", {}), (e) => e.code === "VALIDATION_ERROR");
  assert.throws(() => bus.subscribe("???", () => {}), (e) => e.code === "VALIDATION_ERROR");
  // hadisələr "event" sənədi kimi saxlanır
  assert.equal((await store.listDocs("event", 10)).length, 5);
});

test("Agent icrası hadisə yazır (agent.run); lead hadisələri EventBus-a düşür", async () => {
  const { agents, ctx, events } = setup();
  await agents.run("sales", { tool: "lead.save", input: { lead: cand(2) } }, ctx);
  const types = (await events.list({ limit: 10 })).map((e) => e.type);
  assert.ok(types.includes("lead.created") && types.includes("agent.run"));
});

test("Manager hesabatı: heç bir provider yoxdursa bütün bölmələr 'qoşulmayıb', saxta sıfır və rəqəm yoxdur", async () => {
  const rep = await buildManagerReport({ providers: {}, now: () => 1_800_000_000_000 });
  for (const k of ["leads", "approvals", "jobs", "shopify", "marketing"]) {
    assert.deepEqual(rep.sections[k], { connected: false, label: "qoşulmayıb" }, k);
  }
  assert.deepEqual(rep.not_connected.sort(), ["approvals", "jobs", "leads", "marketing", "shopify"]);
  assert.equal(rep.risks[0].id, "report.no_data");
  assert.equal(rep.risks[0].severity, "high");
  assert.ok(!/"(total|count|pending_count|total_matching)":\s*0/.test(JSON.stringify(rep)), "saxta sıfır yoxdur");
  assert.ok(rep.recommendations.every((r) => r.basis && r.text));
  assert.ok(rep.human_approval_only.some((x) => x.id === "finance.refund"));
});

test("Manager hesabatı: real məlumatdan say, gözləyən təsdiqlər, uğursuz/naməlum işlər, funnel, risklər və qaydalı tövsiyələr", async () => {
  const t = setup();
  // 3 lead: biri scored qalır, biri awaiting_approval (köhnəlir), biri əl ilə əlaqə
  const ids = [];
  for (const n of [11, 12, 13]) ids.push((await t.agents.run("sales", { tool: "lead.save", input: { lead: cand(n) } }, t.ctx)).output.id);
  const p1 = await t.agents.run("sales", { tool: "lead.outreach.prepare", input: { lead_id: ids[0] } }, t.ctx);
  const p2 = await t.agents.run("sales", { tool: "lead.outreach.prepare", input: { lead_id: ids[1] } }, t.ctx);
  assert.equal(p1.status, "pending_approval");
  const { createActionRunner } = await import("../src/actions/runner.js");
  const runner = createActionRunner({ approvals: t.approvals, registry: t.tools, audit: t.audit });
  assert.equal((await runner.approveAndExecute(p2.approval_id, { actor: { channel: "ui" } })).ok, true);
  // təsdiq qeydi: biri icrada naməlum olsun
  const rec = await t.approvals.get(p2.approval_id);
  rec.execution = "unknown";
  await t.store.putDoc("approval", rec.id, rec);
  // sosial işlər
  await t.store.putDoc("socialjob", "9999999999999-aaaaaa", { id: "9999999999999-aaaaaa", status: "failed", updated_at: t.clock.t });
  await t.store.putDoc("socialjob", "9999999999998-bbbbbb", { id: "9999999999998-bbbbbb", status: "unknown", updated_at: t.clock.t });
  await t.store.putDoc("socialjob", "9999999999997-cccccc", { id: "9999999999997-cccccc", status: "done", updated_at: t.clock.t });
  t.clock.t += 4 * DAY;

  const r = await t.agents.run("manager", { task: "report" }, t.ctx);
  assert.equal(r.status, "done");
  const rep = r.output;
  const S = rep.sections;
  assert.equal(S.leads.total, 3);
  assert.equal(S.leads.by_status.scored, 1);
  assert.equal(S.leads.by_status.awaiting_approval, 1);
  assert.equal(S.leads.by_status.contacted_manually, 1);
  assert.equal(S.leads.stale_awaiting_approval, 1);
  assert.equal(S.leads.reply_rate_pct, 0, "əlaqə qurulan var, cavab yox: 0% real hesablamadır");
  assert.equal(S.leads.funnel.find((f) => f.stage === "contacted_manually").count, 1);
  assert.equal(S.approvals.pending_count, 1);
  assert.equal(S.approvals.pending[0].id, p1.approval_id);
  assert.equal(S.approvals.execution_unknown, 1);
  assert.equal(S.jobs.by_status.done, 1);
  assert.equal(S.jobs.failed.length, 1);
  assert.equal(S.jobs.unknown.length, 1);
  assert.deepEqual(S.shopify, { connected: false, label: "qoşulmayıb" });
  assert.deepEqual(S.marketing, { connected: false, label: "qoşulmayıb" });
  const riskIds = rep.risks.map((x) => x.id);
  for (const id of ["approvals.execution_unknown", "jobs.unknown", "jobs.failed", "leads.stale_awaiting", "approvals.old_pending"]) assert.ok(riskIds.includes(id), id + " <- " + riskIds);
  assert.equal(rep.risks[0].severity, "high");
  const recIds = rep.recommendations.map((x) => x.id);
  for (const id of ["approvals.review_pending", "jobs.inspect", "leads.prepare_outreach", "leads.resolve_awaiting", "source.not_connected.shopify"]) assert.ok(recIds.includes(id), id + " <- " + recIds);
  assert.ok(rep.recommendations.every((x) => x.basis));
  assert.deepEqual(rep.not_connected.sort(), ["marketing", "shopify"]);
  // vaxtı bitmək üzrə olan təsdiq: yüksək risk
  const nowT = 1_800_000_000_000;
  const soon = await buildManagerReport({ providers: { approvals: { list: async () => [{ id: "a1", status: "pending", action: "x", risk: "high", ts: new Date(nowT - 6 * DAY).toISOString(), expires_at: new Date(nowT + 2 * 3600000).toISOString() }] } }, now: () => nowT });
  assert.equal(soon.sections.approvals.pending_expiring, 1);
  assert.ok(soon.risks.some((x) => x.id === "approvals.expiring" && x.severity === "high"));
  // əlaqə qurulan olmadıqda dərəcə hesablanmır (null), sıfır deyil
  const empty = await buildManagerReport({ providers: { leads: { list: async () => [{ id: "a", status: "new" }] } }, now: () => 1 });
  assert.equal(empty.sections.leads.reply_rate_pct, null);
  assert.match(empty.sections.leads.reply_rate_note, /hesablanmır/);
  assert.equal(netCalls, 0);
});

test("Manager hesabatı: provider xəta verərsə bölmə 'error' olur, rəqəm uydurulmur; kəsilmiş nümunə qeyd edilir", async () => {
  const boom = { list: async () => { throw new Error("daxili sirr: stack at db.js:3"); } };
  const many = { list: async () => Array.from({ length: 40 }, (_, i) => ({ id: "j" + i, status: "done", updated_at: 1 })) };
  const rep = await buildManagerReport({ providers: { leads: boom, jobs: many }, now: () => 5 });
  assert.equal(rep.sections.leads.status, "error");
  assert.equal(rep.sections.leads.total, undefined);
  assert.ok(!JSON.stringify(rep.sections.leads).includes("db.js"), "daxili xəta mətni çıxmır");
  assert.ok(rep.risks.some((x) => x.id === "source.error.leads"));
  assert.equal(rep.sections.jobs.truncated, true);
  assert.deepEqual(rep.not_connected.sort(), ["approvals", "marketing", "shopify"]);
});

test("agents.list və manager.report alətləri: low risk, təsdiqsiz, icazə tələb edir", async () => {
  const t = setup();
  const list = Object.fromEntries(t.tools.list().map((x) => [x.name, x]));
  for (const n of ["agents.list", "manager.report"]) {
    assert.equal(list[n].risk, "low");
    assert.equal(list[n].requiresApproval, false);
  }
  const a = await t.tools.run("agents.list", {}, t.ctx);
  assert.equal(a.status, "done");
  assert.equal(a.output.agents.length, 8);
  const m = await t.tools.run("manager.report", {}, t.ctx);
  assert.equal(m.status, "done");
  assert.equal(m.output.sections.leads.connected, true);
  assert.equal(m.output.sections.leads.total, 0, "provider qoşulub və lead yoxdur: bu real sıfırdır");
  assert.deepEqual(m.output.sections.shopify, { connected: false, label: "qoşulmayıb" });
});

test("commerce: NotConfigured provayderlər hər çağırışda VALIDATION_ERROR atır, saxta nəticə vermir", async () => {
  const p = createNotConfiguredProviders();
  assert.ok(p.supplier instanceof NotConfiguredSupplier && p.payment instanceof NotConfiguredPayment && p.fulfillment instanceof NotConfiguredFulfillment);
  for (const [prov, name] of [[p.supplier, "SupplierProvider"], [p.payment, "PaymentProvider"], [p.fulfillment, "FulfillmentProvider"]]) {
    assert.equal(prov.configured, false);
    assert.deepEqual(missingMethods(prov, name), []);
    for (const m of [...PROVIDER_CONTRACTS[name].read, ...PROVIDER_CONTRACTS[name].human_approval_only]) {
      await assert.rejects(() => prov[m]({}), (e) => e instanceof AppError && e.code === "VALIDATION_ERROR" && /qoşulmayıb/.test(e.message), name + "." + m);
    }
  }
  assert.deepEqual(missingMethods({}, "PaymentProvider").sort(), ["createPaymentRequest", "getPaymentStatus", "refund"]);
  assert.ok(PROVIDER_CONTRACTS.PaymentProvider.human_approval_only.includes("refund"));
  assert.ok(PROVIDER_CONTRACTS.SupplierProvider.human_approval_only.includes("placeOrder"));
  assert.equal(netCalls, 0);
});

test("Manager: Shopify provider qoşulubsa say göstərir (alıcı məlumatı yoxdur), token yoxdursa «qoşulmayıb» sayılır", async () => {
  const { createShopifyProvider } = await import("../src/agents/providers.js");
  const { buildManagerReport } = await import("../src/agents/manager.js");
  const { AppError } = await import("../src/errors.js");
  const client = { query: async () => ({ orders: { nodes: [{ id: "gid://shopify/Order/1", createdAt: "2026-10-01T00:00:00Z", displayFinancialStatus: "PAID", shippingAddress: { firstName: "GİZLİ", city: "Bakı" } }, { id: "gid://shopify/Order/2", createdAt: "2026-10-02T00:00:00Z", displayFinancialStatus: "PENDING" }] } }) };
  const ok = await buildManagerReport({ providers: { shopify: createShopifyProvider(client, "Q") } });
  assert.equal(ok.sections.shopify.connected, true);
  assert.deepEqual(ok.sections.shopify.by_status, { paid: 1, pending: 1 });
  assert.ok(!JSON.stringify(ok).includes("GİZLİ"));
  const down = { query: async () => { throw new AppError("AUTH_ERROR", "Shopify qoşulmayıb", { source: "shopify" }); } };
  const no = await buildManagerReport({ providers: { shopify: createShopifyProvider(down, "Q") } });
  assert.equal(no.sections.shopify.connected, false);
  assert.ok(no.not_connected.includes("shopify"));
});
