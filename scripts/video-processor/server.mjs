// JARVIS video emal xidməti (istinad tətbiqi). Sahibin öz serverində işləyir (Node 20+ və ffmpeg lazımdır).
// Cloudflare Worker ffmpeg işlədə bilmir, buna görə redaktə (kəsmə, 9:16, H.264/AAC, faststart) burada edilir.
//
//   VIDEO_PROCESSOR_TOKEN=<uzun təsadüfi mətn> PORT=8787 node scripts/video-processor/server.mjs
//
// Təhlükəsizlik: Bearer token məcburidir; yalnız https giriş ünvanı (test üçün ALLOW_INSECURE_INPUT=1);
// özəl/loopback ünvanlara getmir; ffmpeg shell olmadan, yalnız icazəli əməliyyatlardan qurulan arqumentlərlə işləyir;
// giriş ölçüsü və vaxt limiti var; müvəqqəti fayllar iş bitəndə silinir.

import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const TOKEN = process.env.VIDEO_PROCESSOR_TOKEN || "";
const MAX_INPUT = Number(process.env.MAX_INPUT_BYTES || 64 * 1024 * 1024);
const MAX_OUTPUT = Number(process.env.MAX_OUTPUT_BYTES || 64 * 1024 * 1024);
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 300000);
const KEEP_MS = 3600000;
const jobs = new Map();

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("::ffff:");
}

async function checkInputUrl(raw) {
  const u = new URL(raw);
  if (process.env.ALLOW_INSECURE_INPUT === "1") return u; // yalnız lokal test
  if (u.protocol !== "https:" || u.username || u.password) throw new Error("giriş ünvanı https olmalıdır");
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("giriş ünvanı özəl şəbəkəyə işarə edir");
  return u;
}

export function buildFfmpegArgs(ops, input, output) {
  const set = new Map();
  for (const o of ops) set.set(o.op, o);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", input];
  const trim = set.get("trim");
  if (trim) args.push("-t", String(Math.max(1, Math.min(3600, Number(trim.max_seconds) || 60))));
  const reframe = set.has("reframe");
  if (reframe) args.push("-vf", "crop=w='if(gt(iw/ih,9/16),ih*9/16,iw)':h='if(gt(iw/ih,9/16),ih,iw*16/9)',scale=720:1280:flags=lanczos,setsar=1");
  const reencodeVideo = reframe || set.has("transcode");
  if (reencodeVideo) args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23");
  else args.push("-c:v", "copy");
  // kəsmə video kopyalanarkən dəqiq olmur: kəsmə varsa səsi də yenidən kodlayırıq
  if (set.has("transcode_audio") || reencodeVideo || trim) args.push("-c:a", "aac", "-b:a", "128k");
  else args.push("-c:a", "copy");
  args.push("-movflags", "+faststart", "-f", "mp4", output);
  return args;
}

async function runJob(job) {
  job.status = "running";
  const dir = await mkdtemp(join(tmpdir(), "jarvis-vp-"));
  job.dir = dir;
  try {
    const u = await checkInputUrl(job.input_url);
    const res = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(120000) });
    if (!res.ok || !res.body) throw new Error("giriş faylı alınmadı (" + res.status + ")");
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_INPUT) throw new Error("giriş faylı çox böyükdür");
    const inPath = join(dir, "in");
    let got = 0;
    const counter = new (await import("node:stream")).Transform({ transform(chunk, _e, cb) { got += chunk.length; cb(got > MAX_INPUT ? new Error("giriş faylı çox böyükdür") : null, chunk); } });
    await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(inPath));
    const outPath = join(dir, "out.mp4");
    await new Promise((resolve, reject) => {
      const p = spawn("ffmpeg", buildFfmpegArgs(job.ops, inPath, outPath), { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => { err = (err + d).slice(-400); });
      const t = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("ffmpeg vaxt limiti")); }, FFMPEG_TIMEOUT_MS);
      p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error("ffmpeg xətası: " + err.replace(/\s+/g, " ").slice(0, 160))); });
      p.on("error", (e) => { clearTimeout(t); reject(e); });
    });
    const st = await stat(outPath);
    if (st.size > MAX_OUTPUT) throw new Error("nəticə çox böyükdür");
    job.out = outPath;
    job.size = st.size;
    job.status = "done";
  } catch (e) {
    job.status = "failed";
    job.error = String((e && e.message) || e).slice(0, 200);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  setTimeout(() => { jobs.delete(job.id); rm(dir, { recursive: true, force: true }).catch(() => {}); }, KEEP_MS).unref();
}

function authed(req) {
  const h = String(req.headers.authorization || "");
  if (!TOKEN || !h.startsWith("Bearer ")) return false;
  const a = Buffer.from(h.slice(7));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ALLOWED = new Set(["trim", "reframe", "transcode", "transcode_audio", "remux", "faststart"]);

export function createServer() {
  return http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (!authed(req)) return send(401, { error: "unauthorized" });
    const url = new URL(req.url, "http://x");
    try {
      if (req.method === "POST" && url.pathname === "/jobs") {
        if (jobs.size >= 20) return send(429, { error: "busy" });
        let body = "";
        for await (const c of req) { body += c; if (body.length > 20000) return send(413, { error: "too large" }); }
        const j = JSON.parse(body);
        if (typeof j.input_url !== "string" || !Array.isArray(j.ops) || j.ops.length > 8 || !j.ops.every((o) => o && ALLOWED.has(o.op))) return send(400, { error: "bad request" });
        const job = { id: randomUUID(), input_url: j.input_url, ops: j.ops, status: "queued" };
        jobs.set(job.id, job);
        runJob(job);
        return send(202, { id: job.id });
      }
      const m = /^\/jobs\/([0-9a-f-]{36})(\/output)?$/.exec(url.pathname);
      if (req.method === "GET" && m) {
        const job = jobs.get(m[1]);
        if (!job) return send(404, { error: "not found" });
        if (!m[2]) return send(200, { status: job.status, error: job.error || null });
        if (job.status !== "done") return send(409, { error: "not ready" });
        res.writeHead(200, { "content-type": "video/mp4", "content-length": String(job.size) });
        return createReadStream(job.out).pipe(res);
      }
      return send(404, { error: "not found" });
    } catch (e) {
      return send(500, { error: "internal" });
    }
  });
}

if (process.argv[1] && process.argv[1].endsWith("server.mjs") && !process.env.VP_NO_LISTEN) {
  if (!TOKEN || TOKEN.length < 24) {
    console.error("VIDEO_PROCESSOR_TOKEN təyin edilməyib və ya 24 simvoldan qısadır. Çıxıram.");
    process.exit(1);
  }
  createServer().listen(Number(process.env.PORT || 8787), process.env.HOST || "0.0.0.0", () => console.log("video-processor hazırdır"));
}
