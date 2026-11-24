# Orijinal musiqi: 100 BPM pluck arpecio + yumşaq kik/hi-hat + səhnə "swoosh" + yer "ding"
import json, sys, wave, numpy as np
tl = json.load(open(sys.argv[1])); sc = tl["scenes"]; out = sys.argv[2]
SR = 48000; DUR = tl["dur"] + 0.5; N = int(DUR*SR); rng = np.random.default_rng(3)
def n2f(n): return 440*2**((n-69)/12)
BPM = 100; b = 60/BPM; s16 = b/4
prog = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 60], [55, 59, 62, 67]]  # Am7 F C G
mus = np.zeros(N)
def add(i0, x, g=1.0):
    i1 = min(N, i0+len(x)); 
    if i0 < N: mus[i0:i1] += x[:i1-i0]*g
def pluck(f, ln=0.35):
    t = np.arange(int(ln*SR))/SR
    x = sum(np.sin(2*np.pi*f*k*t)/k**1.6 for k in range(1, 6))
    return x*np.exp(-t*9)*(1-np.exp(-t*400))
def kick():
    t = np.arange(int(0.25*SR))/SR
    return np.sin(2*np.pi*(50+90*np.exp(-t*30))*t)*np.exp(-t*14)
def hat():
    t = np.arange(int(0.05*SR))/SR; x = rng.standard_normal(len(t)); x = x - np.convolve(x, np.ones(4)/4, "same")
    return x*np.exp(-t*90)
bar = 4*b; step = 0
pat = [0, 2, 1, 3, 2, 1, 3, 2]
t = 0.0
while t < DUR:
    ci = int(t/bar) % 4; ch = prog[ci]
    k = step % 16
    note = ch[pat[k % 8]] + (12 if k >= 8 and k % 2 == 0 else 0)
    add(int(t*SR), pluck(n2f(note)), 0.5)
    if k % 4 == 0: add(int(t*SR), kick(), 0.9)
    if k % 4 == 2: add(int(t*SR), hat(), 0.25)
    if k == 0:  # bas
        tt = np.arange(int(bar*SR))/SR
        add(int(t*SR), np.sin(2*np.pi*n2f(ch[0]-24)*tt)*np.exp(-tt*0.8)*np.minimum(1, tt*40), 0.45)
    t += s16; step += 1
mus /= np.abs(mus).max()
sfx = np.zeros(N)
def addf(i0, x, g):
    i1 = min(N, i0+len(x)); sfx[i0:i1] += x[:i1-i0]*g
for s in sc[1:]:
    c = s["t0"]; ln = int(0.5*SR); tt = np.arange(ln)/SR
    nz = rng.standard_normal(ln); nz = np.convolve(nz, np.ones(6)/6, "same")
    env = np.exp(-((tt-0.18)**2)/0.006)
    addf(int((c-0.18)*SR), nz*env, 0.5)
    if s["key"] != "intro":
        f0 = 880 if s["key"] != "cta" else 1046.5
        dt = np.arange(int(1.2*SR))/SR
        ding = (np.sin(2*np.pi*f0*dt) + 0.4*np.sin(2*np.pi*f0*2.0*dt) + 0.2*np.sin(2*np.pi*f0*3.01*dt))*np.exp(-dt*4)
        addf(int((s["vs"]+0.05)*SR), ding, 0.35)
al = json.load(open(sys.argv[3])); cta = sc[-1]
a = next(x for x in al if x["key"] == cta["akey"])
cue = "abunə" if cta["akey"] == "cta_yt" else "izlə"
tw = next(t for w, t in a["words"] if cue in w.lower())
tb = cta["vs"] + tw/tl["tempo"] - cta["t0"]
def click():
    tt = np.arange(int(0.06*SR))/SR
    return np.sin(2*np.pi*1800*tt)*np.exp(-tt*120) + 0.5*rng.standard_normal(len(tt))*np.exp(-tt*200)
addf(int((cta["t0"] + tb + 0.3)*SR), click(), 0.9)
sfx /= max(1e-9, np.abs(sfx).max())
mix = mus*0.6 + sfx*0.5
fade = np.ones(N); fo = int(1.2*SR); fade[-fo:] = np.linspace(1, 0, fo); fade[:int(0.2*SR)] = np.linspace(0, 1, int(0.2*SR))
mix *= fade
st = np.stack([mix, np.roll(mix, int(0.009*SR))*0.95], 1); st = st/np.abs(st).max()*0.8
w = wave.open(out, "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((st*32767).astype(np.int16).tobytes()); w.close()
