// Orkestratorun davranış testləri (saxta API ilə, açarsız).
// Yoxlanılan qaydalar: Claude lider, OpenAI yalnız köməkçi; yoxlamanı Claude edir;
// limitlər; xəta halında saxta uğur yoxdur; təsdiqsiz heç nə icra olunmur.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFetch, standardHandler, modelCalls, anthropicCalls, openaiModelCalls, baseEnv, talk, ok, claudeText } from "./helpers.mjs";
import { _resetMemoryForTests } from "../src/state/store.js";
import { _resetLoginMemoryForTests } from "../src/guards/login.js";

beforeEach(() => {
  _resetMemoryForTests();
  _resetLoginMemoryForTests();
});

const task = (id, owner, extra = {}) => ({ id, owner, instruction: "İş " + id, depends: [], ...extra });

test("sadə söhbət: yalnız Claude cavab verir, OpenAI model çağırılmır", async () => {
  const calls = installFetch(standardHandler({ plan: { mode: "chat", reply: "Salam Fərid." } }));
  const d = await (await talk(baseEnv(), "Salam")).json();
  assert.equal(d.status, "chat");
  assert.equal(d.spoken, "Salam Fərid.");
  assert.equal(openaiModelCalls(calls).length, 0);
  assert.equal(anthropicCalls(calls).length, 1);
});

test("yalnız Claude tapşırığı: OpenAI nə işləyir, nə də yoxlayır", async () => {
  const calls = installFetch(standardHandler({ plan: { mode: "task", subtasks: [task("t1", "claude"), task("t2", "claude")], external_action: null } }));
  const d = await (await talk(baseEnv(), "Mətn yaz")).json();
  assert.equal(d.status, "achieved");
  assert.equal(openaiModelCalls(calls).length, 0, "OpenAI-a heç bir model sorğusu getməməlidir");
});

test("köməkçi (gpt) nəticəsini Claude yoxlayır, OpenAI yox", async () => {
  const calls = installFetch(standardHandler({ plan: { mode: "task", subtasks: [task("t1", "gpt")], external_action: null } }));
  const d = await (await talk(baseEnv(), "Bazarı araşdır")).json();
  assert.equal(d.status, "achieved");
  assert.ok(calls.some((c) => c.url.endsWith("/v1/responses")), "gpt alt tapşırığı işləməlidir");
  assert.ok(anthropicCalls(calls).some((c) => c.body.system.includes("strict fact checker")), "Claude yoxlamalıdır");
  assert.equal(calls.filter((c) => c.url.endsWith("/v1/chat/completions")).length, 0, "OpenAI yoxlama aparmamalıdır");
});

test("Claude yoxlamada problem tapsa köməkçiyə bir daha cəhd etdirir və qeyd yazır", async () => {
  const calls = installFetch(standardHandler({ plan: { mode: "task", subtasks: [task("t1", "gpt")], external_action: null }, reviewIssues: [{ id: "t1", problem: "uydurma rəqəm" }] }));
  const d = await (await talk(baseEnv(), "araşdır")).json();
  assert.equal(calls.filter((c) => c.url.endsWith("/v1/responses")).length, 2, "təkrar cəhd olmalıdır");
  assert.ok(d.tasks[0].note.includes("uydurma rəqəm"));
});

test("yoxlama alınmasa bu açıq bildirilir", async () => {
  installFetch((u, body) => {
    if (u.includes("api.anthropic.com") && body.system.includes("strict fact checker")) return new Response("boom", { status: 500 });
    return standardHandler({ plan: { mode: "task", subtasks: [task("t1", "gpt")], external_action: null } })(u, body);
  });
  const d = await (await talk(baseEnv(), "araşdır")).json();
  assert.ok(d.screen.includes("yoxlanmadı"));
});

test("alt tapşırıq limiti: 7 istənsə yalnız 4 işləyir", async () => {
  installFetch(standardHandler({ plan: { mode: "task", subtasks: [1, 2, 3, 4, 5, 6, 7].map((n) => task("t" + n, "claude")), external_action: null } }));
  const d = await (await talk(baseEnv(), "çox iş")).json();
  assert.equal(d.tasks.length, 4);
});

test("MAX_SUBTASKS dəyişəni ilə limit azaldıla bilir", async () => {
  installFetch(standardHandler({ plan: { mode: "task", subtasks: [1, 2, 3].map((n) => task("t" + n, "claude")), external_action: null } }));
  const d = await (await talk({ ...baseEnv(), MAX_SUBTASKS: "2" }, "çox iş")).json();
  assert.equal(d.tasks.length, 2);
});

test("ümumi çağırış limiti: aşılmır, iş qismən dayanır və bu bildirilir", async () => {
  const calls = installFetch(standardHandler({ plan: { mode: "task", subtasks: [1, 2, 3, 4].map((n) => task("t" + n, "claude")), external_action: null } }));
  const d = await (await talk({ ...baseEnv(), MAX_MODEL_CALLS: "3" }, "çox iş")).json();
  assert.ok(modelCalls(calls).length <= 3, "model çağırışı 3-dən çox oldu: " + modelCalls(calls).length);
  assert.equal(d.status, "partial");
  assert.ok(d.screen.includes("limiti"));
  assert.ok(d.tasks.some((t) => t.status === "error" && /limiti/.test(t.error)));
});

test("asılılıq dövrü sonsuz döngü yaratmır: bloklanan addımlar xəta kimi göstərilir", async () => {
  installFetch(standardHandler({ plan: { mode: "task", subtasks: [task("t1", "claude", { depends: ["t2"] }), task("t2", "claude", { depends: ["t1"] })], external_action: null } }));
  const d = await (await talk(baseEnv(), "dövr")).json();
  assert.equal(d.status, "blocked");
  assert.ok(d.tasks.every((t) => t.status === "error"));
});

