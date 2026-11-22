# Dünya okeanları (geri sayım tərzi)

9:16, 1080x1920, 30 fps, 68,2 san. Dublaj: Speko, Soniox "Adrian" səsi (AI), 1,07x sürət. Subtitr və animasiyalar STT söz vaxtlarına bağlıdır (`oc_words.py`).

Tərz (Xəzər videosundan fərqli): açıq krem "editorial" fon, dönən 3D qlobus (ortoqrafik proyeksiya), okeanlar 5-dən 1-ə geri sayımla rənglənir, yuxarıda sıra çipləri, aşağıda artan bar qrafiki, ağ qutuda karaoke subtitr, səhnə keçidində rəngli "wipe". Musiqi orijinaldır (100 BPM pluck, kodla sintez), yer elanında "ding".

## Mətn
1. Planetimizin 71 faizini su örtür. Amma bu su əslində tək bir nəhəng okeandır.
2. Alimlər bu okeanı beş hissəyə bölür. Gəl, ən kiçikdən ən böyüyə sayaq.
3. Beşinci yer: Şimal Buzlu okeanı. Təxminən 15,5 milyon kvadrat kilometr. Okeanların ən kiçiyi budur.
4. Dördüncü yer: Cənub okeanı. Antarktidanı dövrəyə alır, sahəsi təxminən 22 milyon kvadrat kilometrdir. Ən yeni adlandırılan okean da budur.
5. Üçüncü yer: Hind okeanı. Afrika, Asiya və Avstraliya arasında yerləşir. Sahəsi 70 milyon kvadrat kilometrdən çoxdur.
6. İkinci yer: Atlantik okeanı. Avropa və Afrikanı Amerikadan ayırır. Təxminən 85 milyon kvadrat kilometr.
7. Və birinci yer: Sakit okean. Təxminən 169 milyon kvadrat kilometr! Bu, planetdəki bütün qurudan da böyükdür.
8. Dünyanın ən dərin nöqtəsi də burdadır: Mariana çökəkliyi, təxminən 11 km. Everesti ora qoysan, zirvəsi suyun altında qalar.
9. Sən hansı okeanı görmüsən? Şərhdə yaz, növbəti videonu onun haqqında hazırlayaq.

## Faktlar və mənbə (2026-11-22 oxundu)
- Britannica "Ocean": okeanlar səthin ~71%-i; sahələr (Eakins & Sharman 2010, NOAA ETOPO1): Sakit 168,723; Atlantik 85,133; Hind 70,560; Cənub 21,960 (60° c.e.-dan cənub); Şimal Buzlu 15,558 mln km². Mariana çökəkliyi 11 034 m, Everest 8 850 m. Quru səthin 29,2%-i.
- "Bütün qurudan böyük": 510 mln km² × 29,2% ≈ 149 mln km² < 168,7.
- NOAA "How many oceans are there?": əslində bir qlobal okean var; Cənub okeanı "ən yeni adlandırılan" okeandır, sərhədi 60° c.e.; IHO hələ ratifikasiya etməyib (ona görə "təsdiqlənən" yox, "adlandırılan" deyilir).
- Qeyd: Mariana dərinliyi mənbəyə görə 10 935–11 034 m arası verilir, ona görə "təxminən 11 km" deyilir. Everest 8,85 km olduğu üçün zirvənin üstündə ~2 km su qalır.

Xəritə: Natural Earth 50m (quru, dəniz poliqonları); okean sərhədləri dəniz adlarına görə qruplaşdırılıb, Cənub okeanı 60° c.e. ilə kəsilib (`oc_prep.py`).

## Qurmaq
```
python3 oc_prep.py <natural_earth_qovluğu> <iş_qovluğu>     # land.geojson, marine.geojson (ne_50m)
OC_WORK=<iş_qovluğu> python3 oceans.py out.mp4
python3 oc_audio.py out.mp4.timeline.json bed.wav
# səs: Speko klipləri atempo=1.07 ilə hər səhnənin "vs" vaxtına; musiqi sidechain ilə səsin altında
```
