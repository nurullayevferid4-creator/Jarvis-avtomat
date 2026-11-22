# Orijinal fon səsi: yumşaq pad akkordları + sakit puls + səhnə keçidlərində "whoosh"
import json, sys, wave, numpy as np
sc = json.load(open(sys.argv[1]))["scenes"]; out = sys.argv[2]
SR = 48000; DUR = sc[-1]["t1"]; N = int(DUR*SR)
t = np.arange(N)/SR
rng = np.random.default_rng(7)
def n2f(n): return 440*2**((n-69)/12)
# akkordlar (Dm9 - Bbmaj7 - Fmaj7 - C6), hər biri 4 san
chords = [[50, 57, 62, 65, 69, 76], [46, 53, 58, 62, 65, 69], [41, 48, 57, 60, 64, 69], [48, 55, 60, 64, 67, 69]]
pad = np.zeros(N)
L = 4.0
for k in range(int(DUR/L)+2):
    c = chords[k % 4]; t0 = k*L
    i0 = int(max(0, (t0-0.6)*SR)); i1 = int(min(N, (t0+L+1.2)*SR))
    if i0 >= N: break
    tt = t[i0:i1]-t0
    env = np.clip((tt+0.6)/1.4, 0, 1)*np.clip((L+1.2-tt)/1.6, 0, 1)
    env = env**1.5
    for j, n in enumerate(c):
        f = n2f(n)
        for det in (-0.12, 0.12):
            ph = rng.uniform(0, 6.28)
            pad[i0:i1] += env*np.sin(2*np.pi*f*(1+det/100)*tt+ph)*(0.5 if j < 2 else 0.28)
# yumşaltma: sadə alçaq keçirici
def lp(x, a):
    y = np.empty_like(x); s = 0.0
    # vektorlaşdırılmış birqütblü filtr üçün scipy yoxdur -> blok yanaşma
    from numpy.lib.stride_tricks import sliding_window_view
    k = int(1/a); ker = np.ones(k)/k
    return np.convolve(x, ker, mode="same")
pad = lp(pad, 1/24)
# puls: hər 0.5 san yumşaq "tık" (aşağı tonlu)
pulse = np.zeros(N)
beat = 60/120
for b in np.arange(0.0, DUR, beat):
    i0 = int(b*SR); ln = int(0.18*SR)
    if i0+ln > N: break
    tt = np.arange(ln)/SR
    pulse[i0:i0+ln] += np.sin(2*np.pi*(70+40*np.exp(-tt*40))*tt)*np.exp(-tt*22)*(1.0 if int(b/beat) % 2 == 0 else 0.55)
# whoosh: süzülmüş küy, səhnə başlanğıcında
wh = np.zeros(N)
noise = rng.standard_normal(N)
for s in sc[1:]:
    c = s["t0"]; i0 = int((c-0.45)*SR); i1 = int((c+0.35)*SR)
    tt = (np.arange(i1-i0)/SR) - 0.45
    env = np.where(tt < 0, np.exp(-(tt**2)/0.03), np.exp(-(tt**2)/0.015))
    seg = noise[i0:i1]
    seg = np.convolve(seg, np.ones(9)/9, mode="same") - np.convolve(seg, np.ones(60)/60, mode="same")
    wh[i0:i1] += seg*env
# CTA: iki yumşaq zəng
bell = np.zeros(N)
cta = sc[-1]["vs"] + 5.6/1.07
for k, n in enumerate((81, 88)):
    i0 = int((cta + k*0.15)*SR); ln = int(1.6*SR)
    tt = np.arange(min(ln, N-i0))/SR
    bell[i0:i0+len(tt)] += (np.sin(2*np.pi*n2f(n)*tt)+0.3*np.sin(2*np.pi*n2f(n)*2.01*tt))*np.exp(-tt*3.5)
mix = pad/np.abs(pad).max()*0.55 + pulse/np.abs(pulse).max()*0.22 + wh/np.abs(wh).max()*0.35 + bell/np.abs(bell).max()*0.25
# giriş/çıxış
fade = np.ones(N); fi = int(0.4*SR); fo = int(1.5*SR)
fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo)
mix *= fade
st = np.stack([mix, np.roll(mix, int(0.012*SR))*0.92], 1)
st = st/np.abs(st).max()*0.8
w = wave.open(out, "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((st*32767).astype(np.int16).tobytes()); w.close()
