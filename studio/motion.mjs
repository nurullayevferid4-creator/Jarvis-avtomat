// Motion qrafika: HTML/CSS/SVG səhifəsini kadr-kadr PNG-yə çəkib ffmpeg ilə videoya yığır (deterministik).
// Səhifə `window.seek(t)` funksiyası verməlidir: t saniyədə səhnəni çəkir (Promise qaytara bilər).
// seek yoxdursa CSS animasiyaları `document.getAnimations()` ilə həmin ana gətirilir.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_FPS, probe } from "./lib.mjs";

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req("playwright"); } catch { /* yerli yoxdur */ }
  for (const p of (process.env.NODE_PATH || "").split(":").filter(Boolean)) {
    try { return createRequire(p + "/")("playwright"); } catch { /* növbəti */ }
  }
  throw new Error("Playwright tapılmadı: motion render üçün Chromium + Playwright lazımdır");
}

export async function renderMotion(page, output, { duration, fps = DEFAULT_FPS, width = 1080, height = 1920, audio = null, crf = 18 } = {}) {
  if (!(duration > 0)) throw new Error("--duration (saniyə) lazımdır");
  const frames = Math.round(duration * fps);
  if (frames > 30 * 180) throw new Error("Çox uzun: motion render ən çox 180 saniyədir");
  const { chromium } = loadPlaywright();
  await mkdir(dirname(resolve(output)), { recursive: true });

  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "pipe:0"];
  if (audio) args.push("-i", resolve(audio));
  args.push("-map", "0:v");
  if (audio) args.push("-map", "1:a", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2");
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-r", String(fps), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", String(duration), resolve(output));
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  ff.stderr.on("data", (d) => { err += d; });
  const done = new Promise((res, rej) => { ff.on("error", rej); ff.on("close", (code) => (code === 0 ? res() : rej(new Error("ffmpeg xətası: " + err.split("\n").filter(Boolean).slice(-5).join("\n"))))); });
  ff.stdin.on("error", () => { /* ffmpeg erkən bağlanıbsa xəta `done`-dan gələcək */ });

  const browser = await chromium.launch();
  let hasSeek = false;
  try {
    const pg = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await pg.goto(/^[a-z]+:\/\//i.test(page) ? page : pathToFileURL(resolve(page)).href, { waitUntil: "load" });
    await pg.evaluate(() => document.fonts && document.fonts.ready);
    hasSeek = await pg.evaluate(() => typeof window.seek === "function");
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      await pg.evaluate(async (tt) => {
        if (typeof window.seek === "function") await window.seek(tt);
        else for (const a of document.getAnimations()) { a.pause(); a.currentTime = tt * 1000; }
      }, t);
      const png = await pg.screenshot({ type: "png" });
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    }
  } finally {
    await browser.close();
    ff.stdin.end();
  }
  await done;
  const info = await probe(output);
  return { output: resolve(output), frames, seek: hasSeek ? "window.seek" : "css-animations", info };
}
