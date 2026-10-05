# JARVIS Foundation: gələcək inteqrasiyalar üçün skelet

**Status (yenilənib): foundation skeletləri `src/wiring.js` vasitəsilə orkestratora, alət reyestrinə və təsdiq→icra axınına qoşulub; bax `docs/WIRING.md`.** Platforma adapterləri indi oxuma əməliyyatlarını rəsmi sənədlə yoxlanmış endpoint-lərlə icra edə bilir, lakin **heç biri real hesabla sınanmayıb**. Aşağıdakı cədvəl PR #11-dəki ilkin skelet vəziyyətini göstərir və tarixi qeyd kimi saxlanılıb. Real credential olmadan heç bir "inteqrasiya tamamlandı" demək olmaz.

## Quruluş

```
JARVIS
 ↓ (gələcək orkestrator bağlantısı, hələ yoxdur)
Integration Registry           src/integrations/registry.js
 ├── InstagramAdapter          src/integrations/instagram.js
 ├── TikTokAdapter             src/integrations/tiktok.js
 ├── YouTubeAdapter            src/integrations/youtube.js
 ├── TelegramAdapter           src/integrations/telegram.js
 └── ShopifyAdapter            src/integrations/shopify.js
Agents
 ├── LearningAgent             src/agents/LearningAgent.js
 └── SalesAgent (+ LeadStore)  src/agents/SalesAgent.js
Storage
 └── KVStorage / MemoryStorage src/storage/*
Yığım                          src/foundation/index.js (createFoundation)
```

Ortaq qaydalar: baza sinif `src/integrations/Integration.js`, siyasət `src/integrations/policy.js`, secret adları `src/integrations/secrets.js`, xətalar `src/integrations/errors.js`.

## Hər modulun real vəziyyəti

| Modul | Nə var | Nə YOXDUR |
|---|---|---|
| Storage | `Storage` müqaviləsi, `MemoryStorage`, `KVStorage` (JARVIS_KV), bölmələr (memory, jobs, knowledge, approvals, audit, learning, leads, integrations), açar/dəyər/ttl/limit validasiyası | Mövcud `src/state/store.js`-ə qoşulma; real KV namespace |
| Instagram | oxuma interfeysi (`account.get`, `media.list`, `insights.get`), mock | canlı çağırış (endpoint-lər yoxlanmayıb); paylaşım, şərh cavabı, DM (söndürülüb) |
| TikTok | `account.get`, `videos.list`, mock | canlı çağırış; `video.publish` (söndürülüb) |
| YouTube | `channel.get`, `videos.list`, `video.get`, mock, OAuth ad-ları | token mübadiləsi və canlı çağırış; yükləmə/redaktə/silmə (söndürülüb) |
| Telegram | `bot.get`, `updates.receive`, `voice.get` interfeysi, allowlist-li `normalizeUpdate`, mock | canlı çağırış; göndərmə (`message.send`, `voice.send`) söndürülüb |
| Shopify | `shop.get`, `products.list`, `orders.list`, `customers.list`, `normalizeShopDomain` (SSRF qoruması), mock | canlı çağırış və API versiyası; məhsul/qiymət/stok dəyişikliyi söndürülüb |
| LearningAgent | nəticə qeydi, saf təhlil, təklif, təsdiqdən sonra qayda saxlama | avtomatik öyrənmə; system prompt/secret/icazə dəyişmə (kodla bağlıdır); qaydanı özü tətbiq etmə |
| SalesAgent | lead qiymətləndirmə (qayda əsaslı), söhbət planı, təklif qaralaması, follow-up planı, `LeadStore` | göndərmə (`send()` həmişə `disabled`), kütləvi mesaj, Instagram DM, model çağırışı |

## Təhlükəsizlik zəmanətləri (testlə yoxlanır)

