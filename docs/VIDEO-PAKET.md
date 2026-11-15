# Video paketi v1

CLAUDE AI VIDEO STUDIO videonu hazırlayır, Instapilot AI (və ya JARVIS) paylaşır. Aralarındakı yeganə əlaqə bu paketdir. Kod: `src/media/videoPackage.js`, alət: `scripts/video-paket.mjs`, testlər: `tests/video-package.test.mjs`.

```
VIDEO STUDIO                         INSTAPILOT AI                         
ssenari → storyboard → Fərid OK      paketi yoxla → Fərid-ə göstər
→ render → QA → VIDEO PAKETİ ──────► "bəli" → tesdiqle → paylaş → netice
        ▲                                                  │
        └──────── meta.json (linklər, nəticə) geri ────────┘
JARVIS: eyni paket → `jarvis` əmri → POST /api/social/draft (JARVIS öz təsdiqini ayrıca istəyir)
```

## Paketin tərkibi

Bir qovluq (və ya onun `.zip`-i), adı `package_id`:

| Fayl | Nə |
|---|---|
| `video.mp4` | hazır video (9:16, H.264 + AAC tövsiyə olunur) |
| `caption.txt` | paylaşım mətni, olduğu kimi |
| `meta.json` | hədəflər, QA, status, təsdiq, nəticələr |

## meta.json

```json
{
  "version": 1,
  "package_id": "2026-11-16-qr-menyu",
  "source": "claude-ai-video-studio",
  "video_sha256": "<video.mp4-ün sha256-sı>",
  "caption_sha256": "<caption.txt-in sha256-sı>",
  "targets": [
    { "platform": "tiktok", "account": "@_weemenu_baku" },
    { "platform": "instagram", "account": "@_weemenu_baku" }
  ],
  "privacy": "private",
  "title": "",
  "description": "",
  "hashtags": ["qrmenyu", "baku"],
  "schedule_at": "2026-11-16T19:00:00+04:00",
  "made_for_kids": false,
  "ai_generated": false,
  "qa": {
    "hook_first_3s": true, "subtitles_az_checked": true, "one_message_one_cta": true,
    "licenses_ok": true, "no_foreign_brand": true, "audio_peak_ok": true, "watched_on_phone": true
  },
  "status": "pending_approval",
  "results": []
}
```

- `platform`: `instagram | tiktok | youtube | telegram`. Hər platforma bir dəfə. `account` `@ad` şəklində (Telegram üçün kanal adı). Hesab adı məcburidir ki, `@_weemenu_baku` ilə `@weecardglobal` qarışmasın.
- `privacy`: standart `private`. `public` yalnız Fərid açıq deyəndə. TikTok tətbiqi audit olunmayıbsa public paylaşım bloklanır (`SOCIAL.md`).
- `qa`: Video Studio-nun yayımdan əvvəlki yoxlaması. Hər bənd yalnız real yoxlanıbsa `true` yazılır. Biri `false`-dursa paket bloklanır.
- `schedule_at`: istəyə bağlı, saat qurşağı ilə. Alət planlamır, yalnız Fərid-ə göstərilir.
- `hashtags`: `#` olmadan. 8-dən çox olsa xəbərdarlıq (Fərid qaydası 5-8).
- YouTube hədəfi varsa `title` məcburidir.

## Status

| Status | Mənası | Kim qoyur |
|---|---|---|
| `pending_approval` | QA keçib, Fərid-in "bəli"si gözlənilir | Video Studio (`yarat`) |
| `approved` | Fərid söhbətdə açıq "bəli" yazıb | Instapilot (`tesdiqle`) |
| `partial` | bəzi platformaların nəticəsi yazılıb | `netice` |
| `published` | bütün hədəflər link/post_id ilə paylaşılıb | `netice` |
| `failed` | bütün hədəflər alınmayıb | `netice` |

## Qaydalar (testlərlə yoxlanır)

1. **Təsdiq məzmuna bağlıdır.** `approval.content_hash` = video hash + caption hash + hədəflər + privacy + başlıq + hashtag + vaxt. Təsdiqdən sonra bunlardan biri dəyişərsə paket bloklanır və yenidən təsdiq lazımdır.
2. **Fayl dəyişərsə bloklanır.** `video.mp4` və ya `caption.txt` meta-dakı hash-lə uyğun gəlməsə paket keçmir.
3. **Linksiz "paylaşıldı" yoxdur.** `published` nəticəsi yalnız link və ya `post_id` ilə yazılır.
4. **Avtomatik təkrar yoxdur.** `failed` və `unknown` olan platforma yenidən "hazır" siyahısına düşmür. Təkrar cəhd Fərid-in qərarıdır.
5. Video oxunmursa (MP4 deyil, yarımçıq, video treki yoxdur) paket bloklanır. Platforma uyğunluğu `src/media/rules.js` ilə yoxlanır (müddət və nisbət həddləri yoxlanmamış tövsiyədir, 64 MB sərtdir).

## Alət

Node 20+ lazımdır, asılılıq yoxdur, şəbəkəyə çıxmır, heç nə paylaşmır.

```
node scripts/video-paket.mjs yarat    <qovluq> --hedef tiktok:@_weemenu_baku,instagram:@_weemenu_baku --paket-id 2026-11-16-qr-menyu --hashtag qrmenyu,baku --qa-kecdi hamisi
node scripts/video-paket.mjs yoxla    <qovluq> [--json]
node scripts/video-paket.mjs tesdiqle <qovluq> --kim "Fərid"
node scripts/video-paket.mjs netice   <qovluq> --platforma tiktok --status published --link https://...
node scripts/video-paket.mjs jarvis   <qovluq> --media-id <24 hex>
```

Çıxış kodu: `0` uğur, `1` istifadə xətası, `2` paketdə bloklayıcı. `yoxla`-nın son sətri `PAYLAŞIMA HAZIR: bəli → <platformalar>` və ya `xeyr (<səbəb>)`.

## Yoxlanılıb / yoxlanılmayıb

- Yoxlanılıb: `tests/video-package.test.mjs` (meta, hash, təsdiq, nəticə, JARVIS qaralaması, CLI tam dövrü, real ffmpeg videosu).
- Yoxlanılmayıb: Instapilot AI-nın paylaşım kodu ilə real hesabda paylaşım. O kod bu repo-da deyil.
