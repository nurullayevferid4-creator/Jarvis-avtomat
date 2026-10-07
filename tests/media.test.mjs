// Media: növ təyini, MP4 analizi, yükləmə doğrulaması, platforma qaydaları, iş axını, silmə təsdiqi, real ffmpeg e2e.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { _resetMemoryForTests, createStore } from "../src/state/store.js";
import { createAudit } from "../src/audit/log.js";
import { ApprovalCenter } from "../src/approval/center.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createActionRunner } from "../src/actions/runner.js";
import { MemoryCoordinator } from "../src/coord/coordinator.js";
import { createMediaStore } from "../src/social/media.js";
import { sniffType } from "../src/media/sniff.js";
import { analyzeMp4, bufferReader } from "../src/media/mp4.js";
import { platformFit, editPlan, verifyAgainstTarget } from "../src/media/rules.js";
import { createMediaLibrary, imageSize } from "../src/media/library.js";
import { createMediaJobs } from "../src/media/jobs.js";
import { createVideoProcessor } from "../src/media/processor.js";
import { registerMediaTools } from "../src/media/tools.js";
import { OWNER_PERMISSIONS } from "../src/policy.js";
import { buildMp4, buildJpeg, buildPng, buildPdf } from "./fixtures.mjs";
import { fakeR2 } from "./social-helpers.mjs";

beforeEach(() => _resetMemoryForTests());
const stream = (u8) => new Blob([u8]).stream();

function world({ processor = null, signedBase = "https://jarvis.example.dev" } = {}) {
  let t = 1_790_000_000_000;
  const now = () => t;
  const env = { JARVIS_MEDIA: fakeR2(), MEDIA_SIGNING_KEY: "k-test", PUBLIC_BASE_URL: signedBase };
  const store = createStore({});
  const audit = createAudit(store, now);
  const coord = new MemoryCoordinator(now);
  const media = createMediaStore(env, now);
  const library = createMediaLibrary({ media, store, audit, now });
  const jobs = createMediaJobs({ store, coord, library, media, processor, audit, now, sleep: async () => { t += 5000; } });
  const approvals = new ApprovalCenter(store, audit, now, coord);
  const tools = new ToolRegistry({ audit, approvals });
  registerMediaTools(tools, { library, jobs, media });
  const runner = createActionRunner({ approvals, registry: tools, audit });
  return { env, store, audit, coord, media, library, jobs, approvals, tools, runner, tick: (ms) => { t += ms; } };
}
const up = (w, u8, ct, name = "x") => w.library.ingest({ body: stream(u8), contentType: ct, length: u8.length, filename: name });

test("növ təyini: başlıq baytlarına görə; HEIC, boş və qəribə fayl tanınmır", () => {
  assert.equal(sniffType(buildJpeg()).content_type, "image/jpeg");
  assert.equal(sniffType(buildPng()).kind, "image");
  assert.equal(sniffType(buildMp4()).content_type, "video/mp4");
  assert.equal(sniffType(buildMp4({ brand: "qt  " })).content_type, "video/quicktime");
  assert.equal(sniffType(buildPdf()).kind, "document");
  assert.equal(sniffType(buildMp4({ brand: "heic" })), null);
  assert.equal(sniffType(new TextEncoder().encode("<html><script>alert(1)</script>")), null);
  assert.equal(sniffType(new Uint8Array(4)), null);
});

