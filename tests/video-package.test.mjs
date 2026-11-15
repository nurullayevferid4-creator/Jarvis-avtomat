// Video paketi (Video Studio → Instapilot / JARVIS): meta yoxlaması, təsdiqin məzmuna bağlanması, nəticə, JARVIS qaralaması, CLI.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { analyzeMp4, bufferReader } from "../src/media/mp4.js";
import { QA_CHECKS, approve, checkPackage, contentHash, recordResult, toSocialPublish, validateMeta } from "../src/media/videoPackage.js";
import { buildMp4 } from "./fixtures.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const CAPTION = "QR menyu ilə müştəri menyunu telefonda açır. DM-də MENYU yaz.";
const VIDEO = buildMp4({ width: 1080, height: 1920, duration: 20 });
const allQa = () => Object.fromEntries(Object.keys(QA_CHECKS).map((k) => [k, true]));

function meta(over = {}) {
  return {
    version: 1,
    package_id: "2026-11-16-qr-menyu",
    video_sha256: sha(VIDEO),
    caption_sha256: sha(CAPTION),
    targets: [{ platform: "tiktok", account: "@_weemenu_baku" }, { platform: "instagram", account: "@_weemenu_baku" }],
    privacy: "public",
    hashtags: ["qrmenyu", "baku"],
    qa: allQa(),
    status: "pending_approval",
    results: [],
    ...over,
  };
}

async function check(m, { caption = CAPTION, video = VIDEO } = {}) {
  return checkPackage({ meta: m, caption, videoSha256: sha(video), captionSha256: sha(caption), analysis: await analyzeMp4(bufferReader(video)), size: video.length });
}

test("düzgün paket: bloklayıcı yoxdur, təsdiqsiz paylaşıma hazır deyil", async () => {
  const c = await check(meta());
  assert.deepEqual(c.blockers, []);
  assert.equal(c.ok, true);
  assert.equal(c.ready_to_publish, false);
  assert.ok(c.warnings.some((w) => w.includes("TikTok") && w.includes("audit")), "public TikTok üçün audit xəbərdarlığı");
});

test("hesab adı, platforma, QA və status səhvləri bloklayır", () => {
  const v = validateMeta(meta({
    targets: [{ platform: "tiktok", account: "_weemenu_baku" }, { platform: "facebook", account: "@x" }, { platform: "instagram", account: "@a" }, { platform: "instagram", account: "@b" }],
    qa: { ...allQa(), licenses_ok: false },
    status: "approved",
  }));
  const all = v.blockers.join(" | ");
  assert.match(all, /tiktok üçün hesab adı/);
  assert.match(all, /naməlum platforma: facebook/);
  assert.match(all, /instagram iki dəfə/);
  assert.match(all, /QA keçməyib: musiqi, şrift, şəkil lisenziyası/);
  assert.match(all, /approval qeydi yoxdur/);
});

test("YouTube başlıqsız, səhv vaxt, çox hashtag", () => {
  const v = validateMeta(meta({ targets: [{ platform: "youtube", account: "@kanal" }], schedule_at: "2026-11-16 19:00", hashtags: Array.from({ length: 9 }, (_, i) => "h" + i) }));
  assert.ok(v.blockers.some((b) => b.includes("YouTube üçün title")));
  assert.ok(v.blockers.some((b) => b.includes("schedule_at")));
  assert.ok(v.warnings.some((w) => w.includes("5-8 hashtag")));
});

test("məzmun hash-i açar sırasından asılı deyil, məzmun dəyişəndə dəyişir, status/nəticə ona daxil deyil", async () => {
  const m = meta();
  const reordered = Object.fromEntries(Object.entries(m).reverse());
  assert.equal(await contentHash(m), await contentHash(reordered));
  assert.notEqual(await contentHash(m), await contentHash({ ...m, caption_sha256: sha("başqa") }));
  assert.notEqual(await contentHash(m), await contentHash({ ...m, targets: [{ platform: "tiktok", account: "@weecardglobal" }] }));
  assert.equal(await contentHash(m), await contentHash({ ...m, status: "approved", results: [{ platform: "tiktok" }] }));
});

