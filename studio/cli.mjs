#!/usr/bin/env node
// Video studiya CLI. İstifadə: node studio/cli.mjs <əmr> ...   (npm run studio -- <əmr> ...)
import { writeFile, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { doctor, probe, prepare, render, thumbnail, normalizeTranscript, groupWords, cuesToSrt, captionLayout, buildPostDraft, presetOrThrow, fileExists } from "./lib.mjs";
import { asrStatus, setupModels, transcribe } from "./asr.mjs";
import { analyze, qa } from "./qa.mjs";
import { renderMotion } from "./motion.mjs";

const HELP = `Video studiya (ffmpeg). Əmrlər:

  doctor                          mühiti yoxla (ffmpeg, filtrlər, şrift, transkripsiya modelləri)
  setup-models [--model turbo]    pulsuz yerli transkripsiya üçün modelləri yüklə (turbo ≈ 564 MB)
  probe <video>                   ölçü, müddət, kodek, səs
  analyze <video>                 kəsim yerləri, səs səviyyəsi, səssizliklər, kontakt vərəqi
  transcribe <video> [--lang az] [--model turbo] [--out t.json]   yerli Whisper, şübhəli sözləri göstərir
  auto <video> [seçimlər]         HƏR ŞEY: transkripsiya → montaj → üz qabığı → QA (sual vermədən)
  edit <video> [seçimlər]         tam montaj: tək platforma üçün
  batch <video> --presets a,b,c   eyni videodan bir neçə platforma faylı
  qa <video> [--retranscribe] [--lang az] [--forbid "söz1,söz2"]   12 bəndlik keyfiyyət yoxlaması
  srt <transkript.json> [--preset reels] [--out fayl.srt]   transkriptdən SRT
  thumb <video> [--at 2 | --auto] [--out th.jpg]
  motion <səhifə.html> --duration 6 [--audio a.wav] [--size 1080x1920] [--out m.mp4]   HTML → video
  post-draft --video f --caption "..." [--hashtags a,b] [--platforms instagram,tiktok]   paylaşım QARALAMASI (göndərmir)

edit/batch seçimləri:
  --preset reels|tiktok|shorts|feed|square|youtube    (edit üçün, standart reels)
  --fit auto|blur|crop|pad|scale     kadrlaşdırma (auto: en/boy uyğun gəlmirsə bulanıq fon)
  --cut-silence [--noise -35] [--min-silence 0.4]    səssizlikləri kəs
  --transcript t.json | --subs t.srt                 subtitr yandırılır (ə ş ç ğ ı ö ü üçün DejaVu Sans)
  --caption-style line|word                          word: sözbəsöz, cari söz vurğulanır (transkript lazımdır)
  --punch-in                                         kəsikdən sonrakı hər ikinci hissəni 8% yaxınlaşdır
  --clean-voice                                      danışıq təmizləmə (küy, EQ, gate, kompressor)
  --grade warm                                       isti ton + yüngül dən
  --fps 30|source                                    standart 30
  --hook "mətn"   ilk 3 saniyə yuxarıda     --cta "mətn"   son 4 saniyə aşağıda
  --logo logo.png                                    sağ yuxarı loqo
  --music m.mp3 [--music-volume 0.12]                musiqi (danışıq zamanı aşağı düşür). Musiqisiz nüsxə də yazılır
                                                     (--no-music-copy ilə söndürülür). Standart musiqi QOYULMUR
  --dub dublaj.mp3 [--original-volume 0.22 | --mute-original]   dublaj səsi miksi
  --lufs -14 | --no-loudnorm                         səs səviyyəsi (standart -14 LUFS, 2 keçidli)
  --max-sec N   --crf 20   --fast   --dry-run
  --out fayl.mp4 (edit)   --outdir qovluq (batch)
`;

function parseArgs(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const nxt = argv[i + 1];
    if (nxt === undefined || (nxt.startsWith("--") && !/^--?\d/.test(nxt))) o[k] = true;
    else { o[k] = /^-?\d+(\.\d+)?$/.test(nxt) ? Number(nxt) : nxt; i++; }
  }
  return { pos, o };
}
const toOpts = (o) => ({ ...o, loudnorm: o.noLoudnorm ? false : undefined, noMusicCopy: o.noMusicCopy ? false : undefined, music: typeof o.music === "string" ? o.music : undefined, hook: typeof o.hook === "string" ? o.hook : undefined, cta: typeof o.cta === "string" ? o.cta : undefined });

function showSuspicious(t) {
  console.log(`transkript: ${t.words.length} söz, ${t.segments.length} parça → ${t.file}`);
  if (!t.suspicious.length) { console.log("  şübhəli söz işarələnmədi (yenə də mətni oxu: model səhv edə bilər)"); return; }
  console.log(`  ŞÜBHƏLİ (${t.suspicious.length}): Fərid yoxlamalıdır`);
  for (const s of t.suspicious.slice(0, 40)) console.log(`   ${s.time.toFixed(1)} san  "${s.text}"  (${s.reason})`);
}

