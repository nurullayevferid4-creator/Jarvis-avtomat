// Video studiya mühərriki: montaj, subtitr, səssizlik kəsmə, 9:16, dublaj miksi, reklam elementləri, loudnorm.
// Hər şey yerli ffmpeg/ffprobe ilə işləyir (shell yoxdur, arqumentlər massivlə verilir). Xarici API çağırılmır, pul xərclənmir.
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { RECOMMENDED } from "../src/media/rules.js";

// ---------- Platforma presetləri ----------
// Ölçülər ümumi qəbul olunmuş standartlardır. Müddət həddləri src/media/rules.js-dən gəlir və rəsmi sənədlə TƏSDİQLƏNMƏYİB.
export const PRESETS = {
  reels: { w: 1080, h: 1920, label: "Instagram Reels (9:16)", rec: "instagram", vertical: true },
  tiktok: { w: 1080, h: 1920, label: "TikTok (9:16)", rec: "tiktok", vertical: true },
  shorts: { w: 1080, h: 1920, label: "YouTube Shorts (9:16)", rec: "youtube", vertical: true },
  feed: { w: 1080, h: 1350, label: "Instagram/Facebook lent (4:5)", rec: null, vertical: false },
  square: { w: 1080, h: 1080, label: "Kvadrat (1:1)", rec: null, vertical: false },
  youtube: { w: 1920, h: 1080, label: "YouTube / üfüqi (16:9)", rec: null, vertical: false },
};
// 9:16-da platforma interfeysinin örtdüyü sahələr (px): mətn buraya qoyulmur.
export const SAFE = { top: 250, bottom: 350 };

export function presetOrThrow(name) {
  const p = PRESETS[name];
  if (!p) throw new Error("Naməlum preset: " + name + ". Mövcud: " + Object.keys(PRESETS).join(", "));
  return p;
}

// ---------- Proses ----------
export function run(cmd, args, { cwd, timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(cmd + " xətası: " + String(stderr || err.message).split("\n").filter(Boolean).slice(-10).join("\n"));
        e.stderr = stderr;
        return rej(e);
      }
      res({ stdout, stderr });
    });
  });
}
const FF = ["-nostdin", "-hide_banner", "-y"];

export async function doctor() {
  const out = { ok: true, checks: [] };
  const add = (name, ok, detail) => { out.checks.push({ name, ok, detail }); if (!ok) out.ok = false; };
  try { const r = await run("ffmpeg", ["-version"]); add("ffmpeg", true, r.stdout.split("\n")[0]); } catch (e) { add("ffmpeg", false, "tapılmadı"); }
  try { await run("ffprobe", ["-version"]); add("ffprobe", true, "var"); } catch (e) { add("ffprobe", false, "tapılmadı"); }
  try {
    const f = (await run("ffmpeg", ["-hide_banner", "-filters"])).stdout;
    for (const n of ["ass", "silencedetect", "loudnorm", "sidechaincompress", "overlay", "boxblur", "select", "aselect", "thumbnail"]) add("filtr:" + n, new RegExp("\\s" + n + "\\s").test(f), "");
  } catch (e) { add("filtrlər", false, e.message); }
  try {
    const fc = (await run("fc-list", [":family"])).stdout;
    add("şrift DejaVu Sans (ə ş ç ğ ı ö ü)", /DejaVu Sans/.test(fc), "");
  } catch (e) { add("şrift DejaVu Sans (ə ş ç ğ ı ö ü)", false, "fc-list yoxdur"); }
  return out;
}

