import json, numpy as np, subprocess, wave
SR=48000; tl=json.load(open('timeline.json')); ev=json.load(open('events.json'))
N=int(tl['total']*SR); rng=np.random.default_rng(7)
def load(p):
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',p,'-ac','1','-ar',str(SR),'-f','f32le','-'])
    return np.frombuffer(raw,np.float32).astype(np.float64)
def env(n,a,d):  # attack/decay seconds
    t=np.arange(n)/SR; return np.minimum(t/max(a,1e-4),1)*np.exp(-t/d)
def add(buf,x,t,g=1.0):
    i=int(t*SR); j=min(N,i+len(x)); 
    if i<N: buf[i:j]+=g*x[:j-i]
# ---- voice
voice=np.zeros(N)
for k,s in enumerate(tl['starts']):
    add(voice,load(f'audio/s{k+1:02d}.wav'),s)
voice/=np.max(np.abs(voice))+1e-9; voice*=0.9
# ---- music bed: 96 bpm, minor groove (Am - F - C - G)
bpm=96; beat=60/bpm; music=np.zeros(N); t=np.arange(N)/SR
def tone(f,dur,a=0.005,d=0.3,typ='sine'):
    n=int(dur*SR); tt=np.arange(n)/SR
    w=np.sin(2*np.pi*f*tt) if typ=='sine' else (2*((f*tt)%1)-1)
    return w*env(n,a,d)
chords=[(220,261.6,329.6),(174.6,220,261.6),(261.6,329.6,392),(196,246.9,293.7)]
bass=[110,87.3,130.8,98]
nb=int(tl['total']/beat)+2
for b in range(nb):
    tb=b*beat; bar=(b//4)%4
    k=tone(55,0.35,0.001,0.12)*1.0; k*=np.linspace(1,0.3,len(k))  # kick
    if b%2==0: add(music,k,tb,0.9)
    if b%4==2: add(music,rng.standard_normal(int(0.15*SR))*env(int(0.15*SR),0.001,0.05),tb,0.25)  # snare
    h=rng.standard_normal(int(0.05*SR)); h=np.diff(h,prepend=0)*env(len(h),0.001,0.015)
    add(music,h,tb+beat/2,0.18); add(music,h,tb,0.10)
    add(music,tone(bass[bar],beat*0.9,0.01,0.4,'saw')*0.5,tb,0.35)
    if b%4==0:
        for f in chords[bar]: add(music,tone(f,beat*4,0.4,1.6),tb,0.10)
    # pluck arpeggio
    f=chords[bar][b%3]*2; add(music,tone(f,0.4,0.002,0.12),tb+beat/2,0.08)
# fade in/out
music*=np.clip(t/1.0,0,1)*np.clip((tl['total']-t)/2.0,0,1)
# ducking under voice
vabs=np.abs(voice); win=int(0.25*SR)
venv=np.convolve(vabs,np.ones(win)/win,'same'); duck=1-0.65*np.clip(venv/0.05,0,1)
music*=duck
# ---- SFX
sfx=np.zeros(N)
def whoosh():
    n=int(0.45*SR); x=rng.standard_normal(n); tt=np.arange(n)/SR
    # sweeping bandpass via simple one-pole lowpass with moving cutoff
    y=np.zeros(n); c=np.linspace(0.02,0.35,n); s=0
    for i in range(n): s+=c[i]*(x[i]-s); y[i]=s
    return (y-np.convolve(y,np.ones(30)/30,'same'))*np.sin(np.pi*tt/tt[-1])**2*3
def popx():
    n=int(0.12*SR); tt=np.arange(n)/SR; f=900*np.exp(-tt*25)+300
    return np.sin(2*np.pi*np.cumsum(f)/SR)*env(n,0.001,0.04)
def ding(): return sum(tone(f,0.9,0.001,0.35) for f in (1318.5,1975.5))*0.5
def cash():
    x=np.zeros(int(1.0*SR)); 
    x[:int(0.08*SR)]+=rng.standard_normal(int(0.08*SR))*env(int(0.08*SR),0.001,0.02)*0.6
    for i,f in enumerate((2093,2637,3136)): 
        y=tone(f,0.8,0.001,0.25)*0.4; x[int(0.06*SR*i):int(0.06*SR*i)+len(y)]+=y[:len(x)-int(0.06*SR*i)]
    return x
def boom():
    n=int(1.0*SR); tt=np.arange(n)/SR; f=80*np.exp(-tt*3)+35
    return np.sin(2*np.pi*np.cumsum(f)/SR)*env(n,0.002,0.35)*1.2+rng.standard_normal(n)*env(n,0.001,0.03)*0.3
def thud():
    n=int(0.25*SR); tt=np.arange(n)/SR; return np.sin(2*np.pi*np.cumsum(120*np.exp(-tt*12)+50)/SR)*env(n,0.001,0.08)
def down():
    n=int(0.9*SR); tt=np.arange(n)/SR; f=600*np.exp(-tt*2.2)+120
    return np.sign(np.sin(2*np.pi*np.cumsum(f)/SR))*env(n,0.01,0.5)*0.25
G={'whoosh':(whoosh(),0.35),'pop':(popx(),0.35),'ding':(ding(),0.3),'cash':(cash(),0.4),'boom':(boom(),0.6),'thud':(thud(),0.6),'down':(down(),0.35)}
for e in ev: x,g=G[e['k']]; add(sfx,x,e['t'],g)
# ---- master
mix=voice*1.0+music*0.32+sfx*0.55
mix=np.tanh(mix*1.1)/np.tanh(1.1)
mix/=np.max(np.abs(mix))/0.95
pcm=(mix*32767).astype(np.int16)
with wave.open('mix.wav','wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('ok',len(ev),'events')
