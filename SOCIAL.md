# Sosial platformalar

Bu sənəd **kodda və testdə olanı** yazır. "Hazırdır" yalnız testlə təsdiqlənən hissəyə deyilir. Real hesabla heç bir sınaq keçirilməyib: bütün testlər saxta API cavabları ilə işləyir.

## Axın

```
Fərid (Telegram / UI / API)
   → JARVIS (söhbət, əmr, media)
   → CLAUDE PLANNER (yalnız mətn: caption, title, description, hashtag)   src/social/planner.js
   → təsdiq qeydi (kind: social.publish, payload + SHA-256 hash)          src/approval/center.js
   → "Hazırladım. Paylaşmağa icazə verirsən?"  → Fərid: Bəli / Xeyr
   → yalnız "Bəli"-dən sonra: iş (job) yaranır                            src/social/flow.js
   → SOCIAL ADAPTER: Instagram | TikTok | YouTube | Telegram              src/social/adapters/
```

Qaydalar (hamısı testlərlə yoxlanır, `tests/social-*.test.mjs`):

1. Təsdiqdən əvvəl heç bir platformaya şəbəkə çağırışı olmur.
2. Təsdiq qeydinin məzmunu (`payload`) dəyişdirilərsə icra bloklanır (hash).
3. Hər platforma addımı bir dəfə icra olunur; kəsilərsə nəticə `unknown` olur, avtomatik təkrar yoxdur.
4. Claude yalnız mətn yazır; platforma, məxfilik və təsdiq onun əlində deyil.
5. Standart məxfilik `private`. `public` yalnız Fərid sorğuda açıq yazarsa.
6. Telegram-da yalnız `TELEGRAM_ALLOWED_CHAT_IDS`-dəki şəxsi söhbət idarə edə bilər.

## Vahid sorğu: `social.publish`

```json
{ "platforms": ["instagram","tiktok","youtube"],   // və ya "platform": "instagram"
  "caption": "...", "title": "...", "description": "...", "hashtags": ["ətir","yeni"],
  "media_id": "<R2-yə yüklənmiş 24 hex>",          // və ya "media_url": "https://..." (yalnız Instagram/Telegram)
  "media_type": "video",                            // image | video (standart video)
  "thumbnail_media_id": "...",                      // yalnız YouTube
  "privacy": "private",                             // private | unlisted | public (standart private)
  "made_for_kids": false }
```

Üç yol eyni qeydi açır: Telegram, `POST /api/social/draft`, və ya `social.publish` aləti. Təsdiq: Telegram düyməsi, UI düyməsi və ya `POST /api/approvals/<id>` `{"decision":"approve"}`.

## Platforma statusu (kodda olan)

| Platforma | OAuth/token | Hesab məlumatı | Paylaşım | Status yoxlama | Test |
|---|---|---|---|---|---|
| Instagram | var (uzun token 60 gün, yeniləmə) | `/me` | şəkil + Reel (konteyner → status → media_publish), post id + link | `status_code` | real sınaq yoxdur |
| TikTok | var (access 24 saat, refresh 365 gün) | creator_info | FILE_UPLOAD (tək parça ≤64 MB) | `status/fetch` | real sınaq yoxdur |
| YouTube | var (offline refresh token) | `channels?mine=true` | resumable yükləmə (tək sorğu ≤64 MB), thumbnail, video id | — (yükləmə sinxrondur) | real sınaq yoxdur |
| Telegram | bot tokeni (OAuth yox) | `getMe` | kanala mətn/şəkil/video | — | real sınaq yoxdur |

Ortaq: xəta kodları (`not_connected`, `token_expired`, `permission_denied`, `rate_limited`, `invalid_request`, `unaudited_client`, `media_error`, `timeout`, `api_error`), token heç yerdə göstərilmir.

## Platforma tələbləri və məhdudiyyətlər (BLOCKER-lər)

- **Instagram:** professional (Business/Creator) hesab lazımdır. Öz hesabın üçün Standard Access ilə yalnız app rollarındakı istifadəçilər işləyir; digər hesablar üçün Advanced Access = **App Review**. Media **ictimai əlçatan ünvanda** olmalıdır (Meta özü çəkir): JARVIS bunu imzalı müvəqqəti `/media/...` ünvanı ilə (R2) və ya sənin verdiyin `media_url` ilə edir. 24 saatda 100 API paylaşımı limiti var.
- **TikTok:** Content Posting API üçün tətbiq **audit** olunmalıdır. Audit olunmamış tətbiq yalnız `SELF_ONLY` (şəxsi) paylaşa bilir (`unaudited_client_can_only_post_to_private_accounts`). JARVIS bu halda aydın xəta verir. `PULL_FROM_URL` verifikasiya olunmuş domen tələb edir, ona görə yalnız `FILE_UPLOAD` istifadə olunur.
- **YouTube:** OAuth ekranı "Testing" statusundadırsa refresh token tez bitə bilər (ümumi bilik, sənəddən yoxlanmayıb). **Verifikasiya olunmamış API layihəsində** yüklənən videolar `private` olur (audit lazımdır). `videos.insert` gündəlik kvotaya daxildir.
- **Telegram bot:** fayl yükləmə həddi 20 MB (`getFile`). Daha böyük video UI/API ilə (`POST /api/media`, ≤64 MB) yüklənir.
- **Worker limiti:** böyük video yükləməsi (≤64 MB) bir sorğuda bitməyə bilər. Bu halda iş `unknown` ola bilər və platformada əl ilə yoxlanmalıdır. Bu real sınaqla yoxlanmayıb.
- Cron (`*/5 * * * *`) yalnız təsdiqlənmiş işləri irəlilədir (məs. Instagram konteyner statusu). KV olmadan (yaddaş rejimi) iş vəziyyəti Worker yenidən başlayanda itir: **real istifadə üçün KV məcburidir**.

