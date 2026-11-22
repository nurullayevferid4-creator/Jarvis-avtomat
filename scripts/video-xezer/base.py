import sys, json, numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, sys.argv[1]); from geo import *
S=sys.argv[2]
# elevation mosaic
el=np.zeros((9*256,7*256),np.float32)
for i,x in enumerate(range(78,85)):
    for j,y in enumerate(range(43,52)):
        a=np.asarray(Image.open(f"{S}/tiles/{x}_{y}.png").convert('RGB')).astype(np.float32)
        el[j*256:(j+1)*256,i*256:(i+1)*256]=a[...,0]*256+a[...,1]+a[...,2]/256-32768
elI=Image.fromarray(el).resize((W,H),Image.BICUBIC); el2=np.asarray(elI)
np.save(f"{S}/build/elev.npy", el2.astype(np.float16))
# hillshade
gy,gx=np.gradient(el2)
z=1/ (K*1.0) ; dx=gx*0.0025*8; dy=gy*0.0025*8
slope=np.arctan(np.hypot(dx,dy)); asp=np.arctan2(-dx,dy)
az=np.radians(315); alt=np.radians(40)
hs=np.sin(alt)*np.cos(slope)+np.cos(alt)*np.sin(slope)*np.cos(az-asp)
hs=np.clip(hs,0,1)
# land mask
m=Image.new('L',(W,H),0); d=ImageDraw.Draw(m)
lj=json.load(open(f"{S}/data/ne_10m_land.geojson"))
def rings(g):
    if g['type']=='Polygon': yield g['coordinates']
    else:
        for p in g['coordinates']: yield p
for ft in lj['features']:
    for poly in rings(ft['geometry']):
        ext=poly[0]
        lons=[p[0] for p in ext]; lats=[p[1] for p in ext]
        if max(lons)<38 or min(lons)>62 or max(lats)<30 or min(lats)>52: 
            if not (min(lons)<38 and max(lons)>62): continue
        d.polygon([proj(*p[:2]) for p in ext if -85<p[1]<85],fill=255)
        for h in poly[1:]: d.polygon([proj(*p[:2]) for p in h],fill=0)
m.save(f"{S}/build/landmask.png")
land=np.asarray(m.filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)/255
# colors
e=np.clip(el2,0,4500)/4500
lo=np.array([38,44,52]);mid=np.array([70,72,74]);hi=np.array([150,146,140])
t=e[...,None]**0.6
landc=lo*(1-t)+hi*t
shade=(0.35+0.95*hs)[...,None]
landc=landc*shade
# water: depth from bathymetry (Caspian surface ~-28)
dep=np.clip((-28-el2)/1000,0,1)[...,None]**0.5
w0=np.array([22,58,78]); w1=np.array([8,20,34])
wat=w0*(1-dep)+w1*dep
img=landc*land[...,None]+wat*(1-land[...,None])
img=np.clip(img,0,255).astype(np.uint8)
Image.fromarray(img).save(f"{S}/build/base.png")
print(img.shape)