test("MP4 analizi: ölçü, müddət, kodek, fırlanma, faststart; korlanmış fayllar rədd edilir", async () => {
  const a = await analyzeMp4(bufferReader(buildMp4()));
  assert.deepEqual([a.width, a.height, a.duration_s, a.video.codec, a.audio.codec, a.faststart], [320, 568, 2, "h264", "aac", true]);
  const r = await analyzeMp4(bufferReader(buildMp4({ rotation: 90 })));
  assert.deepEqual([r.width, r.height], [568, 320], "fırlanmış video göstərilən ölçü ilə");
  assert.equal((await analyzeMp4(bufferReader(buildMp4({ faststart: false })))).faststart, false);
  assert.equal((await analyzeMp4(bufferReader(buildMp4({ audio: null })))).audio, null);
  for (const [o, re] of [[{ noMoov: true }, /moov/], [{ truncate: 50 }, /yarımçıq/], [{ noVideoTrack: true }, /video treki/]]) {
    await assert.rejects(() => analyzeMp4(bufferReader(buildMp4(o))), (e) => e.code === "VALIDATION_ERROR" && re.test(e.message));
  }
  await assert.rejects(() => analyzeMp4(bufferReader(new Uint8Array(10))), /kiçik/);
  await assert.rejects(() => analyzeMp4(bufferReader(buildJpeg())), (e) => e.code === "VALIDATION_ERROR");
});

test("şəkil ölçüsü JPEG və PNG-dən oxunur", () => {
  assert.deepEqual(imageSize(buildJpeg(100, 50)), { width: 100, height: 50 });
  assert.deepEqual(imageSize(buildPng(200, 80)), { width: 200, height: 80 });
});

test("yükləmə: düzgün fayllar qəbul edilir, metadata saxlanır", async () => {
  const w = world();
  const v = await up(w, buildMp4(), "video/mp4", "salam ətir.mp4");
  assert.equal(v.kind, "video");
  assert.equal(v.analysis.height, 568);
  assert.equal(v.filename, "salam ətir.mp4");
  assert.equal((await w.library.get(v.id)).size, v.size);
  assert.equal((await up(w, buildJpeg(), "image/jpeg")).analysis.width, 64);
  assert.equal((await up(w, buildPng(), "image/png")).kind, "image");
  assert.equal((await up(w, buildPdf(), "application/pdf")).kind, "document");
  assert.equal((await w.library.list(10)).length, 4);
});

test("yükləmə: uyğunsuz/korlanmış/təhlükəli fayllar rədd edilir və anbarda QALMIR", async () => {
  const w = world();
  const before = () => w.env.JARVIS_MEDIA._m.size;
  const bad = [
    [buildPng(), "video/mp4", /uyğun deyil/],
    [new TextEncoder().encode("<html><script>alert(1)</script></html>"), "image/png", /tanınmadı/],
    [buildMp4({ truncate: 60 }), "video/mp4", /yarımçıq/],
    [buildMp4({ noMoov: true }), "video/mp4", /moov/],
    [buildJpeg(0, 0), "image/jpeg", /ölçü/],
  ];
  for (const [bytes, ct, re] of bad) {
    await assert.rejects(() => up(w, bytes, ct), (e) => e.code === "VALIDATION_ERROR" && re.test(e.message), ct);
  }
  assert.equal(before(), 0, "rədd edilən fayllar R2-də qalmamalıdır");
  await assert.rejects(() => up(w, buildMp4(), "text/html"), /dəstəklənmir/);
  await assert.rejects(() => w.library.ingest({ body: stream(buildMp4()), contentType: "video/mp4", length: 0 }), /Content-Length/);
  await assert.rejects(() => w.library.ingest({ body: stream(buildJpeg()), contentType: "image/jpeg", length: 9 * 1024 * 1024 }), /çox böyük/);
  // bəyan olunan ölçü real ölçüyə uyğun deyil
  await assert.rejects(() => w.library.ingest({ body: stream(buildMp4()), contentType: "video/mp4", length: buildMp4().length + 10 }), /ölçüsü/);
  assert.equal(before(), 0);
});

const A = (o) => analyzeMp4(bufferReader(buildMp4(o)));

