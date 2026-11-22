# Qız qalasının əsl sirri — YouTube sənədli video (1920x1080, 30 fps), Speko "Adrian" dublajı ilə
import sys, os, json, math, random, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, ImageEnhance
from multiprocessing import Pool

HERE = os.environ.get("QQ_WORK", os.path.dirname(os.path.abspath(__file__)))
W, H, FPS = 1920, 1080, 30
TEMPO = 1.04
GOLD = (232, 176, 75); CREAM = (246, 238, 222); INK = (14, 12, 10); RED = (222, 34, 40)
DIM = (170, 160, 145); BLUE = (62, 132, 255)
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

AL = json.load(open(os.path.join(HERE, "align.json")))
CREDITS = {"day1": "Foto: Gulustan · CC BY-SA 3.0 · Wikimedia Commons",
           "day2": "Foto: Fariz Abasov · CC BY-SA 3.0 · Wikimedia Commons",
           "tall": "Foto: AlixSaz · CC BY-SA 4.0 · Wikimedia Commons",
           "night": "Foto: Diego Delso · CC BY-SA 4.0 · Wikimedia Commons",
           "wide": "Foto: Sefer azeri · CC BY-SA 4.0 · Wikimedia Commons",
           "old1899": "Qravüra: «A visit to the Russians in Central Asia» (1899) · ictimai mülkiyyət",
           "entry": "Foto: Wikimedia Commons · ictimai mülkiyyət"}

# ---------------------------------------------------------------- timeline
TITLE_DUR = 3.8; OUTRO = 5.0
SC = []
T = 0.0
for i, a in enumerate(AL):
    if a["key"] == "hook":
        SC.append(dict(key="title", t0=T, t1=T+TITLE_DUR, words=[], vs=None)); T += TITLE_DUR
    lead = 0.35 if a["key"] not in ("leg0", "ev0") else 1.2
    if a["key"] == "intro": lead = 0.6
    vs = T + lead
    words = [(vs + t/TEMPO, w) for w, t in a["words"]]
    vend = vs + a["end"]/TEMPO
    tail = 0.55
    SC.append(dict(key=a["key"], idx=i, t0=T, vs=vs, vend=vend, t1=vend+tail, words=words))
    T = vend + tail
SC.append(dict(key="outro", t0=T, t1=T+OUTRO, words=[], vs=None)); T += OUTRO
DUR = T; NF = int(math.ceil(DUR*FPS))

def wt(s, key, k=0):
    n = 0
    for t, w in s["words"]:
        if key.lower() in w.lower():
            if n == k: return t - s["t0"]
            n += 1
    raise KeyError((s["key"], key))

# subtitr hissələri (≤ 46 simvol, durğu işarəsində kəs)
for s in SC:
    ch, cur = [], []
    for t, w in s["words"]:
        cur.append((t, w)); txt = " ".join(x[1] for x in cur)
        if (w[-1] in ".?!" and len(txt) > 12) or len(txt) > 44 or (w[-1] in ",:" and len(txt) > 28):
            ch.append(cur); cur = []
    if cur: ch.append(cur)
    s["subs"] = [(c[0][0], (ch[k+1][0][0] if k+1 < len(ch) else s.get("vend", c[-1][0]) + 0.3), " ".join(x[1] for x in c)) for k, c in enumerate(ch)]

# ---------------------------------------------------------------- assets
PH = {}; EMO = {}; VIG = None
def winit():
    global VIG
    for n in CREDITS:
        im = Image.open(os.path.join(HERE, "img", n + ".jpg")).convert("RGB")
        if n == "old1899": im = im.crop((int(im.width*0.07), int(im.height*0.03), int(im.width*0.93), int(im.height*0.9)))
        if n == "wide": im = im.crop((0, 0, int(im.width*0.97), im.height))
        if n in ("night", "tall", "entry"): im = im.crop((int(im.width*0.045), 0, int(im.width*0.955), im.height))
        cw, chh = int(W*1.22), int(H*1.22)
        sc = max(cw/im.width, chh/im.height)
        im = im.resize((int(im.width*sc)+1, int(im.height*sc)+1), Image.LANCZOS)
        PH[n] = im
    ef = font("NotoColorEmoji.ttf", 109)
    for k, e in (("hand", "👆"), ("like", "👍"), ("bell", "🔔"), ("chat", "💬"), ("scroll", "📜"), ("glass", "🔍")):
        im = Image.new("RGBA", (140, 140), (0, 0, 0, 0)); ImageDraw.Draw(im).text((4, 4), e, font=ef, embedded_color=True)
        EMO[k] = im.crop(im.getbbox())
    y, x = np.mgrid[0:H, 0:W]
    v = np.clip(((x-W/2)/(W/2))**2*0.55 + ((y-H/2)/(H/2))**2*0.75 - 0.25, 0, 1)
    a = np.zeros((H, W, 4), np.uint8); a[..., 3] = (v*210).astype(np.uint8)
    VIG = Image.fromarray(a, "RGBA")

def kb(name, u, z0=1.0, z1=1.12, px=0.0, py=0.0, grade="warm", blur=0):
    im = PH[name]; z = z0 + (z1-z0)*eio(u)
    cw, chh = W/z*1.0, H/z*1.0
    # im ölçüsü ≈ 1.22 kadr; mərkəz + yumşaq sürüşmə
    cx = im.width/2 + px*(im.width-cw)/2*(2*eio(u)-1); cy = im.height/2 + py*(im.height-chh)/2*(2*eio(u)-1)
    sc = min(im.width/(W*1.0), im.height/(H*1.0))
    cw, chh = W*sc/z, H*sc/z
    box = (cx-cw/2, cy-chh/2, cx+cw/2, cy+chh/2)
    fr = im.transform((W, H), Image.EXTENT, box, Image.BILINEAR)
    if blur: fr = fr.filter(ImageFilter.GaussianBlur(blur))
    if grade == "warm":
        fr = ImageEnhance.Color(fr).enhance(0.85); fr = Image.blend(fr, Image.new("RGB", fr.size, (60, 40, 20)), 0.12)
    elif grade == "dark":
        fr = ImageEnhance.Brightness(ImageEnhance.Color(fr).enhance(0.6)).enhance(0.45)
    elif grade == "sepia":
        g = ImageOps.grayscale(fr); fr = ImageOps.colorize(g, (30, 16, 8), (250, 215, 160))
    elif grade == "story":
        fr = ImageEnhance.Color(fr).enhance(0.5); fr = Image.blend(fr, Image.new("RGB", fr.size, (40, 22, 10)), 0.28)
    return fr

