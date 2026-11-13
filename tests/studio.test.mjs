import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  srtTime, wrapLines, normalizeTranscript, groupWords, cuesToSrt, parseSrt, parseSilence, keepSegments, keptDuration,
  mapTime, remapCues, buildAss, buildVideoGraph, normalizeHashtags, PRESETS, prepare, render, probe, thumbnail, buildPostDraft, parseLoudnormJson,
  remapWords, groupWordChunks, overlayTiming, readingTime, captionLayout, voiceCleanChain, resolveFps, MODELS_DIR, SAFE, pickFont, AZ_CHARS, loudnessFilter,
} from "../studio/lib.mjs";
import { parseEbur128, analyze, qa, missingGlyphs } from "../studio/qa.mjs";
import { asrStatus, transcribe } from "../studio/asr.mjs";
import { renderMotion } from "../studio/motion.mjs";

const HAS_FF = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const ff = (...a) => { const r = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...a], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); };

// ---------- Təmiz funksiyalar (ffmpeg lazım deyil) ----------
test("srtTime formatı", () => {
  assert.equal(srtTime(0), "00:00:00,000");
  assert.equal(srtTime(3661.5), "01:01:01,500");
});

test("wrapLines sətir limitini saxlayır", () => {
  const lines = wrapLines("bu çox uzun bir cümlədir və iki sətirə bölünməlidir", 20);
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(l.length <= 20, l);
});

test("normalizeTranscript: Scribe words, spacing və audio_event atılır", () => {
  const w = normalizeTranscript({ words: [{ text: "Salam", start: 0, end: 0.5, type: "word" }, { text: " ", start: 0.5, end: 0.5, type: "spacing" }, { text: "(gülüş)", start: 0.5, end: 0.9, type: "audio_event" }] });
  assert.deepEqual(w, [{ text: "Salam", start: 0, end: 0.5 }]);
});

test("normalizeTranscript: utterances (ms) sözlərə bölünür, vaxtlar aralıqdan çıxmır", () => {
  const w = normalizeTranscript({ utterances: [{ startMs: 1000, endMs: 3000, text: "bir iki üç dörd" }] });
  assert.equal(w.length, 4);
  assert.ok(Math.abs(w[0].start - 1) < 1e-9);
  assert.ok(Math.abs(w[3].end - 3) < 1e-9);
  assert.throws(() => normalizeTranscript({ foo: 1 }), /formatı tanınmadı/);
});

test("groupWords: ≤ maxLines, ≤ maxChars, boşluqda bölür, üst-üstə düşmür", () => {
  const words = [];
  const text = "Salam dostlar bu gün sizə yeni məhsulumuzu təqdim edirəm və çox sevinirəm. Sonra isə qiymət haqqında danışacağıq";
  let t = 0;
  for (const x of text.split(" ")) { words.push({ text: x, start: t, end: t + 0.3 }); t += 0.35; }
  words.push({ text: "Son.", start: t + 2, end: t + 2.3 });
  const cues = groupWords(words, { maxChars: 28, maxLines: 2 });
  assert.ok(cues.length >= 3);
  for (const c of cues) {
    const lines = c.text.split("\n");
    assert.ok(lines.length <= 2, c.text);
    for (const l of lines) assert.ok(l.length <= 28, l);
  }
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end - 1e-9, "üst-üstə düşmə");
  assert.equal(cues[cues.length - 1].text, "Son.");
});

test("SRT yaz/oxu dövrü Azərbaycan hərflərini saxlayır", () => {
  const cues = [{ start: 1, end: 2.5, text: "çəkiliş ğ ı ö ü ş ə" }];
  const back = parseSrt(cuesToSrt(cues));
  assert.equal(back.length, 1);
  assert.equal(back[0].text, "çəkiliş ğ ı ö ü ş ə");
  assert.ok(Math.abs(back[0].start - 1) < 1e-3 && Math.abs(back[0].end - 2.5) < 1e-3);
});