// ---------- Probe ----------
export async function probe(file) {
  const r = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  const a = (j.streams || []).find((s) => s.codec_type === "audio");
  if (!v) throw new Error("Faylda video trek yoxdur: " + file);
  let w = v.width, h = v.height;
  const rotSide = (v.side_data_list || []).find((x) => x.rotation !== undefined);
  const rot = Math.abs(Number(rotSide ? rotSide.rotation : (v.tags && v.tags.rotate) || 0)) % 180;
  if (rot === 90) [w, h] = [h, w]; // ffmpeg avtomatik fırladır
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || "30/1").split("/").map(Number);
  const fps = d ? n / d : 30;
  const duration = Number((j.format && j.format.duration) || v.duration || 0);
  return { width: w, height: h, aspect: w / h, fps: fps > 0 && isFinite(fps) ? fps : 30, duration, hasAudio: !!a, vcodec: v.codec_name, acodec: a ? a.codec_name : null, size: Number((j.format && j.format.size) || 0) };
}

// ---------- Mətn və subtitr ----------
export function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return p(Math.floor(ms / 3600000)) + ":" + p(Math.floor(ms / 60000) % 60) + ":" + p(Math.floor(ms / 1000) % 60) + "," + p(ms % 1000, 3);
}
export function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return Math.floor(cs / 360000) + ":" + p(Math.floor(cs / 6000) % 60) + ":" + p(Math.floor(cs / 100) % 60) + "." + p(cs % 100);
}

export function wrapLines(text, maxChars) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Transkript → sözlər [{text,start,end}] (saniyə). Dəstəklənir:
//  - words[] (ElevenLabs Scribe formatı: text,start,end,type)
//  - segments[] / utterances[] ({start,end,text} və ya {startMs,endMs,text}, Pollo speech2text kimi)
export function normalizeTranscript(json) {
  if (json && Array.isArray(json.words)) {
    return json.words
      .filter((w) => w && w.type !== "spacing" && w.type !== "audio_event" && typeof w.text === "string" && w.text.trim() && isFinite(w.start) && isFinite(w.end))
      .map((w) => ({ text: w.text.trim(), start: Number(w.start), end: Number(w.end) }));
  }
  const segs = Array.isArray(json) ? json : (json && (json.segments || json.utterances || (json.transcription && json.transcription.utterances))) || null;
  if (!segs) throw new Error("Transkript formatı tanınmadı (words[], segments[] və ya utterances[] gözlənilir)");
  const out = [];
  for (const s of segs) {
    const start = s.start !== undefined ? Number(s.start) : Number(s.startMs) / 1000;
    const end = s.end !== undefined ? Number(s.end) : Number(s.endMs) / 1000;
    const words = String(s.text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length || !isFinite(start) || !isFinite(end) || end <= start) continue;
    const total = words.reduce((n, w) => n + w.length, 0) || 1;
    let t = start;
    for (const w of words) { const dur = ((end - start) * w.length) / total; out.push({ text: w, start: t, end: t + dur }); t += dur; }
  }
  return out;
}

// Sözləri subtitr cümlələrinə (cue) qruplaşdırır: sətir limiti, ən çox 2 sətir, ≤ maxDur san, boşluqda və cümlə sonunda bölür.
export function groupWords(words, { maxChars = 28, maxLines = 2, maxDur = 3, gap = 0.7, minDur = 0.8 } = {}) {
  const cues = [];
  let cur = null;
  const flush = () => {
    if (cur) cues.push({ start: cur.start, end: cur.end, text: wrapLines(cur.words.join(" "), maxChars).join("\n") });
    cur = null;
  };
  for (const w of words) {
    const t = String(w.text).trim();
    if (!t) continue;
    if (cur && (wrapLines(cur.words.concat(t).join(" "), maxChars).length > maxLines || w.end - cur.start > maxDur || w.start - cur.end > gap)) flush();
    if (!cur) cur = { start: w.start, end: w.end, words: [] };
    cur.words.push(t);
    cur.end = w.end;
    if (/[.!?…]$/.test(t)) flush();
  }
  flush();
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (cues[i].end - cues[i].start < minDur) cues[i].end = Math.min(cues[i].start + minDur, next ? next.start : Infinity);
  }
  return cues;
}

