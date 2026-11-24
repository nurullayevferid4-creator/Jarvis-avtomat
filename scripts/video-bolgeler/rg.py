# Azərbaycanın bölgələri: nə ilə məşhurdur, yerin altında nə var — 1080x1920 (Shorts / TikTok), Speko "Adrian"
import sys, os, json, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from multiprocessing import Pool

HERE = os.environ.get("RG_WORK", os.path.dirname(os.path.abspath(__file__)))
VARIANT = os.environ.get("VARIANT", "yt")       # yt | tt
AL = json.load(open(os.path.join(HERE, "align.json")))
META = json.load(open(os.path.join(HERE, "meta.json")))
W, H, FPS = 1080, 1920, 30
TEMPO = 1.08
BG = (11, 17, 32); INK = (8, 10, 18); WHITE = (248, 248, 244); YEL = (255, 210, 70); DIM = (150, 160, 180)
FI = "/usr/share/fonts/opentype/inter/"
_fc = {}
def font(n, s):
    if (n, s) not in _fc:
        p = ("/usr/share/fonts/truetype/noto/" + n) if n.startswith("Noto") else (FI + n)
        _fc[(n, s)] = ImageFont.truetype(p, s)
    return _fc[(n, s)]
def clamp(v, a=0.0, b=1.0): return max(a, min(b, v))
def ease(t): t = clamp(t); return t*t*(3-2*t)
def eio(t): t = clamp(t); return 4*t*t*t if t < .5 else 1-(-2*t+2)**3/2
def eout(t): t = clamp(t); return 1-(1-t)**3
def back(t):
    t = clamp(t); c1 = 1.70158; c3 = c1+1
    return 1 + c3*(t-1)**3 + c1*(t-1)**2

NAMES = META["names"]
RC = {"Bakı": (255, 196, 64), "Abşeron-Xızı": (255, 160, 70), "Gəncə-Daşkəsən": (110, 200, 255), "Qazax-Tovuz": (120, 230, 160),
      "Şəki-Zaqatala": (255, 130, 150), "Quba-Xaçmaz": (255, 110, 90), "Dağlıq Şirvan": (190, 140, 255), "Lənkəran-Astara": (90, 220, 140),
      "Mərkəzi Aran": (80, 200, 230), "Mil-Muğan": (240, 220, 120), "Şirvan-Salyan": (230, 190, 110), "Qarabağ": (255, 150, 200),
      "Şərqi Zəngəzur": (170, 200, 255), "Naxçıvan": (255, 120, 120)}

