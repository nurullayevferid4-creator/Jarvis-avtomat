// Gələcəkdə yeni AI (məs. Kimi) əlavə etməyin asan olduğunu sübut edən test.
// FakeKimi yalnız yeni bir adapter faylı + reyestrə bir sətir kimidir;
// orkestratorun kodunda HEÇ NƏ dəyişmir. Kimi sistemə əlavə EDİLMƏYİB.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BaseAdapter } from "../src/adapters/BaseAdapter.js";
import { createRegistry } from "../src/adapters/registry.js";
import { ClaudeOrchestrator } from "../src/orchestrator/ClaudeOrchestrator.js";
import { createStore, _resetMemoryForTests } from "../src/state/store.js";
import { getLimits } from "../src/config.js";
import { buildLeadSystem } from "../src/prompts.js";
import { installFetch, standardHandler, baseEnv } from "./helpers.mjs";

beforeEach(() => _resetMemoryForTests());

class FakeKimi extends BaseAdapter {
  constructor() {
    super({ id: "kimi", description: "helper: test model" });
    this.ran = [];
  }
  async run(task) {
    this.ran.push(task.instruction);
    return { text: "kimi nəticəsi", web: null };
  }
}

test("reyestrdə Claude lider, OpenAI köməkçidir, Kimi yoxdur", () => {
  const reg = createRegistry(baseEnv());
  assert.ok(reg.has("claude"));
  assert.ok(reg.has("gpt"));
  assert.equal(reg.has("kimi"), false);
  assert.deepEqual(reg.helpers().map((h) => h.id), ["gpt"]);
});

test("yeni adapter yalnız reyestrə əlavə olunur, orkestrator dəyişmədən işləyir", async () => {
  const kimi = new FakeKimi();
  const env = baseEnv();
  const calls = installFetch(standardHandler({ plan: { mode: "task", subtasks: [{ id: "t1", owner: "kimi", instruction: "Kimi işi", depends: [] }], external_action: null } }));
  const orch = new ClaudeOrchestrator({ env, registry: createRegistry(env, [kimi]), limits: getLimits(env), store: createStore(env) });
  const d = await orch.handle("Kimi-yə iş ver");
  assert.deepEqual(kimi.ran, ["Kimi işi"]);
  assert.equal(d.tasks[0].owner, "kimi");
  assert.equal(d.tasks[0].status, "done");
  assert.equal(calls.filter((c) => c.url.endsWith("/v1/responses")).length, 0, "OpenAI çağırılmamalıdır");
});

test("yeni adapter lider modelin təlimatında avtomatik görünür", () => {
  const reg = createRegistry(baseEnv(), [new FakeKimi()]);
  const sys = buildLeadSystem(reg.helpers(), getLimits({}));
  assert.ok(sys.startsWith("You are JARVIS, personal"));
  assert.ok(sys.includes('"kimi"'));
  assert.ok(sys.includes('"gpt"'));
  assert.ok(sys.includes('"claude"|"gpt"|"kimi"'));
});

test("köməkçi olmasa lider təlimat canlı məlumatı uydurmamağı deyir", () => {
  const sys = buildLeadSystem([], getLimits({}));
  assert.ok(sys.includes("No helper has live web search"));
});

test("BaseAdapter.run() yazılmayıbsa aydın xəta verir", async () => {
  await assert.rejects(() => new BaseAdapter({ id: "x" }).run(), /run\(\) yazılmayıb/);
});

test("reyestrdə claude yoxdursa orkestrator başlamır", () => {
  const reg = createRegistry(baseEnv());
  reg.map.delete("claude");
  assert.throws(() => new ClaudeOrchestrator({ env: baseEnv(), registry: reg, limits: getLimits({}), store: createStore({}) }), /claude/);
});