test("silencedetect çıxışı və saxlanacaq hissələr", () => {
  const stderr = "[silencedetect] silence_start: 2.001\n[silencedetect] silence_end: 4.0 | silence_duration: 1.999\n[silencedetect] silence_start: 5.8";
  const sil = parseSilence(stderr, 6);
  assert.deepEqual(sil, [{ start: 2.001, end: 4 }, { start: 5.8, end: 6 }]);
  const keep = keepSegments(sil, 6, { pad: 0.12 });
  assert.equal(keep.length, 2);
  assert.ok(Math.abs(keep[0][1] - 2.121) < 1e-6 && Math.abs(keep[1][0] - 3.88) < 1e-6);
  assert.ok(keptDuration(keep) < 6);
});

test("keepSegments: başlanğıcdakı uzun səssizlik kəsilir, qısa qırıntılar atılır", () => {
  const keep = keepSegments([{ start: 0, end: 1 }], 5, { pad: 0.12 });
  assert.deepEqual(keep, [[0.88, 5]]);
});

test("mapTime/remapCues: subtitr kəsikdən sonra sinxron qalır", () => {
  const keep = [[0, 2], [4, 6]];
  assert.equal(mapTime(1, keep), 1);
  assert.equal(mapTime(3, keep), 2); // kəsilmiş aralıq → növbəti hissənin başlanğıcı
  assert.equal(mapTime(5, keep), 3);
  const out = remapCues([{ start: 0.5, end: 1.5, text: "a" }, { start: 2.5, end: 3.5, text: "tam kəsilib" }, { start: 4.5, end: 5.5, text: "b" }], keep);
  assert.deepEqual(out.map((c) => c.text), ["a", "b"]);
  assert.equal(out[1].start, 2.5);
});

test("ASS: hook yuxarı, CTA aşağı, təhlükəsiz zonalar; qısa videoda müddət 45%-lə məhdud", () => {
  const ass = buildAss({ preset: PRESETS.reels, cues: [{ start: 0, end: 1, text: "çəkiliş\nikinci" }], hook: "Qaçırma", cta: "DM yaz", outDur: 6 });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Style: Sub,DejaVu Sans,\d+,.*,2,\d+,\d+,370,1/); // altdan 350+20
  assert.match(ass, /Style: Hook,.*,8,\d+,\d+,270,1/); // yuxarıdan 250+20
  assert.match(ass, /Dialogue: 0,0:00:00.00,0:00:01.00,Sub,,0,0,0,,çəkiliş\\Nikinci/);
  assert.match(ass, /Dialogue: 1,0:00:00.00,0:00:02.70,Hook/); // 6*0.45
  assert.match(ass, /Dialogue: 1,0:00:03.30,0:00:06.00,Cta/);
  assert.match(ass, /Style: Sub,DejaVu Sans,\d+,.*,2,59,108,370,1/); // sağ boşluq 10%
  assert.match(ass, /Style: Hook,DejaVu Sans,100,/); // başlıq ≥ 100 px
});

test("ASS mətnində { } və yeni sətir təhlükəsiz çevrilir", () => {
  const ass = buildAss({ preset: PRESETS.reels, cues: [{ start: 0, end: 1, text: "a{\\pos(0,0)}b" }], outDur: 10 });
  assert.ok(!ass.includes("{\\pos"));
});

test("buildVideoGraph: en/boy uyğundursa scale, deyilsə blur; qeyri-müəyyən fit rədd edilir", () => {
  const info = { width: 1280, height: 720, aspect: 1280 / 720, fps: 60 };
  assert.match(buildVideoGraph({ preset: PRESETS.reels, fit: "auto", info, keep: null, hasAss: false }), /boxblur/);
  assert.match(buildVideoGraph({ preset: PRESETS.youtube, fit: "auto", info, keep: null, hasAss: false }), /scale=1920:1080/);
  assert.match(buildVideoGraph({ preset: PRESETS.reels, fit: "crop", info, keep: null, hasAss: false }), /crop=1080:1920/);
  assert.match(buildVideoGraph({ preset: PRESETS.reels, fit: "auto", info, keep: [[0, 1], [2, 3]], hasAss: true }), /fps=30,select='between\(t,0,1\)\+between\(t,2,3\)'.*ass=studio\.ass/);
  assert.throws(() => buildVideoGraph({ preset: PRESETS.reels, fit: "xyz", info, keep: null, hasAss: false }), /Naməlum fit/);
});

test("hashtag normallaşdırma: # təmizlənir, təkrar atılır, simvollar silinir", () => {
  assert.deepEqual(normalizeHashtags("#Reklam, reklam  montaj! ##dublaj"), ["#Reklam", "#montaj", "#dublaj"]);
});

