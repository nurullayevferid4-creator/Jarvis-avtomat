# TikTok AI Manager

TikTok üçün universal AI idarəetmə sistemi: istənilən TikTok hesabı qoşulanda əvvəlcə hesabı rəsmi API ilə analiz edir, sonra həmin hesabın biznesinə, auditoriyasına, dilinə və məqsədinə uyğun strategiya, video ideyası, hook, ssenari, səhnə, voice-over, caption, hashtag, CTA, reklam və paylaşım paketi hazırlayır. Real paylaşım yalnız sahibin təsdiqindən sonra və yalnız rəsmi TikTok Content Posting API ilə olur.

> **Dürüst status:** kod, 20 skill, mock inteqrasiya və testlər hazırdır və yoxlanıb. **Real TikTok hesabı və real TikTok app ilə hələ sınaq keçirilməyib**: bu, sənin TikTok Developer app-ını və tokenini tələb edir. Bütün testlər mock transport ilə işləyir; mock nəticələri real nəticə deyil.

Bu modul JARVIS-in mövcud Instagram/sosial hissəsinə (`src/social/`) toxunmur. Ayrıca qovluqdur və öz runtime-ı (Node 22, asılılıqsız) var.

## Skill-lər (20)

| # | Skill | Nə edir |
|---|---|---|
| 1 | `tiktok-account-analyzer` | Hesabı analiz edir, `workspace/account-profile.md` qurur |
| 2 | `tiktok-strategy` | KPI zənciri, kontent sütunları, format, test planı |
| 3 | `tiktok-research` | Auditoriya/bazar araşdırması (yalnız real mənbə) |
| 4 | `tiktok-content-planner` | Kontent təqvimi |
| 5 | `tiktok-video-ideas` | İdeyalar + şəffaf "baxış potensialı" balı |
| 6 | `tiktok-hooks` | İlk 1–3 saniyə (söz + ekran mətni + kadr) |
| 7 | `tiktok-script-writer` | Ssenari |
| 8 | `tiktok-video-production` | Səhnələr, voice-over, çəkiliş/montaj planı |
| 9 | `tiktok-caption` | Caption (≤2200 simvol) |
| 10 | `tiktok-hashtags` | Hashtag dəsti (hesabın real hashtag datası ilə) |
| 11 | `tiktok-ad-creator` | Hook → Problem → Solution → Product → Benefit → Proof (real) → CTA |
| 12 | `tiktok-publisher` | Paket → yoxlama → approval → rəsmi paylaşım / manual paket |
| 13 | `tiktok-comments` | Şərh təsnifatı və cavab qaralaması |
| 14 | `tiktok-dm` | DM cavab sistemi (mesaj → ehtiyac → məhsul → cavab → lead → satış) |
| 15 | `tiktok-leads` | HOT / WARM / COLD |
| 16 | `tiktok-sales` | CTA, təklif, lead → satış |
| 17 | `tiktok-analytics` | Real nəticələr, qruplar, follower artımı, baseline müqayisəsi |
| 18 | `tiktok-humanizer` | Təbii danışıq dili |
| 19 | `tiktok-growth` | Nəticəyə görə optimallaşdırma dövrü |
| 20 | `tiktok-manager` | Orkestr: bütün skill-ləri idarə edir |

"TikTokumu böyüt" yazanda `tiktok-manager` 20 addımlıq zənciri özü icra edir (analiz → performans → artım → auditoriya → strategiya → təqvim → ideyalar → seçim → hook → ssenari → səhnələr → caption → hashtag → CTA → satış elementləri → təbiiləşdirmə → paket → **təsdiq** → paylaşım → nəticə izləmə → optimallaşdırma). Yalnız 3 halda dayanır: paylaşım/DM/şərh təsdiqi, uydurula bilməyən biznes faktı, qoşulmamış hesab.

## Arxitektura

```
Sahib: "TikTokumu böyüt"
  → tiktok-manager (skill) → cli.mjs plan  (niyyət + addımlar + bloklayıcılar)        src/manager.js
  → tiktok-account-analyzer → cli.mjs analyze                                          src/account.js
       rəsmi API: GET /v2/user/info/, POST /v2/video/list/                             src/client.js
       → workspace/account-profile.md + accounts/<open_id>/{account,videos,snapshots,business}.json
  → tiktok-analytics (real metriklər, qruplar, follower snapshot)                       src/analytics.js
  → strategiya / ideya / hook / ssenari / səhnə / caption / hashtag / CTA / reklam (Claude, skill-lər)
       ideya balı: cli.mjs score-ideas                                                  src/content.js
       paket yoxlaması + siyasət: cli.mjs validate-package                              src/content.js, src/policy.js
  → tiktok-publisher → cli.mjs prepare → DRAFT → REVIEW                                 src/publisher.js, src/approval.js
       → sahib: "təsdiq" → cli.mjs approve <id> --by <ad> → APPROVED
       → cli.mjs execute <id>  (execute_enabled=true olmalıdır) → Content Posting API
       → cli.mjs track <video_id> → nəticə → tiktok-growth
```

