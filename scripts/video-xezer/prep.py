# vec.json (Xəzər sahili, çaylar, sərhədlər) və depth.npy (z5 batimetriya) hazırlayır
# istifadə: python3 prep.py <iş_qovluğu>   (data/ və t5/ orada olmalıdır)
import sys, json, numpy as np
from PIL import Image, ImageFilter
S = sys.argv[1]
out = {}
d = json.load(open(f'{S}/data/ne_10m_land.geojson'))
out['caspian'] = d['features'][0]['geometry']['coordinates'][4][1]
r = json.load(open(f'{S}/data/ne_10m_rivers_lake_centerlines.geojson'))
for ft in r['features']:
    n = ft['properties'].get('name')
    if n in ('Volga', 'Ural', 'Kura', 'Aras'):
        out.setdefault(n, []).extend(ft['geometry']['coordinates'])
c = json.load(open(f'{S}/data/ne_10m_admin_0_countries.geojson'))
out['countries'] = {}
for ft in c['features']:
    a = ft['properties']['ADM0_A3']; g = ft['geometry']
    ps = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    rings = []
    for p in ps:
        e = p[0]; lo = [q[0] for q in e]; la = [q[1] for q in e]
        if max(lo) < 36 or min(lo) > 64 or max(la) < 30 or min(la) > 54: continue
        rings.append([[round(q[0], 4), round(q[1], 4)] for q in e])
    if rings: out['countries'][a] = rings
json.dump(out, open(f'{S}/build/vec.json', 'w'))
# z5 Terrain Tiles batimetriyası (x 19-21, y 10-13)
el = np.zeros((1024, 768), np.float32)
for i, x in enumerate([19, 20, 21]):
    for j, y in enumerate([10, 11, 12, 13]):
        a = np.asarray(Image.open(f'{S}/t5/{x}_{y}.png').convert('RGB')).astype(np.float32)
        el[j*256:(j+1)*256, i*256:(i+1)*256] = a[..., 0]*256 + a[..., 1] + a[..., 2]/256 - 32768
dep = np.clip(-28 - el[192:192+576, 128:128+448], 0, 1100)
D = np.asarray(Image.fromarray(dep).resize((3584, 4608), Image.BICUBIC))
np.save(f'{S}/build/depth.npy', D.astype(np.float16))
base = np.asarray(Image.open(f'{S}/build/base.png')).astype(np.float32)
land = np.asarray(Image.open(f'{S}/build/landmask.png').filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)[..., None]/255
dd = np.clip(D/1000, 0, 1)[..., None]**0.55
wat = np.array([34, 92, 112])*(1-dd) + np.array([6, 22, 40])*dd
Image.fromarray(np.clip(base*land + wat*(1-land), 0, 255).astype(np.uint8)).save(f'{S}/build/base.png')
