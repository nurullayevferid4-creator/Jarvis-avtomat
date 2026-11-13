// Video analizi və 12 bəndlik keyfiyyət yoxlaması (Q-1 … Q-12).
// Avtomatik ölçülə bilənlər ölçülür; göz tələb edənlər üçün kadrlar çıxarılır və "əl ilə" kimi işarələnir.
// Heç bir bənd ölçülmədən "keçdi" yazılmır.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { run, probe, parseSilence, parseEbur128, readingTime, fileExists, SAFE, MIN_TITLE_PX, MIN_LABEL_PX, DEFAULT_FPS } from "./lib.mjs";

export { parseEbur128 };

const FFQ = ["-nostdin", "-hide_banner"];
const r2 = (n) => Math.round(n * 100) / 100;

export async function loudness(file) {
  const r = await run("ffmpeg", [...FFQ, "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  return parseEbur128(r.stderr);
}

export async function silences(file, duration, { noise = -35, min = 0.3 } = {}) {
  const r = await run("ffmpeg", [...FFQ, "-i", file, "-vn", "-af", `silencedetect=noise=${noise}dB:d=${min}`, "-f", "null", "-"]);
  return parseSilence(r.stderr, duration);
}

export async function sceneCuts(file, threshold = 0.25) {
  const r = await run("ffmpeg", [...FFQ, "-i", file, "-an", "-vf", `select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"]);
  return [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => r2(parseFloat(m[1])));
}

// Kontakt vərəqi: videonun bərabər aralıqlı kadrları bir şəkildə
export async function contactSheet(file, out, { duration, perSecond = null, cols = 6, max = 36, width = 270 } = {}) {
  const n = Math.max(1, Math.min(max, Math.ceil(perSecond ? duration * perSecond : duration / 2)));
  const rate = Math.max(n / Math.max(duration, 0.1), 0.01);
  const rows = Math.ceil(n / cols);
  await mkdir(dirname(resolve(out)), { recursive: true });
  await run("ffmpeg", [...FFQ, "-y", "-i", file, "-an", "-vf", `fps=${rate.toFixed(4)},scale=${width}:-1,tile=${cols}x${rows}`, "-frames:v", "1", "-q:v", "3", resolve(out)]);
  return { file: resolve(out), frames: n };
}

export async function analyze(file, { outdir } = {}) {
  const info = await probe(file);
  const dir = resolve(outdir || file.replace(/\.[^.]+$/, "") + "-analiz");
  await mkdir(dir, { recursive: true });
  const out = { file: resolve(file), info: { ...info, duration: r2(info.duration), aspect: r2(info.aspect) } };
  out.scene_cuts = await sceneCuts(file);
  out.avg_shot_seconds = r2(info.duration / (out.scene_cuts.length + 1));
  if (info.hasAudio) {
    out.loudness = await loudness(file);
    const sil = await silences(file, info.duration);
    out.silences = sil.map((s) => [r2(s.start), r2(s.end)]);
    out.silence_total = r2(sil.reduce((n, s) => n + (s.end - s.start), 0));
  }
  out.contact_sheet = (await contactSheet(file, join(dir, "sheet.jpg"), { duration: info.duration })).file;
  await writeFile(join(dir, "analiz.json"), JSON.stringify(out, null, 2) + "\n");
  out.report = join(dir, "analiz.json");
  return out;
}

async function frameAt(file, t, out, vf = null) {
  const args = [...FFQ, "-y", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-q:v", "2"];
  if (vf) args.push("-vf", vf);
  await run("ffmpeg", [...args, out]);
  return out;
}

// Şrift bu hərfləri çəkə bilirmi (boş qutu olmasın)
export async function missingGlyphs(text, family = "DejaVu Sans") {
  const chars = [...new Set([...String(text)].filter((c) => c.codePointAt(0) > 0x7f && /\S/u.test(c)))];
  const missing = [];
  for (const c of chars) {
    const hex = c.codePointAt(0).toString(16);
    try {
      const r = await run("fc-list", [`:charset=${hex}`, "family"]);
      if (!r.stdout.split("\n").some((l) => l.split(",").some((f) => f.trim() === family))) missing.push(c);
    } catch { missing.push(c); }
  }
  return { checked: chars, missing };
}

async function pauseNoise(file, sil) {
  const wins = sil.map((s) => [s.start + 0.08, s.end - 0.08]).filter(([a, b]) => b - a >= 0.15).slice(0, 60);
  if (!wins.length) return null;
  const sel = wins.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
  const r = await run("ffmpeg", [...FFQ, "-i", file, "-vn", "-af", `aselect='${sel}',astats=measure_perchannel=none:measure_overall=RMS_level`, "-f", "null", "-"]);
  const m = r.stderr.match(/RMS level dB:\s+(-?[\d.]+|-inf)/);
  return m ? (m[1] === "-inf" ? -Infinity : parseFloat(m[1])) : null;
}

const normW = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// retranscript: { words:[{text,start,end}] } (istəyə görə; hazır videonun yenidən transkripsiyası)
export async function qa(file, { forbid = ["pulsuz"], retranscript = null, outdir } = {}) {
  const base = resolve(file).replace(/\.[^.]+$/, "");
  const dir = resolve(outdir || base + "-qa");
  await mkdir(dir, { recursive: true });
  const info = await probe(file);
  const side = (await fileExists(base + ".studio.json")) ? JSON.parse(await readFile(base + ".studio.json", "utf8")) : null;
  const items = [];
  const add = (code, name, status, detail, evidence) => items.push({ code, name, status, detail, ...(evidence ? { evidence } : {}) });
  const NA = "studiya yan faylı (.studio.json) yoxdur: bu bənd yalnız studiyada render olunan fayl üçün ölçülür";
  const sil = info.hasAudio ? await silences(file, info.duration) : [];
  const inSilence = (a, b) => sil.some((s) => s.start <= a && s.end >= b);
  const texts = side ? [side.hook && side.hook.text, side.cta && side.cta.text, ...(side.cues || []).map((c) => c.text)].filter(Boolean) : [];

  // Q-1 Hook
  const hookFrames = [];
  for (const t of [0.5, 1.0, 2.0]) if (t < info.duration) hookFrames.push(await frameAt(file, t, join(dir, `hook-${t.toFixed(1)}.jpg`)));
  if (side) {
    const textBy2 = !!side.hook || (side.cues || []).some((c) => c.start <= 2);
    const soundBy2 = info.hasAudio && !inSilence(0, Math.min(2, info.duration));
    const ok = textBy2 && (soundBy2 || !info.hasAudio);
    add("Q-1", "Hook", ok ? "əl ilə" : "qaldı", `ilk 2 san: ekranda yazı ${textBy2 ? "var" : "YOXDUR"}, səs ${info.hasAudio ? (soundBy2 ? "var" : "YOXDUR") : "yoxdur (səssiz video)"}. Yazının problemi/faydanı deməsi gözlə yoxlanmalıdır`, hookFrames);
  } else add("Q-1", "Hook", "əl ilə", "0.5 / 1.0 / 2.0 san kadrlarına bax", hookFrames);

  // Q-2 Yazı ölçüsü
  if (side) {
    const k = 1080 / side.width;
    const cap = side.caption_style ? Math.round(side.layout.caption_px * k) : null;
    const hk = side.hook ? Math.round(side.layout.hook_px * k) : null;
    const bad = (hk !== null && hk < MIN_TITLE_PX) || (cap !== null && cap < MIN_LABEL_PX);
    add("Q-2", "Yazı ölçüsü", hk === null && cap === null ? "n/a" : bad ? "qaldı" : "keçdi", `başlıq ${hk ?? "yoxdur"} px (≥ ${MIN_TITLE_PX}), altyazı ${cap ?? "yoxdur"} px (≥ ${MIN_LABEL_PX}), 1080 enə görə`);
  } else add("Q-2", "Yazı ölçüsü", "n/a", NA);

  // Q-3 Oxuma vaxtı (ekran yazıları: hook və CTA; danışıqla sinxron altyazı danışıq qədər qalır)
  if (side && (side.hook || side.cta)) {
    const rows = [["hook", side.hook], ["CTA", side.cta]].filter(([, x]) => x).map(([n, x]) => ({ n, have: x.end - x.start, need: readingTime(x.text) }));
    const bad = rows.filter((x) => x.have < x.need - 0.05);
    add("Q-3", "Oxuma vaxtı", bad.length ? "qaldı" : "keçdi", rows.map((x) => `${x.n}: ${r2(x.have)} san (lazım ≥ ${r2(x.need)})`).join("; "));
  } else add("Q-3", "Oxuma vaxtı", "n/a", side ? "hook/CTA yazısı yoxdur" : NA);

  // Q-4 Hərflər
  if (texts.length) {
    const g = await missingGlyphs(texts.join(" "), side.font || "DejaVu Sans");
    const ev = [];
    const firstCue = (side.cues || [])[0];
    if (firstCue) ev.push(await frameAt(file, (firstCue.start + firstCue.end) / 2, join(dir, "herfler-altyazi.jpg"), `crop=iw:ih*0.34:0:ih*0.56`));
    if (side.hook) ev.push(await frameAt(file, Math.min(0.6, info.duration / 2), join(dir, "herfler-hook.jpg"), `crop=iw:ih*0.34:0:ih*0.06`));
    add("Q-4", "Hərflər", g.missing.length ? "qaldı" : "əl ilə", g.missing.length ? `${side.font || "DejaVu Sans"} şriftində yoxdur (başqa şriftdən götürülür, fərqli görünə bilər): ${g.missing.join(" ")}` : `${side.font || "DejaVu Sans"} şrifti bütün xüsusi hərfləri dəstəkləyir (${g.checked.join(" ") || "xüsusi hərf yoxdur"}); kəsik kadrlara gözlə bax`, ev);
  } else add("Q-4", "Hərflər", "n/a", side ? "ekran yazısı yoxdur" : NA);

  // Q-5 Faktlar
  const all = texts.join(" ").toLowerCase();
  const hit = forbid.filter((w) => w && all.includes(String(w).toLowerCase()));
  add("Q-5", "Faktlar", hit.length ? "qaldı" : "əl ilə", hit.length ? `qadağan söz tapıldı: ${hit.join(", ")}` : `qadağan söz (${forbid.join(", ") || "siyahı boşdur"}) yoxdur; qiymət və iddiaları Fərid təsdiqləməlidir`);

  // Q-6 Səs səviyyəsi
  let loud = null;
  if (info.hasAudio) {
    loud = await loudness(file);
    const target = side && side.target_lufs !== null && side.target_lufs !== undefined ? side.target_lufs : -14;
    const ok = loud.lufs !== null && Math.abs(loud.lufs - target) <= 1 && loud.true_peak !== null && loud.true_peak <= -1.5 + 0.05;
    add("Q-6", "Səs səviyyəsi", ok ? "keçdi" : "qaldı", `${loud.lufs} LUFS (hədəf ${target} ±1), true peak ${loud.true_peak} dBFS (≤ −1.5)`);
  } else add("Q-6", "Səs səviyyəsi", "n/a", "videoda səs yoxdur");

  // Q-7 Səs təmizliyi (fasilələrdə küy)
  if (!info.hasAudio) add("Q-7", "Səs təmizliyi", "n/a", "videoda səs yoxdur");
  else if (side && side.has_music) add("Q-7", "Səs təmizliyi", "n/a", "musiqi var: fasilə küyü musiqisiz nüsxədə ölçülür");
  else {
    const nz = await pauseNoise(file, sil);
    if (nz === null) add("Q-7", "Səs təmizliyi", "n/a", "ölçmək üçün ≥ 0.3 san fasilə yoxdur");
    else add("Q-7", "Səs təmizliyi", nz <= -50 ? "əl ilə" : "qaldı", `fasilələrdə orta səviyyə ${nz === -Infinity ? "−∞" : r2(nz)} dB (≤ −50). Nəfəs, klik və zərbə dinləmə ilə yoxlanmalıdır`);
  }

  // Q-8 Sinxron
  const cues = side ? side.cues || [] : [];
  if (!cues.length) add("Q-8", "Sinxron", "n/a", side ? "altyazı yoxdur" : NA);
  else if (retranscript && Array.isArray(retranscript.words) && retranscript.words.length) {
    const deltas = [];
    let unmatched = 0;
    for (const c of cues) {
      const first = normW(String(c.text).split(/\s+/)[0]);
      const cand = retranscript.words.filter((w) => normW(w.text) === first).map((w) => Math.abs(w.start - c.start));
      if (cand.length) deltas.push(Math.min(...cand)); else unmatched++;
    }
    deltas.sort((a, b) => a - b);
    const med = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
    const ok = med !== null && med <= 0.3 && unmatched <= cues.length * 0.3;
    add("Q-8", "Sinxron", ok ? "keçdi" : "qaldı", `yenidən transkripsiya: ${deltas.length}/${cues.length} altyazı tutuşduruldu, median fərq ${med === null ? "yoxdur" : r2(med) + " san"} (≤ 0.3), maksimum ${deltas.length ? r2(deltas[deltas.length - 1]) : "yoxdur"}. Söz vaxtları təxminidir`);
  } else if (side.has_music || side.has_dub) add("Q-8", "Sinxron", "əl ilə", "musiqi/dublaj var: avtomatik nitq yoxlaması etibarlı deyil, --retranscribe işlət");
  else {
    const off = cues.filter((c) => inSilence(c.start - 0.05, Math.min(c.start + 0.3, c.end)));
    add("Q-8", "Sinxron", off.length ? "qaldı" : "əl ilə", off.length ? `${off.length} altyazı səssiz yerdə başlayır (ilk: ${r2(off[0].start)} san)` : `hər altyazı nitq olan yerdə başlayır (${cues.length} altyazı). Söz dəqiqliyi üçün --retranscribe işlət`);
  }

  // Q-9 Təhlükəsiz zona
  if (side && side.vertical && (side.caption_style || side.hook || side.cta)) {
    const bottomOk = side.layout.caption_margin_bottom >= side.height * SAFE.bottomPct;
    const rightOk = side.layout.margin_right >= side.width * SAFE.rightPct - 0.5;
    const topOk = side.layout.hook_margin_top >= SAFE.top;
    add("Q-9", "Təhlükəsiz zona", bottomOk && rightOk && topOk ? "keçdi" : "qaldı", `aşağı boşluq ${side.layout.caption_margin_bottom} px (≥ ${Math.round(side.height * SAFE.bottomPct)}), sağ ${side.layout.margin_right} px (≥ ${Math.round(side.width * SAFE.rightPct)}), yuxarı ${side.layout.hook_margin_top} px (≥ ${SAFE.top})`);
  } else add("Q-9", "Təhlükəsiz zona", "n/a", side ? (side.vertical ? "ekran yazısı yoxdur" : "9:16 deyil") : NA);

  // Q-10 Keçidlər
  const sheet = await contactSheet(file, join(dir, "sheet-1fps.jpg"), { duration: info.duration, perSecond: 1, max: 60, width: 180 });
  add("Q-10", "Keçidlər", "əl ilə", `saniyədə 1 kadrlıq vərəqə bax (${sheet.frames} kadr)${side ? `; studiya ${side.cuts} sərt kəsik edib, başqa keçid növü əlavə etməyib` : ""}`, [sheet.file]);

  // Q-11 Fayl
  {
    const wantW = side ? side.width : 1080, wantH = side ? side.height : 1920, wantFps = side ? side.fps : DEFAULT_FPS;
    const c = [
      [info.width === wantW && info.height === wantH, `${info.width}x${info.height} (gözlənilən ${wantW}x${wantH})`],
      [Math.abs(info.fps - wantFps) < 0.5, `${r2(info.fps)} fps (gözlənilən ${wantFps})`],
      [info.vcodec === "h264", info.vcodec],
      [!info.hasAudio || info.acodec === "aac", info.hasAudio ? info.acodec : "səs yoxdur"],
    ];
    if (side) c.push([Math.abs(info.duration - side.expected_duration) <= 0.4, `${r2(info.duration)} san (gözlənilən ${r2(side.expected_duration)})`]);
    add("Q-11", "Fayl", c.every((x) => x[0]) ? "keçdi" : "qaldı", c.map((x) => (x[0] ? "" : "XƏTA ") + x[1]).join(", "));
  }

  // Q-12 Təhvil paketi
  {
    const thumb = (await fileExists(base + "-thumb.jpg")) ? base + "-thumb.jpg" : null;
    let post = null, draftOnly = false;
    if (await fileExists(base + ".post.json")) { post = base + ".post.json"; try { draftOnly = JSON.parse(await readFile(post, "utf8")).status === "draft_only"; } catch { /* oxunmadı */ } }
    const miss = [!thumb && "üz qabığı (thumb)", !post && "platforma mətni (post-draft)", post && !draftOnly && "mətn 'draft_only' deyil"].filter(Boolean);
    add("Q-12", "Təhvil", miss.length ? "qaldı" : "keçdi", miss.length ? "çatmır: " + miss.join(", ") : `video + ${basename(thumb)} + ${basename(post)} (draft_only, paylaşılmayıb)`);
  }

  const count = (s) => items.filter((i) => i.status === s).length;
  const report = { file: resolve(file), studio_sidecar: !!side, ok: count("qaldı") === 0, passed: count("keçdi"), failed: count("qaldı"), manual: count("əl ilə"), na: count("n/a"), loudness: loud, items, evidence_dir: dir };
  await writeFile(base + ".qa.json", JSON.stringify(report, null, 2) + "\n");
  report.report = base + ".qa.json";
  return report;
}
