# Sadə lip-sync: səs enerjisi + spektral mərkəz -> Rhubarb ağız formaları (X, A..H)
import json, subprocess, sys, numpy as np
FPS=30; SR=16000
def load(p): return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',p,'-ac','1','-ar',str(SR),'-f','f32le','-']),np.float32).astype(float)
def cues(path):
    x=load(path); hop=SR//FPS; win=int(0.04*SR); n=len(x)//hop+1
    rms=np.zeros(n); cen=np.zeros(n); fr=np.fft.rfftfreq(win,1/SR)
    for i in range(n):
        s=x[i*hop:i*hop+win]
        if len(s)<win: s=np.pad(s,(0,win-len(s)))
        rms[i]=np.sqrt(np.mean(s**2)); sp=np.abs(np.fft.rfft(s*np.hanning(win)))+1e-9; cen[i]=(sp*fr).sum()/sp.sum()
    voiced=rms[rms>0.01]; ref=np.percentile(voiced,95) if len(voiced) else 1
    e=np.clip(rms/ref,0,1.2); es=np.convolve(e,[0.25,0.5,0.25],'same')
    # heca zirvələri və çuxurları
    peaks=[i for i in range(1,n-1) if es[i]>=es[i-1] and es[i]>es[i+1] and es[i]>0.15]
    open_=np.zeros(n)
    for i in range(n):
        if es[i]<0.08: continue
        # ən yaxın sol/sağ çuxur
        l=i
        while l>0 and es[l-1]<=es[l]+1e-6 and es[l-1]>0.02: l-=1
        while l>0 and es[l-1]<es[l]: l-=1
        r=i
        while r<n-1 and es[r+1]<es[r]: r+=1
        lo=min(es[max(0,l)],es[r]) if r>i else es[max(0,l)]
        pk=max(es[max(0,i-3):i+4])
        open_[i]=(es[i]-lo)/max(pk-lo,1e-3)*min(1,pk/0.5)
    vc=cen[es>0.15]; lowc=np.percentile(vc,18) if len(vc) else 900; highc=np.percentile(vc,88) if len(vc) else 3300
    out=[]
    for i in range(n):
        if es[i]<0.08: out.append('X'); continue
        o=open_[i]; c=cen[i]
        if c>highc and o<0.7: out.append('B' if i%3 else 'G'); continue
        if o>0.72: out.append(('E' if c<lowc else 'D') if es[i]>0.55 else ('F' if c<lowc else 'C'))
        elif o>0.45: out.append('E' if c<lowc else 'C')
        elif o>0.2: out.append('B' if i%5 else 'H')
        else: out.append('A')
    # minimum 2 kadr saxla (titrəməni azaldır)
    for i in range(1,n-1):
        if out[i]!=out[i-1] and out[i]!=out[i+1] and out[i] not in 'XA': out[i]=out[i-1]
    return out
plan=json.loads(sys.argv[1]); total=float(sys.argv[2]); N=int(total*FPS)+1
res={}
for spk,items in plan.items():
    arr=['X']*N
    for path,off,trim in items:
        c=cues(path)
        for k,m in enumerate(c):
            if trim and k/FPS>trim: break
            j=int(round(off*FPS))+k
            if 0<=j<N: arr[j]=m
    res[spk]=''.join(arr)
json.dump(res,open('demo/lip.json','w'))
for k,v in res.items(): print(k, ''.join(v[int(0.7*FPS):int(0.7*FPS)+90]))
