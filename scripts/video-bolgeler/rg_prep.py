# İqtisadi rayon rastrı (id xəritəsi), quru/dəniz maskası və rayon mərkəzləri
import json, sys, math, numpy as np
from PIL import Image, ImageDraw
S = sys.argv[1]; OUT = sys.argv[2]
LON0, LON1, LAT0, LAT1 = 43.6, 51.9, 37.6, 42.6
C = math.cos(math.radians(40.2)); K = 3400/((LON1-LON0)*C)
WW = 3400; HH = int((LAT1-LAT0)*K)
def xy(lon, lat): return ((lon-LON0)*C*K, (LAT1-lat)*K)
REG = {
 "Bakı": ["Bakı"], "Abşeron-Xızı": ["Abşeron", "Xizı", "Sumqayıt"],
 "Gəncə-Daşkəsən": ["Daşkəsən", "Goranboy", "Xanlar", "Samux", "Gəncə", "Naftalan"],
 "Şəki-Zaqatala": ["Balakən", "Qax", "Qəbələ", "Oğuz", "Zaqatala", "Şəki"],
 "Lənkəran-Astara": ["Astara", "Cəlilabad", "Lerik", "Yardımlı", "Lankaran", "Masallı"],
 "Quba-Xaçmaz": ["Dəvəçi", "Xaçmaz", "Quba", "Qusar", "Siyəzən"],
 "Mərkəzi Aran": ["Ağdaş", "Göyçay", "Kürdəmir", "Ucar", "Yevlakh", "Yevlakh Rayon", "Zərdab", "Mingəçevir"],
 "Qarabağ": ["Ağcabədi", "Ağdam", "Bərdə", "Füzuli", "Xocalı", "Xocavənd", "Şuşa", "Tərtər", "Stepanakert"],
 "Şərqi Zəngəzur": ["Cəbrayıl", "Kəlbəcər", "Qubadli", "Zəngilan"],  # Laçın: aşağıda OVR ilə
 "Dağlıq Şirvan": ["Ağsu", "İsmayıllı", "Qobustan", "Şamaxı"],
 "Naxçıvan": ["Babək", "Culfa", "Kangarli", "Naxçıvan", "Ordubad", "Sədərək", "Şahbuz", "Şərur"],
 "Qazax-Tovuz": ["Ağstafa", "Gədəbəy", "Qazax", "Şəmkir", "Tovuz"],
 "Mil-Muğan": ["Beyləqan", "İmişli", "Saatlı", "Sabirabad"],
 "Şirvan-Salyan": ["Biləsuvar", "Hajigabul", "Neftçala", "Salyan", "Shirvan"]}
NAMES = list(REG)
d2r = {d: i+1 for i, r in enumerate(NAMES) for d in REG[r]}
# Natural Earth ad səhvləri: kod -> (düzgün ad, iqtisadi rayon). AZE-1735 "Lankaran" adlanır, amma gn_name "Lacin Rayonu"-dur.
OVR = {"AZE-1735": ("Laçın", "Şərqi Zəngəzur")}
def polys(g): return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
idim = Image.new("L", (WW, HH), 0); di = ImageDraw.Draw(idim)
dist = {}
for ft in json.load(open(f"{S}/rg/adm1.geojson"))["features"]:
    p = ft["properties"]
    if p.get("adm0_a3") != "AZE": continue
    if p.get("adm1_code") in OVR:
        nm, reg = OVR[p["adm1_code"]]; rid = NAMES.index(reg) + 1
    else:
        nm = p["name"]; rid = d2r.get(nm)
    if rid is None: print("?", nm); continue
    for pg in polys(ft["geometry"]):
        pts = [xy(*q[:2]) for q in pg[0]]; di.polygon(pts, fill=rid)
        dist.setdefault(nm, []).append(pts)
# ölkə maskası (admin_0) – boşluqları (məs. Laçın) ən yaxın rayonla doldur
c0 = json.load(open(f"{S}/data/ne_10m_admin_0_countries.geojson"))
cm = Image.new("L", (WW, HH), 0); dc = ImageDraw.Draw(cm)
for ft in c0["features"]:
    if ft["properties"]["ADM0_A3"] == "AZE":
        for pg in polys(ft["geometry"]):
            dc.polygon([xy(*q[:2]) for q in pg[0]], fill=255)
I = np.asarray(idim).copy(); country = np.asarray(cm) > 127
for it in range(300):
    emp = country & (I == 0)
    if not emp.any(): break
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        sh = np.roll(np.roll(I, dy, 0), dx, 1); f = emp & (sh > 0) & (I == 0); I[f] = sh[f]
I[~country] = 0
# quru maskası
lm = Image.new("L", (WW, HH), 0); dl = ImageDraw.Draw(lm)
for ft in json.load(open(f"{S}/data/ne_10m_land.geojson"))["features"]:
    for pg in polys(ft["geometry"]):
        ext = pg[0]; lo = [q[0] for q in ext]; la = [q[1] for q in ext]
        if max(lo) < 40 or min(lo) > 56 or max(la) < 35 or min(la) > 46:
            if not (min(lo) < 40 and max(lo) > 56): continue
        dl.polygon([xy(*q[:2]) for q in ext if -85 < q[1] < 85], fill=255)
        for h in pg[1:]: dl.polygon([xy(*q[:2]) for q in h], fill=0)
L = np.asarray(lm) > 127
# rayon mərkəzləri (maskadan)
cent = {}
for name, ptss in dist.items():
    m = Image.new("L", (WW, HH), 0); dm = ImageDraw.Draw(m)
    for pts in ptss:
        if len(pts) > 2: dm.polygon(pts, fill=255)
    a = np.asarray(m) > 0; ys, xs = np.nonzero(a)
    if len(xs): cent[name] = (float(xs.mean()), float(ys.mean()))
np.save(f"{OUT}/regid.npy", I.astype(np.uint8)); np.save(f"{OUT}/land.npy", L)
json.dump(dict(names=NAMES, cent=cent, W=WW, H=HH, lon0=LON0, lat1=LAT1, C=C, K=K), open(f"{OUT}/meta.json", "w"), ensure_ascii=False)
pal = np.array([[30, 40, 60]] + [[int(80+170*((i*37) % 14)/14), int(90+150*((i*53) % 14)/14), int(120+120*((i*71) % 14)/14)] for i in range(14)], np.uint8)
im = pal[I]; im[(I == 0) & L] = (45, 50, 60); im[(I == 0) & ~L] = (20, 35, 60)
Image.fromarray(im).resize((WW//3, HH//3)).save(f"{OUT}/regid.png"); print(WW, HH, "empty-left", int((country & (I == 0)).sum()))
