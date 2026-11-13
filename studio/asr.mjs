// Yerli transkripsiya sarğısı (studio/asr.py) və model quraşdırma. Pulsuzdur, xarici API çağırılmır.
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, MODELS_DIR, fileExists } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";
export const ASR_MODELS = ["turbo", "large-v3", "medium", "small"];
const RNN_URL = "https://raw.githubusercontent.com/richardpl/arnndn-models/master/sh.rnnn";

export async function asrStatus(model = "turbo") {
  let python = false;
  try { await run("python3", ["-c", "import sherpa_onnx, numpy"]); python = true; } catch { /* quraşdırılmayıb */ }
  return {
    python,
    model: await fileExists(join(MODELS_DIR, "sherpa-onnx-whisper-" + model, model + "-tokens.txt")),
    vad: await fileExists(join(MODELS_DIR, "silero_vad.onnx")),
    rnnoise: await fileExists(join(MODELS_DIR, "rnn", "sh.rnnn")),
    dir: MODELS_DIR,
  };
}

// Modelləri GitHub release-dən yükləyir (turbo ≈ 564 MB). Repoya heç nə düşmür.
export async function setupModels({ model = "turbo", log = () => {} } = {}) {
  if (!ASR_MODELS.includes(model)) throw new Error("Naməlum model: " + model + " (" + ASR_MODELS.join(", ") + ")");
  await mkdir(join(MODELS_DIR, "rnn"), { recursive: true });
  const st = await asrStatus(model);
  if (!st.python) { log("sherpa-onnx quraşdırılır (pip)..."); await run("python3", ["-m", "pip", "install", "-q", "sherpa-onnx", "numpy"]); }
  const dl = (url, out) => run("curl", ["-fsSL", "--retry", "3", "-o", out, url], { timeoutMs: 60 * 60 * 1000 });
  if (!st.vad) { log("VAD modeli yüklənir..."); await dl(REL + "silero_vad.onnx", join(MODELS_DIR, "silero_vad.onnx")); }
  if (!st.rnnoise) { log("RNNoise modeli yüklənir..."); await dl(RNN_URL, join(MODELS_DIR, "rnn", "sh.rnnn")); }
  if (!st.model) {
    log("Whisper " + model + " yüklənir (böyük fayl, bir neçə dəqiqə çəkə bilər)...");
    const tar = join(MODELS_DIR, "whisper-" + model + ".tar.bz2");
    await dl(REL + "sherpa-onnx-whisper-" + model + ".tar.bz2", tar);
    await run("tar", ["xjf", tar, "-C", MODELS_DIR]);
    await rm(tar, { force: true });
  }
  return asrStatus(model);
}

export async function transcribe(input, { lang = "az", model = "turbo", out } = {}) {
  const st = await asrStatus(model);
  if (!st.python || !st.model || !st.vad) throw new Error("Transkripsiya hazır deyil. Əvvəl: npm run studio -- setup-models" + (model !== "turbo" ? " --model " + model : ""));
  const outFile = resolve(out || input.replace(/\.[^.]+$/, "") + ".transcript.json");
  await mkdir(dirname(outFile), { recursive: true });
  await run("python3", [join(HERE, "asr.py"), resolve(input), "--lang", String(lang), "--model", model, "--models-dir", MODELS_DIR, "--out", outFile], { timeoutMs: 2 * 60 * 60 * 1000 });
  const json = JSON.parse(await readFile(outFile, "utf8"));
  return { file: outFile, ...json };
}