test("platforma qaydaları: şaquli h264 uyğundur, üfüqi video reframe, uzun video trim, MOV remux, ölçü bloklayır", async () => {
  const fit = async (o, p = "instagram") => platformFit(await A(o), p);
  assert.equal(editPlan(await fit({}), null).needs_processing, false);
  assert.ok((await fit({ width: 640, height: 360 })).ops.some((o) => o.op === "reframe"));
  assert.ok((await fit({ duration: 200 })).ops.some((o) => o.op === "trim"));
  assert.ok((await fit({ brand: "qt  " })).ops.some((o) => o.op === "remux"));
  assert.ok((await fit({ faststart: false })).ops.some((o) => o.op === "faststart"));
  assert.equal(platformFit(await A({}), "instagram", { size: 70 * 1024 * 1024 }).ok, false);
  const short = await fit({ duration: 0.4 });
  assert.equal(short.ok, true);
  assert.ok(short.warnings.some((x) => /minimum/.test(x)));
  assert.equal(verifyAgainstTarget(await A({}), { container: "mp4", aspect: [0.55, 0.57] }).ok, true);
  assert.equal(verifyAgainstTarget(await A({ width: 640, height: 360 }), { aspect: [0.55, 0.57] }).ok, false);
  assert.equal(verifyAgainstTarget(null, {}).ok, false);
});

// ---- İş axını ----
const processedMp4 = () => buildMp4({ width: 720, height: 1280, duration: 2 });
function fakeProcessor({ output = processedMp4(), failWith = null, steps = 1, configured = true } = {}) {
  const calls = { submit: 0, status: 0, output: 0, ops: null };
  return {
    configured,
    calls,
    async submit({ ops }) { calls.submit++; calls.ops = ops; return { id: "job-" + "a".repeat(12) }; },
    async status() { calls.status++; if (failWith) return { status: "failed", error: failWith }; return { status: calls.status >= steps ? "done" : "running", error: null }; },
    async output() { calls.output++; return { body: stream(output), length: output.length }; },
  };
}

test("iş: redaktə lazım deyilsə emal 'skipped', nəticə orijinal, processed:false (saxta emal iddiası yoxdur)", async () => {
  const proc = fakeProcessor();
  const w = world({ processor: proc });
  const v = await up(w, buildMp4(), "video/mp4");
  const job = await w.jobs.submitVideoJob({ media_id: v.id, platform: "instagram" });
  assert.equal(job.status, "QUEUED");
  const done = await w.jobs.advance(job.id);
  assert.equal(done.status, "SUCCESS");
  assert.equal(done.result.processed, false);
  assert.equal(done.result.media_id, v.id);
  assert.equal(done.stages.process.status, "skipped");
  assert.equal(proc.calls.submit, 0);
  assert.ok(done.started_at && done.finished_at && done.attempts === 1);
});

test("iş: emal lazımdır və xidmət işləyir → nəticə yenidən analiz edilir, hədəfə uyğundursa SUCCESS+verified", async () => {
  const proc = fakeProcessor({ steps: 2 });
  const w = world({ processor: proc });
  const v = await up(w, buildMp4({ width: 640, height: 360 }), "video/mp4");
  const job = await w.jobs.submitVideoJob({ media_id: v.id, platform: "instagram" });
  const done = await w.jobs.advance(job.id);
  assert.equal(done.status, "SUCCESS", JSON.stringify(done.error));
  assert.equal(done.result.processed, true);
  assert.equal(done.result.verified, true);
  assert.notEqual(done.result.media_id, v.id);
  assert.deepEqual([done.result.analysis.width, done.result.analysis.height], [720, 1280]);
  assert.equal((await w.library.get(done.result.media_id)).source, "derived");
  assert.ok(proc.calls.ops.some((o) => o.op === "reframe"));
  assert.equal(proc.calls.submit, 1);
});

