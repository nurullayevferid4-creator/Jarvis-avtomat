#!/usr/bin/env python3
"""Yerli, pulsuz danışıq → mətn (sherpa-onnx Whisper + silero VAD).

İki keçid edilir (uzun və qısa parçalarla) və nəticələr tutuşdurulur: uyğun gəlməyən sözlər "şübhəli"
kimi işarələnir ki, Fərid baxsın. Model musiqinin üstündə olmayan cümlə uydura bilər, ona görə
altyazı heç vaxt yoxlanmadan "düzgündür" sayılmır.

Söz vaxtları TƏXMİNİDİR: model söz-söz vaxt vermir, sözlər qısa nitq parçasının daxilində
uzunluğuna görə paylanır.
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys

import numpy as np

SR = 16000
MODEL_FILES = {
    "turbo": ("sherpa-onnx-whisper-turbo", "turbo"),
    "large-v3": ("sherpa-onnx-whisper-large-v3", "large-v3"),
    "medium": ("sherpa-onnx-whisper-medium", "medium"),
    "small": ("sherpa-onnx-whisper-small", "small"),
}
# Whisper-in səssizlik/musiqi üstündə tez-tez uydurduğu ifadələr (keçmiş işlərdə müşahidə olunub)
HALLUCINATIONS = [
    "teşekkür ederim", "altyazı", "abone ol", "izlediğiniz için", "thanks for watching", "thank you for watching",
    "subtitles by", "betimlemesi", "dizinin", "subscribe",
]


def load_audio(path):
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def find_model(models_dir, name):
    folder, prefix = MODEL_FILES[name]
    base = os.path.join(models_dir, folder)
    pick = lambda kind: next((os.path.join(base, f) for f in (f"{prefix}-{kind}.int8.onnx", f"{prefix}-{kind}.onnx") if os.path.exists(os.path.join(base, f))), None)
    enc, dec, tok = pick("encoder"), pick("decoder"), os.path.join(base, f"{prefix}-tokens.txt")
    if not (enc and dec and os.path.exists(tok)):
        raise SystemExit(f"Model tapılmadı: {base}. Əvvəl: npm run studio -- setup-models --model {name}")
    return enc, dec, tok


def vad_segments(sherpa_onnx, vad_path, audio, max_speech, min_silence):
    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = vad_path
    cfg.silero_vad.threshold = 0.5
    cfg.silero_vad.min_silence_duration = min_silence
    cfg.silero_vad.min_speech_duration = 0.2
    cfg.silero_vad.max_speech_duration = max_speech
    cfg.sample_rate = SR
    vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=120)
    win = cfg.silero_vad.window_size
    out = []

    def drain():
        while not vad.empty():
            seg = vad.front
            out.append((seg.start / SR, np.array(seg.samples, dtype=np.float32)))
            vad.pop()

    for i in range(0, len(audio) - win + 1, win):
        vad.accept_waveform(audio[i : i + win])
        drain()
    vad.flush()
    drain()
    return out


def transcribe_pass(sherpa_onnx, rec, segs):
    res = []
    for start, samples in segs:
        st = rec.create_stream()
        st.accept_waveform(SR, samples)
        rec.decode_stream(st)
        text = st.result.text.strip()
        if text:
            res.append({"start": round(start, 3), "end": round(start + len(samples) / SR, 3), "text": text})
    return res


norm = lambda w: re.sub(r"[^\w]", "", w.lower(), flags=re.UNICODE)


def spread_words(seg):
    words = seg["text"].split()
    total = sum(max(1, len(w)) for w in words) or 1
    # Parçanın sonundakı VAD payı (təxminən 0.1 san) sözlərə verilmir
    start, end = seg["start"], max(seg["start"] + 0.2, seg["end"] - 0.1)
    t, out = start, []
    for w in words:
        d = (end - start) * max(1, len(w)) / total
        out.append({"text": w, "start": round(t, 3), "end": round(t + d, 3)})
        t += d
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--lang", default="az")
    ap.add_argument("--model", default="turbo", choices=list(MODEL_FILES))
    ap.add_argument("--models-dir", required=True)
    ap.add_argument("--threads", type=int, default=max(1, min(8, os.cpu_count() or 2)))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    try:
        import sherpa_onnx
    except ImportError:
        raise SystemExit("sherpa-onnx quraşdırılmayıb. Əvvəl: pip install sherpa-onnx")
    vad_path = os.path.join(a.models_dir, "silero_vad.onnx")
    if not os.path.exists(vad_path):
        raise SystemExit("VAD modeli tapılmadı. Əvvəl: npm run studio -- setup-models")
    enc, dec, tok = find_model(a.models_dir, a.model)
    audio = load_audio(a.input)
    duration = len(audio) / SR
    rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=enc, decoder=dec, tokens=tok, language=a.lang, task="transcribe", num_threads=a.threads, tail_paddings=1000)

    # B keçidi (qısa parçalar): mətn və vaxtlar üçün əsas. A keçidi (uzun parçalar): tutuşdurma üçün.
    seg_b = transcribe_pass(sherpa_onnx, rec, vad_segments(sherpa_onnx, vad_path, audio, 7.0, 0.25))
    seg_a = transcribe_pass(sherpa_onnx, rec, vad_segments(sherpa_onnx, vad_path, audio, 12.0, 0.5))

    words = [w for s in seg_b for w in spread_words(s)]
    a_words = [norm(w) for s in seg_a for w in s["text"].split()]
    b_words = [norm(w["text"]) for w in words]
    sm = difflib.SequenceMatcher(None, b_words, a_words, autojunk=False)
    matched = [False] * len(words)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            matched[blk.a + k] = True

    suspicious = []
    for i, w in enumerate(words):
        if not matched[i]:
            w["suspicious"] = True
            suspicious.append({"time": w["start"], "text": w["text"], "reason": "iki keçid fərqli nəticə verdi"})
    for s in seg_b:
        low = s["text"].lower()
        cps = len(s["text"]) / max(0.2, s["end"] - s["start"])
        hit = next((h for h in HALLUCINATIONS if h in low), None)
        if hit:
            suspicious.append({"time": s["start"], "text": s["text"], "reason": f"model tez-tez uydurduğu ifadə: '{hit}'"})
        elif cps > 28:
            suspicious.append({"time": s["start"], "text": s["text"], "reason": "parçanın müddətinə görə mətn çox uzundur (uydurma ola bilər)"})
    suspicious.sort(key=lambda x: x["time"])

    result = {
        "engine": "sherpa-onnx whisper " + a.model,
        "language": a.lang,
        "duration": round(duration, 3),
        "word_timing": "approximate",
        "verified_by_human": False,
        "segments": seg_b,
        "segments_long_pass": seg_a,
        "words": words,
        "suspicious": suspicious,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print(json.dumps({"segments": len(seg_b), "words": len(words), "suspicious": len(suspicious), "duration": round(duration, 2)}, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
