# AUDIT — TikTok AI Manager (2026-10-08)

## 1. Repository auditi (işə başlamazdan əvvəl)

| Yoxlanan | Tapıntı | Qərar |
|---|---|---|
| Repo | `nurullayevferid4-creator/Jarvis-avtomat` — hesabda yeganə repo. JARVIS Voice Hub (Cloudflare Worker, Node, asılılıqsız) | TikTok modulu burada ayrıca qovluqda: `tiktok-manager/` |
| Instagram sistemi | `src/social/` (Instagram/TikTok/YouTube/Telegram adapterləri, `flow.js`, təsdiq mərkəzi `src/approval/`) | **Toxunulmayıb.** `git diff` yalnız `package.json` (2 skript) və `.github/workflows/ci.yml` (1 addım) göstərir |
| Mövcud TikTok adapteri | `src/social/adapters/TikTok.js`: yalnız Direct Post (tək parça ≤64 MB), scope `user.info.basic,video.publish` | Kopyalanmayıb. Yeni modul analiz (Display API), inbox axını, chunk yükləmə, reyestr və approval-u ayrıca qurur |
| `validate.py`, `build_bundles.py` | Repoda **yoxdur**; "Instagram Manager" skill paketi də bu repoda yoxdur | Hər ikisi bu modul üçün yazıldı (`scripts/`), yalnız stdlib |
| Testlər / CI | `npm test` (node:test), `scripts/static-audit.mjs`, `check-syntax.mjs`; CI sirsiz | Mövcud üslubda node:test; CI-yə bir addım əlavə olundu |
| Repo görünürlüyü | **Açıq (public)** | `workspace/`, `.secrets/`, `dist/` gitignore; `.env.example` boş dəyərlər; sirr skan testi |
| Qaydalar (CLAUDE.md, TEAM.md) | Uydurma yox, xarici icra yox, sirr yox, Azərbaycanca | Modulun qaydaları ilə eynidir |

## 2. API araşdırması: nə oxundu, nə yoxlanmadı

**Oxunub (developers.tiktok.com, 2026-10-08):** get user info (sahələr + scope), video list (max 20, cursor), video object (15 sahə; saves/reach/retention yoxdur), video query (≤20 id), rate limits (600/dəq: user.info, video.list, video.query), Direct Post (post_info sahələri, privacy dəyərləri, 6/dəq, unaudited → private, xəta kodları), Upload (inbox) (video.upload, 6/dəq), status fetch (30/dəq, status dəyərləri), creator info (20/dəq, sahələr), photo post (≤35 şəkil, 6/dəq), media transfer guide (chunk 5–64 MB, son ≤128 MB, ≤1000 chunk, ≤4 GB, formatlar), OAuth token idarəsi (endpoint-lər, 24 saat / 365 gün), scope siyahısı, Content Sharing Guidelines.

**Yoxlanmayıb:**
- TikTok API for Business (Organic API: şərhlər, insights, Business Messaging API: DM). Sənəd səhifələrinin mövcudluğu axtarışla təsdiqləndi ("Reply to a comment", "Get all replies to a comment", "Business Messaging API", "Video Insights reports"), amma səhifələr JS ilə render olunur və `business-api.tiktok.com` bu mühitin şəbəkə siyasəti ilə bloklanıb (HTTP 403). Endpoint/scope/limit detalları oxunmadı → **kodda yoxdur**, reyestrdə `UNSUPPORTED_BY_TIKTOK_API` + qeyd.
- Photo post `post_mode` dəyəri: sənəd cədvəlində "DIRECT POST", nümunədə "DIRECT_POST" yazılıb. Foto paylaşım CLI-də hələ istifadə olunmur.
- Sandbox/review axınının dəqiq UI addımları real app-da yoxlanmayıb.

## 3. Tələblərə uyğunluq

| Tələb | Necə təmin olunub | Sübut |
|---|---|---|
| API uydurulmur | Reyestr (`src/capabilities.js`) + client yalnız reyestrdəki SUPPORTED endpoint-ləri çağırır; skill-lərdəki hər `/v2/` endpoint `validate.py` ilə reyestrə qarşı yoxlanır | `tests/capabilities.test.mjs`, `tests/skills.test.mjs` (mənfi test daxil) |
| Fake adapter yoxdur | Şərh/DM/insights üçün adapter yazılmayıb; mock yalnız rəsmi endpoint-ləri təqlid edir və test qovluğundadır | kod |
| Fake engagement / spam yoxdur | `policy.js`: qadağan əməliyyat növləri, çoxdilli ifadə skaneri, kütləvi/soyuq DM, saxta proof | `tests/policy.test.mjs`, `tests/approval.test.mjs` |
| Approval | DRAFT→REVIEW→APPROVE→EXECUTE, `execute_enabled=false`, insan təsdiqi, hash, video hash, bir dəfə icra | `tests/approval.test.mjs` (11 test) |
| Sirlər qorunur | sirlər `cfg`-də sadalanmır, `redact`, token faylı 0600, çıxışda token yoxdur, repo skanı | `tests/secrets.test.mjs` |
| Unsupported düzgün işarələnib | reyestr statusu + skill sətir yoxlaması + client şəbəkəyə çıxmır | `tests/capabilities.test.mjs`, `validate.py` |
| Universal hesab | `open_id` əsaslı qovluqlar, aktiv hesab dəyişəndə profil yenidən qurulur, kodda hesab adı yoxdur | `tests/account.test.mjs` |
| Uydurma nəticə yoxdur | API-də olmayan metriklər `unavailable`; biznes faktları `NAMƏLUM`; `{{FAKT_LAZIMDIR}}` approval-ı bloklayır; "viral" əvəzinə "baxış potensialı" | `tests/analytics.test.mjs`, `tests/leads.test.mjs`, `tests/manager.test.mjs` |

## 4. İşə salınan yoxlamalar (real nəticə)

| Əmr | Nəticə |
|---|---|
| `python3 tiktok-manager/scripts/validate.py` | 20 skill, 0 xəta |
| `python3 tiktok-manager/scripts/build_bundles.py` | 20 bundle + `manifest.json` (zip testi keçdi) |
| `node --test tiktok-manager/tests/*.test.mjs` | 47/47 keçdi |
| `npm run check` (mövcud JARVIS) | lint + statik audit + 486 keçdi, 5 skip (canlı testlər), 0 xəta |
| CLI e2e (mock): analyze → prepare → execute (bloklandı: not_approved) → approve `--by claude` (rədd) → approve `--by Fərid` → execute (bloklandı: execute_disabled) → `TIKTOK_EXECUTE_ENABLED=true` execute | `EXECUTED`, `PUBLISH_COMPLETE` (mock) |

GitHub Actions-da işə salınma PR açıldıqdan sonra görünəcək.

## 5. Risklər və məhdudiyyətlər

- Real TikTok app və hesabla sınaq yoxdur: real cavab formatı sənəddən fərqlənərsə client xətanı `api_error` kimi qaytarır, uğur uydurmur.
- Audit olunmamış app-də ictimai paylaşım mümkün deyil (TikTok qaydası); sistem bunu həm paket yoxlamasında, həm API xətasında tutur.
- Follower artımı yalnız sistemin öz snapshot-larından: analiz müntəzəm işlədilməlidir.
- Hook analizi mətn əsaslıdır; vizual hook və retention API ilə ölçülmür.
- Lead təsnifatı açar söz qaydaları ilədir (izah olunan), dil modelinin mühakiməsi skill səviyyəsində əlavə olunur.
- Vaxt analizi UTC-dədir; sahibin vaxt zonasına çevrilməlidir.