test("iş: xidmət səhv nəticə qaytarsa (hələ üfüqi) FAILED, törəmə fayl silinir, 'hazırdır' deyilmir", async () => {
  const w = world({ processor: fakeProcessor({ output: buildMp4({ width: 640, height: 360 }) }) });
  const v = await up(w, buildMp4({ width: 640, height: 360 }), "video/mp4");
  const done = await w.jobs.advance((await w.jobs.submitVideoJob({ media_id: v.id, platform: "instagram" })).id);
  assert.equal(done.status, "FAILED");
  assert.match(done.error.message, /hədəfə uyğun deyil/);
  assert.equal(done.result, null);
  assert.equal((await w.library.list(10)).length, 1, "törəmə fayl qalmamalıdır");
});

test("iş: xidmət korlanmış fayl qaytarsa rədd edilir", async () => {
  const w = world({ processor: fakeProcessor({ output: buildMp4({ truncate: 40 }) }) });
  const v = await up(w, buildMp4({ width: 640, height: 360 }), "video/mp4");
  const done = await w.jobs.advance((await w.jobs.submitVideoJob({ media_id: v.id, platform: "tiktok" })).id);
  assert.equal(done.status, "FAILED");
  assert.equal(done.error.retryable, true);
});

test("iş: emal xidməti qoşulmayıbsa FAILED, plan və səbəb görünür, uğur elan edilmir", async () => {
  const w = world({ processor: createVideoProcessor({}) });
  const v = await up(w, buildMp4({ width: 640, height: 360 }), "video/mp4");
  const done = await w.jobs.advance((await w.jobs.submitVideoJob({ media_id: v.id, platform: "instagram" })).id);
  assert.equal(done.status, "FAILED");
  assert.equal(done.error.code, "AUTH_ERROR");
  assert.match(done.error.message, /OLUNMADI/);
  assert.ok(done.result.partial.plan.includes("9:16"));
  assert.equal(done.result.verified, false);
});

test("iş: sərt blokerdə (ölçü > 64 MB) iş FAILED; naməlum/video olmayan media rədd edilir", async () => {
  const w = world({ processor: fakeProcessor() });
  const v = await up(w, buildMp4(), "video/mp4");
  // anbardakı real fayl ölçüsü metadata ilə uyğun gəlməsə iş dayanır (fayl dəyişdirilib)
  w.env.JARVIS_MEDIA._m.get("m/" + v.id).bytes = new Uint8Array(100).buffer;
  const done = await w.jobs.advance((await w.jobs.submitVideoJob({ media_id: v.id, platform: "instagram" })).id);
  assert.equal(done.status, "FAILED");
  assert.match(done.error.message, /dəyişib|yoxdur/);
  const img = await up(w, buildJpeg(), "image/jpeg");
  await assert.rejects(() => w.jobs.submitVideoJob({ media_id: img.id, platform: "instagram" }), /video deyil/);
  await assert.rejects(() => w.jobs.submitVideoJob({ media_id: "f".repeat(24), platform: "instagram" }), (e) => e.code === "NOT_FOUND");
  await assert.rejects(() => w.jobs.submitVideoJob({ media_id: v.id, platform: "myspace" }), (e) => e.code === "VALIDATION_ERROR");
});

test("iş: xidmət uğursuz olsa FAILED+retryable, retry ilə yenidən işləyir, maksimum 3 cəhd", async () => {
  let fail = true;
  const proc = fakeProcessor();
  proc.status = async () => (fail ? { status: "failed", error: "ffmpeg xətası" } : { status: "done", error: null });
  const w = world({ processor: proc });
  const v = await up(w, buildMp4({ width: 640, height: 360 }), "video/mp4");
  const job = await w.jobs.submitVideoJob({ media_id: v.id, platform: "instagram" });
  let j = await w.jobs.advance(job.id);
  assert.equal(j.status, "FAILED");
  assert.equal(j.error.retryable, true);
  fail = false;
  await w.jobs.retry(job.id);
  j = await w.jobs.advance(job.id);
  assert.equal(j.status, "SUCCESS");
  assert.equal(j.attempts, 2);
  await assert.rejects(() => w.jobs.retry(job.id), /yalnız uğursuz/i);
});

