// Telegram səsli mesajı: aşkarlama → getFile → fayl endirmə → OpenAI STT (whisper-1, "az") → YAZILI mesajla eyni yol.
// Telegram, OpenAI və Claude saxta serverlərlə əvəz olunur; real paylaşım yoxdur.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { json, installSocialFetch, bodyJson, world, seedToken, MP4 } from "./social-helpers.mjs";
import { voiceFromMessage, createTelegramHandler } from "../src/telegram/handler.js";

const DAY = 86400000;
const OWNER = 1001;
let uid = 9000;
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]).buffer; // "OggS" başlığı
const COPY = { caption: "Yeni ətir kolleksiyası artıq burada.", title: "Yeni ətir", description: "", hashtags: ["ətir"] };

const hook = (env, update) =>
  worker.fetch(new Request("https://jarvis.example.dev/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "whsec_test-1" }, body: JSON.stringify(update) }), env);
const voiceMsg = (extra = {}, from = OWNER, chatType = "private") => ({ update_id: ++uid, message: { message_id: 7, from: { id: from }, chat: { id: from, type: chatType }, voice: { file_id: "VOICE1", file_unique_id: "u1", duration: 3, mime_type: "audio/ogg", file_size: OGG.byteLength }, ...extra } });

function server({ transcript = "salam", stt = null, extra = [] } = {}) {
  return [
    ...extra,
    [/\/getFile/, (c) => {
      const id = bodyJson(c).file_id;
      if (id === "VOICE1") return json({ ok: true, result: { file_id: id, file_size: OGG.byteLength, file_path: "voice/file_9.oga" } });
      return json({ ok: true, result: { file_id: id, file_size: 20, file_path: "videos/file_1.mp4" } });
    }],
    [/api\.telegram\.org\/file\/bot123:TESTTOKEN\/voice\/file_9\.oga/, () => new Response(OGG, { status: 200 })],
    [/api\.telegram\.org\/file\/bot123:TESTTOKEN\/videos\/file_1\.mp4/, () => new Response(MP4, { status: 200 })],
    [/api\.openai\.com\/v1\/audio\/transcriptions/, stt || (() => json({ text: transcript }))],
    [/api\.anthropic\.com/, () => json({ content: [{ type: "text", text: JSON.stringify(COPY) }] })],
    [/\/sendMessage/, () => json({ ok: true, result: { message_id: 55, chat: { username: "testchannel" } } })],
    [/\/answerCallbackQuery/, () => json({ ok: true, result: true })],
  ];
}
const replies = (calls) => calls.filter((c) => /\/sendMessage/.test(c.url)).map((c) => bodyJson(c).text);
const sttCalls = (calls) => calls.filter((c) => /audio\/transcriptions/.test(c.url));

async function ready() {
  const w = world();
  await seedToken(w, "instagram", { access_token: "LONG_T", user_id: "178", obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  return w;
}

test("aşkarlama: voice, audio və audio sənəd səsli mesajdır; mətn, video, video note və şəkil deyil", () => {
  assert.equal(voiceFromMessage({ voice: { file_id: "a", mime_type: "audio/ogg", duration: 2 } }).kind, "voice");
  assert.equal(voiceFromMessage({ voice: { file_id: "a" } }).mime, "audio/ogg");
  assert.equal(voiceFromMessage({ audio: { file_id: "b", mime_type: "audio/mpeg" } }).kind, "audio");
  assert.equal(voiceFromMessage({ document: { file_id: "c", mime_type: "audio/mp4" } }).kind, "document");
  assert.equal(voiceFromMessage({ document: { file_id: "c", mime_type: "application/pdf" } }), null);
  assert.equal(voiceFromMessage({ text: "salam" }), null);
  assert.equal(voiceFromMessage({ video: { file_id: "v" } }), null);
  assert.equal(voiceFromMessage({ video_note: { file_id: "v" } }), null);
  assert.equal(voiceFromMessage({ photo: [{ file_id: "p" }] }), null);
  assert.equal(voiceFromMessage(null), null);
});

test("voice note: getFile → fayl endirilir → OpenAI STT (gpt-4o-transcribe), language=az, terminlər ipucu; menyu QAYTARILMIR", async () => {
  const w = await ready();
  const calls = installSocialFetch(server({ transcript: "Jarvis, platformaların vəziyyətini göstər" }));
  const r = await hook(w.env, voiceMsg());
  assert.equal(r.status, 200);
  const gf = calls.find((c) => /\/getFile$/.test(c.url));
  assert.ok(gf, "getFile çağırılmalıdır");
  assert.equal(bodyJson(gf).file_id, "VOICE1");
  assert.ok(calls.some((c) => /\/file\/bot123:TESTTOKEN\/voice\/file_9\.oga$/.test(c.url)), "fayl endirilməlidir");
  const [s] = sttCalls(calls);
  assert.ok(s, "STT çağırılmalıdır");
  assert.ok(s.body instanceof FormData);
  assert.equal(s.body.get("model"), "gpt-4o-transcribe");
  assert.match(s.body.get("prompt"), /QR Menu/);
  assert.equal(s.body.get("temperature"), "0");
  assert.equal(s.body.get("language"), "az");
  const f = s.body.get("file");
  assert.equal(f.name, "audio.ogg");
  assert.equal(f.type, "audio/ogg");
  assert.equal(f.size, OGG.byteLength);
  assert.match(s.headers.authorization, /^Bearer test-o$/);
  const texts = replies(calls);
  assert.ok(texts.some((t) => /Eşitdim: «platformaların vəziyyətini göstər»/.test(t)), texts.join(" | "));
  assert.ok(!texts.some((t) => /^JARVIS Telegram idarəsi/.test(t)), "səsli mesaja help menyusu qaytarılmamalıdır");
});

test("azərbaycanca transkripsiya yazılı mesaj kimi planner-ə gedir: paylaşım istəyi → qaralama + təsdiq düymələri, paylaşım YOX", async () => {
  const w = await ready();
  const calls = installSocialFetch(server({ transcript: "Jarvis, bunu Instagram-da paylaş. Mövzu: yeni ətir kolleksiyası" }));
  // səsli mesaj əvvəlki videoya cavab kimi göndərilir
  await hook(w.env, voiceMsg({ reply_to_message: { message_id: 3, video: { file_id: "F1", file_size: 20, mime_type: "video/mp4" } } }));
  const [rec] = await w.approvals.list({ status: "pending" });
  assert.ok(rec, "təsdiq qeydi yaranmalıdır");
  assert.equal(rec.kind, "social.publish");
  assert.deepEqual(rec.payload.request.platforms, ["instagram"]);
  assert.equal(rec.payload.request.media.type, "video");
  assert.equal(calls.filter((c) => /graph\.instagram\.com/.test(c.url)).length, 0, "təsdiqsiz paylaşım olmamalıdır");
  const texts = replies(calls);
  assert.ok(texts.some((t) => /Paylaşmağa icazə verirsən\?/.test(t)));
});

test("səslə 'Bəli' demək paylaşımı İCRA ETMİR (yazılı 'Bəli' ilə eyni qayda: yalnız düymə)", async () => {
  const w = await ready();
  const calls = installSocialFetch(server({ transcript: "Bəli" }));
  await hook(w.env, { update_id: ++uid, message: { message_id: 1, from: { id: OWNER }, chat: { id: OWNER, type: "private" }, caption: "Jarvis, bunu Instagram-da paylaş. Mövzu: yeni ətir kolleksiyası", video: { file_id: "F1", file_size: 20, mime_type: "video/mp4" } } });
  assert.equal((await w.approvals.list({ status: "pending" })).length, 1);
  await hook(w.env, voiceMsg());
  assert.equal(calls.filter((c) => /media_publish/.test(c.url)).length, 0);
  assert.ok(replies(calls).some((t) => /Mətnlə təsdiq qəbul edilmir/.test(t)));
  assert.equal((await w.approvals.list({ status: "pending" })).length, 1, "qeyd hələ də gözləyir");
});

test("ümumi səs əmri runChat-a yazılı mətnlə eyni aktorla ötürülür (handler səviyyəsi)", async () => {
  const w = await ready();
  installSocialFetch(server());
  const got = [];
  const h = createTelegramHandler({
    env: w.env, hub: w.hub, flow: w.flow, approvals: w.approvals, store: w.store, audit: w.audit,
    runChat: async (text, origin) => { got.push({ text, origin }); return { screen: "Bu gün 3 sifariş var." }; },
    transcribe: async (blob) => { assert.equal(blob.type, "audio/ogg"); return "Jarvis, bu günün sifarişlərini yoxla"; },
  });
  await h.handleUpdate(voiceMsg());
  await h.handleUpdate({ update_id: ++uid, message: { message_id: 8, from: { id: OWNER }, chat: { id: OWNER, type: "private" }, text: "bu günün sifarişlərini yoxla" } });
  assert.equal(got.length, 2);
  assert.equal(got[0].text, "bu günün sifarişlərini yoxla");
  assert.deepEqual(got[0].origin, got[1].origin);
  assert.deepEqual(got[0].origin, { channel: "telegram", chat_id: "1001", user_id: "1001" });
  const audit = JSON.stringify(await w.audit.list(10));
  assert.match(audit, /telegram\.voice_transcribed/);
  assert.ok(!audit.includes("sifariş"), "transkripsiya mətni audit jurnalına yazılmır");
});

test("transkripsiya uğursuzluğu: aydın xəta mesajı, help menyusu yox, planner/Claude çağırılmır", async () => {
  const cases = [
    [{ stt: () => new Response("server err", { status: 500 }) }, /Səsli mesajı mətnə çevirə bilmədim/],
    [{ stt: () => new Response("unauthorized", { status: 401 }) }, /Səsli mesajı mətnə çevirə bilmədim/],
    [{ transcript: "" }, /eşidilmədi/],
    [{ transcript: "Thanks for watching." }, /Aydın əmr eşidilmədi/],
    [{ extra: [[/\/getFile/, () => json({ ok: false, error_code: 400, description: "Bad Request: file is too big" }, 400)]] }, /mətnə çevirə bilmədim/],
  ];
  for (const [opt, re] of cases) {
    const w = await ready();
    const calls = installSocialFetch(server(opt));
    await hook(w.env, voiceMsg());
    const texts = replies(calls);
    assert.equal(texts.length, 1, texts.join(" | "));
    assert.match(texts[0], re);
    assert.match(texts[0], /yazı ilə yaz/);
    assert.ok(!/JARVIS Telegram idarəsi/.test(texts[0]));
    assert.equal(calls.filter((c) => /anthropic/.test(c.url)).length, 0);
    assert.ok(!texts[0].includes("test-o") && !texts[0].includes("TESTTOKEN"), "açar/token mesaja düşməməlidir");
    assert.match(JSON.stringify(await w.audit.list(10)), /telegram\.voice_failed/);
  }
});

test("çox böyük səs faylı və OPENAI_API_KEY yoxdursa: endirmə/STT olmadan aydın xəta", async () => {
  let w = await ready();
  let calls = installSocialFetch(server());
  await hook(w.env, voiceMsg({ voice: { file_id: "VOICE1", duration: 900, mime_type: "audio/ogg", file_size: 9 * 1024 * 1024 } }));
  assert.equal(calls.filter((c) => /getFile|audio\/transcriptions/.test(c.url)).length, 0);
  assert.match(replies(calls)[0], /çox uzundur/);

  w = world({ OPENAI_API_KEY: "" });
  calls = installSocialFetch(server());
  await hook(w.env, voiceMsg());
  assert.equal(sttCalls(calls).length, 0);
  assert.match(replies(calls)[0], /OPENAI_API_KEY/);
});

test("FEATURE_VOICE=0: səsli mesaj işlənmir, səbəb yazılır", async () => {
  const w = world({ FEATURE_VOICE: "0" });
  const calls = installSocialFetch(server());
  await hook(w.env, voiceMsg());
  assert.equal(calls.filter((c) => /getFile|audio\/transcriptions/.test(c.url)).length, 0);
  assert.match(replies(calls)[0], /FEATURE_VOICE=0/);
});

test("icazəsiz çat/qrup: səsli mesaj endirilmir, transkripsiya edilmir, cavab yoxdur", async () => {
  const w = await ready();
  const calls = installSocialFetch(server());
  await hook(w.env, voiceMsg({}, 2002));
  await hook(w.env, voiceMsg({}, OWNER, "group"));
  const w2 = world({ TELEGRAM_ALLOWED_CHAT_IDS: "" });
  await hook(w2.env, voiceMsg());
  assert.equal(calls.length, 0, "icazəsiz səsli mesaj heç bir xarici çağırış yaratmamalıdır");
});

test("eyni səsli mesaj (update_id təkrarı) bir dəfə transkripsiya olunur; yazılı mesajlar dəyişməyib", async () => {
  const w = await ready();
  const calls = installSocialFetch(server({ transcript: "/status" }));
  const u = voiceMsg();
  await hook(w.env, u);
  await hook(w.env, u);
  assert.equal(sttCalls(calls).length, 1);
  await hook(w.env, { update_id: ++uid, message: { message_id: 9, from: { id: OWNER }, chat: { id: OWNER, type: "private" }, text: "/help" } });
  assert.equal(sttCalls(calls).length, 1, "yazılı mesaj STT çağırmamalıdır");
  assert.ok(replies(calls).some((t) => /^JARVIS Telegram idarəsi/.test(t)), "/help yazılı əmri əvvəlki kimi işləyir");
});

test("runChat gecikəndə: istifadəçiyə «Daxili xəta» yox, vaxt limiti mesajı gedir (səssizlik də yox)", async () => {
  const w = await ready();
  const calls = installSocialFetch(server());
  const h = createTelegramHandler({
    env: w.env, hub: w.hub, flow: w.flow, approvals: w.approvals, store: w.store, audit: w.audit, chatDeadlineMs: 30,
    runChat: async () => new Promise(() => {}),
    transcribe: async () => "QR Menu üçün reklam hazırla.",
  });
  await h.handleUpdate(voiceMsg());
  const out = replies(calls).join("\n");
  assert.match(out, /Bunu indi edə bilmədim: Vaxt limiti|Bunu indi edə bilmədim: Cavab hazırlanması çox çəkdi/);
  assert.doesNotMatch(out, /Daxili xəta/);
});
