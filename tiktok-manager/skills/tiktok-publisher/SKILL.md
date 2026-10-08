---
name: tiktok-publisher
description: Hazır video paketini yoxlayır, TikTok paylaşım qaydalarına uyğunlaşdırır, DRAFT→REVIEW approval yaradır və yalnız sahibin təsdiqi + execute_enabled ilə rəsmi Content Posting API-dən paylaşır; əks halda manual paket verir.
---

# TikTok Publisher

## Rəsmi API (Content Posting API)
| Addım | Endpoint | Scope | Limit |
|---|---|---|---|
| Creator info | `POST /v2/post/publish/creator_info/query/` | video.publish | 20/dəq |
| Direct Post init | `POST /v2/post/publish/video/init/` | video.publish | 6/dəq |
| Inbox (qaralama) init | `POST /v2/post/publish/inbox/video/init/` | video.upload | 6/dəq |
| Yükləmə | `PUT upload_url` (1 saat), chunk 5–64 MB, ≤1000 | — | — |
| Status | `POST /v2/post/publish/status/fetch/` | video.publish/upload | 30/dəq |

**Məhdudiyyət:** audit olunmamış app-in paylaşımları yalnız `SELF_ONLY` (private). İctimai paylaşım üçün TikTok audit-i lazımdır (`TIKTOK_APP_AUDITED=true` yalnız audit-dən sonra).

## Paket (package.json)
`hook, script, scenes, voiceover, caption, hashtags, cta, [ad], publish{ privacy_level, allow_comment, allow_duet, allow_stitch, commercial_content, brand_organic, brand_content, is_aigc, cover_timestamp_ms }`

## Axın
1. `validate-package --file package.json` → xəta varsa düzəlt.
2. `publish` ayarları: **privacy-ni sahib seçir** (default yoxdur); şərh/duet/stitch açıq seçim; kommersiya açıqlaması.
3. `prepare --package package.json --video video.mp4 [--mode inbox]` → manual paket (`pkg_*.md`) + approval (REVIEW).
4. Sahibə önizləmə göstər: hesab adı (creator nickname), caption, privacy, toggles, video. Soruş: "Təsdiq edirsən?"
5. Yalnız sahib açıq "təsdiq" yazandan sonra: `approve <id> --by <sahib>`.
6. `execute <id>` — `execute_enabled=false` isə icra bloklanır və manual paket istifadə olunur.
7. Nəticə: `publish_id`, status (`PUBLISH_COMPLETE` / `SEND_TO_USER_INBOX` / `FAILED`). FAILED → avtomatik təkrar yoxdur, səbəbi sahibə de.
8. Paylaşılan videonun id-si ilə `tiktok-analytics` izləməyə başlayır.

## API olmayanda
`UNSUPPORTED_BY_TIKTOK_API` və ya qoşulmamış hesab → `pkg_*.md` manual paket: caption kopyala, ayarlar, addımlar.

## Qadağa
Təsdiqsiz paylaşım, eyni videonu spam kimi təkrar paylaşmaq, sahibin xəbəri olmadan paylaşım.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