test("parseLoudnormJson ffmpeg çıxışından JSON götürür", () => {
  const j = parseLoudnormJson('[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-22.11",\n\t"input_tp" : "-9.0",\n\t"input_lra" : "0.0",\n\t"input_thresh" : "-32.1",\n\t"target_offset" : "0.5"\n}\n');
  assert.equal(j.input_i, "-22.11");
});

// ---------- Real ffmpeg ilə ----------
let dir;
const src = () => join(dir, "src.mp4");
before(() => {
  if (!HAS_FF) return;
  dir = mkdtempSync(join(tmpdir(), "studio-test-"));
  // 6 san, 1280x720; 2-4 san arası səssiz
  ff("-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-af", "volume=enable='between(t,2,4)':volume=0", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", src());
  ff("-f", "lavfi", "-i", "sine=frequency=220:duration=3", "-c:a", "libmp3lame", join(dir, "dub.mp3"));
  ff("-f", "lavfi", "-i", "color=c=0xE65000:s=400x200:d=1", "-frames:v", "1", join(dir, "logo.png"));
  writeFileSync(join(dir, "tr.json"), JSON.stringify({ words: [
    { text: "Salam,", start: 0.1, end: 0.5, type: "word" }, { text: "çəkiliş", start: 0.6, end: 1.8, type: "word" },
    { text: "ödəniş", start: 4.2, end: 4.7, type: "word" }, { text: "əlaqə.", start: 5.0, end: 5.6, type: "word" }] }));
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const maxVol = (file, ss, t) => {
  const r = spawnSync("ffmpeg", ["-nostdin", "-hide_banner", "-ss", String(ss), "-t", String(t), "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf8" });
  const m = r.stderr.match(/max_volume: (-?[\d.]+|-inf) dB/);
  return m ? (m[1] === "-inf" ? -Infinity : parseFloat(m[1])) : null;
};

test("tam montaj: 9:16, səssizlik kəsilir, subtitr sinxron, hook/CTA/loqo, loudnorm", { skip: !HAS_FF }, async () => {
  const opts = { cutSilence: true, transcript: join(dir, "tr.json"), hook: "Qaçırma", cta: "DM yaz", logo: join(dir, "logo.png"), fast: true };
  const prep = await prepare(src(), opts);
  assert.ok(prep.keep && prep.keep.length === 2, "2 hissə qalmalıdır");
  assert.ok(prep.outDur > 3.8 && prep.outDur < 4.6, "müddət ≈ 4.2: " + prep.outDur);
  const out = join(dir, "reels.mp4");
  const r = await render(prep, "reels", opts, out);
  assert.ok(r.verify.ok, JSON.stringify(r.verify.checks));
  const info = await probe(out);
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1920);
  assert.equal(info.vcodec, "h264");
  assert.equal(info.acodec, "aac");
  assert.ok(info.hasAudio);
  assert.ok(r.loudness && Math.abs(r.loudness.target_lufs + 14) < 1e-9);
  const { loudness: measureLoud } = await import("../studio/qa.mjs");
  const ml = await measureLoud(out);
  assert.ok(Math.abs(ml.lufs + 14) <= 1 && ml.true_peak <= -1.45, "ölçülən səs: " + JSON.stringify(ml));
  // Subtitr: "ödəniş" orijinalda 4.2 san, kəsikdən sonra ≈ 2.44 san
  const cues = parseSrt(readFileSync(out.replace(/\.mp4$/, ".srt"), "utf8"));
  assert.equal(cues.length, 2);
  assert.ok(Math.abs(cues[1].start - 2.44) < 0.05, "sinxron: " + cues[1].start);
  assert.match(cues[1].text, /ödəniş/);
});

test("kəsilmiş videoda səssiz hissə qalmır", { skip: !HAS_FF }, async () => {
  const prep = await prepare(src(), { cutSilence: true });
  const out = join(dir, "cut.mp4");
  await render(prep, "square", { fast: true, loudnorm: false }, out);
  // Orijinalın 2-4 san səssizliyi çıxarılıb: nəticənin heç bir 0.5 san pəncərəsi səssiz olmamalıdır
  const info = await probe(out);
  for (let s = 0.3; s + 0.5 < info.duration - 0.2; s += 0.5) assert.ok(maxVol(out, s, 0.5) > -40, "səssiz pəncərə " + s);
});

test("dublaj: orijinal səs söndürülür, dublaj yalnız öz müddətində səslənir, video müddəti saxlanır", { skip: !HAS_FF }, async () => {
  const prep = await prepare(src(), { dub: join(dir, "dub.mp3") });
  const out = join(dir, "mute.mp4");
  const r = await render(prep, "tiktok", { dub: join(dir, "dub.mp3"), muteOriginal: true, fast: true, loudnorm: false }, out);
  assert.ok(r.verify.ok, JSON.stringify(r.verify.checks));
  assert.ok(Math.abs(r.duration - 6) < 0.3);
  assert.ok(maxVol(out, 0.2, 2) > -30, "dublaj eşidilməlidir");
  assert.ok(maxVol(out, 4, 1.5) < -60, "dublajdan sonrakı hissə səssiz olmalıdır (orijinal səs söndürülüb)");
});

test("dublaj + musiqi + orijinal səs miksi işləyir və səs var", { skip: !HAS_FF }, async () => {
  ff("-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-c:a", "libmp3lame", join(dir, "m.mp3"));
  const opts = { dub: join(dir, "dub.mp3"), music: join(dir, "m.mp3"), fast: true };
  const prep = await prepare(src(), opts);
  const r = await render(prep, "reels", opts, join(dir, "mix.mp4"));
  assert.ok(r.verify.ok, JSON.stringify(r.verify.checks));
  assert.ok(Math.abs(r.duration - 6) < 0.3);
});

test("səssizlik kəsmə + dublaj birlikdə rədd edilir", { skip: !HAS_FF }, async () => {
  await assert.rejects(() => prepare(src(), { cutSilence: true, dub: join(dir, "dub.mp3") }), /birlikdə olmur/);
});

test("batch: eyni mənbədən 3 platforma düzgün ölçüdə", { skip: !HAS_FF }, async () => {
  const prep = await prepare(src(), {});
  for (const [name, w, h] of [["reels", 1080, 1920], ["feed", 1080, 1350], ["youtube", 1920, 1080]]) {
    const r = await render(prep, name, { fast: true, loudnorm: false }, join(dir, "b-" + name + ".mp4"));
    assert.ok(r.verify.ok, name + " " + JSON.stringify(r.verify.checks));
    const i = await probe(join(dir, "b-" + name + ".mp4"));
    assert.equal(i.width, w);
    assert.equal(i.height, h);
  }
});

test("dry-run faylı yaratmır, əmri qaytarır", { skip: !HAS_FF }, async () => {
  const prep = await prepare(src(), {});
  const out = join(dir, "dry.mp4");
  const r = await render(prep, "reels", { dryRun: true, loudnorm: false }, out);
  assert.ok(r.dryRun && r.command.startsWith("ffmpeg "));
  assert.equal(existsSync(out), false);
});

test("thumbnail və post-draft (draft_only, heç nə göndərilmir)", { skip: !HAS_FF }, async () => {
  const th = await thumbnail(src(), join(dir, "th.jpg"), { auto: true });
  assert.ok(existsSync(th));
  const d = await buildPostDraft({ video: join(dir, "reels.mp4"), caption: "Test", hashtags: "#a, b", platforms: "instagram,tiktok" });
  assert.equal(d.status, "draft_only");
  assert.deepEqual(d.hashtags, ["#a", "#b"]);
  assert.match(d.approval, /təsdiq/);
  await assert.rejects(() => buildPostDraft({ video: join(dir, "reels.mp4"), caption: " " }), /caption/);
});

test("səsi olmayan video: səssizlik kəsmə rədd edilir, montaj səssiz çıxır", { skip: !HAS_FF }, async () => {
  ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "silent.mp4"));
  await assert.rejects(() => prepare(join(dir, "silent.mp4"), { cutSilence: true }), /səs olmalıdır/);
  const prep = await prepare(join(dir, "silent.mp4"), {});
  const r = await render(prep, "reels", { fast: true }, join(dir, "silent-out.mp4"));
  assert.ok(r.verify.ok, JSON.stringify(r.verify.checks));
  assert.equal((await probe(join(dir, "silent-out.mp4"))).hasAudio, false);
  assert.ok(r.warnings.some((w) => /böyüdüləcək/.test(w)), "kiçik mənbə xəbərdarlığı");
});