- Yazma əməliyyatları (`media.publish`, `messages.send`, `message.send`, `video.upload`, `price.change`, `inventory.set` və s.) **həmişə** `disabled` xətası verir: credential ilə, mock ilə, doğru giriş ilə də. Bunu yalnız `src/integrations/policy.js`-dəki dondurulmuş sabit idarə edir; env, təsdiq id-si və ya mock rejimi onu açmır.
- Credential yoxdursa heç bir şəbəkə sorğusu göndərilmir (`not_configured`). Credential olsa da endpoint rəsmi sənədlə yoxlanıb `verified: true` işarələnməyibsə sorğu göndərilmir (`not_implemented`). Bu mərhələdə heç bir endpoint yoxlanmayıb.
- Token yalnız sorğu anında `env`-dən oxunur. Adapter obyektində enumerable sahə kimi saxlanmır, `status()`-da, xəta mətnində və nəticədə görünmür.
- Mock rejimi yalnız `createIntegrationRegistry(env, { mock: true })` ilə açılır (env ilə yox). Mock nəticələri `mock: true` daşıyır və aşkar saxtadır.
- Platformadan gələn mətn etibarsızdır: `toPromptBox()` `<external_content trust="untrusted">` qutusuna qoyur.
- Telegram: allowlist boşdursa heç bir çat qəbul olunmur. Shopify: yalnız `<ad>.myshopify.com`.
- LearningAgent: `system_prompt`, `secret`, `permission`, `approval_policy`, `security` hədəfləri qadağandır. Qayda yalnız `approvalCheck(...) === true` olduqda saxlanır. Standart yoxlama həmişə rədd edir (təsdiq mərkəzi qoşulana qədər heç bir qayda təsdiqlənmir).
- SalesAgent: `consent: "denied"` lead üçün heç bir plan qurulmur. Follow-up max 3. Hər çıxış `draft_only`.

## Secret və konfiqurasiya adları

Dəyərlər **heç vaxt** GitHub-a yazılmır. Cloudflare: Worker → Settings → Variables and Secrets.

| Platforma | Secret (gizli) | Var (gizli olmayan) |
|---|---|---|
| Instagram | `IG_FNPARFUM_TOKEN` | |
| TikTok | `TIKTOK_ACCESS_TOKEN` | |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | |
| Telegram | `TELEGRAM_BOT_TOKEN` | `TELEGRAM_ALLOWED_CHAT_IDS` (vergüllə ayrılmış çat id-ləri) |
| Shopify | `SHOPIFY_ADMIN_TOKEN` | `SHOPIFY_STORE_DOMAIN` (`ad.myshopify.com`) |

Bu fayl `.env.example`-ı dəyişmir. Ad-lar mərhələ sonunda orada da əlavə oluna bilər.

## KV hazırlığı (real namespace bu PR-da yaradılmayıb)

Kod `env.JARVIS_KV` binding-ini gözləyir. Binding olmasa yaddaş backend-i işləyir (Worker yenidən başlayanda silinir, `persistent: false`). Foundation açarları `fx/<bölmə>/<açar>` formatındadır, mövcud KV açarları (`state`, `job:...`) ilə toqquşmur.

İndi sən bunu et (yalnız qərar verəndə):
1. Cloudflare → Workers & Pages → KV → **Create namespace**, adı `JARVIS_KV`.
2. `wrangler.toml`-da `[[kv_namespaces]]` blokunun şərhini aç, `id`-ni yaz. Bu fayl bu PR-da dəyişməyib.
3. Worker-i yenidən yerləşdir və `/api/status`-da `storage: "kv"` yazdığını yoxla.

KV son-nəticəli saxlanışdır: təsdiqlərin yarışı kimi güclü zəmanət tələb edən işlər üçün sonradan D1 / Durable Object lazım olacaq.

## Sonrakı mərhələ (bu PR-da YOXDUR)

1. Hər platforma üçün endpoint-ləri rəsmi sənədlə yoxlayıb `verified: true` etmək və testləri real cavab formasına uyğunlaşdırmaq.
2. Storage-ı mövcud yaddaş/bilik bazasına qoşmaq.
3. İnteqrasiya reyestrini alət reyestrinə/orkestratora qoşmaq (təsdiq qapısı ilə).
4. `LearningAgent.approvalCheck`-i təsdiq mərkəzinə bağlamaq.
5. Real credential əlavə edildikdən sonra yalnız Instagram oxuma ilə canlı sınaq.