# ---------------------------------------------------------------- draw helpers
def txt(d, xy, s, f, fill, a=1.0, anchor="la", shadow=True, stroke=0):
    if a <= 0: return
    A = int(255*a)
    if shadow: d.text((xy[0]+3, xy[1]+4), s, font=f, fill=(0, 0, 0, int(150*a)), anchor=anchor)
    d.text(xy, s, font=f, fill=fill + (A,), anchor=anchor, stroke_width=stroke, stroke_fill=(0, 0, 0, A))

def panel(d, box, a=1.0, r=22, fill=(16, 13, 10), alpha=215, border=GOLD):
    if a <= 0: return
    d.rounded_rectangle(box, r, fill=fill + (int(alpha*a),), outline=border + (int(200*a),), width=2)

def paste_emo(img, k, cx, cy, size, a=1.0, rot=0):
    if a <= 0: return
    e = EMO[k]; sc = size/max(e.size)
    im = e.resize((max(1, int(e.width*sc)), max(1, int(e.height*sc))), Image.LANCZOS)
    if rot: im = im.rotate(rot, Image.BICUBIC, expand=True)
    if a < 1:
        al = im.getchannel("A").point(lambda p: int(p*a)); im.putalpha(al)
    img.paste(im, (int(cx - im.width/2), int(cy - im.height/2)), im)

def lower_third(d, lt, t_in, title, sub, a_out=1.0):
    a = ease((lt-t_in)/0.5)*a_out
    if a <= 0: return
    x = 90 - (1-eout((lt-t_in)/0.6))*60
    d.rectangle((x, 760, x+8, 880), fill=GOLD + (int(255*a),))
    txt(d, (x+30, 770), title, font("InterDisplay-Black.otf", 64), CREAM, a)
    txt(d, (x+32, 846), sub, font("DejaVuSerif.ttf", 32), GOLD, a)

def credit(d, name, a=1.0):
    if a > 0: d.text((W-30, H-22), CREDITS[name], font=font("Inter-Medium.otf", 18), fill=(230, 222, 205, int(200*a)), anchor="rs")

def checkmark(d, cx, cy, s, col):
    d.line([(cx-s, cy), (cx-s*0.3, cy+s*0.7), (cx+s, cy-s*0.8)], fill=col, width=max(3, int(s/3)), joint="curve")

def sub_btn(img, d, cx, cy, t_click, lt, scale=1.0, a=1.0):
    """iri ABUNƏ OL düyməsi; t_click-də basılır"""
    if a <= 0: return
    pressed = lt >= t_click
    k = 1.0
    if t_click - 0.05 < lt < t_click + 0.25: k = 1 - 0.08*math.sin(clamp((lt-t_click+0.05)/0.3)*math.pi)
    w, h = 760*scale*k, 170*scale*k
    col = (70, 70, 70) if pressed else RED
    d.rounded_rectangle((cx-w/2+6, cy-h/2+10, cx+w/2+6, cy+h/2+10), int(h/2), fill=(0, 0, 0, int(120*a)))
    d.rounded_rectangle((cx-w/2, cy-h/2, cx+w/2, cy+h/2), int(h/2), fill=col + (int(255*a),))
    lab = "ABUNƏ OLDUN" if pressed else "ABUNƏ OL"
    f = font("InterDisplay-Black.otf", int(96*scale*k*(0.8 if pressed else 1)))
    tx = cx + 40*scale
    d.text((tx, cy), lab, font=f, fill=(255, 255, 255, int(255*a)), anchor="mm")
    bx = cx - w/2 + 95*scale
    if pressed: checkmark(d, bx, cy, 30*scale, (255, 255, 255, int(255*a)))
    else:
        rot = 18*math.sin(lt*14)*math.exp(-max(0, lt-t_click+0.6)*0) if lt > t_click - 0.8 else 0
        paste_emo(img, "bell", bx, cy, 92*scale*k, a, rot=0)

def like_btn(img, d, cx, cy, t_click, lt, scale=1.0, a=1.0):
    if a <= 0: return
    pressed = lt >= t_click
    k = 1.0
    if t_click - 0.05 < lt < t_click + 0.25: k = 1 - 0.08*math.sin(clamp((lt-t_click+0.05)/0.3)*math.pi)
    w, h = 620*scale*k, 170*scale*k
    d.rounded_rectangle((cx-w/2+6, cy-h/2+10, cx+w/2+6, cy+h/2+10), int(h/2), fill=(0, 0, 0, int(120*a)))
    d.rounded_rectangle((cx-w/2, cy-h/2, cx+w/2, cy+h/2), int(h/2), fill=(BLUE if pressed else (250, 250, 250)) + (int(255*a),))
    paste_emo(img, "like", cx - w/2 + 100*scale, cy - 4, 100*scale*k*(1.15 if pressed and lt < t_click + 0.3 else 1), a)
    d.text((cx + 50*scale, cy), "BƏYƏN", font=font("InterDisplay-Black.otf", int(96*scale*k)),
           fill=((255, 255, 255) if pressed else INK) + (int(255*a),), anchor="mm")
    if pressed and lt < t_click + 1.0:
        p = (lt - t_click)/1.0
        d.text((cx + w/2 - 20, cy - h/2 - 20 - 60*p), "+1", font=font("InterDisplay-Black.otf", 64), fill=BLUE + (int(255*(1-p)*a),), anchor="mm")

