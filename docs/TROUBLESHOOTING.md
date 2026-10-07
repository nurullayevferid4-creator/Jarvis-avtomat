# Xəta aradan qaldırma

| Əlamət | Səbəb | Nə et |
|---|---|---|
| `401` | Parol səhvdir | UI-da parolu yenidən yaz. Parolda ə/ı/ş/ğ ola bilər (Base64 ilə göndərilir) |
| `429` | Çox səhv cəhd (standart 5 → 15 dəq blok) | Gözlə |
| `500 ANTHROPIC_API_KEY və ya OPENAI_API_KEY təyin edilməyib` | Sirr yoxdur | `docs/ENVIRONMENT.md` |
| Status: koordinator «memory» | `COORD` Durable Object bağlanmayıb | Deploy-un migration-ı keçdiyini yoxla (`wrangler.toml` `[[migrations]]`); məsələ həll olmayana qədər çox-nüsxəli yarış qorunması zəifdir |
| Təsdiq `409` | Artıq qərar verilib və ya icra edilib | Normaldır (bir dəfə icra qaydası). Yeni qeyd yarat |
| Təsdiq `403` | Qeyd başqa çat/istifadəçi üçündür | UI/çat uyğunsuzluğu |
| Təsdiq nəticəsi `unknown` | Şəbəkə/vaxt xətası: əməliyyat yarımçıq ola bilər | Platformada əl ilə yoxla; avtomatik təkrarlanmır |
| «icra xidməti 30 dəqiqə» / `expired` | Təsdiqdən sonra icra pəncərəsi bitib | Yeni qeyd yarat |
| `Content-Length lazımdır` (411) | Yükləmə sorğusunda ölçü yoxdur (bəzi proxy-lər çıxarır) | Başqa şəbəkə/brauzer; JPEG/PNG/MP4/MOV/PDF faylı birbaşa seç |
| `Fayl növü dəstəklənmir` | Başlıqdakı növ və ya faylın real baytları uyğun gəlmir | Faylı yenidən eksport et (MP4/H.264) |
| `TOKEN_ENC_KEY təyin edilməyib` | OAuth üçün məcburidir | Secret əlavə et |
| `PUBLIC_BASE_URL (https://...) təyin edilməyib` | OAuth/webhook/media ünvanı üçün lazımdır | Variable əlavə et, sonunda `/` olmasın |
| OAuth «state etibarsızdır» | 10 dəqiqə keçib və ya təkrar | «Qoş»-u yenidən bas |
| Instagram media çəkilmir | `MEDIA_SIGNING_KEY`/`PUBLIC_BASE_URL` yoxdur və ya R2 bucket yoxdur | UI Sistem vəziyyəti |
| Video işi `FAILED: Video emal xidməti qoşulmayıb` | `VIDEO_PROCESSOR_*` yoxdur və redaktə tələb olunur | `docs/VIDEO.md` |
| TikTok «unaudited / SELF_ONLY» | TikTok audit keçməyib | Platforma tərəfində audit |
| YouTube video `private` | API layihəsi təsdiqlənməyib | Google tərəfində verification |
| Telegram cavab vermir | `TELEGRAM_ALLOWED_CHAT_IDS`-də ID yoxdur, webhook qurulmayıb və ya secret uyğun deyil | «Telegram webhook-u yoxla» düyməsi hökmü göstərir (aşağıdakı cədvəl); ID-ni yoxla (icazəsizə **bilərəkdən** cavab verilmir) |
| `PUBLIC_BASE_URL` Cloudflare-də yazılıb, amma Worker onu «boş» görür | Dashboard-da **Text** kimi yazılan dəyişən `wrangler deploy` zamanı silinir (Cloudflare: «Wrangler will override them the next time you deploy»). `wrangler.toml`-da indi `keep_vars = true` var; **secret-lər bundan təsirlənmir** | Dəyişən bir dəfə silinibsə, `keep_vars = true` ilə deploy-dan sonra onu **bir dəfə** yenidən yaz (və ya «Secret» kimi yaz). Telegram webhook-u üçün Worker ehtiyat olaraq öz ünvanını işlədir və bunu bildirir |
| UI-da heç nə işləmir, boş səhifə | Çox köhnə brauzer (CSP/ES5 xaric funksiyalar) | Başqa/yeni brauzer; səhifə `fetch` və `TextEncoder` tələb edir |
| Səs işləmir | Mikrofon icazəsi, `FEATURE_VOICE=0`, brauzer `MediaRecorder` dəstəkləmir | Mətnlə yaz; icazə ver |
| Telegram səsli mesajına «🎤 Səsli mesajı mətnə çevirə bilmədim: …» | Səbəb mesajdadır: `OPENAI_API_KEY` yoxdur/səhvdir (401), OpenAI xətası, fayl 8 MB-dan böyükdür, səs aydın deyil, `FEATURE_VOICE=0` | Səbəbə görə düzəlt; və ya yazı ilə yaz |
| «Səs tanıma xətası 401: OPENAI_API_KEY etibarsızdır» | Cloudflare-dəki `OPENAI_API_KEY` OpenAI tərəfindən qəbul edilmir: səhv/yarımçıq yapışdırılıb, OpenAI-da silinib/ləğv edilib, başqa (silinmiş) layihəyə aiddir | platform.openai.com → API keys-də açarın aktiv olduğunu yoxla; lazımdırsa yeni açar yarat və Cloudflare → Variables and Secrets → `OPENAI_API_KEY` secret-ini yenilə. Sonra UI → Sistem vəziyyəti → «OpenAI səs tanımanı yoxla» |
| «OpenAI səs tanımanı yoxla»: `HTTP 0`, `network_error` / `invalid_header_value`, «Authorization formatı gözlənilən deyil» | `OPENAI_API_KEY` secret-i səhv yapışdırılıb (içində sətir sonu, görünməz simvol və s.). Cloudflare `fetch` belə başlığı göndərmir, `TypeError: Invalid header value` atır, sorğu OpenAI-a getmir. Cloudflare ayarı deyil | Yeni versiya sətir sonu, boşluq, dırnaq, BOM/zero-width, «Bearer»/«OPENAI_API_KEY=» prefiksini avtomatik atır. «AÇAR SƏHV YAPIŞDIRILIB» görünürsə: OpenAI → API keys → «Copy» → Cloudflare secret-ə tək sətirdə yapışdır, Deploy |
| «… 401: açarın icazəsi çatmır» | Restricted key-də audio icazəsi yoxdur | OpenAI → API keys → açarın icazələri: «All» və ya Model capabilities-də audio/transcription icazəsi |
| «… balansı/limiti bitib» (429) | OpenAI billing/kredit | OpenAI → Billing |
| Telegram səsli mesajına cavab gəlmir | Göndərən `TELEGRAM_ALLOWED_CHAT_IDS`-də deyil və ya qrup çatıdır (bilərəkdən cavab yoxdur), webhook qurulmayıb | «Telegram webhook-u yoxla»; ID-ni yoxla |
| Səsli mesaja Telegram menyusu (/help) gəlir | Köhnə versiya deploy olunub (səsli mesaj dəstəyindən əvvəlki) | `feature/jarvis-production`-u `main`-ə merge et, deploy-u gözlə |

