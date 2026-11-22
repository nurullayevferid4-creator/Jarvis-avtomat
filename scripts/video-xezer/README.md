# Xəzər: dəniz, yoxsa göl? (coğrafi fakt videosu)

9:16, 1080x1920, 30 fps, 61,7 san. Xəritə animasiyası, sözbəsöz subtitr, sonda şərh CTA-sı.
Kür çayı videosunun tərzindən ilhamlanıb: tünd relyef xəritə, xətt animasiyası, iri başlıq.
Mövzu, mətn, rəng və dizayn ayrıdır. Heç nə kopyalanmayıb.

## Mətn (ekranda və diktor üçün)

| Vaxt | Başlıq | Mətn |
|---|---|---|
| 0,0–4,4 | XƏZƏR: DƏNİZ, YOXSA GÖL? | Xəzərə hamı dəniz deyir. Bəs əslində o, nədir? |
| 4,4–11,1 | QAPALI HÖVZƏ | Xəzərin okeana təbii çıxışı yoxdur. Bu, dünyanın ən böyük qapalı su hövzəsidir. |
| 11,1–20,3 | NƏHƏNG SU GÜZGÜSÜ | Sahəsi təxminən 386 min kvadrat kilometrdir. Bu, Yaponiyadan da böyükdür. Şimaldan cənuba uzunluğu 1200 km-ə yaxındır. |
| 20,3–27,4 | OKEANDAN AŞAĞIDA | Səthi okean səviyyəsindən təxminən 27 metr aşağıdadır. Bu səviyyə illər boyu dəyişir. |
| 27,4–35,0 | ŞİMAL DAYAZ, CƏNUB DƏRİN | Şimal hissə çox dayazdır: orta dərinlik cəmi 4–8 metr. Cənubda isə dərinlik 1025 metrə çatır. |
| 35,0–45,2 | NƏ ŞİRİN, NƏ OKEAN | Suyu okeandan təxminən üç dəfə az duzludur. Volqa mənsəbində su demək olar ki, şirindir, Qarabağazgöldə isə həddən artıq duzlu. |
| 45,2–53,2 | BEŞ ÖLKƏ, BİR HÖVZƏ | Sahilində beş ölkə var. 2018-ci ildə Aktauda imzalanan konvensiya Xəzərə xüsusi hüquqi status verdi. |
| 53,2–61,7 | ADI DƏNİZ, ÖZÜ GÖL | Coğrafiyaçılar onu çox vaxt dünyanın ən böyük gölü sayır. Son kadr: "Sənin cavabın? DƏNİZ / GÖL. Şərhdə yaz" |

Vaxtlı subtitr: `subtitrlər.srt`.

## Faktlar və mənbə

Britannica, "Caspian Sea" məqaləsi (2026-11-22 oxundu):
- dünyanın ən böyük daxili su hövzəsi;
- sahə təxminən 386 400 km², "Yaponiyadan böyük";
- şimaldan cənuba təxminən 1200 km;
- səthi dəniz səviyyəsindən təxminən 27 m aşağı, səviyyə iqlimə görə dəyişir (1977-də −29 m);
- maksimal dərinlik cənubda 1025 m, şimal hissənin orta dərinliyi 4–8 m;
- orta duzluluq təxminən 12,8‰, Volqa mənsəbi yanında 1‰, Qarabağazgöldə 200‰-ə qədər.

Okean suyunun duzluluğu təxminən 35‰ (ümumi məlumat), buna görə "təxminən üç dəfə az" yazılıb.
2018-ci il Aktau konvensiyası (Xəzərin hüquqi statusu haqqında konvensiya) beş sahilyanı dövlət tərəfindən imzalanıb.
Ayrıca yoxlanmalı: "Coğrafiyaçılar çox vaxt ən böyük göl sayır" ifadəsi geniş yayılmış təsnifatdır, amma Britannica məqaləsindən birbaşa sitat deyil.

Xəritə: Natural Earth (sahil, çaylar, sərhədlər, ictimai mülkiyyət), Mapzen/AWS Terrain Tiles (relyef və batimetriya). Dərinlik profili real batimetriyadan, 50,6° şərq uzunluğu boyunca götürülüb.

## Səs

Fon səsi kodla sintez olunub (`audio.py`), lisenziya problemi yoxdur. Ortalama −20 dB, pik −6 dB.
Diktor səsi yoxdur: bu mühitdə Azərbaycan dilli TTS əlçatan deyildi. Səs yazmaq istəsən, yuxarıdakı mətni vaxtlarla oxu, ffmpeg ilə üstünə qoyulacaq.

## Yenidən qurmaq

```
W=iş_qovluğu; mkdir -p $W/{data,tiles,t5,build}
# data/: Natural Earth geojson (ne_10m_land, ne_10m_admin_0_countries, ne_10m_rivers_lake_centerlines)
python3 fetch.py $W/tiles                 # z7 relyef plitələri
# t5/: z5 plitələr x 19-21, y 10-13 (batimetriya)
python3 base.py $W/build $W               # relyef + quru maskası (geo.py $W/build-də olmalıdır)
python3 prep.py $W                        # vec.json, depth.npy, su rəngi
XEZER_WORK=$W/build python3 render.py $W/out.mp4
python3 audio.py $W/out.mp4.scenes.json $W/bed.wav
ffmpeg -i $W/out.mp4 -i $W/bed.wav -filter_complex "[1]loudnorm=I=-18:TP=-1.5[a]" -map 0:v -map "[a]" -c:v copy -c:a aac final.mp4
```
