# Orijinal sənədli musiqi: D drone + hicaz ladında pluck melodiya, fəsil "boom", düymə klikləri, keçid swoosh
import json, sys, wave, numpy as np
tl = json.load(open(sys.argv[1])); sc = tl["scenes"]; out = sys.argv[2]; tempo = tl["tempo"]
al = json.load(open(sys.argv[3]))
SR = 48000; DUR = tl["dur"] + 0.3; N = int(DUR*SR); rng = np.random.default_rng(11)
t = np.arange(N)/SR
def n2f(n): return 440*2**((n-69)/12)
mus = np.zeros(N)
# drone: D2 + A2, yavaş nəfəs
for n, g in ((38, 0.5), (45, 0.3), (50, 0.18)):
    f = n2f(n); lfo = 0.6 + 0.4*np.sin(2*np.pi*t/9 + n)
    mus += g*lfo*(np.sin(2*np.pi*f*t) + 0.3*np.sin(2*np.pi*2*f*t + 0.5))
# pluck melodiya (D hicaz: D Eb F# G A Bb C)
scale = [62, 63, 66, 67, 69, 70, 72, 74]
def pluck(f, ln=1.2):
    tt = np.arange(int(ln*SR))/SR
    x = sum(np.sin(2*np.pi*f*k*tt + k)/(k**1.3) for k in range(1, 7))
    return x*np.exp(-tt*3.2)*(1-np.exp(-tt*300))
pos = 0.0; idx = 3
while pos < DUR - 1:
    idx = int(np.clip(idx + rng.choice([-2, -1, -1, 1, 1, 2, 0]), 0, len(scale)-1))
    x = pluck(n2f(scale[idx])); i0 = int(pos*SR); i1 = min(N, i0+len(x))
    mus[i0:i1] += 0.35*x[:i1-i0]
    pos += rng.choice([0.75, 0.75, 1.5, 1.5, 2.25, 3.0])
mus /= np.abs(mus).max()
sfx = np.zeros(N)
def add(tsec, x, g):
    i0 = int(tsec*SR); i1 = min(N, i0+len(x))
    if 0 <= i0 < N: sfx[i0:i1] += g*x[:i1-i0]
def boom():
    tt = np.arange(int(2.0*SR))/SR
    return np.sin(2*np.pi*(38+60*np.exp(-tt*6))*tt)*np.exp(-tt*1.8) + 0.3*rng.standard_normal(len(tt))*np.exp(-tt*8)
def click():
    tt = np.arange(int(0.06*SR))/SR
    return np.sin(2*np.pi*1800*tt)*np.exp(-tt*120) + 0.5*rng.standard_normal(len(tt))*np.exp(-tt*200)
def ding(f=1318.5):
    tt = np.arange(int(1.0*SR))/SR
    return (np.sin(2*np.pi*f*tt) + 0.4*np.sin(2*np.pi*f*2*tt))*np.exp(-tt*5)
def swoosh():
    ln = int(0.6*SR); tt = np.arange(ln)/SR
    nz = np.convolve(rng.standard_normal(ln), np.ones(8)/8, "same")
    return nz*np.exp(-((tt-0.3)**2)/0.012)
for s in sc[1:]:
    add(s["t0"] - 0.3, swoosh(), 0.35)
    if s["key"] in ("title", "leg0", "ev0"): add(s["t0"] + 0.05, boom(), 0.9)
# düymə klikləri (qq.py-dakı vaxtlarla eyni)
def wtime(key_scene, word, k=0):
    s = next(x for x in sc if x["key"] == key_scene); a = al[s["idx"]]
    n = 0
    for w, tw in a["words"]:
        if word.lower() in w.lower():
            if n == k: return s["vs"] + tw/tempo
            n += 1
for scn, wsub, wlike, dsub, dlike in (("intro", "subscribe", "like", 0.25, 0.2), ("end", "subscribe", "like", 0.25, 0.2)):
    ts = wtime(scn, wsub); tlk = wtime(scn, wlike)
    add(ts + dsub, click(), 0.8); add(ts + dsub + 0.02, ding(1046.5), 0.25)
    add(tlk + dlike, click(), 0.8); add(tlk + dlike + 0.02, ding(1318.5), 0.3)
sfx /= max(1e-9, np.abs(sfx).max())
mix = mus*0.55 + sfx*0.6
fade = np.ones(N); fo = int(3*SR); fade[-fo:] = np.linspace(1, 0, fo); fade[:int(0.5*SR)] = np.linspace(0, 1, int(0.5*SR))
mix *= fade
st = np.stack([mix, np.roll(mix, int(0.011*SR))*0.95], 1); st = st/np.abs(st).max()*0.8
w = wave.open(out, "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((st*32767).astype(np.int16).tobytes()); w.close()
