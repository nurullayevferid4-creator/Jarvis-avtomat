# Maiden Tower — YouTube Shorts (1080x1920, 30 fps), English, Speko "Adrian"
import sys, os, json, math, random, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, ImageEnhance
from multiprocessing import Pool

HERE = os.environ.get("QQ_WORK", os.path.dirname(os.path.abspath(__file__)))
AL = json.load(open(os.environ["QQ_ALIGN"]))
W, H, FPS = 1080, 1920, 30
TEMPO = 1.05
GOLD = (232, 176, 75); CREAM = (246, 238, 222); INK = (14, 12, 10); RED = (222, 34, 40); YEL = (255, 214, 64)
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
CREDITS = {"night": "Photo: Diego Delso · CC BY-SA 4.0 · Wikimedia Commons", "tall": "Photo: AlixSaz · CC BY-SA 4.0 · Wikimedia Commons",
           "entry": "Photo: Wikimedia Commons · public domain", "day2": "Photo: Fariz Abasov · CC BY-SA 3.0 · Wikimedia Commons",
           "wide": "Photo: Sefer azeri · CC BY-SA 4.0 · Wikimedia Commons"}

SC = []; T = 0.0
for i, a in enumerate(AL):
    vs = T + (0.15 if i == 0 else 0.25)
    words = [(vs + t/TEMPO, w) for w, t in a["words"]]
    vend = vs + a["end"]/TEMPO
    SC.append(dict(key=a["key"], idx=i, t0=T, vs=vs, vend=vend, t1=vend + (0.35 if i < len(AL)-1 else 2.0), words=words))
    T = SC[-1]["t1"]
DUR = T; NF = int(math.ceil(DUR*FPS))
def wt(s, key, k=0):
    n = 0
    for t, w in s["words"]:
        if key.lower() in w.lower():
            if n == k: return t - s["t0"]
            n += 1
    raise KeyError((s["key"], key))
for s in SC:  # 1-3 sözlük caption-lar
    ch, cur = [], []
    for t, w in s["words"]:
        cur.append((t, w)); txt_ = " ".join(x[1] for x in cur)
        if len(cur) >= 3 or w[-1] in ".,?!:" or len(txt_) > 16: ch.append(cur); cur = []
    if cur: ch.append(cur)
    s["caps"] = [(c, (ch[k+1][0][0] if k+1 < len(ch) else s["vend"] + 0.25)) for k, c in enumerate(ch)]

PH = {}; EMO = {}; VIG = None
def winit():
    global VIG
    for n in CREDITS:
        im = Image.open(os.path.join(HERE, "img", n + ".jpg")).convert("RGB")
        if n in ("night", "tall", "entry"): im = im.crop((int(im.width*0.045), 0, int(im.width*0.955), im.height))
        if n == "wide": im = im.crop((0, 0, int(im.width*0.97), im.height))
        sc = max(W*1.15/im.width, H*1.15/im.height)
        PH[n] = im.resize((int(im.width*sc)+1, int(im.height*sc)+1), Image.LANCZOS)
    ef = font("NotoColorEmoji.ttf", 109)
    for k, e in (("hand", "👆"), ("bell", "🔔"), ("chat", "💬")):
        im = Image.new("RGBA", (140, 140), (0, 0, 0, 0)); ImageDraw.Draw(im).text((4, 4), e, font=ef, embedded_color=True)
        EMO[k] = im.crop(im.getbbox())
    y, x = np.mgrid[0:H, 0:W]
    v = np.clip(((x-W/2)/(W/2))**2*0.5 + ((y-H/2)/(H/2))**2*0.6 - 0.2, 0, 1)
    top = np.clip(1 - y/700, 0, 1)**1.5; bot = np.clip((y-1000)/900, 0, 1)**1.2
    a = np.zeros((H, W, 4), np.uint8); a[..., 3] = (np.maximum(v, np.maximum(top*0.85, bot*0.8))*230).astype(np.uint8)
    VIG = Image.fromarray(a, "RGBA")

