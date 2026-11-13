import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  srtTime, wrapLines, normalizeTranscript, groupWords, cuesToSrt, parseSrt, parseSilence, keepSegments, keptDuration,
  mapTime, remapCues, buildAss, buildVideoGraph, normalizeHashtags, PRESETS, prepare, render, probe, thumbnail, buildPostDraft, parseLoudnormJson,
} from "../studio/lib.mjs";

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

test("ASS: hook yuxarı, CTA aşağı, təhlükəsiz zonalar; qısa videoda müddət 35%-lə məhdud", () => {
  const ass = buildAss({ preset: PRESETS.reels, cues: [{ start: 0, end: 1, text: "çəkiliş\nikinci" }], hook: "Qaçırma", cta: "DM yaz", outDur: 6 });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Style: Sub,DejaVu Sans,\d+,.*,2,\d+,\d+,370,1/); // altdan 350+20
  assert.match(ass, /Style: Hook,.*,8,\d+,\d+,270,1/); // yuxarıdan 250+20
  assert.match(ass, /Dialogue: 0,0:00:00.00,0:00:01.00,Sub,,0,0,0,,çəkiliş\\Nikinci/);
  assert.match(ass, /Dialogue: 1,0:00:00.00,0:00:02.10,Hook/); // 6*0.35
  assert.match(ass, /Dialogue: 1,0:00:03.90,0:00:06.00,Cta/);
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