| Fayl | Rol |
|---|---|
| `src/capabilities.js` | Rəsmi API reyestri: endpoint, method, scope, hesab/token tələbi, limit, status, mənbə. Sistemin yeganə "nə edə bilərəm" mənbəyi |
| `src/client.js` | Rəsmi API müştərisi; reyestrdə olmayan və ya UNSUPPORTED funksiyada **şəbəkəyə çıxmır** |
| `src/config.js` | Env var-lar, sirlərin gizlədilməsi (`redact`), token faylı (0600) |
| `src/approval.js` | DRAFT → REVIEW → APPROVE → EXECUTE, payload hash, bir dəfə icra |
| `src/policy.js` | Fake engagement, spam, kütləvi/soyuq DM, saxta proof, viral zəmanəti, uydurma qiymət/çatdırılma bloklanır |
| `src/account.js` | Universal hesab analizi və profil |
| `src/analytics.js` | Performans, follower artımı (snapshot), baseline |
| `src/leads.js` | HOT/WARM/COLD və cavab skeleti |
| `src/content.js` | İdeya balı, paket yoxlaması (TikTok paylaşım qaydaları), manual paket |
| `src/publisher.js` | Paylaşım hazırlığı və icraçı |
| `src/manager.js` | Orkestr planı |
| `src/workspace.js` | Hesab yaddaşı |
| `cli.mjs` | Skill-lərin istifadə etdiyi əmrlər |
| `mock/` | Yalnız test üçün mock TikTok (real deyil) |
| `scripts/validate.py`, `scripts/build_bundles.py` | Skill yoxlaması və bundle build |

## API inteqrasiyaları və statuslar

Mənbə: developers.tiktok.com rəsmi sənədləri (2026-10-08 oxunub). Tam cədvəl: `skills/_shared/API.md` (reyestrdən avtomatik).

### Real (rəsmi API ilə hazır)

| Funksiya | Endpoint | Scope | Limit |
|---|---|---|---|
| OAuth avtorizasiya | `GET https://www.tiktok.com/v2/auth/authorize/` | — | — |
| Token / refresh | `POST /v2/oauth/token/` | — | access 24 saat, refresh 365 gün |
| Revoke | `POST /v2/oauth/revoke/` | — | — |
| Profil, bio, statistika | `GET /v2/user/info/` | user.info.basic, user.info.profile, user.info.stats | 600/dəq |
| Video siyahısı + views/likes/comments/shares | `POST /v2/video/list/` | video.list | ≤20/səhifə, 600/dəq |
| Video yeniləmə | `POST /v2/video/query/` | video.list | ≤20 id, 600/dəq |
| Creator info | `POST /v2/post/publish/creator_info/query/` | video.publish | 20/dəq |
| Direct Post | `POST /v2/post/publish/video/init/` + `PUT upload_url` | video.publish | 6/dəq; **audit olunmamış app → yalnız SELF_ONLY** |
| Inbox-a yükləmə (tətbiqdə tamamlanır) | `POST /v2/post/publish/inbox/video/init/` | video.upload | 6/dəq |
| Paylaşım statusu | `POST /v2/post/publish/status/fetch/` | video.publish / video.upload | 30/dəq |
| Foto paylaşım (reyestrdə, CLI-də hələ yoxdur) | `POST /v2/post/publish/content/init/` | video.publish / video.upload | 6/dəq, verifikasiya olunmuş domen |

Yükləmə qaydaları: chunk 5–64 MB (son ≤128 MB), 1–1000 chunk, video ≤4 GB, MP4/MOV/WebM, `upload_url` 1 saat etibarlıdır.

### UNSUPPORTED_BY_TIKTOK_API (bu sistemin istifadə etdiyi rəsmi API-də yoxdur)

