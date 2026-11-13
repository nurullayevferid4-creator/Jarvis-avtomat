#!/usr/bin/env node
// Video studiya CLI. İstifadə: node studio/cli.mjs <əmr> ...   (npm run studio -- <əmr> ...)
import { writeFile, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { PRESETS, doctor, probe, prepare, render, thumbnail, normalizeTranscript, groupWords, cuesToSrt, captionLayout, buildPostDraft, presetOrThrow, fileExists } from "./lib.mjs";

const HELP = `Video studiya (ffmpeg). Əmrlər:

  doctor                          mühiti yoxla (ffmpeg, filtrlər, şrift)
  probe <video>                   ölçü, müddət, kodek, səs
  edit <video> [seçimlər]         tam montaj: tək platforma üçün
  batch <video> --presets a,b,c   eyni videodan bir neçə platforma faylı
  srt <transkript.json> [--preset reels] [--out fayl.srt]   transkriptdən SRT
  thumb <video> [--at 2 | --auto] [--out th.jpg]
  post-draft --video f --caption "..." [--hashtags a,b] [--platforms instagram,tiktok]   paylaşım QARALAMASI (göndərmir)

edit/batch seçimləri:
  --preset reels|tiktok|shorts|feed|square|youtube    (edit üçün, standart reels)
  --fit auto|blur|crop|pad|scale     kadrlaşdırma (auto: en/boy uyğun gəlmirsə bulanıq fon)
  --cut-silence [--noise -35] [--min-silence 0.4]    səssizlikləri kəs
  --transcript t.json | --subs t.srt                 subtitr yandırılır (ə ş ç ğ ı ö ü üçün DejaVu Sans)
  --hook "mətn"   ilk 3 saniyə yuxarıda     --cta "mətn"   son 4 saniyə aşağıda
  --logo logo.png                                    sağ yuxarı loqo
  --music m.mp3 [--music-volume 0.12]                musiqi (danışıq zamanı avtomatik aşağı düşür)
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
const toOpts = (o) => ({ ...o, loudnorm: o.noLoudnorm ? false : undefined, hook: typeof o.hook === "string" ? o.hook : undefined, cta: typeof o.cta === "string" ? o.cta : undefined });

function show(r) {
  console.log((r.verify && r.verify.ok ? "✔ " : r.dryRun ? "• " : "✘ ") + r.output);
  if (r.dryRun) { console.log(r.command); return; }
  console.log(`  müddət ${r.duration.toFixed(2)} san, subtitr cümlələri: ${r.cues}${r.loudness ? `, səs ${r.loudness.before_lufs} → ${r.loudness.target_lufs} LUFS` : ""}`);
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
    process.exit(d.ok ? 0 : 1);
  }
  if (cmd === "probe") { console.log(JSON.stringify(await probe(pos[0]), null, 2)); return; }
  if (cmd === "thumb") {
    const out = o.out || basename(pos[0], extname(pos[0])) + "-thumb.jpg";
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
    const out = o.out || "post-draft.json";
    await writeFile(out, JSON.stringify(d, null, 2) + "\n");
    console.log(JSON.stringify(d, null, 2));
    console.log("\nQaralama yazıldı: " + resolve(out) + " (status: draft_only, heç nə göndərilməyib)");
    return;
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
