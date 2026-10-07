// Səs əmri və media əlavələri: STT → əmr → planner → TTS. Real API yoxdur.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _resetMemoryForTests } from "../src/state/store.js";
import { resetSharedCoordinatorForTests } from "../src/coord/coordinator.js";
import { checkAudioFile, parseVoiceCommand, speakable, MAX_AUDIO_BYTES } from "../src/voice/command.js";
import { installFetch, standardHandler, baseEnv, worker, ok, anthropicCalls } from "./helpers.mjs";
import { fakeR2 } from "./social-helpers.mjs";
import { buildMp4 } from "./fixtures.mjs";

beforeEach(() => { _resetMemoryForTests(); resetSharedCoordinatorForTests(); });
let n = 0;
const ipn = () => "7.7.7." + ++n;

test("parseVoiceCommand: 'Jarvis,' prefiksi ayrılır; boş/uydurma STT mətni rədd edilir", () => {
  assert.deepEqual(parseVoiceCommand("Jarvis, Instagram üçün bu videonu hazırla"), { text: "Instagram üçün bu videonu hazırla", wake: true });
  assert.deepEqual(parseVoiceCommand("jarvis QR menu reklamını hazırla"), { text: "QR menu reklamını hazırla", wake: true });
  assert.deepEqual(parseVoiceCommand("Salam"), { text: "Salam", wake: false });
  assert.throws(() => parseVoiceCommand("   "), /eşitmədim/);
  assert.throws(() => parseVoiceCommand("Jarvis"), /Əmri de/);
  assert.throws(() => parseVoiceCommand("Thanks for watching"), /Aydın əmr/);
  assert.ok(parseVoiceCommand("a".repeat(5000)).text.length <= 1500);
});

test("checkAudioFile: boş, böyük və yanlış formatlı fayl rədd edilir", () => {
  assert.throws(() => checkAudioFile(null), /yoxdur/);
  assert.throws(() => checkAudioFile({ size: 0, type: "audio/webm" }), /boşdur/);
  assert.throws(() => checkAudioFile({ size: MAX_AUDIO_BYTES + 1, type: "audio/webm" }), /uzundur/);
  assert.throws(() => checkAudioFile({ size: 10, type: "application/pdf" }), /dəstəklənmir/);
  assert.ok(checkAudioFile({ size: 10, type: "audio/webm;codecs=opus" }));
});

test("speakable: link və uzun id səsə çıxmır", () => {
  const s = speakable("Bax https://x.dev/media/abc?sig=1 və id " + "a".repeat(24) + " hazırdır");
  assert.ok(!s.includes("https://"));
  assert.ok(!/a{20}/.test(s));
  assert.ok(s.includes("link ekranda"));
});

test("/api/talk səs: STT mətni əmrə çevrilir, wake=true; riskli əməliyyat yalnız təsdiq qeydi açır", async () => {
  const plan = { mode: "tools", tool_calls: [{ tool: "social.publish", input: { platform: "telegram", caption: "Salam" } }] };
  const base = standardHandler({ plan });
  const calls = installFetch((u, body, init) => (u.endsWith("/v1/audio/transcriptions") ? ok({ text: "Jarvis, telegramda paylaş" }) : base(u, body, init)));
  const fd = new FormData();
  fd.append("audio", new Blob([new Uint8Array(4000)], { type: "audio/webm" }), "v.webm");
  const r = await worker.fetch(new Request("https://x.dev/api/talk", { method: "POST", headers: { "x-passcode": "pw", "cf-connecting-ip": ipn() }, body: fd }), baseEnv());
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d).slice(0, 300));
  assert.equal(d.wake, true);
  assert.equal(d.transcript, "telegramda paylaş");
  assert.equal(d.status, "pending_approval");
  assert.ok(!calls.some((c) => c.url.includes("api.telegram.org")), "səs əmri təsdiqsiz paylaşmamalıdır");
});

test("/api/talk səs: STT boş mətn qaytararsa 400, Claude çağırılmır", async () => {
  const calls = installFetch((u) => (u.endsWith("/v1/audio/transcriptions") ? ok({ text: "" }) : new Response("x", { status: 500 })));
  const fd = new FormData();
  fd.append("audio", new Blob([new Uint8Array(4000)], { type: "audio/webm" }), "v.webm");
  const r = await worker.fetch(new Request("https://x.dev/api/talk", { method: "POST", headers: { "x-passcode": "pw", "cf-connecting-ip": ipn() }, body: fd }), baseEnv());
  assert.equal(r.status, 400);
  assert.equal(anthropicCalls(calls).length, 0);
});

test("/api/talk səs: yanlış formatlı fayl OpenAI-a göndərilmir", async () => {
  const calls = installFetch(() => new Response("x", { status: 500 }));
  const fd = new FormData();
  fd.append("audio", new Blob([new Uint8Array(100)], { type: "application/pdf" }), "x.pdf");
  const r = await worker.fetch(new Request("https://x.dev/api/talk", { method: "POST", headers: { "x-passcode": "pw", "cf-connecting-ip": ipn() }, body: fd }), baseEnv());
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test("/api/talk əlavə: mövcud media Claude-a bildirilir, mövcud olmayan/səhv id sakitcə atılır", async () => {
  const plan = { mode: "chat", reply: "Gördüm" };
  const calls = installFetch(standardHandler({ plan }));
  const env = { ...baseEnv(), JARVIS_MEDIA: fakeR2() };
  const body = buildMp4();
  const up = await worker.fetch(new Request("https://x.dev/api/media", { method: "POST", headers: { "x-passcode": "pw", "content-type": "video/mp4", "content-length": String(body.length), "cf-connecting-ip": ipn() }, body }), env);
  const m = await up.json();
  assert.equal(up.status, 200, JSON.stringify(m).slice(0, 300));
  const id = m.id || (m.media && m.media.id);
  assert.ok(id);
  const r = await worker.fetch(new Request("https://x.dev/api/talk", { method: "POST", headers: { "x-passcode": "pw", "content-type": "application/json", "cf-connecting-ip": ipn() }, body: JSON.stringify({ text: "bu videonu Instagram üçün hazırla", attachments: [id, "0".repeat(24), "../etc"] }) }), env);
  assert.equal(r.status, 200);
  const lead = anthropicCalls(calls).find((c) => c.body.system.startsWith("You are JARVIS, personal"));
  const text = JSON.stringify(lead.body.messages);
  assert.ok(text.includes("Attached media"), "əlavə bloku göndərilməlidir");
  assert.ok(text.includes(id));
  assert.ok(!text.includes("0".repeat(24)) && !text.includes("../etc"), "olmayan id göndərilməməlidir");
});
