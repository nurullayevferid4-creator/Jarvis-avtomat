# Shopify modulu

JARVIS-in Shopify qatı `src/shopify/` qovluğundadır. Asılılıq yoxdur, bütün HTTP çağırışları inyeksiya olunan `fetchImpl` ilə gedir.
Bu sənəd quraşdırma addımlarını, qaydaları və nəyin testlə yoxlandığını, nəyin real mağaza tələb etdiyini dürüst yazır.

## Əsas qaydalar

- Oxuma alətləri (məhsul, sifariş, stok, kolleksiya) təsdiqsiz işləyir, yan təsiri yoxdur.
- Hər yazma (məhsul yaratma, yeniləmə, qiymət, stok, satışa çıxarma, arxivləmə, kolleksiya, webhook yaratma) YALNIZ Fərid-in təsdiqindən sonra icra olunur. Alət çağırışı yalnız təsdiq qeydi açır.
- Təsdiq mətni icra olunan əməliyyatın eynisidir: icra anında mətn yenidən hesablanır, fərqli olarsa icra bloklanır.
- "Köhnə dəyər" qaydası: qiymət, stok və yeniləmə qeydlərində təsdiqlənmiş köhnə dəyər var. İcra anında Shopify-dan yenidən oxunur, uyğun gəlmirsə `CONFLICT` verilir və heç nə yazılmır.
- Hər yazmadan sonra Shopify-dan geri oxunur. Fərq varsa `PROVIDER_ERROR`, saxta uğur yoxdur.
- Avtomatik təkrar yoxdur. Şəbəkə/vaxt xətasında nəticə "bilinmir" sayılır, Shopify admin-də yoxlayın.
- Silmə aləti YOXDUR. Yalnız `shopify.product.archive` (status ARCHIVED, geri qaytarıla bilər).
- Yeni məhsul həmişə `DRAFT` yaranır. `ACTIVE` yalnız təsdiq edilən sorğuda açıq yazılıbsa.
- Webhook qəbulu yalnız qeyd (event + audit) edir. Heç bir biznes əməliyyatı avtomatik icra olunmur.
- Token yalnız token anbarında (`secret:shopify`, `TOKEN_ENC_KEY` varsa AES-GCM ilə şifrəli) saxlanır. Cavabda, jurnalda, təsdiq qeydində və xəta mətnində görünmür.

## Mühit dəyişənləri

| Ad | Növ | Məcburi | Təsvir |
|---|---|---|---|
| `SHOPIFY_API_KEY` | Secret | bəli | Tətbiqin Client ID dəyəri |
| `SHOPIFY_API_SECRET` | Secret | bəli | Tətbiqin Client secret dəyəri (OAuth və webhook imzası üçün) |
| `SHOPIFY_SHOP` | Adi dəyişən | xeyr | Standart mağaza, məsələn `my-store.myshopify.com`. Verilərsə yalnız bu mağaza qoşula bilər |
| `SHOPIFY_SCOPES` | Adi dəyişən | xeyr | Vergüllə scope siyahısı. Standart: `read_products,write_products,read_orders,read_inventory,write_inventory` |
| `SHOPIFY_API_VERSION` | Adi dəyişən | xeyr | Standart `2026-07` |
| `PUBLIC_BASE_URL` | Adi dəyişən | bəli | Worker-in `https://...` ünvanı (sonda `/` olmadan). Sosial modulla ortaqdır |
| `TOKEN_ENC_KEY` | Secret | tövsiyə | Tokeni KV-də şifrələyir (sosial modulla ortaq) |

`customers` scope-u standart DEYİL. Sifarişdə alıcının yalnız adı və şəhəri oxunur (çatdırılma ünvanından), buna `read_customers` lazım deyil.
`read_all_orders` (60 gündən köhnə sifarişlər) də standart deyil, lazım olarsa `SHOPIFY_SCOPES`-a özünüz əlavə edin.
`shopify.inventory.get` və stok yeri axtarışı bəzi mağazalarda `read_locations` tələb edə bilər: `ACCESS_DENIED` / `PERMISSION_ERROR` görsəniz scope siyahısına `read_locations` əlavə edib yenidən qoşun.

## Quraşdırma addımları (Fərid üçün)

Komputer və terminal tələb olunmur, hamısı brauzerdən edilir.

