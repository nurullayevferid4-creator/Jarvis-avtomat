# Marketinq planlayıcısı

Kod: `src/marketing/`. Qoşulma: `registerMarketingTools(registry, { llm, now })` (`src/marketing/index.js`).

Bütün alətlər **risk low, yan təsirsiz**dir. Çıxış həmişə **qaralamadır** (`draft_only: true`, `published: false`). Heç nə dərc olunmur, planlaşdırılmır, göndərilmir. Dərc üçün mövcud təsdiqli `social.publish` axını istifadə olunur.

## Alətlər

| Alət | Nə verir |
|---|---|
| `marketing.campaign.plan` | Hədəf auditoriya, hook, vaxtlı ssenari, çəkiliş planı (shot list), caption, CTA, hashteqlər, platformalara görə nəşr planı (Instagram, TikTok, YouTube qeydləri ilə), A/B ideyaları |
| `marketing.captions` | Platforma üçün caption variantları (1-5) |
| `marketing.hashtags` | Təmiz, təkrarsız hashteqlər (maks 30, YouTube üçün maks 15) |
| `marketing.hooks` | İlk saniyələr üçün hook cümlələri (1-10) |
| `marketing.calendar` | N günlük (1-30) kontent təqvimi |
| `marketing.performance.analyze` | Sahibin verdiyi göstəricilər üzərində deterministik statistika |
| `marketing.segments` | Brend üçün seqment **fərziyyələri** (reyestrdən) |

İcazə adı `src/policy.js` `DEFAULT_PERMISSIONS`-a əlavə olunmalıdır: `use.marketing`.

## Model və şablon

`deps.llm = { completeJson({system, user, schema, maxTokens}), provider }` verilibsə, model çağırılır. Nəticə **etibar edilmir**:

1. sxem yoxlaması (`src/validate.js`),
2. təmizləmə: HTML, idarəedici simvollar, icazəsiz linklər silinir,
3. limitlər: IG caption ≤ 2200, TikTok caption ≤ 2200, YouTube başlıq ≤ 100, hashteq ≤ 30 (YouTube ≤ 15),
4. qadağan mövzu yoxlaması (QR Menu üçün rəqəmsəl vizit kartı/WeeCard),
5. **təsdiqsiz iddia** yoxlaması: qiymət, faiz, endirim, "pulsuz", zəmanət, "ən yaxşı" kimi iddialar yalnız sahibin giriş mətnində (məqsəd, mövzu, təklif, faktlar, qeydlər) varsa icazəlidir.

Model yoxdursa, xəta verirsə və ya nəticə yuxarıdakılardan keçmirsə **şablon** qaytarılır. Şablon həmişə görünən şəkildə işarələnir: `source: "template"`, `ai_generated: false`, `personalized: false`, `fallback_reason` və `notice` ("AI ilə yazılmayıb, fərdiləşdirilməyib"). Şablon AI kimi təqdim edilmir.

Sahibin giriş mətni modelə `<external_content>` qutusunda verilir: onun içindəki təlimatlar əmr sayılmır.

## Brendlər (`src/marketing/brands.js`)

- **`qr_menu`**: yalnız QR Menu məhsulu. Yeganə link `https://weenetwork.menu/ru/menu/29`. Rəqəmsəl vizit kartı / WeeCard **xatırlanmır və birləşdirilmir**, ta ki sahibin girişi onu açıq istəməyənədək (`include_digital_card: true` və ya giriş mətnində vizit kartı/WeeCard). Testlər bütün alətlərin QR Menu çıxışında `vizit`, `business card`, `WeeCard` olmadığını yoxlayır.
- **`fn_parfum`**: ümumi parfum brendi konteksti. Qiymət, stok, endirim, çatdırılma, məhsul adı və link **reyestrdə yoxdur və uydurulmur**. Çatışanlar `needs_owner_input` siyahısında qaytarılır; `facts` ilə verilən fakt siyahıdan çıxır və mətndə istifadə oluna bilir.

## `marketing.performance.analyze`

Giriş boşdursa və ya heç bir göstərici yoxdursa: `status: "insufficient_data"`, rəqəm yoxdur. Verilməyən göstərici 0 sayılmır (`null`). Hesablanır: cəmlər, ortalama/median, hər paylaşım üçün ER = (like+comment+share+save) / views, ümumi ER, ən yaxşı/ən zəif, platformaya görə orta ER, tarixli ≥4 paylaşımda tendensiya. 3-dən az paylaşımda `status: "limited"`. **Xarici etalon və "sənaye ortalaması" yoxdur.**

## Sahib necə istifadə edir

1. `marketing.campaign.plan` ilə brend və mövzu verir; varsa `facts` (qiymət, təklif və s.) və `offer` yazır. Verməyibsə qiymət/endirim mətndə görünməyəcək.
2. `source` sahəsinə baxır: `template` və ya `claude`/`openai`. Şablonu öz məlumatları ilə tamamlayır.
3. `needs_owner_input` siyahısını doldurur.
4. Mətni özü yoxlayır və dərc üçün ayrıca təsdiqli axından istifadə edir.
5. Dərcdən sonra platforma rəqəmlərini `marketing.performance.analyze`-ə verir.

## İnterfeys-yalnız və yoxlanmayanlar

- Model inteqrasiyası (`deps.llm`) bu modulda **yazılmayıb**: yalnız `completeJson` müqaviləsi var, testlər saxta model işlədir. Real Claude/OpenAI nəticəsi bu süzgəclərdən keçəndə nə qədər tez-tez şablona düşəcəyi bilinmir.
- Şablon mətnləri qısa və ümumidir; keyfiyyəti marketoloq səviyyəsində deyil.
- Platforma qeydləri (məs. "link caption-da klikləmir, bio linkini planlayın") ümumi biliyə əsaslanır, bu sessiyada rəsmi sənəddən yoxlanmayıb: "platformada yoxlayın" qeydi ilə verilir. YouTube hashteq limiti 15 ehtiyatlı seçimdir, yoxlanmayıb.
- Seqmentlər ölçülmüş auditoriya deyil, fərziyyədir (`hypothesis: true`, `validated: false`).
- İddia aşkarlama naxışlarla işləyir (qiymət/faiz/açar sözlər): bütün üstünlük iddialarını tutmaya bilər. Dərcdən əvvəl insan yoxlaması məcburidir.
- QR Menu üçün vizit kartı/WeeCard qadağası naxışa əsaslanır (`vizit`, `business card`, `WeeCard`, `digital card`); fərqli yazılış və ya tərcümə yaxalanmaya bilər. Giriş mətnində bu sözlərdən biri varsa (məsələn "vizit kartı istəmirəm") sistem onu açıq istək kimi oxuyur.
