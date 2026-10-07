// OpenAI STT autentifikasiyası: açarın təmizlənməsi, 401 səbəbinin təhlükəsiz təsnifi, diaqnostika ucu.
// Açar dəyəri heç bir cavaba/mesaja/jurnala düşməməlidir.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { json, installSocialFetch, bodyJson, world } from "./social-helpers.mjs";
import { stt, openaiAuthReason, silentWav } from "../src/adapters/openaiAudio.js";
import { openaiKey, inspectOpenAIKey } from "../src/security/envvalue.js";

const KEY = "sk-proj-UNITTESTKEYabcdefghijklmnop0123456789";
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]).buffer;
const BODY_401 = JSON.stringify({ error: { message: "Incorrect API key provided: sk-proj-****6789. You can find your API key at https://platform.openai.com/account/api-keys.", type: "invalid_request_error", param: null, code: "invalid_api_key" } });
const BODY_SCOPE = JSON.stringify({ error: { message: "You have insufficient permissions for this operation. Missing scopes: api.model.audio.request. Check that you have the correct role in your organization (Reader, Writer, Owner) and project (Member, Owner), and if you're using a restricted API key, that it has the necessary scopes.", type: "invalid_request_error", code: null } });
const BODY_QUOTA = JSON.stringify({ error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } });
let uid = 70000;
const voice = () => ({ update_id: ++uid, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: "private" }, voice: { file_id: "V", duration: 2, mime_type: "audio/ogg", file_size: OGG.byteLength } } });
const hook = (env, u) => worker.fetch(new Request("https://jarvis.example.dev/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "whsec_test-1" }, body: JSON.stringify(u) }), env);
const tgRoutes = (sttFn) => [
  [/\/getFile/, () => json({ ok: true, result: { file_id: "V", file_size: OGG.byteLength, file_path: "voice/file_1.oga" } })],
  [/\/file\/bot123:TESTTOKEN\/voice\/file_1\.oga/, () => new Response(OGG)],
  [/audio\/transcriptions/, sttFn],
  [/\/sendMessage/, () => json({ ok: true, result: { message_id: 1, chat: {} } })],
];
const replies = (calls) => calls.filter((c) => /sendMessage/.test(c.url)).map((c) => bodyJson(c).text);

test("açar təmizlənir: ətraf boşluq/sətir sonu/dırnaq və 'Bearer ' prefiksi; forma dəyərsiz təsvir olunur", async () => {
  for (const raw of [KEY, " " + KEY + "\n", '"' + KEY + '"', "Bearer " + KEY, "'" + KEY + "'\r\n"]) {
    assert.equal(openaiKey({ OPENAI_API_KEY: raw }), KEY);
    const calls = installSocialFetch([[/audio\/transcriptions/, () => json({ text: "salam" })]]);
    assert.equal(await stt({ OPENAI_API_KEY: raw }, new Blob([OGG], { type: "audio/ogg" }), 5000), "salam");
    assert.equal(calls[0].headers.authorization, "Bearer " + KEY);
    assert.equal(calls[0].url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(calls[0].body.get("model"), "whisper-1");
    assert.equal(calls[0].body.get("language"), "az");
  }
  assert.deepEqual(inspectOpenAIKey({ OPENAI_API_KEY: KEY }), { set: true, shape: "project", cleaned: false, has_inner_space: false });
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: ' "' + KEY + '" ' }).cleaned, true);
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: "sk-admin-xyz" }).shape, "admin");
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: "sk-abc123" }).shape, "legacy");
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: "abc" }).shape, "unexpected");
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: "sk-a b" }).has_inner_space, true);
  assert.equal(inspectOpenAIKey({}).set, false);
  assert.ok(!JSON.stringify(inspectOpenAIKey({ OPENAI_API_KEY: KEY })).includes("UNITTEST"));
});

