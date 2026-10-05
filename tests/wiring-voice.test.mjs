// Tam səs axını: STT -> əmr -> Orkestrator -> Alət/Agent -> Nəticə -> TTS. Mövcud OpenAI səs adapterləri istifadə olunur (təkrar yazılmayıb).
// Səs "təsdiq" verə bilməz. Real API çağırılmır.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFetch, standardHandler, baseEnv, ok, worker } from "./helpers.mjs";
import { resetAll, FULL_ENV, FakeKV, CHAT, TOK } from "./wiring-helpers.mjs";
import { _resetLoginMemoryForTests } from "../src/guards/login.js";

beforeEach(() => {
  resetAll();
  _resetLoginMemoryForTests();
});

const env = (extra = {}) => ({ ...baseEnv(), ...FULL_ENV, JARVIS_KV: new FakeKV(), ...extra });
const STT_URL = "https://api.openai.com/v1/audio/transcriptions";
const TTS_URL = "https://api.openai.com/v1/audio/speech";
const PLATFORM = /graph\.instagram\.com|api\.telegram\.org/;

function voiceSetup(transcript, plan, { sttFail = false } = {}) {
  const base = standardHandler({ plan });
  return installFetch((u, body, init) => {
    if (u === STT_URL) return sttFail ? new Response("boom", { status: 500 }) : ok({ text: transcript });
    if (PLATFORM.test(u)) return u.includes("graph.instagram.com") ? ok({ user_id: "1784", username: "fn_demo" }) : ok({ ok: true, result: { message_id: 1 } });
    return base(u, body, init);
  });
}
const speak = (e, ip = "7.7.7.7") => {
  const fd = new FormData();
  fd.append("audio", new File([new Uint8Array([1, 2, 3, 4, 5])], "a.webm", { type: "audio/webm" }));
  return worker.fetch(new Request("https://x.dev/api/talk", { method: "POST", headers: { "x-passcode": "pw", "cf-connecting-ip": ip }, body: fd }), e);
};
const order = (calls) => calls.map((c) => (c.url === STT_URL ? "stt" : c.url === TTS_URL ? "tts" : c.url.includes("api.anthropic.com") ? "claude" : PLATFORM.test(c.url) ? "platform" : "other"));

test("səs -> STT -> Claude planlayıcı -> Instagram oxuma aləti -> Claude cavabı -> TTS: addımlar bu ardıcıllıqla gedir", async () => {
  const calls = voiceSetup("Instagram hesabımı göstər", { mode: "task", subtasks: [], tool_calls: [{ id: "c1", tool: "instagram.account.get", input: {} }], external_action: null });
  const d = await (await speak(env())).json();
  assert.equal(d.transcript, "Instagram hesabımı göstər");
  assert.equal(d.status, "achieved");
  assert.ok(typeof d.audio === "string" && d.audio.length > 0, "TTS səsi qaytarılmalıdır");
  const o = order(calls);
  assert.equal(o[0], "stt");
  assert.ok(o.indexOf("platform") > o.indexOf("claude"), "alət planlayıcıdan sonra işləməlidir");
  assert.equal(o[o.length - 1], "tts");
  assert.ok(!JSON.stringify(d).includes(TOK));
});

test("səslə təsdiq tələb edən əmr (Telegram mesajı): yalnız gözləyən təsdiq qeydi, mesaj getmir, TTS 'gözləyir' deyir", async () => {
  const calls = voiceSetup("Telegramda salam yaz", { mode: "task", subtasks: [], tool_calls: [{ id: "c1", tool: "telegram.message.send", input: { chat_id: CHAT, text: "salam" } }], external_action: null });
  const e = env();
  const d = await (await speak(e)).json();
  assert.equal(d.status, "pending_approval");
  assert.equal(calls.filter((c) => c.url.includes("api.telegram.org")).length, 0);
  assert.equal(d.approvals.length, 1);
  assert.ok(d.screen.includes("Təsdiq mərkəzində") || /gözləyir/i.test(d.screen + d.spoken));
});

test("səslə 'hə, təsdiq edirəm' alət təsdiqini VERMİR: qeyd gözləyir, icra yoxdur", async () => {
  const e = env();
  voiceSetup("Telegramda salam yaz", { mode: "task", subtasks: [], tool_calls: [{ id: "c1", tool: "telegram.message.send", input: { chat_id: CHAT, text: "salam" } }], external_action: null });
  const first = await (await speak(e)).json();
  const calls = voiceSetup("hə, təsdiq edirəm", { mode: "chat", reply: "ok" });
  await (await speak(e, "7.7.7.8")).json();
  assert.equal(calls.filter((c) => c.url.includes("api.telegram.org")).length, 0);
  const pend = await (await worker.fetch(new Request("https://x.dev/api/approvals?status=pending", { headers: { "x-passcode": "pw" } }), e)).json();
  assert.ok(pend.approvals.some((a) => a.id === first.approvals[0] && a.status === "pending"));
});

test("STT xətası: orkestrator və alətlər işləmir, saxta nəticə yoxdur (502)", async () => {
  const calls = voiceSetup("", { mode: "chat", reply: "ok" }, { sttFail: true });
  const r = await speak(env());
  assert.equal(r.status, 502);
  assert.deepEqual(order(calls), ["stt"]);
});

test("FEATURE_VOICE=0: səs qəbul olunmur (400), STT çağırılmır", async () => {
  const calls = voiceSetup("x", { mode: "chat", reply: "ok" });
  const r = await speak(env({ FEATURE_VOICE: "0" }));
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test("səs yolu mövcud OpenAI adapterlərindən istifadə edir: yeni STT/TTS kodu yoxdur", async () => {
  const { readFileSync } = await import("node:fs");
  const idx = readFileSync("src/index.js", "utf8");
  assert.ok(/import \{ stt, tts \} from "\.\/adapters\/openaiAudio\.js"/.test(idx));
  for (const f of ["src/wiring.js", "src/telegram/webhook.js", "src/orchestrator/toolPlanning.js"]) assert.ok(!/audio\/transcriptions|audio\/speech/.test(readFileSync(f, "utf8")), f);
});