def kb(name, u, z0=1.0, z1=1.12, py=0.0, grade="warm", blur=0):
    im = PH[name]; z = z0 + (z1-z0)*eio(u)
    sc = min(im.width/W, im.height/H); cw, chh = W*sc/z, H*sc/z
    cx = im.width/2; cy = im.height/2 + py*(im.height-chh)/2*(2*eio(u)-1)
    fr = im.transform((W, H), Image.EXTENT, (cx-cw/2, cy-chh/2, cx+cw/2, cy+chh/2), Image.BILINEAR)
    if blur: fr = fr.filter(ImageFilter.GaussianBlur(blur))
    if grade == "warm": fr = Image.blend(ImageEnhance.Color(fr).enhance(0.85), Image.new("RGB", fr.size, (60, 40, 20)), 0.12)
    elif grade == "story": fr = Image.blend(ImageEnhance.Color(fr).enhance(0.5), Image.new("RGB", fr.size, (40, 22, 10)), 0.3)
    elif grade == "dark": fr = ImageEnhance.Brightness(ImageEnhance.Color(fr).enhance(0.6)).enhance(0.4)
    return fr

def txt(d, xy, s, f, fill, a=1.0, anchor="mm", stroke=6):
    if a <= 0: return
    d.text(xy, s, font=f, fill=fill + (int(255*a),), anchor=anchor, stroke_width=stroke, stroke_fill=(0, 0, 0, int(255*a)))
def card(d, box, a, border=GOLD):
    if a > 0: d.rounded_rectangle(box, 26, fill=(14, 10, 6, int(215*a)), outline=border + (int(230*a),), width=3)
def emo(img, k, cx, cy, size, a=1.0):
    if a <= 0: return
    e = EMO[k]; sc = size/max(e.size); im = e.resize((max(1, int(e.width*sc)), max(1, int(e.height*sc))), Image.LANCZOS)
    if a < 1: im.putalpha(im.getchannel("A").point(lambda p: int(p*a)))
    img.paste(im, (int(cx-im.width/2), int(cy-im.height/2)), im)
def credit(d, n, a=1.0):
    if a > 0: d.text((W/2, 1600), CREDITS[n], font=font("Inter-Medium.otf", 20), fill=(230, 222, 205, int(170*a)), anchor="mm")
def pill(d, cx, cy, label, col, a, fcol=INK, size=48):
    if a <= 0: return
    f = font("InterDisplay-Black.otf", size); tw = d.textlength(label, font=f)
    d.rounded_rectangle((cx-tw/2-34, cy-size*0.85, cx+tw/2+34, cy+size*0.85), int(size*0.85), fill=col + (int(255*a),))
    d.text((cx, cy), label, font=f, fill=fcol + (int(255*a),), anchor="mm")

def tower(d, cx, ybase, s, a, well=0.0):
    A = int(255*a); R = 8.25*s; Ht = 29.5*s; bw = 5.5*s
    d.rectangle((cx+R-6, ybase-Ht*0.97, cx+R+bw, ybase), fill=(150, 128, 98, A))
    d.rectangle((cx-R, ybase-Ht, cx+R, ybase), fill=(176, 152, 118, A))
    for k, y in enumerate(np.arange(ybase-Ht, ybase, 0.62*s)):
        d.line([(cx-R, y), (cx+R, y)], fill=((150, 126, 94) if k % 2 else (190, 166, 130)) + (A,), width=max(1, int(0.25*s)))
    for j in range(int(R)):
        d.line([(cx+j, ybase-Ht), (cx+j, ybase)], fill=(40, 26, 12, int(90*a*(j/R)**2)))
    d.rectangle((cx-R, ybase-Ht, cx+R, ybase), outline=(60, 44, 28, A), width=3)
    if well > 0:
        fl = ybase - Ht/8; dep = 21*s*eout(well)
        d.rectangle((cx-12, fl, cx+12, fl+dep), fill=(20, 14, 10, A), outline=GOLD + (A,), width=2)
        if well > 0.9: d.rectangle((cx-10, fl+dep-36, cx+10, fl+dep), fill=(60, 140, 200, A))

