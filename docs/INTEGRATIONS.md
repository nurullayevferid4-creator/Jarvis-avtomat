# İnteqrasiyalar: nə lazımdır, nə sınanıb

Ümumi qayda: **hamısı yalnız saxta API ilə sınanıb**. Real hesabla ilk dəfə işlədəndə `docs/SMOKE.md`-yə bax. Aşağıdakı platforma qaydaları (App Review, audit, məxfilik məhdudiyyətləri) ümumi biliyə və tətbiq edilən kodun gözləntilərinə əsaslanır; **rəsmi sənəddən yenidən yoxla**, qaydalar dəyişə bilər.

Hamısında: real paylaşım yalnız təsdiqdən sonra; token kodda yox, `TOKEN_ENC_KEY` ilə şifrəli KV-də; token UI/audit/xətada görünmür.

## Telegram

| | |
|---|---|
| Lazım | BotFather-dan bot (`TELEGRAM_BOT_TOKEN`), `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_IDS` (öz Telegram ID-n), kanal üçün `TELEGRAM_CHANNEL_ID` (bot kanalda admin) |
| Webhook | UI > Qoşulu hesablar > «Telegram webhook-u yoxla», sonra «Telegram webhook-u qur». Əvvəl `getWebhookInfo` ilə mövcud webhook oxunur; düzgündürsə heç nə dəyişmir, başqa ünvandadırsa (məs. köhnə n8n) JARVIS-ə keçirilir, sonda `getWebhookInfo` ilə təsdiqlənir. JARVIS webhook-u əsas Telegram giriş nöqtəsidir (n8n lazım deyil). Səhv olarsa dəqiq səbəb göstərilir (`docs/TROUBLESHOOTING.md`) |
| Edir | Komandalar, mətn əmri, foto/video (və şəkil/video sənəd) qəbulu (endirmə limiti ≤20 MB). Telegram səs mesajı (voice note) **dəstəklənmir**: səs əmri yalnız veb səhifədədir, təsdiq düymələri, kanala paylaşım |
| Qoruma | Secret başlıq (sabit vaxtlı), icazə siyahısı (boşdursa heç kim), `update_id` təkrarı bir dəfə, düymə yalnız qeydin öz çatından |
| Sınanmayıb | Real bot, real kanal |

## Instagram

| | |
|---|---|
| Lazım | Instagram **Professional** (Business/Creator) hesabı; Meta Developer tətbiqi, «Instagram API with Instagram Login»; `INSTAGRAM_APP_ID/SECRET`; OAuth redirect URI: `<PUBLIC_BASE_URL>/oauth/instagram/callback` |
| İcazələr | `instagram_business_basic`, `instagram_business_content_publish` |
| Edir | OAuth, uzun token (60 gün) və yeniləmə, şəkil/Reel konteyneri → status yoxlama → `media_publish`; media Meta tərəfindən imzalı müvəqqəti ünvandan çəkilir |
| Platforma tərəfi | Tətbiq «Development» rejimində yalnız rollu hesablarla işləyir; başqa hesablar üçün Meta App Review / Advanced Access lazım ola bilər. **Bu sənin Meta hesabında edilir.** |
| Sınanmayıb | Real hesab, Meta xəta kodları |

## TikTok

| | |
|---|---|
| Lazım | developers.tiktok.com tətbiqi, Login Kit + Content Posting API; `TIKTOK_CLIENT_KEY/SECRET`; redirect URI: `<PUBLIC_BASE_URL>/oauth/tiktok/callback` |
| İcazələr | `user.info.basic`, `video.publish` |
| Edir | OAuth, `creator_info` yoxlaması, FILE_UPLOAD (tək hissə, ≤64 MB), status sorğusu |
| Platforma tərəfi | Audit keçməmiş tətbiq yalnız `SELF_ONLY` (özünə görünən) paylaşa bilər; ictimai paylaşım üçün TikTok audit lazımdır. Kod bunu aşmağa çalışmır |
| Sınanmayıb | Real hesab |