test("iş: eyni işi 8 paralel advance bir dəfə işlədir (emal xidmətinə bir göndəriş)", async () => {
  const proc = fakeProcessor({ steps: 1 });
  const w = world({ processor: proc });
  const v = await up(w, buildMp4({ width: 640, height: 360 }), "video/mp4");
  const job = await w.jobs.submitVideoJob({ media_id: v.id, platform: "instagram" });
  const res = await Promise.all(Array.from({ length: 8 }, () => w.jobs.advance(job.id)));
  assert.ok(res.every((r) => r));
  assert.equal(proc.calls.submit, 1);
  assert.equal((await w.jobs.get(job.id)).status, "SUCCESS");
});

test("iş: emal uzun çəkərsə RUNNING qalır və növbəti advance-də davam edir (cron/UI)", async () => {
  let n = 0;
  const proc = fakeProcessor();
  proc.status = async () => ({ status: ++n >= 6 ? "done" : "running", error: null });
  const w = world({ processor: proc });
  const v = await up(w, buildMp4({ width: 640, height: 360 }), "video/mp4");
  const job = await w.jobs.submitVideoJob({ media_id: v.id, platform: "instagram" });
  const first = await w.jobs.advance(job.id, { deadlineMs: 6000 });
  assert.equal(first.status, "RUNNING");
  const later = await w.jobs.advance(job.id, { deadlineMs: 60000 });
  assert.equal(later.status, "SUCCESS");
  assert.equal(proc.calls.submit, 1, "təkrar göndərilməməlidir");
});

test("alətlər: media.analyze və media.prepare_video işləyir, nəticə QUEUED/RUNNING/SUCCESS-dən başqa uğur elan etmir", async () => {
  const w = world({ processor: fakeProcessor() });
  const v = await up(w, buildMp4({ width: 640, height: 360 }), "video/mp4");
  const a = await w.tools.run("media.analyze", { media_id: v.id, platform: "instagram" }, { permissions: OWNER_PERMISSIONS });
  assert.equal(a.status, "done");
  assert.equal(a.output.plan.needs_processing, true);
  const p = await w.tools.run("media.prepare_video", { media_id: v.id, platform: "instagram" }, { permissions: OWNER_PERMISSIONS });
  assert.equal(p.status, "done");
  assert.ok(["QUEUED", "RUNNING", "SUCCESS", "FAILED"].includes(p.output.job.status));
  const g = await w.tools.run("media.job.get", { job_id: p.output.job.id }, { permissions: OWNER_PERMISSIONS });
  assert.equal(g.output.job.status, "SUCCESS");
  assert.equal(g.output.job.result.verified, true);
  assert.equal((await w.tools.run("media.analyze", { media_id: "e".repeat(24), platform: "instagram" }, { permissions: OWNER_PERMISSIONS })).status, "error");
});

test("silmə: media.delete təsdiq tələb edir, təsdiqsiz fayl qalır, təsdiqlə silinir, ikinci icra olmur", async () => {
  const w = world();
  const v = await up(w, buildJpeg(), "image/jpeg");
  const r = await w.tools.run("media.delete", { media_id: v.id, label: "test şəkil" }, { permissions: OWNER_PERMISSIONS, approvals: w.approvals });
  assert.equal(r.status, "pending_approval");
  assert.ok(await w.library.get(v.id), "təsdiqdən əvvəl silinməməlidir");
  assert.equal((await w.runner.execute(r.approval_id, { actor: { channel: "ui" } })).ok, false);
  assert.ok(await w.library.get(v.id));
  const ex = await w.runner.approveAndExecute(r.approval_id, { actor: { channel: "ui" } });
  assert.equal(ex.status, "done");
  assert.equal(await w.library.get(v.id), null);
  assert.equal(await w.media.size(v.id), null);
  assert.equal((await w.runner.execute(r.approval_id, { actor: { channel: "ui" } })).status, "already_executed");
});

