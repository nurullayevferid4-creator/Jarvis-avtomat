# Video iş axını və emal xidməti

## Axın

```
YÜKLƏ (/api/media, axınla R2-yə) → YOXLA (real növ, ölçü, MP4 qutuları) → ANALİZ (ölçü, müddət, kodek, tərəflər)
→ REDAKTƏ PLANI (platforma qaydaları ilə müqayisə) → EMAL (xarici ffmpeg xidməti) → NƏTİCƏNİ YOXLA (yenidən analiz)
→ SAXLA (törəmə fayl, 14 gün) → QAYTAR
```

- **Cloudflare Worker ffmpeg işlədə bilmir.** Kəsmə, 9:16-ya çevirmə, H.264/AAC, faststart `scripts/video-processor/server.mjs` xidmətində edilir.
- Xidmət qoşulmayıbsa və redaktə **lazımdırsa**, iş `FAILED` olur, «emal xidməti qoşulmayıb» səbəbi və hazır plan göstərilir (retry mümkündür). Heç vaxt «video hazırdır» deyilmir. Redaktə **lazım deyilsə** (fayl artıq platforma qaydalarına uyğundur), orijinal fayl emalsız istifadə olunur və bu işdə göstərilir.
- Emaldan sonra nəticə yenidən analiz olunur; platforma qaydalarına uyğun gəlmirsə iş `failed` olur (saxta uğur yoxdur).
- Platforma müddət/tərəflər nisbəti qaydaları **rəsmi sənədlə təsdiqlənməmiş tövsiyələrdir** (`src/media/rules.js`); ölçü və MIME hədləri (64 MB və s.) sərtdir.
- Silmək yalnız təsdiqlə (`media.delete`). Törəmə fayllar 14 gün sonra silinir.

## Xidməti işə salmaq (Linux server/VPS)

Node 20+ və `ffmpeg` lazımdır. Windows 7-də işləmir.

```
VIDEO_PROCESSOR_TOKEN=<uzun təsadüfi mətn> PORT=8787 node scripts/video-processor/server.mjs
```

Xidmətin qarşısına HTTPS qoy (məs. Caddy/nginx və ya Cloudflare Tunnel). Worker yalnız `https://` ünvana qoşulur.

Sonra Cloudflare-də: `VIDEO_PROCESSOR_URL` (Variable, `https://...`) və `VIDEO_PROCESSOR_TOKEN` (Secret, serverdəkilə **eyni**).

Təhlükəsizlik: Bearer token məcburi; giriş ünvanı yalnız https və ictimai IP; ffmpeg shell olmadan, yalnız icazəli əməliyyatlardan qurulan arqumentlərlə; giriş/çıxış ölçü və vaxt limiti; müvəqqəti fayllar iş bitəndə silinir.

Protokol: `POST /jobs {input_url, ops}`, `GET /jobs/{id}`, `GET /jobs/{id}/output` (hamısı Bearer ilə). `ops`: `trim, reframe, transcode, transcode_audio, remux, faststart`.

## Yoxlanılıb / yoxlanılmayıb

- Yoxlanılıb: Worker tərəfi (testlər), ffmpeg istinad xidməti real ffmpeg ilə real fayllarda (`tests/media.test.mjs`).
- Yoxlanılmayıb: sənin serverində deploy olunmuş xidmət ilə Cloudflare arasında real HTTPS əlaqə. Bunun üçün `docs/SMOKE.md`.
