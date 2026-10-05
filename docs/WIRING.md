# JARVIS wiring: orkestrator, alətlər, təsdiq, platformalar

**Status: oxuma və təsdiqli yazma kodu hazırdır və saxta (mock) API ilə testlə yoxlanıb. Heç bir platforma real hesabla sınanmayıb.** "Canlı inteqrasiya tamamdır" yalnız `npm run test:live:integrations` real credential ilə uğurla keçəndən sonra deyilə bilər.

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
| Instagram | `instagram.media.publish`, `.container.publish` (tək şəkil paylaşımı, gündə ≤ 5) | **hə** (`publish.social`) |
| Instagram | `instagram.comments.reply` (gündə ≤ 20), `instagram.messages.send` (mesaj yazmış istifadəçiyə cavab, gündə ≤ 10, alıcı başına ≤ 1) | **hə** (`send.message`) |
| TikTok | `tiktok.account.get`, `.videos.list`, `.videos.get`, `.post.status` | yox (oxuma) |
| TikTok | `tiktok.video.publish` (PULL_FROM_URL, gündə ≤ 3) | **hə** (`publish.social`) |
| YouTube | `youtube.channel.get`, `.videos.list`, `.video.get` | yox (oxuma) |
| YouTube | `youtube.video.update` (başlıq/təsvir/teq, gündə ≤ 20) | **hə** (`edit.video`) |
| Telegram | `telegram.bot.get`, `.updates.receive`, `.voice.get` | yox |
| Telegram | `telegram.message.send` | **hə** (yalnız allowlist çatı) |
| Shopify | `shopify.shop.get`, `.products.list`, `.orders.list` | yox |
| Shopify | `shopify.customers.list` (şəxsi məlumat) | **hə** |
| Shopify | `shopify.product.update` (ad, təsvir, status, teq, vendor, növ; gündə ≤ 20) | **hə** (`edit.product`) |
| Storage | `storage.note.put/get/list` | yox (yalnız qeyd bölməsi) |
| Bilik | `knowledge.search`, `knowledge.add` | yox (icazələr qorunur) |
| Öyrənmə | `learning.record/analyze/propose/list` | yox |
| Öyrənmə | `learning.apply_rule` | **hə** |
| Satış | `lead.create/get/list`, `sales.pipeline` (yalnız qaralama) | yox |
| Satış | `sales.message.send` (tək lead, gündə ≤ 5, lead başına ≤ 1) | **hə**; özü göndərmir: Instagram lead-i üçün `instagram.messages.send`-i göstərir, digər kanallar `manual_required` |

Reyestrdə **olmayan** (endpoint-i yoxlanmayıb və ya texniki mümkün deyil): YouTube video yükləmə/silmə (Worker-də böyük bayt axını və mənbə faylı lazımdır), TikTok FILE_UPLOAD və qaralama (inbox) yolu, Shopify qiymət/stok/sifariş dəyişikliyi (mutation sxemləri yoxlanmayıb), Telegram səs faylı yükləmə və səs göndərmə (yükləmə ünvanı rəsmi səhifədə kəsildiyi üçün yoxlana bilmədi), Instagram token yeniləməsi (yeni token Secret-ə yazıla bilməz). `social.publish` təsdiqdən sonra da icra olunmur.

## Doğrulama səviyyəsi (dürüst vəziyyət)

| Platforma | Endpoint-lər rəsmi sənədlə oxunub (2026-10-05) | Canlı sınanıb |
|---|---|---|
| Instagram (Instagram Login API, `graph.instagram.com/v25.0`) | hə | **yox** |
| TikTok (Display API v2) | hə | **yox** |
| YouTube (Data API v3 + OAuth2 refresh) | hə | **yox** |
| Telegram (Bot API) | hə (səhifə yarımçıq göründü) | **yox** |
| Shopify (Admin GraphQL, 2026-07 pinli) | hə | **yox** |

Yazma endpoint-ləri də eyni səviyyədədir (2026-10-05, WebFetch xülasəsi). "Sənədlə oxunub" = bayt-bayt deyil. Yoxlanmayan konkret detallar: Instagram şərh cavabında parametrin JSON gövdədə getməsi (digər IG yazma endpoint-lərinə uyğun seçilib), TikTok creator_info sorğusu (privacy_level yoxlaması), YouTube dəyişdirilə bilən snippet sahələrinin tam siyahısı, Shopify status enum-unun tam siyahısı. Açıq qalan suallar hər adapterin başlıq şərhində yazılıb (məs. Instagram: `/me` cavabında hansı sahə `<IG_ID>`-dir; Telegram: fayl yükləmə ünvanı; Shopify: şəxsi məlumat Level-2 tələbi). Canlı test bunları göstərəcək.

## Hər platforma üçün SƏNİN etməli olduğun əməliyyatlar

Heç bir dəyəri GitHub-a, issue-ya, söhbətə yazma. Hamısı Cloudflare → Worker → Settings → Variables and Secrets.

**Instagram** — Meta developer hesabında Instagram API (Instagram Login) tətbiqi, `instagram_business_basic` (+ statistika üçün `instagram_business_manage_insights`) icazəsi, Instagram Professional hesabı test istifadəçisi/rolu, uzunömürlü token (60 gün, yenilənməsi kodlaşdırılmayıb). Secret: `IG_FNPARFUM_TOKEN`.