// ================= Fəridin studiya standartları (əlavə) =================
test("remapWords: kəsikdən sonra heç bir söz itmir (qısa sözlər də), ardıcıllıq qorunur", () => {
  const words = [{ text: "be", start: 0.5, end: 0.9 }, { text: "a", start: 0.9, end: 0.95 }, { text: "kəsikdə", start: 2.5, end: 3 }, { text: "son", start: 4.5, end: 5 }];
  const out = remapWords(words, [[0, 2], [4, 6]]);
  assert.deepEqual(out.map((w) => w.text), ["be", "a", "kəsikdə", "son"]);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].start >= out[i - 1].start);
  for (const w of out) assert.ok(w.end > w.start);
  assert.equal(out[3].start, 2.5);
});

test("groupWordChunks: ən çox 3 söz və sətir limiti, bütün sözlər qalır", () => {
  const words = "Salam dostlar bu gün sizə yeni məhsulumuzu təqdim edirəm. Çox sevinirəm a b".split(" ").map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 }));
  const ch = groupWordChunks(words, { maxWords: 3, maxChars: 18 });
  assert.equal(ch.reduce((n, c) => n + c.words.length, 0), words.length);
  for (const c of ch) {
    assert.ok(c.words.length <= 3);
    assert.ok(c.words.length === 1 || c.words.map((w) => w.text).join(" ").length <= 18, c.words.map((w) => w.text).join(" "));
  }
  assert.equal(ch.find((c) => c.words.some((w) => w.text === "edirəm.")).words.at(-1).text, "edirəm."); // cümlə sonunda bölünür
});

