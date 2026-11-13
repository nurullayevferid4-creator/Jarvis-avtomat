# Video studiya: montaj, SMM, dublaj, video reklam

Fərid videonu atır, studiya sual vermədən montaj edir, render edir, yoxlayır və hazır MP4 verir. Mühərrik `studio/` qovluğundadır: ffmpeg + yerli Whisper, pulsuzdur. Pul xərcləyən heç nə (səs/video generasiyası, bulud transkripsiyası) Fəridin açıq "bəli" sözü olmadan çağırılmır. Paylaşım da yalnız "bəli" ilə.

## Bir əmrlə

```
npm run studio -- setup-models                 # bir dəfə: Whisper turbo (≈ 564 MB), VAD, RNNoise
npm run studio -- auto video.mp4 --hook "Menyunu yenidən çap etdirirsən?" --cta "DM-də MENYU yaz"
```

`auto` bunları edir: yerli transkripsiya (şübhəli sözləri göstərir) → səssizlik kəsmə → danışıq təmizləmə → sözbəsöz altyazı → 9:16, 30 fps, −14 LUFS render → üz qabığı → 12 bəndlik QA. Sonda yazır: "Render olunub, PAYLAŞILMAYIB".

Digər əmrlər (`npm run studio -- help`):

```
analyze video.mp4                         # kəsim yerləri, LUFS, səssizliklər, kontakt vərəqi
transcribe video.mp4 --lang az            # yalnız transkript (.transcript.json)
edit video.mp4 --preset reels --cut-silence --transcript t.json --caption-style word --punch-in --clean-voice
batch video.mp4 --presets reels,feed,youtube --transcript t.json --outdir out
edit video.mp4 --dub dublaj.mp3 --music musiqi.mp3 --logo logo.png
qa out/video-reels.mp4 --retranscribe     # 12 bəndlik yoxlama, kəsilmiş videonun sinxronu da
motion studio/examples/kart-numune.html --duration 6 --audio ses.wav
thumb video.mp4 --auto
post-draft --video out/video-reels.mp4 --caption "mətn" --hashtags "a,b"
```

## Texniki standart (studiyaya yazılıb)

| Standart | Studiyada |
|---|---|
| 9:16, 1080×1920, 30 fps, H.264 + AAC | Preset `reels/tiktok/shorts`, `--fps` standart 30. Digərləri: `feed` 4:5, `square` 1:1, `youtube` 16:9 |
| Təhlükəsiz zona: yuxarı 250 px, aşağı 350 px, sağ 10% | Altyazı altdan 370 px, sağdan 108 px, hook yuxarıdan 270 px |
| Başlıq ≥ 100 px, etiket ≥ 26 px (1080 en) | Hook 100 px, sətir altyazı 54 px, sözbəsöz 78 px |
| Oxuma vaxtı: söz sayı/3 + 1 san | Hook və CTA müddəti buna görə uzanır; video qısadırsa xəbərdarlıq verir |
| Azərbaycan hərfləri və ₼ | Şrift avtomatik seçilir: hamısını bir ailədə verən ilk şrift (Inter, sonra DejaVu Sans). DejaVu Sans-da ₼ yoxdur |
| Səs ≈ −14 LUFS, true peak ≤ −1.5 dBFS | Ölç → gücləndir → lazımdırsa limiter → yenidən ölç. Pik hədəfi −2 dBFS (AAC-dən sonra pay) |
| Musiqi danışıqdan 10–15 dB aşağı | Musiqi səviyyəsi 0.12 + danışıq zamanı ducking |
| Standart musiqi qoyulmur; musiqi varsa səssiz versiya da | Musiqi yalnız `--music` ilə. Onda `-musiqisiz.mp4` nüsxəsi də yazılır |
| Altyazı uydurulmur | Transkript iki keçidlə tutuşdurulur, fərqli çıxan sözlər "ŞÜBHƏLİ" kimi göstərilir. `verified_by_human: false` |
| Bir səhnədə 1 effekt + 1 keçid | Studiya yalnız sərt kəsik və (istəyə görə) punch-in edir. Başqa keçid əlavə etmir |
| "render olunub, paylaşılmayıb" | Hər `auto` belə bitir. `post-draft` yalnız `draft_only` fayl yazır |

## Nə edir