**TikTok** — developers.tiktok.com-da tətbiq yarat, Login Kit + Display API əlavə et, tətbiq təsdiqi (bir neçə gündən 2 həftəyə), hesabı avtorizasiya et (`user.info.basic`, `video.list`). Access token 24 saatdır; kod yenilənməni etmir, bitəndə yeni token lazımdır. Secret: `TIKTOK_ACCESS_TOKEN`.

**YouTube** — Google Cloud layihəsi, YouTube Data API v3 aktiv, OAuth client (id/secret), bir dəfə OAuth razılığı ilə refresh token (`youtube.readonly`). Tətbiq "Testing" statusundadırsa refresh token 7 gündən sonra bitir: "In production" et. Secret: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.

**Telegram** — @BotFather ilə bot, token. Secret: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (16–256 simvol `A-Za-z0-9_-`, özün uydur). Variable: `TELEGRAM_ALLOWED_CHAT_IDS` (öz çat id-n, vergüllə). Sonra webhook-u bir dəfə qur (token terminalda qalır, heç yerə yazılmır):
`curl -sS "https://api.telegram.org/bot<TOKEN>/setWebhook" -d "url=https://<worker-ünvanı>/telegram/webhook" -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"`.
Webhook secret yoxdursa `/telegram/webhook` bağlıdır (503). Naməlum çat: cavab yoxdur, orkestrator işləmir. Səs mesajı: emal olunmur, istifadəçiyə bildirilir (fayl yükləmə ünvanı yoxlanmayıb).

**Shopify** — YENİ admin-created custom app artıq yaradıla bilməz (sənəd). İki yol: köhnə mövcud Admin API tokeni (`SHOPIFY_ADMIN_TOKEN`) və ya Dev Dashboard tətbiqi (`SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET`; tətbiq və mağaza eyni təşkilatda olmalıdır). Variable: `SHOPIFY_STORE_DOMAIN` (`<ad>.myshopify.com`). Scope: `read_products`, `read_orders` (yalnız son 60 gün), `read_customers` (şəxsi məlumat üçün Shopify-ın əlavə tələbləri var).

### Yazma əməliyyatları üçün əlavə şərtlər (sənin etməli olduğun)

- **Instagram paylaşım:** token `instagram_business_content_publish` icazəsi ilə alınmalıdır; şəkil ictimai https ünvanda **JPEG** olmalıdır. **DM/şərh cavabı:** `instagram_business_manage_messages` və `instagram_business_manage_comments` icazələri. DM yalnız **sənə yazmış** istifadəçiyə, 24 saat ərzində mümkündür; alıcının IGSID-si Instagram messaging webhook-undan gəlir (bu repoda Instagram webhook yoxdur: IGSID-ni əl ilə `lead.create` ilə `ig_scoped_id` kimi verirsən). Token 60 gündən bir əl ilə yenilənir: `curl "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<TOKEN>"`, cavabdakı yeni token-i Secret-ə yaz (token ≥ 24 saat köhnə olmalıdır).
- **TikTok paylaşım:** tətbiqdə `video.publish` scope-u, **video ünvanının domeninin (URL prefiksinin) TikTok-da sahibliyinin təsdiqi** (PULL_FROM_URL üçün məcburi) və tətbiq auditi; audit olmadan bütün paylaşımlar yalnız özünə görünür (`SELF_ONLY`). Access token əvəzinə üç Secret: `TIKTOK_REFRESH_TOKEN`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (hər çağırışda təzə token alınır). TikTok refresh token-i rotasiya edərsə nəticədə `refresh_token_rotated` xəbərdarlığı çıxır: bu halda TikTok-dan yeni refresh token alıb Secret-i yenilə (Worker onu saxlaya bilməz).
- **YouTube redaktə:** OAuth razılığı `youtube.force-ssl` (və ya `youtube`) scope-u ilə təkrar verilməli və yeni refresh token Secret-ə yazılmalıdır (`youtube.readonly` yazma üçün YETMİR). Hər redaktə 50 kvota vahididir.
- **Shopify məhsul redaktəsi:** `write_products` scope-u (köhnə token və ya Dev Dashboard tətbiqinin scope-una əlavə).

**Cloudflare KV** — bax `docs/KV_SETUP.md`.

## Telegram cavabı və təsdiq

Telegram cavabı (`replyToOwner`) Fərid-in öz çatına, onun öz mesajına cavabdır və təsdiq tələb etmir (allowlist çatından başqa hədəf mümkün deyil). Üçüncü şəxsə mesaj yalnız `telegram.message.send` ilə, təsdiqlə, allowlist çatına.

## Məhdudiyyətlər (bilinən)

- Cloudflare Free planında bir sorğuya 50 subrequest limiti var; bilik axtarışı pəncərəsi 10, öyrənmə qaydası 5 ilə məhdudlaşdırılıb.
- KV atomik müqayisə-yaz (CAS) vermir: iki eyni anlı qərar yarışı nəzəri olaraq mümkündür (tək istifadəçi üçün qəbul edilən risk).
- Instagram tokeninin yenilənməsi əl ilə (60 gün); TikTok refresh yalnız hər çağırışda təzə access token alır, rotasiya olunan refresh token Secret-ə yazıla bilmir.
- Satış mesajı: yalnız Instagram DM cavabı mümkündür (`instagram.messages.send`, ayrıca təsdiqlə); digər kanallarda `manual_required`.
- Yazma əməliyyatlarının gündəlik sayğacı və yarış: KV atomik deyil, eyni anda iki təsdiq limiti 1 dəfə aşa bilər (tək istifadəçi üçün qəbul edilən risk).