test("oxuma vaxtı və hook/CTA müddəti (söz sayı/3 + 1 san)", () => {
  assert.ok(Math.abs(readingTime("bir iki üç dörd beş altı") - 3) < 1e-9);
  const long = overlayTiming({ hook: "bir iki üç dörd beş altı yeddi səkkiz doqquz", cta: "DM yaz", outDur: 30 });
  assert.equal(long.hookSec, 4); // 9/3+1
  assert.equal(long.ctaSec, 4);
  assert.ok(Math.abs(overlayTiming({ hook: "Qaçırma", outDur: 4 }).hookSec - 1.8) < 1e-9); // qısa videoda 45%
});

test("9:16 layout: sağ boşluq ≥ 10%, aşağı ≥ 15%, başlıq ≥ 100 px; üfüqi presetdə sağ məhdudiyyət yoxdur", () => {
  const v = captionLayout(PRESETS.reels);
  assert.ok(v.marginR >= 1080 * SAFE.rightPct);
  assert.ok(v.marginV >= 1920 * SAFE.bottomPct);
  assert.ok(v.hookFs >= 100);
  assert.ok(v.fs >= 26);
  const h = captionLayout(PRESETS.youtube);
  assert.equal(h.marginR, h.margin);
});

test("ASS sözbəsöz: hər söz üçün hadisə, cari söz vurğulanır, mətn təhlükəsiz çevrilir", () => {
  const chunks = [{ start: 0, end: 1.2, words: [{ text: "Salam", start: 0, end: 0.4 }, { text: "ə{x}", start: 0.4, end: 0.8 }, { text: "dünya", start: 0.8, end: 1.2 }] }];
  const ass = buildAss({ preset: PRESETS.reels, chunks, outDur: 10 });
  const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue: 0") && l.includes(",Word,"));
  assert.equal(ev.length, 3);
  assert.match(ev[0], /\{\\c&H0000F0FF&\}Salam\{\\c&H00FFFFFF&\} əx dünya$/);
  assert.match(ev[2], /Salam əx \{\\c&H0000F0FF&\}dünya/);
  assert.match(ev[2], /^Dialogue: 0,0:00:00.80,0:00:01.45,Word/); // qrup +0.25 san qalır
});

test("səs təmizləmə zənciri: model varsa RNNoise, yoxdursa afftdn", () => {
  assert.match(voiceCleanChain("voice.rnnn"), /^highpass=f=80:poles=2,arnndn=m=voice\.rnnn:mix=0\.97,equalizer=f=220.*equalizer=f=3200.*agate.*acompressor.*alimiter=limit=0\.9:level=0$/);
  assert.match(voiceCleanChain(null), /afftdn/);
  assert.match(voiceCleanChain(null), /alimiter=limit=0\.9:level=0$/); // limiter səsi özü gücləndirmir
  assert.equal(loudnessFilter(3.456, false), "volume=3.46dB");
  assert.match(loudnessFilter(12, true), /^volume=12\.00dB,alimiter=limit=0\.708.*level=0$/);
});