export function cuesToSrt(cues) {
  return cues.map((c, i) => (i + 1) + "\n" + srtTime(c.start) + " --> " + srtTime(c.end) + "\n" + c.text + "\n").join("\n");
}
export function parseSrt(text) {
  const cues = [];
  for (const block of String(text).replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const m = lines[ti].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) continue;
    const tt = (h, mi, s, ms) => Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms.padEnd(3, "0").slice(0, 3)) / 1000;
    cues.push({ start: tt(m[1], m[2], m[3], m[4]), end: tt(m[5], m[6], m[7], m[8]), text: lines.slice(ti + 1).join("\n") });
  }
  return cues;
}

// ---------- Səssizlik kəsmə ----------
export function parseSilence(stderr, duration) {
  const out = [];
  let start = null;
  for (const line of String(stderr).split("\n")) {
    let m = line.match(/silence_start: (-?[\d.]+)/);
    if (m) { start = Math.max(0, parseFloat(m[1])); continue; }
    m = line.match(/silence_end: (-?[\d.]+)/);
    if (m && start !== null) { out.push({ start, end: parseFloat(m[1]) }); start = null; }
  }
  if (start !== null) out.push({ start, end: duration });
  return out;
}
// Səssiz aralıqları çıxarıb saxlanacaq hissələri [a,b] qaytarır. pad: kəsik yerlərində nəfəs payı.
export function keepSegments(silences, duration, { pad = 0.12, minKeep = 0.25 } = {}) {
  const raw = [];
  let pos = 0;
  for (const s of silences) {
    const end = Math.min(duration, s.start + pad);
    if (end > pos) raw.push([pos, end]);
    pos = Math.max(pos, s.end - pad);
  }
  if (pos < duration) raw.push([pos, duration]);
  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 0.01) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged.filter(([a, b]) => b - a >= minKeep).map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
}
export const keptDuration = (keep) => keep.reduce((n, [a, b]) => n + (b - a), 0);

// Orijinal zaman → kəsilmiş videonun zamanı (subtitr sinxronu üçün vacibdir)
export function mapTime(t, keep) {
  let acc = 0;
  for (const [a, b] of keep) {
    if (t < a) return acc;
    if (t <= b) return acc + (t - a);
    acc += b - a;
  }
  return acc;
}
export function remapCues(cues, keep) {
  return cues.map((c) => ({ ...c, start: mapTime(c.start, keep), end: mapTime(c.end, keep) })).filter((c) => c.end - c.start >= 0.1);
}

// ---------- ASS (subtitr + hook + CTA bir faylda) ----------
const esc = (t) => String(t).replace(/[{}]/g, "").replace(/\r/g, "").replace(/\n/g, "\\N");

export function captionLayout(preset) {
  const fs = preset.vertical ? Math.round(preset.w * 0.05) : Math.round(Math.min(preset.w, preset.h * 1.78) * 0.045);
  const margin = Math.round(preset.w * 0.055);
  const maxChars = Math.max(14, Math.min(42, Math.floor((preset.w - 2 * margin) / (0.6 * fs))));
  const marginV = preset.vertical ? SAFE.bottom + 20 : Math.round(preset.h * 0.06);
  return { fs, margin, maxChars, marginV };
}

