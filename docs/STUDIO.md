# Video studiya: montaj, SMM, dublaj, video reklam

Fərid videonu atır, studiya montaj edir. Mühərrik `studio/` qovluğundadır (ffmpeg, yerli, pulsuz). Ağır AI hissələri (səsdən mətn, dublaj, generasiya) ayrı xidmətlərdir: pul xərcləyir, ona görə Fərid-in təsdiqi ilə işləyir.

## Tez başlanğıc

```
npm run studio -- doctor
npm run studio -- edit video.mp4 --preset reels --cut-silence --transcript t.json --hook "Qaçırma" --cta "DM yaz" --out reels.mp4
npm run studio -- batch video.mp4 --presets reels,feed,youtube --transcript t.json --outdir out
npm run studio -- edit video.mp4 --dub dublaj.mp3 --music musiqi.mp3 --logo logo.png
npm run studio -- srt t.json --out t.srt
npm run studio -- thumb video.mp4 --auto
npm run studio -- post-draft --video reels.mp4 --caption "mətn" --hashtags "a,b"
```

Hamısı: `npm run studio -- help`. `--dry-run` ffmpeg əmrini göstərir, fayl yaratmır.

## Nə edir

| Bacarıq | Necə |
|---|---|
| 9:16 / 4:5 / 1:1 / 16:9 | Presetlər: `reels tiktok shorts feed square youtube`. Uyğunsuz nisbətdə bulanıq fon (kəsmir), istəsən `--fit crop|pad` |
| Səssizlik kəsmə | `silencedetect` + `select`. Subtitr vaxtları kəsilmiş zaman xəttinə **yenidən hesablanır** (sinxron qalır) |
| Subtitr | Transkriptdən (`words[]` və ya `segments[]/utterances[]`) və ya hazır `.srt`-dən. DejaVu Sans: ə ş ç ğ ı ö ü düzgün çıxır. 9:16-da altdan 370 px yuxarı |
| Hook və CTA | İlk saniyələrdə yuxarıda, sonda aşağıda. 9:16 təhlükəsiz zona: yuxarıdan 250, aşağıdan 350 px |
| Loqo | Sağ yuxarı, təhlükəsiz zonadan aşağıda |
| Musiqi | Döngüyə salınır, danışıq zamanı avtomatik aşağı düşür (ducking), sonda 1.5 san sönür |
| Dublaj miksi | Hazır dublaj səsi + orijinal səs aşağı salınmış fon (və ya `--mute-original`). Dublaj danışarkən fon əlavə sıxılır |
| Səs səviyyəsi | 2 keçidli `loudnorm`, standart −14 LUFS (`--lufs`, `--no-loudnorm`) |
| Çoxplatformalı export | `batch`: bir mənbədən hamısı, transkript/silence bir dəfə hesablanır |
| Thumbnail | `--at 2` və ya `--auto` (ilk 20 saniyədən ən təmsiledici kadr) |
| SMM qaralaması | `post-draft`: `draft_only` JSON, hashtag təmizlənir. **Heç nə göndərmir** |
| Yoxlama | Hər render-dən sonra nəticə `ffprobe` ilə yoxlanır: ölçü, h264/aac, müddət, fps. Uyğun gəlməsə çıxış kodu 2 |
| Məxfilik | `-map_metadata -1`: GPS və cihaz metadatası çıxışa düşmür |

Məhdudiyyət: səssizlik kəsmə + dublaj birlikdə **rədd edilir** (dublaj orijinal zaman xəttinə görə hazırlanıb). Əvvəl montaj, dublaj sonra.

## Araşdırma: bu tip studiya nədən qurulur

Mənbələr bu sessiyada oxunan səhifələrdir. Satıcı bloqları öz məhsulunu qabağa çəkir, ona görə rəqəmləri "iddia" kimi oxu.

