// Müstəqil təhlükəsizlik yoxlamasından çıxan düzəlişlərin testləri.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { json, installSocialFetch, bodyJson, world, seedToken, MP4 } from "./social-helpers.mjs";
import { normalizePublishRequest, summarizeRequest } from "../src/social/request.js";
import { isGoogleUploadUrl } from "../src/social/adapters/YouTube.js";
import { createStore } from "../src/state/store.js";
import { createSocialFlow } from "../src/social/flow.js";
import { createSocialHub } from "../src/social/hub.js";
import { ApprovalCenter } from "../src/approval/center.js";

const DAY = 86400000;
const OWNER = 1001;
let uid = 9000;
const hook = (env, update) => worker.fetch(new Request("https://jarvis.example.dev/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "whsec_test-1" }, body: JSON.stringify(update) }), env);
const msg = (extra, from = OWNER) => ({ update_id: ++uid, message: { message_id: 1, from: { id: from }, chat: { id: from, type: "private" }, ...extra } });
const press = (data, from = OWNER) => ({ update_id: ++uid, callback_query: { id: "cb" + uid, from: { id: from }, data, message: { message_id: 2, chat: { id: from, type: "private" } } } });
const tgOk = [
  [/\/sendMessage/, () => json({ ok: true, result: { message_id: 55, chat: { username: "testchannel" } } })],
  [/\/answerCallbackQuery|editMessageReplyMarkup/, () => json({ ok: true, result: true })],
];
const channelPosts = (calls) => calls.filter((c) => /\/sendMessage/.test(c.url) && String(c.body).includes("@testchannel"));
const TG_INPUT = { platform: "telegram", caption: "Kanal mətni" };

// ---------- P1-1: eyni anda iki təsdiq / iki advance ----------
// KV-nin gecikməsini təqlid edən saxta KV (hər əməliyyat 2 ms gözləyir)
function slowKv() {
  const m = new Map();
  const wait = () => new Promise((r) => setTimeout(r, 2));
  return {
    async get(k, type) { await wait(); const v = m.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { await wait(); m.set(k, v); },
    async delete(k) { await wait(); m.delete(k); },
    async list({ prefix, limit }) { await wait(); return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })) }; },
  };
}

test("eyni anda iki təsdiq + iki advance + cron → kanala TAM BİR post (gecikməli KV ilə)", async () => {
  const w = world({ JARVIS_KV: slowKv() });
  const calls = installSocialFetch(tgOk);
  const rec = await w.flow.createDraft(TG_INPUT, { source: "test" });
  const results = await Promise.all([w.flow.approveAndStart(rec.id), w.flow.approveAndStart(rec.id), w.flow.approveAndStart(rec.id)]);
  assert.equal(results.filter((r) => r.ok).length, 1, "yalnız bir təsdiq uğurlu olmalıdır");
  await Promise.all([w.flow.advance(rec.id), w.flow.advance(rec.id), w.flow.tick()]);
  assert.equal(channelPosts(calls).length, 1);
  assert.equal((await w.flow.getJob(rec.id)).status, "done");
});