| Funksiya | Səbəb | Alternativ |
|---|---|---|
| Şərhləri oxumaq / cavab göndərmək | Display API yalnız `comment_count` verir | Sahib şərhləri yapışdırır → təsnifat + cavab qaralaması → əl ilə göndərir |
| DM oxumaq / göndərmək | Login Kit / Display / Content Posting API-də DM yoxdur | Sahib mesajı yapışdırır → cavab qaralaması → əl ilə göndərir |
| Saves, reach, impressions, retention, watch time, profil baxışı, demoqrafiya | Video Object-də yoxdur | Sahib TikTok Analytics ekranını verə bilər |
| Follower tarixçəsi | API yalnız cari sayı verir | Sistem öz snapshot-larından hesablayır |
| Video faylı / görüntü və səs analizi | API fayl vermir (yalnız örtük şəkli, link) | Sahib video faylını verir |
| Trend hashtag/səs kəşfi | Rəsmi trend API-si yoxdur (Research API akademikdir) | Creative Center (veb, əl ilə) |
| Planlı paylaşım | `schedule` parametri yoxdur | Təsdiqli paket + xatırlatma |
| Bio/profil dəyişmək | Yazma endpoint-i yoxdur | Əl ilə |
| Avtomatik like/follow/şərh | Yoxdur və **qadağandır** | — |

**Qeyd (Business API):** TikTok API for Business (Organic API və Business Messaging API) rəsmi sənədlərində Business hesablar üçün öz videolarındakı şərhləri oxumaq/cavablamaq, insights və DM səhifələri var. Bunlar ayrıca Business developer app, Business hesab, TikTok təsdiqi və (DM üçün) region/uyğunluq tələb edir. Bu mühitdən sənəd gövdələri oxuna bilmədiyi üçün endpoint/scope detalları **yoxlanmayıb** və kodda **adapter yoxdur** (fake adapter yaradılmayıb). Giriş alındıqdan sonra sənədlə yoxlanmış ayrıca adapter yazmaq növbəti mərhələdir.

### Mock olanlar
`mock/transport.mjs` yalnız testlər və `TIKTOK_MOCK=1` üçündür: rəsmi endpoint-ləri və sənəddəki xəta kodlarını (`unaudited_client_can_only_post_to_private_accounts`, `access_token_invalid`, `rate_limit_exceeded` ...) təqlid edir, reyestrdən kənar yola 404 verir. Mock data (`mock/fixtures/`) uydurma test hesabıdır, real hesab deyil.

## Permissions (TikTok scope-ları)

| Scope | Nə üçün | Məhsul |
|---|---|---|
| `user.info.basic` | open_id, ad, avatar | Login Kit |
| `user.info.profile` | username, bio, verified, profil linki | Login Kit |
| `user.info.stats` | follower, following, likes, video sayı | Login Kit |
| `video.list` | videolar və onların metrikləri | Display API |
| `video.publish` | Direct Post + creator info | Content Posting API |
| `video.upload` | inbox-a qaralama yükləmə | Content Posting API |

## Credentials (environment variables)

Sirlər kodda yoxdur. Lokal: `tiktok-manager/.env` (gitignore) və ya shell env; server: Secrets. Nümunə: `.env.example` (boş dəyərlər).

| Dəyişən | Sirr | Lazımdır |
|---|---|---|
| `TIKTOK_CLIENT_KEY` | yox | OAuth |
| `TIKTOK_CLIENT_SECRET` | **bəli** | OAuth |
| `TIKTOK_REDIRECT_URI` | yox | OAuth (app-dakı ilə eyni) |
| `TIKTOK_SCOPES` | yox | istəyə bağlı |
| `TIKTOK_ACCESS_TOKEN` | **bəli** | API (və ya token faylı) |
| `TIKTOK_REFRESH_TOKEN` | **bəli** | avtomatik yeniləmə |
| `TIKTOK_OPEN_ID` | yox | istəyə bağlı (token cavabından gəlir) |
| `TIKTOK_TOKEN_FILE` | yox | standart `tiktok-manager/.secrets/token.json` (0600, gitignore) |
| `TIKTOK_API_VERSION` | yox | `v2` (yeganə yoxlanmış versiya) |
| `TIKTOK_EXECUTE_ENABLED` | yox | standart `false` |
| `TIKTOK_APP_AUDITED` | yox | standart `false` → yalnız SELF_ONLY |
| `TIKTOK_WORKSPACE_DIR` | yox | istəyə bağlı |
| `TIKTOK_MOCK` | yox | test |
| `TIKTOK_BUSINESS_APP_ID`, `TIKTOK_BUSINESS_SECRET`, `TIKTOK_BUSINESS_ACCESS_TOKEN` | secret/token **bəli** | gələcək Business API (hələ istifadə olunmur) |

`node tiktok-manager/cli.mjs config` yalnız "set/unset" göstərir, dəyəri heç vaxt.

## Approval sistemi