test("fps: standart 30, source mənbəni saxlayır; punch-in və grade filtrləri", () => {
  assert.equal(resolveFps(undefined, { fps: 25 }), 30);
  assert.equal(resolveFps("source", { fps: 25 }), 25);
  assert.equal(resolveFps(60, { fps: 25 }), 60);
  const info = { width: 1280, height: 720, aspect: 16 / 9, fps: 25 };
  const g = buildVideoGraph({ preset: PRESETS.reels, fit: "auto", info, keep: [[0, 2], [4, 6], [7, 8]], hasAss: false, punchIn: true, grade: "warm" });
  assert.match(g, /zoompan=z='1\+0\.08\*\(between\(in_time,2,3\.999\)\)'.*s=1280x720:fps=30/); // yalnız 2-ci hissə
  assert.match(g, /colorbalance/);
  assert.ok(!buildVideoGraph({ preset: PRESETS.reels, fit: "auto", info, keep: null, hasAss: false, punchIn: true }).includes("zoompan"), "kəsik yoxdursa punch-in yoxdur");
  assert.throws(() => buildVideoGraph({ preset: PRESETS.reels, fit: "auto", info, keep: null, hasAss: false, grade: "x" }), /Naməlum grade/);
});

test("ebur128 çıxışından LUFS və true peak oxunur (yekun bölməsindən)", () => {
  const e = parseEbur128("[Parsed_ebur128_0] t: 1 TARGET:-23 LUFS M: -20.0 S:-120.7 I: -99.9 LUFS LRA: 0.0 LU\n[Parsed_ebur128_0 @ 0x] Summary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.5 LUFS\n\n  Loudness range:\n    LRA:         3.1 LU\n\n  True peak:\n    Peak:       -1.6 dBFS\n");
  assert.deepEqual(e, { lufs: -14.2, lra: 3.1, true_peak: -1.6 });
});

test("şrift yoxlaması: Azərbaycan hərfləri və ₼ var, olmayan simvol tutulur", { skip: spawnSync("fc-list", ["--version"]).status !== 0 }, async () => {
  const f = await pickFont();
  // Seçilən şrift tam dəstəkləyirsə heç nə çatmır; DejaVu Sans-da ₼ yoxdur və bu tutulur
  if (f.full) assert.deepEqual((await missingGlyphs(AZ_CHARS, f.family)).missing, []);
  assert.deepEqual((await missingGlyphs("Ə ə ı İ ğ ş ç ö ü", "DejaVu Sans")).missing, []);
  assert.deepEqual((await missingGlyphs("abc 漢", "DejaVu Sans")).missing, ["漢"]);
});

test("sözbəsöz render + yan fayl + QA: ölçülən bəndlər keçir, təhvil paketi çatmayanda qalır", { skip: !HAS_FF }, async () => {
  const opts = { cutSilence: true, transcript: join(dir, "tr.json"), captionStyle: "word", hook: "Qaçırma", cta: "DM yaz", punchIn: true, grade: "warm", fast: true };
  const prep = await prepare(src(), opts);
  const out = join(dir, "word.mp4");
  const r = await render(prep, "reels", opts, out);
  assert.ok(r.verify.ok, JSON.stringify(r.verify.checks));
  const side = JSON.parse(readFileSync(join(dir, "word.studio.json"), "utf8"));
  assert.equal(side.caption_style, "word");
  assert.equal(side.fps, 30);
  assert.equal(side.cues.reduce((n, c) => n + c.text.split(" ").length, 0), 4, "transkriptdəki 4 sözün hamısı altyazıdadır");
  assert.equal(side.layout.margin_right, 108);
  assert.equal(side.cuts, 1);
  assert.equal((await probe(out)).fps, 30);

  const q1 = await qa(out);
  const st = (code) => q1.items.find((i) => i.code === code).status;
  for (const c of ["Q-2", "Q-6", "Q-9", "Q-11"]) assert.equal(st(c), "keçdi", c + ": " + q1.items.find((i) => i.code === c).detail);
  assert.equal(st("Q-12"), "qaldı");
  assert.equal(q1.ok, false);
  assert.ok(Math.abs(q1.loudness.lufs + 14) <= 1 && q1.loudness.true_peak <= -1.45, JSON.stringify(q1.loudness));
  assert.ok(existsSync(join(dir, "word-qa", "hook-1.0.jpg")) && existsSync(join(dir, "word-qa", "sheet-1fps.jpg")));
  // Heç bir "əl ilə" bənd avtomatik "keçdi" sayılmır
  for (const c of ["Q-1", "Q-4", "Q-5", "Q-10"]) assert.equal(st(c), "əl ilə", c);

  await thumbnail(out, join(dir, "word-thumb.jpg"), { auto: true });
  const { writeFileSync: wf } = await import("node:fs");
  wf(join(dir, "word.post.json"), JSON.stringify(await buildPostDraft({ video: out, caption: "Test" })));
  const q2 = await qa(out);
  assert.equal(q2.items.find((i) => i.code === "Q-12").status, "keçdi");
  assert.equal(q2.ok, true);
});