test("təsdiq məzmuna bağlıdır: təsdiqdən sonra caption və ya hesab dəyişərsə bloklanır", async () => {
  const m = meta();
  const approved = approve(m, await check(m), { by: "Fərid", at: "2026-11-16T10:00:00+04:00" });
  assert.equal(approved.status, "approved");
  const ok = await check(approved);
  assert.equal(ok.ready_to_publish, true);
  assert.deepEqual(ok.pending_platforms, ["tiktok", "instagram"]);

  const edited = CAPTION + " yeni iddia";
  const c1 = await check({ ...approved, caption_sha256: sha(edited) }, { caption: edited });
  assert.equal(c1.ready_to_publish, false);
  assert.ok(c1.blockers.some((b) => b.includes("təsdiqdən sonra dəyişib")));

  const c2 = await check({ ...approved, targets: [{ platform: "tiktok", account: "@weecardglobal" }] });
  assert.ok(c2.blockers.some((b) => b.includes("təsdiqdən sonra dəyişib")));

  const c3 = await check(approved, { caption: edited });
  assert.ok(c3.blockers.some((b) => b.includes("caption_sha256 ilə uyğun gəlmir")));
});

test("bloklayıcısı olan və ya artıq təsdiqlənmiş paket təsdiqlənmir", async () => {
  const bad = meta({ qa: {} });
  assert.throws(() => approve(bad, { ok: false }, { by: "Fərid" }), /bloklayıcı/);
  const m = meta();
  const c = await check(m);
  assert.throws(() => approve(m, c, { by: "" }), /Kim təsdiqlədi/);
  const a = approve(m, c, { by: "Fərid" });
  assert.throws(() => approve(a, c, { by: "Fərid" }), /pending_approval/);
});

test("nəticə: linksiz 'published' yoxdur, ümumi status hədəflərə görə, failed avtomatik təkrar olunmur", async () => {
  const m = meta();
  const a = approve(m, await check(m), { by: "Fərid" });
  assert.throws(() => recordResult(m, { platform: "tiktok", status: "published", url: "https://x" }), /təsdiqlənmiş/);
  assert.throws(() => recordResult(a, { platform: "tiktok", status: "published" }), /link və ya post_id/);
  assert.throws(() => recordResult(a, { platform: "youtube", status: "failed" }), /hədəfi deyil/);
  const r1 = recordResult(a, { platform: "tiktok", status: "published", url: "https://www.tiktok.com/@_weemenu_baku/video/1" });
  assert.equal(r1.status, "partial");
  const c1 = await check(r1);
  assert.equal(c1.ready_to_publish, true);
  assert.deepEqual(c1.pending_platforms, ["instagram"]);
  const r2 = recordResult(r1, { platform: "instagram", status: "failed", error: "token_expired" });
  assert.equal(r2.status, "partial");
  const c2 = await check(r2);
  assert.equal(c2.ready_to_publish, false, "failed platforma avtomatik təkrar paylaşılmır");
  const r3 = recordResult(r2, { platform: "instagram", status: "published", post_id: "178" });
  assert.equal(r3.status, "published");
});

test("JARVIS social.publish qaralaması: media_id məcburidir, sahələr düzgün köçürülür", () => {
  const m = meta({ targets: [{ platform: "youtube", account: "@kanal" }], title: "QR menyu", description: "izah" });
  assert.throws(() => toSocialPublish(m, CAPTION, { mediaId: "" }), /media_id/);
  const d = toSocialPublish(m, CAPTION, { mediaId: "0123456789abcdef01234567" });
  assert.deepEqual(d, { platforms: ["youtube"], caption: CAPTION, hashtags: ["qrmenyu", "baku"], media_id: "0123456789abcdef01234567", media_type: "video", privacy: "public", made_for_kids: false, title: "QR menyu", description: "izah" });
});