# səhnələr: (açar, başlıq, işıqlanan rayonlar, sancaqlar [(rayon/lonlat, emoji, yazı, işarə sözü)], çiplər [(işarə sözü, emoji, yazı)])
SC_DEF = {
 "intro": ("14 İQTİSADİ RAYON", NAMES, [], []),
 "baku": ("BAKI · ABŞERON", ["Bakı", "Abşeron-Xızı"], [("Bakı", "⛽", "Neft və qaz", "neft"), ((49.38, 40.11), "🌋", "Qobustan", "Qobustanda")],
          [("neft", "⛽", "Neft"), ("qaz", "🔥", "Qaz"), ("palçıq", "🌋", "Palçıq vulkanları"), ("qayaüstü", "🗿", "Qayaüstü rəsmlər")]),
 "ganja": ("GƏNCƏ-DAŞKƏSƏN", ["Gəncə-Daşkəsən"], [("Daşkəsən", "⛏️", "Daşkəsən", "dəmir"), ("Naftalan", "🛢️", "Naftalan", "Naftalan")],
           [("dəmir", "⛏️", "Dəmir filizi"), ("kobalt", "⛏️", "Kobalt"), ("alunit", "⛏️", "Alunit"), ("müalicəvi", "🛢️", "Müalicəvi neft")]),
 "qazax": ("QAZAX-TOVUZ", ["Qazax-Tovuz"], [("Gədəbəy", "🪙", "Gədəbəy", "Gədəbəy"), ("Şəmkir", "⛏️", "Şəmkir", "Şəmkir")],
           [("qızıl", "🪙", "Qızıl"), ("alunit", "⛏️", "Alunit")]),
 "sheki": ("ŞƏKİ-ZAQATALA", ["Şəki-Zaqatala"], [("Şəki", "🏰", "Şəki", "Şəki"), ("Qəbələ", "⛰️", "Qəbələ", "Qəbələ"), ("Zaqatala", "🌰", "Zaqatala", "Zaqatala")],
           [("halvası", "🍬", "Şəki halvası"), ("ipəyi", "🧵", "İpək"), ("Xan", "🏰", "Xan sarayı"), ("fındıq", "🌰", "Fındıq"), ("kurortları", "⛷️", "Dağ kurortları")]),
 "quba": ("QUBA-XAÇMAZ", ["Quba-Xaçmaz"], [("Quba", "🍎", "Quba", "Quba"), ("Qusar", "⛷️", "Qusar", "Qusar"), ("Dəvəçi", "💧", "Şabran", "Şabran")],
          [("almas", "🍎", "Quba alması"), ("xalçalar", "🧶", "Xalça"), ("Şahdağ", "⛷️", "Şahdağ"), ("Qalaaltı", "💧", "Qalaaltı suyu")]),
 "shirvan": ("DAĞLIQ ŞİRVAN", ["Dağlıq Şirvan"], [("Şamaxı", "🍇", "Şamaxı", "Şamaxı")],
             [("üzüm", "🍇", "Üzüm bağları"), ("Pirqulu", "🔭", "Pirqulu rəsədxanası")]),
 "lenkoran": ("LƏNKƏRAN-ASTARA", ["Lənkəran-Astara"], [("Lankaran", "🍵", "Lənkəran", "Lənkəran"), ("Astara", "🍋", "Astara", "Astara")],
              [("çay", "🍵", "Çay"), ("sitrus", "🍋", "Sitrus"), ("Hirkan", "🌳", "Hirkan meşələri")]),
 "aran": ("MƏRKƏZİ ARAN", ["Mərkəzi Aran"], [("Mingəçevir", "⚡", "Mingəçevir", "Mingəçevirdə")],
          [("anbarı", "💧", "Ən böyük su anbarı"), ("elektrik", "⚡", "Su elektrik stansiyası")]),
 "mil": ("MİL-MUĞAN · ŞİRVAN-SALYAN", ["Mil-Muğan", "Şirvan-Salyan"], [("Saatlı", "🌱", "Saatlı", "pambıq"), ("Neftçala", "⛽", "Neftçala", "Neftçala")],
         [("pambıq", "🌱", "Pambıq"), ("taxıl", "🌾", "Taxıl"), ("neft", "⛽", "Neft")]),
 "qarabag": ("QARABAĞ · ŞƏRQİ ZƏNGƏZUR", ["Qarabağ", "Şərqi Zəngəzur"], [("Şuşa", "🏰", "Şuşa", "Şuşa"), ("Kəlbəcər", "💧", "Kəlbəcər", "Kəlbəcərdə")],
             [("atı", "🐎", "Qarabağ atı"), ("Şuşa", "🏰", "Şuşa"), ("İstisu", "💧", "İstisu"), ("qızıl", "🪙", "Söyüdlü qızılı")]),
 "naxcivan": ("NAXÇIVAN", ["Naxçıvan"], [((45.38, 39.24), "🧂", "Duzdağ", "Duzdağ"), ("Ordubad", "⛏️", "Ordubad", "Ordubadda")],
              [("duz", "🧂", "Duz"), ("Badamlı", "💧", "Badamlı"), ("Sirab", "💧", "Sirab"), ("molibden", "⛏️", "Molibden")]),
 "cta": ("SƏNİN RAYONUN?", NAMES, [], []),
}
ORDER = ["intro", "baku", "ganja", "qazax", "sheki", "quba", "shirvan", "lenkoran", "aran", "mil", "qarabag", "naxcivan", "cta"]
ALK = {a["key"]: a for a in AL}

SC = []; T = 0.0
for i, k in enumerate(ORDER):
    a = ALK["cta_" + VARIANT] if k == "cta" else ALK[k]
    vs = T + (0.2 if i == 0 else 0.3)
    words = [(vs + t/TEMPO, w) for w, t in a["words"]]
    vend = vs + a["end"]/TEMPO
    tail = 2.2 if k == "cta" else 0.35
    SC.append(dict(key=k, akey=a["key"], t0=T, vs=vs, vend=vend, t1=vend + tail, words=words))
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
        if len(cur) >= 3 or w[-1] in ".,?!:" or len(tx) > 18: ch.append(cur); cur = []
    if cur: ch.append(cur)
    s["caps"] = [(c, (ch[j+1][0][0] if j+1 < len(ch) else s["vend"]+0.25)) for j, c in enumerate(ch)]

# ---------------------------------------------------------------- xəritə
RID = LAND = None; EMO = {}; BORDER = None; GLOWS = {}
MW, MH = META["W"], META["H"]
def lonlat(lon, lat): return ((lon - META["lon0"])*META["C"]*META["K"], (META["lat1"] - lat)*META["K"])
def bbox_of(regs):
    ids = [NAMES.index(r)+1 for r in regs]
    m = np.isin(RID, ids); ys, xs = np.nonzero(m)
    return xs.min(), ys.min(), xs.max(), ys.max()