test("QA səhvi tutur: sakit səs (Q-6), qadağan söz (Q-5), kiçik oxuma vaxtı (Q-3)", { skip: !HAS_FF }, async () => {
  const opts = { hook: "Pulsuz sınaq üçün indi bizə yazın və qazanın dostlar", loudnorm: false, fast: true, maxSec: 3 };
  const prep = await prepare(src(), opts);
  const out = join(dir, "bad.mp4");
  const r = await render(prep, "reels", opts, out);
  assert.ok(r.warnings.some((w) => /oxuma vaxtı/.test(w)));
  const q = await qa(out);
  const st = (code) => q.items.find((i) => i.code === code).status;
  assert.equal(st("Q-6"), "qaldı");
  assert.equal(st("Q-5"), "qaldı");
  assert.equal(st("Q-3"), "qaldı");
  assert.equal(q.ok, false);
});

test("QA: studiya faylı olmayan videoda ölçülməyən bəndlər 'keçdi' yazılmır", { skip: !HAS_FF }, async () => {
  const q = await qa(src());
  const st = (code) => q.items.find((i) => i.code === code).status;
  assert.equal(q.studio_sidecar, false);
  assert.equal(st("Q-2"), "n/a");
  assert.equal(st("Q-9"), "n/a");
  assert.equal(st("Q-11"), "qaldı"); // 1280x720, 25 fps
});

test("musiqi qoyulanda musiqisiz nüsxə də yazılır; söndürmək olur", { skip: !HAS_FF }, async () => {
  ff("-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-c:a", "libmp3lame", join(dir, "m2.mp3"));
  const opts = { music: join(dir, "m2.mp3"), fast: true };
  const prep = await prepare(src(), opts);
  const r = await render(prep, "reels", opts, join(dir, "mus.mp4"));
  assert.ok(r.verify.ok, JSON.stringify(r.verify.checks));
  assert.equal(r.noMusicCopy, join(dir, "mus-musiqisiz.mp4"));
  assert.ok((await probe(r.noMusicCopy)).hasAudio);
  assert.equal(JSON.parse(readFileSync(join(dir, "mus.studio.json"), "utf8")).has_music, true);
  assert.equal(JSON.parse(readFileSync(join(dir, "mus-musiqisiz.studio.json"), "utf8")).has_music, false);
  // Orijinalın 2-4 san səssizliyi: musiqili faylda səs var, musiqisizdə yoxdur
  assert.ok(maxVol(join(dir, "mus.mp4"), 2.5, 1) > -45);
  assert.ok(maxVol(r.noMusicCopy, 2.5, 1) < -45);
  const r2 = await render(prep, "reels", { ...opts, noMusicCopy: false }, join(dir, "mus2.mp4"));
  assert.equal(r2.noMusicCopy, undefined);
  assert.equal(existsSync(join(dir, "mus2-musiqisiz.mp4")), false);
});

