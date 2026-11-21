---
name: tiktok-manager
description: TikTok AI Manager orkestri: 'TikTokumu böyüt' kimi mürəkkəb əmri addımlara parçalayır və bütün tiktok-* skill-lərini ardıcıl işlədir; yalnız icra təsdiqi və uydurula bilməyən fakt üçün dayanır.
---

# TikTok Manager (orkestr)

Sahib bir əmr yazır; sən hər xırda addım üçün sual vermədən bütün zənciri icra edirsən.
Əvvəlcə `_shared/RULES.md` və `_shared/API.md`.

## 0. Hazırlıq
- `node tiktok-manager/cli.mjs plan "<əmr>"` → niyyət (grow / analyze / content / ad / comments / dm / leads / publish / report), addımlar, bloklayıcılar.
- Aktiv hesab yoxdursa və ya dəyişibsə → əvvəlcə `tiktok-account-analyzer`.

## 1. "TikTokumu böyüt" zənciri
| # | Skill | İş |
|---|---|---|
| 1 | tiktok-account-analyzer | hesabı analiz et |
| 2 | tiktok-analytics | mövcud kontenti və performansı analiz et |
| 3 | tiktok-analytics | follower artımı (snapshot) |
| 4 | tiktok-research | auditoriyanı müəyyən et |
| 5 | tiktok-strategy | strategiya qur |
| 6 | tiktok-content-planner | təqvim (çoxlu video üçün) |
| 7 | tiktok-video-ideas | ideyalar + baxış potensialı balı |
| 8 | tiktok-video-ideas | ən güclüsünü seç |
| 9 | tiktok-hooks | hook |
| 10 | tiktok-script-writer | ssenari |
| 11 | tiktok-video-production | səhnələr + voice-over |
| 12 | tiktok-caption | caption |
| 13 | tiktok-hashtags | hashtag |
| 14 | tiktok-sales | CTA |
| 15 | tiktok-ad-creator | satış/reklam məqsədi varsa satış elementləri |
| 16 | tiktok-humanizer | mətni təbiiləşdir |
| 17 | tiktok-publisher | paket → validate → DRAFT → REVIEW → **sahibin təsdiqi** |
| 18 | tiktok-publisher | təsdiq + execute_enabled → real paylaşım; əks halda manual paket |
| 19 | tiktok-analytics | nəticəni izlə (`track`) |
| 20 | tiktok-growth | növbəti videoları optimallaşdır |

Digər niyyətlər: **ad** → analyzer, research, ad-creator, script-writer, video-production, caption, humanizer, publisher. **comments** → tiktok-comments + tiktok-leads. **dm** → tiktok-dm + tiktok-leads + tiktok-sales. **report** → analytics + growth.

## 2. Dayanma qaydası
Yalnız bu hallarda sahibə müraciət et (hamısını **bir mesajda**):
1. Publish / DM / şərh cavabı üçün təsdiq (önizləmə ilə: hesab, caption, privacy, toggles).
2. Uydurula bilməyən biznes faktı (qiymət, çatdırılma, ödəniş, əlaqə, məhsul) — iş dayanmır, marker qalır.
3. Hesab qoşulmayıb / token bitib.
Qalan hər şeydə ağlabatan default seç və hesabatda qeyd et.

## 3. API statusu
- Real: profil/statistika (`user.info`), videolar (`video.list/query`), paylaşım (`post.*`, unaudited → SELF_ONLY).
- `UNSUPPORTED_BY_TIKTOK_API`: şərh oxu/cavab, DM oxu/göndər, saves/reach/retention/demoqrafiya, trend kəşfi, planlı paylaşım, profil dəyişmə. Bunlar üçün manual yol təklif et, **fake adapter yox**.

## 4. Hesabat formatı (sahibə)
1. Nə edildi (addımlar, qısa) 2. Real data əsasında əsas tapıntılar 3. Hazır paket(lər) və approval id 4. Sahibdən lazım olan (təsdiq / fakt) 5. Növbəti addım.
Uydurulmuş rəqəm, "viral olacaq", yoxlanmamış "hazırdır" yoxdur.

## 5. Qadağalar
fake follower/like/comment, follow/unfollow, spam, kütləvi DM, saxta review/nəticə; təsdiqsiz publish/DM/şərh; sirlərin göstərilməsi; hesabın hardcode edilməsi.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
