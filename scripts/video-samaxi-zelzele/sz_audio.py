# Orijinal səs fonu: tünd drone (D minor), hook-da yeraltı uğultu + sarsıntı, keçidlərdə "boom", sayğaclarda tik, sonda klik
import json, sys, wave, numpy as np
tl = json.load(open(sys.argv[1])); sc = tl["scenes"]; al = {a["key"]: a for a in json.load(open(sys.argv[2]))}; out = sys.argv[3]
SR = 48000; DUR = tl["dur"] + 0.3; N = int(DUR*SR); t = np.arange(N)/SR; rng = np.random.default_rng(5)
def n2f(n): return 440*2**((n-69)/12)
def wtime(key, word):
    s = next(x for x in sc if x["key"] == key)
    for w, tw in al[key]["words"]:
        if word.lower() in w.lower(): return s["vs"] + tw/tl["tempo"]
    return None
def lp(x, k): return np.convolve(x, np.ones(k)/k, "same")
mus = np.zeros(N)
for n, g in ((38, 0.5), (45, 0.25), (50, 0.18), (53, 0.12)):
    f = n2f(n); lfo = 0.55 + 0.45*np.sin(2*np.pi*t/11 + n)
    mus += g*lfo*(np.sin(2*np.pi*f*t) + 0.4*np.sin(2*np.pi*f*1.003*t))
# yavaş "ürək döyüntüsü" puls
for b in np.arange(0.5, DUR, 1.6):
    i0 = int(b*SR); ln = int(0.35*SR)
    if i0 + ln > N: break
    tt = np.arange(ln)/SR
    mus[i0:i0+ln] += 0.6*np.sin(2*np.pi*(48+30*np.exp(-tt*25))*tt)*np.exp(-tt*10)
mus /= np.abs(mus).max()
sfx = np.zeros(N)
def add(ts, x, g):
    i0 = int(ts*SR); i1 = min(N, i0+len(x))
    if 0 <= i0 < N: sfx[i0:i1] += g*x[:i1-i0]
# hook: yeraltı uğultu (qəhvəyi küy), "saniyə"-dən güclənir, "xarabalığa"-da zirvə
h = sc[0]; ts = wtime("hook", "saniyə"); tc = wtime("hook", "xarabalığa")
ln = int((h["t1"]+0.5)*SR); br = np.cumsum(rng.standard_normal(ln)); br -= lp(br, 4000); br /= np.abs(br).max()
tt = np.arange(ln)/SR
env = np.clip((tt - (ts-0.6))/1.2, 0, 1)**1.5 * np.clip(1 - (tt-(h["t1"]-0.3))/0.8, 0, 1)
rum = br*env*(1 + 0.6*np.sin(2*np.pi*7*tt)) + 0.6*np.sin(2*np.pi*32*tt)*env
add(0, rum, 1.0)
def boom(ln=2.2):
    tt = np.arange(int(ln*SR))/SR
    return np.sin(2*np.pi*(34+70*np.exp(-tt*5))*tt)*np.exp(-tt*1.6) + 0.35*lp(rng.standard_normal(len(tt)), 6)*np.exp(-tt*6)
add(tc - 0.08, boom(3.0), 1.2)
for s in sc[1:]:
    ln = int(0.5*SR); nz = lp(rng.standard_normal(ln), 6); tt = np.arange(ln)/SR
    add(s["t0"] - 0.2, nz*np.exp(-((tt-0.2)**2)/0.008), 0.35)
    add(s["t0"] + 0.02, boom(1.6), 0.45)
def tick():
    tt = np.arange(int(0.03*SR))/SR; return np.sin(2*np.pi*2400*tt)*np.exp(-tt*200)
for key, word, d in (("toll", "İki", 1.2), ("toll", "yeddi", 1.2)):
    t0 = wtime(key, word) - 0.15
    for q in np.arange(0, d, 0.06): add(t0 + q, tick(), 0.25*(1 - q/d))
def click():
    tt = np.arange(int(0.06*SR))/SR
    return np.sin(2*np.pi*1800*tt)*np.exp(-tt*120) + 0.5*rng.standard_normal(len(tt))*np.exp(-tt*200)
tb = wtime("cta", "izlə"); add(tb + 0.3, click(), 1.0)
tt = np.arange(int(1.0*SR))/SR; add(tb + 0.32, (np.sin(2*np.pi*1046.5*tt) + 0.4*np.sin(2*np.pi*2093*tt))*np.exp(-tt*5), 0.35)
sfx /= max(1e-9, np.abs(sfx).max())
mix = mus*0.5 + sfx*0.75
fade = np.ones(N); fo = int(1.5*SR); fade[-fo:] = np.linspace(1, 0, fo); fade[:int(0.3*SR)] = np.linspace(0, 1, int(0.3*SR))
mix *= fade
st = np.stack([mix, np.roll(mix, int(0.012*SR))*0.95], 1); st = st/np.abs(st).max()*0.8
w = wave.open(out, "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st*32767).astype(np.int16).tobytes()); w.close()