def frame(i):
    t = i/FPS
    s = next((x for x in SC if x["t0"] <= t < x["t1"]), SC[-1])
    lt = t - s["t0"]; dur = s["t1"] - s["t0"]; u = clamp(lt/dur); k = s["key"]
    oa = 1 - ease((lt-(dur-0.3))/0.3) if k != "s5" else 1.0
    if k == "s1": img = kb("night", u, 1.25, 1.0, py=0.2)
    elif k == "s2": img = kb("tall", u, 1.0, 1.15, py=-0.3, grade="story")
    elif k == "s3": img = kb("entry", u, 1.0, 1.12, grade="warm")
    elif k == "s4": img = kb("night", u, 1.1, 1.0, grade="dark", blur=10)
    else: img = kb("wide", u, 1.0, 1.12, py=-0.3)
    img = img.convert("RGBA"); img.alpha_composite(VIG); img = img.convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")
    if k == "s1":
        for j, (key, line, col) in enumerate((("Who", "WHO REALLY", CREAM), ("built", "BUILT THE", CREAM), ("Maiden", "MAIDEN TOWER?", YEL))):
            tj = wt(s, key) - 0.05; a = ease((lt-tj)/0.2); kk = back((lt-tj)/0.3)
            txt(d, (W/2, 250 + j*125), line, font("InterDisplay-Black.otf", max(10, int(112*kk))), col, a*oa, stroke=7)
        tl = wt(s, "Legends") - 0.1; th = wt(s, "history") - 0.1
        pill(d, W/2-250, 700, "LEGEND", RED, ease((lt-tl)/0.25)*oa, fcol=(255, 255, 255))
        txt(d, (W/2, 700), "vs", font("InterDisplay-Black.otf", 54), CREAM, ease((lt-th)/0.25)*oa)
        pill(d, W/2+250, 700, "HISTORY", GOLD, ease((lt-th)/0.25)*oa)
        credit(d, "night", oa)
    elif k == "s2":
        pill(d, W/2, 230, "THE LEGENDS", RED, ease(lt/0.3)*oa, fcol=(255, 255, 255), size=56)
        for j, (key, l1, l2) in enumerate((("princess", "A princess asks", "for a tall tower…"), ("fiery", "A fiery-haired girl", "saves the city"))):
            tj = wt(s, key) - 0.2; a = ease((lt-tj)/0.35)*oa
            y = 420 + j*300 - (1-eout((lt-tj)/0.4))*30
            card(d, (90, y, 990, y+240), a, border=RED if j == 0 else GOLD)
            txt(d, (W/2, y+80), l1, font("DejaVuSerif-Bold.ttf", 62), CREAM, a, stroke=0)
            txt(d, (W/2, y+165), l2, font("DejaVuSerif-Bold.ttf", 62), YEL if j else CREAM, a, stroke=0)
        if lt > wt(s, "fiery") - 0.3:
            rnd = random.Random(5)
            for p in range(60):
                sx = rnd.uniform(0, W); sp = rnd.uniform(60, 160); ph = rnd.uniform(0, 30)
                yy = H - ((lt*sp + ph*60) % (H+100)); xx = sx + 30*math.sin(lt*1.4 + p); r = rnd.uniform(2, 6)
                d.ellipse((xx-r, yy-r, xx+r, yy+r), fill=(255, rnd.randint(110, 180), 40, int(rnd.uniform(90, 210)*oa)))
        credit(d, "tall", oa)
    elif k == "s3":
        pill(d, W/2, 230, "THE HISTORY", GOLD, ease(lt/0.3)*oa, size=56)
        items = [("Kufic", "Kufic inscription", "names Masud ibn Davud", GOLD), ("twelfth", "→ 12th century", "", CREAM),
                 ("older", "Or much older?", "a Zoroastrian fire temple theory", (120, 200, 255))]
        for j, (key, l1, l2, col) in enumerate(items):
            tj = wt(s, key) - 0.2; a = ease((lt-tj)/0.35)*oa
            y = 400 + j*270
            card(d, (90, y, 990, y+(220 if l2 else 140)), a, border=col)
            txt(d, (W/2, y+70), l1, font("InterDisplay-Black.otf", 66), col, a, stroke=0)
            if l2: txt(d, (W/2, y+152), l2, font("DejaVuSerif-Bold.ttf", 40), CREAM, a, stroke=0)
        credit(d, "entry", oa)
    elif k == "s4":
        tw_ = wt(s, "well") - 0.3; te = wt(s, "buttress") - 0.3
        a1 = ease((lt-0.1)/0.3)*(1-ease((lt-te+0.2)/0.3))
        if a1 > 0:
            tower(d, W/2-60, 1150, 22, a1, well=clamp((lt-tw_)/1.0))
            txt(d, (W/2, 280), "A WELL", font("InterDisplay-Black.otf", 110), CREAM, a1)
            txt(d, (W/2, 410), "21 m DEEP", font("InterDisplay-Black.otf", 110), YEL, ease((lt-tw_-0.3)/0.3)*a1)
        a2 = ease((lt-te)/0.35)*oa
        if a2 > 0:
            cx, cy, r = W/2-140, 860, 170
            d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=(176, 152, 118, int(255*a2)), outline=(60, 44, 28, int(255*a2)), width=4)
            d.ellipse((cx-r*0.6, cy-r*0.6, cx+r*0.6, cy+r*0.6), fill=(60, 48, 36, int(255*a2)))
            d.rectangle((cx+r-10, cy-45, cx+r+120, cy+45), fill=(150, 128, 98, int(255*a2)))
            ae = ease((lt - wt(s, "east"))/0.4)*a2
            sx, sy = W/2+310, 860
            for j in range(12):
                ang = j/12*2*math.pi + lt*0.5
                d.line([(sx+math.cos(ang)*85, sy+math.sin(ang)*85), (sx+math.cos(ang)*130, sy+math.sin(ang)*130)], fill=GOLD + (int(255*ae),), width=6)
            d.ellipse((sx-65, sy-65, sx+65, sy+65), fill=GOLD + (int(255*ae),))
            txt(d, (W/2, 290), "FACES EAST", font("InterDisplay-Black.otf", 110), CREAM, a2)
            txt(d, (W/2, 410), "TOWARD SUNRISE", font("InterDisplay-Black.otf", 92), YEL, ae)
    elif k == "s5":
        a = ease(lt/0.3)
        card(d, (90, 240, 990, 520), a)
        txt(d, (W/2, 330), "12th CENTURY", font("InterDisplay-Black.otf", 96), YEL, a, stroke=0)
        txt(d, (W/2, 440), "most historians' view", font("DejaVuSerif-Bold.ttf", 46), CREAM, a, stroke=0)
        tq = wt(s, "What") - 0.1; aq = ease((lt-tq)/0.3)
        if aq > 0:
            emo(img, "chat", 135, 680, 100, aq)
            txt(d, (W/2+55, 680), "WHAT DO YOU THINK?", font("InterDisplay-Black.otf", 66), CREAM, aq)
        tsu = wt(s, "subscribe"); asu = ease((lt-tsu+0.4)/0.3)
        if asu > 0:
            pressed = lt > tsu + 0.25
            kk = 1 - 0.08*math.sin(clamp((lt-tsu-0.2)/0.3)*math.pi) if tsu+0.2 < lt < tsu+0.5 else 1
            w_, h_ = 700*kk, 160*kk; cy = 930
            d.rounded_rectangle((W/2-w_/2, cy-h_/2, W/2+w_/2, cy+h_/2), int(h_/2), fill=((70, 70, 70) if pressed else RED) + (int(255*asu),))
            d.text((W/2+40, cy), "SUBSCRIBED" if pressed else "SUBSCRIBE", font=font("InterDisplay-Black.otf", int((74 if pressed else 86)*kk)), fill=(255, 255, 255, int(255*asu)), anchor="mm")
            if not pressed: emo(img, "bell", W/2-w_/2+85, cy, 84, asu)
            else: d.line([(W/2-w_/2+60, cy), (W/2-w_/2+80, cy+22), (W/2-w_/2+115, cy-22)], fill=(255, 255, 255, int(255*asu)), width=9)
            # barmaq
            path = [(tsu-0.4, 900, 1500), (tsu+0.15, 640, 950), (tsu+0.4, 660, 990), (dur, 950, 1600)]
            for p0, p1 in zip(path, path[1:]):
                if p0[0] <= lt <= p1[0]:
                    f = eio((lt-p0[0])/(p1[0]-p0[0])); x = p0[1]+(p1[1]-p0[1])*f; y = p0[2]+(p1[2]-p0[2])*f
                    e = EMO["hand"]; sz = 170*(0.88 if abs(lt-tsu-0.2) < 0.1 else 1); sc = sz/e.height
                    im = e.resize((int(e.width*sc), int(e.height*sc)), Image.LANCZOS)
                    img.paste(im, (int(x-im.width*0.36), int(y-im.height*0.03)), im)
        credit(d, "wide", 1.0)
    # iri caption (söz-söz)
    for c, t1 in s["caps"]:
        if c[0][0] - 0.03 <= t < t1:
            f = font("InterDisplay-Black.otf", 84); sp = d.textlength(" ", font=f)
            ws = [(tw, w.upper(), d.textlength(w.upper(), font=f)) for tw, w in c]
            tot = sum(x[2] for x in ws) + sp*(len(ws)-1)
            if tot > 980:
                f = font("InterDisplay-Black.otf", 64); sp = d.textlength(" ", font=f)
                ws = [(tw, w, d.textlength(w, font=f)) for tw, w, _ in ws]; tot = sum(x[2] for x in ws) + sp*(len(ws)-1)
            x = W/2 - tot/2; pop = back((t - c[0][0] + 0.03)/0.18)
            for tw, w, ww in ws:
                said = t >= tw - 0.02
                d.text((x, 1330 + (1-pop)*20), w, font=f, fill=(YEL if said and t < tw + 0.45 else (255, 255, 255)) + (255 if said else 140,),
                       anchor="lm", stroke_width=8, stroke_fill=(0, 0, 0, 255))
                x += ww + sp
            break
    if s is not SC[0] and lt < 0.15: d.rectangle((0, 0, W, H), fill=(255, 255, 255, int(120*(1-lt/0.15))))
    return img.tobytes()

if __name__ == "__main__":
    out = sys.argv[1]; only = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"duration {DUR:.1f}s frames {NF}")
    for s in SC: print(s["key"], round(s["t0"], 2), round(s["t1"], 2))
    json.dump(dict(scenes=[dict(key=s["key"], idx=s["idx"], t0=s["t0"], t1=s["t1"], vs=s["vs"]) for s in SC], dur=DUR, tempo=TEMPO), open(out + ".timeline.json", "w"))
    if only:
        winit()
        for ts in only.split(","):
            Image.frombytes("RGB", (W, H), frame(int(float(ts)*FPS))).save(f"{out}_{ts}.jpg", quality=85)
        sys.exit()
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    with Pool(3, initializer=winit) as pool:
        for kk, b in enumerate(pool.imap(frame, range(NF), chunksize=6)):
            ff.stdin.write(b)
    ff.stdin.close(); ff.wait()
