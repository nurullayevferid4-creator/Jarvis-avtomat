// LearningAgent və SalesAgent skeletləri: interfeys, validasiya, təhlükəsizlik sərhədləri, xəta idarəsi. Model və şəbəkə yoxdur.
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStorage } from "../src/storage/MemoryStorage.js";
import { LearningAgent, ALLOWED_TARGETS, FORBIDDEN_TARGETS } from "../src/agents/LearningAgent.js";
import { SalesAgent, LeadStore, MAX_FOLLOWUPS } from "../src/agents/SalesAgent.js";
import { scrub, MASK, AgentError } from "../src/agents/common.js";
import { createFoundation } from "../src/foundation/index.js";

const FIXED = new Date("2026-10-05T12:00:00Z");
const fixedNow = () => FIXED;
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
const learning = (opts = {}) => {
  const storage = new MemoryStorage();
  return { storage, agent: new LearningAgent({ storage: storage.scope("learning"), now: fixedNow, ...opts }) };
};

test("scrub: açar/token/parol formaları gizlədilir, görünməz simvollar silinir, uzunluq kəsilir", () => {
  const raw = "sk" + "-abcdefghijklmnop1234 Bearer abcdefghijklmnop1234 123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKK token: xyz password=hunter2 ok\u200B";
  const out = scrub(raw, 500);
  assert.ok(!/sk-abc|Bearer abc|AAAbbb|hunter2|xyz/.test(out));
  assert.ok(out.includes(MASK));
  assert.ok(out.endsWith("ok"));
  assert.equal(scrub("x".repeat(1000), 100).length, 100);
  assert.equal(scrub(undefined, 10), "");
});

test("LearningAgent: storage olmadan yaradılmır; nəticə qeydi saxlanır, məxfi mətn gizlədilir", async () => {
  assert.throws(() => new LearningAgent({}), /storage/);
  const { agent, storage } = learning();
  const { id } = await agent.recordOutcome({ task: "Instagram təhlili", status: "blocked", summary: "token: abc123SECRET xətası", reason: "Token yoxdur" });
  const rec = (await agent.listOutcomes())[0];
  assert.equal(rec.id, id);
  assert.equal(rec.status, "blocked");
  assert.ok(!JSON.stringify(rec).includes("abc123SECRET"));
  assert.equal(rec.ts, FIXED.toISOString());
  assert.deepEqual((await storage.list("learning")).keys, ["outcome-" + id]);
});

test("LearningAgent: yanlış nəticə girişi rədd edilir", async () => {
  const { agent } = learning();
  for (const bad of [{}, { task: "x" }, { task: "x", status: "uğur" }, { task: "", status: "achieved" }, { task: "x", status: "achieved", extra: 1 }, null]) {
    const e = await err(agent.recordOutcome(bad));
    assert.ok(e instanceof AgentError && e.code === "invalid_input", JSON.stringify(bad));
  }
  assert.deepEqual(await agent.listOutcomes(), []);
});