export function buildAss({ preset, cues = [], hook, cta, outDur, hookSec = 3, ctaSec = 4 }) {
  // Qısa videoda hook/CTA bütün müddəti tutmasın: hər biri ən çox müddətin 35%-i
  hookSec = Math.min(hookSec, outDur * 0.35);
  ctaSec = Math.min(ctaSec, outDur * 0.35);
  const lay = captionLayout(preset);
  const topV = preset.vertical ? SAFE.top + 20 : Math.round(preset.h * 0.06);
  const hookFs = Math.round(lay.fs * 1.3);
  const ctaV = preset.vertical ? SAFE.bottom + 170 : lay.marginV + lay.fs * 3;
  const font = "DejaVu Sans";
  const head = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: " + preset.w, "PlayResY: " + preset.h, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Sub,${font},${lay.fs},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,1,2,${lay.margin},${lay.margin},${lay.marginV},1`,
    `Style: Hook,${font},${hookFs},&H0000F0FF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,5,2,8,${lay.margin},${lay.margin},${topV},1`,
    `Style: Cta,${font},${Math.round(lay.fs * 1.05)},&H00FFFFFF,&H000000FF,&H000050E6,&H000050E6,-1,0,0,0,100,100,0,0,3,14,0,2,${lay.margin},${lay.margin},${ctaV},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const ev = [];
  for (const c of cues) ev.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,${esc(c.text)}`);
  if (hook) {
    const t = wrapLines(hook, Math.max(10, Math.floor((preset.w - 2 * lay.margin) / (0.6 * hookFs)))).join("\n");
    ev.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(hookSec, outDur))},Hook,,0,0,0,,${esc(t)}`);
  }
  if (cta) {
    const t = wrapLines(cta, Math.max(10, Math.floor((preset.w - 2 * lay.margin) / (0.62 * lay.fs * 1.05)))).join("\n");
    ev.push(`Dialogue: 1,${assTime(Math.max(0, outDur - ctaSec))},${assTime(outDur)},Cta,,0,0,0,,${esc(t)}`);
  }
  return head.concat(ev).join("\n") + "\n";
}

// ---------- Filtr qrafları ----------
const f3 = (n) => (Math.round(n * 1000) / 1000).toString();

export function buildVideoGraph({ preset, fit, info, keep, hasAss, logoIdx }) {
  const { w, h } = preset;
  const fps = Math.max(1, Math.min(30, Math.round(info.fps || 30)));
  const parts = [];
  let cur = "0:v";
  let n = 0;
  const next = () => "v" + ++n;
  const chain = (inLabel, filters) => { const o = next(); parts.push(`[${inLabel}]${filters}[${o}]`); return o; };

  let pre = `fps=${fps}`;
  if (keep) pre += `,select='${keep.map(([a, b]) => `between(t,${f3(a)},${f3(b)})`).join("+")}',setpts=N/FRAME_RATE/TB`;
  cur = chain(cur, pre);

  const sameAspect = Math.abs(info.aspect - w / h) < 0.02;
  const mode = fit === "auto" || !fit ? (sameAspect ? "scale" : "blur") : fit;
  if (mode === "scale" || mode === "crop") {
    cur = chain(cur, mode === "scale" ? `scale=${w}:${h}` : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`);
  } else if (mode === "pad") {
    cur = chain(cur, `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`);
  } else if (mode === "blur") {
    const a = next(), b = next(), bg = next(), fg = next(), o = next();
    parts.push(`[${cur}]split=2[${a}][${b}]`);
    parts.push(`[${a}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=30:3[${bg}]`);
    parts.push(`[${b}]scale=${w}:${h}:force_original_aspect_ratio=decrease[${fg}]`);
    parts.push(`[${bg}][${fg}]overlay=(W-w)/2:(H-h)/2[${o}]`);
    cur = o;
  } else throw new Error("Naməlum fit: " + mode + " (auto, blur, crop, pad, scale)");

  if (logoIdx !== undefined) {
    const lg = next(), o = next();
    const top = preset.vertical ? SAFE.top + 20 : Math.round(h * 0.04);
    parts.push(`[${logoIdx}:v]scale=${Math.round(w * 0.17)}:-1[${lg}]`);
    parts.push(`[${cur}][${lg}]overlay=W-w-${Math.round(w * 0.04)}:${top}[${o}]`);
    cur = o;
  }
  if (hasAss) cur = chain(cur, "ass=studio.ass");
  parts.push(`[${cur}]format=yuv420p,setsar=1[vout]`);
  return parts.join(";");
}