```
DRAFT ──(siyasət yoxlaması keçdi)──► REVIEW ──(sahib "təsdiq")──► APPROVED ──(execute_enabled=true)──► EXECUTED | FAILED
   └─ pozuntu varsa REVIEW-a keçmir          └─ agent/bot təsdiq verə bilməz      └─ payload/video dəyişibsə BLOKLANIR
```
- Standart `execute_enabled=false`: təsdiqlənsə də heç nə paylaşılmır, manual paket verilir.
- Publish, DM, şərh cavabı təsdiqsiz heç vaxt icra olunmur. DM və şərh cavabı API-də olmadığı üçün təsdiqdən sonra da yalnız əl ilə göndərilir.
- Payload SHA-256 hash-i REVIEW-da yazılır; video faylının hash-i icradan əvvəl yoxlanır.
- Bir dəfə icra; xəta olarsa `FAILED`, avtomatik təkrar yoxdur.
- TikTok Content Sharing Guidelines: privacy default-suz (sahib seçir), şərh/duet/stitch açıq seçimlə, kommersiya açıqlaması, AI etiketi, paylaşımdan əvvəl ən son creator info.

## Universal hesab

Heç bir hesab hardcode edilməyib (test bunu yoxlayır). Hər hesab `workspace/accounts/<open_id>/` qovluğunda; aktiv hesabın profili `workspace/account-profile.md`. Başqa hesab qoşulanda `analyze` profili yenidən qurur. Biznes faktları (məhsul, qiymət, çatdırılma, ödəniş, auditoriya, bazar, məqsəd) API-də yoxdur: sahib `business.json`-u doldurur, doldurulmayan sahə `NAMƏLUM` qalır və satış mətnində `{{FAKT_LAZIMDIR:...}}` markeri approval-ı bloklayır. `workspace/` gitignore-dadır (repo açıqdır).

## Sənin etməli olduğun addımlar

1. **developers.tiktok.com** → hesab yarat → *Manage apps* → *Connect an app*.
2. App-a məhsulları əlavə et: **Login Kit**, **Content Posting API** (Direct Post-u aktiv et).
3. Scope-ları əlavə et: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.publish`, `video.upload`.
4. **Redirect URI** qeyd et (məs. öz domenində `https://.../oauth/tiktok/callback`) → `TIKTOK_REDIRECT_URI`.
5. Client key / secret → `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (yalnız lokal `.env` və ya Secrets; çata yazma).
6. Sandbox-da test istifadəçisi kimi öz TikTok hesabını əlavə et və app-ı review-a göndər.
7. İctimai paylaşım üçün **Content Posting API audit**-inə müraciət et. Audit olunana qədər paylaşımlar yalnız `SELF_ONLY` olacaq.
8. Business funksiyaları (şərh/DM/insights) lazımdırsa: TikTok **Business** hesabı + TikTok API for Business developer qeydiyyatı (ayrıca proses).

## Real hesaba qoşulma (son addımlar)

```bash
cp tiktok-manager/.env.example tiktok-manager/.env    # doldur, commit etmə
set -a; . tiktok-manager/.env; set +a
node tiktok-manager/cli.mjs config                    # hamısı "set" olmalıdır
node tiktok-manager/cli.mjs auth-url                  # linki aç, TikTok-da icazə ver
node tiktok-manager/cli.mjs exchange --code <callback-dakı code>   # token .secrets/-ə 0600 ilə yazılır
node tiktok-manager/cli.mjs analyze                   # workspace/account-profile.md
# business.json-u doldur, sonra Claude-a: "TikTokumu böyüt"
# ilk paylaşım: privacy SELF_ONLY, sonra TIKTOK_EXECUTE_ENABLED=true ilə bir dəfə execute
```

## Testlər

```bash
npm run build:tiktok   # API.md yenilə → validate.py → 20 bundle (dist/*.skill + manifest.json)
npm run test:tiktok    # validate.py + 47 test (mock, real şəbəkə yoxdur)
npm run check          # mövcud JARVIS testləri (dəyişməyib)
```

Nəticə (2026-10-08): `validate.py` 20 skill, 0 xəta; 20 bundle; TikTok testləri 47/47; mövcud JARVIS testləri 486 keçdi, 5 skip (canlı testlər), 0 xəta. Testlər yoxlayır: API uydurulmur (çağırılan hər endpoint rəsmi siyahıdadır, UNSUPPORTED funksiyada şəbəkə çağırışı sıfırdır), fake engagement/spam/saxta proof bloklanır, approval işləyir (təsdiqsiz, agent təsdiqi, execute_disabled, hash dəyişikliyi, video dəyişikliyi, ikinci icra), sirlər çıxışa/fayla düşmür, UNSUPPORTED funksiyalar düzgün işarələnib, iki fərqli hesabla universal məntiq. Ətraflı: `AUDIT.md`.
