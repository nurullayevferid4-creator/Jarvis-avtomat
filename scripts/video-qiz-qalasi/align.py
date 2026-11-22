# Söz vaxtlarını təxmin et: səs enerjisinə görə sükutları tap, mətni "danışıq vaxtı"na simvol sayına görə payla
import json, sys, wave, numpy as np
S = sys.argv[1]
script = json.load(open(f'{S}/qq/script.json'))
out = []
for i, (key, text) in enumerate(script):
    w = wave.open(f'{S}/qq/vo/c{i}.wav'); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)/32768
    hop = int(sr*0.01); n = len(x)//hop
    rms = np.sqrt((x[:n*hop].reshape(n, hop)**2).mean(1))
    thr = max(0.012, np.percentile(rms, 95)*0.08)
    sp = rms > thr
    # 120 ms-dən qısa boşluqları doldur
    k = 0
    while k < n:
        if not sp[k]:
            j = k
            while j < n and not sp[j]: j += 1
            if j - k < 12 and k > 0 and j < n: sp[k:j] = True
            k = j
        else: k += 1
    idx = np.where(sp)[0]
    t_speech = idx*0.01  # danışıq çərçivələri
    words = text.split()
    # çəki: hərf sayı + durğu işarəsindən sonra kiçik fasilə
    wts = [len(wd.strip('.,:?!')) + 1.5 for wd in words]
    cum = np.concatenate([[0], np.cumsum(wts)])/sum(wts)
    res = []
    for wd, c in zip(words, cum[:-1]):
        fi = min(len(t_speech)-1, int(c*len(t_speech)))
        res.append((wd, round(float(t_speech[fi]), 3)))
    out.append(dict(key=key, dur=len(x)/sr, words=res, end=float(t_speech[-1])))
json.dump(out, open(f'{S}/qq/align.json', 'w'), ensure_ascii=False, indent=0)
for o in out[:3]: print(o['key'], o['words'][:6], o['end'])