1. Shopify tərəfi. Shopify Partner / Dev Dashboard-da (dev.shopify.com) yeni tətbiq yaradın (custom app). Shopify menyusunu tez-tez dəyişir, düymə adları fərqli ola bilər, bu addım real hesabda yoxlanmayıb.
2. Tətbiqin "Allowed redirection URL" sahəsinə dəqiq bunu yazın: `<PUBLIC_BASE_URL>/oauth/shopify/callback`
3. Scope-lar: yuxarıdakı standart siyahı (daha çox vermək lazım deyil, az vermək qoşulmanı rədd etdirir: modul istənilən scope-un verilməsini yoxlayır).
4. Tətbiqin Client ID və Client secret dəyərlərini götürün.
5. Cloudflare panelində: Workers > jarvis > Settings > Variables and Secrets bölməsinə `SHOPIFY_API_KEY` və `SHOPIFY_API_SECRET` dəyərlərini "Secret" kimi yazın. `SHOPIFY_SHOP` (istəyə bağlı) və `PUBLIC_BASE_URL` adi dəyişəndir. Dəyərləri nə söhbətə, nə Issue-ya, nə fayla yazmayın.
6. Worker-i yenidən yerləşdirin (Deploy).
7. Qoşulma: `POST /api/shopify/connect` (body `{"shop":"my-store.myshopify.com"}` və ya `SHOPIFY_SHOP` təyin olunubsa boş `{}`) cavabda `url` qaytarır. Həmin ünvanı brauzerdə açın, Shopify-da "Install" düyməsini basın. Shopify sizi `/oauth/shopify/callback` ünvanına qaytarır, səhifədə "Shopify qoşuldu" yazılır.
   (Bu marşrutların `index.js`-ə və UI-a bağlanması inteqrasiya mərhələsinin işidir. Parol başlığı bütün `/api/...` marşrutlarında məcburidir.)
8. Yoxlama: `GET /api/shopify/status` qoşulmuş mağazanı, scope-ları və "token var/yox" göstərir (token özü heç vaxt göstərilmir).
9. Ayırmaq: `POST /api/shopify/disconnect` JARVIS-dəki tokeni silir. Tətbiqi Shopify admin-dən də silmək tövsiyə olunur.

Qoşulma zamanı yoxlamalar: HMAC-SHA256 imzası (sabit-vaxtlı müqayisə), vaxt damğası (10 dəqiqədən təzə), mağaza domeni, bir dəfəlik `state` (10 dəqiqə), verilən scope-ların istənilənləri əhatə etməsi. Biri pozulsa token saxlanmır.

## Webhook-lar

Callback ünvanı: `<PUBLIC_BASE_URL>/shopify/webhook`. Qəbul olunan topic-lər: `products/update`, `products/create`, `orders/create`, `orders/updated`, `inventory_levels/update`, `app/uninstalled`.

Yaratmaq üçün iki yol:

- Alətlə: `shopify.webhooks.register` (təsdiq tələb edir, qeyddə ünvan və topic-lər görünür). Mövcud abunəliyi təkrar yaratmır, sonda siyahını yoxlayır. `shopify.webhooks.list` ilə baxmaq olar.
- Əl ilə: Shopify admin / tətbiq parametrlərində eyni ünvanı və topic-ləri əlavə edin.

Qəbul qaydaları: gövdə bir dəfə və olduğu kimi oxunur, `X-Shopify-Hmac-Sha256` (base64) `SHOPIFY_API_SECRET` ilə yoxlanır, topic icazə siyahısında olmalıdır, `X-Shopify-Shop-Domain` qoşulu mağaza ilə eyni olmalıdır, `X-Shopify-Webhook-Id` 3 gün saxlanır (təkrar çatdırılma "duplicate" kimi qəbul olunur və təkrar qeyd edilmir), gövdə 1 MB-dan böyük olarsa 413.
Qeyd olunan: topic, mağaza, id, ölçü və minimal xülasə (məhsul başlığı, sifariş nömrəsi/statusu, stok sayı). Tam yük və alıcı məlumatı saxlanmır. `app/uninstalled` gələndə token silinir.

## Alətlər

Oxuma (risk low, təsdiq yox): `shopify.shop.info`, `shopify.products.search` (maks 20), `shopify.product.get`, `shopify.orders.list` (maks 20, minimal sahələr), `shopify.order.get`, `shopify.inventory.get`, `shopify.collections.list`, `shopify.webhooks.list`, `shopify.product.prepare` (yan təsirsiz, deterministik).

Yazma (risk high, təsdiq məcburi):