def hand(img, path, lt):
    """path: [(t, x, y)] barmağın ucu; vaxta görə interpolyasiya, tap anında kiçilir"""
    if lt < path[0][0] or lt > path[-1][0]: return
    for a, b in zip(path, path[1:]):
        if a[0] <= lt <= b[0]:
            f = eio((lt-a[0])/max(1e-6, b[0]-a[0])); x = a[1]+(b[1]-a[1])*f; y = a[2]+(b[2]-a[2])*f; break
    tap = any(abs(lt - p[0]) < 0.12 and len(p) > 3 for p in path)
    size = 190*(0.88 if tap else 1)
    e = EMO["hand"]; sc = size/e.height
    im = e.resize((int(e.width*sc), int(e.height*sc)), Image.LANCZOS)
    # barmaq ucu ~ (0.36w, 0.03h)
    img.paste(im, (int(x - im.width*0.36), int(y - im.height*0.03)), im)

def tower_drawing(d, x0, ybase, s, a=1.0, cut=False, floors=0.0, hl14=0.0):
    """yan görünüş: silindr + şərqə çıxıntı; s = px/m"""
    A = int(255*a)
    R = 16.5/2*s; Ht = 29.5*s
    cx = x0 + R
    # çıxıntı (sağ)
    bw = 5.5*s
    d.rectangle((cx+R-6, ybase-Ht*0.97, cx+R+bw, ybase), fill=(150, 128, 98, A))
    d.rectangle((cx-R, ybase-Ht, cx+R, ybase), fill=(176, 152, 118, A))
    # daş zolaqları
    for k, y in enumerate(np.arange(ybase-Ht, ybase, 0.62*s)):
        c = (150, 126, 94, A) if k % 2 else (190, 166, 130, A)
        d.line([(cx-R, y), (cx+R, y)], fill=c, width=max(1, int(0.25*s)))
        d.line([(cx+R-6, y), (cx+R+bw, y)], fill=(130, 110, 84, A), width=1)
    # kölgə (silindr effekti)
    for j in range(int(R)):
        al = int(90*a*(j/R)**2)
        d.line([(cx+j, ybase-Ht), (cx+j, ybase)], fill=(40, 26, 12, al))
        d.line([(cx-j, ybase-Ht), (cx-j, ybase)], fill=(255, 240, 210, int(25*a*(j/R)**2)))
    d.rectangle((cx-R, ybase-Ht, cx+R, ybase), outline=(60, 44, 28, A), width=3)
    if floors > 0:
        for k in range(1, 8):
            fy = ybase - Ht*k/8
            if k/8 <= floors*1.0 + 0.001:
                d.line([(cx-R+8, fy), (cx+R-8, fy)], fill=GOLD + (int(220*a),), width=3)
        for k in range(8):
            if (k+0.5)/8 <= floors + 0.07:
                d.text((cx, ybase - Ht*(k+0.5)/8), str(k+1), font=font("Inter-ExtraBold.otf", int(2.2*s)), fill=(255, 255, 255, int(230*a)), anchor="mm")
    if hl14 > 0:
        y14 = ybase - 14*s
        d.rounded_rectangle((cx-3.5*s, y14-1.1*s, cx+1.5*s, y14+1.1*s), 6, fill=GOLD + (int(255*hl14*a),), outline=(255, 255, 255, int(255*hl14*a)), width=3)
        d.line([(cx-R-20, y14), (cx-R-170, y14)], fill=GOLD + (int(255*hl14*a),), width=3)
        d.text((cx-R-180, y14), "14 m", font=font("InterDisplay-Black.otf", 54), fill=GOLD + (int(255*hl14*a),), anchor="rm")
    return cx, R, Ht

def dim_v(d, x, y0, y1, label, a, col=GOLD):
    if a <= 0: return
    A = int(255*a); y1p = y0 + (y1-y0)*eout(a)
    d.line([(x, y0), (x, y1p)], fill=col + (A,), width=4)
    for y in (y0, y1p): d.line([(x-16, y), (x+16, y)], fill=col + (A,), width=4)
    d.text((x+26, (y0+y1)/2), label, font=font("InterDisplay-Black.otf", 60), fill=col + (A,), anchor="lm")

def dim_h(d, x0, x1, y, label, a, col=GOLD):
    if a <= 0: return
    A = int(255*a); x1p = x0 + (x1-x0)*eout(a)
    d.line([(x0, y), (x1p, y)], fill=col + (A,), width=4)
    for x in (x0, x1p): d.line([(x, y-16), (x, y+16)], fill=col + (A,), width=4)
    d.text(((x0+x1)/2, y+44), label, font=font("InterDisplay-Black.otf", 54), fill=col + (A,), anchor="mm")

def chapter(img, d, lt, num, title, sub, dur):
    a = ease(lt/0.5)*(1-ease((lt-(dur-0.4))/0.4))
    d.rectangle((0, 0, W, H), fill=(10, 8, 6, int(200*a)))
    k = eout(lt/0.7)
    txt(d, (W/2, 330), num, font("DejaVuSerif-Bold.ttf", 150), GOLD, a, anchor="mm")
    w = 520*k
    d.line([(W/2-w, 440), (W/2+w, 440)], fill=GOLD + (int(255*a),), width=3)
    txt(d, (W/2, 540), title, font("InterDisplay-Black.otf", 130), CREAM, a, anchor="mm")
    if sub: txt(d, (W/2, 660), sub, font("DejaVuSerif.ttf", 44), DIM, ease((lt-0.6)/0.5)*a, anchor="mm")