test("analyze: səs səviyyəsi, səssizlik, kəsimlər və kontakt vərəqi", { skip: !HAS_FF }, async () => {
  const a = await analyze(src(), { outdir: join(dir, "an") });
  assert.ok(isFinite(a.loudness.lufs) && isFinite(a.loudness.true_peak));
  assert.ok(a.silences.length >= 1 && a.silence_total > 1.5, "2-4 san səssizliyi tapılmalıdır");
  assert.ok(Array.isArray(a.scene_cuts));
  assert.ok(existsSync(a.contact_sheet) && existsSync(a.report));
});

let HAS_PW = true;
try { const { createRequire } = await import("node:module"); createRequire(import.meta.url)("playwright"); } catch { HAS_PW = (process.env.NODE_PATH || "").length > 0; }
test("motion: HTML səhifəsi window.seek ilə kadr-kadr videoya çevrilir", { skip: !HAS_FF || !HAS_PW }, async (t) => {
  const { writeFileSync: wf } = await import("node:fs");
  wf(join(dir, "m.html"), `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><div id="b" style="position:absolute;top:0;left:0;width:100px;height:100%;background:#fff"></div><script>window.seek=t=>{document.getElementById('b').style.left=(t*400)+'px'}</script>`);
  let r;
  try { r = await renderMotion(join(dir, "m.html"), join(dir, "motion.mp4"), { duration: 1, fps: 10, width: 540, height: 960 }); }
  catch (e) { if (/Playwright tapılmadı|Executable doesn't exist/.test(e.message)) return t.skip("brauzer yoxdur"); throw e; }
  assert.equal(r.frames, 10);
  assert.equal(r.seek, "window.seek");
  assert.equal(r.info.width, 540);
  assert.equal(r.info.height, 960);
  assert.ok(Math.abs(r.info.duration - 1) < 0.15);
  // Hərəkət var: ilk və son kadr fərqlidir (ağ zolaq sürüşür)
  const px = (ss) => spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-ss", String(ss), "-i", join(dir, "motion.mp4"), "-frames:v", "1", "-vf", "crop=20:20:40:400,scale=1:1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]).stdout[0];
  assert.ok(px(0) > 200 && px(0.85) < 50, `ilk ${px(0)} son ${px(0.85)}`);
});

// Real nitq: modelin öz test səsi (ingiliscə). Azərbaycan nitqi ilə dəqiqlik burada YOXLANMIR.
const ASR = await asrStatus("turbo");
const TEST_WAV = join(MODELS_DIR, "sherpa-onnx-whisper-turbo", "test_wavs", "0.wav");
test("yerli transkripsiya: real nitq mətnə çevrilir, söz vaxtları ardıcıl və müddət daxilindədir", { skip: !(HAS_FF && ASR.python && ASR.model && ASR.vad && existsSync(TEST_WAV)) }, async () => {
  ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=7", "-i", TEST_WAV, "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-pix_fmt", "yuv420p", "-shortest", join(dir, "speech.mp4"));
  const t = await transcribe(join(dir, "speech.mp4"), { lang: "en", out: join(dir, "speech.json") });
  const text = t.words.map((w) => w.text).join(" ").toLowerCase();
  assert.match(text, /yellow lamps/);
  assert.ok(t.words.length >= 15 && t.words.length <= 22, "söz sayı " + t.words.length);
  assert.equal(t.verified_by_human, false);
  assert.equal(t.word_timing, "approximate");
  for (let i = 0; i < t.words.length; i++) {
    assert.ok(t.words[i].start >= 0 && t.words[i].end <= t.duration + 0.5);
    if (i) assert.ok(t.words[i].start >= t.words[i - 1].start);
  }
  // Transkript birbaşa montaja gedir və bütün sözlər altyazıya düşür
  const opts = { transcript: t.file, captionStyle: "word", cleanVoice: true, cutSilence: true, fast: true };
  const r = await render(await prepare(join(dir, "speech.mp4"), opts), "reels", opts, join(dir, "speech-out.mp4"));
  assert.ok(r.verify.ok);
  // Real nitqdə təmizləmə zəncirindən sonra səs səviyyəsi hədəfdədir
  const q = await qa(join(dir, "speech-out.mp4"));
  assert.equal(q.items.find((i) => i.code === "Q-6").status, "keçdi", q.items.find((i) => i.code === "Q-6").detail);
  const side = JSON.parse(readFileSync(join(dir, "speech-out.studio.json"), "utf8"));
  assert.equal(side.cues.reduce((n, c) => n + c.text.split(" ").length, 0), t.words.length);
});
