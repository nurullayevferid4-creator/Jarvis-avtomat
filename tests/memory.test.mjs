// Yaddaş: məxfi məlumat saxlanmır (A) və son işin bölgüsü lider modelə verilir (B). Heç bir real API çağırılmır.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFetch, standardHandler, anthropicCalls, baseEnv, talk, claudeText, worker } from "./helpers.mjs";
import { createStore, _resetMemoryForTests } from "../src/state/store.js";
import { _resetLoginMemoryForTests } from "../src/guards/login.js";
import { KnowledgeBase } from "../src/knowledge/KnowledgeBase.js";
import { MASK } from "../src/security/redact.js";
import { lastJobBlock } from "../src/prompts.js";
import { ClaudeOrchestrator } from "../src/orchestrator/ClaudeOrchestrator.js";

// Test açarları işləmə vaxtı birləşdirilir (tests/secrets.test.mjs repo-da açara oxşar mətni qadağan edir).
const ANT = "sk" + "-ant-" + "Ab12Cd34Ef".repeat(4);
const META = "EA" + "A" + "B".repeat(40);
const MAIL = "musteri@example.com";

beforeEach(() => {
  _resetMemoryForTests();
  _resetLoginMemoryForTests();
});

const task = (id, owner, instruction, depends = []) => ({ id, owner, instruction, depends });
const leadCalls = (calls) => anthropicCalls(calls).filter((c) => c.body.system.startsWith("You are JARVIS, personal"));

// Hər sorğuda plan dəyişə bilsin deyə dəyişən plan
function mutableHandler(initialPlan, finalScreen = "Tam nəticə.") {
  const cur = { plan: initialPlan };
  const handler = (u, body) => {
    if (u.includes("api.anthropic.com") && body.system.startsWith("You are JARVIS speaking")) {
      return claudeText(JSON.stringify({ spoken: "Hazırdır.", screen: finalScreen }));
    }
    return standardHandler({ plan: cur.plan })(u, body);
  };
  return { cur, handler };
}

const jobs = async (env) => (await (await worker.fetch(new Request("https://x.dev/api/jobs", { headers: { "x-passcode": "pw" } }), env)).json()).jobs;

// ---- A: maskalama ----

test("A: bilik bazası token, parol və e-poçtu maskalayıb saxlayır, sayı yazır", async () => {
  const kb = new KnowledgeBase(createStore({}));
  const r = await kb.add({ type: "lesson", title: "Qeyd " + MAIL, text: "parol: Salam12345 və açar " + ANT, source_url: "https://x.dev/cb?access_token=" + META });
  const rec = await kb.get(r.id);
  const all = JSON.stringify(rec);
  for (const secret of [MAIL, "Salam12345", ANT, META]) assert.ok(!all.includes(secret), "saxlanıb: " + secret.slice(0, 8));
  assert.ok(rec.text.includes(MASK) && rec.title.includes(MASK));
  assert.ok(rec.redacted >= 4, "sayı: " + rec.redacted);
  assert.deepEqual(await kb.search(ANT), [], "token axtarışla tapılmır");
});

test("A: bilik bazasında adi mətn dəyişmir, redacted 0", async () => {
  const kb = new KnowledgeBase(createStore({}));
  const r = await kb.add({ type: "fact", title: "Oud qiyməti", text: "50 ml Oud 120 AZN, telefon +994 50 123 45 67" });
  const rec = await kb.get(r.id);
  assert.equal(rec.text, "50 ml Oud 120 AZN, telefon +994 50 123 45 67");
  assert.equal(rec.redacted, 0);
});

test("A: söhbət tarixçəsi, iş qeydi və son iş maskalanır, amma cari sorğuda model istifadəçinin öz mətnini alır", async () => {
  const { handler } = mutableHandler({ mode: "task", subtasks: [task("t1", "claude", "Yoxla " + ANT)], external_action: null });
  const calls = installFetch(handler);
  const env = baseEnv();
  const text = "Mənim parol: Salam12345 və e-poçt " + MAIL + " istifadə et";
  await talk(env, text);

  assert.ok(leadCalls(calls)[0].body.messages.at(-1).content === text, "cari sorğuda model real mətni görməlidir");

  const state = await createStore(env).load();
  const stored = JSON.stringify({ history: state.history, lastJob: state.lastJob, jobs: await jobs(env) });
  for (const secret of ["Salam12345", MAIL, ANT]) assert.ok(!stored.includes(secret), "yaddaşa düşüb: " + secret.slice(0, 8));
  assert.ok(stored.includes(MASK));
});

