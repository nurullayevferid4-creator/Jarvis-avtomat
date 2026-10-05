# JARVIS wiring: orkestrator, alətlər, təsdiq, platformalar

**Status: kod hazırdır və saxta (mock) API ilə testlə yoxlanıb. Heç bir platforma real hesabla sınanmayıb.** "Canlı inteqrasiya tamamdır" yalnız `npm run test:live:integrations` real credential ilə uğurla keçəndən sonra deyilə bilər.

## Axın

```
Fərid (mətn / səs / Telegram)
  → Claude planlayıcı (tool_calls)            src/orchestrator/ClaudeOrchestrator.js, toolPlanning.js
  → Orkestrator                               ≤ 4 alət çağırışı, yalnız kataloqdakı alətlər
  → Alət reyestri                             src/tools/registry.js (schema, icazə, audit, timeout)
  → İnteqrasiya / Agent / Bilik / Storage     src/tools/integrationTools.js → src/integrations, src/agents
  → Təsdiq tələb olunursa: təsdiq qeydi (İCRA YOXDUR, giriş heşlənir)
  → Fərid telefonda "Təsdiqlər" panelində təsdiq edir/rədd edir (parol qorumalı /api/approvals)
  → İcazənin təkrar yoxlanması → tək istifadəlik təsdiq sübutu → icra → audit → nəticə
  → Claude cavabı (+ səs: TTS)
```

Təsdiq → icra mərhələləri (`src/approval/executor.js`): `pending → approved(awaiting) → running → done|failed`, rədd → `not_executed`. İcra pəncərəsi 15 dəqiqədir. Giriş heşi təsdiq anındakı ilə uyğun gəlmirsə icra olunmur. `REVOKED_PERMISSIONS` söndürmə açarı təsdiqlənmiş çağırışı da dayandırır (`send.message` daxil).

Əsas qaydalar:
- Alət çağırışı təsdiqini söhbətdə "hə", səslə və ya Telegram-la vermək **olmur**. Yalnız parol qorumalı UI/API (`via:"api"`).
- Planlayıcı `ctx`, icazə və ya təsdiq sübutunu ötürə bilmir: giriş schema-sı `additionalProperties:false`.
- Platforma mətni etibarsız məlumatdır: modelə yalnız `<external_content>` qutusunda gedir.
- `knowledge.add` planlayıcıdan gələndə `trust` həmişə `external`.

## Alətlər

| Qrup | Alətlər | Təsdiq |
|---|---|---|
| Instagram | `instagram.account.get`, `.media.list`, `.insights.get` | yox (oxuma) |
| TikTok | `tiktok.account.get`, `.videos.list`, `.videos.get` | yox (oxuma) |
| YouTube | `youtube.channel.get`, `.videos.list`, `.video.get` | yox (oxuma) |
| Telegram | `telegram.bot.get`, `.updates.receive`, `.voice.get` | yox |
| Telegram | `telegram.message.send` | **hə** (yalnız allowlist çatı) |
| Shopify | `shopify.shop.get`, `.products.list`, `.orders.list` | yox |
| Shopify | `shopify.customers.list` (şəxsi məlumat) | **hə** |
| Storage | `storage.note.put/get/list` | yox (yalnız qeyd bölməsi) |
| Bilik | `knowledge.search`, `knowledge.add` | yox (icazələr qorunur) |
| Öyrənmə | `learning.record/analyze/propose/list` | yox |
| Öyrənmə | `learning.apply_rule` | **hə** |
| Satış | `lead.create/get/list`, `sales.pipeline` (yalnız qaralama) | yox |
| Satış | `sales.message.send` (tək lead, gündə ≤ 5, lead başına ≤ 1) | **hə**; real göndərmə yoxdur (`manual_required`) |

Reyestrdə **olmayan** (endpoint-i yoxlanmayıb, interfeys kimi qalır): Instagram paylaşım/DM/şərh cavabı, TikTok paylaşım, YouTube yükləmə/idarəetmə, Shopify yazma, Telegram səs göndərmə. `social.publish` təsdiqdən sonra da icra olunmur.

## Doğrulama səviyyəsi (dürüst vəziyyət)

| Platforma | Endpoint-lər rəsmi sənədlə oxunub (2026-10-05) | Canlı sınanıb |
|---|---|---|
| Instagram (Instagram Login API, `graph.instagram.com/v25.0`) | hə | **yox** |
| TikTok (Display API v2) | hə | **yox** |
| YouTube (Data API v3 + OAuth2 refresh) | hə | **yox** |
| Telegram (Bot API) | hə (səhifə yarımçıq göründü) | **yox** |
| Shopify (Admin GraphQL, 2026-07 pinli) | hə | **yox** |

