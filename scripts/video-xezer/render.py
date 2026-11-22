# Xəzər: dəniz, yoxsa göl? — 1080x1920, 30 fps xəritə-animasiya renderi
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from multiprocessing import Pool

HERE = os.environ.get("XEZER_WORK", os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from geo import proj

W, H, FPS = 1080, 1920, 30
SS = 2  # overlay supersampling
AMBER = (255, 181, 71)
CYAN = (111, 227, 255)
WHITE = (246, 244, 238)
MUTED = (170, 178, 188)
CORAL = (255, 105, 97)
FD = "/usr/share/fonts/opentype/inter/"

def font(name, size):
    return ImageFont.truetype(FD + name, size)

F_TITLE = font("InterDisplay-Black.otf", 96)
F_KICK = font("Inter-Bold.otf", 30)
F_SUB = font("Inter-ExtraBold.otf", 60)
F_LAB = font("Inter-Bold.otf", 34)
F_LABS = font("Inter-SemiBold.otf", 28)
F_CARDBIG = font("InterDisplay-Black.otf", 104)
F_CARD = font("Inter-SemiBold.otf", 32)
F_CRED = font("Inter-Medium.otf", 22)

# ---------------------------------------------------------------- data
VEC = json.load(open(os.path.join(HERE, "vec.json")))
CASPIAN = [proj(*p[:2]) for p in VEC["caspian"]]

def chain(segs, start):
    """segments-i uc-uca birləşdirib start nöqtəsindən başlayan yol qur"""
    path = [start]; segs = [list(map(tuple, s)) for s in segs]
    def close(a, b): return abs(a[0]-b[0]) < 1e-3 and abs(a[1]-b[1]) < 1e-3
    while True:
        cur = path[-1]; found = False
        for s in segs:
            if close(s[0], cur): path += s[1:]; segs.remove(s); found = True; break
            if close(s[-1], cur): path += s[::-1][1:]; segs.remove(s); found = True; break
        if not found: break
    return path

def pick(name, ends):
    return [s for s in VEC[name] if any(abs(s[0][0]-e) < 1e-3 or abs(s[-1][0]-e) < 1e-3 for e in ends)]

volga_segs = [s for s in VEC["Volga"] if min(p[1] for p in s) < 52.2 and len(s) != 85]
VOLGA = [proj(*p) for p in chain(volga_segs, (47.768972, 52.074042))]
URAL = [proj(*p) for p in VEC["Ural"][2][::-1]][::-1]  # yuxarıdan mənsəbə
URAL = [proj(*p) for p in VEC["Ural"][2]]
KURA = [proj(*p) for p in chain(VEC["Kura"], (42.822276, 40.920681))]
COUNTRIES = {k: [[proj(*q) for q in r] for r in v] for k, v in VEC["countries"].items()}

DEPTH = np.load(os.path.join(HERE, "depth.npy")).astype(np.float32)
LANDM = np.asarray(Image.open(os.path.join(HERE, "landmask.png")))

def depth_profile(lon, lat0, lat1, n=160):
    out = []
    for i in range(n):
        lat = lat0 + (lat1 - lat0) * i / (n - 1)
        x, y = proj(lon, lat); x, y = int(x), int(y)
        out.append(0.0 if LANDM[y, x] > 127 else float(DEPTH[y, x]))
    return out

# ---------------------------------------------------------------- easing
def clamp(v, a=0.0, b=1.0): return max(a, min(b, v))
def ease(t): t = clamp(t); return t*t*(3-2*t)
def eio(t): t = clamp(t); return 4*t*t*t if t < .5 else 1-(-2*t+2)**3/2
def eout(t): t = clamp(t); return 1-(1-t)**3
def back(t):
    t = clamp(t); c1 = 1.70158; c3 = c1+1
    return 1 + c3*(t-1)**3 + c1*(t-1)**2

# ---------------------------------------------------------------- script
# *söz* = vurğulanan açar söz
SCENES = [
    dict(id="hook", kicker="XƏRİTƏDƏ FAKT", title=["XƏZƏR:", "DƏNİZ, YOXSA GÖL?"],
         subs=["Xəzərə hamı *dəniz* deyir.", "Bəs əslində o, *nədir?*"],
         cam=[(0, 50.6, 41.6, 2.15), (1, 50.9, 41.7, 1.85)]),
    dict(id="closed", kicker="OKEANA TƏBİİ ÇIXIŞ YOXDUR", title=["QAPALI", "HÖVZƏ"],
         subs=["Xəzərin okeana *təbii* çıxışı yoxdur.", "Bu, dünyanın ən böyük *qapalı* su hövzəsidir."],
         cam=[(0, 50.9, 41.7, 1.85), (0.35, 47.5, 42.6, 2.75), (1, 47.6, 42.6, 2.85)]),
    dict(id="size", kicker="ÖLÇÜ", title=["NƏHƏNG", "SU GÜZGÜSÜ"],
         subs=["Sahəsi təxminən *386 min* kvadrat kilometrdir.", "Bu, *Yaponiyadan* da böyükdür.",
               "Şimaldan cənuba uzunluğu *1200 km-ə* yaxındır."],
         cam=[(0, 47.6, 42.6, 2.85), (0.3, 50.6, 41.5, 1.95), (1, 50.6, 41.6, 1.9)]),
    dict(id="level", kicker="SƏVİYYƏ", title=["OKEANDAN", "AŞAĞIDA"],
         subs=["Səthi okean səviyyəsindən", "təxminən *27 metr* aşağıdadır.", "Bu səviyyə illər boyu *dəyişir*."],
         cam=[(0, 50.6, 41.6, 1.9), (1, 50.3, 41.0, 1.75)]),
    dict(id="depth", kicker="DƏRİNLİK", title=["ŞİMAL DAYAZ,", "CƏNUB DƏRİN"],
         subs=["Şimal hissə çox *dayazdır:*", "orta dərinlik cəmi *4–8 metr.*", "Cənubda isə dərinlik *1025 metrə* çatır."],
         cam=[(0, 50.3, 41.0, 1.75), (0.12, 50.0, 45.4, 1.25), (0.45, 50.0, 45.3, 1.2),
              (0.62, 50.9, 38.6, 1.25), (1, 50.9, 38.7, 1.2)]),
    dict(id="salt", kicker="DUZLULUQ", title=["NƏ ŞİRİN,", "NƏ OKEAN"],
         subs=["Suyu okeandan təxminən *üç dəfə* az duzludur.", "*Volqa* mənsəbində su demək olar ki, şirindir,",
               "*Qarabağazgöldə* isə həddən artıq duzlu."],
         cam=[(0, 50.9, 38.7, 1.2), (0.2, 50.4, 43.6, 2.3), (1, 50.6, 43.4, 2.2)]),
    dict(id="states", kicker="SAHİLYANI ÖLKƏLƏR", title=["BEŞ ÖLKƏ,", "BİR HÖVZƏ"],
         subs=["Sahilində *beş ölkə* var.", "2018-ci ildə *Aktauda* imzalanan konvensiya",
               "Xəzərə *xüsusi* hüquqi status verdi."],
         cam=[(0, 50.6, 43.4, 2.2), (0.25, 51.0, 41.0, 2.15), (1, 51.0, 41.1, 2.1)]),
    dict(id="answer", kicker="BƏS CAVAB?", title=["ADI DƏNİZ,", "ÖZÜ GÖL"],
         subs=["Coğrafiyaçılar onu çox vaxt", "dünyanın ən böyük *gölü* sayır."],
         cam=[(0, 51.0, 41.1, 2.1), (1, 50.8, 41.6, 2.35)], tail=3.4),
]

def word_dur(w):
    return 0.16 + 0.05 * len(w.strip("*"))

T = 0.0
for sc in SCENES:
    sc["t0"] = T
    chunks = []
    t = T + 0.35
    for sent in sc["subs"]:
        raw = sent.split(); words = []; buf = None
        for w in raw:  # *...* ifadəsini bölmə
            if buf is not None:
                buf += " " + w
                if "*" in w: words.append(buf); buf = None
            elif w.startswith("*") and w.count("*") == 1: buf = w
            else: words.append(w)
        if buf: words.append(buf)
        # 2-4 sözlük hissələr
        groups, cur = [], []
        for w in words:
            cur.append(w)
            if len(cur) == 4 or (len(cur) >= 2 and len(" ".join(cur)) > 22):
                groups.append(cur); cur = []
        if cur:
            if groups and len(cur) == 1: groups[-1].append(cur[0])
            else: groups.append(cur)
        for g in groups:
            ws = []
            for w in g:
                d = word_dur(w); ws.append((t, w)); t += d
            chunks.append(dict(t0=ws[0][0], t1=t + 0.12, words=ws))
            t += 0.12
        t += 0.18
    sc["chunks"] = chunks
    T = t + 0.25 + sc.get("tail", 0)
    sc["t1"] = T
DUR = T
NF = int(math.ceil(DUR * FPS))

# ---------------------------------------------------------------- camera
def cam_at(sc, u):
    ks = sc["cam"]
    if u <= ks[0][0]: k = ks[0]; return k[1:]
    for a, b in zip(ks, ks[1:]):
        if u <= b[0]:
            f = eio((u - a[0]) / (b[0] - a[0]))
            lon = a[1] + (b[1]-a[1])*f; lat = a[2] + (b[2]-a[2])*f
            s = math.exp(math.log(a[3]) + (math.log(b[3])-math.log(a[3]))*f)
            return lon, lat, s
    return ks[-1][1:]

BASE = None
def init():
    global BASE
    BASE = Image.open(os.path.join(HERE, "base.png")).convert("RGB")

def render_map(lon, lat, s):
    cx, cy = proj(lon, lat)
    a = (s, 0, cx - s*W/2, 0, s, cy - s*H/2)
    im = BASE.transform((W, H), Image.AFFINE, a, resample=Image.BILINEAR)
    return im, (cx, cy, s)

def P(cam, pt, k=SS):
    cx, cy, s = cam
    return ((pt[0]-cx)/s*k + W*k/2, (pt[1]-cy)/s*k + H*k/2)

def partial(path, f):
    if f >= 1: return path
    n = max(2, int(len(path)*f)); return path[:n]

# ---------------------------------------------------------------- drawing helpers
def rrect(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, r, fill=fill, outline=outline, width=width)

def text_w(d, s, f): return d.textlength(s, font=f)

def draw_label(img, d, xy, txt, f=F_LAB, col=WHITE, alpha=1.0, anchor="lm", dot=None):
    if alpha <= 0: return
    x, y = xy
    a = int(255*alpha)
    if dot:
        r = 9
        d.ellipse((x-r-4, y-r-4, x+r+4, y+r+4), fill=(*dot, int(70*alpha)))
        d.ellipse((x-r, y-r, x+r, y+r), fill=(*WHITE, a), outline=(*dot, a), width=4)
        x += 22
    d.text((x, y), txt, font=f, fill=(*col, a), anchor=anchor, stroke_width=4, stroke_fill=(8, 14, 22, int(200*alpha)))

def card(img, box, alpha=1.0, r=28):
    if alpha <= 0: return
    d = ImageDraw.Draw(img, "RGBA")
    rrect(d, box, r, fill=(9, 16, 26, int(215*alpha)), outline=(255, 255, 255, int(30*alpha)), width=2)

GRAD = None
def gradients():
    g = np.zeros((H, W, 4), np.uint8)
    y = np.arange(H)[:, None]
    top = np.clip(1 - y/560, 0, 1)**1.6 * 235
    bot = np.clip((y - 1260)/560, 0, 1)**1.4 * 235
    g[..., :3] = (6, 12, 20); g[..., 3] = np.maximum(top, bot).astype(np.uint8).repeat(W, 1)
    # vinyet
    xx = (np.arange(W)[None, :] - W/2)/(W/2); yy = (np.arange(H)[:, None]-H/2)/(H/2)
    v = np.clip((xx**2*0.6 + yy**2*0.25) - 0.25, 0, 1) * 120
    g[..., 3] = np.maximum(g[..., 3], v.astype(np.uint8))
    return Image.fromarray(g, "RGBA")

# ---------------------------------------------------------------- scene overlays
def stroke_path(d, pts, col, w, alpha):
    if len(pts) > 1:
        d.line(pts, fill=(*col, int(255*alpha)), width=w, joint="curve")

def overlay_vectors(t, sc, u, cam):
    """2x ölçüdə xətlər, sonra kiçildilir (antialias)"""
    lay = Image.new("RGBA", (W*SS, H*SS), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    glow = Image.new("RGBA", (W*SS, H*SS), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
    sid = sc["id"]; lt = t - sc["t0"]

    # ölkə sərhədləri (zəif)
    bord_a = 0.22
    if sid == "states": bord_a = 0.22 + 0.35*ease(lt/1.2)
    if sid == "answer": bord_a = 0.22*(1-ease(lt/1.0))
    for k, rings in COUNTRIES.items():
        for r in rings:
            pts = [P(cam, p) for p in r]
            d.line(pts, fill=(220, 225, 232, int(255*bord_a*0.55)), width=2)

    # Xəzər sahil xətti
    if sid == "hook": f = eout(lt/2.6)
    else: f = 1
    cas = [P(cam, p) for p in partial(CASPIAN, f)]
    ca = 1.0
    if sid in ("depth",): ca = 0.55
    stroke_path(g, cas, AMBER, 14, 0.55*ca)
    stroke_path(d, cas, AMBER, 5, 0.95*ca)

    # çaylar
    riv_a = 0.0; vf = 1.0
    if sid == "salt": riv_a = 1; vf = eout((lt-1.2)/2.4)
    elif sid in ("states", "answer", "closed", "size", "level", "depth"): riv_a = 0.45
    elif sid == "hook": riv_a = ease((lt-1.5)/1.5)*0.45
    if riv_a > 0:
        for path, f in ((VOLGA, vf), (URAL, 1 if sid != "salt" else vf), (KURA, 1)):
            pts = [P(cam, p) for p in partial(path, f)]
            stroke_path(g, pts, CYAN, 12, 0.4*riv_a)
            stroke_path(d, pts, CYAN, 4, 0.95*riv_a)

    # qapalı hövzə: Xəzər -> Qara dəniz ox, ortada X
    if sid == "closed":
        a = proj(48.6, 42.9); b = proj(41.2, 43.4)
        fr = eout((lt-1.0)/1.6)
        pa, pb = P(cam, a), P(cam, b)
        n = 26
        for i in range(n):
            if i % 2: continue
            s0, s1 = i/n, (i+1)/n
            if s0 > fr: break
            s1 = min(s1, fr)
            p0 = (pa[0]+(pb[0]-pa[0])*s0, pa[1]+(pb[1]-pa[1])*s0 - math.sin(s0*math.pi)*160)
            p1 = (pa[0]+(pb[0]-pa[0])*s1, pa[1]+(pb[1]-pa[1])*s1 - math.sin(s1*math.pi)*160)
            d.line([p0, p1], fill=(*WHITE, 230), width=6)
        xs = ease((lt-2.4)/0.4)
        if xs > 0:
            m = (pa[0]+(pb[0]-pa[0])*0.5, pa[1]+(pb[1]-pa[1])*0.5 - 160)
            r = 52*back((lt-2.4)/0.45)
            d.ellipse((m[0]-r, m[1]-r, m[0]+r, m[1]+r), fill=(*CORAL, int(255*xs)))
            q = r*0.42
            d.line([(m[0]-q, m[1]-q), (m[0]+q, m[1]+q)], fill=(255, 255, 255, int(255*xs)), width=12)
            d.line([(m[0]-q, m[1]+q), (m[0]+q, m[1]-q)], fill=(255, 255, 255, int(255*xs)), width=12)

    # ölçü: şimal-cənub xətti
    if sid == "size":
        f = eout((lt-3.6)/1.6)
        a = P(cam, proj(55.6, 47.05)); b = P(cam, proj(55.6, 36.6))
        if f > 0:
            e = (a[0], a[1]+(b[1]-a[1])*f)
            d.line([a, e], fill=(*WHITE, 240), width=5)
            for y in (a[1], e[1]):
                d.line([(a[0]-22, y), (a[0]+22, y)], fill=(*WHITE, 240), width=5)
            # sahildən xəttə nazik bağlantılar
            for lat in (47.05, 36.6):
                if lat == 36.6 and f < 1: continue
                p = P(cam, proj(53.4 if lat > 40 else 53.9, lat))
                d.line([p, (a[0], p[1])], fill=(*WHITE, 110), width=2)

    lay.alpha_composite(glow.filter(ImageFilter.GaussianBlur(10)), (0, 0))
    lay.alpha_composite(glow.filter(ImageFilter.GaussianBlur(3)), (0, 0)) if False else None
    out = Image.new("RGBA", (W*SS, H*SS), (0, 0, 0, 0))
    out.alpha_composite(glow.filter(ImageFilter.GaussianBlur(12)))
    out.alpha_composite(lay)
    return out.resize((W, H), Image.LANCZOS)

def scene_labels(img, d, t, sc, u, cam):
    sid = sc["id"]; lt = t - sc["t0"]; dur = sc["t1"] - sc["t0"]
    out_a = 1 - ease((lt - (dur - 0.35))/0.35)  # səhnə sonu solma
    def L(lon, lat, txt, t_in, **kw):
        a = ease((lt - t_in)/0.4)*out_a
        x, y = P(cam, proj(lon, lat), 1)
        draw_label(img, d, (x, y), txt, alpha=a, **kw)

    if sid == "hook":
        L(49.87, 40.41, "Bakı", 1.8, dot=AMBER)
        L(50.3, 43.2, "XƏZƏR", 2.2, f=F_LAB, col=AMBER, anchor="mm")
    if sid == "closed":
        L(35.5, 43.5, "QARA DƏNİZ", 0.6, col=MUTED) if False else None
        x, y = P(cam, proj(36.6, 43.0), 1)
        draw_label(img, d, (max(70, x), y), "QARA DƏNİZ", col=CYAN, alpha=ease((lt-0.8)/0.4)*out_a, anchor="lm")
        L(51.0, 41.8, "XƏZƏR", 0.8, col=AMBER, anchor="mm")
        a = ease((lt-2.7)/0.4)*out_a
        if a > 0:
            card(img, (70, 1090, 1010, 1240), a)
            d.text((540, 1140), "Okean → Qara dəniz → ... → Xəzər?", font=F_CARD, fill=(*MUTED, int(255*a)), anchor="mm")
            d.text((540, 1192), "Təbii yol yoxdur", font=F_LAB, fill=(*CORAL, int(255*a)), anchor="mm")
    if sid == "size":
        L(49.87, 40.41, "Bakı", 0.0, dot=AMBER)
        a = ease((lt-0.6)/0.4)*out_a
        if a > 0:
            card(img, (70, 1020, 600, 1250), a)
            val = int(386400 * eout((lt-0.6)/2.2))
            s = f"{val:,}".replace(",", " ")
            d.text((105, 1100), s, font=F_CARDBIG, fill=(*WHITE, int(255*a)), anchor="lm")
            d.text((108, 1185), "km²  ·  təxminən", font=F_CARD, fill=(*AMBER, int(255*a)), anchor="lm")
        a2 = ease((lt-2.9)/0.4)*out_a
        if a2 > 0:
            card(img, (70, 1265, 600, 1335), a2, r=22)
            d.text((105, 1300), "Yaponiyadan böyük", font=F_CARD, fill=(*WHITE, int(255*a2)), anchor="lm")
        a3 = ease((lt-4.8)/0.4)*out_a
        if a3 > 0:
            x, y = P(cam, proj(55.6, 41.8), 1)
            draw_label(img, d, (x-22, y), "≈1200 km", f=F_LAB, col=WHITE, alpha=a3, anchor="rm")
    if sid == "level":
        a = ease((lt-0.3)/0.4)*out_a
        if a > 0:
            card(img, (70, 1000, 1010, 1330), a)
            A = int(255*a)
            y0, y1 = 1085, 1255
            d.text((110, 1040), "Okean səviyyəsi", font=F_CARD, fill=(*CYAN, A), anchor="lm")
            for x in range(110, 970, 26):
                d.line([(x, y0), (x+14, y0)], fill=(*CYAN, A), width=4)
            d.text((970, 1040), "0 m", font=F_LAB, fill=(*CYAN, A), anchor="rm")
            f = eout((lt-1.0)/1.6)
            yy = y0 + (y1-y0)*f
            d.rectangle((110, yy, 970, yy+5), fill=(*AMBER, A))
            # ox
            d.line([(540, y0+10), (540, yy-14)], fill=(*WHITE, A), width=4)
            if f > 0.15:
                d.polygon([(528, yy-26), (552, yy-26), (540, yy-10)], fill=(*WHITE, A))
            lvl = -27*f
            d.text((970, yy+32), f"≈ {lvl:.0f} m".replace("-", "−"), font=F_LAB, fill=(*AMBER, A), anchor="rm")
            d.text((110, yy+32), "Xəzərin səthi", font=F_CARD, fill=(*AMBER, A), anchor="lm")
    if sid == "depth":
        n_in = 0.12*dur + 0.3; s_in = 0.62*dur + 0.3
        a = ease((lt-n_in)/0.4)*(1-ease((lt-(0.5*dur))/0.3))
        if a > 0:
            x, y = P(cam, proj(50.0, 45.6), 1)
            card(img, (x-250, y-70, x+250, y+70), a)
            d.text((x, y-22), "Orta dərinlik", font=F_CARD, fill=(*MUTED, int(255*a)), anchor="mm")
            d.text((x, y+24), "4–8 m", font=F_LAB, fill=(*CYAN, int(255*a)), anchor="mm")
        a = ease((lt-s_in)/0.4)*out_a
        if a > 0:
            x, y = P(cam, proj(51.3, 37.9), 1)
            draw_label(img, d, (x, y), "1025 m", f=F_LAB, col=AMBER, alpha=a, dot=AMBER)
        # real dərinlik profili (Terrain Tiles batimetriyası)
        a = ease((lt-0.6)/0.4)*out_a
        if a > 0:
            card(img, (70, 1230, 1010, 1480), a)
            prof = PROFILE
            x0, x1, yt, yb = 110, 970, 1285, 1450
            A = int(255*a)
            d.text((110, 1260), "Şimal", font=F_LABS, fill=(*MUTED, A), anchor="lm")
            d.text((970, 1260), "Cənub", font=F_LABS, fill=(*MUTED, A), anchor="rm")
            reveal = eout((lt-0.8)/(0.9*dur))
            n = len(prof); m = max(2, int(n*reveal))
            pts = [(x0 + (x1-x0)*i/(n-1), yt + (yb-yt)*min(prof[i], 1100)/1100) for i in range(m)]
            poly = [(x0, yt)] + pts + [(pts[-1][0], yt)]
            d.polygon(poly, fill=(30, 110, 140, int(170*a)))
            d.line(pts, fill=(*CYAN, A), width=4)
            d.line([(x0, yt), (x1, yt)], fill=(*WHITE, int(120*a)), width=2)
            d.text((x0+8, yb-6), "1000 m", font=F_CRED, fill=(*MUTED, A), anchor="lb")
    if sid == "salt":
        a = ease((lt-0.5)/0.4)*out_a
        if a > 0:
            card(img, (70, 1225, 1010, 1480), a)
            A = int(255*a)
            # iki bar: Xəzər 12.8‰, okean 35‰
            f = eout((lt-0.8)/1.4)
            for i, (name, v, col) in enumerate((("Xəzər", 12.8, AMBER), ("Okean", 35.0, CYAN))):
                y = 1285 + i*90
                d.text((110, y), name, font=F_CARD, fill=(*WHITE, A), anchor="lm")
                bx0, bx1 = 280, 820
                rrect(d, (bx0, y-16, bx1, y+16), 16, fill=(255, 255, 255, int(25*a)))
                w = (bx1-bx0)*v/35*f
                if w > 32: rrect(d, (bx0, y-16, bx0+w, y+16), 16, fill=(*col, A))
                d.text((970, y), f"≈{v:.1f}‰".replace(".", ",") if v != 35 else "≈35‰", font=F_LAB, fill=(*col, A), anchor="rm")
            d.text((110, 1450), "orta duzluluq, ‰ (promil)", font=F_CRED, fill=(*MUTED, A), anchor="lm")
        vend = VOLGA[-1]
        L(47.9, 46.25, "Volqa  ≈1‰", 3.0, dot=CYAN, col=CYAN)
        L(53.6, 41.25, "Qarabağazgöl  200‰-ə qədər", 5.0, dot=AMBER, col=AMBER, anchor="lm") if False else None
        a = ease((lt-5.2)/0.4)*out_a
        if a > 0:
            x, y = P(cam, proj(53.6, 41.25), 1)
            draw_label(img, d, (x, y), "Qarabağazgöl", col=AMBER, alpha=a, dot=AMBER)
            d.text((x+22, y-44), "200‰-ə qədər", font=F_LABS, fill=(*AMBER, int(255*a)), anchor="lm",
                   stroke_width=4, stroke_fill=(8, 14, 22, int(200*a)))
    if sid == "states":
        names = [("Rusiya", 46.8, 44.9), ("Qazaxıstan", 53.0, 46.4), ("Türkmənistan", 54.6, 39.6),
                 ("İran", 55.5, 36.95), ("Azərbaycan", 47.2, 40.35)]
        for i, (nm, lo, la) in enumerate(names):
            a = ease((lt - (0.5 + i*0.32))/0.35)*out_a
            if a > 0:
                x, y = P(cam, proj(lo, la), 1)
                sc_ = back((lt - (0.5 + i*0.32))/0.4)
                f = font("Inter-ExtraBold.otf", max(8, int(40*sc_)))
                d.text((x, y), nm, font=f, fill=(*WHITE, int(255*a)), anchor="mm", stroke_width=5, stroke_fill=(8, 14, 22, int(210*a)))
        L(51.17, 43.65, "Aktau", 2.6, dot=AMBER, col=AMBER)
        a = ease((lt-3.0)/0.4)*out_a
        if a > 0:
            card(img, (70, 1330, 800, 1470), a)
            d.text((110, 1372), "2018 · Aktau", font=F_LAB, fill=(*AMBER, int(255*a)), anchor="lm")
            d.text((110, 1425), "Xəzərin hüquqi statusu haqqında konvensiya", font=F_CARD, fill=(*WHITE, int(255*a)), anchor="lm")
    if sid == "answer":
        # son kadr: CTA
        cta_in = sc["chunks"][-1]["t1"] - sc["t0"] + 0.1
        a = ease((lt - cta_in)/0.5)
        if a > 0:
            d.rectangle((0, 0, W, H), fill=(5, 10, 18, int(170*a)))
            A = int(255*a)
            d.text((540, 820), "Sənin cavabın?", font=font("InterDisplay-Black.otf", 88), fill=(*WHITE, A), anchor="mm")
            for i, (txt, col) in enumerate((("DƏNİZ", CYAN), ("GÖL", AMBER))):
                k = back((lt - cta_in - 0.15 - i*0.15)/0.45)
                cx = 330 + i*420; cy = 990
                w, h = 170*k, 64*k
                if k > 0.05:
                    rrect(d, (cx-w, cy-h, cx+w, cy+h), int(h), fill=(*col, A))
                    d.text((cx, cy), txt, font=font("InterDisplay-Black.otf", max(8, int(64*k))), fill=(10, 16, 24, A), anchor="mm")
            d.text((540, 1140), "Şərhdə yaz", font=font("Inter-Bold.otf", 46), fill=(*WHITE, A), anchor="mm")

PROFILE = None

def draw_text_layer(img, t, sc):
    d = ImageDraw.Draw(img, "RGBA")
    lt = t - sc["t0"]; dur = sc["t1"] - sc["t0"]
    # progress seqmentləri
    n = len(SCENES); gap = 10; x0, x1 = 48, 1032
    sw = (x1 - x0 - gap*(n-1))/n
    cur = SCENES.index(sc)
    for i in range(n):
        bx = x0 + i*(sw+gap)
        rrect(d, (bx, 54, bx+sw, 61), 4, fill=(255, 255, 255, 60))
        f = 1 if i < cur else (clamp(lt/dur) if i == cur else 0)
        if f > 0: rrect(d, (bx, 54, bx+max(8, sw*f), 61), 4, fill=(*AMBER, 255))
    # başlıq
    a_in = ease(lt/0.45); a_out = 1 - ease((lt - (dur-0.3))/0.3)
    if sc is SCENES[0]: a_in = 1 if t > 0.05 else ease(t/0.05)
    a = a_in*a_out
    dy = (1-eout(lt/0.5))*30
    A = int(255*a)
    # kicker: kiçik nöqtə + mətn
    d.ellipse((60, 117, 76, 133), fill=(*AMBER, A))
    d.text((92, 125), sc["kicker"], font=F_KICK, fill=(*AMBER, A), anchor="lm")
    y = 160 + dy
    for i, line in enumerate(sc["title"]):
        la = ease((lt - i*0.12)/0.45)*a_out if sc is not SCENES[0] else a
        col = WHITE if i == 0 else AMBER
        fs = F_TITLE
        while d.textlength(line, font=fs) > 960: fs = font("InterDisplay-Black.otf", fs.size-4)
        d.text((56, y + i*100 + (1-eout((lt-i*0.12)/0.5))*24), line, font=fs, fill=(*col, int(255*la)), anchor="la",
               stroke_width=2, stroke_fill=(6, 12, 20, int(120*la)))
    # subtitr
    for ch in sc["chunks"]:
        if ch["t0"] - 0.05 <= t < ch["t1"]:
            words = ch["words"]
            parts = []
            for (wt, w) in words:
                hl = w.startswith("*") or w.endswith("*") or w.endswith("*:") or w.endswith("*.") or w.endswith("*?") or w.endswith("*,")
                parts.append((wt, w.replace("*", ""), hl))
            # bir sətirə sığdır, lazım olsa iki sətir
            space = d.textlength(" ", font=F_SUB)
            lines, curl, cw = [], [], 0
            for p in parts:
                ww = d.textlength(p[1], font=F_SUB) + (28 if p[2] else 0)
                if curl and cw + space + ww > 940: lines.append(curl); curl, cw = [], 0
                curl.append((p, ww)); cw += (space if len(curl) > 1 else 0) + ww
            lines.append(curl)
            base_y = 1620 - (len(lines)-1)*40
            for li, ln in enumerate(lines):
                tw = sum(w for _, w in ln) + space*(len(ln)-1)
                x = 540 - tw/2; yy = base_y + li*82
                for (wt, wd, hl), ww in ln:
                    k = clamp((t - wt)/0.16)
                    if k <= 0: x += ww + space; continue
                    pop = back(k)
                    oy = (1-pop)*18
                    active = wt <= t
                    col = AMBER if hl else WHITE
                    if hl:
                        rrect(d, (x, yy-50+oy, x+ww, yy+18+oy), 20, fill=(*AMBER, int(255*k)))
                        d.text((x+14, yy+oy), wd, font=F_SUB, fill=(12, 18, 26, int(255*k)), anchor="ls")
                    else:
                        d.text((x, yy+oy), wd, font=F_SUB, fill=(*col, int(255*k)), anchor="ls",
                               stroke_width=5, stroke_fill=(6, 10, 16, int(230*k)))
                    x += ww + space
            break
    # mənbə
    d.text((540, 1872), "Məlumat: Britannica · Xəritə: Natural Earth, Mapzen Terrain Tiles",
           font=F_CRED, fill=(150, 158, 168, 200), anchor="mm")

def scene_at(t):
    for sc in SCENES:
        if sc["t0"] <= t < sc["t1"]: return sc
    return SCENES[-1]

def frame(i):
    t = i / FPS
    sc = scene_at(t)
    u = clamp((t - sc["t0"]) / (sc["t1"] - sc["t0"]))
    lon, lat, s = cam_at(sc, u)
    m, cam = render_map(lon, lat, s)
    # yüngül rəng tonu: soyuq kölgələr, isti işıqlar
    img = m.convert("RGBA")
    img.alpha_composite(overlay_vectors(t, sc, u, cam))
    img.alpha_composite(GRAD)
    img = img.convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")
    scene_labels(img, d, t, sc, u, cam)
    draw_text_layer(img, t, sc)
    # giriş solması
    if t < 0.25:
        img = Image.blend(Image.new("RGB", img.size, (0, 0, 0)), img, t/0.25)
    return img.convert("RGB").tobytes()

def winit():
    global GRAD, PROFILE
    init(); GRAD = gradients(); PROFILE = depth_profile(50.6, 46.9, 37.0)

if __name__ == "__main__":
    out = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"duration {DUR:.2f}s frames {NF}")
    for sc in SCENES: print(sc["id"], round(sc["t0"], 2), round(sc["t1"], 2))
    if only:  # test kadrları
        winit()
        for ts in only.split(","):
            i = int(float(ts)*FPS)
            Image.frombytes("RGB", (W, H), frame(i)).save(f"{out}_{ts}.jpg", quality=88)
        sys.exit()
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "17",
                           "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    with Pool(4, initializer=winit) as pool:
        for k, b in enumerate(pool.imap(frame, range(NF), chunksize=4)):
            ff.stdin.write(b)
            if k % 150 == 0: print(k, flush=True)
    ff.stdin.close(); ff.wait()
    json.dump([dict(id=s["id"], t0=s["t0"], t1=s["t1"]) for s in SCENES], open(out + ".scenes.json", "w"))
