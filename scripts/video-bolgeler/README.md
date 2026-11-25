# Azərbaycanın bölgələri (YouTube Shorts, TikTok, Instagram Reels)

- `BOLGELER.md`: 14 iqtisadi rayon, nə ilə məşhurdur, faydalı qazıntılar, mənbələr.
- Video: 1080x1920, Speko "Adrian" (AI) dublajı, 1,08x. v1: ~88 san, `VARIANT=yt` ("abunə ol") və `VARIANT=tt` ("bizi izlə"). v2: ~109 san, `VARIANT=ig` (Instagram). Hazırkı `script.json`, `align.json` və kod v2-dir.
- `rg_prep.py`: Natural Earth admin-1 (78 vahid) → 14 iqtisadi rayon rastrı (`regid.npy`, `land.npy`, `meta.json`).
- `rg.py`: render (xəritədə rayon işıqlanır, kamera yaxınlaşır, emoji sancaqlar, məhsul/qazıntı çipləri, söz-söz caption).
- `rg_audio.py`: orijinal musiqi + ding/klik; `script.json` dublaj mətni, `align.json` söz vaxtları.
- `PAYLASIM.md`: Shorts, TikTok və Instagram üçün başlıq/təsvir/heşteqlər.
- `CHATGPT_YOXLAMA.md`: ChatGPT-yə veriləcək fakt yoxlama tapşırığı.

## v1 (YouTube Shorts + TikTok, 2026-11-24): məlum səhvlər
Bu fayllar yayımlanıb və dəyişdirilməyib.
- Xəritə: Natural Earth-də `AZE-1735` (Laçın) "Lankaran" adı ilə yazılıb. Videoda Laçın Lənkəran-Astara rəngində görünür, Lənkəran sancağı yanlış yerdədir, Şərqi Zəngəzur səhnəsində Laçın işıqlanmır.
- Əhatə: başlıqda 14 rayon deyilir, amma 11 kadr və 11 nöqtə var. Səsdə "Xızı" və "Şərqi Zəngəzur" adları keçmir.
- Buraxılanlar: Göyçay narı (mətndə var idi, videoda yoxdur), Qax, Bərdə, Xaçmaz, Goranboy gipsi, İmişli nefti, Kəlbəcər civəsi, Şamaxı turizmi.
- "Şəmkir alunit ehtiyatı ilə tanınır" ifadəsi şişirdilib: azerbaijan.az-a görə Şəmkirdə yalnız alunit təzahürləri var. "Mingəçevir ölkənin ən böyük su anbarı" ifadəsi rəsmi mənbə ilə yoxlanmayıb.

## v2 (Instagram Reels, `VARIANT=ig`, 2026-11-25)
- `rg_prep.py`: `OVR` ilə `AZE-1735` Laçın kimi Şərqi Zəngəzura aid edilir. Lənkəran sancağı dəqiq koordinatdadır (48.85, 38.75).
- Göstəricidə 14 nöqtə var, hər rayon bir nöqtədir. Səsdə 14 rayonun hamısının adı keçir. Girişdə "ən məşhur seçmələr" deyilir.
- Yeni və düzəldilmiş faktlar rəsmi mənbə ilə yoxlanıb (`BOLGELER.md`, "Mənbələr" bölməsi).
- Instagram təhlükəsiz zonası: altdakı ~420 px və sağdakı düymə sütunu boş qalır.
- Yoxlama: hər sancağın öz rayonunda olması və hər işarə sözünün tapılması skriptlə yoxlanıb. Bütün bölgələr bir parçadır; istisnalar Bakı adaları, Qazax anklavı və Abşeronun kiçik ayrıca hissəsidir (sonuncu məlumatdandır, ayrıca təsdiqlənməyib).
- Gözləyir: `CHATGPT_YOXLAMA.md` ilə ChatGPT yoxlaması (VIDEO-QA, 4-cü bənd).
- Gələcək videolar üçün qaydalar: `scripts/VIDEO-QA.md`.