"Sənədlə oxunub" = WebFetch xülasəsi ilə yoxlanıb, bayt-bayt deyil. Açıq qalan suallar hər adapterin başlıq şərhində yazılıb (məs. Instagram: `/me` cavabında hansı sahə `<IG_ID>`-dir; Telegram: fayl yükləmə ünvanı; Shopify: şəxsi məlumat Level-2 tələbi). Canlı test bunları göstərəcək.

## Hər platforma üçün SƏNİN etməli olduğun əməliyyatlar

Heç bir dəyəri GitHub-a, issue-ya, söhbətə yazma. Hamısı Cloudflare → Worker → Settings → Variables and Secrets.

**Instagram** — Meta developer hesabında Instagram API (Instagram Login) tətbiqi, `instagram_business_basic` (+ statistika üçün `instagram_business_manage_insights`) icazəsi, Instagram Professional hesabı test istifadəçisi/rolu, uzunömürlü token (60 gün, yenilənməsi kodlaşdırılmayıb). Secret: `IG_FNPARFUM_TOKEN`.

**TikTok** — developers.tiktok.com-da tətbiq yarat, Login Kit + Display API əlavə et, tətbiq təsdiqi (bir neçə gündən 2 həftəyə), hesabı avtorizasiya et (`user.info.basic`, `video.list`). Access token 24 saatdır; kod yenilənməni etmir, bitəndə yeni token lazımdır. Secret: `TIKTOK_ACCESS_TOKEN`.

**YouTube** — Google Cloud layihəsi, YouTube Data API v3 aktiv, OAuth client (id/secret), bir dəfə OAuth razılığı ilə refresh token (`youtube.readonly`). Tətbiq "Testing" statusundadırsa refresh token 7 gündən sonra bitir: "In production" et. Secret: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.

**Telegram** — @BotFather ilə bot, token. Secret: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (16–256 simvol `A-Za-z0-9_-`, özün uydur). Variable: `TELEGRAM_ALLOWED_CHAT_IDS` (öz çat id-n, vergüllə). Sonra webhook-u bir dəfə qur (token terminalda qalır, heç yerə yazılmır):
`curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" -d "url=https://<worker-ünvanı>/telegram/webhook" -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"`.
Webhook secret yoxdursa `/telegram/webhook` bağlıdır (503). Naməlum çat: cavab yoxdur, orkestrator işləmir. Səs mesajı: emal olunmur, istifadəçiyə bildirilir (fayl yükləmə ünvanı yoxlanmayıb).

**Shopify** — YENİ admin-created custom app artıq yaradıla bilməz (sənəd). İki yol: köhnə mövcud Admin API tokeni (`SHOPIFY_ADMIN_TOKEN`) və ya Dev Dashboard tətbiqi (`SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`; tətbiq və mağaza eyni təşkilatda olmalıdır). Variable: `SHOPIFY_STORE_DOMAIN` (`<ad>.myshopify.com`). Scope: `read_products`, `read_orders` (yalnız son 60 gün), `read_customers` (şəxsi məlumat üçün Shopify-ın əlavə tələbləri var).

**Cloudflare KV** — bax `docs/KV_SETUP.md`.

## Telegram cavabı və təsdiq

Telegram cavabı (`replyToOwner`) Fərid-in öz çatına, onun öz mesajına cavabdır və təsdiq tələb etmir (allowlist çatından başqa hədəf mümkün deyil). Üçüncü şəxsə mesaj yalnız `telegram.message.send` ilə, təsdiqlə, allowlist çatına.

## Məhdudiyyətlər (bilinən)

- Cloudflare Free planında bir sorğuya 50 subrequest limiti var; bilik axtarışı pəncərəsi 10, öyrənmə qaydası 5 ilə məhdudlaşdırılıb.
- KV atomik müqayisə-yaz (CAS) vermir: iki eyni anlı qərar yarışı nəzəri olaraq mümkündür (tək istifadəçi üçün qəbul edilən risk).
- Instagram/TikTok tokeninin yenilənməsi kodlaşdırılmayıb: bitəndə yeni token lazımdır.
- Satış mesajı real kanala göndərilmir (`manual_required`): kanal göndərmə endpoint-i yoxlanmayıb.