| Bacarıq | Necə |
|---|---|
| Yerli transkripsiya | sherpa-onnx Whisper (`turbo`, `large-v3`, `medium`, `small`) + silero VAD. İki keçid (qısa və uzun parçalar) tutuşdurulur |
| Səssizlik kəsmə | `silencedetect` + `select`. Altyazı vaxtları kəsilmiş zaman xəttinə yenidən hesablanır, heç bir söz atılmır |
| Punch-in | `--punch-in`: kəsikdən sonrakı hər ikinci hissə 8% yaxınlaşdırılır (jump-cut ritmi) |
| Altyazı | `--caption-style line` (2 sətirlik) və ya `word` (2–3 sözlük qrup, cari söz sarı) |
| Danışıq təmizləmə | `--clean-voice`: highpass 80 Hz → RNNoise → EQ (220 Hz −2, 3.2 kHz +2.5) → gate → kompressor → limiter |
| Rəng | `--grade warm`: isti ton + yüngül dən (yazıdan əvvəl tətbiq olunur) |
| Hook, CTA, loqo | Təhlükəsiz zonada. Bir videoda bir CTA (studiya yalnız bir `--cta` qəbul edir) |
| Musiqi, dublaj miksi | Ducking ilə. Dublaj: hazır səs faylı + orijinal səs fonda və ya `--mute-original` |
| Analiz | `analyze`: kəsim yerləri (`scene > 0.25`), orta plan uzunluğu, LUFS, true peak, səssizliklər, kontakt vərəqi |
| Motion qrafika | `motion`: HTML/CSS/SVG səhifəsi Chromium ilə kadr-kadr çəkilir, ffmpeg ilə yığılır. Səhifə `window.seek(t)` verir. Nümunə: `studio/examples/kart-numune.html` |
| QA | Aşağıda |
| Məxfilik | `-map_metadata -1`: GPS və cihaz metadatası çıxışa düşmür |

Məhdudiyyət: səssizlik kəsmə + dublaj birlikdə rədd edilir (dublaj orijinal zaman xəttinə görə hazırlanıb). Əvvəl montaj, dublaj sonra.

## QA: 12 bənd

`qa` hər bəndə dörd haldan birini yazır: **KEÇDİ** (ölçülüb), **QALDI** (ölçülüb, uyğun deyil), **ƏL İLƏ** (göz və ya Fərid lazımdır, kadrlar çıxarılıb), **n/a**. Ölçülməyən bənd "keçdi" yazılmır. Bir bənd qalıbsa çıxış kodu 2.

| Kod | Studiya nəyi ölçür | Nə insana qalır |
|---|---|---|
| Q-1 Hook | İlk 2 san-də ekranda yazı və səs var | Yazı problemi/faydanı deyirmi (0.5/1/2 san kadrları) |
| Q-2 Yazı ölçüsü | Başlıq ≥ 100, altyazı ≥ 26 px | |
| Q-3 Oxuma vaxtı | Hook və CTA müddəti ≥ söz/3 + 1 | Danışıqla sinxron altyazı bu qaydaya daxil deyil |
| Q-4 Hərflər | Şrift bütün hərfləri dəstəkləyir | Kəsik kadrlara göz ilə baxış |
| Q-5 Faktlar | Qadağan söz (standart: "pulsuz") yoxdur | Qiymət və iddialar: yalnız Fərid |
| Q-6 Səs səviyyəsi | LUFS hədəf ±1, true peak ≤ −1.5 (`ebur128`) | |
| Q-7 Səs təmizliyi | Fasilələrdə orta səviyyə ≤ −50 dB | Nəfəs, klik, zərbə: dinləmə |
| Q-8 Sinxron | Hər altyazı nitq olan yerdə başlayır; `--retranscribe` ilə median fərq ≤ 0.3 san | |
| Q-9 Təhlükəsiz zona | Aşağı ≥ 15%, sağ ≥ 10%, yuxarı ≥ 250 px | |
| Q-10 Keçidlər | Saniyədə 1 kadrlıq vərəq çıxarılır | Titrəmə və keçid növü: göz |
| Q-11 Fayl | Ölçü, fps, kodeklər, müddət (`ffprobe`) | |
| Q-12 Təhvil | Video + `-thumb.jpg` + `.post.json` (`draft_only`) | |

Studiya render etdiyi hər faylın yanına `.studio.json` yazır (yazı ölçüləri, boşluqlar, altyazılar, hədəf səs). QA bunu oxuyur. Yan faylı olmayan (kənar) videoda Q-2, Q-3, Q-4, Q-8, Q-9 "n/a" olur.

