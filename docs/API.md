# HTTP API

Bütün `/api/*` yolları parol tələb edir: başlıq `x-passcode-b64: <parolun UTF-8 Base64-ü>` (köhnə `x-passcode` yalnız Latin-1 parol üçün). Səhv: `401`; çox səhv cəhd: `429`. Xəta cavabı: `{ error: KOD, message }` (stack, token, URL çıxmır). Kodlar: `AUTH_ERROR, PERMISSION_ERROR, RATE_LIMIT, VALIDATION_ERROR, NETWORK_ERROR, TIMEOUT, PROVIDER_ERROR, NOT_FOUND, CONFLICT, SECURITY_ERROR, APPROVAL_REQUIRED, INTERNAL_ERROR`.

## İctimai (parolsuz, hər biri öz üsulu ilə qorunur)

| Metod, yol | Qoruma |
|---|---|
| `GET /` | UI səhifəsi (CSP nonce) |
| `POST /telegram/webhook` | `X-Telegram-Bot-Api-Secret-Token` + icazə siyahısı |
| `GET /oauth/{instagram,tiktok,youtube}/callback` | bir dəfəlik `state` |
| `GET /oauth/shopify/callback` | HMAC + bir dəfəlik `state` |
| `POST /shopify/webhook` | HMAC imzası |
| `GET /media/<id>.<ext>?exp&sig` | HMAC imzalı müvəqqəti ünvan |

## Parollu

| Metod, yol | Təsvir |
|---|---|
| `POST /api/talk` | `{text, attachments?[]}` JSON və ya multipart (`audio`, `text`, `attachments`). Cavab: `status, spoken, screen, tasks, tools, approval_id?, transcript, wake, audio` |
| `GET /api/status` | Sirlərin təyin olunub-olunmaması, bayraqlar, koordinator, providerlər, alətlər (dəyərlər yox) |
| `GET /api/audit?limit=` | Audit hadisələri (sirrlər `[gizlədildi]`) |
| `GET /api/jobs` | Son əmr işləri |
| `GET /api/approvals?status=` | Təsdiq qeydləri |
| `POST /api/approvals/{id}` | `{decision: approve\|reject\|edit}`. `approve` icra edir (bir dəfə). Təkrar: `409` |
| `GET /api/tools` | Alət siyahısı (sxem, risk, icra yolu) |
| `POST /api/tools/run` | `{tool, input}`. Riskli alət → `202 {status:"pending_approval", approval_id}`, icra OLUNMUR |
| `GET/POST /api/media` | Siyahı / axınla yükləmə (`content-type`, `content-length` məcburi; JPEG, PNG, MP4, MOV, PDF) |
| `GET /api/media/{id}`, `GET /api/media/{id}/file` | Metadata / endirmə |
| `GET/POST /api/media/jobs`, `GET /api/media/jobs/{id}`, `POST .../{id}/advance`, `POST .../{id}/retry` | Video işləri |
| `GET /api/social/status?verify=1`, `GET /api/social/jobs`, `POST /api/social/jobs/{id}/advance` | Platforma vəziyyəti və paylaşım işləri |
| `POST /api/social/{platform}/connect` | OAuth başlat (`TOKEN_ENC_KEY` məcburi) |
| `POST /api/social/draft` | Paylaşım qaralaması → təsdiq qeydi |
| `POST /api/telegram/setup` | Webhook qur (idempotent): `getWebhookInfo` → lazımdırsa `setWebhook` → `getWebhookInfo` ilə təsdiq. Gövdə ixtiyari `{"force":true}` düzgün qurulu webhook-u da yenidən tətbiq edir. Uğur: `status` = `created`/`already_set`/`switched`/`refreshed`. Xəta: `reason`, `step`, `hint` (412 konfiqurasiya, 424 Telegram rədd etdi, 409 yalnız Telegram-ın özü 409 verərsə, 429, 502/504) |
| `GET /api/telegram/webhook` | Yalnız oxuma: konfiqurasiya yoxlaması + Telegram-dakı webhook vəziyyəti (`verdict`: `ok`, `not_set`, `other_url`, `delivery_error`, `config_problem`). Token/secret və köhnə ünvanın yolu göstərilmir |
| `GET /api/shopify/status`, `POST /api/shopify/connect`, `POST /api/shopify/disconnect` | Shopify bağlantısı |
| `GET/POST /api/knowledge` | Bilik bazası (`FEATURE_KNOWLEDGE`) |

## Status kodları (təsdiq/alət)

`200` icra olundu · `202` təsdiq gözləyir və ya nəticə `unknown` · `400` giriş səhv · `403` icazə/çat uyğun deyil · `404` tapılmadı · `409` artıq qərar verilib/icra olunub · `429` limit · `502/504` provider/vaxt xətası.
