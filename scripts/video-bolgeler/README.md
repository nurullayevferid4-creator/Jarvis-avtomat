# Azərbaycanın bölgələri (YouTube Shorts + TikTok)

- `BOLGELER.md`: 14 iqtisadi rayon, nə ilə məşhurdur, faydalı qazıntılar, mənbələr.
- Video: 1080x1920, ~88 san, Speko "Adrian" (AI) dublajı, 1,08x. İki variant yalnız sonluqla fərqlənir: `VARIANT=yt` ("abunə ol") və `VARIANT=tt` ("bizi izlə").
- `rg_prep.py`: Natural Earth admin-1 (78 vahid) → 14 iqtisadi rayon rastrı (`regid.npy`, `land.npy`, `meta.json`).
- `rg.py`: render (xəritədə rayon işıqlanır, kamera yaxınlaşır, emoji sancaqlar, məhsul/qazıntı çipləri, söz-söz caption).
- `rg_audio.py`: orijinal musiqi + ding/klik; `script.json` dublaj mətni, `align.json` söz vaxtları.
- `PAYLASIM.md`: Shorts və TikTok üçün başlıq/təsvir/heşteqlər.