test("LearningAgent.analyze: say, uğur nisbəti, təkrarlanan səbəblər (saf hesablama)", () => {
  const { agent } = learning();
  const outs = [
    { status: "achieved" }, { status: "achieved" },
    { status: "blocked", reason: "Token yoxdur" }, { status: "blocked", reason: "token yoxdur" }, { status: "failed", reason: "Vaxt aşıldı" },
    { status: "draft_only" }, { status: "naməlum" }, null,
  ];
  const a = agent.analyze(outs);
  assert.equal(a.total, 8);
  assert.equal(a.byStatus.achieved, 2);
  assert.equal(a.byStatus.blocked, 2);
  assert.equal(a.successRate, 0.25);
  assert.deepEqual(a.topFailures[0], { reason: "token yoxdur", count: 2 });
  const empty = agent.analyze([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.successRate, 0);
  assert.deepEqual(empty.topFailures, []);
  assert.deepEqual(agent.analyze(undefined).topFailures, []);
});

test("LearningAgent: təkliflər yalnız təkrarlanan (>=2) səbəbdən yaranır və 'proposed' qalır", async () => {
  const { agent } = learning();
  const props = agent.proposeImprovements({ topFailures: [{ reason: "token yoxdur", count: 2 }, { reason: "bir dəfə", count: 1 }] });
  assert.equal(props.length, 1);
  assert.equal(props[0].target, "checklist");
  const { id } = await agent.saveProposal(props[0]);
  assert.equal((await agent.getProposal(id)).status, "proposed");
  assert.deepEqual(await agent.getApprovedRules(), []);
});

test("LearningAgent: system prompt, secret, icazə, təsdiq siyasəti və təhlükəsizlik hədəfləri HEÇ VAXT qəbul olunmur", async () => {
  const { agent } = learning();
  for (const t of [...FORBIDDEN_TARGETS, "System_Prompt", "SECRET", "permissions", "naməlum", "code", ""]) {
    const e = await err(agent.saveProposal({ title: "Dəyiş", target: t, text: "mətn mətn" }));
    assert.ok(e && ["forbidden_target", "invalid_input"].includes(e.code), "hədəf: " + t);
  }
  for (const t of ALLOWED_TARGETS) assert.ok((await agent.saveProposal({ title: "Qayda", target: t, text: "mətn mətn" })).id);
});

test("LearningAgent: təsdiq yoxlaması qoşulmayıbsa (standart) qayda təsdiqlənmir; yalnız tam `true` keçir", async () => {
  const mk = async (check) => {
    const { agent, storage } = learning(check === undefined ? {} : { approvalCheck: check });
    const { id } = await agent.saveProposal({ title: "Qayda", target: "workflow_note", text: "mətn mətn" });
    return { agent, storage, id };
  };
  for (const check of [undefined, async () => false, async () => "yes", async () => 1, async () => ({ approved: true }), async () => { throw new Error("xəta"); }]) {
    const { agent, id } = await mk(check);
    const e = await err(agent.approveProposal(id, { approvalId: "ap-1" }));
    assert.equal(e && e.code, "approval_required");
    assert.deepEqual(await agent.getApprovedRules(), []);
    assert.equal((await agent.getProposal(id)).status, "proposed");
  }
  let asked = null;
  const { agent, id } = await mk(async (aid, p) => { asked = { aid, target: p.target }; return true; });
  assert.deepEqual(await agent.approveProposal(id, { approvalId: "ap-9" }), { id, status: "approved" });
  assert.deepEqual(asked, { aid: "ap-9", target: "workflow_note" });
  const rules = await agent.getApprovedRules();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].approval_id, "ap-9");
  assert.equal((await agent.getProposal(id)).status, "approved");
  assert.equal((await err(agent.approveProposal(id, { approvalId: "ap-9" }))).code, "invalid_state");
});

test("LearningAgent: saxlanmış təklif sonradan qadağan hədəfə dəyişdirilsə belə təsdiqlənmir; rədd və tapılmadı halları", async () => {
  const { agent, storage } = learning({ approvalCheck: async () => true });
  const { id } = await agent.saveProposal({ title: "Qayda", target: "tool_hint", text: "mətn mətn" });
  const p = await agent.getProposal(id);
  await storage.scope("learning").put("proposal-" + id, { ...p, target: "system_prompt" });
  assert.equal((await err(agent.approveProposal(id, { approvalId: "a" }))).code, "forbidden_target");
  assert.deepEqual(await agent.getApprovedRules(), []);
  assert.equal((await err(agent.approveProposal("yoxdur-id", { approvalId: "a" }))).code, "not_found");
  const { id: id2 } = await agent.saveProposal({ title: "Qayda 2", target: "checklist", text: "mətn mətn" });
  assert.deepEqual(await agent.rejectProposal(id2), { id: id2, status: "rejected" });
  assert.equal((await err(agent.approveProposal(id2, { approvalId: "a" }))).code, "invalid_state");
});

test("LearningAgent səthi: prompt/icazə/secret dəyişən və qaydanı özü tətbiq edən metod yoxdur", () => {
  const names = Object.getOwnPropertyNames(LearningAgent.prototype);
  assert.ok(!names.some((n) => /apply|prompt|permission|secret|execute|deploy|enable/i.test(n)), names.join(","));
});