| Alət | İcazə adı | Xüsusiyyət |
|---|---|---|
| `shopify.product.create` | yoxdur (risk high kifayətdir) | `prepare` qaralaması ilə. Status DRAFT. Eyni handle/başlıq varsa `CONFLICT`. Stok üçün `locationId` lazımdır |
| `shopify.product.update` | yoxdur | Başlıq, təsvir, satıcı, növ, etiket, SEO. `before` (köhnə dəyər) məcburidir. Status/qiymət/stok burada dəyişmir |
| `shopify.price.update` | `change.price` | Hər variant üçün `old_price` -> `new_price`. 2 dəfədən çox dəyişmə qeyddə xəbərdarlıq alır |
| `shopify.inventory.set` | `change.stock` | `old_quantity` -> `new_quantity` bir yerdə. Shopify tərəfində də `changeFromQuantity` müqayisəsi var |
| `shopify.product.publish` | yoxdur | DRAFT/ARCHIVED -> ACTIVE. Qiyməti 0 olan variant varsa rədd. Satış kanalına (Online Store) çıxarış daxil DEYİL |
| `shopify.product.archive` | yoxdur | ACTIVE/DRAFT -> ARCHIVED. Silmə deyil |
| `shopify.collection.add` | yoxdur | Maks 20 məhsul, əl ilə idarə olunan kolleksiya. Artıq üzv olan atlanır |
| `shopify.webhooks.register` | yoxdur | Yuxarıdakı webhook abunəlikləri |

Söhbət axını üçün köməkçilər (`src/shopify/tools.js`): `proposeCreateFromIdea`, `proposePriceUpdate`, `proposeInventorySet`, `proposeProductUpdate`, `proposePublish`, `proposeArchive`. Bunlar cari vəziyyəti OXUYUR, sonra təsdiq qeydi AÇIR, özləri heç nə yazmır.

Məhsul yaratma axını: fikir -> `shopify.product.prepare` (yoxlanmış qaralama, `issues`, `missing`) -> çatışmayanlar Fərid-dən soruşulur (qiymət, təsvir, şəkil uydurulmur) -> `shopify.product.create` təsdiq qeydi -> "təsdiq" -> DRAFT məhsul -> Shopify admin-də baxıb `shopify.product.publish` ilə ayrıca təsdiqlə satışa çıxarmaq.

## Limitlər

- Sorğu dərəcəsi: Shopify cavabındakı `throttleStatus` izlənir, balans 100-dən azdırsa növbəti sorğu (maks 5 san) gözləyir. 429 gələndə `RATE_LIMIT` və `Retry-After` qaytarılır. Oxuma alətləri bir dəfə avtomatik təkrar edilir, yazma alətləri heç vaxt.
- Vaxt limiti: hər Shopify çağırışı 20 san, yazma alətinin ümumi icrası 55 san.
- Məhsul: maks 20 variant, 10 şəkil, 20 etiket, təsvir 10 000 simvol, SEO başlıq 70, SEO təsvir 160.
- Variantlı məhsulda stok yaratma anında dəstəklənmir (yalnız tək variantda). Sonra `shopify.inventory.set` ilə ayrıca verilir.
- Şəkillər yalnız açıq https ünvanlarla verilir və Shopify tərəfindən asinxron yüklənir. Alət şəkil sayını yoxlamır, yalnız `images.attached` kimi bildirir.
- Sifarişlər: maks 20, yalnız nömrə, tarix, status, məbləğ, alıcının adı və şəhəri. Shopify qaydasına görə (yoxlanmayıb) `read_all_orders` olmadan yalnız son 60 günün sifarişləri görünür.

## Nə testlə yoxlanıb (saxta Shopify, real şəbəkə yoxdur)

`tests/shopify-core.test.mjs` və `tests/shopify-tools.test.mjs` (`npm test`):

