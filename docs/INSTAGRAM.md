# Instagram satış operatoru

Telegram → JARVIS → Instagram. **Status: CODE READY — REAL TEST PENDING.** Hamısı saxta API ilə testlənib (`tests/instagram-sales.test.mjs`); real Instagram hesabı ilə sınaq edilməyib. Meta endpoint və icazə adları ictimai biliyə əsaslanır, bu sessiyada rəsmi sənəddən yoxlanmayıb: ilk real sınaqda yoxla.

## Nə edir

| Hissə | Davranış |
|---|---|
| OAuth | `/connect instagram` → Instagram Login; token `TOKEN_ENC_KEY` ilə şifrəli KV-də; uzun token (60 gün) avtomatik yenilənir. Qoşulandan sonra webhook abunəliyi cəhd olunur və nəticə (uğurlu/uğursuz) göstərilir |
| Hesab oxuma | «Instagram status»: hesab adı/tipi, token günü, paylaşım/DM/şərh icazələri (canlı sorğu), webhook konfiqurasiyası, lead sayı |
| Paylaşım | Şəkil və Reel; «QR Menu reklam hazırla» → «Instagram-da paylaş» → Telegram-da media önizləməsi + Reel hazırlığı yoxlaması + mətn → **✅/❌ düymə** → konteyner → status → `media_publish`. Post id saxlanır, audit yazılır. Eyni media + eyni mətn 30 gün ərzində ikinci dəfə paylaşıla bilmir |
| DM qəbulu | Webhook (və ya polling) → təsnif (qiymət/alış/demo/sual/şikayət/spam/təhqir) → lead (IGSID/username ilə təkrarsız) → qaralama cavab → **təsdiq qeydi** → Telegram bildirişi |
| Cavab qaralaması | Fakt mənbəyi yalnız `BRANDS.qr_menu.verified_facts` + nümunə link `https://weenetwork.menu/ru/menu/29`. Qiymət/şikayət sabit şablondur (modelə getmir). Claude cavabı qiymət, endirim, yad link ehtiva edirsə atılır. **OpenAI istifadə olunmur** (yalnız Claude, açar yoxdursa şablon) |
| Şərhlər | Təsnif: müsbət/sual/qiymət/alış/şikayət/spam/təhqir. Spam səssizdir, təhqirə cavab hazırlanmır. Qalanlarına ictimai cavab qaralaması + təsdiq |
| İlk mesaj | Yalnız Instagram-ın icazə verdiyi yol: istifadəçi yazandan sonra **24 saat** cavab və ya şərhə **bir dəfə, 7 gün** private reply. Başqa halda «manual action required», soyuq DM yoxdur. Gündəlik göndərmə limiti 30 |
| Satış axını | NEW → CONTACTED → INTERESTED → QUALIFIED → NEGOTIATION → WON / LOST. Sistem yalnız NEW→INTERESTED (isti DM) və NEW→CONTACTED (göndərmədən sonra) edir; WON/LOST/NEGOTIATION yalnız sahibdən |
| Lead tapma | Real mənbə: şərhlərdə alış niyyəti. Instagram ictimai biznes siyahısı vermir; uydurma lead yoxdur. `KIMI_API_KEY` varsa «Müştəri tap» **yoxlanmamış axtarış ideyaları** da verir (konkret biznes adı yox). Biznesi əl ilə əlavə et: «lead əlavə et @username Bakı kafe» |

## Telegram əmrləri

`Instagram status` · `DM-ləri yoxla` · `Şərhləri yoxla` · `Müştəri tap` · `Lead-ləri göstər` · `Satışları göstər` · `Bugünkü Instagram hesabatını ver` · `QR Menu reklam hazırla` · `Instagram-da paylaş` · `lead L0001 QUALIFIED` · `dm hazırla L0001` · `lead əlavə et @username qeyd`

Göndərmə/paylaşım/cavab yalnız bildirişdəki **[✅ Təsdiq et] [❌ Ləğv et]** düyməsi ilə. Mətnlə «hə» heç nə icra etmir.

## 24/7

Hamısı Cloudflare Worker-dədir, kompüter açıq qalmalı deyil: webhook hadisə ilə işləyir; `INSTAGRAM_POLL=1` olsa cron (5 dəq) DM/şərhləri də yoxlayır (webhook ehtiyatı).

## Sənin etməli olduqların

**Cloudflare (Worker → Settings → Variables and Secrets):**
- Secret: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `TOKEN_ENC_KEY`, `MEDIA_SIGNING_KEY`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (özün uydurduğun uzun təsadüfi mətn)
- Variable: `PUBLIC_BASE_URL`, istəsən `INSTAGRAM_POLL=1`
- Telegram üçün: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_IDS`; Claude üçün `ANTHROPIC_API_KEY`; istəyə bağlı `KIMI_API_KEY`

**Meta (developers.facebook.com → tətbiq → Instagram API with Instagram Login):**
1. Instagram hesabı **Professional** (Business/Creator) olmalıdır.
2. OAuth redirect URI: `<PUBLIC_BASE_URL>/oauth/instagram/callback`
3. İcazələr: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_messages`, `instagram_business_manage_comments`
4. Webhooks: callback URL `<PUBLIC_BASE_URL>/instagram/webhook`, verify token = `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, sahələr `messages` və `comments`
5. Tətbiq Development rejimindədirsə yalnız rolu olan hesablar işləyir (öz hesabın üçün kifayətdir). Başqa hesablardan gələn DM/şərhlər üçün Advanced Access / App Review lazım ola bilər.
6. Köhnə bağlantı yeni icazələrsiz yaradılıbsa Telegram-da `/connect instagram` ilə **yenidən qoş** («Instagram status» DM/şərh ❌ göstərsə).

## Real test ardıcıllığı (hamısı öz hesabında, paylaşma yoxdur)

1. `/connect instagram` → icazə ver → «Instagram status»: hesab adı, 4 icazə ✅, token günü.
2. Meta-da webhook-u doğrula (GET). Başqa hesabdan sənin hesabına DM yaz → Telegram-da bildiriş + qaralama + düymə. **Ləğv et** bas: heç nə getmir.
3. Eyni DM-ə bu dəfə **Təsdiq et**: cavab gəlməlidir; lead CONTACTED olmalıdır.
4. Başqa hesabdan şərh yaz → bildiriş; təsdiq et.
5. Paylaşım: test videosu göndər, «Instagram-da paylaş», önizləməni gör, **Ləğv et** ilə sına; sonra bilərəkdən bir test Reel.