| Qat | Alət | Nə öyrəndim | Status |
|---|---|---|---|
| Montaj mühərriki | ffmpeg | Bu mühitdə var (6.1.1), bütün lazım olan filtrlər işləyir | **yoxlanıb** |
| Montaj (əl ilə) | CapCut, Descript, DaVinci Resolve, Premiere | CapCut: avto-subtitr, şablonlar; API/skript yoxdur. Descript: mətn üzrə redaktə. Opus Clip: uzun videodan qısa klip, dəqiqə-kredit sistemi | mənbə: ventureharbour.com, rework.com. Yoxlanmayıb |
| Səsdən mətn (Azərbaycan) | ElevenLabs Scribe v3/v2 | Rəsmi sənəddə 90+ dil, **Azərbaycan dili (aze) siyahıdadır** | **sənəddən təsdiqlənib**, real səs ilə sınanmayıb |
| Səsdən mətn | OpenAI Whisper | Azərbaycan dili rəsmən dəstəklənir, amma Whisper məqaləsində kiçik modellərdə xəta dərəcəsi yüksəkdir; rəqib Soniox "xeyli yüksək xəta" deyir (satıcı iddiası) | Azərbaycan keyfiyyəti **yoxlanmayıb**. Bu sessiyada Whisper quraşdırılmayıb |
| Dublaj | HeyGen | 177+ dil, lip-sync, səs klonlaması (öz bloqu) | Azərbaycan dəstəyi **təsdiqlənməyib** |
| Dublaj | Rask AI | 130+ dil, çox danışanlı (üçüncü tərəf icmalları) | Azərbaycan **təsdiqlənməyib** |
| Dublaj | ElevenLabs Dubbing | 2026-cı ilin mayında 90+ dilə genişlənib, lip-sync yoxdur (gyre.pro) | Azərbaycan TTS **təsdiqlənməyib**: `eleven_multilingual_v2` siyahısında yoxdur, v3/v4 üçün dil siyahısı açılmayıb |
| Dublaj / lip-sync | Pollo `translate_video` (bu sessiyada qoşulub) | "100+ dil", siyahı verilmir; mp4/mov, ≤ 8 dəq, saniyəyə görə ödəniş | Azərbaycan **təsdiqlənməyib**. Sınaq üçün qısa klip lazımdır |
| Reklam lokalizasiyası | Runway `localize_ad` (qoşulub) | Yalnız **şəkil**, video yox; dil siyahısında Azərbaycan yoxdur | Azərbaycan üçün yararsız |
| Generasiya (B-roll, reklam kadrı) | Runway, Pollo, Higgsfield (qoşulub) | Mətn/şəkildən video, musiqi, səs | Heç biri çağırılmayıb (kredit xərci) |
| Planlama | Metricool (qoşulub) | Planlı paylaşım, ən yaxşı vaxt | Çağırılmayıb. Paylaşım təsdiq qapısındadır |

**Nəticə:** Azərbaycan dilində dublaj ən zəif halqadır. Subtitr üçün Scribe uyğundur (təsdiqlənib). Dublajda Azərbaycan səsi üçün heç bir xidmətin dəstəyini təsdiqləyə bilmədim. Əvvəl 10-15 saniyəlik sınaq klipi ilə yoxlamaq lazımdır, yoxsa boş yerə pul gedər.

## Axın (Fərid videonu atdıqdan sonra)

1. `probe` + `doctor`: fayl və mühit yoxlanır.
2. Subtitr lazımdırsa: Scribe ilə transkript (**pul xərcidir, təsdiq lazımdır**). Transkripti insan oxumalıdır: Azərbaycan dilində səhv ola bilər.
3. `edit`/`batch`: montaj, hər platforma üçün fayl, avtomatik yoxlama.
4. Kadrlara baxıb yoxlama (subtitr hərfləri, hook, təhlükəsiz zona).
5. `post-draft`: qaralama. Fərid "təsdiq" yazmadan heç nə paylaşılmır.

## Format qeydləri

- Scribe cavab formatı (`words[]`: `text,start,end,type`) sənədə görə dəstəklənir, **real Scribe cavabı ilə sınanmayıb**. Pollo `speech2text` (`utterances[]` ms ilə) eyni şəkildə.
- Platforma müddət həddləri `src/media/rules.js`-dən gəlir və **rəsmi sənədlə təsdiqlənməyib**. Studiya bunlara görə yalnız xəbərdarlıq verir, videonu özbaşına kəsmir (`--max-sec` istisna).
- −14 LUFS ümumi tövsiyədir, platformalar üçün ayrıca yoxlanmayıb.

## Yoxlanılıb / yoxlanılmayıb

- Yoxlanılıb: `tests/studio.test.mjs` (23 test): sintetik video ilə real ffmpeg. Ölçü 1080x1920 / 1080x1350 / 1920x1080, h264/aac, səssizlik kəsmədən sonra subtitr sinxronu, kəsilmiş videoda səssiz pəncərə yoxdur, dublajın yerləşməsi və orijinal səsin söndürülməsi, musiqi/dublaj miksi, səssiz mənbə, dry-run. Bir render kadrı gözlə baxılıb (Azərbaycan hərfləri, hook, CTA, bulanıq fon).
- Yoxlanılmayıb: real çəkiliş (üz, hərəkət, rotasiya olan telefon videosu), uzun video performansı, Azərbaycan nitqi ilə Scribe, istənilən dublaj xidməti, Metricool ilə planlama.
- Yoxdur: üzə görə avtomatik kadrlama (`crop` mərkəzdən kəsir; üz sağ/solda olarsa `--fit blur` istifadə et), keçid effektləri, avtomatik B-roll, lip-sync, söz-söz vurğulu subtitr.