- Mağaza domeni SSRF halları, scope/versiya konfiqurasiyası.
- OAuth: düzgün imza, yanlış imza, köhnə/gələcək vaxt damğası, təkrarlanan parametr, bir dəfəlik state (paralel 8 callback-dən biri keçir), başqa mağaza, scope uyğunsuzluğu (token saxlanmır), kod rədd olunması.
- Client: 401, 403, 404, 429 (+Retry-After), 5xx, GraphQL `errors` (THROTTLED, ACCESS_DENIED, INVALID_VARIABLE), `userErrors`, vaxt aşımı, şəbəkə xətası, token mətnə düşmür, throttle gözləməsi.
- Webhook: imza, topic, shop, id, ölçü, təkrar (10 paralel), pozulmuş JSON, `app/uninstalled`, biznes əməliyyatının OLMADIĞI (heç bir Shopify sorğusu, heç bir təsdiq qeydi).
- Hər yazma aləti ToolRegistry + ApprovalCenter + ActionRunner ilə: təsdiqdən əvvəl icra yox, 10 paralel icradan biri, köhnə dəyər uyğunsuzluğu (CONFLICT), geri oxuma uyğunsuzluğu (PROVIDER_ERROR), təkrar yaratma (CONFLICT), qeyd dəyişdirilərsə bloklanma, arxiv (silmə deyil, silmə əməliyyatı göndərilmir).
- `shopify.product.prepare`: Azərbaycan hərfləri, XSS təmizlənməsi, çatışmayan sahələrin bildirilməsi, qiymət/stok/variant/şəkil qaydaları, idempotentlik.
- Token heç bir qaytarılan dəyərdə, təsdiq qeydində və audit jurnalında yoxdur.
- GraphQL sənədlərinin hamısı (20 ədəd) Shopify Admin sxeminə qarşı MCP `validate_graphql_codeblocks` ilə yoxlanıb (sintaksis, sahə və tip uyğunluğu). Bu yoxlama mağaza tələb etmir və davranışı sübut etmir.

## Real mağaza tələb edən, YOXLANMAMIŞ şeylər

Aşağıdakılar yalnız real Shopify mağazasında ilk qoşulmadan sonra təsdiqlənə bilər. Saxta server Shopify-ın davranışını təxmin edir.

- Shopify-da tətbiqin yaradılması, OAuth quraşdırma ekranı və `access_token` cavabının dəqiq formatı (xüsusilə yeni nəsil tətbiqlərdə token müddəti və yenilənməsi: bu modul müddətsiz oflayn token fərz edir, `refresh` mexanizmi yoxdur).
- Scope-ların faktiki əhatəsi (`read_locations` lazım olub-olmaması, `shippingAddress` sahəsinin standart scope ilə açılması).
- `inventorySetQuantities` üçün Shopify-ın yeni API versiyalarında tələb edə biləcəyi `@idempotent` direktivi: sxem yoxlaması onu tələb etmədi, amma `2026-07` canlı davranışı yoxlanmayıb. İlk stok yazmasında xəta çıxarsa buradan başlayın.
- Məhsul yaratma ardıcıllığı (`productCreate` -> `productVariantsBulkUpdate` -> `productVariantsBulkCreate` -> stok aktivləşdirmə -> `inventorySetQuantities`): sxemə uyğundur, amma canlı mağazada real nəticə (xüsusilə stok yerinin aktivləşməsi, variant sırası, handle toqquşması) yoxlanmayıb.
- `media` ilə şəkil yükləmə və emalı.
- Shopify axtarışının (`handle:`, `title:"..."`) dublikat tapmaqda dəqiqliyi. Modul üç sorğu və yerli müqayisə edir, amma Shopify axtarış indeksi gecikməli ola bilər (yeni yaradılan məhsul bir neçə saniyə axtarışda görünməyə bilər, bu halda ard-arda iki yaratma sorğusu dublikat yarada bilər).
- Webhook-un Cloudflare-də real çatdırılması, `X-Shopify-*` başlıqlarının dəqiq adları və 1 MB limiti.
- Kolleksiyaya əlavə: yalnız əl ilə idarə olunan kolleksiyalar. Ağıllı (smart) kolleksiyada Shopify xəta qaytarır və bu `VALIDATION_ERROR` kimi görünür.
- Sürət limitinin real dəyərləri (plana görə fərqlənir).

## Problem həlli

- `AUTH_ERROR` "Shopify qoşulmayıb": əvvəlcə qoşulma addımlarını edin, və ya token ləğv olunub (yenidən qoşun).
- `PERMISSION_ERROR`: scope çatmır. `SHOPIFY_SCOPES`-u yoxlayın, tətbiqdə scope-ları yeniləyib yenidən qoşun.
- `CONFLICT`: təsdiqdən sonra Shopify-da dəyər dəyişib. Yeni təsdiq qeydi hazırlayın (köhnə dəyər yenidən oxunur).
- `PROVIDER_ERROR` "geri oxuma uyğun gəlmir": yazma qismən ola bilər. Mesajdakı id ilə Shopify admin-də baxın, təkrar yaratmayın.
- Qoşulma səhifəsində "imza düzgün deyil": `SHOPIFY_API_SECRET` yanlışdır və ya tətbiq başqa mağazaya aiddir.