## Telegram webhook qurulması: dəqiq səbəblər

«Telegram webhook-u qur» və «Telegram webhook-u yoxla» düymələri nəticəni UI-da (düymələrin altında) göstərir. Cavabda həmişə `reason` (səbəb), `step` (hansı addımda) və `hint` (nə etməli) olur. Token və secret heç vaxt göstərilmir.

Əvvəl bütün xətalar (boş `PUBLIC_BASE_URL`, etibarsız token və s.) eyni HTTP `409` kimi görünürdü və səbəbi ayırd etmək olmurdu. İndi **`409` yalnız Telegram özü `409 Conflict` qaytararsa** olur.

| HTTP | `reason` | Mənası | Nə et |
|---|---|---|---|
| 412 | `bot_token_missing` | `TELEGRAM_BOT_TOKEN` Worker mühitində boşdur | Variables and Secrets-ə əlavə et, deploy et |
| 412 | `bot_token_malformed` | Token formatı `<rəqəmlər>:<hərf-rəqəm>` deyil | BotFather tokenini olduğu kimi yapışdır (əvvəlinə `bot` yazma) |
| 412 | `webhook_secret_missing` / `webhook_secret_invalid` | `TELEGRAM_WEBHOOK_SECRET` boşdur və ya icazəsiz simvol var | Yalnız `A-Z a-z 0-9 _ -`, 1-256 simvol |
| 412 | `public_base_url_missing` / `public_base_url_invalid` | `PUBLIC_BASE_URL` boşdur/səhvdir **və** sorğu `https` ünvanla gəlməyib | `https://host`, yolsuz; Text dəyişənin deploy-da silinməsinə bax (yuxarıdakı cədvəl) |
| 424 | `bot_token_rejected` | Telegram tokeni qəbul etmir (401/404): səhv, `/revoke` olunmuş və ya başqa botun tokeni | BotFather → /mybots → API Token; yeni tokeni secret-ə yaz, deploy et |
| 424 | `telegram_rejected` | Telegram `setWebhook`-u rədd etdi (məs. ünvan çatılmazdır); Telegram-ın mətni göstərilir | Mətnə bax, ünvanın ictimai `https` olduğunu yoxla |
| 409 | `telegram_conflict` | Telegram özü 409 qaytardı (məs. eyni bot üçün başqa proses `getUpdates` edir) | O prosesi dayandır, düyməni yenidən bas |
| 429 | `telegram_rate_limited` | Telegram limiti (`retry_after` saniyə) | Gözlə |
| 502/504 | `telegram_unavailable` / `telegram_unreachable` | Telegram API xətası və ya vaxt aşımı | Bir az sonra təkrar bas |
| 502 | `webhook_not_applied` | `setWebhook` «ok» dedi, amma `getWebhookInfo` gözlənilən ünvanı göstərmir. **Uğur bildirilmir** | Düyməni bir daha bas, təkrarlanarsa audit jurnalına bax |

Uğurlu nəticələr (`status`): `created` (yeni quruldu), `already_set` (artıq düzgün idi, **heç nə dəyişmədi**), `switched` (başqa ünvandan, məs. köhnə n8n-dən JARVIS-ə keçirildi; köhnə ünvandan yalnız host göstərilir, köhnə gözləyən əmrlər atılır), `refreshed` (eyni ünvan, lakin Telegram çatdırma xətası və ya `allowed_updates` fərqi olduğuna görə təzələndi). Yoxlama düyməsinin hökmləri: `Webhook düzgündür`, `qurulmayıb`, `başqa ünvandadır`, `çatdırma xətası`, `konfiqurasiya problemi`.

Qeyd: Telegram webhook-un `secret_token`-ini geri oxumağa icazə vermir. `TELEGRAM_WEBHOOK_SECRET`-i dəyişmisənsə və «çatdırma xətası 401/403» görürsənsə, «Telegram webhook-u qur» düyməsini bas: ünvan eyni olsa da yenidən tətbiq olunur.

## Hara baxmaq

UI > «Xətalar (bu sessiya)», «Audit jurnalı», «Sistem vəziyyəti». Xəta mətnində sirr, stack və URL olmur; ətraflı texniki məlumat yalnız audit jurnalındadır.