## Secret-lər cədvəli

Hamısı Cloudflare Worker → Settings → Variables and Secrets bölməsində **Secret** kimi yazılır (PUBLIC_BASE_URL sirr deyil, Variable ola bilər). Kodda və GitHub-da heç biri olmamalıdır.

| SECRET | NƏ ÜÇÜNDÜR | HARADA QURULMALIDIR | İSTİFADƏ OLUNUR |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Claude (planlama, mətn) | Cloudflare Secret + GitHub Actions secret (yalnız `@claude` workflow-u üçün) | bəli |
| `OPENAI_API_KEY` | köməkçi model, səs | Cloudflare Secret | bəli |
| `PASSCODE` | UI/API girişi | Cloudflare Secret | bəli |
| `JARVIS_KV` | KV binding: təsdiqlər, işlər, tokenlər, state | wrangler.toml `[[kv_namespaces]]` və ya panel | bəli (sosial üçün məcburi) |
| `JARVIS_MEDIA` | R2 binding: video/şəkil | wrangler.toml `[[r2_buckets]]` və ya panel | bəli |
| `PUBLIC_BASE_URL` | OAuth callback + media ünvanı bazası | Variable | bəli |
| `MEDIA_SIGNING_KEY` | media ünvanını imzalayır | Secret (`openssl rand -hex 32`) | bəli |
| `TOKEN_ENC_KEY` | KV-dəki tokenləri şifrələyir | Secret (`openssl rand -hex 32`) | bəli (tövsiyə) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot | Secret (BotFather) | bəli |
| `TELEGRAM_WEBHOOK_SECRET` | webhook-u saxta sorğudan qoruyur | Secret (A-Za-z0-9_-, ≤256) | bəli |
| `TELEGRAM_ALLOWED_CHAT_IDS` | JARVIS-i kim idarə edə bilər | Secret/Variable (sənin Telegram ID-n) | bəli |
| `TELEGRAM_CHANNEL_ID` | paylaşım kanalı | Variable | bəli |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Instagram OAuth | Secret | bəli |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok OAuth | Secret | bəli |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | YouTube OAuth | Secret | bəli |
| `INSTAGRAM_API_VERSION` | Graph API versiyası (standart `v25.0`) | Variable | istəyə bağlı |

Platforma tokenləri (access/refresh) secret deyil, **OAuth ilə alınır** və KV-də saxlanır (`/connect` ilə).

## Qurulum ardıcıllığı

1. KV və R2 yarat, `wrangler.toml`-da binding-ləri aç, `PUBLIC_BASE_URL`, `MEDIA_SIGNING_KEY`, `TOKEN_ENC_KEY` yaz, deploy et.
2. **Telegram:** BotFather → `/newbot` → token → `TELEGRAM_BOT_TOKEN`; `TELEGRAM_WEBHOOK_SECRET` və `TELEGRAM_ALLOWED_CHAT_IDS` yaz; sonra `POST /api/telegram/setup` (parolla) → webhook qurulur.
3. **Instagram:** Meta Developer → app → "Instagram API with Instagram Login" → redirect URI: `<PUBLIC_BASE_URL>/oauth/instagram/callback` → App ID/Secret → Worker; sonra Telegram-da `/connect instagram` (və ya UI-da "Qoş").
4. **TikTok:** developers.tiktok.com → app → Login Kit + Content Posting API → redirect URI `<PUBLIC_BASE_URL>/oauth/tiktok/callback` → Client key/secret → Worker; audit üçün müraciət.
5. **YouTube:** Google Cloud → YouTube Data API v3 → OAuth client (Web) → redirect URI `<PUBLIC_BASE_URL>/oauth/youtube/callback` → ID/Secret → Worker.
6. UI-da "Sosial platformalar" panelində **Yoxla** bas: hər platforma `CONNECTED` olmalıdır.

## API

Hamısı parol tələb edir (`x-passcode-b64`), ictimai olanlar ayrıca qeyd olunub.

| Yol | Nə edir |
|---|---|
| `GET /api/social/status[?verify=1]` | platforma vəziyyəti (`verify=1` platformaya oxuma sorğusu göndərir), gözləyən təsdiqlər |
| `POST /api/social/<platform>/connect` | OAuth linki (instagram, tiktok, youtube) |
| `POST /api/social/draft` | təsdiq qeydi açır (paylaşmır) |
| `GET /api/social/jobs`, `POST /api/social/jobs/<id>/advance` | iş siyahısı / əl ilə irəlilətmə |
| `POST /api/media` | media yükləmə (`content-type`: image/jpeg, image/png, video/mp4, video/quicktime; ≤64 MB) |
| `POST /api/telegram/setup` | webhook qurur |
| `POST /telegram/webhook` | **ictimai**, yalnız secret başlığı ilə |
| `GET /oauth/<platform>/callback` | **ictimai**, yalnız bir dəfəlik state ilə |
| `GET /media/<id>.<ext>?exp&sig` | **ictimai**, yalnız imza ilə |

## Telegram əmrləri

`/help`, `/status`, `/pending`, `/jobs`, `/connect <platform>`; video/şəkil göndərib «Jarvis, bunu Instagram, TikTok və YouTube-da paylaş. Mövzu: ...» yaz. Mövzu yoxdursa JARVIS mətn uydurmur, soruşur.

## Hələ olmayanlar

Şərh, DM, insights, karusel, story, TikTok `PULL_FROM_URL`, YouTube çoxparçalı/davam etdirilən yükləmə, Telegram polling rejimi (yalnız webhook), planlı (gələcək vaxta) paylaşım, token ləğvi (`/disconnect`).