## Bilik bazası bu repoda deyil

Fəridin üslub, brend və düzəliş sənədləri (`ferid-video-studio` qovluğu) **bu repoya yüklənməyib**: içində başqalarının istinad faylları və müştəri məlumatı var, bu repo isə açıqdır. Onların yeri gizli repodur. Bu repoda yalnız mühərrik kodu və ümumi texniki standartlar var.

## Xarici xidmətlər (araşdırma, 2026-11-13)

Mənbələr həmin sessiyada oxunan səhifələrdir. Satıcı bloqları öz məhsulunu qabağa çəkir, rəqəmləri "iddia" kimi oxu.

| Qat | Alət | Nə öyrəndim | Status |
|---|---|---|---|
| Səsdən mətn | sherpa-onnx Whisper (yerli) | Pulsuz, bu mühitdə işləyir | **yoxlanıb** (ingiliscə nitq). Azərbaycan dəqiqliyi **yoxlanmayıb** |
| Səsdən mətn | ElevenLabs Scribe v3/v2 | Rəsmi sənəddə Azərbaycan dili (aze) var | sənəddən təsdiqlənib, sınanmayıb, pulludur |
| Dublaj | HeyGen, Rask AI | 130–177+ dil, lip-sync (öz iddiaları) | Azərbaycan dəstəyi **təsdiqlənməyib** |
| Dublaj | ElevenLabs Dubbing | 90+ dil, lip-sync yoxdur (gyre.pro) | Azərbaycan **təsdiqlənməyib** |
| Dublaj / lip-sync | Pollo `translate_video` (qoşulub) | "100+ dil", siyahı verilmir, ≤ 8 dəq | Azərbaycan **təsdiqlənməyib**, kredit lazımdır |
| Reklam lokalizasiyası | Runway `localize_ad` (qoşulub) | Yalnız şəkil; Azərbaycan dili siyahıda yoxdur | Azərbaycan üçün yararsız |
| Generasiya | Runway, Pollo, Higgsfield (qoşulub) | Mətn/şəkildən video | Çağırılmayıb (kredit xərci) |
| Planlama | Metricool (qoşulub) | Planlı paylaşım | Çağırılmayıb, təsdiq qapısındadır |

## Yoxlanılıb / yoxlanılmayıb

- **Yoxlanılıb** (`tests/studio.test.mjs`, 39 test, real ffmpeg): ölçülər və 30 fps, səssizlik kəsmə və altyazı sinxronu, sözlərin itməməsi, sözbəsöz altyazı, təhlükəsiz zona, səs səviyyəsinin real ölçüsü (−14 ±1 LUFS, pik ≤ −1.5), musiqili + musiqisiz nüsxə, dublaj miksi, QA-nın səhvləri tutması (sakit səs, qadağan söz, qısa oxuma vaxtı, kənar fayl), analiz, HTML motion render, real ingiliscə nitqin transkripsiyası və ondan montaj. Kadrlar gözlə baxılıb: Azərbaycan hərfləri, ₼, hook, CTA, sözbəsöz vurğu, punch-in.
- **Yoxlanılmayıb:** real çəkiliş (üz, hərəkət, rotasiyalı telefon videosu), uzun video (10 dəq) performansı, **Azərbaycan nitqi ilə transkripsiya dəqiqliyi**, real səsdə RNNoise keyfiyyəti (dinləmə ilə), istənilən dublaj xidməti.
- **Təxminidir:** söz vaxtları. Model söz-söz vaxt vermir, sözlər qısa nitq parçası daxilində uzunluğuna görə paylanır. Sınaqda yenidən transkripsiya ilə median fərq 0.05 san, maksimum 0.22 san çıxdı (bir video, ingiliscə).
- **Yoxdur:** üzə görə avtomatik kadrlama (`crop` mərkəzdən kəsir; üz kənardadırsa `--fit blur`), keçid effektləri (whip pan, speed ramp, light sweep), SFX sintezi, avtomatik B-roll, lip-sync, səs/fon ayırma (UVR) və yerli TTS dublajı, ekran yazısının OCR-ı, hazır üslub şablonları (HUD, timeline split, Quran). Motion üçün yalnız ümumi render mühərriki və bir nümunə səhifə var.