## YouTube

| | |
|---|---|
| Lazım | Google Cloud layihəsi, YouTube Data API v3, OAuth client; `GOOGLE_CLIENT_ID/SECRET`; redirect URI: `<PUBLIC_BASE_URL>/oauth/youtube/callback` |
| İcazələr | `youtube.upload`, `youtube.readonly` |
| Edir | OAuth (offline refresh token), kanal yoxlaması, resumable yükləmə (≤64 MB), thumbnail, video id |
| Platforma tərəfi | Təsdiqlənməmiş (unverified) API layihəsindən yüklənən videolar `private`-ə məcbur ola bilər; API audit/verification Google tərəfindədir. Gündəlik kvota məhduddur |
| Sınanmayıb | Real hesab |

## Shopify

| | |
|---|---|
| Lazım | Shopify tətbiqi (Dev Dashboard), `SHOPIFY_API_KEY/SECRET`; redirect URI: `<PUBLIC_BASE_URL>/oauth/shopify/callback`; mağaza |
| Scope | `read_products,write_products,read_orders,read_inventory,write_inventory` (dəyişdirilə bilər) |
| Edir | Bax `docs/SHOPIFY.md`: məhsul hazırlama (başlıq/təsvir/qiymət/şəkil/variant/stok/SEO), təsdiqlə yaratma (həmişə DRAFT), qiymət/stok yeniləmə (köhnə dəyər uyğunsuzluğunda dayanır), arxivləmə (silmə YOXDUR), kolleksiya, webhook (yalnız qeyd) |
| Sınanmayıb | Real mağaza, real scope qəbulu |
| Qeyd | «Bu məhsulu Shopify-a əlavə et» əvvəl `shopify.product.prepare` ilə qaralama hazırlayır, sonra təsdiq qeydi açır; təsdiqsiz heç nə yazılmır |

## AI providerlər

| | |
|---|---|
| Claude | Lider. Planlama, yoxlama, cavab. `ANTHROPIC_API_KEY` |
| OpenAI | Köməkçi (axtarış), STT, TTS, Claude xəta verəndə ehtiyat. `OPENAI_API_KEY` |
| Kimi | İstəyə bağlı: araşdırma/ikinci rəy. Nəticəsi **yoxlanmamış** işarələnir. `KIMI_API_KEY` |
| Davranış | Vaxt aşımı, limit, səhv açar, bozuq cavab: tipli xəta, JSON-u bir dəfə yenidən soruşma, ehtiyata keçid. Hamısı uğursuzdursa «alınmadı» deyilir |

## Dropshipping / e-commerce

Yalnız interfeys (`src/commerce/interfaces.js`): təchizatçı, sifariş, çatdırılma adapterləri üçün müqavilələr. **Real təchizatçı və ya ödəniş inteqrasiyası yoxdur** və saxta olanı yoxdur.

## Lead sistemi

Yalnız ictimai/qanuni mənbələr. Axın: araşdırma → süzgəc → qiymətləndirmə → saxla → mesaj hazırla → **insan təsdiqi** → əlaqə. Kütləvi/avtomatik göndəriş yoxdur; gündəlik limit və «əlaqə saxlama» siyahısı var. Bax `docs/LEADS.md`.

## Marketinq və agentlər

QR Menu iş axını yalnız QR Menu üçündür (səhifə `https://weenetwork.menu/ru/menu/29`); rəqəmsal vizit kart öz-özünə əlavə olunmur. Agent reyestri (Sales, Order, Logistics, Seller, Marketing, Customer Support, Fraud/Quality, Manager) yalnız **real məlumat mənbəyi olan** agentləri göstərir; olmayanlar «qoşulmayıb» görünür. Bax `docs/MARKETING.md`, `docs/AGENTS.md`.
