#!/usr/bin/env node
// Video paketi aləti (docs/VIDEO-PAKET.md). Asılılıqsızdır, şəbəkəyə çıxmır, heç nə paylaşmır.
//   yarat    <qovluq> --hedef tiktok:@ad,instagram:@ad --paket-id ad [--privacy private|unlisted|public]
//            [--hashtag a,b] [--title ..] [--description ..] [--vaxt ISO] [--ai] [--qa-kecdi hamisi|k1,k2] [--yenile]
//   yoxla    <qovluq> [--json]
//   tesdiqle <qovluq> --kim "Fərid"            (yalnız Fərid söhbətdə açıq "bəli" yazandan sonra)
//   netice   <qovluq> --platforma tiktok --status published|failed|unknown [--link URL] [--post-id ID] [--xeta mətn]
//   jarvis   <qovluq> --media-id <24 hex>       (JARVIS POST /api/social/draft gövdəsi; paylaşmır)
// Çıxış kodu: 0 uğur, 1 istifadə xətası, 2 paketdə bloklayıcı var.
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { analyzeMp4 } from "../src/media/mp4.js";
import { PACKAGE_FILES, PACKAGE_VERSION, QA_CHECKS, approve, checkPackage, recordResult, toSocialPublish } from "../src/media/videoPackage.js";

function parseArgs(argv) {
  const [cmd, dir, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw usage("gözlənilməz arqument: " + a);
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else { flags[key] = next; i++; }
  }
  return { cmd, dir, flags };
}

class UsageError extends Error {}
const usage = (m) => new UsageError(m);

function fileSha256(path) {
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { closeSync(fd); }
  return h.digest("hex");
}

function fileReader(path) {
  const size = statSync(path).size;
  return {
    size,
    read: async (offset, length) => {
      const fd = openSync(path, "r");
      try {
        const buf = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
        readSync(fd, buf, 0, buf.length, offset);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
      } finally { closeSync(fd); }
    },
  };
}

function paths(dir) {
  if (!dir) throw usage("paket qovluğu yazılmayıb");
  const root = resolve(dir);
  return { root, video: join(root, PACKAGE_FILES.video), caption: join(root, PACKAGE_FILES.caption), meta: join(root, PACKAGE_FILES.meta) };
}

function readMeta(p) {
  if (!existsSync(p.meta)) throw usage("meta.json yoxdur: əvvəl 'yarat' işlət");
  try { return JSON.parse(readFileSync(p.meta, "utf8")); } catch { throw usage("meta.json oxunmadı (JSON səhvdir)"); }
}

const writeMeta = (p, meta) => writeFileSync(p.meta, JSON.stringify(meta, null, 2) + "\n");

async function inspect(p, meta) {
  const missing = [PACKAGE_FILES.video, PACKAGE_FILES.caption].filter((f) => !existsSync(join(p.root, f)));
  if (missing.length) throw usage("paketdə fayl yoxdur: " + missing.join(", "));
  const pieces = await inspectPieces(p);
  const check = await checkPackage({ ...pieces, meta });
  return { caption: pieces.caption, analysis: pieces.analysis, check };
}

async function inspectPieces(p) {
  const caption = readFileSync(p.caption, "utf8");
  let analysis = null;
  let analysisError = null;
  try { analysis = await analyzeMp4(fileReader(p.video)); } catch (e) { analysisError = e.message; }
  return { caption, analysis, analysisError, videoSha256: fileSha256(p.video), captionSha256: sha256Text(caption), size: statSync(p.video).size };
}

const sha256Text = (t) => createHash("sha256").update(t, "utf8").digest("hex");

function list(flag) {
  if (flag === undefined || flag === true) return [];
  return String(flag).split(",").map((s) => s.trim()).filter(Boolean);
}