// Səs qrafı. Qaytarır { graph, label } — label loudnorm-dan əvvəlki son çıxışdır; səs yoxdursa null.
export function buildAudioGraph({ info, keep, dubIdx, musicIdx, muteOriginal, originalVol = 0.22, musicVol = 0.12, outDur }) {
  const parts = [];
  const fmt = "aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000";
  let voice = null;
  if (info.hasAudio && !(dubIdx !== undefined && muteOriginal)) {
    const sel = keep ? `aselect='${keep.map(([a, b]) => `between(t,${f3(a)},${f3(b)})`).join("+")}',asetpts=N/SR/TB,` : "";
    parts.push(`[0:a]${sel}${fmt}[orig]`);
    voice = "orig";
  }
  if (dubIdx !== undefined) {
    parts.push(`[${dubIdx}:a]${fmt},apad=whole_dur=${f3(outDur)}[dubraw]`);
    if (voice) {
      // Orijinal səs aşağı salınır və dublaj danışarkən əlavə sıxılır (ducking)
      parts.push(`[dubraw]asplit=2[dsc][dmix]`);
      parts.push(`[orig]volume=${originalVol}[obed]`);
      parts.push(`[obed][dsc]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[oduck]`);
      parts.push(`[oduck][dmix]amix=inputs=2:duration=longest:normalize=0[voice]`);
      voice = "voice";
    } else voice = "dubraw";
  }
  if (musicIdx !== undefined) {
    const fadeSt = Math.max(0, outDur - 1.5);
    parts.push(`[${musicIdx}:a]${fmt},volume=${musicVol},afade=t=out:st=${f3(fadeSt)}:d=1.5[mus]`);
    if (voice) {
      parts.push(`[${voice}]asplit=2[vsc][vmx]`);
      parts.push(`[mus][vsc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[mduck]`);
      parts.push(`[vmx][mduck]amix=inputs=2:duration=first:normalize=0[withmusic]`);
      voice = "withmusic";
    } else voice = "mus";
  }
  if (!voice) return null;
  return { graph: parts.join(";"), label: voice };
}

export function parseLoudnormJson(stderr) {
  const m = String(stderr).match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) return null;
  try { const j = JSON.parse(m[0]); return j; } catch { return null; }
}

// ---------- Hazırlıq + render ----------
export async function prepare(input, opts = {}) {
  const info = await probe(input);
  let keep = null;
  if (opts.cutSilence) {
    if (!info.hasAudio) throw new Error("Səssizlik kəsmək üçün videoda səs olmalıdır");
    if (opts.dub) throw new Error("Səssizlik kəsmə və dublaj birlikdə olmur: dublaj orijinal zaman xəttinə uyğun hazırlanıb. Əvvəl montajı et, dublajı sonra hazırla.");
    const noise = opts.noiseDb ?? -35, minSil = opts.minSilence ?? 0.4;
    const r = await run("ffmpeg", ["-nostdin", "-hide_banner", "-i", input, "-vn", "-af", `silencedetect=noise=${noise}dB:d=${minSil}`, "-f", "null", "-"]);
    const k = keepSegments(parseSilence(r.stderr, info.duration), info.duration, { pad: opts.pad ?? 0.12 });
    if (!k.length) throw new Error("Bütün video səssiz görünür: eşik (--noise) çox yüksəkdir");
    if (k.length > 400) throw new Error("Çox sayda kəsik (" + k.length + "). --min-silence dəyərini artır");
    keep = k.length === 1 && k[0][0] <= 0.01 && Math.abs(k[0][1] - info.duration) < 0.05 ? null : k;
  }
  let words = null, srtCues = null;
  if (opts.transcript) words = normalizeTranscript(JSON.parse(await readFile(opts.transcript, "utf8")));
  else if (opts.subs) srtCues = parseSrt(await readFile(opts.subs, "utf8"));
  let outDur = keep ? keptDuration(keep) : info.duration;
  if (opts.maxSec && opts.maxSec < outDur) outDur = opts.maxSec;
  return { input: resolve(input), info, keep, words, srtCues, outDur };
}