function showQa(r) {
  const mark = { "keçdi": "KEÇDİ ", "qaldı": "QALDI ", "əl ilə": "ƏL İLƏ", "n/a": "n/a   " };
  for (const i of r.items) console.log(`  ${i.code.padEnd(5)} ${mark[i.status]} ${i.name}: ${i.detail}`);
  console.log(`  yekun: ${r.passed} keçdi, ${r.failed} qaldı, ${r.manual} əl ilə baxılmalı, ${r.na} tətbiq olunmur → ${r.report}`);
  console.log(`  kadrlar: ${r.evidence_dir}`);
}

function show(r) {
  console.log((r.verify && r.verify.ok ? "✔ " : r.dryRun ? "• " : "✘ ") + r.output);
  if (r.dryRun) { console.log(r.command); return; }
  console.log(`  müddət ${r.duration.toFixed(2)} san, subtitr cümlələri: ${r.cues}${r.loudness ? `, səs ${r.loudness.before_lufs} → ${r.loudness.target_lufs} LUFS` : ""}`);
  if (r.noMusicCopy) console.log("  musiqisiz nüsxə: " + r.noMusicCopy);
  for (const c of r.verify.checks) console.log(`  ${c.ok ? "ok " : "XƏTA"} ${c.name}: ${c.detail}`);
  for (const w of r.warnings) console.log("  xəbərdarlıq: " + w);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, o } = parseArgs(rest);
  if (!cmd || cmd === "help" || o.help) return void console.log(HELP);

  if (cmd === "doctor") {
    const d = await doctor();
    for (const c of d.checks) console.log((c.ok ? "ok   " : "XƏTA ") + c.name + (c.detail ? ": " + c.detail : ""));
    const a = await asrStatus(typeof o.model === "string" ? o.model : "turbo");
    const yn = (b) => (b ? "var  " : "YOX  ");
    console.log(`${yn(a.python)}transkripsiya: sherpa-onnx (python)\n${yn(a.model)}transkripsiya: Whisper modeli\n${yn(a.vad)}transkripsiya: VAD modeli\n${yn(a.rnnoise)}səs təmizləmə: RNNoise modeli (yoxdursa afftdn işlənir)`);
    if (!(a.python && a.model && a.vad && a.rnnoise)) console.log("     → npm run studio -- setup-models   (modellər: " + a.dir + ")");
    process.exit(d.ok ? 0 : 1);
  }
  if (cmd === "setup-models") {
    const a = await setupModels({ model: typeof o.model === "string" ? o.model : "turbo", log: (m) => console.log(m) });
    console.log(JSON.stringify(a, null, 2));
    process.exit(a.python && a.model && a.vad ? 0 : 1);
  }
  if (cmd === "analyze") { console.log(JSON.stringify(await analyze(pos[0], { outdir: o.outdir }), null, 2)); return; }
  if (cmd === "transcribe") {
    showSuspicious(await transcribe(pos[0], { lang: o.lang || "az", model: typeof o.model === "string" ? o.model : "turbo", out: o.out }));
    return;
  }
  if (cmd === "qa") {
    let re = null;
    if (o.retranscribe) re = await transcribe(pos[0], { lang: o.lang || "az", model: typeof o.model === "string" ? o.model : "turbo", out: resolve(pos[0]).replace(/\.[^.]+$/, "") + ".retranscript.json" });
    const r = await qa(pos[0], { forbid: typeof o.forbid === "string" ? o.forbid.split(",").map((x) => x.trim()).filter(Boolean) : undefined, retranscript: re, outdir: o.outdir });
    showQa(r);
    process.exit(r.ok ? 0 : 2);
  }
  if (cmd === "motion") {
    const [w, h] = String(o.size || "1080x1920").split("x").map(Number);
    const out = o.out || basename(pos[0], extname(pos[0])) + ".mp4";
    const r = await renderMotion(pos[0], out, { duration: Number(o.duration), fps: o.fps ? Number(o.fps) : undefined, width: w, height: h, audio: typeof o.audio === "string" ? o.audio : null });
    console.log(`✔ ${r.output}\n  ${r.frames} kadr, ${r.info.width}x${r.info.height}, ${r.info.duration.toFixed(2)} san, rejim: ${r.seek}`);
    return;
  }
  if (cmd === "probe") { console.log(JSON.stringify(await probe(pos[0]), null, 2)); return; }
  if (cmd === "thumb") {
    const out = o.out || resolve(pos[0]).replace(/\.[^.]+$/, "") + "-thumb.jpg";
    console.log(await thumbnail(pos[0], out, { at: o.at, auto: !!o.auto }));
    return;
  }
  if (cmd === "srt") {
    const preset = presetOrThrow(o.preset || "reels");
    const words = normalizeTranscript(JSON.parse(await readFile(pos[0], "utf8")));
    const srt = cuesToSrt(groupWords(words, { maxChars: captionLayout(preset).maxChars }));
    if (o.out) { await writeFile(o.out, srt); console.log(resolve(o.out)); } else process.stdout.write(srt);
    return;
  }
  if (cmd === "post-draft") {
    const d = await buildPostDraft({ video: o.video, caption: o.caption, hashtags: o.hashtags, platforms: o.platforms });
    const out = o.out || resolve(String(o.video)).replace(/\.[^.]+$/, "") + ".post.json";
    await writeFile(out, JSON.stringify(d, null, 2) + "\n");
    console.log(JSON.stringify(d, null, 2));
    console.log("\nQaralama yazıldı: " + resolve(out) + " (status: draft_only, heç nə göndərilməyib)");
    return;
  }
  if (cmd === "auto") {
    // Fərid videonu atır → sual vermədən: transkripsiya, montaj, üz qabığı, QA. Paylaşım YOXDUR.
    const input = pos[0];
    if (!input || !(await fileExists(input))) throw new Error("Video faylı tapılmadı: " + input);
    const base = basename(input, extname(input));
    const outdir = resolve(o.outdir || "studio-out");
    const opts = toOpts(o);
    const info = await probe(input);
    if (info.hasAudio && !opts.transcript && !opts.subs && !o.noSubs) {
      const st = await asrStatus(typeof o.model === "string" ? o.model : "turbo");
      if (st.python && st.model && st.vad) {
        const t = await transcribe(input, { lang: o.lang || "az", model: typeof o.model === "string" ? o.model : "turbo", out: join(outdir, base + ".transcript.json") });
        showSuspicious(t);
        if (t.words.length) opts.transcript = t.file;
      } else console.log("transkripsiya modeli yoxdur: altyazısız davam edir (npm run studio -- setup-models)");
    }
    if (info.hasAudio && opts.cutSilence === undefined && !opts.dub) opts.cutSilence = true;
    if (info.hasAudio && opts.cleanVoice === undefined && !opts.music && !opts.dub) opts.cleanVoice = true;
    if (opts.transcript && !opts.captionStyle) opts.captionStyle = "word";
    const prep = await prepare(input, opts);
    if (prep.keep) console.log(`səssizlik kəsmə: ${prep.keep.length} hissə saxlanır, ${prep.info.duration.toFixed(2)} → ${prep.outDur.toFixed(2)} san`);
    const presets = String(o.presets || o.preset || "reels").split(",").map((s) => s.trim());
    let bad = 0;
    for (const p of presets) {
      const out = join(outdir, `${base}-${p}.mp4`);
      const r = await render(prep, p, opts, out);
      show(r);
      if (!r.verify.ok) bad++;
      await thumbnail(out, out.replace(/\.mp4$/, "-thumb.jpg"), { auto: true });
      const q = await qa(out, { forbid: typeof o.forbid === "string" ? o.forbid.split(",").map((x) => x.trim()).filter(Boolean) : undefined });
      showQa(q);
      // Q-12 (təhvil paketi) burada qəsdən sayılmır: platforma mətnini Fərid verir, sonra post-draft yazılır
      if (q.items.some((i) => i.status === "qaldı" && i.code !== "Q-12")) bad++;
    }
    console.log("\nRender olunub, PAYLAŞILMAYIB. Paylaşım üçün Fəridin 'bəli' sözü lazımdır.");
    process.exit(bad ? 2 : 0);
  }
  if (cmd === "edit" || cmd === "batch") {
    const input = pos[0];
    if (!input || !(await fileExists(input))) throw new Error("Video faylı tapılmadı: " + input);
    const opts = toOpts(o);
    const prep = await prepare(input, opts);
    const base = basename(input, extname(input));
    if (prep.keep) console.log(`səssizlik kəsmə: ${prep.keep.length} hissə saxlanır, ${prep.info.duration.toFixed(2)} → ${prep.outDur.toFixed(2)} san`);
    const presets = cmd === "batch" ? String(o.presets || "reels,feed,youtube").split(",").map((s) => s.trim()) : [o.preset || "reels"];
    let bad = 0;
    for (const p of presets) {
      const out = cmd === "batch" ? join(o.outdir || "studio-out", `${base}-${p}.mp4`) : o.out || `${base}-${p}.mp4`;
      const r = await render(prep, p, opts, out);
      show(r);
      if (r.verify && !r.verify.ok) bad++;
    }
    process.exit(bad ? 2 : 0);
  }
  console.error("Naməlum əmr: " + cmd + "\n\n" + HELP);
  process.exit(1);
}
main().catch((e) => { console.error("XƏTA: " + e.message); process.exit(1); });
