# Şamaxı zəlzələsi 1902 — TikTok (1080x1920, 30 fps), Speko "Adrian"
import sys, os, json, math, random, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, ImageEnhance
from multiprocessing import Pool

HERE = os.environ.get("SZ_WORK", os.path.dirname(os.path.abspath(__file__)))
RG = os.environ.get("RG_WORK", os.path.join(HERE, "..", "rg"))
AL = {a["key"]: a for a in json.load(open(os.path.join(HERE, "align.json")))}
W, H, FPS = 1080, 1920, 30
TEMPO = 1.06
RED = (230, 52, 42); WHITE = (248, 244, 236); YEL = (255, 206, 84); INK = (8, 6, 4); SEP = (214, 182, 132); DIM = (170, 160, 145)
FI = "/usr/share/fonts/opentype/inter/"; FS = "/usr/share/fonts/truetype/dejavu/"
_fc = {}
def font(n, s):
    if (n, s) not in _fc:
        p = (FS + n) if n.startswith("DejaVu") else ("/usr/share/fonts/truetype/noto/" + n) if n.startswith("Noto") else (FI + n)
        _fc[(n, s)] = ImageFont.truetype(p, s)
    return _fc[(n, s)]
def clamp(v, a=0.0, b=1.0): return max(a, min(b, v))
def ease(t): t = clamp(t); return t*t*(3-2*t)
def eio(t): t = clamp(t); return 4*t*t*t if t < .5 else 1-(-2*t+2)**3/2
def eout(t): t = clamp(t); return 1-(1-t)**3
def back(t):
    t = clamp(t); c1 = 1.70158; c3 = c1+1
    return 1 + c3*(t-1)**3 + c1*(t-1)**2

ORDER = ["hook", "power", "toll", "mosque", "history", "baku", "help", "today", "cta"]
SC = []; T = 0.0
for i, k in enumerate(ORDER):
    a = AL[k]; vs = T + (0.5 if i == 0 else 0.3)
    words = [(vs + t/TEMPO, w) for w, t in a["words"]]
    vend = vs + a["end"]/TEMPO
    SC.append(dict(key=k, t0=T, vs=vs, vend=vend, t1=vend + (2.2 if k == "cta" else 0.4), words=words))
    T = SC[-1]["t1"]
DUR = T; NF = int(math.ceil(DUR*FPS))
def wt(s, key, k=0):
    n = 0
    for t, w in s["words"]:
        if key.lower() in w.lower():
            if n == k: return t - s["t0"]
            n += 1
    return None
for s in SC:
    ch, cur = [], []
    for t, w in s["words"]:
        cur.append((t, w)); tx = " ".join(x[1] for x in cur)
        if len(cur) >= 3 or w[-1] in ".,?!:" or len(tx) > 17: ch.append(cur); cur = []
    if cur: ch.append(cur)
    s["caps"] = [(c, (ch[j+1][0][0] if j+1 < len(ch) else s["vend"]+0.25)) for j, c in enumerate(ch)]

CRED = {"p1": "Foto: Julian Zelinsky, 1902 · ictimai mülkiyyət", "bazar": "Foto: Julian Zelinsky, 1902 · ictimai mülkiyyət",
        "p5": "Foto: Julian Zelinsky, 1902 · ictimai mülkiyyət", "mosque_e": "Foto: Julian Zelinsky, 1902 · ictimai mülkiyyət",
        "mosque": "Foto: Julian Zelinsky, 1902 · ictimai mülkiyyət", "committee": "Foto: Alexandre Michon, 1902 · ictimai mülkiyyət",
        "today": "Foto: Diego Delso, 2016 · CC BY-SA 4.0"}