async function cmdYarat(p, f) {
  if (existsSync(p.meta) && !f.yenile) throw usage("meta.json artıq var. Yenidən yaratmaq köhnə təsdiqi silir: --yenile əlavə et");
  for (const k of ["video", "caption"]) if (!existsSync(p[k])) throw usage("paketdə " + PACKAGE_FILES[k] + " yoxdur");
  const targets = list(f.hedef).map((t) => {
    const i = t.indexOf(":");
    if (i < 1) throw usage("--hedef platforma:@hesab şəklindədir, məs. tiktok:@_weemenu_baku");
    return { platform: t.slice(0, i).trim(), account: t.slice(i + 1).trim() };
  });
  const passed = f["qa-kecdi"] === "hamisi" ? Object.keys(QA_CHECKS) : list(f["qa-kecdi"]);
  const unknown = passed.filter((k) => !(k in QA_CHECKS));
  if (unknown.length) throw usage("naməlum QA bəndi: " + unknown.join(", ") + ". Bəndlər: " + Object.keys(QA_CHECKS).join(", "));
  const meta = {
    version: PACKAGE_VERSION,
    package_id: typeof f["paket-id"] === "string" ? f["paket-id"] : "",
    source: "claude-ai-video-studio",
    video_sha256: fileSha256(p.video),
    caption_sha256: sha256Text(readFileSync(p.caption, "utf8")),
    targets,
    privacy: typeof f.privacy === "string" ? f.privacy : "private",
    title: typeof f.title === "string" ? f.title : "",
    description: typeof f.description === "string" ? f.description : "",
    hashtags: list(f.hashtag).map((h) => h.replace(/^#/, "")),
    schedule_at: typeof f.vaxt === "string" ? f.vaxt : null,
    made_for_kids: false,
    ai_generated: f.ai === true,
    qa: Object.fromEntries(Object.keys(QA_CHECKS).map((k) => [k, passed.includes(k)])),
    status: "pending_approval",
    results: [],
  };
  writeMeta(p, meta);
  const { check, analysis } = await inspect(p, meta);
  report(meta, check, analysis);
  return check.ok ? 0 : 2;
}

function report(meta, check, analysis) {
  const out = [];
  out.push("Paket: " + (meta.package_id || "(adsız)") + " | status: " + meta.status);
  out.push("Hədəflər: " + ((meta.targets || []).map((t) => t.platform + " " + t.account).join(", ") || "yoxdur"));
  if (analysis) out.push("Video: " + analysis.width + "x" + analysis.height + ", " + analysis.duration_s + " san, " + analysis.video.codec + "/" + (analysis.audio ? analysis.audio.codec : "səssiz") + ", " + (analysis.size / 1048576).toFixed(1) + " MB");
  out.push("Bloklayıcılar: " + (check.blockers.length ? "\n  - " + check.blockers.join("\n  - ") : "yoxdur"));
  out.push("Xəbərdarlıqlar: " + (check.warnings.length ? "\n  - " + check.warnings.join("\n  - ") : "yoxdur"));
  if (Array.isArray(meta.results) && meta.results.length) out.push("Nəticələr: " + meta.results.map((r) => r.platform + "=" + r.status + (r.url ? " " + r.url : "")).join(", "));
  const why = !check.ok ? "bloklayıcı var" : meta.status === "pending_approval" ? "Fərid-in təsdiqi gözlənilir" : "bütün hədəflərin nəticəsi yazılıb, status " + meta.status;
  out.push("PAYLAŞIMA HAZIR: " + (check.ready_to_publish ? "bəli → " + check.pending_platforms.join(", ") : "xeyr (" + why + ")"));
  console.log(out.join("\n"));
}

async function main(argv) {
  const { cmd, dir, flags } = parseArgs(argv);
  if (!cmd || cmd === "help" || cmd === "--help") throw usage("əmrlər: yarat, yoxla, tesdiqle, netice, jarvis");
  const p = paths(dir);
  if (cmd === "yarat") return await cmdYarat(p, flags);
  const meta = readMeta(p);
  const { caption, analysis, check } = await inspect(p, meta);
  if (cmd === "yoxla") {
    if (flags.json) console.log(JSON.stringify({ package_id: meta.package_id, status: meta.status, ...check, analysis }, null, 2));
    else report(meta, check, analysis);
    return check.ok ? 0 : 2;
  }
  if (cmd === "tesdiqle") {
    if (typeof flags.kim !== "string") throw usage("--kim yazılmalıdır, məs. --kim \"Fərid\"");
    if (!check.ok) { report(meta, check, analysis); return 2; }
    const next = approve(meta, check, { by: flags.kim });
    writeMeta(p, next);
    report(next, (await inspect(p, next)).check, analysis);
    return 0;
  }
  if (cmd === "netice") {
    if (!check.ok) { report(meta, check, analysis); return 2; }
    const next = recordResult(meta, {
      platform: flags.platforma,
      status: flags.status,
      url: typeof flags.link === "string" ? flags.link : null,
      post_id: typeof flags["post-id"] === "string" ? flags["post-id"] : null,
      error: typeof flags.xeta === "string" ? flags.xeta : null,
    });
    writeMeta(p, next);
    report(next, (await inspect(p, next)).check, analysis);
    return 0;
  }
  if (cmd === "jarvis") {
    if (!check.ok) { report(meta, check, analysis); return 2; }
    console.log(JSON.stringify(toSocialPublish(meta, caption, { mediaId: flags["media-id"] }), null, 2));
    return 0;
  }
  throw usage("naməlum əmr: " + cmd);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error((e instanceof UsageError ? "İstifadə xətası: " : "Xəta: ") + e.message);
    process.exit(1);
  },
);
