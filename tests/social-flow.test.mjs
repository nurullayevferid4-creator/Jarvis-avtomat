import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { json, installSocialFetch, bodyParams, bodyJson, world, seedToken, MP4, JPG } from "./social-helpers.mjs";
import { formatResult } from "../src/social/flow.js";

const DAY = 86400000;
const PW = { "x-passcode": "pw", "content-type": "application/json" };

async function igWorld(extra = {}, opts) {
  const w = world(extra, opts);
  await seedToken(w, "instagram", { access_token: "LONG_T", user_id: "178", obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  return w;
}

// Instagram saxta serveri: media_publish sayğacı ilə
function igServer({ publishResponse, status = "FINISHED" } = {}) {
  return [
    [/\/178\/media_publish/, publishResponse || (() => json({ id: "POST_1" }))],
    [/\/178\/media$/, () => json({ id: "CONT_1" })],
    [/\/CONT_1\?/, () => json({ status_code: status })],
    [/\/POST_1\?/, () => json({ permalink: "https://www.instagram.com/p/XYZ/" })],
  ];
}
const publishCalls = (calls) => calls.filter((c) => c.url.includes("media_publish"));
const IG_INPUT = { platform: "instagram", caption: "Yeni ətir kolleksiyası", media_url: "https://cdn.example.com/a.jpg", media_type: "image" };

// ---------- təsdiq qapısı ----------
test("təsdiqdən əvvəl HEÇ BİR platforma çağırışı olmur (draft, startJob, advance, tick)", async () => {
  const w = await igWorld();
  const calls = installSocialFetch([]); // hər şəbəkə çağırışı testi pozur
  const rec = await w.flow.createDraft(IG_INPUT, { source: "test" });
  assert.equal(rec.status, "pending");
  assert.equal(rec.kind, "social.publish");
  assert.match(rec.payload_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(await w.flow.startJob(rec.id), { ok: false, error: "not_approved" });
  assert.equal(await w.flow.advance(rec.id), null);
  assert.deepEqual(await w.flow.tick(), []);
  await w.approvals.decide(rec.id, { decision: "reject" });
  assert.deepEqual(await w.flow.startJob(rec.id), { ok: false, error: "not_approved" });
  assert.equal(calls.length, 0);
});

test("təsdiqdən sonra paylaşım TAM BİR DƏFƏ olur; təkrar startJob/advance ikinci paylaşım yaratmır", async () => {
  const w = await igWorld();
  const calls = installSocialFetch(igServer());
  const rec = await w.flow.createDraft(IG_INPUT, { source: "test" });
  assert.equal((await w.approvals.decide(rec.id, { decision: "approve" })).record.execution, "pending");
  const s = await w.flow.startJob(rec.id);
  assert.ok(s.ok);
  assert.equal(calls.length, 0, "startJob şəbəkəyə çıxmamalıdır");
  const job = await w.flow.advance(rec.id);
  assert.equal(job.status, "done");
  assert.equal(job.targets.instagram.post_id, "POST_1");
  assert.equal(publishCalls(calls).length, 1);
  const again = await w.flow.startJob(rec.id);
  assert.equal(again.existing, true);
  await w.flow.advance(rec.id);
  await w.flow.tick();
  assert.equal(publishCalls(calls).length, 1, "ikinci media_publish olmamalıdır");
  assert.equal((await w.approvals.get(rec.id)).execution, "done");
});

test("təsdiq qeydinin payload-u dəyişdirilərsə icra BLOKLANIR (hash)", async () => {
  const w = await igWorld();
  const calls = installSocialFetch(igServer());
  const rec = await w.flow.createDraft(IG_INPUT, { source: "test" });
  await w.approvals.decide(rec.id, { decision: "approve" });
  const stored = await w.store.getDoc("approval", rec.id);
  stored.payload.request.caption = "ZƏRƏRLİ MƏTN";
  await w.store.putDoc("approval", rec.id, stored);
  assert.deepEqual(await w.flow.startJob(rec.id), { ok: false, error: "payload_modified" });
  assert.equal(calls.length, 0);
  assert.equal((await w.approvals.get(rec.id)).execution, "blocked");
});

test("strukturlu təsdiq qeydi edit oluna bilməz; adi qeyd üçün davranış dəyişməyib (manual)", async () => {
  const w = await igWorld();
  const rec = await w.flow.createDraft(IG_INPUT, { source: "test" });
  assert.deepEqual(await w.approvals.decide(rec.id, { decision: "edit", content: "başqa" }), { ok: false, error: "edit_not_supported" });
  const plain = await w.approvals.create({ action: "price.change", content: "x", risk: "high" });
  assert.equal((await w.approvals.decide(plain.id, { decision: "approve" })).record.execution, "manual");
  assert.deepEqual(await w.flow.startJob(plain.id), { ok: false, error: "not_social" });
});

test("alət reyestri: social.publish yalnız qeyd açır; media çatışmayanda qeyd 'issues' ilə yaranır, icra zamanı rədd olunur", async () => {
  const w = await igWorld();
  const calls = installSocialFetch([]);
  const { createDefaultToolRegistry } = await import("../src/tools/builtin.js");
  const reg = createDefaultToolRegistry({ audit: w.audit, approvals: w.approvals });
  const r = await reg.run("social.publish", { platform: "instagram", caption: "Yeni ətir" }, { source: "test" });
  assert.equal(r.status, "pending_approval");
  const rec = await w.approvals.get(r.approval_id);
  assert.equal(rec.kind, "social.publish");
  assert.match(rec.content, /DİQQƏT/);
  await w.approvals.decide(rec.id, { decision: "approve" });
  const s = await w.flow.startJob(rec.id);
  assert.equal(s.job.status, "failed");
  assert.equal(s.job.targets.instagram.error.code, "invalid_request");
  assert.equal(calls.length, 0);
  assert.equal((await reg.run("social.publish", { platform: "myspace", caption: "x" })).status, "invalid_input");
  assert.equal((await reg.run("social.publish", { caption: "x" })).status, "invalid_input");
});

// ---------- icra təhlükəsizliyi ----------
test("commit zamanı şəbəkə xətası → 'unknown', avtomatik TƏKRAR yoxdur", async () => {
  const w = await igWorld();
  const calls = installSocialFetch(igServer({ publishResponse: () => new Response("<html>bad gateway</html>", { status: 502 }) }));
  const rec = await w.flow.createDraft(IG_INPUT, { source: "test" });
  await w.approvals.decide(rec.id, { decision: "approve" });
  await w.flow.startJob(rec.id);
  const job = await w.flow.advance(rec.id);
  assert.equal(job.targets.instagram.step, "unknown");
  assert.equal(job.status, "unknown");
  await w.flow.advance(rec.id);
  await w.flow.tick();
  assert.equal(publishCalls(calls).length, 1);
  assert.match(formatResult(job), /nəticə bilinmir/);
});

test("proses 'committing' mərhələsində kəsilibsə təkrar paylaşım olmur", async () => {
  const w = await igWorld();
  const calls = installSocialFetch(igServer());
  const rec = await w.flow.createDraft(IG_INPUT, { source: "test" });
  await w.approvals.decide(rec.id, { decision: "approve" });
  const { job } = await w.flow.startJob(rec.id);
  job.targets.instagram.step = "committing";
  job.targets.instagram.data.container_id = "CONT_1";
  await w.store.putDoc("socialjob", job.id, job);
  const res = await w.flow.advance(rec.id);
  assert.equal(res.targets.instagram.step, "unknown");
  assert.equal(publishCalls(calls).length, 0);
});

test("bir platforma uğursuz, digəri uğurlu → 'partial'; uğursuz platforma təkrar paylaşmır", async () => {
  const w = await igWorld();
  await seedToken(w, "youtube", { access_token: "YT", refresh_token: "R", obtained_at: w.now(), expires_at: w.now() + 3600000 });
  const m = await w.hub.media.put(MP4, "video/mp4");
  const calls = installSocialFetch([
    ...igServer(),
    [/upload\/youtube\/v3\/videos/, () => json({ error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403)],
  ]);
  const rec = await w.flow.createDraft({ platforms: ["instagram", "youtube"], caption: "Video", title: "T", media_id: m.id, media_type: "video" }, { source: "test" });
  await w.approvals.decide(rec.id, { decision: "approve" });
  await w.flow.startJob(rec.id);
  const job = await w.flow.advance(rec.id);
  assert.equal(job.status, "partial");
  assert.equal(job.targets.instagram.step, "done");
  assert.equal(job.targets.youtube.step, "failed");
  assert.equal(job.targets.youtube.error.code, "rate_limited");
  const text = formatResult(job);
  assert.match(text, /✅ Instagram/);
  assert.match(text, /❌ YouTube/);
  assert.equal(calls.filter((c) => c.url.includes("upload/youtube/v3/videos")).length, 1);
  await w.flow.tick();
  assert.equal(calls.filter((c) => c.url.includes("upload/youtube/v3/videos")).length, 1);
});

test("token bitibsə iş 'failed' (token_expired), platformaya paylaşım göndərilmir", async () => {
  const w = world();
  await seedToken(w, "instagram", { access_token: "OLD", user_id: "178", obtained_at: w.now() - 70 * DAY, expires_at: w.now() - DAY });
  const calls = installSocialFetch([]);
  const rec = await w.flow.createDraft(IG_INPUT, { source: "test" });
  await w.approvals.decide(rec.id, { decision: "approve" });
  await w.flow.startJob(rec.id);
  const job = await w.flow.advance(rec.id);
  assert.equal(job.status, "failed");
  assert.equal(job.targets.instagram.error.code, "token_expired");
  assert.equal(calls.length, 0);
});

test("panel: platforma vəziyyəti + gözləyən təsdiqlər sayılır", async () => {
  const w = await igWorld({ TIKTOK_CLIENT_KEY: "" });
  installSocialFetch([]);
  await w.flow.createDraft(IG_INPUT, { source: "test" });
  const p = await w.flow.panel();
  assert.equal(p.platforms.instagram.state, "CONNECTED");
  assert.equal(p.platforms.instagram.pending_approvals, 1);
  assert.equal(p.platforms.tiktok.state, "NOT_CONNECTED");
  assert.equal(p.pending.length, 1);
  assert.ok(!JSON.stringify(p).includes("LONG_T"));
});

// ---------- HTTP API ----------
const req = (path, { method = "GET", headers = PW, body, env } = {}) => new Request("https://jarvis.example.dev" + path, { method, headers, body });

test("API: /api/social/* parolsuz 401; status token mətni vermir; /api/status-da secret dəyərləri yoxdur", async () => {
  const w = await igWorld();
  installSocialFetch([]);
  for (const p of ["/api/social/status", "/api/social/jobs"]) assert.equal((await worker.fetch(req(p, { headers: {} }), w.env)).status, 401);
  assert.equal((await worker.fetch(req("/api/media", { method: "POST", headers: { "content-type": "video/mp4" }, body: MP4 }), w.env)).status, 401);
  const st = await (await worker.fetch(req("/api/social/status"), w.env)).json();
  assert.equal(st.platforms.instagram.state, "CONNECTED");
  const sys = await (await worker.fetch(req("/api/status"), w.env)).json();
  assert.deepEqual(sys.secrets, { ANTHROPIC_API_KEY: true, OPENAI_API_KEY: true, PASSCODE: true });
  assert.equal(sys.social.telegram.bot_token, true);
  const all = JSON.stringify(st) + JSON.stringify(sys);
  for (const v of ["LONG_T", "ig-secret", "tt-secret", "g-secret", "TESTTOKEN", "whsec_test-1", "test-signing-key"]) assert.ok(!all.includes(v), v + " sızıb");
});

test("API: draft → approve → paylaşım (təsdiq düyməsi axını), job nəticəsi və təkrar təsdiq 409", async () => {
  const w = await igWorld();
  const calls = installSocialFetch(igServer());
  const d = await (await worker.fetch(req("/api/social/draft", { method: "POST", body: JSON.stringify(IG_INPUT) }), w.env)).json();
  assert.equal(d.approval.status, "pending");
  assert.equal(calls.length, 0);
  const bad = await worker.fetch(req("/api/social/draft", { method: "POST", body: JSON.stringify({ platform: "instagram", caption: "x" }) }), w.env);
  assert.equal(bad.status, 400);
  const r = await worker.fetch(req("/api/approvals/" + d.approval.id, { method: "POST", body: JSON.stringify({ decision: "approve" }) }), w.env);
  const out = await r.json();
  assert.equal(out.job.status, "done");
  assert.equal(out.record.execution, "done");
  assert.equal(publishCalls(calls).length, 1);
  const r2 = await worker.fetch(req("/api/approvals/" + d.approval.id, { method: "POST", body: JSON.stringify({ decision: "approve" }) }), w.env);
  assert.equal(r2.status, 409);
  assert.equal(publishCalls(calls).length, 1);
  const jobs = await (await worker.fetch(req("/api/social/jobs"), w.env)).json();
  assert.equal(jobs.jobs.length, 1);
});

test("API: media yükləmə, imzalı ünvan yalnız düzgün imza ilə açılır (imza yox/səhv/vaxtı keçmiş → 404)", async () => {
  const w = await igWorld();
  installSocialFetch([]);
  const up = await worker.fetch(req("/api/media", { method: "POST", headers: { "x-passcode": "pw", "content-type": "video/mp4", "content-length": String(MP4.byteLength) }, body: MP4 }), w.env);
  assert.equal(up.status, 200);
  const { media } = await up.json();
  assert.match(media.id, /^[0-9a-f]{24}$/);
  assert.equal((await worker.fetch(req("/api/media", { method: "POST", headers: { "x-passcode": "pw", "content-type": "text/html" }, body: "<script>" }), w.env)).status, 400);
  const url = new URL(await w.hub.media.signedUrl(media.id, "mp4", 600));
  const ok = await worker.fetch(new Request(url.toString()), w.env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "video/mp4");
  assert.equal((await ok.arrayBuffer()).byteLength, MP4.byteLength);
  assert.equal((await worker.fetch(new Request("https://jarvis.example.dev/media/" + media.id + ".mp4"), w.env)).status, 404);
  const tampered = new URL(url); tampered.searchParams.set("sig", "0".repeat(64));
  assert.equal((await worker.fetch(new Request(tampered.toString()), w.env)).status, 404);
  const other = new URL(url); other.pathname = "/media/" + "b".repeat(24) + ".mp4";
  assert.equal((await worker.fetch(new Request(other.toString()), w.env)).status, 404);
  const old = world({}, { start: 1_700_000_000_000 });
  const expired = new URL(await old.hub.media.signedUrl(media.id, "mp4", 600));
  assert.equal((await worker.fetch(new Request(expired.toString()), w.env)).status, 404);
});

test("API: OAuth connect → callback; state bir dəfəlik; səhv/uydurma state rədd olunur", async () => {
  const w = world();
  installSocialFetch([
    [/api\.instagram\.com\/oauth\/access_token/, () => json({ data: [{ access_token: "S", user_id: "178", permissions: ["instagram_business_basic"] }] })],
    [/graph\.instagram\.com\/access_token\?/, () => json({ access_token: "LONG_OAUTH", expires_in: 5184000 })],
    [/graph\.instagram\.com\/v25\.0\/me\?/, () => json({ user_id: "178", username: "farid_test", account_type: "BUSINESS" })],
  ]);
  const c = await (await worker.fetch(req("/api/social/instagram/connect", { method: "POST" }), w.env)).json();
  const state = new URL(c.url).searchParams.get("state");
  assert.match(state, /^[0-9a-f]{32}$/);
  assert.equal(c.redirect_uri, "https://jarvis.example.dev/oauth/instagram/callback");
  assert.equal((await worker.fetch(req("/api/social/instagram/connect", { method: "POST", headers: {} }), w.env)).status, 401);
  const cb = (q) => worker.fetch(new Request("https://jarvis.example.dev/oauth/instagram/callback?" + q), w.env);
  assert.equal((await cb("code=C&state=" + "a".repeat(32))).status, 400);
  assert.equal((await cb("code=C")).status, 400);
  assert.equal((await cb("code=C&state=" + state + "&error=access_denied")).status, 400); // state yandı, icazə verilmədi
  assert.equal((await cb("code=C&state=" + state)).status, 400, "istifadə olunmuş state yenidən işləməməlidir");
  const c2 = await (await worker.fetch(req("/api/social/instagram/connect", { method: "POST" }), w.env)).json();
  const ok = await cb("code=C&state=" + new URL(c2.url).searchParams.get("state"));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Qoşuldu/);
  assert.equal((await w.hub.vault.get("instagram")).access_token, "LONG_OAUTH");
  // başqa platformanın state-i ilə callback
  const c3 = await (await worker.fetch(req("/api/social/tiktok/connect", { method: "POST" }), w.env)).json();
  const wrong = await worker.fetch(new Request("https://jarvis.example.dev/oauth/instagram/callback?code=C&state=" + new URL(c3.url).searchParams.get("state")), w.env);
  assert.equal(wrong.status, 400);
  // PUBLIC_BASE_URL və ya secret yoxdursa
  const w2 = world({ PUBLIC_BASE_URL: "" });
  assert.equal((await worker.fetch(req("/api/social/instagram/connect", { method: "POST" }), w2.env)).status, 409);
  const w3 = world({ GOOGLE_CLIENT_ID: "" });
  assert.equal((await worker.fetch(req("/api/social/youtube/connect", { method: "POST" }), w3.env)).status, 409);
  assert.equal((await worker.fetch(req("/api/social/telegram/connect", { method: "POST" }), w3.env)).status, 502);
});

test("cron: scheduled() gözləyən işi irəlilədir", async () => {
  const w = await igWorld({}, { start: Date.now() - 600000 });
  const calls = installSocialFetch(igServer());
  const rec = await w.flow.createDraft(IG_INPUT, { source: "test" });
  await w.approvals.decide(rec.id, { decision: "approve" });
  await w.flow.startJob(rec.id);
  const partial = await w.flow.advance(rec.id, { deadlineMs: 1 }); // gözləmədən çıxır
  assert.equal(partial.targets.instagram.step, "started");
  assert.equal(publishCalls(calls).length, 0);
  let waited;
  await worker.scheduled({}, w.env, { waitUntil: (p) => { waited = p; } });
  await waited;
  const job = await w.flow.getJob(rec.id);
  assert.equal(job.status, "done");
  assert.equal(publishCalls(calls).length, 1);
});
