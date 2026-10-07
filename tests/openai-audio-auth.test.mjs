// OpenAI STT autentifikasiyası: açarın təmizlənməsi, 401 səbəbinin təhlükəsiz təsnifi, diaqnostika ucu.
// Açar dəyəri heç bir cavaba/mesaja/jurnala düşməməlidir.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { json, installSocialFetch, bodyJson, world } from "./social-helpers.mjs";
import { stt, openaiAuthReason, silentWav } from "../src/adapters/openaiAudio.js";
import { openaiKey, inspectOpenAIKey } from "../src/security/envvalue.js";

// Saxta açar işləmə vaxtı yığılır ki, repo sızma skaneri (tests/leak-scan) onu real açar saymasın.
const KEY = ["sk", "proj", "UNITTESTKEYabcdefghijklmnop0123456789"].join("-");
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
    assert.equal(calls[0].body.get("model"), "gpt-4o-transcribe");
    assert.equal(calls[0].body.get("language"), "az");
  }
  assert.deepEqual(inspectOpenAIKey({ OPENAI_API_KEY: KEY }), { set: true, shape: "project", cleaned: false, usable: true, sendable: true, problems: [], has_inner_space: false, last4: "6789" });
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: "sk-short" }).last4, null, "qısa dəyərdə son simvollar göstərilmir");
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: ' "' + KEY + '" ' }).cleaned, true);
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: "sk-admin-xyz" }).shape, "admin");
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: "sk-abc123" }).shape, "legacy");
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: "abc" }).shape, "unexpected");
  assert.equal(inspectOpenAIKey({ OPENAI_API_KEY: "sk-a b" }).has_inner_space, true);
  assert.equal(inspectOpenAIKey({}).set, false);
  assert.ok(!JSON.stringify(inspectOpenAIKey({ OPENAI_API_KEY: KEY })).includes("UNITTEST"), "yalnız son 4 simvol, açarın qalanı yox");
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

const diag = (env, h = { "x-passcode": "pw" }) => worker.fetch(new Request("https://jarvis.example.dev/api/diagnostics/openai-audio", { method: "POST", headers: h }), env);
const H401 = { "content-type": "application/json", "x-request-id": "req_abc123", "openai-organization": "user-xyz" };
const okHeaders = { "content-type": "application/json", "x-request-id": "req_ok1", "openai-project": "proj_TEST1", "openai-organization": "org-TEST" };

test("diaqnostika: parolsuz 401, heç bir OpenAI sorğusu yoxdur", async () => {
  const w = world({ OPENAI_API_KEY: KEY });
  const calls = installSocialFetch([]);
  assert.equal((await diag(w.env, {})).status, 401);
  assert.equal(calls.length, 0);
});

test("diaqnostika: işləyir → verdict ok; /v1/models və /v1/audio/transcriptions eyni Bearer başlığı ilə; layihə id görünür; açar yox", async () => {
  const w = world({ OPENAI_API_KEY: ' "' + KEY + '"\n' });
  const calls = installSocialFetch([
    [/\/v1\/models$/, () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: okHeaders })],
    [/audio\/transcriptions/, () => new Response(JSON.stringify({ text: "" }), { status: 200, headers: okHeaders })],
  ]);
  const r = await diag(w.env);
  const text = await r.clone().text();
  const b = await r.json();
  assert.equal(b.verdict, "ok");
  assert.equal(b.header.well_formed, true);
  assert.equal(b.key.cleaned, true);
  assert.equal(b.key.last4, "6789");
  assert.equal(b.auth.http, 200);
  assert.equal(b.auth.project, "proj_TEST1");
  assert.equal(b.stt.model, "gpt-4o-transcribe");
  assert.equal(b.stt.language, "az");
  assert.equal(calls.length, 2);
  for (const c of calls) assert.equal(c.headers.authorization, "Bearer " + KEY);
  const f = calls[1].body.get("file");
  assert.equal(f.type, "audio/wav");
  assert.equal(f.size, silentWav().byteLength);
  assert.equal(calls[1].body.get("language"), "az");
  assert.ok(!text.includes("UNITTEST"), "açar cavabda olmamalıdır");
});

