# Qız qalasının əsl sirri: Əfsanələr və tarixi sübutlar (YouTube)

16:9, 1920x1080, 30 fps, ~3:21. Dublaj: Speko, Soniox "Adrian" (AI), 1,04x. Musiqi orijinaldır (`qq_audio.py`: drone + hicaz ladında pluck, fəsil "boom", düymə klikləri). Yekun səs ≈ −14 LUFS, pik −1,2 dB.

Quruluş: giriş (iri "ABUNƏ OL" və "BƏYƏN" düymələri, 👆 barmaq basır) → başlıq kartı → sual → rəqəmlər (qala çertyoju) → I hissə: əfsanələr → II hissə: tarixi sübutlar (kitabə, zaman oxu, qazıntı/quyu kəsiyi, rəsədxana planı) → bu gün → nəticə + şərh/bəyən/abunə çağırışı → 5 san son ekran.

Fayllar: `script.json` (dublaj mətni), `align.py` → `align.json` (söz vaxtları, səs enerjisinə görə), `qq.py` (render), `qq_audio.py` (musiqi), `subtitrlər.srt`, `youtube.md` (başlıq, təsvir, fəsillər, mənbələr, teqlər).

## Faktlar (mənbə: Wikipedia "Maiden Tower (Baku)", 2026-11-22 oxundu)
- Hündürlük 29,5 m, oturacaq diametri 16,5 m, divar 5 m (aşağıda) → 3,2–4,2 m (yuxarıda), 8 mərtəbə.
- "20-yə yaxın əfsanə"; hökmdar–qız əfsanəsi (Wikipedia variantı: qızı sevmədiyi biri ilə evləndirmək istəyir); odlu saçlı qız əfsanəsi (atəşpərəstlik kökləri).
- 1940: Əfrasiyab Bədəlbəyli, "Qız qalası" — ilk Azərbaycan baleti.
- Cənub divarında ~14 m hündürlükdə küfi kitabə, "Məsud ibn Davud", XII əsr; memar olduğu açıq yazılmayıb (mübahisəlidir).
- D. Axundov: od məbədi, e.ə. VIII–VII əsr; S. Aşurbəyli: özül və aşağı 3 mərtəbə IV–VI əsr.
- 1962–63 qazıntıları: dənizə doğru maili qaya; 2-ci mərtəbədə 21 m dərinlikdə, 0,7 m diametrli quyu; saxsı borular.
- Rəsədxana fərziyyəsi: çıxıntı şərqə baxır (sübut olunmayıb).
- UNESCO 2000 (Walled City of Baku with the Shirvanshah's Palace and Maiden Tower); 10 manatlıq əskinas (2006-dan).
- "Böyük hissəsi XII əsrə aiddir" ümumi qəbul olunan fikir kimi Wikipedia-da qeyd olunur.

Fotolar Wikimedia Commons-dan (müəlliflər və lisenziyalar `youtube.md`-də və videoda hər fotonun altında). Commons birbaşa yüklənmədiyi üçün şəkillər media görüntüləyicinin skrinşotundan kəsilib (~950–1900 px).

## İngiliscə versiya və Short (`en/`)
- `en/qq_en.py`: eyni video, bütün ekran yazıları ingiliscə; `en/script.json` dublaj mətni, `en/align.json` söz vaxtları, `en/qq_audio_en.py` musiqi/kliklər. ~3:36.
- `en/short.py`: YouTube Shorts, 1080x1920, ~51 san, ingiliscə (`en/short.json`, `en/salign.json`, `en/short_audio.py`). Hook → əfsanələr → tarix → quyu/şərq → nəticə + abunə düyməsi.
- `en/youtube_en.md`: ingiliscə başlıq, təsvir, fəsillər, Short təsviri.
- İşə salmaq: `QQ_ALIGN=en/align.json python3 en/qq_en.py out.mp4`, `QQ_ALIGN=en/salign.json python3 en/short.py short.mp4` (img/ qovluğu QQ_WORK-da).
