# Xəzər: dəniz, yoxsa göl? — v2: dublaj (Speko · Adrian) ilə sinxron xəritə-animasiya
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from multiprocessing import Pool

HERE = os.environ.get("XEZER_WORK", os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from geo import proj
from words import W as VOW, DUR as VODUR

W, H, FPS = 1080, 1920, 30
SS = 2
TEMPO = 1.07          # dublaj sürəti (ffmpeg atempo)
LEAD = 0.25           # səhnə başlayandan səsə qədər
PAD = 0.35            # səs bitəndən səhnə sonuna qədər
LIME = (196, 242, 92)
TEAL = (98, 228, 214)
WHITE = (247, 247, 242)
MUTED = (168, 182, 176)
CORAL = (255, 108, 96)
INK = (6, 14, 14)
FD = "/usr/share/fonts/opentype/inter/"
_fc = {}
def font(name, size):
    k = (name, size)
    if k not in _fc: _fc[k] = ImageFont.truetype(FD + name, size)
    return _fc[k]

F_TITLE = font("InterDisplay-Black.otf", 86)
F_KICK = font("Inter-ExtraBold.otf", 28)
F_DECK = font("Inter-Bold.otf", 34)
F_SUB = font("Inter-ExtraBold.otf", 58)
F_LAB = font("Inter-Bold.otf", 34)
F_LABS = font("Inter-SemiBold.otf", 28)
F_CARDBIG = font("InterDisplay-Black.otf", 100)
F_CARD = font("Inter-SemiBold.otf", 32)
F_CRED = font("Inter-Medium.otf", 21)

# ---------------------------------------------------------------- data
VEC = json.load(open(os.path.join(HERE, "vec.json")))
CASPIAN = [proj(*p[:2]) for p in VEC["caspian"]]
def chain(segs, start):
    path = [start]; segs = [list(map(tuple, s)) for s in segs]
    def close(a, b): return abs(a[0]-b[0]) < 1e-3 and abs(a[1]-b[1]) < 1e-3
    while True:
        cur = path[-1]; found = False
        for s in segs:
            if close(s[0], cur): path += s[1:]; segs.remove(s); found = True; break
            if close(s[-1], cur): path += s[::-1][1:]; segs.remove(s); found = True; break
        if not found: break
    return path
volga_segs = [s for s in VEC["Volga"] if min(p[1] for p in s) < 52.2 and len(s) != 85]
VOLGA = [proj(*p) for p in chain(volga_segs, (47.768972, 52.074042))]
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

def clamp(v, a=0.0, b=1.0): return max(a, min(b, v))
def ease(t): t = clamp(t); return t*t*(3-2*t)
def eio(t): t = clamp(t); return 4*t*t*t if t < .5 else 1-(-2*t+2)**3/2
def eout(t): t = clamp(t); return 1-(1-t)**3
def back(t):
    t = clamp(t); c1 = 1.70158; c3 = c1+1
    return 1 + c3*(t-1)**3 + c1*(t-1)**2

# ---------------------------------------------------------------- script
SCENES = [
    dict(id="hook", kicker="COĞRAFİ FAKT", title=["XƏZƏR", "DƏNİZDİR, YOXSA GÖL?"], deck="",
         cam=[(0, 50.6, 41.4, 2.35), (1, 50.9, 41.7, 1.9)]),
    dict(id="closed", kicker="QAPALI HÖVZƏ", title=["OKEANA", "ÇIXIŞ YOXDUR"], deck="Dörd tərəfdən quru",
         cam=[(0, 50.9, 41.7, 1.9), (0.3, 47.5, 42.6, 2.75), (1, 47.7, 42.6, 2.9)]),
    dict(id="size", kicker="ÖLÇÜ", title=["NƏHƏNG", "SU HÖVZƏSİ"], deck="Şimaldan cənuba ≈1200 km",
         cam=[(0, 47.7, 42.6, 2.9), (0.25, 50.6, 41.5, 1.95), (1, 50.6, 41.6, 1.88)]),
    dict(id="level", kicker="SƏVİYYƏ", title=["OKEANDAN", "AŞAĞIDA"], deck="Səth ≈ −27 m",
         cam=[(0, 50.6, 41.6, 1.88), (1, 50.3, 41.0, 1.72)]),
    dict(id="depth", kicker="DƏRİNLİK", title=["ŞİMAL DAYAZ,", "CƏNUB DƏRİN"], deck="4–8 m  →  1025 m",
         cam=[(0, 50.3, 41.0, 1.72), (0.12, 50.0, 45.4, 1.25), (0.5, 50.0, 45.3, 1.2),
              (0.66, 50.9, 38.6, 1.25), (1, 50.9, 38.7, 1.2)]),
    dict(id="salt", kicker="DUZLULUQ", title=["NƏ ŞİRİN,", "NƏ OKEAN"], deck="Okeandan ≈3 dəfə az duzlu",
         cam=[(0, 50.9, 38.7, 1.2), (0.18, 50.4, 43.6, 2.3), (1, 50.6, 43.4, 2.2)]),
    dict(id="states", kicker="SAHİLYANI ÖLKƏLƏR", title=["BEŞ ÖLKƏ,", "BİR HÖVZƏ"], deck="2018 · Aktau konvensiyası",
         cam=[(0, 50.6, 43.4, 2.2), (0.2, 51.0, 41.0, 2.15), (1, 51.0, 41.1, 2.08)]),
    dict(id="answer", kicker="BƏS CAVAB?", title=["ADI DƏNİZ,", "ÖZÜ GÖL"], deck="",
         cam=[(0, 51.0, 41.1, 2.08), (1, 50.8, 41.6, 2.4)], tail=1.6),
]

def parse_words(lst, t0):
    out = []; on = False
    for txt, ms in lst:
        st = txt.startswith("*"); en = txt.rstrip(".,:?!").endswith("*") or txt.endswith("*")
        hl = on or st
        if st: on = True
        if txt.endswith("*") or en: on = False
        out.append((t0 + ms/1000/TEMPO, txt.replace("*", ""), hl))
    return out

T = 0.0; VOICE_STARTS = []
for i, sc in enumerate(SCENES):
    sc["t0"] = T
    vs = T + (0.15 if i == 0 else LEAD)
    VOICE_STARTS.append(vs)
    sc["vs"] = vs
    ws = parse_words(VOW[i+1], vs)
    sc["words"] = ws
    vend = vs + VODUR[i+1]/TEMPO
    # 2-4 sözlük hissələr, durğu işarəsində kəs
    chunks, cur = [], []
    for w in ws:
        cur.append(w)
        if len(cur) >= 4 or (len(cur) >= 1 and len(" ".join(x[1] for x in cur)) > 9 and w[1][-1] in ".,:?!") or len(" ".join(x[1] for x in cur)) > 24:
            chunks.append(cur); cur = []
    if cur:
        if chunks and len(cur) == 1 and len(" ".join(x[1] for x in chunks[-1] + cur)) <= 28: chunks[-1] += cur
        else: chunks.append(cur)
    sc["chunks"] = []
    for k, c in enumerate(chunks):
        t1 = chunks[k+1][0][0] if k+1 < len(chunks) else vend + 0.15
        sc["chunks"].append(dict(t0=c[0][0], t1=t1, words=c))
    sc["vend"] = vend
    T = vend + PAD + sc.get("tail", 0)
    sc["t1"] = T
DUR = T
NF = int(math.ceil(DUR * FPS))

def wt(sc, key, k=0):
    """sözün səhnə daxili vaxtı (lt)"""
    n = 0
    for t, w, _ in sc["words"]:
        if key in w:
            if n == k: return t - sc["t0"]
            n += 1
    raise KeyError(key)

def cam_at(sc, u):
    ks = sc["cam"]
    if u <= ks[0][0]: return ks[0][1:]
    for a, b in zip(ks, ks[1:]):
        if u <= b[0]:
            f = eio((u - a[0]) / (b[0] - a[0]))
            return (a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f,
                    math.exp(math.log(a[3]) + (math.log(b[3])-math.log(a[3]))*f))
    return ks[-1][1:]

BASE = None; GRAD = None; PROFILE = None
def winit():
    global BASE, GRAD, PROFILE
    BASE = Image.open(os.path.join(HERE, "base2.png")).convert("RGB")
    GRAD = gradients(); PROFILE = depth_profile(50.6, 46.9, 37.0)

def render_map(lon, lat, s, t):
    # yüngül "nəfəs alan" zoom (statik qalmasın)
    s = s * (1 - 0.012*math.sin(t*0.9))
    cx, cy = proj(lon, lat)
    a = (s, 0, cx - s*W/2, 0, s, cy - s*H/2)
    return BASE.transform((W, H), Image.AFFINE, a, resample=Image.BILINEAR), (cx, cy, s)

def P(cam, pt, k=SS):
    cx, cy, s = cam
    return ((pt[0]-cx)/s*k + W*k/2, (pt[1]-cy)/s*k + H*k/2)
def partial(path, f):
    if f >= 1: return path
    return path[:max(2, int(len(path)*f))]
def rrect(d, box, r, **kw): d.rounded_rectangle(box, r, **kw)

def gradients():
    g = np.zeros((H, W, 4), np.uint8)
    y = np.arange(H)[:, None]
    top = np.clip(1 - y/600, 0, 1)**1.5 * 230
    bot = np.clip((y - 1250)/560, 0, 1)**1.3 * 235
    g[..., :3] = (4, 12, 12); g[..., 3] = np.maximum(top, bot).astype(np.uint8).repeat(W, 1)
    xx = (np.arange(W)[None, :] - W/2)/(W/2); yy = (np.arange(H)[:, None]-H/2)/(H/2)
    v = np.clip((xx**2*0.7 + yy**2*0.25) - 0.22, 0, 1) * 150
    g[..., 3] = np.maximum(g[..., 3], v.astype(np.uint8))
    return Image.fromarray(g, "RGBA")

def label(d, xy, txt, f=F_LAB, col=WHITE, alpha=1.0, anchor="lm", dot=None):
    if alpha <= 0: return
    x, y = xy; a = int(255*alpha)
    if dot:
        r = 8
        d.ellipse((x-r-5, y-r-5, x+r+5, y+r+5), fill=(*dot, int(60*alpha)))
        d.ellipse((x-r, y-r, x+r, y+r), fill=(*WHITE, a), outline=(*INK, a), width=3)
        x += 20
    d.text((x, y), txt, font=f, fill=(*col, a), anchor=anchor, stroke_width=4, stroke_fill=(*INK, int(210*alpha)))

def card(d, box, alpha=1.0, r=26):
    if alpha > 0:
        rrect(d, box, r, fill=(6, 16, 18, int(220*alpha)), outline=(255, 255, 255, int(28*alpha)), width=2)

# ---------------------------------------------------------------- vector layer
def stroke(d, pts, col, w, alpha):
    if len(pts) > 1: d.line(pts, fill=(*col, int(255*alpha)), width=w, joint="curve")

def overlay_vectors(t, sc, cam):
    lay = Image.new("RGBA", (W*SS, H*SS), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    glow = Image.new("RGBA", (W*SS, H*SS), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
    sid = sc["id"]; lt = t - sc["t0"]
    bord = 0.2
    if sid == "states": bord = 0.2 + 0.4*ease((lt-0.6)/1.0)
    for rings in COUNTRIES.values():
        for r in rings:
            d.line([P(cam, p) for p in r], fill=(225, 235, 228, int(255*bord*0.5)), width=2)
    f = eout(lt/2.4) if sid == "hook" else 1
    cas = [P(cam, p) for p in partial(CASPIAN, f)]
    ca = 0.6 if sid == "depth" else 1.0
    stroke(g, cas, TEAL, 16, 0.5*ca); stroke(d, cas, TEAL, 5, 0.95*ca)
    riv = 0.4; vf = 1.0
    if sid == "salt":
        riv = 1; vf = eout((lt - (wt(sc, "Volqanın") - 0.4))/1.6)
    if sid == "hook": riv = 0.4*ease((lt-1.5)/1.5)
    for path, ff in ((VOLGA, vf), (URAL, 1), (KURA, 1)):
        pts = [P(cam, p) for p in partial(path, ff)]
        stroke(g, pts, TEAL, 12, 0.35*riv); stroke(d, pts, (150, 240, 232), 4, 0.95*riv)
    if sid == "closed":
        a, b = P(cam, proj(48.6, 42.9)), P(cam, proj(41.2, 43.4))
        fr = eout((lt - 0.4)/1.4); n = 26
        def arc(s): return (a[0]+(b[0]-a[0])*s, a[1]+(b[1]-a[1])*s - math.sin(s*math.pi)*160)
        for i in range(0, n, 2):
            s0, s1 = i/n, min((i+1)/n, fr)
            if s0 > fr: break
            d.line([arc(s0), arc(s1)], fill=(*WHITE, 230), width=6)
        tx = wt(sc, "yoxdur")
        xs = ease((lt-tx)/0.3)
        if xs > 0:
            m = arc(0.5); r = 52*back((lt-tx)/0.4)
            d.ellipse((m[0]-r, m[1]-r, m[0]+r, m[1]+r), fill=(*CORAL, int(255*xs)))
            q = r*0.42
            d.line([(m[0]-q, m[1]-q), (m[0]+q, m[1]+q)], fill=(255, 255, 255, int(255*xs)), width=12)
            d.line([(m[0]-q, m[1]+q), (m[0]+q, m[1]-q)], fill=(255, 255, 255, int(255*xs)), width=12)
    if sid == "size":
        t0 = wt(sc, "Şimaldan")
        f = eout((lt-t0)/1.4)
        a, b = P(cam, proj(55.6, 47.05)), P(cam, proj(55.6, 36.6))
        if f > 0:
            e = (a[0], a[1]+(b[1]-a[1])*f)
            d.line([a, e], fill=(*LIME, 245), width=5)
            for y in (a[1], e[1]): d.line([(a[0]-22, y), (a[0]+22, y)], fill=(*LIME, 245), width=5)
    out = Image.new("RGBA", (W*SS, H*SS), (0, 0, 0, 0))
    out.alpha_composite(glow.filter(ImageFilter.GaussianBlur(12)))
    out.alpha_composite(lay)
    return out.resize((W, H), Image.LANCZOS)

# ---------------------------------------------------------------- scene graphics
def scene_labels(d, t, sc, cam):
    sid = sc["id"]; lt = t - sc["t0"]; dur = sc["t1"] - sc["t0"]
    oa = 1 - ease((lt - (dur - 0.3))/0.3)
    def L(lon, lat, txt, t_in, **kw):
        x, y = P(cam, proj(lon, lat), 1)
        label(d, (x, y), txt, alpha=ease((lt - t_in)/0.35)*oa, **kw)
    if sid == "hook":
        L(49.87, 40.41, "Bakı", 1.4, dot=LIME)
        L(50.3, 43.2, "XƏZƏR", 1.9, col=TEAL, anchor="mm")
    if sid == "closed":
        x, y = P(cam, proj(36.6, 43.0), 1)
        label(d, (max(70, x), y), "QARA DƏNİZ", col=TEAL, alpha=ease((lt-0.6)/0.35)*oa)
        L(51.0, 41.8, "XƏZƏR", 0.6, col=TEAL, anchor="mm")
    if sid == "size":
        tn = wt(sc, "386") - 0.15
        a = ease((lt-tn)/0.3)*oa
        if a > 0:
            card(d, (70, 1040, 610, 1250), a)
            val = int(386400*eout((lt-tn)/1.3))
            d.text((104, 1118), f"{val:,}".replace(",", " "), font=F_CARDBIG, fill=(*WHITE, int(255*a)), anchor="lm")
            d.text((108, 1200), "km²  ·  təxminən", font=F_CARD, fill=(*LIME, int(255*a)), anchor="lm")
        tj = wt(sc, "Yaponiyadan") - 0.1
        a2 = ease((lt-tj)/0.3)*oa
        if a2 > 0:
            card(d, (70, 1264, 610, 1336), a2, r=22)
            d.text((104, 1300), "Yaponiyadan böyük", font=F_CARD, fill=(*WHITE, int(255*a2)), anchor="lm")
        a3 = ease((lt - wt(sc, "1200"))/0.3)*oa
        if a3 > 0:
            x, y = P(cam, proj(55.6, 41.8), 1)
            label(d, (x-22, y), "≈1200 km", col=LIME, alpha=a3, anchor="rm")
    if sid == "level":
        a = ease((lt - wt(sc, "Xəzərin") + 0.2)/0.35)*oa
        if a > 0:
            card(d, (70, 1010, 1010, 1380), a); A = int(255*a)
            y0, y1 = 1095, 1255
            d.text((110, 1050), "Okean səviyyəsi", font=F_CARD, fill=(*TEAL, A), anchor="lm")
            for x in range(110, 970, 26): d.line([(x, y0), (x+14, y0)], fill=(*TEAL, A), width=4)
            d.text((970, 1050), "0 m", font=F_LAB, fill=(*TEAL, A), anchor="rm")
            f = eout((lt - wt(sc, "səviyyəsindən"))/(wt(sc, "aşağıdadır") - wt(sc, "səviyyəsindən") + 0.3))
            yy = y0 + (y1-y0)*f
            d.rectangle((110, yy, 970, yy+5), fill=(*LIME, A))
            d.line([(540, y0+10), (540, yy-14)], fill=(*WHITE, A), width=4)
            if f > 0.15: d.polygon([(528, yy-26), (552, yy-26), (540, yy-10)], fill=(*WHITE, A))
            d.text((970, yy+32), f"≈ {-27*f:.0f} m".replace("-", "−"), font=F_LAB, fill=(*LIME, A), anchor="rm")
            d.text((110, yy+32), "Xəzərin səthi", font=F_CARD, fill=(*LIME, A), anchor="lm")
            # qalxıb-enir: kiçik dalğalanma oxları
            tq = wt(sc, "qalxıb")
            k = ease((lt-tq)/0.3)
            if k > 0:
                d.text((540, 1342), "↕  səviyyə dəyişkəndir", font=F_CARD, fill=(*WHITE, int(255*a*k)), anchor="mm")
    if sid == "depth":
        tn = wt(sc, "Şimal") + 0.4; ts = wt(sc, "Cənubda")
        a = ease((lt-tn)/0.35)*(1-ease((lt-ts+0.2)/0.3))
        if a > 0:
            x, y = P(cam, proj(50.0, 45.6), 1)
            card(d, (x-230, y-70, x+230, y+70), a)
            d.text((x, y-22), "Orta dərinlik", font=F_CARD, fill=(*MUTED, int(255*a)), anchor="mm")
            d.text((x, y+24), "4–8 m", font=F_LAB, fill=(*TEAL, int(255*a)), anchor="mm")
        a = ease((lt - wt(sc, "1025"))/0.3)*oa
        if a > 0:
            x, y = P(cam, proj(51.3, 37.9), 1)
            label(d, (x, y), "1025 m", col=LIME, alpha=a, dot=LIME)
        a = ease((lt-0.4)/0.35)*oa
        if a > 0:
            card(d, (70, 1220, 1010, 1440), a); A = int(255*a)
            x0, x1, yt, yb = 110, 970, 1278, 1415
            d.text((110, 1250), "Şimal", font=F_LABS, fill=(*MUTED, A), anchor="lm")
            d.text((970, 1250), "Cənub", font=F_LABS, fill=(*MUTED, A), anchor="rm")
            reveal = eout((lt-0.6)/(sc["vend"]-sc["t0"]-0.6))
            n = len(PROFILE); m = max(2, int(n*reveal))
            pts = [(x0+(x1-x0)*i/(n-1), yt+(yb-yt)*min(PROFILE[i], 1100)/1100) for i in range(m)]
            d.polygon([(x0, yt)] + pts + [(pts[-1][0], yt)], fill=(30, 120, 120, int(170*a)))
            d.line(pts, fill=(*TEAL, A), width=4)
            d.line([(x0, yt), (x1, yt)], fill=(*WHITE, int(110*a)), width=2)
            d.text((x0+8, yb-4), "1000 m", font=F_CRED, fill=(*MUTED, A), anchor="lb")
    if sid == "salt":
        a = ease((lt-0.3)/0.35)*oa
        if a > 0:
            card(d, (70, 1215, 1010, 1440), a); A = int(255*a)
            f = eout((lt - wt(sc, "üç"))/1.0)
            for i, (nm, v, col, s) in enumerate((("Xəzər", 12.8, LIME, "≈12,8‰"), ("Okean", 35.0, TEAL, "≈35‰"))):
                y = 1270 + i*85
                d.text((110, y), nm, font=F_CARD, fill=(*WHITE, A), anchor="lm")
                bx0, bx1 = 280, 820
                rrect(d, (bx0, y-15, bx1, y+15), 15, fill=(255, 255, 255, int(22*a)))
                w = (bx1-bx0)*v/35*f
                if w > 30: rrect(d, (bx0, y-15, bx0+w, y+15), 15, fill=(*col, A))
                d.text((970, y), s, font=F_LAB, fill=(*col, A), anchor="rm")
            d.text((110, 1415), "orta duzluluq, ‰ (promil)", font=F_CRED, fill=(*MUTED, A), anchor="lm")
        L(47.9, 46.25, "Volqa  ≈1‰", wt(sc, "şirindir") - 0.6, dot=TEAL, col=TEAL)
        tq = wt(sc, "Qarabağazgöldə") - 0.1
        a = ease((lt-tq)/0.35)*oa
        if a > 0:
            x, y = P(cam, proj(53.6, 41.25), 1)
            label(d, (x, y), "Qarabağazgöl", col=LIME, alpha=a, dot=LIME)
            d.text((x+20, y-44), "200‰-ə qədər", font=F_LABS, fill=(*LIME, int(255*a)), anchor="lm",
                   stroke_width=4, stroke_fill=(*INK, int(210*a)))
    if sid == "states":
        names = [("Azərbaycan", 47.2, 40.35), ("Rusiya", 46.8, 44.9), ("Qazaxıstan", 53.0, 46.4),
                 ("Türkmənistan", 54.6, 39.6), ("İran", 55.5, 36.95)]
        for nm, lo, la in names:
            ti = wt(sc, nm[:4])
            a = ease((lt-ti)/0.25)*oa
            if a > 0:
                x, y = P(cam, proj(lo, la), 1)
                k = back((lt-ti)/0.35)
                d.text((x, y), nm, font=font("Inter-ExtraBold.otf", max(8, int(40*k))), fill=(*WHITE, int(255*a)),
                       anchor="mm", stroke_width=5, stroke_fill=(*INK, int(215*a)))
        L(51.17, 43.65, "Aktau", wt(sc, "Aktauda") - 0.15, dot=LIME, col=LIME)
        a = ease((lt - wt(sc, "2018") + 0.1)/0.35)*oa
        if a > 0:
            card(d, (70, 1300, 800, 1440), a)
            d.text((110, 1342), "2018 · Aktau", font=F_LAB, fill=(*LIME, int(255*a)), anchor="lm")
            d.text((110, 1396), "Xəzərin hüquqi statusu haqqında konvensiya", font=F_CARD, fill=(*WHITE, int(255*a)), anchor="lm")
    if sid == "answer":
        tc = wt(sc, "Bəs") - 0.1
        a = ease((lt-tc)/0.45)
        if a > 0:
            d.rectangle((0, 0, W, H), fill=(3, 10, 10, int(175*a))); A = int(255*a)
            d.text((540, 760), "Sənin cavabın?", font=font("InterDisplay-Black.otf", 90), fill=(*WHITE, A), anchor="mm")
            for i, (txt, col, key) in enumerate((("DƏNİZ", TEAL, "Dəniz"), ("GÖL", LIME, "göl"))):
                tk = wt(sc, key, 1 if key == "göl" else 0) - 0.05
                k = back((lt-tk)/0.4)
                cx, cy = 320 + i*440, 940
                if k > 0.05:
                    w, h = 175*k, 66*k
                    rrect(d, (cx-w, cy-h, cx+w, cy+h), int(h), fill=(*col, A))
                    d.text((cx, cy), txt, font=font("InterDisplay-Black.otf", max(8, int(64*k))), fill=(*INK, A), anchor="mm")
            ks = ease((lt - wt(sc, "Cavabını"))/0.35)
            if ks > 0:
                rrect(d, (290, 1060, 790, 1150), 45, outline=(*WHITE, int(200*ks)), width=3)
                d.text((540, 1105), "Şərhdə yaz", font=font("Inter-ExtraBold.otf", 46), fill=(*WHITE, int(255*ks)), anchor="mm")

def text_layer(d, t, sc):
    lt = t - sc["t0"]; dur = sc["t1"] - sc["t0"]
    n = len(SCENES); gap = 10; x0, x1 = 48, 1032
    sw = (x1 - x0 - gap*(n-1))/n; cur = SCENES.index(sc)
    for i in range(n):
        bx = x0 + i*(sw+gap)
        rrect(d, (bx, 50, bx+sw, 56), 3, fill=(255, 255, 255, 55))
        f = 1 if i < cur else (clamp(lt/dur) if i == cur else 0)
        if f > 0: rrect(d, (bx, 50, bx+max(6, sw*f), 56), 3, fill=(*LIME, 255))
    a_out = 1 - ease((lt - (dur-0.25))/0.25)
    first = sc is SCENES[0]
    ka = (1 if first else ease(lt/0.35))*a_out
    d.text((56, 112), sc["kicker"], font=F_KICK, fill=(*LIME, int(255*ka)), anchor="lm")
    y = 150
    for i, line in enumerate(sc["title"]):
        la = (1 if first else ease((lt - i*0.1)/0.4))*a_out
        oy = 0 if first else (1-eout((lt-i*0.1)/0.45))*26
        fs = F_TITLE
        while d.textlength(line, font=fs) > 970: fs = font("InterDisplay-Black.otf", fs.size-4)
        d.text((52, y + i*92 + oy), line, font=fs, fill=(*(WHITE if i == 0 else LIME), int(255*la)), anchor="la",
               stroke_width=2, stroke_fill=(*INK, int(140*la)))
    if sc["deck"]:
        da = ease((lt-0.35)/0.4)*a_out
        d.text((56, 378), sc["deck"], font=F_DECK, fill=(*LIME, int(235*da)), anchor="lm",
               stroke_width=3, stroke_fill=(*INK, int(160*da)))
    # subtitr: söz söylənəndə görünür
    for ch in sc["chunks"]:
        if ch["t0"] - 0.03 <= t < ch["t1"]:
            sp = d.textlength(" ", font=F_SUB)
            items = [(wt_, w, hl, d.textlength(w, font=F_SUB)) for wt_, w, hl in ch["words"]]
            lines, curl, cw = [], [], 0
            for it in items:
                if curl and cw + sp + it[3] > 960: lines.append(curl); curl, cw = [], 0
                cw += (sp if curl else 0) + it[3]; curl.append(it)
            lines.append(curl)
            by = 1560 - (len(lines)-1)*38
            for li, ln in enumerate(lines):
                tw = sum(i[3] for i in ln) + sp*(len(ln)-1)
                x = 540 - tw/2; yy = by + li*78
                for wt_, w, hl, ww in ln:
                    k = clamp((t - wt_ + 0.04)/0.12)
                    if k > 0:
                        oy = (1-back(k))*14
                        d.text((x, yy+oy), w, font=F_SUB, fill=(*(LIME if hl else WHITE), int(255*k)), anchor="ls",
                               stroke_width=6, stroke_fill=(*INK, int(235*k)))
                    x += ww + sp
            break
    d.text((540, 1876), "Mənbə: Britannica · Xəritə: Natural Earth, Mapzen Terrain Tiles · Səs: AI",
           font=F_CRED, fill=(150, 165, 160, 190), anchor="mm")

def scene_at(t):
    for sc in SCENES:
        if sc["t0"] <= t < sc["t1"]: return sc
    return SCENES[-1]

def frame(i):
    t = i / FPS
    sc = scene_at(t)
    u = clamp((t - sc["t0"]) / (sc["t1"] - sc["t0"]))
    lon, lat, s = cam_at(sc, u)
    m, cam = render_map(lon, lat, s, t)
    img = m.convert("RGBA")
    img.alpha_composite(overlay_vectors(t, sc, cam))
    img.alpha_composite(GRAD)
    # səhnə keçidi: qısa ağ-yaşıl "flash" yox, yumşaq qaralma
    img = img.convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")
    scene_labels(d, t, sc, cam)
    text_layer(d, t, sc)
    lt = t - sc["t0"]
    if sc is not SCENES[0] and lt < 0.18:
        d.rectangle((0, 0, W, H), fill=(0, 0, 0, int(90*(1-lt/0.18))))
    if t < 0.2: img = Image.blend(Image.new("RGB", img.size), img, t/0.2)
    return img.tobytes()

if __name__ == "__main__":
    out = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"duration {DUR:.2f}s frames {NF}")
    for sc in SCENES: print(sc["id"], round(sc["t0"], 2), round(sc["vs"], 2), round(sc["t1"], 2))
    json.dump(dict(scenes=[dict(id=s["id"], t0=s["t0"], t1=s["t1"], vs=s["vs"]) for s in SCENES], dur=DUR,
                   tempo=TEMPO), open(out + ".timeline.json", "w"))
    if only:
        winit()
        for ts in only.split(","):
            Image.frombytes("RGB", (W, H), frame(int(float(ts)*FPS))).save(f"{out}_{ts}.jpg", quality=88)
        sys.exit()
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                           "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    with Pool(4, initializer=winit) as pool:
        for k, b in enumerate(pool.imap(frame, range(NF), chunksize=4)):
            ff.stdin.write(b)
            if k % 300 == 0: print(k, flush=True)
    ff.stdin.close(); ff.wait()