export async function render(prep, presetName, opts = {}, output) {
  const preset = presetOrThrow(presetName);
  const { info, keep } = prep;
  const warnings = [];
  const rec = preset.rec && RECOMMENDED[preset.rec];
  if (rec && rec.maxDuration && prep.outDur > rec.maxDuration) warnings.push(`müddət ${f3(prep.outDur)} san: ${presetName} üçün tövsiyə olunan maksimum ${rec.maxDuration} san (rəsmi sənədlə təsdiqlənməyib)`);
  if (info.width < preset.w * 0.6 && info.height < preset.h * 0.6) warnings.push(`mənbə ${info.width}x${info.height}: ${preset.w}x${preset.h}-ə böyüdüləcək, keyfiyyət düşə bilər`);

  let cues = [];
  if (prep.words) cues = groupWords(prep.words, { maxChars: captionLayout(preset).maxChars });
  else if (prep.srtCues) cues = prep.srtCues;
  if (keep) cues = remapCues(cues, keep);
  cues = cues.filter((c) => c.start < prep.outDur).map((c) => ({ ...c, end: Math.min(c.end, prep.outDur) }));

  const work = await mkdtemp(join(tmpdir(), "studio-"));
  try {
    const hasAss = cues.length > 0 || !!opts.hook || !!opts.cta;
    if (hasAss) await writeFile(join(work, "studio.ass"), buildAss({ preset, cues, hook: opts.hook, cta: opts.cta, outDur: prep.outDur }));

    const inputs = ["-i", prep.input];
    let n = 1;
    const idx = {};
    if (opts.dub) { inputs.push("-i", resolve(opts.dub)); idx.dub = n++; }
    if (opts.music) { inputs.push("-stream_loop", "-1", "-i", resolve(opts.music)); idx.music = n++; }
    if (opts.logo) { inputs.push("-i", resolve(opts.logo)); idx.logo = n++; }

    const audio = buildAudioGraph({ info, keep, dubIdx: idx.dub, musicIdx: idx.music, muteOriginal: !!opts.muteOriginal, originalVol: opts.originalVol, musicVol: opts.musicVol, outDur: prep.outDur });
    const video = buildVideoGraph({ preset, fit: opts.fit, info, keep, hasAss, logoIdx: idx.logo });

    let audioFinal = audio ? audio.graph : null;
    let audioLabel = audio ? audio.label : null;
    let loudness = null;
    if (audio && opts.loudnorm !== false) {
      const lufs = opts.lufs ?? -14, tp = -1.5, lra = 11;
      let ln = `loudnorm=I=${lufs}:TP=${tp}:LRA=${lra}`;
      // 1-ci keçid: yalnız səs, ölçmə
      const meas = await run("ffmpeg", [...FF, ...inputs, "-vn", "-filter_complex", `${audio.graph};[${audio.label}]${ln}:print_format=json[m]`, "-map", "[m]", "-t", f3(prep.outDur), "-f", "null", "-"], { cwd: work });
      const j = parseLoudnormJson(meas.stderr);
      if (j && isFinite(Number(j.input_i))) {
        loudness = { before_lufs: Number(j.input_i), target_lufs: lufs };
        ln += `:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
        audioFinal = `${audio.graph};[${audio.label}]${ln}[aout]`;
        audioLabel = "aout";
      } else warnings.push("loudnorm ölçülə bilmədi (səs çox səssizdir?), normallaşdırma keçildi");
    }

    const graph = audioFinal ? `${video};${audioFinal}` : video;
    const args = [...FF, ...inputs, "-filter_complex", graph, "-map", "[vout]"];
    if (audioLabel) args.push("-map", `[${audioLabel}]`, "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2");
    else args.push("-an");
    args.push("-c:v", "libx264", "-preset", opts.fast ? "veryfast" : "medium", "-crf", String(opts.crf ?? 20), "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", "-map_metadata", "-1", "-t", f3(prep.outDur), resolve(output));

    if (opts.dryRun) return { output: resolve(output), dryRun: true, command: ["ffmpeg", ...args].join(" "), warnings };

    await mkdir(dirname(resolve(output)), { recursive: true });
    await run("ffmpeg", args, { cwd: work });
    if (cues.length) await writeFile(resolve(output).replace(/\.[^.]+$/, "") + ".srt", cuesToSrt(cues));
    const verify = await verifyOutput(output, preset, prep.outDur, !!audioLabel);
    return { output: resolve(output), preset: presetName, duration: verify.info.duration, cues: cues.length, loudness, warnings, verify };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function verifyOutput(file, preset, expectedDur, expectAudio) {
  const info = await probe(file);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add("ölçü", info.width === preset.w && info.height === preset.h, `${info.width}x${info.height} (gözlənilən ${preset.w}x${preset.h})`);
  add("video kodek h264", info.vcodec === "h264", info.vcodec);
  add("səs", expectAudio ? info.hasAudio && info.acodec === "aac" : true, expectAudio ? String(info.acodec) : "səs gözlənilmirdi");
  add("müddət", Math.abs(info.duration - expectedDur) <= 0.4, `${f3(info.duration)} san (gözlənilən ≈ ${f3(expectedDur)})`);
  add("fps ≤ 30", info.fps <= 30.5, f3(info.fps));
  return { ok: checks.every((c) => c.ok), checks, info };
}

// ---------- Thumbnail ----------
export async function thumbnail(input, output, { at, auto } = {}) {
  await mkdir(dirname(resolve(output)), { recursive: true });
  if (auto) await run("ffmpeg", [...FF, "-t", "20", "-i", input, "-vf", "thumbnail=120", "-frames:v", "1", "-q:v", "2", resolve(output)]);
  else await run("ffmpeg", [...FF, "-ss", String(at ?? 1), "-i", input, "-frames:v", "1", "-q:v", "2", resolve(output)]);
  return resolve(output);
}

// ---------- SMM paylaşım qaralaması ----------
// Heç nə paylaşmır. Yalnız qaralama faylı yazır; paylaşım Fərid-in "təsdiq"indən sonra edilir (TEAM.md qaydası).
export function normalizeHashtags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : String(list || "").split(/[\s,]+/)) {
    const t = String(raw).trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push("#" + t); }
  }
  return out;
}
export async function buildPostDraft({ video, caption, hashtags, platforms }) {
  if (!video) throw new Error("--video lazımdır");
  if (!caption || !String(caption).trim()) throw new Error("--caption lazımdır (mətni sən yazırsan; studiya iddia əlavə etmir)");
  const info = await probe(video);
  const plats = (platforms || "instagram,tiktok,youtube").split(",").map((s) => s.trim()).filter(Boolean);
  const warnings = [];
  for (const p of plats) {
    const rec = RECOMMENDED[p];
    if (!rec) { warnings.push("naməlum platforma: " + p); continue; }
    if (rec.aspect && (info.aspect < rec.aspect[0] || info.aspect > rec.aspect[1])) warnings.push(`${p}: en/boy nisbəti ${f3(info.aspect)}, 9:16 tövsiyə olunur`);
    if (rec.maxDuration && info.duration > rec.maxDuration) warnings.push(`${p}: müddət ${f3(info.duration)} san, tövsiyə maksimum ${rec.maxDuration} (təsdiqlənməyib)`);
  }
  return {
    status: "draft_only",
    approval: "Paylaşım üçün Fərid-in 'təsdiq' yazması lazımdır. Bu fayl heç yerə göndərilməyib.",
    video: resolve(video),
    platforms: plats,
    caption: String(caption).trim(),
    hashtags: normalizeHashtags(hashtags),
    media: { duration_s: f3(info.duration), size: info.width + "x" + info.height },
    warnings,
  };
}

export async function fileExists(p) { try { await stat(p); return true; } catch { return false; } }