PH = {}; GRAIN = []; VIG = None; MAP = None; META = None; EMO = {}
def winit():
    global VIG, MAP, META
    for n in CRED:
        p = os.path.join(HERE, "img", (n + "_bw.jpg") if n not in ("today",) else "today.jpg")
        im = Image.open(p).convert("RGB")
        if n != "today":
            g = ImageOps.autocontrast(ImageOps.grayscale(im), cutoff=1)
            im = ImageOps.colorize(g, (22, 14, 8), (242, 222, 186))
        PH[n] = im
    rng = np.random.default_rng(3)
    for _ in range(8):
        g = rng.normal(0, 1, (H//2, W//2)).astype(np.float32)
        GRAIN.append(Image.fromarray(np.clip(128 + g*22, 0, 255).astype(np.uint8)).resize((W, H)))
    y, x = np.mgrid[0:H, 0:W]
    v = np.clip(((x-W/2)/(W/2))**2*0.55 + ((y-H/2)/(H/2))**2*0.45 - 0.2, 0, 1)
    top = np.clip(1 - y/520, 0, 1)**1.6; bot = np.clip((y-1250)/670, 0, 1)**1.3
    a = np.zeros((H, W, 4), np.uint8); a[..., 3] = (np.maximum(v*0.9, np.maximum(top*0.8, bot*0.85))*235).astype(np.uint8)
    VIG = Image.fromarray(a, "RGBA")
    # xəritə (iqtisadi rayon rastrından): tünd ölkə, Şamaxı rayonu vurğulu
    rid = np.load(os.path.join(RG, "regid.npy")); land = np.load(os.path.join(RG, "land.npy")); META = json.load(open(os.path.join(RG, "meta.json")))
    img = np.zeros(rid.shape + (3,), np.uint8); img[:] = (14, 22, 34)
    img[land] = (40, 36, 32); img[rid > 0] = (78, 66, 52)
    e = np.zeros_like(rid, bool); e[:-1] |= rid[:-1] != rid[1:]; e[:, :-1] |= rid[:, :-1] != rid[:, 1:]
    img[e & (rid > 0)] = (52, 44, 36)
    MAP = Image.fromarray(img)
    globals()["META"] = META
    ef = font("NotoColorEmoji.ttf", 109)
    for k in ("👆", "💬"):
        im = Image.new("RGBA", (150, 150), (0, 0, 0, 0)); ImageDraw.Draw(im).text((4, 4), k, font=ef, embedded_color=True)
        EMO[k] = im.crop(im.getbbox())

def lonlat(lon, lat): return ((lon - META["lon0"])*META["C"]*META["K"], (META["lat1"] - lat)*META["K"])

def kb(name, u, z0=1.0, z1=1.12, px=0.0, box=(0, 0, W, H), blur=0, dark=1.0):
    im = PH[name]; bw, bh = box[2]-box[0], box[3]-box[1]
    z = z0 + (z1-z0)*eio(u)
    sc = min(im.width/bw, im.height/bh); cw, ch = bw*sc/z, bh*sc/z
    cx = im.width/2 + px*(im.width-cw)/2*(2*eio(u)-1); cy = im.height/2
    fr = im.transform((bw, bh), Image.EXTENT, (cx-cw/2, cy-ch/2, cx+cw/2, cy+ch/2), Image.BICUBIC)
    if blur: fr = fr.filter(ImageFilter.GaussianBlur(blur))
    if dark != 1.0: fr = ImageEnhance.Brightness(fr).enhance(dark)
    return fr

def card(d, box, a, border=RED):
    if a > 0: d.rounded_rectangle(box, 24, fill=(14, 10, 8, int(220*a)), outline=border + (int(230*a),), width=3)
def txt(d, xy, s, f, col, a=1.0, anchor="mm", stroke=6):
    if a > 0: d.text(xy, s, font=f, fill=col + (int(255*a),), anchor=anchor, stroke_width=stroke, stroke_fill=(0, 0, 0, int(255*a)))
def credit(d, n, a=1.0):
    if a > 0: d.text((W/2, 1395), CRED[n], font=font("Inter-Medium.otf", 20), fill=(220, 210, 190, int(170*a)), anchor="mm")
def emo(img, k, cx, cy, size, a=1.0):
    e = EMO[k]; sc = size/max(e.size); im = e.resize((max(1, int(e.width*sc)), max(1, int(e.height*sc))), Image.LANCZOS)
    if a < 1: im.putalpha(im.getchannel("A").point(lambda p: int(p*a)))
    img.paste(im, (int(cx-im.width/2), int(cy-im.height/2)), im)

def map_view(cx_ll, cy_ll, sc, box):
    bw, bh = box[2]-box[0], box[3]-box[1]
    cx, cy = lonlat(cx_ll, cy_ll)
    b = (cx - bw/2/sc, cy - bh/2/sc, cx + bw/2/sc, cy + bh/2/sc)
    return MAP.transform((bw, bh), Image.EXTENT, b, Image.BILINEAR, fillcolor=(14, 22, 34)), b

SHAM = (48.64, 40.63); EPI = (48.6, 40.7); BAKU = (49.87, 40.41)

def frame(i):
    t = i/FPS
    s = next((x for x in SC if x["t0"] <= t < x["t1"]), SC[-1])
    lt = t - s["t0"]; dur = s["t1"] - s["t0"]; k = s["key"]; u = clamp(lt/dur)
    oa = 1 - ease((lt-(dur-0.3))/0.3) if k != "cta" else 1.0
    img = Image.new("RGB", (W, H), (10, 8, 6))
    shake = 0.0
    # ---------------- fon
    if k == "hook":
        ts = wt(s, "saniyə") or 3.5
        shake = ease((lt-ts+0.4)/0.6) * (1 - ease((lt-dur+0.6)/0.6)) * 26
        a = ease((lt - 0.2)/1.2)
        bg = kb("p1", u, 1.25, 1.05, dark=0.35 + 0.65*ease((lt-ts)/1.0))
        img = Image.blend(img, bg, a)
    elif k == "toll": img = kb("bazar", u, 1.0, 1.18, px=0.6)
    elif k == "mosque": img = kb("mosque_e", u, 1.2, 1.0)
    elif k == "history": img = kb("p5", u, 1.05, 1.15, blur=10, dark=0.45)
    elif k == "help": img = kb("committee", u, 1.0, 1.12, px=-0.4)
    elif k == "today": img = kb("today", u, 1.05, 1.0, blur=14, dark=0.45)
    elif k == "cta": img = kb("mosque", u, 1.0, 1.1, blur=10, dark=0.4)
    if k in ("power", "baku"):
        box = (0, 0, W, H)
        if k == "power": cx, cy, sc = 48.9, 40.45, 0.55 + 0.25*eio(u)
        else:
            f = eio(lt/1.2); cx = 48.64 + (49.25-48.64)*f; cy = 40.5; sc = 0.62
        mv, b = map_view(cx, cy, sc, box); img = mv
    img = img.convert("RGBA"); img.alpha_composite(VIG); img = img.convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")
    def MP(ll):
        px, py = lonlat(*ll); return ((px - b[0])*sc, (py - b[1])*sc)
    # ---------------- səhnə qrafikası
    if k == "hook":
        # seysmoqram
        y0 = 820; x0 = 60; x1 = 1020
        prog = clamp((lt-0.3)/(dur-0.6))
        pts = []
        rng = random.Random(11)
        ts = wt(s, "saniyə") or 3.5
        for j in range(int(prog*240)+1):
            xx = x0 + (x1-x0)*j/240; tt = 0.3 + j/240*(dur-0.6)
            amp = 6 + 190*ease((tt-ts+0.3)/0.8)*(1 - 0.5*ease((tt-ts-2.0)/1.0))
            pts.append((xx, y0 + amp*math.sin(j*1.7 + rng.random()*2)*rng.random()))
        if len(pts) > 1:
            d.line(pts, fill=RED + (230,), width=4)
            d.ellipse((pts[-1][0]-9, pts[-1][1]-9, pts[-1][0]+9, pts[-1][1]+9), fill=(255, 255, 255, 255))
        a = ease((lt-wt(s, "on")+0.2)/0.3)
        txt(d, (W/2, 330), "13 FEVRAL 1902", font("InterDisplay-Black.otf", 104), WHITE, a)
        txt(d, (W/2, 440), "GÜNORTA", font("Inter-ExtraBold.otf", 46), YEL, ease((lt-wt(s, "günorta"))/0.3))
        tc = wt(s, "xarabalığa") or 5
        a2 = ease((lt-tc+0.1)/0.25); kk = back((lt-tc+0.1)/0.35)
        txt(d, (W/2, 1080), "ŞAMAXI", font("InterDisplay-Black.otf", max(10, int(150*kk))), RED, a2, stroke=8)
        txt(d, (W/2, 1210), "ZƏLZƏLƏSİ", font("InterDisplay-Black.otf", max(10, int(96*kk))), WHITE, a2, stroke=8)
        credit(d, "p1", ease((lt-ts)/1.0))
    if k == "power":
        x, y = MP(EPI)
        for r_i in range(4):
            ph = ((lt*0.9 + r_i/4) % 1)
            rr = 30 + ph*360
            d.ellipse((x-rr, y-rr, x+rr, y+rr), outline=RED + (int(220*(1-ph)),), width=5)
        d.ellipse((x-16, y-16, x+16, y+16), fill=RED + (255,), outline=(255, 255, 255, 255), width=4)
        bx, by = MP(BAKU); d.ellipse((bx-9, by-9, bx+9, by+9), fill=(255, 255, 255, 230))
        txt(d, (bx, by+40), "Bakı", font("Inter-ExtraBold.otf", 34), WHITE, 1, stroke=5)
        txt(d, (x, y-60), "Şamaxı", font("InterDisplay-Black.otf", 52), WHITE, 1, stroke=6)
        tm = wt(s, "Maqnitudası") or 4
        a = ease((lt-tm+0.2)/0.35)*oa
        card(d, (90, 300, 990, 560), a)
        txt(d, (W/2, 365), "MAQNİTUDA", font("Inter-ExtraBold.otf", 38), DIM, a, stroke=0)
        txt(d, (W/2, 470), "6,9 – 7,4", font("InterDisplay-Black.otf", 120), RED, a, stroke=0)
        a3 = ease((lt-tm-1.4)/0.35)*oa
        card(d, (90, 590, 530, 720), a3, border=YEL); card(d, (550, 590, 990, 720), a3, border=YEL)
        txt(d, (310, 630), "İntensivlik", font("Inter-SemiBold.otf", 30), DIM, a3, stroke=0)
        txt(d, (310, 685), "IX bal", font("InterDisplay-Black.otf", 52), YEL, a3, stroke=0)
        txt(d, (770, 630), "Ocaq dərinliyi", font("Inter-SemiBold.otf", 30), DIM, a3, stroke=0)
        txt(d, (770, 685), "≈15 km", font("InterDisplay-Black.otf", 52), YEL, a3, stroke=0)
        a4 = ease((lt-0.2)/0.4)*oa
        txt(d, (W/2, 220), "ƏN DAĞIDICI ZƏLZƏLƏLƏRDƏN", font("InterDisplay-Black.otf", 56), WHITE, a4)
    if k == "toll":
        for j, (key, val, lab, col) in enumerate((("İki", 2000, "nəfərə qədər həlak oldu", RED), ("yeddi", 7439, "bina zədələndi və ya dağıldı", YEL))):
            tc = wt(s, key); tc = tc - 0.15 if tc is not None else 1
            a = ease((lt-tc)/0.3)*oa
            y = 330 + j*330
            card(d, (90, y, 990, y+280), a, border=col)
            v = int(val*eout((lt-tc)/1.2))
            txt(d, (W/2, y+115), ("≈ " if j == 0 else "") + f"{v:,}".replace(",", " "), font("InterDisplay-Black.otf", 130), col, a, stroke=0)
            txt(d, (W/2, y+225), lab, font("Inter-ExtraBold.otf", 40), WHITE, a, stroke=0)
        credit(d, "bazar", oa)
    if k == "mosque":
        a = ease((lt-0.3)/0.4)*oa
        txt(d, (W/2, 250), "CÜMƏ MƏSCİDİ", font("InterDisplay-Black.otf", 96), WHITE, a)
        txt(d, (W/2, 350), "1902", font("InterDisplay-Black.otf", 70), RED, a)
        tc = wt(s, "səkkiz") or 1
        a2 = ease((lt-tc+0.1)/0.35)*oa
        card(d, (110, 1110, 970, 1250), a2, border=YEL)
        txt(d, (W/2, 1180), "8 zəlzələdən salamat çıxmışdı", font("Inter-ExtraBold.otf", 44), YEL, a2, stroke=0)
        credit(d, "mosque_e", oa)
    if k == "history":
        txt(d, (W/2, 230), "ŞAMAXININ", font("InterDisplay-Black.otf", 84), WHITE, ease(lt/0.3)*oa)
        txt(d, (W/2, 330), "ZƏLZƏLƏLƏRİ", font("InterDisplay-Black.otf", 84), RED, ease(lt/0.3)*oa)
        yrs = [("1191", ""), ("1667", "≈80 000 ölü*"), ("1806", ""), ("1859", ""), ("1872", ""), ("1902", "≈2 000 ölü")]
        t67 = wt(s, "altı") or 3
        x0 = 300; y0 = 460; step = 150
        d.line([(x0, y0), (x0, y0 + step*5)], fill=(200, 180, 150, int(200*oa)), width=4)
        for j, (yr, note) in enumerate(yrs):
            tj = 0.3 + j*0.25
            a = ease((lt-tj)/0.3)*oa
            y = y0 + j*step
            hot = (yr == "1667" and lt > t67 - 0.2) or (yr == "1902")
            col = RED if hot else WHITE
            r = 16 if hot else 11
            d.ellipse((x0-r, y-r, x0+r, y+r), fill=col + (int(255*a),))
            txt(d, (x0-40, y), yr, font("InterDisplay-Black.otf", 64), col, a, anchor="rm", stroke=4)
            if note:
                an = a if yr == "1902" else ease((lt-t67+0.2)/0.3)*oa
                txt(d, (x0+40, y), note, font("Inter-ExtraBold.otf", 46), col, an, anchor="lm", stroke=4)
        an = ease((lt-t67+0.2)/0.3)*oa
        txt(d, (W/2, 1290), "* fars tacirlərinin məlumatına görə", font("Inter-SemiBold.otf", 30), DIM, an, stroke=3)
    if k == "baku":
        x, y = MP(SHAM); bx, by = MP(BAKU)
        f = eout((lt-0.6)/1.2)
        if f > 0:
            ex, ey = x + (bx-x)*f, y + (by-y)*f - math.sin(f*math.pi)*120
            pts = [(x + (bx-x)*q, y + (by-y)*q - math.sin(q*math.pi)*120) for q in np.linspace(0, f, 40)]
            d.line(pts, fill=YEL + (255,), width=8)
            if f > 0.95: d.polygon([(bx-18, by-38), (bx+20, by-20), (bx-6, by+2)], fill=YEL + (255,))
        for (px, py), nm, col in (((x, y), "Şamaxı", RED), ((bx, by), "Bakı", YEL)):
            d.ellipse((px-14, py-14, px+14, py+14), fill=col + (255,), outline=(255, 255, 255, 255), width=4)
            txt(d, (px, py+50), nm, font("InterDisplay-Black.otf", 52), WHITE, 1)
        a = ease((lt-0.3)/0.4)*oa
        card(d, (90, 280, 990, 560), a, border=YEL)
        txt(d, (W/2, 360), "1859", font("InterDisplay-Black.otf", 110), YEL, a, stroke=0)
        txt(d, (W/2, 470), "Quberniyanın mərkəzi Bakıya köçürüldü", font("Inter-ExtraBold.otf", 38), WHITE, a, stroke=0)
    if k == "help":
        a = ease((lt-0.3)/0.4)*oa
        txt(d, (W/2, 250), "BAKI YARDIM", font("InterDisplay-Black.otf", 92), WHITE, a)
        txt(d, (W/2, 355), "KOMİTƏSİ", font("InterDisplay-Black.otf", 92), YEL, a)
        tz = wt(s, "Zərdabi") or 4
        a2 = ease((lt-tz+0.5)/0.35)*oa
        card(d, (140, 1120, 940, 1250), a2, border=YEL)
        txt(d, (W/2, 1185), "Həsən bəy Zərdabi", font("InterDisplay-Black.otf", 62), YEL, a2, stroke=0)
        credit(d, "committee", oa)
    if k == "today":
        tb = wt(s, "Cümə") or 3
        a = ease((lt-0.2)/0.4)*(1-ease((lt-tb+0.3)/0.3))
        txt(d, (W/2, 560), "Qafqazın ən", font("InterDisplay-Black.otf", 84), WHITE, a)
        txt(d, (W/2, 670), "seysmik bölgəsi", font("InterDisplay-Black.otf", 84), RED, a)
        aw = ease((lt-tb+0.3)/0.4)
        if aw > 0:
            top = (60, 250, 1020, 790); botb = (60, 830, 1020, 1370)
            p1 = kb("mosque", 0.5, 1.0, 1.0, box=top); p2 = kb("today", clamp((lt-tb)/3), 1.0, 1.08, box=botb)
            m = Image.new("L", p1.size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, p1.width, p1.height), 28, fill=int(255*aw))
            img.paste(p1, top[:2], m)
            wipe = eout((lt - (wt(s, "bərpa") or tb+1) + 0.2)/0.8)
            m2 = Image.new("L", p2.size, 0); ImageDraw.Draw(m2).rounded_rectangle((0, 0, int(p2.width*wipe), p2.height), 28, fill=int(255*aw))
            img.paste(p2, botb[:2], m2)
            d.rounded_rectangle((top[0]+20, top[1]+20, top[0]+190, top[1]+90), 22, fill=RED + (int(255*aw),))
            d.text((top[0]+105, top[1]+55), "1902", font=font("InterDisplay-Black.otf", 48), fill=(255, 255, 255, int(255*aw)), anchor="mm")
            if wipe > 0.3:
                d.rounded_rectangle((botb[0]+20, botb[1]+20, botb[0]+230, botb[1]+90), 22, fill=YEL + (255,))
                d.text((botb[0]+125, botb[1]+55), "BU GÜN", font=font("InterDisplay-Black.otf", 44), fill=INK + (255,), anchor="mm")
            d.text((W/2, 1395), "Foto: J. Zelinsky (1902) · Diego Delso (2016, CC BY-SA 4.0)", font=font("Inter-Medium.otf", 20), fill=(220, 210, 190, 170), anchor="mm")
    if k == "cta":
        a = ease((lt-0.1)/0.4)
        txt(d, (W/2, 420), "Sən bu tarixi", font("InterDisplay-Black.otf", 96), WHITE, a)
        txt(d, (W/2, 535), "bilirdin?", font("InterDisplay-Black.otf", 96), YEL, a)
        tw_ = wt(s, "Şərhdə") or 1.4
        a2 = ease((lt-tw_+0.1)/0.3)
        if a2 > 0:
            emo(img, "💬", 260, 720, 96, a2)
            txt(d, (W/2+60, 720), "Şərhdə yaz!", font("InterDisplay-Black.otf", 76), WHITE, a2)
        tb = wt(s, "izlə") or 2.5
        ab = ease((lt-tb+0.4)/0.3)
        if ab > 0:
            pressed = lt > tb + 0.3
            kk = 1 - 0.08*math.sin(clamp((lt-tb-0.25)/0.3)*math.pi) if tb+0.25 < lt < tb+0.55 else 1
            bw, bh, by = 640*kk, 150*kk, 930
            d.rounded_rectangle((W/2-bw/2, by-bh/2, W/2+bw/2, by+bh/2), int(bh/2), fill=((70, 70, 70) if pressed else (254, 44, 85)) + (int(255*ab),))
            d.text((W/2+30, by), "İZLƏYİRSƏN" if pressed else "İZLƏ", font=font("InterDisplay-Black.otf", int((66 if pressed else 84)*kk)), fill=(255, 255, 255, int(255*ab)), anchor="mm")
            if pressed: d.line([(W/2-bw/2+58, by), (W/2-bw/2+78, by+22), (W/2-bw/2+112, by-22)], fill=(255, 255, 255, int(255*ab)), width=9)
            else: d.text((W/2-bw/2+85, by), "+", font=font("InterDisplay-Black.otf", 92), fill=(255, 255, 255, int(255*ab)), anchor="mm")
            path = [(tb-0.4, 880, 1600), (tb+0.2, 640, 950), (tb+0.45, 660, 990), (dur, 950, 1700)]
            for p0, p1_ in zip(path, path[1:]):
                if p0[0] <= lt <= p1_[0]:
                    g = eio((lt-p0[0])/(p1_[0]-p0[0])); hx = p0[1]+(p1_[1]-p0[1])*g; hy = p0[2]+(p1_[2]-p0[2])*g
                    e = EMO["👆"]; sz = 160*(0.88 if abs(lt-tb-0.3) < 0.1 else 1); scl = sz/e.height
                    him = e.resize((int(e.width*scl), int(e.height*scl)), Image.LANCZOS)
                    img.paste(him, (int(hx-him.width*0.36), int(hy-him.height*0.03)), him)
    # ---------------- caption
    for c, t1 in s["caps"]:
        if c[0][0] - 0.03 <= t < t1:
            f_ = font("InterDisplay-Black.otf", 70); sp = d.textlength(" ", font=f_)
            ws = [(tw, w.upper(), d.textlength(w.upper(), font=f_)) for tw, w in c]
            tot = sum(x[2] for x in ws) + sp*(len(ws)-1)
            if tot > 900:
                f_ = font("InterDisplay-Black.otf", 54); sp = d.textlength(" ", font=f_)
                ws = [(tw, w, d.textlength(w, font=f_)) for tw, w, _ in ws]; tot = sum(x[2] for x in ws) + sp*(len(ws)-1)
            x = W/2 - tot/2; pop = back((t - c[0][0] + 0.03)/0.18)
            for tw, w, ww in ws:
                said = t >= tw - 0.02
                d.text((x, 1480 + (1-pop)*18), w, font=f_, fill=(YEL if said and t < tw + 0.45 else WHITE) + (255 if said else 130,),
                       anchor="lm", stroke_width=8, stroke_fill=(0, 0, 0, 255))
                x += ww + sp
            break
    # ---------------- film effektləri
    if k not in ("power", "baku"):
        g = GRAIN[i % len(GRAIN)]
        img = Image.blend(img, Image.merge("RGB", (g, g, g)), 0.06)
    if shake > 0:
        rs = random.Random(i)
        dx, dy = int(rs.uniform(-1, 1)*shake), int(rs.uniform(-1, 1)*shake)
        img = img.transform(img.size, Image.AFFINE, (1, 0, dx, 0, 1, dy), Image.BILINEAR, fillcolor=(0, 0, 0))
    if s is not SC[0] and lt < 0.1:
        d2 = ImageDraw.Draw(img, "RGBA"); d2.rectangle((0, 0, W, H), fill=(255, 240, 220, int(90*(1-lt/0.1))))
    if k == "hook":
        tc = wt(s, "xarabalığa") or 5
        if 0 <= lt - tc + 0.1 < 0.15:
            d2 = ImageDraw.Draw(img, "RGBA"); d2.rectangle((0, 0, W, H), fill=(255, 255, 255, int(160*(1-(lt-tc+0.1)/0.15))))
    return img.tobytes()

if __name__ == "__main__":
    out = sys.argv[1]; only = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"duration {DUR:.1f}s frames {NF}")
    json.dump(dict(scenes=[dict(key=s["key"], t0=s["t0"], t1=s["t1"], vs=s["vs"]) for s in SC], dur=DUR, tempo=TEMPO), open(out + ".timeline.json", "w"))
    if only:
        winit()
        for ts in only.split(","):
            Image.frombytes("RGB", (W, H), frame(int(float(ts)*FPS))).save(f"{out}_{ts}.jpg", quality=85)
        sys.exit()
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    with Pool(4, initializer=winit) as pool:
        for b in pool.imap(frame, range(NF), chunksize=6): ff.stdin.write(b)
    ff.stdin.close(); ff.wait()