// ---- SalesAgent ----
const hotLead = { name: "Aynur", channel: "telegram", interests: ["ətir", "hədiyyə"], budget_azn: 120, last_interaction_days: 2, consent: "given" };

test("SalesAgent.qualifyLead: sabit qaydalar, 0-100, deterministik", () => {
  const s = new SalesAgent({ now: fixedNow });
  const r = s.qualifyLead(hotLead, { catalogKeywords: ["ətir", "hədiyyə"] });
  assert.deepEqual(r, s.qualifyLead(hotLead, { catalogKeywords: ["ətir", "hədiyyə"] }));
  assert.equal(r.tier, "hot");
  assert.equal(r.score, 100);
  assert.equal(r.draft_only, true);
  const cold = s.qualifyLead({ channel: "other" });
  assert.equal(cold.tier, "cold");
  assert.equal(cold.score, 0);
  const warm = s.qualifyLead({ channel: "instagram", last_interaction_days: 20, budget_azn: 60 });
  assert.equal(warm.score, 35);
  assert.equal(warm.tier, "warm");
});

test("SalesAgent: razılıq verməyən lead üçün heç bir əlaqə planı qurulmur", () => {
  const s = new SalesAgent({ now: fixedNow });
  const denied = { ...hotLead, consent: "denied" };
  assert.deepEqual(s.qualifyLead(denied), { score: 0, tier: "do_not_contact", reasons: ["lead əlaqəyə razılıq verməyib"], draft_only: true });
  assert.equal(s.planConversation(denied).blocked_reason, "consent_denied");
  assert.equal(s.generateOffer(denied, { products: [{ name: "Ətir" }] }).blocked_reason, "consent_denied");
  assert.equal(s.planFollowUp(denied).blocked_reason, "consent_denied");
});

test("SalesAgent: söhbət planı və təklif YALNIZ qaralamadır (draft_only, təsdiq tələb olunur)", () => {
  const s = new SalesAgent({ now: fixedNow });
  const plan = s.planConversation(hotLead);
  assert.equal(plan.draft_only, true);
  assert.equal(plan.steps.length, 3);
  const offer = s.generateOffer(hotLead, { products: [{ name: "Ətir A", price_azn: 59.9 }, { name: "Ətir B" }] });
  assert.equal(offer.draft_only, true);
  assert.equal(offer.requires_approval, true);
  assert.match(offer.text, /Aynur/);
  assert.match(offer.text, /Ətir A — 59.9 AZN/);
  assert.equal(s.generateOffer(hotLead, { products: [] }).blocked_reason, "no_products");
  const e = (() => { try { s.generateOffer(hotLead, { products: [{ price_azn: 1 }] }); } catch (x) { return x; } })();
  assert.equal(e.code, "invalid_input");
});

test("SalesAgent.planFollowUp: aralıqlar 2/5/10 gün, limit 3, bağlı mərhələ bloklanır, vaxt göndərmə deyil təklifdir", () => {
  const s = new SalesAgent({ now: fixedNow });
  const day = 24 * 3600 * 1000;
  for (const [done, gap] of [[0, 2], [1, 5], [2, 10]]) {
    const r = s.planFollowUp({ channel: "telegram", followups_done: done });
    assert.equal(r.suggested_at, new Date(FIXED.getTime() + gap * day).toISOString());
    assert.equal(r.window_days, gap);
    assert.equal(r.draft_only, true);
    assert.equal(r.requires_approval, true);
  }
  assert.equal(s.planFollowUp({ channel: "telegram", followups_done: MAX_FOLLOWUPS }).blocked_reason, "followup_limit");
  assert.equal(s.planFollowUp({ channel: "telegram", stage: "won" }).blocked_reason, "stage_closed");
  assert.equal(s.planFollowUp({ channel: "telegram", stage: "lost" }).blocked_reason, "stage_closed");
  assert.equal(s.planFollowUp({ channel: "telegram" }, { now: new Date("2027-01-01T00:00:00Z") }).suggested_at, "2027-01-03T00:00:00.000Z");
});

