# Dünya okeanları — geri sayım tərzi: dönən 3D qlobus, açıq "editorial" dizayn, dublajla sinxron
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from multiprocessing import Pool

HERE = os.environ.get("OC_WORK", os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oc_words import W as VOW, DUR as VODUR

W, H, FPS = 1080, 1920, 30
TEMPO = 1.07
BG = (239, 233, 221)
INK = (24, 30, 32)
GREY = (150, 150, 140)
LANDC = np.array([44, 51, 53], np.float32)
WATER0 = np.array([196, 212, 214], np.float32)   # passiv okean
WATERI = np.array([84, 164, 200], np.float32)    # giriş: vahid okean
LAKE = np.array([170, 190, 195], np.float32)
# 1 Sakit, 2 Atlantik, 3 Hind, 4 Cənub, 5 Şimal Buzlu
OC = {1: dict(name=["Sakit", "okean"], col=(255, 104, 74), area=168.7, view=(-160, 2)),
      2: dict(name=["Atlantik", "okeanı"], col=(24, 170, 158), area=85.1, view=(-32, 12)),
      3: dict(name=["Hind", "okeanı"], col=(240, 158, 36), area=70.6, view=(78, -18)),
      4: dict(name=["Cənub", "okeanı"], col=(78, 104, 240), area=22.0, view=(30, -68)),
      5: dict(name=["Şimal Buzlu", "okeanı"], col=(80, 186, 232), area=15.6, view=(30, 78))}
FD = "/usr/share/fonts/opentype/inter/"
_fc = {}
def font(n, s):
    if (n, s) not in _fc: _fc[(n, s)] = ImageFont.truetype(FD + n, s)
    return _fc[(n, s)]

def clamp(v, a=0.0, b=1.0): return max(a, min(b, v))
def ease(t): t = clamp(t); return t*t*(3-2*t)
def eio(t): t = clamp(t); return 4*t*t*t if t < .5 else 1-(-2*t+2)**3/2
def eout(t): t = clamp(t); return 1-(1-t)**3
def back(t):
    t = clamp(t); c1 = 1.70158; c3 = c1+1
    return 1 + c3*(t-1)**3 + c1*(t-1)**2

# ---------------------------------------------------------------- timeline
# səhnə: id, rank (okean), kamera açarları [(u, lon, lat, R)]
GC = (540, 850)
SC = [
    dict(id="intro", oc=None, cam=[(0, -40, 18, 400), (1, 10, 18, 400)]),
    dict(id="five", oc=None, cam=[(0, 10, 18, 400), (1, 60, 10, 400)]),
    dict(id="r5", oc=5), dict(id="r4", oc=4), dict(id="r3", oc=3), dict(id="r2", oc=2), dict(id="r1", oc=1),
    dict(id="mariana", oc=1, cam=[(0, -160, 2, 400), (0.35, 142.2, 11.3, 560), (1, 142.2, 11.3, 590)]),
    dict(id="cta", oc=None, cam=[(0, 142.2, 11.3, 590), (0.3, 170, 10, 380), (1, 230, 10, 380)]),
]
LEAD, PAD = 0.25, 0.3
T = 0.0
prev_view = (10, 18)
for i, s in enumerate(SC):
    s["t0"] = T; vs = T + (0.12 if i == 0 else LEAD); s["vs"] = vs
    ws, on = [], False
    for txt, ms in VOW[i+1]:
        st = txt.startswith("*"); hl = on or st
        if st: on = True
        if txt.endswith("*"): on = False
        ws.append((vs + ms/1000/TEMPO, txt.replace("*", ""), hl))
    s["words"] = ws
    s["vend"] = vs + VODUR[i+1]/TEMPO
    T = s["vend"] + PAD + (1.4 if s["id"] == "cta" else 0)
    s["t1"] = T
    if s["id"].startswith("r"):
        v = OC[s["oc"]]["view"]
        # qısa yol ilə fırlanma
        lon0 = prev_view[0]
        dl = (v[0] - lon0 + 180) % 360 - 180
        s["cam"] = [(0, lon0, prev_view[1], 400), (0.22, lon0 + dl, v[1], 410), (1, lon0 + dl + 8, v[1], 410)]
        prev_view = (lon0 + dl + 8, v[1])
    elif s["id"] == "five":
        prev_view = (60, 10)
DUR = T
NF = int(math.ceil(DUR*FPS))

def wt(s, key, k=0):
    n = 0
    for t, w, _ in s["words"]:
        if key in w:
            if n == k: return t - s["t0"]
            n += 1
    raise KeyError(key)

# chunk-lar (karaoke sətirləri)
for s in SC:
    ch, cur = [], []
    for w in s["words"]:
        cur.append(w)
        if len(cur) >= 4 or w[1][-1] in ".,:?!" and len(" ".join(x[1] for x in cur)) > 8 or len(" ".join(x[1] for x in cur)) > 22:
            ch.append(cur); cur = []
    if cur:
        if ch and len(cur) == 1: ch[-1] += cur
        else: ch.append(cur)
    s["chunks"] = [dict(t0=c[0][0], t1=(ch[k+1][0][0] if k+1 < len(ch) else s["vend"]+0.2), words=c) for k, c in enumerate(ch)]

def cam_at(s, u):
    ks = s["cam"]
    if u <= ks[0][0]: return ks[0][1:]
    for a, b in zip(ks, ks[1:]):
        if u <= b[0]:
            f = eio((u-a[0])/(b[0]-a[0]))
            return tuple(a[j] + (b[j]-a[j])*f for j in (1, 2, 3))
    return ks[-1][1:]

# ---------------------------------------------------------------- globe
OID = LAND = None
def winit():
    global OID, LAND
    OID = np.load(os.path.join(HERE, "ocean_id.npy")); LAND = np.load(os.path.join(HERE, "land.npy"))

LIGHT = np.array([-0.45, 0.55, 0.70]); LIGHT /= np.linalg.norm(LIGHT)

def globe(lon0, lat0, R, colors, ss=2):
    """colors: {oid: (rgb ndarray)} — okean rəngləri. RGBA şəkil qaytarır (2R+pad ölçüsündə, ekrana kəsilmiş)."""
    cx, cy = GC
    x0, x1 = max(0, int(cx-R-2)), min(W, int(cx+R+2)); y0, y1 = max(0, int(cy-R-2)), min(H, int(cy+R+2))
    ww, hh = x1-x0, y1-y0
    xs = (np.arange(ww*ss)/ss + x0 + 0.5/ss - cx)/R
    ys = -(np.arange(hh*ss)/ss + y0 + 0.5/ss - cy)/R
    X, Y = np.meshgrid(xs, ys)
    r2 = X*X + Y*Y
    inside = r2 < 1
    Z = np.sqrt(np.clip(1-r2, 0, 1))
    p0, l0 = math.radians(lat0), math.radians(lon0)
    lat = np.arcsin(np.clip(Z*math.sin(p0) + Y*math.cos(p0), -1, 1))
    lon = l0 + np.arctan2(X, Z*math.cos(p0) - Y*math.sin(p0))
    Hh, Ww = OID.shape
    iy = np.clip(((math.pi/2 - lat)/math.pi*Hh).astype(np.int32), 0, Hh-1)
    ix = (((lon + math.pi) % (2*math.pi))/(2*math.pi)*Ww).astype(np.int32) % Ww
    oid = OID[iy, ix]; land = LAND[iy, ix]
    col = np.empty(X.shape + (3,), np.float32); col[:] = LAKE
    for k, c in colors.items(): col[oid == k] = c
    col[land] = LANDC
    # qrafikula (30°)
    latd = np.degrees(lat); lond = np.degrees(lon)
    tol = 0.35*400/R
    g = (np.abs(((latd + 15) % 30) - 15) < tol) | (np.abs(((lond + 15) % 30) - 15) < tol)
    col[g & ~land] *= 0.9
    # işıq
    sh = np.clip(X*LIGHT[0] + Y*LIGHT[1] + Z*LIGHT[2], 0, 1)
    col *= (0.62 + 0.45*sh)[..., None]
    spec = np.clip(sh, 0, 1)**40 * 60
    col[~land] += spec[~land, None]
    # kənar qaralma (rim)
    col *= (0.82 + 0.18*Z)[..., None]
    a = np.clip((1 - np.sqrt(r2))*R*ss*0.5, 0, 1)
    rgba = np.concatenate([np.clip(col, 0, 255), a[..., None]*255], -1).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA")
    if ss > 1: im = im.resize((ww, hh), Image.BOX)
    return im, (x0, y0)

def lonlat_to_screen(lon, lat, lon0, lat0, R):
    p, l = math.radians(lat), math.radians(lon - lon0); p0 = math.radians(lat0)
    x = math.cos(p)*math.sin(l)
    y = math.cos(p0)*math.sin(p) - math.sin(p0)*math.cos(p)*math.cos(l)
    z = math.sin(p0)*math.sin(p) + math.cos(p0)*math.cos(p)*math.cos(l)
    return GC[0] + x*R, GC[1] - y*R, z

def mix(a, b, f): return np.array(a, np.float32)*(1-f) + np.array(b, np.float32)*f

# ---------------------------------------------------------------- frame
def frame(i):
    t = i/FPS
    s = next((x for x in SC if x["t0"] <= t < x["t1"]), SC[-1])
    lt = t - s["t0"]; dur = s["t1"] - s["t0"]; u = clamp(lt/dur)
    lon0, lat0, R = cam_at(s, u)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img, "RGBA")
    # fon: nazik nöqtəli şəbəkə
    for yy in range(40, H, 60):
        for xx in range(30, W, 60):
            d.point((xx, yy), fill=(205, 198, 184))
    # okean rəngləri
    cols = {}
    sid = s["id"]
    if sid == "intro":
        for k in OC: cols[k] = WATERI
    elif sid == "five":
        tb = wt(s, "beş")
        for k in OC:
            f = ease((lt - tb - (5-k)*0.12)/0.35) * (1 - ease((lt - (s["vend"] - s["t0"]) + 0.2)/0.5))
            cols[k] = mix(WATERI if lt < tb else WATER0, OC[k]["col"], f) if lt >= tb else WATERI
            if lt >= tb and f <= 0.001: cols[k] = mix(WATERI, WATER0, ease((lt-tb)/0.4))
    elif sid == "cta":
        for k in OC: cols[k] = mix(WATER0, OC[k]["col"], ease(lt/0.6))
    else:
        act = s["oc"]
        for k in OC:
            if k == act:
                f = 1.0 if sid == "mariana" else ease((lt - wt(s, OC[k]["name"][0].split()[0]) + 0.1)/0.4)
                cols[k] = mix(WATER0, OC[k]["col"], f)
            else: cols[k] = WATER0
    # kölgə
    sh = Image.new("L", (W, H), 0); ImageDraw.Draw(sh).ellipse((GC[0]-R*0.9, GC[1]+R*0.86, GC[0]+R*0.9, GC[1]+R*1.06), fill=90)
    img.paste((150, 140, 120), mask=sh.filter(ImageFilter.GaussianBlur(26)))
    g, pos = globe(lon0, lat0, R, cols)
    img.paste(g, pos, g)
    d = ImageDraw.Draw(img, "RGBA")
    if R < 700: d.ellipse((GC[0]-R, GC[1]-R, GC[0]+R, GC[1]+R), outline=INK + (255,), width=3)
    oa = 1 - ease((lt - (dur-0.25))/0.25)

    # ---- yuxarı: başlıq zonası
    d.text((56, 104), "DÜNYA OKEANLARI", font=font("Inter-ExtraBold.otf", 28), fill=INK, anchor="lm")
    # sıra çipləri 5..1
    for j, k in enumerate((5, 4, 3, 2, 1)):
        cx = 690 + j*72; cy = 104
        done = any(x["oc"] == k and x["id"].startswith("r") and t >= x["t0"] + 0.3 for x in SC)
        cur = s["oc"] == k and sid.startswith("r")
        fill = OC[k]["col"] + (255,) if done else (0, 0, 0, 0)
        d.ellipse((cx-24, cy-24, cx+24, cy+24), fill=fill, outline=INK + (255,), width=3)
        d.text((cx, cy), str(k), font=font("Inter-ExtraBold.otf", 26), fill=(255, 255, 255) if done else INK, anchor="mm")
        if cur: d.ellipse((cx-32, cy-32, cx+32, cy+32), outline=OC[k]["col"] + (255,), width=3)
    if sid in ("intro", "five", "mariana", "cta"):
        ttl = {"intro": ["Bir planet,", "bir okean"], "five": ["5 hissə:", "kiçikdən böyüyə"],
               "mariana": ["Ən dərin", "nöqtə"], "cta": ["Sən hansını", "görmüsən?"]}[sid]
        for li, line in enumerate(ttl):
            a = ease((lt - li*0.1)/0.4)*oa
            oy = (1-eout((lt-li*0.1)/0.45))*30
            d.text((52, 160 + li*96 + oy), line, font=font("InterDisplay-Black.otf", 92),
                   fill=(INK if li == 0 else (255, 104, 74) if sid != "intro" else (40, 120, 170)) + (int(255*a),), anchor="la",
                   stroke_width=7, stroke_fill=BG + (int(255*a),))
    else:
        k = s["oc"]; c = OC[k]["col"]
        tr = wt(s, "yer") - 0.25
        a = ease((lt-tr)/0.3)*oa; kk = back((lt-tr)/0.45)
        if a > 0:
            fs = max(10, int(210*kk))
            d.text((44, 330), str(6-["r1","r2","r3","r4","r5"].index(sid)-0) if False else str(k if False else {"r5":5,"r4":4,"r3":3,"r2":2,"r1":1}[sid]),
                   font=font("InterDisplay-Black.otf", fs), fill=c + (int(255*a),), anchor="ls")
            d.text((48 + 0, 342), "YER", font=font("Inter-ExtraBold.otf", 26), fill=INK + (int(255*a),), anchor="lt") if False else None
        tn = wt(s, OC[k]["name"][0].split()[0]) - 0.1
        for li, line in enumerate(OC[k]["name"]):
            a2 = ease((lt - tn - li*0.08)/0.35)*oa
            if a2 > 0:
                ox = (1-eout((lt-tn-li*0.08)/0.4))*40
                fsz = 84 if len(line) < 10 else 72
                d.text((210 + ox, 168 + li*92), line, font=font("InterDisplay-Black.otf", fsz), fill=(INK if li == 0 else c) + (int(255*a2),), anchor="la")

    # ---- səhnə qrafikası
    if sid == "intro":
        tk = wt(s, "71") - 0.1
        a = ease((lt-tk)/0.3)*oa
        if a > 0:
            v = int(71*eout((lt-tk)/0.9))
            rr = 112*back((lt-tk)/0.4)
            px, py = 850, 520
            d.ellipse((px-rr, py-rr, px+rr, py+rr), fill=INK + (int(255*a),))
            d.text((px, py-10), f"{v}%", font=font("InterDisplay-Black.otf", 74), fill=(255, 255, 255, int(255*a)), anchor="mm")
            d.text((px, py+46), "su", font=font("Inter-Bold.otf", 28), fill=(180, 220, 235, int(255*a)), anchor="mm")
    if sid.startswith("r") or sid == "five":
        # artan bar kartı
        shown = [x for x in SC if x["id"].startswith("r") and t >= x["t0"] + wt(x, "milyon") - 0.4] if sid != "five" else []
        if shown:
            y0 = 1300; rowh = 54
            a = oa if sid != "r5" or len(shown) > 1 else ease((lt - wt(s, "milyon") + 0.4)/0.3)
            d.rounded_rectangle((48, y0-24, 1032, y0 + rowh*len(shown) - 6), 24, fill=(255, 255, 255, int(200*a)), outline=INK + (int(40*a),), width=2)
            for j, x in enumerate(shown):
                k = x["oc"]; c = OC[k]["col"]
                y = y0 + 6 + j*rowh + 10
                f = eout((t - (x["t0"] + wt(x, "milyon") - 0.4))/0.9)
                d.text((72, y), OC[k]["name"][0], font=font("Inter-Bold.otf", 28), fill=INK + (int(255*a),), anchor="lm")
                bx0, bx1 = 290, 800
                w = (bx1-bx0)*OC[k]["area"]/168.7*f
                d.rounded_rectangle((bx0, y-14, bx0+max(28, w), y+14), 14, fill=c + (int(255*a),))
                val = OC[k]["area"]*f
                d.text((1010, y), f"{val:.1f}".replace(".", ",") + " mln km²", font=font("Inter-Bold.otf", 26),
                       fill=INK + (int(255*a),), anchor="rm")
    if sid == "r1":
        tq = wt(s, "bütün") - 0.1
        a = ease((lt-tq)/0.3)*oa
        if a > 0:
            d.rounded_rectangle((560, 470, 1030, 590), 22, fill=INK + (int(235*a),))
            d.text((795, 508), "Bütün quru ≈149 mln km²", font=font("Inter-Bold.otf", 28), fill=(255, 255, 255, int(255*a)), anchor="mm")
            d.text((795, 552), "Sakit okean daha böyükdür", font=font("Inter-SemiBold.otf", 26), fill=(255, 160, 140, int(255*a)), anchor="mm")
    if sid == "r4":
        a = ease((lt - wt(s, "yeni") + 0.1)/0.3)*oa
        if a > 0:
            d.rounded_rectangle((560, 470, 1030, 560), 22, fill=INK + (int(235*a),))
            d.text((795, 515), "Sərhəd: 60° c.e.-dan cənuba", font=font("Inter-Bold.otf", 27), fill=(255, 255, 255, int(255*a)), anchor="mm")
    if sid == "mariana":
        x, y, z = lonlat_to_screen(142.2, 11.35, lon0, lat0, R)
        if z > 0:
            pa = ease((lt-0.8)/0.3)*oa
            pr = 18 + 22*((lt*1.4) % 1)
            d.ellipse((x-pr, y-pr, x+pr, y+pr), outline=(255, 104, 74, int(255*pa*(1-((lt*1.4) % 1)))), width=5)
            d.ellipse((x-11, y-11, x+11, y+11), fill=(255, 104, 74, int(255*pa)), outline=(255, 255, 255, int(255*pa)), width=3)
            d.text((x+24, y-30), "Mariana çökəkliyi", font=font("Inter-ExtraBold.otf", 34), fill=(255, 255, 255, int(255*pa)), anchor="lm",
                   stroke_width=5, stroke_fill=INK + (int(220*pa),))
        # kəsik diaqramı
        a = ease((lt - wt(s, "təxminən") + 0.2)/0.35)*oa
        if a > 0:
            bx0, by0, bx1, by1 = 48, 1250, 1032, 1600
            d.rounded_rectangle((bx0, by0, bx1, by1), 26, fill=(255, 255, 255, int(230*a)), outline=INK + (int(40*a),), width=2)
            sea = by0 + 60; scale = (by1 - 40 - sea)/11000
            d.rectangle((bx0+20, sea, bx1-20, by1-20), fill=(196, 222, 232, int(255*a)))
            bot = sea + 11000*scale*eout((lt - wt(s, "təxminən"))/0.8)
            d.polygon([(bx0+20, sea), (430, sea), (520, bot), (610, sea), (bx1-20, sea), (bx1-20, sea-1), (bx0+20, sea-1)], fill=(196, 222, 232, 0))
            # dib profili
            prof = [(bx0+20, sea+260*scale*10), (380, sea+5500*scale), (500, bot), (540, bot), (660, sea+5500*scale), (bx1-20, sea+240*scale*10)]
            d.polygon(prof + [(bx1-20, by1-20), (bx0+20, by1-20)], fill=(60, 72, 74, int(255*a)))
            d.line([(bx0+20, sea), (bx1-20, sea)], fill=(40, 120, 170, int(255*a)), width=4)
            d.text((bx0+34, sea-28), "dəniz səviyyəsi", font=font("Inter-SemiBold.otf", 24), fill=(40, 120, 170, int(255*a)), anchor="lm")
            d.text((700, bot-40), "≈ 11 km", font=font("InterDisplay-Black.otf", 54), fill=(255, 104, 74, int(255*a)), anchor="lm")
            te = wt(s, "Everesti") - 0.1
            fe = eout((lt-te)/1.0)
            if fe > 0:
                top = bot - 8850*scale*fe
                d.polygon([(450, bot), (520, top), (590, bot)], fill=(240, 236, 228, int(255*a)), outline=INK + (int(255*a),))
                d.polygon([(505, top+40*fe), (520, top), (535, top+40*fe)], fill=(255, 255, 255, int(255*a)))
                d.text((610, top+18), "Everest ≈8,85 km", font=font("Inter-ExtraBold.otf", 30), fill=INK + (int(255*a),), anchor="lm")
                if fe > 0.95:
                    k2 = ease((lt - wt(s, "suyun"))/0.3)
                    if k2 > 0:
                        d.line([(520, sea+4), (520, top-6)], fill=(40, 120, 170, int(255*k2*a)), width=3)
                        d.text((300, (sea+top)/2), "≈2 km su", font=font("Inter-ExtraBold.otf", 30), fill=(40, 120, 170, int(255*k2*a)), anchor="mm")
    if sid == "cta":
        ks = [(5, "Şimal Buzlu"), (4, "Cənub"), (3, "Hind"), (2, "Atlantik"), (1, "Sakit")]
        for j, (k, nm) in enumerate(ks):
            tk = 0.4 + j*0.12
            kk = back((lt-tk)/0.4); a = ease((lt-tk)/0.3)
            if a > 0:
                col = j % 2; row = j // 2
                cx = 290 + col*500 if j < 4 else 540; cy = 1290 + row*90
                tw = d.textlength(nm, font=font("Inter-ExtraBold.otf", 36))
                w = (tw/2 + 34)*kk
                d.rounded_rectangle((cx-w, cy-36*kk, cx+w, cy+36*kk), int(36*kk), fill=OC[k]["col"] + (int(255*a),))
                if kk > 0.6: d.text((cx, cy), nm, font=font("Inter-ExtraBold.otf", 36), fill=(255, 255, 255, int(255*a)), anchor="mm")
        a = ease((lt - wt(s, "Şərhdə"))/0.3)
        if a > 0:
            d.text((540, 1590), "↓  Şərhdə yaz", font=font("InterDisplay-Black.otf", 52), fill=INK + (int(255*a),), anchor="mm")

    # ---- karaoke subtitr
    for ch in s["chunks"]:
        if ch["t0"] - 0.05 <= t < ch["t1"]:
            f = font("Inter-ExtraBold.otf", 54); sp = d.textlength(" ", font=f)
            items = [(a_, w_, h_, d.textlength(w_, font=f)) for a_, w_, h_ in ch["words"]]
            tw = sum(x[3] for x in items) + sp*(len(items)-1)
            if tw > 960:
                f = font("Inter-ExtraBold.otf", 46); sp = d.textlength(" ", font=f)
                items = [(a_, w_, h_, d.textlength(w_, font=f)) for a_, w_, h_ in ch["words"]]
                tw = sum(x[3] for x in items) + sp*(len(items)-1)
            ap = ease((t - ch["t0"] + 0.05)/0.12)
            by = 1720
            d.rounded_rectangle((540-tw/2-30, by-56, 540+tw/2+30, by+30), 24, fill=(255, 255, 255, int(245*ap)),
                                outline=INK + (int(255*ap),), width=3)
            x = 540 - tw/2
            acc = OC[s["oc"]]["col"] if s["oc"] else (40, 120, 170)
            for a_, w_, h_, ww in items:
                said = t >= a_ - 0.03
                c = (acc if h_ else INK) if said else (185, 182, 172)
                d.text((x, by), w_, font=f, fill=c + (int(255*ap),), anchor="ls")
                x += ww + sp
            break
    d.text((540, 1878), "Mənbə: Britannica (NOAA ETOPO1 məlumatı) · Xəritə: Natural Earth · Səs: AI",
           font=font("Inter-Medium.otf", 21), fill=(140, 134, 120), anchor="mm")
    # keçid: yuxarıdan aşağı sürüşən zolaq (wipe)
    if s is not SC[0] and lt < 0.22:
        k = 1 - eout(lt/0.22)
        d.rectangle((0, 0, W, int(H*k)), fill=OC[s["oc"]]["col"] + (255,) if s["oc"] and sid.startswith("r") else INK + (255,))
    if t < 0.15: img = Image.blend(Image.new("RGB", img.size, BG), img, t/0.15)
    return img.tobytes()

if __name__ == "__main__":
    out = sys.argv[1]; only = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"duration {DUR:.2f}s frames {NF}")
    for s in SC: print(s["id"], round(s["t0"], 2), round(s["t1"], 2))
    json.dump(dict(scenes=[dict(id=s["id"], t0=s["t0"], t1=s["t1"], vs=s["vs"]) for s in SC], dur=DUR), open(out + ".timeline.json", "w"))
    if only:
        winit()
        for ts in only.split(","):
            Image.frombytes("RGB", (W, H), frame(int(float(ts)*FPS))).save(f"{out}_{ts}.jpg", quality=88)
        sys.exit()
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                           "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    with Pool(4, initializer=winit) as pool:
        for k, b in enumerate(pool.imap(frame, range(NF), chunksize=4)):
            ff.stdin.write(b)
            if k % 300 == 0: print(k, flush=True)
    ff.stdin.close(); ff.wait()