test("401 səbəbləri təsnif olunur, gövdə (maskalı açar) çıxmır", () => {
  assert.equal(openaiAuthReason(401, BODY_401.slice(0, 200)).reason, "invalid_api_key");
  assert.equal(openaiAuthReason(401, BODY_SCOPE.slice(0, 200)).reason, "missing_scopes");
  assert.equal(openaiAuthReason(429, BODY_QUOTA.slice(0, 200)).reason, "insufficient_quota");
  assert.equal(openaiAuthReason(401, "").reason, "unauthorized");
  assert.equal(openaiAuthReason(500, "x"), null);
});

test("Telegram səsli mesajı: 401 invalid_api_key → aydın səbəb, açar/gövdə mesajda yoxdur", async () => {
  const w = world({ OPENAI_API_KEY: KEY });
  const calls = installSocialFetch(tgRoutes(() => new Response(BODY_401, { status: 401 })));
  await hook(w.env, voice());
  const [t] = replies(calls);
  assert.match(t, /Səs tanıma xətası 401/);
  assert.match(t, /OPENAI_API_KEY etibarsızdır/);
  assert.ok(!/sk-|6789|UNITTEST|platform\.openai/.test(t), t);
  assert.ok(!JSON.stringify(await w.audit.list(10)).includes("UNITTEST"));
});

test("Telegram səsli mesajı: restricted key scope çatışmır və billing bitib → fərqli aydın səbəb", async () => {
  let w = world({ OPENAI_API_KEY: KEY });
  let calls = installSocialFetch(tgRoutes(() => new Response(BODY_SCOPE, { status: 401 })));
  await hook(w.env, voice());
  assert.match(replies(calls)[0], /icazəsi çatmır/);
  w = world({ OPENAI_API_KEY: KEY });
  calls = installSocialFetch(tgRoutes(() => new Response(BODY_QUOTA, { status: 429 })));
  await hook(w.env, voice());
  assert.match(replies(calls)[0], /balansı\/limiti bitib/);
});

test("diaqnostika: parolsuz 401; açar yoxdur; işləyir; 401 — açar dəyəri heç vaxt cavabda deyil", async () => {
  const H = { "x-passcode": "pw" };
  const req = (env, h = H) => worker.fetch(new Request("https://jarvis.example.dev/api/diagnostics/openai-audio", { method: "POST", headers: h }), env);
  let w = world({ OPENAI_API_KEY: KEY });
  let calls = installSocialFetch([[/audio\/transcriptions/, () => json({ text: "" })]]);
  assert.equal((await req(w.env, {})).status, 401);
  assert.equal(calls.length, 0);

  let r = await req(w.env);
  let text = await r.clone().text();
  let b = await r.json();
  assert.equal(b.stt.ok, true);
  assert.equal(b.key.shape, "project");
  assert.equal(calls.length, 1);
  const f = calls[0].body.get("file");
  assert.equal(f.type, "audio/wav");
  assert.equal(f.size, silentWav().byteLength);
  assert.ok(!text.includes("UNITTEST"));

  w = world({ OPENAI_API_KEY: KEY });
  installSocialFetch([[/audio\/transcriptions/, () => new Response(BODY_401, { status: 401 })]]);
  r = await req(w.env);
  text = await r.clone().text();
  b = await r.json();
  assert.equal(b.stt.ok, false);
  assert.equal(b.stt.http, 401);
  assert.equal(b.stt.reason, "invalid_api_key");
  assert.ok(!/UNITTEST|sk-proj|6789/.test(text), text);

  w = world({ OPENAI_API_KEY: "" });
  calls = installSocialFetch([]);
  b = await (await req(w.env)).json();
  assert.equal(b.key.set, false);
  assert.equal(b.stt.reason, "missing");
  assert.equal(calls.length, 0);
});

test("/api/status açarın yalnız formasını göstərir", async () => {
  const w = world({ OPENAI_API_KEY: ' "' + KEY + '"' });
  installSocialFetch([]);
  const r = await worker.fetch(new Request("https://jarvis.example.dev/api/status", { headers: { "x-passcode": "pw" } }), w.env);
  const text = await r.text();
  const b = JSON.parse(text);
  assert.equal(b.openai_key.shape, "project");
  assert.equal(b.openai_key.cleaned, true);
  assert.ok(!text.includes("UNITTEST"));
});