test("diaqnostika: OpenAI 401 invalid_api_key → key_invalid, request_id var, error.message (maskalı açar) yox", async () => {
  const w = world({ OPENAI_API_KEY: KEY });
  installSocialFetch([[/api\.openai\.com/, () => new Response(BODY_401, { status: 401, headers: H401 })]]);
  const r = await diag(w.env);
  const text = await r.clone().text();
  const b = await r.json();
  assert.equal(b.verdict, "key_invalid");
  assert.equal(b.auth.http, 401);
  assert.equal(b.stt.http, 401);
  assert.equal(b.stt.error_code, "invalid_api_key");
  assert.equal(b.stt.request_id, "req_abc123");
  assert.match(b.action, /yeni layihə açarı/);
  assert.ok(!/UNITTEST|sk-proj-\*|\*\*\*\*|Incorrect API key/.test(text), text);
});

test("diaqnostika: autentifikasiya işləyir, audio scope yoxdur → missing_audio_scope; billing → billing; admin açarı; secret yoxdur; şəbəkə", async () => {
  let w = world({ OPENAI_API_KEY: KEY });
  installSocialFetch([
    [/\/v1\/models$/, () => new Response("{}", { status: 200, headers: okHeaders })],
    [/audio\/transcriptions/, () => new Response(BODY_SCOPE, { status: 401, headers: H401 })],
  ]);
  let b = await (await diag(w.env)).json();
  assert.equal(b.verdict, "missing_audio_scope");
  assert.match(b.action, /Permissions/);

  w = world({ OPENAI_API_KEY: KEY });
  installSocialFetch([[/api\.openai\.com/, (c) => /models$/.test(c.url) ? new Response("{}", { status: 200 }) : new Response(BODY_QUOTA, { status: 429 })]]);
  assert.equal((await (await diag(w.env)).json()).verdict, "billing");

  w = world({ OPENAI_API_KEY: ["sk", "admin", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"].join("-") });
  installSocialFetch([[/api\.openai\.com/, () => new Response(BODY_401, { status: 401 })]]);
  b = await (await diag(w.env)).json();
  assert.equal(b.verdict, "admin_key");

  w = world({ OPENAI_API_KEY: "" });
  const calls = installSocialFetch([]);
  b = await (await diag(w.env)).json();
  assert.equal(b.verdict, "secret_missing");
  assert.equal(calls.length, 0);

  w = world({ OPENAI_API_KEY: KEY });
  installSocialFetch([[/api\.openai\.com/, () => { throw new TypeError("fetch failed"); }]]);
  b = await (await diag(w.env)).json();
  assert.equal(b.verdict, "unreachable");
  assert.equal(b.stt.reached, false);
});

test("/api/status açarın yalnız formasını göstərir", async () => {
  const w = world({ OPENAI_API_KEY: ' "' + KEY + '"' });
  installSocialFetch([]);
  const r = await worker.fetch(new Request("https://jarvis.example.dev/api/status", { headers: { "x-passcode": "pw" } }), w.env);
  const text = await r.text();
  const b = JSON.parse(text);
  assert.equal(b.openai_key.shape, "project");
  assert.equal(b.openai_key.cleaned, true);
  assert.equal(b.openai_key.last4, undefined, "status-da son simvollar da göstərilmir");
  assert.ok(!text.includes("UNITTEST"));
});

// ---- HTTP 0 / network_error səbəbi: açarın içində sətir sonu və s. ----
test("açarın içində sətir sonu, görünməz simvol, ağıllı dırnaq, OPENAI_API_KEY= prefiksi: normallaşdırılır və eyni Bearer başlığı qurulur", async () => {
  const variants = [
    KEY.slice(0, 20) + "\n" + KEY.slice(20),
    KEY.slice(0, 20) + "\r\n" + KEY.slice(20) + "\n",
    "\uFEFF" + KEY,
    KEY + "\u200B",
    "\u201C" + KEY + "\u201D",
    "OPENAI_API_KEY=" + KEY,
    "Bearer " + KEY.slice(0, 10) + " " + KEY.slice(10),
  ];
  for (const raw of variants) {
    assert.equal(openaiKey({ OPENAI_API_KEY: raw }), KEY, JSON.stringify(inspectOpenAIKey({ OPENAI_API_KEY: raw }).problems));
    const info = inspectOpenAIKey({ OPENAI_API_KEY: raw });
    assert.equal(info.usable, true);
    assert.ok(info.problems.length >= 1);
    const calls = installSocialFetch([[/audio\/transcriptions/, () => json({ text: "salam" })]]);
    assert.equal(await stt({ OPENAI_API_KEY: raw }, new Blob([OGG], { type: "audio/ogg" }), 5000), "salam");
    assert.equal(calls[0].headers.authorization, "Bearer " + KEY);
    // real Headers ilə də başlıq qəbul olunur (Cloudflare/Node fetch "Invalid header value" atmır)
    assert.doesNotThrow(() => new Headers({ authorization: calls[0].headers.authorization }));
  }
});

test("başlığa yazıla bilməyən açar (latın olmayan simvol): sorğu GÖNDƏRİLMİR; Telegram və diaqnostika dəqiq problemi deyir", async () => {
  const raw = ["sk", "proj", "ABCəDEFGHIJKLMNOPQRSTUVWX"].join("-");
  const info = inspectOpenAIKey({ OPENAI_API_KEY: raw });
  assert.equal(info.sendable, false);
  assert.ok(info.problems.includes("non_ascii_chars"));
  assert.equal(info.last4, null);
  let calls = installSocialFetch([]);
  await assert.rejects(() => stt({ OPENAI_API_KEY: raw }, new Blob([OGG], { type: "audio/ogg" }), 5000), (e) => e.code === "AUTH_ERROR" && /latın olmayan/.test(e.message));
  assert.equal(calls.length, 0);

  const w = world({ OPENAI_API_KEY: raw });
  calls = installSocialFetch(tgRoutes(() => json({ text: "x" })));
  await hook(w.env, voice());
  const [t] = replies(calls);
  assert.match(t, /OPENAI_API_KEY formatı səhvdir/);
  assert.ok(!t.includes("ABCəDEF"), "açarın hissəsi mesajda olmamalıdır");
  assert.equal(calls.filter((c) => /openai/.test(c.url)).length, 0);

  const w2 = world({ OPENAI_API_KEY: raw });
  calls = installSocialFetch([]);
  const r = await diag(w2.env);
  const text = await r.clone().text();
  const b = await r.json();
  assert.equal(b.verdict, "key_malformed");
  assert.equal(b.header.well_formed, false);
  assert.ok(b.problems.some((x) => /latın olmayan/.test(x)));
  assert.equal(calls.length, 0);
  assert.ok(!text.includes("ABCəDEF"));
});

test("sk- ilə başlamayan / qısa açar: bloklanmır (qərarı OpenAI verir), amma problem göstərilir; 401-də hökm key_invalid", async () => {
  for (const [raw, problem] of [[["not", "an", "openai", "key", "value", "1234567890"].join("-"), "not_sk_prefix"], [["sk", "abc"].join("-"), "too_short"]]) {
    const info = inspectOpenAIKey({ OPENAI_API_KEY: raw });
    assert.equal(info.sendable, true);
    assert.equal(info.usable, false);
    assert.ok(info.problems.includes(problem));
    const w = world({ OPENAI_API_KEY: raw });
    const calls = installSocialFetch([[/api\.openai\.com/, () => new Response(BODY_401, { status: 401 })]]);
    const b = await (await diag(w.env)).json();
    assert.equal(calls.length, 2, "sorğu göndərilir");
    assert.equal(b.verdict, "key_invalid");
    assert.equal(b.header.well_formed, false);
    assert.match(b.action, /OpenAI açarı formasında deyil/);
  }
});

test("fetch başlıq xətası atarsa (Cloudflare: 'Invalid header value') bu 'şəbəkə' kimi yox, key_malformed kimi göstərilir", async () => {
  const w = world({ OPENAI_API_KEY: KEY });
  installSocialFetch([[/api\.openai\.com/, () => { throw new TypeError("Invalid header value."); }]]);
  const b = await (await diag(w.env)).json();
  assert.equal(b.auth.reason, "invalid_header_value");
  assert.equal(b.auth.error_name, "TypeError");
  assert.equal(b.stt.http, 0);
  assert.equal(b.verdict, "key_malformed");
  const w2 = world({ OPENAI_API_KEY: KEY });
  installSocialFetch([[/api\.openai\.com/, () => { throw new TypeError("fetch failed"); }]]);
  const b2 = await (await diag(w2.env)).json();
  assert.equal(b2.auth.reason, "network_error");
  assert.equal(b2.verdict, "unreachable");
});
