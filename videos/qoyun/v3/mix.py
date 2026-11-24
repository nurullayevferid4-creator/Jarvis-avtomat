import json, numpy as np, subprocess, wave
SR=48000; tl=json.load(open('timeline.json')); ev=json.load(open('events.json'))
N=int(tl['total']*SR); R=np.random.default_rng(11)
def load(p): return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',p,'-ac','1','-ar',str(SR),'-f','f32le','-']),np.float32).astype(float)
def env(n,a,d): t=np.arange(n)/SR; return np.minimum(t/max(a,1e-4),1)*np.exp(-t/d)
def add(b,x,t,g=1.0):
    i=int(t*SR)
    if i<0: x=x[-i:]; i=0
    j=min(N,i+len(x)); 
    if i<N: b[i:j]+=g*x[:j-i]
def sweep(f0,f1,dur,a=0.002,d=0.2,wave_='sine'):
    n=int(dur*SR); f=np.geomspace(f0,f1,n); ph=2*np.pi*np.cumsum(f)/SR
    w=np.sin(ph) if wave_=='sine' else np.sign(np.sin(ph)); return w*env(n,a,d)
def lp(x,c):
    y=np.zeros_like(x); s=0.0
    for i in range(len(x)): s+=c[i]*(x[i]-s); y[i]=s
    return y
def noise(d): return R.standard_normal(int(d*SR))
def whoosh(d=0.5,c0=0.03,c1=0.4):
    n=int(d*SR); y=lp(noise(d),np.linspace(c0,c1,n)); return y*np.sin(np.pi*np.arange(n)/n)**2*4
def swoosh(): x=whoosh(0.45,0.4,0.03); return x
def riser():
    n=int(0.7*SR); t=np.arange(n)/SR; y=lp(noise(0.7),np.geomspace(0.01,0.6,n))*np.linspace(0,1,n)**2*5
    z=sweep(200,1600,0.7,0.6,10)[:n]; return y+z*np.linspace(0,1,n)*0.3
def glitch():
    x=np.zeros(int(0.35*SR))
    for k in range(7):
        s=int(R.uniform(0,0.3)*SR); L=int(R.uniform(0.01,0.04)*SR)
        seg=np.sign(np.sin(2*np.pi*R.uniform(200,2000)*np.arange(L)/SR))*0.6+noise(L/SR)*0.4; x[s:s+L]+=seg[:len(x)-s]
    return x*0.8
def thud(): return sweep(140,45,0.35,0.001,0.1)*1.3+noise(0.35)*env(int(0.35*SR),0.001,0.01)*0.4
def stamp():
    x=thud()*1.2; y=lp(noise(0.2),np.full(int(0.2*SR),0.2))*env(int(0.2*SR),0.001,0.04)*2; x[:len(y)]+=y; return x
def step(): return sweep(300,90,0.08,0.001,0.03)*0.8
def pop(): return sweep(1100,300,0.12,0.001,0.04)
def typ(): x=noise(0.03)*env(int(0.03*SR),0.0005,0.004); return np.diff(x,prepend=0)*2
def tick(): return sweep(3000,2500,0.02,0.0005,0.006)*0.6
def ding(): return sum(sweep(f,f,1.0,0.001,0.35) for f in (1318.5,1975.5))*0.5
def coin(): return (sweep(2637,2637,0.25,0.001,0.08)+sweep(3951,3951,0.25,0.02,0.06))*0.5
def cash():
    x=np.zeros(int(1.1*SR)); n=noise(0.08)*env(int(0.08*SR),0.001,0.02)*0.7; x[:len(n)]+=n
    for i,f in enumerate((2093,2637,3136,4186)):
        y=sweep(f,f,0.8,0.001,0.22)*0.45; s=int(0.055*SR*i); x[s:s+len(y)]+=y[:len(x)-s]
    return x
def boom():
    x=sweep(90,32,1.2,0.002,0.4)*1.4; y=lp(noise(0.5),np.full(int(0.5*SR),0.05))*env(int(0.5*SR),0.001,0.15)*3; x[:len(y)]+=y; return x
def msg():
    x=np.zeros(int(0.2*SR)); a=sweep(880,1320,0.09,0.002,0.05)*0.7; x[:len(a)]+=a; b=sweep(1320,1320,0.12,0.002,0.05)*0.6; s=int(0.07*SR); x[s:s+len(b)]+=b[:len(x)-s]; return x
def crack():
    n=int(0.25*SR); x=noise(0.25)[:n]*env(n,0.0005,0.03); y=sweep(2000,400,0.25,0.0005,0.05)[:n]; return np.diff(x,prepend=0)*2.5+y*0.3
def down(): return sweep(700,110,1.0,0.01,0.6,'sq')*0.25
def confetti():
    x=np.zeros(int(1.2*SR))
    for k in range(25):
        s=int(R.uniform(0,1.0)*SR); y=sweep(R.uniform(800,2500),R.uniform(300,800),0.06,0.001,0.02)*0.35; x[s:s+len(y)]+=y[:len(x)-s]
    w=whoosh(1.2,0.3,0.05)*0.3; x[:len(w)]+=w[:len(x)]; return x
G={'riser':(riser,.35),'whoosh':(whoosh,.45),'glitch':(glitch,.35),'swoosh':(swoosh,.4),'thud':(thud,.6),'stamp':(stamp,.6),'step':(step,.25),
   'pop':(pop,.35),'type':(typ,.5),'tick':(tick,.35),'ding':(ding,.3),'coin':(coin,.25),'cash':(cash,.38),'boom':(boom,.55),'msg':(msg,.35),
   'crack':(crack,.5),'down':(down,.3),'confetti':(confetti,.4)}
voice=np.zeros(N)
for k,s in enumerate(tl['starts']): add(voice,load(f'audio/s{k+1:02d}.wav'),s)
voice/=np.max(np.abs(voice)); voice*=0.9
sfx=np.zeros(N)
for e in ev: f,g=G[e['k']]; add(sfx,f(),e['t'],g)
# duck sfx a bit under voice
win=int(0.2*SR); venv=np.convolve(np.abs(voice),np.ones(win)/win,'same'); sfx*=1-0.4*np.clip(venv/0.05,0,1)
mix=voice+sfx*0.6; mix=np.tanh(mix*1.05)/np.tanh(1.05); mix/=np.max(np.abs(mix))/0.95
with wave.open('mix.wav','wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix*32767).astype(np.int16).tobytes())
print('events',len(ev))