test("silmə: təsdiq mətni real fayl məlumatını göstərir (istifadəçi etiketi yox); olmayan media qeyd açmır; fayl dəyişsə silinmir", async () => {
  const w = world();
  const v = await up(w, buildJpeg(), "image/jpeg", "real-ad.jpg");
  const r = await w.tools.run("media.delete", { media_id: v.id, label: "YALAN ETİKET" }, { permissions: OWNER_PERMISSIONS, approvals: w.approvals });
  const rec = await w.approvals.get(r.approval_id);
  assert.ok(!rec.content.includes("YALAN ETİKET"));
  assert.ok(rec.content.includes("real-ad.jpg") && rec.content.includes(v.id));
  assert.equal((await w.tools.run("media.delete", { media_id: "a".repeat(24) }, { permissions: OWNER_PERMISSIONS, approvals: w.approvals })).status, "invalid_input");
  // təsdiqdən sonra fayl başqası ilə əvəzlənsə (kitabxana qeydi dəyişsə) silinmir
  const doc = await w.library.get(v.id);
  await w.store.putRaw("mediameta:" + v.id, { ...doc, size: doc.size + 5000 });
  const ex = await w.runner.approveAndExecute(r.approval_id, { actor: { channel: "ui" } });
  assert.equal(ex.ok, false);
  assert.equal(ex.error.code, "CONFLICT");
  assert.ok(await w.media.size(v.id), "bayt silinməməlidir");
});

test("saxlama siyasəti: törəmə fayl 14 gündən sonra təmizlənir, sahibin yüklədiyinə toxunulmur", async () => {
  const w = world({ processor: fakeProcessor() });
  const v = await up(w, buildMp4({ width: 640, height: 360 }), "video/mp4");
  const done = await w.jobs.advance((await w.jobs.submitVideoJob({ media_id: v.id, platform: "instagram" })).id);
  assert.equal(done.status, "SUCCESS");
  assert.equal(await w.library.cleanupDerived(), 0);
  w.tick(15 * 86400000);
  assert.equal(await w.library.cleanupDerived(), 1);
  assert.ok(await w.library.get(v.id), "orijinal qalmalıdır");
  assert.equal(await w.library.get(done.result.media_id), null);
});

test("emal müştərisi: qoşulmayıb → AUTH_ERROR; icazəsiz əməliyyat; 401/429/ölçü yoxlaması; təhlükəli ünvan", async () => {
  await assert.rejects(() => createVideoProcessor({}).submit({ input_url: "https://x/y", ops: [] }), (e) => e.code === "AUTH_ERROR");
  const env = { VIDEO_PROCESSOR_URL: "https://vp.example.com", VIDEO_PROCESSOR_TOKEN: "t".repeat(30) };
  const mk = (res) => createVideoProcessor(env, { fetchImpl: async () => res });
  await assert.rejects(() => mk(new Response("{}")).submit({ input_url: "https://x", ops: [{ op: "rm -rf" }] }), (e) => e.code === "VALIDATION_ERROR");
  await assert.rejects(() => mk(new Response("no", { status: 401 })).status("abc"), (e) => e.code === "AUTH_ERROR");
  await assert.rejects(() => mk(new Response("no", { status: 429 })).status("abc"), (e) => e.code === "RATE_LIMIT");
  await assert.rejects(() => mk(new Response("{}", { status: 202 })).submit({ input_url: "https://x", ops: [] }), (e) => e.code === "PROVIDER_ERROR");
  await assert.rejects(() => mk(new Response("x", { status: 200, headers: { "content-length": "999999999" } })).output("abc", { maxBytes: 1000 }), (e) => e.code === "VALIDATION_ERROR");
  await assert.rejects(() => createVideoProcessor({ VIDEO_PROCESSOR_URL: "http://127.0.0.1:9", VIDEO_PROCESSOR_TOKEN: "t" }).status("a"), (e) => e.code === "SECURITY_ERROR");
  const auth = [];
  const p = createVideoProcessor(env, { fetchImpl: async (u, init) => { auth.push(init.headers.authorization); return new Response(JSON.stringify({ id: "abcdefgh1234" }), { status: 202 }); } });
  assert.equal((await p.submit({ input_url: "https://x", ops: [{ op: "trim", max_seconds: 5 }] })).id, "abcdefgh1234");
  assert.equal(auth[0], "Bearer " + "t".repeat(30));
});