test("oxunmayan video bloklayır", async () => {
  const junk = new TextEncoder().encode("bu video deyil");
  const c = await checkPackage({ meta: meta({ video_sha256: sha(junk) }), caption: CAPTION, videoSha256: sha(junk), captionSha256: sha(CAPTION), analysis: null, analysisError: "Bu MP4/MOV faylı deyil (ftyp yoxdur)" });
  assert.equal(c.ok, false);
  assert.ok(c.blockers.some((b) => b.startsWith("video oxunmadı")));
});

// CLI: real fayllarla tam dövr (yarat → yoxla → tesdiqle → mətn dəyiş → bloklanır)
const CLI = new URL("../scripts/video-paket.mjs", import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("CLI: yarat → təsdiq gözləyir → tesdiqle → hazır → caption dəyişir → bloklanır", () => {
  const dir = mkdtempSync(join(tmpdir(), "paket-"));
  writeFileSync(join(dir, "video.mp4"), VIDEO);
  writeFileSync(join(dir, "caption.txt"), CAPTION + "\n");

  const noQa = run("yarat", dir, "--hedef", "tiktok:@_weemenu_baku", "--paket-id", "qa-yoxdur");
  assert.equal(noQa.status, 2, noQa.stdout + noQa.stderr);
  assert.match(noQa.stdout, /QA keçməyib/);

  const again = run("yarat", dir, "--hedef", "tiktok:@_weemenu_baku", "--paket-id", "qa-yoxdur");
  assert.equal(again.status, 1);
  assert.match(again.stderr, /--yenile/);

  const made = run("yarat", dir, "--yenile", "--hedef", "tiktok:@_weemenu_baku,instagram:@_weemenu_baku", "--paket-id", "2026-11-16-qr-menyu", "--hashtag", "#qrmenyu,baku", "--qa-kecdi", "hamisi");
  assert.equal(made.status, 0, made.stdout + made.stderr);
  assert.match(made.stdout, /PAYLAŞIMA HAZIR: xeyr \(Fərid-in təsdiqi gözlənilir\)/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).hashtags, ["qrmenyu", "baku"]);

  assert.equal(run("tesdiqle", dir).status, 1, "--kim olmadan təsdiq yoxdur");
  const ok = run("tesdiqle", dir, "--kim", "Fərid");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /PAYLAŞIMA HAZIR: bəli → tiktok, instagram/);

  const res = run("netice", dir, "--platforma", "tiktok", "--status", "published", "--link", "https://www.tiktok.com/@_weemenu_baku/video/1");
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /PAYLAŞIMA HAZIR: bəli → instagram/);

  const json = JSON.parse(run("yoxla", dir, "--json").stdout);
  assert.equal(json.status, "partial");
  assert.equal(json.analysis.width, 1080);

  appendFileSync(join(dir, "caption.txt"), "təsdiqsiz əlavə\n");
  const blocked = run("yoxla", dir);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stdout, /caption_sha256 ilə uyğun gəlmir/);
  assert.equal(run("netice", dir, "--platforma", "instagram", "--status", "published", "--post-id", "1").status, 2, "dəyişmiş paketə nəticə yazılmır");
});

test("CLI: real ffmpeg videosu (varsa) analiz olunur və 9:16 xəbərdarlığı vermir", (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg yoxdur");
  const dir = mkdtempSync(join(tmpdir(), "paket-ff-"));
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=1080x1920:d=2:r=30", "-f", "lavfi", "-i", "sine=f=440:d=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", join(dir, "video.mp4")]);
  assert.equal(r.status, 0, String(r.stderr));
  writeFileSync(join(dir, "caption.txt"), CAPTION);
  const made = run("yarat", dir, "--hedef", "instagram:@_weemenu_baku", "--paket-id", "ffmpeg-real", "--qa-kecdi", "hamisi");
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const json = JSON.parse(run("yoxla", dir, "--json").stdout);
  assert.equal(json.analysis.video.codec, "h264");
  assert.equal(json.analysis.audio.codec, "aac");
  assert.equal(json.analysis.faststart, true);
  assert.ok(!json.warnings.some((w) => w.includes("en/boy")), json.warnings.join("; "));
});