test("SalesAgent: göndərmə mümkün deyil (send həmişə disabled), kütləvi/DM/paylaşım metodu yoxdur, inteqrasiyalara istinad yoxdur", async () => {
  const s = new SalesAgent({ now: fixedNow });
  for (const args of [[], [{ channel: "instagram", text: "salam" }], [{ approval_id: "ap-1" }]]) assert.equal((await err(s.send(...args))).code, "disabled");
  const names = [...Object.getOwnPropertyNames(SalesAgent.prototype), ...Object.getOwnPropertyNames(LeadStore.prototype)];
  assert.ok(!names.some((n) => /broadcast|bulk|mass|blast|spam|dm|publish|post/i.test(n)), names.join(","));
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/agents/SalesAgent.js", "utf8").split("\n").filter((l) => /^\s*import /.test(l)).join("\n");
  assert.ok(!/integrations|adapters|fetch|http/i.test(src), "SalesAgent heç bir inteqrasiya/şəbəkə modulunu import etmir");
});

test("Lead validasiyası: yanlış kanal, artıq sahə, uzun mətn, mənfi büdcə rədd edilir; məxfi mətn gizlədilir", async () => {
  const s = new SalesAgent({ now: fixedNow });
  for (const bad of [{}, { channel: "whatsapp" }, { channel: "other", phone: "+994..." }, { channel: "other", notes: "x".repeat(501) }, { channel: "other", budget_azn: -1 }, { channel: "other", budget_azn: 1.5 }, { channel: "other", consent: "hə" }, { channel: "other", interests: Array(11).fill("a") }]) {
    assert.throws(() => s.qualifyLead(bad), (e) => e.code === "invalid_input", JSON.stringify(bad));
  }
  const store = new LeadStore(new MemoryStorage().scope("leads"), fixedNow);
  const { id } = await store.create({ channel: "telegram", notes: "password=hunter2 yazdı", name: "Bəy" });
  const rec = await store.get(id);
  assert.ok(!JSON.stringify(rec).includes("hunter2"));
  assert.equal(rec.stage, "new");
  assert.equal(rec.consent, "unknown");
});

test("LeadStore: yaratma/oxuma/siyahı; yanlış lead saxlanmır; storage olmadan yaradılmır", async () => {
  assert.throws(() => new LeadStore(null), /storage/);
  const storage = new MemoryStorage();
  const store = new LeadStore(storage.scope("leads"), fixedNow);
  const a = await store.create({ channel: "instagram", handle: "a_user" });
  const b = await store.create({ channel: "telegram" });
  assert.notEqual(a.id, b.id);
  assert.equal((await store.list()).length, 2);
  assert.equal(await store.get("yoxdur-id"), null);
  const e = await err(store.create({ channel: "nə" }));
  assert.equal(e.code, "invalid_input");
  assert.equal((await store.list()).length, 2);
  assert.deepEqual((await storage.list("memory")).keys, [], "leads yalnız öz bölməsinə yazır");
});

test("foundation yığımı: mövcud sistemə qoşulmayıb (wired:false), status dəyər göstərmir, mock yalnız seçimlə", async () => {
  const f = createFoundation({ IG_FNPARFUM_TOKEN: "TESTTOKEN-SECRET-VALUE-1" }, { isolated: true, now: fixedNow });
  const st = f.status();
  assert.equal(st.phase, "foundation");
  assert.equal(st.wired, false);
  assert.equal(st.storage.persistent, false);
  assert.ok(!JSON.stringify(st).includes("TESTTOKEN"));
  assert.equal(st.integrations.find((i) => i.id === "instagram").configured, true);
  assert.equal(st.integrations.find((i) => i.id === "instagram").liveReady, true, "credential + sənədlə yoxlanmış endpoint; canlı sınaq ayrıca");
  assert.ok(f.agents.learning instanceof LearningAgent && f.agents.sales instanceof SalesAgent);
  const { id } = await f.leads.create({ channel: "other" });
  assert.ok(await f.leads.get(id));
  assert.equal((await createFoundation({}, { isolated: true, mock: true }).integrations.run("shopify", "shop.get", {})).mock, true);
});