// ---- Real ffmpeg + istinad emal serveri (ffmpeg yoxdursa atlanır) ----
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("REAL e2e: istinad emal serveri + ffmpeg üfüqi videonu 9:16 edir, JARVIS nəticəni yenidən analiz edib təsdiqləyir", { skip: !hasFfmpeg && "ffmpeg yoxdur" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "jv-e2e-"));
  const src = join(dir, "in.mp4");
  const gen = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
  assert.equal(gen.status, 0, String(gen.stderr));
  const bytes = new Uint8Array(readFileSync(src));

  process.env.VP_NO_LISTEN = "1";
  process.env.VIDEO_PROCESSOR_TOKEN = "e2e-" + "t".repeat(30);
  process.env.ALLOW_INSECURE_INPUT = "1";
  const { createServer } = await import("../scripts/video-processor/server.mjs?e2e=" + Date.now());
  const vp = createServer();
  await new Promise((r) => vp.listen(0, "127.0.0.1", r));
  const fileSrv = http.createServer((q, s) => { s.writeHead(200, { "content-type": "video/mp4", "content-length": bytes.length }); s.end(Buffer.from(bytes)); });
  await new Promise((r) => fileSrv.listen(0, "127.0.0.1", r));
  try {
    const env = { VIDEO_PROCESSOR_URL: "http://127.0.0.1:" + vp.address().port, VIDEO_PROCESSOR_TOKEN: process.env.VIDEO_PROCESSOR_TOKEN };
    const processor = createVideoProcessor(env, { allowInsecure: true, timeoutMs: 60000 });
    const w = world({ processor });
    w.media.signedUrl = async () => "http://127.0.0.1:" + fileSrv.address().port + "/in.mp4";
    // ingest istifadə edən iş real sleep ilə
    const jobs = createMediaJobs({ store: w.store, coord: w.coord, library: w.library, media: w.media, processor, audit: w.audit, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 300))) });
    const v = await up(w, bytes, "video/mp4");
    assert.equal(v.analysis.width, 640);
    const job = await jobs.submitVideoJob({ media_id: v.id, platform: "instagram" });
    let j = job;
    for (let i = 0; i < 40 && !["SUCCESS", "FAILED"].includes(j.status); i++) j = await jobs.advance(job.id, { deadlineMs: 30000 });
    assert.equal(j.status, "SUCCESS", JSON.stringify(j.error));
    assert.equal(j.result.processed, true);
    assert.deepEqual([j.result.analysis.width, j.result.analysis.height], [720, 1280]);
    assert.equal(j.result.analysis.video.codec, "h264");
    assert.equal(j.result.analysis.faststart, true);
    // ffprobe ilə müstəqil təsdiq
    const out = join(dir, "out.mp4");
    writeFileSync(out, Buffer.from(await w.env.JARVIS_MEDIA._m.get("m/" + j.result.media_id).bytes));
    const pr = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name", "-of", "csv=p=0", out]);
    assert.match(String(pr.stdout), /h264,720,1280/);
    // token olmadan server rədd edir
    const noAuth = await fetch(env.VIDEO_PROCESSOR_URL + "/jobs", { method: "POST", body: "{}" });
    assert.equal(noAuth.status, 401);
  } finally {
    vp.close();
    fileSrv.close();
  }
});