test("HTTP: iki paralel təsdiq sorğusundan biri 409, post bir dənədir", async () => {
  const w = world({ JARVIS_KV: slowKv() });
  const calls = installSocialFetch(tgOk);
  const rec = await w.flow.createDraft(TG_INPUT, { source: "test" });
  const ask = () => worker.fetch(new Request("https://jarvis.example.dev/api/approvals/" + rec.id, { method: "POST", headers: { "x-passcode": "pw", "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) }), w.env);
  const rs = await Promise.all([ask(), ask()]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(channelPosts(calls).length, 1);
});

// ---------- P2-4: təsdiq alınıb, iş yaranmayıb ----------
test("təsdiq qeydi 'approved' qalıb, iş yaranmayıbsa cron (tick) təsdiqi və hash-i yoxlayıb işi bərpa edir", async () => {
  const w = world();
  const calls = installSocialFetch(tgOk);
  const rec = await w.flow.createDraft(TG_INPUT, { source: "test" });
  await w.approvals.decide(rec.id, { decision: "approve" }); // startJob çağırılmadı (proses dayanıb)
  await w.store.putRaw("socialidx", { ids: [rec.id] });
  assert.equal(await w.flow.getJob(rec.id), null);
  const out = await w.flow.tick();
  assert.deepEqual(out, [{ id: rec.id, status: "done" }]);
  assert.equal(channelPosts(calls).length, 1);
  // təsdiq olunmamış qeyd indeksdə olsa belə icra olunmur
  const w2 = world();
  const c2 = installSocialFetch(tgOk);
  const r2 = await w2.flow.createDraft(TG_INPUT, { source: "test" });
  await w2.store.putRaw("socialidx", { ids: [r2.id] });
  assert.deepEqual(await w2.flow.tick(), []);
  assert.equal(channelPosts(c2).length, 0);
});

// ---------- P1-2: xülasə hər şeyi göstərir ----------
test("təsdiq xülasəsi bütün paylaşılacaq sahələri göstərir; uzun mətn səssiz kəsilmir, rədd olunur", () => {
  const req = normalizePublishRequest({
    platforms: ["instagram", "youtube"], caption: "A".repeat(2100) + " SON", title: "Başlıq", description: "GİZLİ-DESCRIPTION-LİNK https://evil.example/x",
    hashtags: ["a", "b"], media_id: "a".repeat(24), media_type: "video", thumbnail_media_id: "b".repeat(24), made_for_kids: true,
  });
  const s = summarizeRequest(req);
  assert.ok(s.includes("A".repeat(2100) + " SON"), "caption tam görünməlidir");
  assert.ok(s.includes("GİZLİ-DESCRIPTION-LİNK https://evil.example/x"));
  assert.ok(s.includes("#a #b") && s.includes("b".repeat(24)) && s.includes("Uşaqlar üçün məzmun: bəli"));
  assert.match(s, /Instagram üçün məxfilik seçimi yoxdur, paylaşım ictimai olur/);
  assert.ok(s.length < 3900);
  const ext = summarizeRequest(normalizePublishRequest({ platform: "instagram", caption: "x", media_url: "https://cdn.example.com/q.jpg", media_type: "image" }));
  assert.ok(ext.includes("https://cdn.example.com/q.jpg"));
  assert.throws(() => normalizePublishRequest({ platform: "telegram", caption: "x".repeat(2201) }), /simvoldan uzundur/);
  assert.throws(() => normalizePublishRequest({ platform: "telegram", caption: "x", description: "d".repeat(1001) }), /description/);
});

// ---------- P2-3: Telegram təsdiq bağlılığı ----------
async function ready(extra = {}) {
  const w = world({ TELEGRAM_ALLOWED_CHAT_IDS: "1001,1002", ...extra });
  await seedToken(w, "instagram", { access_token: "T", user_id: "178", obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  return w;
}

test("başqa söhbətin düyməsi (hətta icazəli) qeydi təsdiq edə bilmir", async () => {
  const w = await ready();
  const calls = installSocialFetch(tgOk);
  const rec = await w.flow.createDraft(TG_INPUT, { source: "telegram:1001", notifyChat: "1001" });
  await hook(w.env, press("ap:" + rec.id + ":y", 1002));
  assert.equal((await w.approvals.get(rec.id)).status, "pending");
  assert.equal(channelPosts(calls).length, 0);
  await hook(w.env, press("ap:" + rec.id + ":n", 1002));
  assert.equal((await w.approvals.get(rec.id)).status, "pending");
  // UI-da yaranmış (notify_chat yoxdur) qeyd Telegram düyməsi ilə təsdiqlənmir
  const ui = await w.flow.createDraft(TG_INPUT, { source: "ui" });
  await hook(w.env, press("ap:" + ui.id + ":y", 1001));
  assert.equal((await w.approvals.get(ui.id)).status, "pending");
  assert.equal(channelPosts(calls).length, 0);
  await hook(w.env, press("ap:" + rec.id + ":y", 1001));
  assert.equal(channelPosts(calls).length, 1);
});

test("zəif sözlər ('ok', 'tamam', 'yaxşı') və köhnə qaralama mətnlə təsdiq SAYILMIR; düymə klaviaturası silinir", async () => {
  const w = await ready();
  const calls = installSocialFetch(tgOk);
  const rec = await w.flow.createDraft(TG_INPUT, { source: "telegram:1001", notifyChat: "1001" });
  for (const word of ["ok", "tamam", "yaxşı", "olar", "davam et"]) await hook(w.env, msg({ text: word }));
  assert.equal((await w.approvals.get(rec.id)).status, "pending");
  assert.equal(channelPosts(calls).length, 0);
  // 15 dəqiqədən köhnə qaralama
  const old = await w.store.getDoc("approval", rec.id);
  old.ts = new Date(Date.now() - 20 * 60000).toISOString();
  await w.store.putDoc("approval", rec.id, old);
  await hook(w.env, msg({ text: "Bəli" }));
  assert.equal((await w.approvals.get(rec.id)).status, "pending");
  // düyməyə basılanda klaviatura silinir
  await hook(w.env, press("ap:" + rec.id + ":y"));
  assert.ok(calls.some((c) => /editMessageReplyMarkup/.test(c.url)));
  assert.equal(channelPosts(calls).length, 1);
});

// ---------- P2-5/6/7: ünvan yoxlamaları və nəticəsi bilinməyən vəziyyət ----------
test("YouTube Location və TikTok upload_url yalnız etibarlı domenlərə icazə verir", async () => {
  assert.equal(isGoogleUploadUrl("https://www.googleapis.com/upload/youtube/v3/videos?x=1"), true);
  for (const bad of ["https://evilgoogleapis.com/x", "https://googleapis.com.evil.com/x", "http://www.googleapis.com/x", "https://user:pw@www.googleapis.com/x", "https://127.0.0.1/x", ""]) assert.equal(isGoogleUploadUrl(bad), false, bad);

  const w = world();
  await seedToken(w, "tiktok", { access_token: "TT", refresh_token: "R", obtained_at: w.now(), expires_at: w.now() + 3600000, refresh_expires_at: w.now() + 300 * DAY });
  const m = await w.hub.media.put(MP4, "video/mp4");
  const ok = (d) => json({ data: d, error: { code: "ok", message: "", log_id: "L" } });
  const calls = installSocialFetch([
    [/creator_info/, () => ok({ privacy_level_options: ["SELF_ONLY"] })],
    [/video\/init/, () => ok({ publish_id: "p", upload_url: "https://evil.example.com/steal" })],
  ]);
  const req = normalizePublishRequest({ platform: "tiktok", caption: "x", media_id: m.id, media_type: "video" });
  await assert.rejects(() => w.hub.adapter("tiktok").start(req, { data: {} }), (e) => /upload ünvanı/.test(e.message));
  assert.ok(!calls.some((c) => c.method === "PUT"), "video etibarsız ünvana göndərilməməlidir");
});

test("YouTube: 2xx cavabda video id yoxdursa nəticə 'unknown' olur (failed yox), təkrar yoxdur", async () => {
  const w = world();
  await seedToken(w, "youtube", { access_token: "YT", refresh_token: "R", obtained_at: w.now(), expires_at: w.now() + 3600000 });
  const m = await w.hub.media.put(MP4, "video/mp4");
  const calls = installSocialFetch([[/upload\/youtube\/v3\/videos/, (c) => c.method === "POST" ? new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=S" } }) : json({ kind: "x" })]]);
  const rec = await w.flow.createDraft({ platform: "youtube", caption: "c", title: "t", media_id: m.id, media_type: "video" }, { source: "test" });
  await w.flow.approveAndStart(rec.id);
  const job = await w.flow.advance(rec.id);
  assert.equal(job.targets.youtube.step, "unknown");
  await w.flow.advance(rec.id);
  await w.flow.tick();
  assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
});

// ---------- P2-8: açıq token şifrələnir ----------
test("TOKEN_ENC_KEY sonradan təyin olunsa köhnə açıq token oxunan kimi şifrələnir", async () => {
  const w = world();
  // Köhnə (açarsız dövrdən qalan) açıq qeyd: yeni kod belə qeyd YAZMIR, yalnız oxuyub şifrələyir
  await w.store.putRaw("secret:instagram", { v: 1, plain: { access_token: "PLAINTOKEN123", user_id: "1", expires_at: w.now() + DAY } });
  assert.ok(JSON.stringify(await w.store.getRaw("secret:instagram")).includes("PLAINTOKEN123"));
  const env2 = { ...w.env, TOKEN_ENC_KEY: "new-key" };
  const hub2 = createSocialHub(env2, createStore(env2), { now: w.now });
  assert.equal((await hub2.vault.get("instagram")).access_token, "PLAINTOKEN123");
  assert.ok(!JSON.stringify(await w.store.getRaw("secret:instagram")).includes("PLAINTOKEN123"));
  assert.equal((await hub2.vault.get("instagram")).access_token, "PLAINTOKEN123");
});

// ---------- P2-9: uzun yükləmə kilidi ----------
test("kilid: 5 dəqiqəlik müddət ərzində başqa nüsxənin yarımçıq addımı 'unknown' sayılmır; bitəndən sonra sayılır", async () => {
  const w = world();
  await seedToken(w, "youtube", { access_token: "YT", refresh_token: "R", obtained_at: w.now(), expires_at: w.now() + 3600000 });
  const m = await w.hub.media.put(MP4, "video/mp4");
  const calls = installSocialFetch([]);
  const rec = await w.flow.createDraft({ platform: "youtube", caption: "c", title: "t", media_id: m.id, media_type: "video" }, { source: "test" });
  const { job } = await w.flow.approveAndStart(rec.id);
  // başqa nüsxə yükləməni başladıb: addım "starting", kilid 200 san sonra bitir
  job.targets.youtube.step = "starting";
  job.lock_until = w.now() + 200000;
  await w.store.putDoc("socialjob", job.id, job);
  w.advanceTime(100000);
  const during = await w.flow.advance(rec.id);
  assert.equal(during.targets.youtube.step, "starting", "kilid aktivdir: toxunulmamalıdır");
  w.advanceTime(250000);
  const after = await w.flow.advance(rec.id);
  assert.equal(after.targets.youtube.step, "unknown");
  assert.equal(calls.length, 0, "heç bir platforma çağırışı olmamalıdır");
});

test("eyni isolate-də paralel advance çağırışları növbəyə düzülür (uzun yükləmə zamanı ikinci çağırış gözləyir)", async () => {
  const w = world();
  await seedToken(w, "youtube", { access_token: "YT", refresh_token: "R", obtained_at: w.now(), expires_at: w.now() + 3600000 });
  const m = await w.hub.media.put(MP4, "video/mp4");
  let resolvePut;
  const calls = installSocialFetch([[/upload\/youtube\/v3\/videos/, (c) => c.method === "POST"
    ? new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=S" } })
    : new Promise((r) => { resolvePut = () => r(json({ id: "V1", status: { privacyStatus: "private" } })); })]]);
  const rec = await w.flow.createDraft({ platform: "youtube", caption: "c", title: "t", media_id: m.id, media_type: "video" }, { source: "test" });
  await w.flow.approveAndStart(rec.id);
  const a = w.flow.advance(rec.id);
  const b = w.flow.advance(rec.id);
  await new Promise((r) => setTimeout(r, 30));
  resolvePut();
  const [ja, jb] = await Promise.all([a, b]);
  // yükləmədən sonra "done" yox, emal yoxlaması gözlənir
  assert.equal(ja.targets.youtube.step, "started");
  assert.equal(jb.targets.youtube.step, "started");
  assert.equal(calls.filter((c) => c.method === "PUT").length, 1);
});

test("TOKEN_ENC_KEY olmadan token yazılmır (açıq mətnlə saxlanmır) və OAuth qoşulması başladılmır", async () => {
  const w = world({ TOKEN_ENC_KEY: "" });
  await assert.rejects(() => w.hub.vault.put("instagram", { access_token: "T" }), /TOKEN_ENC_KEY/);
  assert.equal(await w.store.getRaw("secret:instagram"), null);
  const { beginOAuth } = await import("../src/social/oauth.js");
  await assert.rejects(() => beginOAuth({ hub: w.hub, store: w.store, env: w.env, platform: "instagram" }), /TOKEN_ENC_KEY/);
});

test("cron bərpası Telegram mənşəli (origin.chat_id) təsdiqlənmiş qeydi də icra edir; sistem aktoru qərar verə bilməz", async () => {
  const { SYSTEM_RECOVERY_ACTOR } = await import("../src/approval/center.js");
  const w = world();
  const calls = installSocialFetch(tgOk);
  const origin = { channel: "telegram", chat_id: "1001" };
  const rec = await w.flow.createDraft(TG_INPUT, { source: "test", origin });
  assert.equal((await w.approvals.decide(rec.id, { decision: "approve", actor: SYSTEM_RECOVERY_ACTOR })).ok, false, "sistem aktoru təsdiq verə bilməz");
  assert.equal((await w.approvals.decide(rec.id, { decision: "approve", actor: origin })).ok, true);
  await w.store.putRaw("socialidx", { ids: [rec.id] });
  const out = await w.flow.tick();
  assert.deepEqual(out, [{ id: rec.id, status: "done" }]);
  assert.equal(channelPosts(calls).length, 1);
});