BOX = {}
def winit():
    global RID, LAND, BORDER
    RID = np.load(os.path.join(HERE, "regid.npy")); LAND = np.load(os.path.join(HERE, "land.npy"))
    e = np.zeros_like(RID, bool)
    e[:-1] |= RID[:-1] != RID[1:]; e[:, :-1] |= RID[:, :-1] != RID[:, 1:]
    BORDER = np.asarray(Image.fromarray((e*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
    ef = font("NotoColorEmoji.ttf", 109)
    for k in set(x[1] for d in SC_DEF.values() for x in d[2]) | set(x[1] for d in SC_DEF.values() for x in d[3]) | {"👆", "🔔", "💬", "📍"}:
        im = Image.new("RGBA", (150, 150), (0, 0, 0, 0)); ImageDraw.Draw(im).text((4, 4), k, font=ef, embedded_color=True)
        bb = im.getbbox(); EMO[k] = im.crop(bb) if bb else im
    for k in ORDER:
        BOX[k] = bbox_of(SC_DEF[k][1])

def map_image(s, lt):
    """bütün xəritə (MW x MH) RGB: passiv rayonlar tutqun, aktiv rayonlar parlaq"""
    regs = SC_DEF[s["key"]][1]; k = s["key"]
    lut = np.zeros((16, 3), np.float32)
    for i, n in enumerate(NAMES):
        base = np.array(RC[n], np.float32)
        muted = base*0.28 + np.array([30, 38, 56])
        if k == "intro":
            f = ease((lt - 0.25 - i*0.11)/0.25) * (1 - ease((lt - (s["vend"]-s["t0"]) + 0.2)/0.5)*0.7)
        elif k == "cta":
            f = 0.85
        else:
            f = ease((lt - 0.15)/0.45) if n in regs else 0.0
        lut[i+1] = muted*(1-f) + base*f
    img = lut[RID]
    img[(RID == 0) & LAND] = (36, 42, 56)
    img[(RID == 0) & ~LAND] = (14, 30, 54)
    img[BORDER & (RID > 0)] = img[BORDER & (RID > 0)]*0.45
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))

MAP_BOX = (40, 400, 1040, 1180)   # kadrda xəritə sahəsi
def cam_for(key):
    if key in ("intro", "cta"): x0, y0, x1, y1 = BOX[key]; pad = 0.05
    else: x0, y0, x1, y1 = BOX[key]; pad = 0.22
    bw, bh = (x1-x0)*(1+pad*2), (y1-y0)*(1+pad*2)
    aw, ah = MAP_BOX[2]-MAP_BOX[0], MAP_BOX[3]-MAP_BOX[1]
    sc = min(aw/bw, ah/bh, 1.6)
    return ((x0+x1)/2, (y0+y1)/2, sc)

def card_chip(d, img, x, y, emoji, label, a, col):
    f = font("Inter-ExtraBold.otf", 40); tw = d.textlength(label, font=f)
    w = tw + 112
    d.rounded_rectangle((x, y, x+w, y+78), 39, fill=(18, 24, 42, int(235*a)), outline=col + (int(255*a),), width=3)
    paste_emo(img, emoji, x+44, y+39, 50, a)
    d.text((x+80, y+39), label, font=f, fill=WHITE + (int(255*a),), anchor="lm")
    return w

def paste_emo(img, k, cx, cy, size, a=1.0):
    if a <= 0 or k not in EMO: return
    e = EMO[k]; sc = size/max(e.size); im = e.resize((max(1, int(e.width*sc)), max(1, int(e.height*sc))), Image.LANCZOS)
    if a < 1: im.putalpha(im.getchannel("A").point(lambda p: int(p*a)))
    img.paste(im, (int(cx-im.width/2), int(cy-im.height/2)), im)

def frame(i):
    t = i/FPS
    s = next((x for x in SC if x["t0"] <= t < x["t1"]), SC[-1])
    lt = t - s["t0"]; dur = s["t1"] - s["t0"]; k = s["key"]
    idx = SC.index(s); prev = SC[idx-1] if idx > 0 else s
    img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img, "RGBA")
    for gy in range(0, H, 64): d.line([(0, gy), (W, gy)], fill=(18, 26, 46))
    for gx in range(0, W, 64): d.line([(gx, 0), (gx, H)], fill=(18, 26, 46))
    # kamera: əvvəlki səhnədən bu səhnəyə
    c0 = cam_for(prev["key"]); c1 = cam_for(k); f = eio(lt/0.8) if s is not prev else 1
    cx = c0[0]+(c1[0]-c0[0])*f; cy = c0[1]+(c1[1]-c0[1])*f
    sc = math.exp(math.log(c0[2]) + (math.log(c1[2])-math.log(c0[2]))*f)
    sc *= 1 + 0.02*math.sin(t*0.8)
    mimg = map_image(s, lt)
    mx0, my0, mx1, my1 = MAP_BOX; aw, ah = mx1-mx0, my1-my0
    box = (cx - aw/2/sc, cy - ah/2/sc, cx + aw/2/sc, cy + ah/2/sc)
    view = mimg.transform((aw, ah), Image.EXTENT, box, Image.BILINEAR)
    # yumşaq kənar maskası
    msk = Image.new("L", (aw, ah), 0); ImageDraw.Draw(msk).rounded_rectangle((0, 0, aw, ah), 40, fill=255)
    img.paste(view, (mx0, my0), msk)
    d.rounded_rectangle(MAP_BOX, 40, outline=(60, 75, 110), width=3)
    def P(px, py): return (mx0 + (px - box[0])*sc, my0 + (py - box[1])*sc)
    # sancaqlar
    for loc, emoji, lab, cue in SC_DEF[k][2]:
        tc = wt(s, cue); tc = (tc - 0.2) if tc is not None else 0.6
        a = ease((lt-tc)/0.3)
        if a <= 0: continue
        if isinstance(loc, tuple): px, py = lonlat(*loc)
        else: px, py = META["cent"][loc]
        x, y = P(px, py)
        kk = back((lt-tc)/0.4)
        d.ellipse((x-10, y-10, x+10, y+10), fill=(255, 255, 255, int(255*a)), outline=INK + (int(255*a),), width=3)
        paste_emo(img, emoji, x, y-58*kk, 70*kk, a)
        d.text((x, y+34), lab, font=font("Inter-ExtraBold.otf", 34), fill=WHITE + (int(255*a),), anchor="mm", stroke_width=5, stroke_fill=INK + (int(255*a),))
    # başlıq
    title = SC_DEF[k][0]
    d.text((W/2, 140), "AZƏRBAYCANIN BÖLGƏLƏRİ", font=font("Inter-ExtraBold.otf", 34), fill=DIM, anchor="mm")
    ta = ease(lt/0.3); oy = (1-eout(lt/0.4))*30
    fs = 84
    while d.textlength(title, font=font("InterDisplay-Black.otf", fs)) > 1000: fs -= 4
    col = RC[SC_DEF[k][1][0]] if k not in ("intro", "cta") else YEL
    d.text((W/2, 245+oy), title, font=font("InterDisplay-Black.otf", fs), fill=col + (int(255*ta),), anchor="mm", stroke_width=4, stroke_fill=INK + (int(255*ta),))
    if k not in ("intro", "cta"):
        n = ORDER.index(k); tot = len(ORDER)-2
        for j in range(tot):
            x = W/2 - (tot-1)*22 + j*44
            d.ellipse((x-8, 330-8, x+8, 330+8), fill=(col if j < n else (60, 70, 95)) + (255,))
    # çiplər
    chips = SC_DEF[k][3]
    if chips:
        x, y = 60, 1225
        for cue, emoji, lab in chips:
            tc = wt(s, cue); tc = (tc - 0.15) if tc is not None else 0.5
            a = ease((lt-tc)/0.25)
            f_ = font("Inter-ExtraBold.otf", 40); wch = d.textlength(lab, font=f_) + 112
            if x + wch > W - 60: x = 60; y += 96
            if a > 0:
                dy = (1-eout((lt-tc)/0.3))*20
                card_chip(d, img, x, y+dy, emoji, lab, a, col)
            x += wch + 18
    if k == "intro":
        a = ease((lt-0.3)/0.4)
        d.text((W/2, 1260), "Hansı bölgə nə ilə məşhurdur?", font=font("InterDisplay-Black.otf", 56), fill=WHITE + (int(255*a),), anchor="mm")
        d.text((W/2, 1340), "Yerin altında nə var?", font=font("InterDisplay-Black.otf", 56), fill=YEL + (int(255*ease((lt-wt(s, "altında")+0.2)/0.3)),), anchor="mm")
    if k == "cta":
        a = ease((lt-0.2)/0.4)
        paste_emo(img, "💬", 170, 1270, 90, a)
        d.text((W/2+50, 1270), "Şərhdə yaz!", font=font("InterDisplay-Black.otf", 72), fill=WHITE + (int(255*a),), anchor="mm")
        cue = "abunə" if VARIANT == "yt" else "izlə"
        tb = wt(s, cue) or 2.5
        ab = ease((lt-tb+0.4)/0.3)
        if ab > 0:
            pressed = lt > tb + 0.3
            kk = 1 - 0.08*math.sin(clamp((lt-tb-0.25)/0.3)*math.pi) if tb+0.25 < lt < tb+0.55 else 1
            bw, bh, by = 700*kk, 150*kk, 1420
            if VARIANT == "yt":
                colb = (70, 70, 70) if pressed else (222, 34, 40); lab = "ABUNƏ OLDUN" if pressed else "ABUNƏ OL"
            else:
                colb = (70, 70, 70) if pressed else (254, 44, 85); lab = "İZLƏYİRSƏN" if pressed else "İZLƏ"
            d.rounded_rectangle((W/2-bw/2, by-bh/2, W/2+bw/2, by+bh/2), int(bh/2), fill=colb + (int(255*ab),))
            d.text((W/2+30, by), lab, font=font("InterDisplay-Black.otf", int((70 if pressed else 84)*kk)), fill=(255, 255, 255, int(255*ab)), anchor="mm")
            if not pressed and VARIANT == "yt": paste_emo(img, "🔔", W/2-bw/2+80, by, 80, ab)
            if not pressed and VARIANT == "tt": d.text((W/2-bw/2+80, by), "+", font=font("InterDisplay-Black.otf", 90), fill=(255, 255, 255, int(255*ab)), anchor="mm")
            if pressed: d.line([(W/2-bw/2+58, by), (W/2-bw/2+78, by+22), (W/2-bw/2+112, by-22)], fill=(255, 255, 255, int(255*ab)), width=9)
            path = [(tb-0.4, 900, 1800), (tb+0.2, 620, 1440), (tb+0.45, 640, 1480), (dur, 950, 1900)]
            for p0, p1 in zip(path, path[1:]):
                if p0[0] <= lt <= p1[0]:
                    g = eio((lt-p0[0])/(p1[0]-p0[0])); hx = p0[1]+(p1[1]-p0[1])*g; hy = p0[2]+(p1[2]-p0[2])*g
                    e = EMO["👆"]; sz = 160*(0.88 if abs(lt-tb-0.3) < 0.1 else 1); scl = sz/e.height
                    him = e.resize((int(e.width*scl), int(e.height*scl)), Image.LANCZOS)
                    img.paste(him, (int(hx-him.width*0.36), int(hy-him.height*0.03)), him)
    # caption
    for c, t1 in s["caps"]:
        if c[0][0] - 0.03 <= t < t1:
            f_ = font("InterDisplay-Black.otf", 72); sp = d.textlength(" ", font=f_)
            ws = [(tw, w.upper(), d.textlength(w.upper(), font=f_)) for tw, w in c]
            tot = sum(x[2] for x in ws) + sp*(len(ws)-1)
            if tot > 960:
                f_ = font("InterDisplay-Black.otf", 56); sp = d.textlength(" ", font=f_)
                ws = [(tw, w, d.textlength(w, font=f_)) for tw, w, _ in ws]; tot = sum(x[2] for x in ws) + sp*(len(ws)-1)
            x = W/2 - tot/2; pop = back((t - c[0][0] + 0.03)/0.18)
            for tw, w, ww in ws:
                said = t >= tw - 0.02
                d.text((x, 1560 + (1-pop)*18), w, font=f_, fill=(YEL if said and t < tw + 0.45 else WHITE) + (255 if said else 130,),
                       anchor="lm", stroke_width=8, stroke_fill=(0, 0, 0, 255))
                x += ww + sp
            break
    d.text((W/2, 1188 + 16), "Xəritə: Natural Earth · 14 iqtisadi rayon (2021)", font=font("Inter-Medium.otf", 20), fill=(110, 120, 145), anchor="mm")
    if s is not SC[0] and lt < 0.12: d.rectangle((0, 0, W, H), fill=(255, 255, 255, int(70*(1-lt/0.12))))
    if t < 0.2: img = Image.blend(Image.new("RGB", img.size, BG), img, t/0.2)
    return img.tobytes()

if __name__ == "__main__":
    out = sys.argv[1]; only = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"[{VARIANT}] duration {DUR:.1f}s frames {NF}")
    json.dump(dict(scenes=[dict(key=s["key"], akey=s["akey"], t0=s["t0"], t1=s["t1"], vs=s["vs"]) for s in SC], dur=DUR, tempo=TEMPO), open(out + ".timeline.json", "w"))
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