test("A: təsdiq qeydi və təsdiq gözləyən qaralama MASKALANMIR (Fərid nəyi təsdiq edirsə onu görür)", async () => {
  const { handler } = mutableHandler({ mode: "task", subtasks: [task("t1", "claude", "Hazırla")], external_action: "Müştəriyə yazmaq" }, "Müştəri: " + MAIL);
  installFetch(handler);
  const env = baseEnv();
  await talk(env, "Müştəriyə yaz");
  const ap = await (await worker.fetch(new Request("https://x.dev/api/approvals?status=pending", { headers: { "x-passcode": "pw" } }), env)).json();
  assert.ok(ap.approvals[0].content.includes(MAIL), "təsdiq qeydi dəyişməməlidir");
  const yes = await (await talk(env, "Hə")).json();
  assert.ok(yes.screen.includes(MAIL), "'Hə'-dən sonra qaralama olduğu kimi göstərilir");
});

// ---- B: son iş bölgüsü ----

test("B: tapşırıqdan sonra son iş yazılır: sahib, status, qısa təlimat; köməkçinin cavabı yox", async () => {
  const { handler } = mutableHandler({ mode: "task", subtasks: [task("t1", "gpt", "Bazarı araşdır"), task("t2", "claude", "Yekunlaşdır", ["t1"])], external_action: null });
  installFetch(handler);
  const env = baseEnv();
  await talk(env, "5 biznes ideyası araşdır");
  const { lastJob } = await createStore(env).load();
  assert.equal(lastJob.status, "achieved");
  assert.deepEqual(lastJob.tasks.map((t) => [t.id, t.owner, t.status]), [["t1", "gpt", "done"], ["t2", "claude", "done"]]);
  assert.deepEqual(lastJob.tasks[1].depends, ["t1"]);
  assert.ok(!JSON.stringify(lastJob).includes("GPT nəticəsi"), "köməkçinin cavabı yazılmamalıdır");
});

test("B: ilk sorğuda LAST_JOB none, növbəti sorğuda real bölgü, söhbət sorğusu qeydi silmir", async () => {
  const m = mutableHandler({ mode: "task", subtasks: [task("t1", "gpt", "Bazarı araşdır"), task("t2", "claude", "Yekunlaşdır", ["t1"])], external_action: null });
  const calls = installFetch(m.handler);
  const env = baseEnv();
  await talk(env, "5 biznes ideyası araşdır");
  m.cur.plan = { mode: "chat", reply: "Bölgü qeyddə var." };
  await talk(env, "Claude və OpenAI bu tapşırığı necə böldülər?");
  await talk(env, "Sağ ol");

  const lead = leadCalls(calls);
  assert.equal(lead.length, 3);
  assert.ok(lead[0].body.system.includes("LAST_JOB: none"));
  for (const i of [1, 2]) {
    const sys = lead[i].body.system;
    assert.ok(sys.includes("LAST_JOB (record written by the system"), i + "-ci sorğuda qeyd yoxdur");
    assert.ok(sys.includes('"owner":"gpt"') && sys.includes('"owner":"claude"') && sys.includes('"id":"t2"'));
    assert.ok(sys.includes("answer ONLY from LAST_JOB"));
  }
});

test("B: tarixçə mesajlarına yeni sahə düşmür (API yalnız role və content qəbul edir)", async () => {
  const m = mutableHandler({ mode: "task", subtasks: [task("t1", "claude", "İş")], external_action: null });
  const calls = installFetch(m.handler);
  const env = baseEnv();
  await talk(env, "iş");
  m.cur.plan = { mode: "chat", reply: "ok" };
  await talk(env, "necə böldün");
  for (const msg of leadCalls(calls)[1].body.messages) assert.deepEqual(Object.keys(msg).sort(), ["content", "role"]);
});

test("B: son iş qeydinin ölçüsü məhduddur, təlimat 160, sorğu 200 simvola kəsilir", () => {
  const t = [{ id: "t1", owner: "claude", status: "done", depends: [], instruction: "x".repeat(500) }];
  const rec = ClaudeOrchestrator.lastJobRecord("y".repeat(500), "achieved", t);
  assert.equal(rec.request.length, 200);
  assert.equal(rec.tasks[0].instruction.length, 160);
  const huge = lastJobBlock({ big: "z".repeat(10000) });
  assert.ok(huge.length < 3200 && huge.endsWith("..."));
  assert.ok(lastJobBlock(null).includes("none"));
});