test("naməlum owner Claude-a yönləndirilir", async () => {
  installFetch(standardHandler({ plan: { mode: "task", subtasks: [task("t1", "yoxdur-bele-model")], external_action: null } }));
  const d = await (await talk(baseEnv(), "iş")).json();
  assert.equal(d.tasks[0].owner, "claude");
  assert.equal(d.tasks[0].status, "done");
});

test("Claude API işləməsə: saxta uğur yoxdur, status blocked və səbəb göstərilir", async () => {
  installFetch(standardHandler({ plan: { mode: "chat", reply: "x" }, claudeFail: true }));
  const d = await (await talk(baseEnv(), "Salam")).json();
  assert.equal(d.status, "blocked");
  assert.ok(d.spoken.includes("Xəta"));
  assert.ok(d.screen.includes("Claude 500"));
});

test("OpenAI işləməsə: tapşırıq xəta kimi göstərilir, 'achieved' deyilmir", async () => {
  installFetch(standardHandler({ plan: { mode: "task", subtasks: [task("t1", "gpt")], external_action: null }, gptFail: true }));
  const d = await (await talk(baseEnv(), "araşdır")).json();
  assert.equal(d.status, "blocked");
  assert.equal(d.tasks[0].status, "error");
  assert.ok(d.tasks[0].error.includes("OpenAI 500"));
});

test("yekun cavab alınmasa xam nəticələr göstərilir, status düzgün qalır", async () => {
  installFetch((u, body) => {
    if (u.includes("api.anthropic.com") && body.system.startsWith("You are JARVIS speaking")) return new Response("boom", { status: 500 });
    return standardHandler({ plan: { mode: "task", subtasks: [task("t1", "claude"), task("t2", "gpt")], external_action: null }, gptFail: true })(u, body);
  });
  const d = await (await talk(baseEnv(), "iş")).json();
  assert.equal(d.status, "partial");
  assert.ok(d.screen.includes("XƏTA"));
  assert.ok(!d.spoken.includes("İş hazırdır"), "qismən nəticə 'hazırdır' kimi təqdim olunmamalıdır");
});

test("təsdiq qapısı: real əməliyyat təsdiqsiz də, təsdiqlə də icra olunmur", async () => {
  const calls = installFetch(standardHandler({ plan: { mode: "task", subtasks: [task("t1", "claude")], external_action: "Instagramda paylaşmaq" } }));
  const env = baseEnv();
  const d1 = await (await talk(env, "Paylaş")).json();
  assert.equal(d1.status, "pending_approval");
  const before = calls.length;
  const d2 = await (await talk(env, "Hə")).json();
  assert.equal(d2.status, "blocked");
  assert.ok(d2.spoken.includes("inteqrasiya"));
  const after = calls.slice(before).filter((c) => !c.url.endsWith("/v1/audio/speech"));
  assert.equal(after.length, 0, "'Hə' cavabından sonra heç bir model və ya xarici sorğu getməməlidir");
});

test("təsdiq qapısı: 'yox' gözləyən işi ləğv edir", async () => {
  installFetch(standardHandler({ plan: { mode: "task", subtasks: [task("t1", "claude")], external_action: "Mesaj göndərmək" } }));
  const env = baseEnv();
  await talk(env, "Göndər");
  const d = await (await talk(env, "yox")).json();
  assert.equal(d.status, "chat");
  assert.ok(d.spoken.includes("ləğv"));
});

test("Claude cavabı JSON olmasa xam mətn söhbət kimi qaytarılır", async () => {
  installFetch((u, body) => (u.includes("api.anthropic.com") ? claudeText("sadə mətn cavabı") : standardHandler({ plan: {} })(u, body)));
  const d = await (await talk(baseEnv(), "salam")).json();
  assert.equal(d.status, "chat");
  assert.equal(d.spoken, "sadə mətn cavabı");
});

test("TTS alınmasa cavab itmir, səbəb bildirilir", async () => {
  installFetch((u, body) => (u.endsWith("/v1/audio/speech") ? new Response("no", { status: 500 }) : standardHandler({ plan: { mode: "chat", reply: "Salam" } })(u, body)));
  const d = await (await talk(baseEnv(), "salam")).json();
  assert.equal(d.status, "chat");
  assert.equal(d.audio, null);
  assert.ok(d.tts_error);
});

test("iş tarixçəsi yalnız real tapşırıqdan sonra yazılır", async () => {
  installFetch(standardHandler({ plan: { mode: "task", subtasks: [task("t1", "claude")], external_action: null } }));
  const env = baseEnv();
  await talk(env, "iş");
  const r = await (await import("./helpers.mjs")).worker.fetch(new Request("https://x.dev/api/jobs", { headers: { "x-passcode": "pw" } }), env);
  const j = await r.json();
  assert.equal(j.jobs.length, 1);
  assert.equal(j.jobs[0].status, "achieved");
});

test("OpenAI cavabı ok() köməkçisi ilə sınaq: responses endpointi işlənir", async () => {
  const calls = installFetch((u, body) => (u.endsWith("/v1/responses") ? ok({ output_text: "ok" }) : standardHandler({ plan: { mode: "task", subtasks: [task("t1", "gpt")], external_action: null } })(u, body)));
  await talk(baseEnv(), "araşdır");
  assert.ok(calls.some((c) => c.url.endsWith("/v1/responses")));
});