# ---------------------------------------------------------------- frame
def frame(i):
    t = i/FPS
    s = next((x for x in SC if x["t0"] <= t < x["t1"]), SC[-1])
    lt = t - s["t0"]; dur = s["t1"] - s["t0"]; u = clamp(lt/dur)
    k = s["key"]
    oa = 1 - ease((lt-(dur-0.35))/0.35)
    img = None
    if k == "intro":
        img = kb("night", u, 1.15, 1.05, grade="dark", blur=10)
    elif k == "title":
        img = kb("night", u, 1.0, 1.1, py=0.3, grade="warm")
    elif k == "hook":
        img = kb("wide", u, 1.0, 1.18, py=-0.2, grade="warm")
    elif k == "plan":
        img = kb("day2", u, 1.05, 1.0, grade="dark", blur=6)
    elif k in ("facts", "ev1", "ev3", "ev4"):
        img = Image.new("RGB", (W, H), (22, 18, 14))
        dd = ImageDraw.Draw(img)
        for gx in range(0, W, 60): dd.line([(gx, 0), (gx, H)], fill=(30, 25, 20))
        for gy in range(0, H, 60): dd.line([(0, gy), (W, gy)], fill=(30, 25, 20))
    elif k in ("leg0", "ev0"):
        img = kb("day1" if k == "leg0" else "entry", u, 1.0, 1.1, grade="dark")
    elif k == "leg1":
        img = kb("night", u, 1.25, 1.05, py=-0.5, grade="story")
    elif k == "leg2":
        img = kb("old1899", u, 1.0, 1.15, px=0.4, grade="sepia")
    elif k == "leg3":
        img = kb("tall", u, 1.1, 1.0, grade="dark", blur=4)
    elif k == "ev2":
        img = kb("day1", u, 1.0, 1.08, grade="dark", blur=8)
    elif k == "today":
        img = kb("tall", u, 1.0, 1.15, py=-0.4, grade="warm")
    elif k == "end":
        img = kb("day2", u, 1.0, 1.1, grade="dark", blur=6)
    else:
        img = kb("night", u, 1.05, 1.0, grade="dark", blur=8)
    img = img.convert("RGBA"); img.alpha_composite(VIG); img = img.convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")
    # ---------------- səhnələr
    if k == "intro":
        ts = wt(s, "abunə"); tl = wt(s, "bəyən")
        txt(d, (W/2, 150), "VİDEODAN ƏVVƏL", font("InterDisplay-Black.otf", 74), GOLD, ease(lt/0.4), anchor="mm")
        a1 = ease((lt-0.15)/0.35)
        sub_btn(img, d, W/2, 420, ts+0.25, lt, 1.0, a1)
        like_btn(img, d, W/2, 690, tl+0.2, lt, 1.0, ease((lt-0.35)/0.35))
        hand(img, [(0.5, 1500, 1150), (ts+0.15, 1080, 450), (ts+0.25, 1080, 450, "tap"), (ts+0.6, 1080, 470), (tl+0.1, 1000, 715), (tl+0.2, 1000, 715, "tap"), (tl+0.9, 1060, 760), (dur, 1700, 1200)], lt)
        txt(d, (W/2, 905), "Belə videoların davamı üçün çox vacibdir!", font("DejaVuSerif-Bold.ttf", 40), CREAM, ease((lt-wt(s, "Belə"))/0.4), anchor="mm")
    elif k == "title":
        a = ease((lt-0.3)/0.7)*oa
        for yy in range(300, 800, 4):
            al = int(150*math.sin((yy-300)/500*math.pi)*oa)
            d.rectangle((0, yy, W, yy+4), fill=(8, 6, 4, al))
        txt(d, (W/2, 420), "QIZ QALASININ", font("InterDisplay-Black.otf", 120), CREAM, a, anchor="mm")
        txt(d, (W/2, 560), "ƏSL SİRRİ", font("InterDisplay-Black.otf", 170), GOLD, ease((lt-0.6)/0.7)*oa, anchor="mm")
        w = 420*eout((lt-1.0)/0.8)
        d.line([(W/2-w, 665), (W/2+w, 665)], fill=GOLD + (int(255*oa),), width=3)
        txt(d, (W/2, 730), "Əfsanələr və tarixi sübutlar", font("DejaVuSerif.ttf", 52), CREAM, ease((lt-1.3)/0.6)*oa, anchor="mm")
        credit(d, "night", oa)
    elif k == "hook":
        lower_third(d, lt, 0.8, "QIZ QALASI", "İçərişəhər · Bakı", 1-ease((lt-wt(s, "kim")+0.6)/0.4))
        for j, (key, lab) in enumerate((("kim", "KİM?"), ("vaxt", "NƏ VAXT?"), ("üçün", "NƏ ÜÇÜN?"))):
            tj = wt(s, key) - 0.05
            a = ease((lt-tj)/0.25)*oa; kk = back((lt-tj)/0.35)
            if a > 0:
                txt(d, (W/2 + (j-1)*560, 470), lab, font("InterDisplay-Black.otf", max(10, int(110*kk))), GOLD if j == 1 else CREAM, a, anchor="mm", stroke=3)
        credit(d, "wide", oa)
    elif k == "plan":
        for j, (key, lab, em) in enumerate((("əfsanələri", "ƏFSANƏLƏR", "scroll"), ("sübutları", "TARİXİ SÜBUTLAR", "glass"))):
            tj = wt(s, key) - 0.1
            a = ease((lt-tj)/0.35)*oa; dx = (1-eout((lt-tj)/0.5))*(-200 if j == 0 else 200)
            cx = W/2 + (j*2-1)*430 + dx
            panel(d, (cx-360, 290, cx+360, 690), a)
            paste_emo(img, em, cx, 410, 150, a)
            txt(d, (cx, 590), lab, font("InterDisplay-Black.otf", 70), CREAM if j == 0 else GOLD, a, anchor="mm")
        tq = wt(s, "versiyanın") - 0.1
        a = ease((lt-tq)/0.3)*oa
        if a > 0:
            r = 70*back((lt-tq)/0.4)
            d.ellipse((W/2-r, 490-r, W/2+r, 490+r), fill=GOLD + (int(255*a),))
            d.text((W/2, 490), "?", font=font("InterDisplay-Black.otf", int(max(10, r*1.5))), fill=INK + (int(255*a),), anchor="mm")
    elif k == "facts":
        a = ease(lt/0.5)*oa
        sc_ = 22
        cx, R, Ht = tower_drawing(d, 300, 960, sc_, a, floors=ease((lt-wt(s, "səkkiz")+0.1)/1.2) if True else 0)
        th = wt(s, "iyirmi"); tdm = wt(s, "diametri"); tw = wt(s, "beş"); tf = wt(s, "səkkiz")
        dim_v(d, cx - R - 60, 960, 960-Ht, "", ease((lt-th+0.1)/0.8)*oa)
        txt(d, (cx - R - 80, 960-Ht/2), "29,5 m", font("InterDisplay-Black.otf", 58), GOLD, ease((lt-th)/0.4)*oa, anchor="rm")
        dim_h(d, cx-R, cx+R, 1000, "16,5 m", ease((lt-tdm)/0.8)*oa)
        # sağda statistik kartlar
        cards = [(th, "Hündürlük", "≈29,5 m"), (tdm, "Diametr (oturacaq)", "16,5 m"), (tw, "Divar qalınlığı", "5 m → 3–4 m"), (tf, "Mərtəbə", "8")]
        for j, (tj, lab, val) in enumerate(cards):
            aa = ease((lt-tj+0.1)/0.35)*oa; dx = (1-eout((lt-tj)/0.5))*120
            y = 170 + j*190
            panel(d, (1060+dx, y, 1800+dx, y+160), aa)
            txt(d, (1100+dx, y+48), lab, font("Inter-SemiBold.otf", 34), DIM, aa, shadow=False)
            txt(d, (1100+dx, y+112), val, font("InterDisplay-Black.otf", 66), GOLD if j % 2 == 0 else CREAM, aa, anchor="lm", shadow=False)
        # divar kəsiyi (halqa)
        aw = ease((lt-tw)/0.5)*(1-ease((lt-tf+0.3)/0.4))*oa
        if aw > 0:
            ox, oy, rr = 915, 560, 105
            d.ellipse((ox-rr, oy-rr, ox+rr, oy+rr), fill=(176, 152, 118, int(255*aw)), outline=GOLD + (int(255*aw),), width=3)
            ri = rr*(1-5/8.25)
            d.ellipse((ox-ri, oy-ri, ox+ri, oy+ri), fill=(22, 18, 14, int(255*aw)))
            d.text((ox, oy+rr+36), "kəsik: divar 5 m", font=font("Inter-SemiBold.otf", 28), fill=CREAM + (int(255*aw),), anchor="mm")
        txt(d, (60, 70), "RƏQƏMLƏRLƏ", font("Inter-ExtraBold.otf", 34), GOLD, a, shadow=False)
    elif k == "leg0":
        chapter(img, d, lt, "I", "ƏFSANƏLƏR", "", dur)
        t20 = wt(s, "iyirmiyə")
        a = ease((lt-t20)/0.4)*oa
        if a > 0:
            v = int(20*eout((lt-t20)/1.0))
            txt(d, (W/2, 700), f"≈ {v} əfsanə", font("DejaVuSerif-Bold.ttf", 64), GOLD, a, anchor="mm")
        credit(d, "day1", oa)
    elif k in ("leg1", "leg2"):
        tag = "ƏFSANƏ"
        d.rounded_rectangle((60, 60, 300, 120), 30, fill=GOLD + (int(230*oa),))
        d.text((180, 90), tag, font=font("Inter-ExtraBold.otf", 32), fill=INK + (int(255*oa),), anchor="mm")
        if k == "leg1":
            steps = [("hökmdar", "Hökmdar qızını sevmədiyi biri ilə evləndirmək istəyir"),
                     ("qala", "Qız vaxt qazanmaq üçün hündür bir qala istəyir"),
                     ("zirvəyə", "Qala hazır olanda qız zirvəyə qalxır…")]
        else:
            steps = [("mühasirəsindən", "Düşmən şəhəri mühasirəyə alır"),
                     ("odlu", "Odlu saçlı qız qılınc götürür və şəhəri xilas edir"),
                     ("kökləri", "Kökləri qədim atəşpərəstlik inanclarına gedir")]
            # köz qığılcımları
            rnd = random.Random(7)
            for p in range(70):
                sx = rnd.uniform(0, W); sp = rnd.uniform(40, 120); ph = rnd.uniform(0, 20)
                yy = H - ((lt*sp + ph*60) % (H+100)); xx = sx + 30*math.sin(lt*1.3 + p)
                r = rnd.uniform(2, 5)
                d.ellipse((xx-r, yy-r, xx+r, yy+r), fill=(255, rnd.randint(110, 180), 40, int(rnd.uniform(90, 200)*oa)))
        for j, (key, line) in enumerate(steps):
            tj = wt(s, key) - 0.2
            a = ease((lt-tj)/0.45)*oa
            if a > 0:
                y = 640 + j*110 - (1-eout((lt-tj)/0.5))*20
                f = font("DejaVuSerif-Bold.ttf", 44) if j == len(steps)-1 or True else font("DejaVuSerif.ttf", 44)
                tw_ = d.textlength(line, font=f)
                d.rounded_rectangle((90, y-10, 90+tw_+60, y+70), 14, fill=(12, 8, 4, int(185*a)))
                d.rectangle((90, y-10, 98, y+70), fill=GOLD + (int(255*a),))
                txt(d, (125, y+30), line, f, CREAM, a, anchor="lm", shadow=False)
        credit(d, "night" if k == "leg1" else "old1899", oa)
    elif k == "leg3":
        a = ease((lt-0.2)/0.5)*oa
        panel(d, (460, 200, 1460, 820), a)
        ty = wt(s, "Min")
        txt(d, (W/2, 330), "1940", font("InterDisplay-Black.otf", max(10, int(150*back((lt-ty)/0.4)))), GOLD, ease((lt-ty)/0.3)*oa, anchor="mm")
        txt(d, (W/2, 480), "«Qız qalası» baleti", font("DejaVuSerif-Bold.ttf", 64), CREAM, ease((lt-wt(s, "baletini")+0.3)/0.4)*oa, anchor="mm")
        txt(d, (W/2, 575), "Əfrasiyab Bədəlbəyli", font("DejaVuSerif.ttf", 48), DIM, ease((lt-wt(s, "Əfrasiyab"))/0.4)*oa, anchor="mm")
        ab = ease((lt-wt(s, "ilk"))/0.35)*oa
        if ab > 0:
            d.rounded_rectangle((660, 650, 1260, 740), 45, fill=GOLD + (int(255*ab),))
            d.text((W/2, 695), "İLK AZƏRBAYCAN BALETİ", font=font("Inter-ExtraBold.otf", 38), fill=INK + (int(255*ab),), anchor="mm")
        credit(d, "tall", oa)
    elif k == "ev0":
        chapter(img, d, lt, "II", "TARİXİ SÜBUTLAR", "daşlar və sənədlər nə deyir?", dur)
        credit(d, "entry", oa)
    elif k == "ev1":
        a = ease(lt/0.5)*oa
        hl = ease((lt-wt(s, "on")+0.1)/0.5)
        cx, R, Ht = tower_drawing(d, 520, 1000, 30, a, hl14=hl)
        txt(d, (60, 70), "KİTABƏ", font("Inter-ExtraBold.otf", 34), GOLD, a, shadow=False)
        txt(d, (cx, 1040), "cənub divarı", font("Inter-SemiBold.otf", 28), DIM, a, anchor="mm", shadow=False)
        items = [("küfi", "Küfi xətli daş kitabə", CREAM), ("Məsud", "«Məsud ibn Davud»", GOLD), ("ikinci", "XII əsrə aid edilir", CREAM)]
        for j, (key, lab, col) in enumerate(items):
            tj = wt(s, key) - 0.1; aa = ease((lt-tj)/0.35)*oa
            panel(d, (1100, 200+j*170, 1820, 340+j*170), aa)
            txt(d, (1140, 270+j*170), lab, font("DejaVuSerif-Bold.ttf", 52), col, aa, anchor="lm", shadow=False)
        tm = wt(s, "memarı") - 0.3; am = ease((lt-tm)/0.35)*oa
        if am > 0:
            d.rounded_rectangle((1100, 740, 1820, 850), 20, fill=(120, 30, 24, int(235*am)), outline=(255, 120, 100, int(255*am)), width=3)
            txt(d, (1460, 795), "Memar olduğu açıq yazılmayıb", font("Inter-ExtraBold.otf", 40), (255, 230, 220), am, anchor="mm", shadow=False)
    elif k == "ev2":
        a = ease(lt/0.4)*oa
        txt(d, (60, 70), "TARİXLƏNDİRMƏ FƏRZİYYƏLƏRİ", font("Inter-ExtraBold.otf", 34), GOLD, a, shadow=False)
        # zaman oxu: e.ə. 900 → 1300
        def X(yr): return 160 + (yr + 900)/(2200)*1600
        y0 = 560
        d.line([(140, y0), (1790, y0)], fill=CREAM + (int(255*a),), width=4)
        for yr, lab in ((-800, "e.ə. 800"), (-400, "e.ə. 400"), (0, "0"), (400, "400"), (800, "800"), (1200, "1200")):
            d.line([(X(yr), y0-12), (X(yr), y0+12)], fill=CREAM + (int(255*a),), width=3)
            d.text((X(yr), y0+44), lab, font=font("Inter-SemiBold.otf", 28), fill=DIM + (int(255*a),), anchor="mm")
        marks = [(wt(s, "Axundov"), -800, -600, "D. Axundov", "od məbədi · e.ə. VIII–VII əsr", (255, 150, 70), -1),
                 (wt(s, "Aşurbəyli"), 300, 600, "S. Aşurbəyli", "özül və aşağı mərtəbələr · IV–VI əsr", (120, 200, 255), 1),
                 (0.3, 1100, 1200, "Kitabə", "XII əsr", GOLD, -1)]
        for tj, a0, a1, who, what, col, side in marks:
            aa = ease((lt-tj+0.1)/0.4)*oa
            if aa <= 0: continue
            x0, x1 = X(a0), X(a1)
            d.rounded_rectangle((x0, y0-16, max(x1, x0+18), y0+16), 10, fill=col + (int(255*aa),))
            yy = y0 - 170 if side < 0 else y0 + 120
            xm = (x0+x1)/2
            d.line([(xm, y0 + (-16 if side < 0 else 16)), (xm, yy + (90 if side < 0 else 0))], fill=col + (int(255*aa),), width=3)
            bx = min(max(xm-300, 80), 1840-600)
            panel(d, (bx, yy-10, bx+600, yy+90), aa, border=col)
            txt(d, (bx+24, yy+22), who, font("Inter-ExtraBold.otf", 36), col, aa, anchor="lm", shadow=False)
            txt(d, (bx+24, yy+64), what, font("Inter-SemiBold.otf", 28), CREAM, aa, anchor="lm", shadow=False)
        credit(d, "day1", oa)
    elif k == "ev3":
        a = ease(lt/0.5)*oa
        txt(d, (60, 70), "QAZINTILAR · 1962–1963", font("Inter-ExtraBold.otf", 34), GOLD, a, shadow=False)
        # qaya (dənizə doğru maili) + dəniz
        sea_a = ease((lt-0.4)/0.6)*oa
        d.polygon([(0, 760), (1150, 840), (1920, 960), (1920, 1080), (0, 1080)], fill=(92, 78, 62, int(255*a)))
        d.polygon([(1400, 900), (1920, 960), (1920, 1080), (1400, 1080)], fill=(40, 90, 120, int(200*sea_a)))
        txt(d, (1700, 1020), "dəniz", font("Inter-SemiBold.otf", 30), (180, 220, 240), sea_a, anchor="mm", shadow=False)
        txt(d, (300, 900), "maili qaya", font("Inter-SemiBold.otf", 30), CREAM, ease((lt-wt(s, "maili"))/0.4)*oa, anchor="mm", shadow=False)
        cx, R, Ht = tower_drawing(d, 520, 800, 22, a)
        tq = wt(s, "quyusu") - 0.4; aq = ease((lt-tq)/0.5)*oa
        if aq > 0:
            fl = 800 - Ht*1/8   # 2-ci mərtəbə
            depth = 21*22*eout((lt-tq)/1.2)
            d.rectangle((cx-14, fl, cx+14, fl+depth), fill=(20, 14, 10, int(255*aq)), outline=GOLD + (int(255*aq),), width=2)
            if depth > 21*22*0.85:
                d.rectangle((cx-12, fl+depth-40, cx+12, fl+depth), fill=(60, 140, 200, int(255*aq)))
            d.line([(cx+30, fl), (cx+260, fl-60)], fill=GOLD + (int(255*aq),), width=3)
            txt(d, (cx+270, fl-60), "Su quyusu · 21 m dərinlik", font("Inter-ExtraBold.otf", 40), GOLD, aq, anchor="lm", shadow=False)
        tp = wt(s, "borular") - 0.2; ap = ease((lt-tp)/0.4)*oa
        if ap > 0:
            for j in range(2, 8):
                y = 800 - Ht*j/8
                d.line([(cx+R*0.6, y), (cx+20, 800 - Ht/8)], fill=(220, 160, 110, int(200*ap)), width=3)
            txt(d, (cx+270, 800 - Ht/8 + 10), "Saxsı borular → yağış suyu", font("Inter-SemiBold.otf", 34), CREAM, ap, anchor="lm", shadow=False)
    elif k == "ev4":
        a = ease(lt/0.5)*oa
        txt(d, (60, 70), "RƏSƏDXANA FƏRZİYYƏSİ", font("Inter-ExtraBold.otf", 34), GOLD, a, shadow=False)
        cx, cy, r = 760, 560, 230
        d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(176, 152, 118, int(255*a)), outline=(60, 44, 28, int(255*a)), width=4)
        d.ellipse((cx-r*0.6, cy-r*0.6, cx+r*0.6, cy+r*0.6), fill=(60, 48, 36, int(255*a)))
        te = wt(s, "çıxıntı") - 0.2; ae = ease((lt-te)/0.5)
        d.rectangle((cx+r-10, cy-55, cx+r+150*max(0.15, eout((lt-te)/0.6)), cy+55), fill=(150, 128, 98, int(255*a)), outline=(60, 44, 28, int(255*a)), width=3)
        # kompas
        txt(d, (cx, cy-r-60), "Ş", font("InterDisplay-Black.otf", 44), DIM, a, anchor="mm", shadow=False)
        txt(d, (cx, cy+r+60), "C", font("InterDisplay-Black.otf", 44), DIM, a, anchor="mm", shadow=False)
        txt(d, (cx-r-60, cy), "Q", font("InterDisplay-Black.otf", 44), DIM, a, anchor="mm", shadow=False)
        ts = wt(s, "şərqə") - 0.1; asn = ease((lt-ts)/0.5)*oa
        if asn > 0:
            sx, sy = 1450, 560
            d.text((cx+r+190, cy), "ŞƏRQ", font=font("InterDisplay-Black.otf", 44), fill=GOLD + (int(255*asn),), anchor="lm")
            rr = 90
            for j in range(12):
                ang = j/12*2*math.pi + lt*0.5
                d.line([(sx+math.cos(ang)*(rr+20), sy+math.sin(ang)*(rr+20)), (sx+math.cos(ang)*(rr+70), sy+math.sin(ang)*(rr+70))], fill=GOLD + (int(255*asn),), width=6)
            d.ellipse((sx-rr, sy-rr, sx+rr, sy+rr), fill=GOLD + (int(255*asn),))
            d.text((sx, sy+rr+110), "gün çıxan tərəf", font=font("Inter-SemiBold.otf", 32), fill=CREAM + (int(255*asn),), anchor="mm")
        tsb = wt(s, "sübut") - 0.2; ast = ease((lt-tsb)/0.3)*oa
        if ast > 0:
            k2 = back((lt-tsb)/0.4)
            st = Image.new("RGBA", (700, 160), (0, 0, 0, 0)); sd = ImageDraw.Draw(st)
            sd.rounded_rectangle((6, 6, 694, 154), 20, outline=(230, 70, 60, 255), width=8)
            sd.text((350, 80), "SÜBUT OLUNMAYIB", font=font("InterDisplay-Black.otf", 64), fill=(230, 70, 60, 255), anchor="mm")
            st = st.resize((max(1, int(700*k2)), max(1, int(160*k2)))).rotate(-8, Image.BICUBIC, expand=True)
            al = st.getchannel("A").point(lambda p: int(p*ast)); st.putalpha(al)
            img.paste(st, (int(1350 - st.width/2), int(880 - st.height/2)), st)
    elif k == "today":
        badges = [("muzeydir", "Bu gün: muzey"), ("mininci", "UNESCO Ümumdünya İrsi · 2000"), ("manatlıq", "10 manatlıq əskinasda")]
        for j, (key, lab) in enumerate(badges):
            tj = wt(s, key) - 0.2; aa = ease((lt-tj)/0.35)*oa
            if aa > 0:
                y = 640 + j*105; dx = (1-eout((lt-tj)/0.5))*-100
                f = font("Inter-ExtraBold.otf", 44); tw_ = d.textlength(lab, font=f)
                d.rounded_rectangle((90+dx, y, 90+dx+tw_+70, y+84), 42, fill=(14, 10, 6, int(210*aa)), outline=GOLD + (int(255*aa),), width=3)
                txt(d, (125+dx, y+42), lab, f, CREAM if j != 1 else GOLD, aa, anchor="lm", shadow=False)
        credit(d, "tall", oa)
    elif k == "end":
        a = ease(lt/0.4)
        tsx = wt(s, "Sən") - 0.2
        sa = 1 - ease((lt-tsx)/0.4)
        if sa > 0:
            txt(d, (W/2, 150), "BƏS ƏSL SİRR NƏDİR?", font("InterDisplay-Black.otf", 88), GOLD, a*sa, anchor="mm")
            for j, (key, top, sub, col) in enumerate((("geniş", "XII əsr", "elmdə ən geniş yayılmış fikir", GOLD), ("qədim", "Daha qədim kök", "hələ müzakirə olunur", (120, 200, 255)))):
                tj = wt(s, key) - 0.2; aa = ease((lt-tj)/0.4)*sa
                cx = W/2 + (j*2-1)*440
                panel(d, (cx-380, 300, cx+380, 620), aa, border=col)
                txt(d, (cx, 420), top, font("InterDisplay-Black.otf", 90), col, aa, anchor="mm", shadow=False)
                txt(d, (cx, 530), sub, font("DejaVuSerif.ttf", 40), CREAM, aa, anchor="mm", shadow=False)
        ca = ease((lt-tsx)/0.4)
        if ca > 0:
            paste_emo(img, "chat", W/2 - 420, 170, 120, ca)
            txt(d, (W/2 + 60, 170), "Fikrini şərhlərdə yaz!", font("InterDisplay-Black.otf", 84), CREAM, ca, anchor="mm")
            tl = wt(s, "bəyənməyi"); tsu = wt(s, "abunə")
            like_btn(img, d, W/2 - 380, 520, tl+0.2, lt, 0.85, ease((lt-tl+0.5)/0.3))
            sub_btn(img, d, W/2 + 380, 520, tsu+0.25, lt, 0.85, ease((lt-tsu+0.5)/0.3))
            hand(img, [(tl-0.4, 900, 1150), (tl+0.1, W/2-430, 545), (tl+0.2, W/2-430, 545, "tap"), (tl+0.5, W/2-380, 600), (tsu+0.15, W/2+330, 545), (tsu+0.25, W/2+330, 545, "tap"), (tsu+0.8, W/2+420, 640), (dur, 1800, 1200)], lt)
    elif k == "outro":
        a = ease(lt/0.5)
        txt(d, (W/2, 330), "İZLƏDİYİN ÜÇÜN TƏŞƏKKÜRLƏR!", font("InterDisplay-Black.otf", 92), CREAM, a, anchor="mm")
        sub_btn(img, d, W/2, 560, 99, lt, 0.9, ease((lt-0.3)/0.4))
        txt(d, (W/2, 760), "Növbəti tarixi sirr üçün kanalda qal", font("DejaVuSerif.ttf", 44), GOLD, ease((lt-0.6)/0.5), anchor="mm")
    # ---------------- subtitr
    if k not in ("intro",):
        for (t0, t1, line) in s["subs"]:
            if t0 - 0.05 <= t < t1:
                f = font("Inter-SemiBold.otf", 40)
                tw_ = d.textlength(line, font=f)
                aa = ease((t-t0+0.05)/0.12)
                d.rounded_rectangle((W/2-tw_/2-24, 958, W/2+tw_/2+24, 1026), 12, fill=(0, 0, 0, int(165*aa)))
                d.text((W/2, 992), line, font=f, fill=(255, 255, 255, int(255*aa)), anchor="mm")
                break
    # keçid: qısa qaralma
    if s is not SC[0] and lt < 0.3:
        d.rectangle((0, 0, W, H), fill=(0, 0, 0, int(255*(1-lt/0.3))))
    if t < 0.4:
        d.rectangle((0, 0, W, H), fill=(0, 0, 0, int(255*(1-t/0.4))))
    return img.convert("RGB").tobytes()

if __name__ == "__main__":
    out = sys.argv[1]; only = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"duration {DUR:.1f}s frames {NF}")
    for s in SC: print(s["key"], round(s["t0"], 2), round(s["t1"], 2))
    json.dump(dict(scenes=[dict(key=s["key"], idx=s.get("idx"), t0=s["t0"], t1=s["t1"], vs=s["vs"]) for s in SC], dur=DUR, tempo=TEMPO),
              open(out + ".timeline.json", "w"))
    if only:
        winit()
        for ts in only.split(","):
            Image.frombytes("RGB", (W, H), frame(int(float(ts)*FPS))).save(f"{out}_{ts}.jpg", quality=85)
        sys.exit()
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    with Pool(4, initializer=winit) as pool:
        for kk, b in enumerate(pool.imap(frame, range(NF), chunksize=6)):
            ff.stdin.write(b)
            if kk % 600 == 0: print(kk, flush=True)
    ff.stdin.close(); ff.wait()
