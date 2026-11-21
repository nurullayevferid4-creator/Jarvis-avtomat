---
name: tiktok-strategy
description: Hesab profili və real performans datasına əsasən TikTok kontent strategiyası qurur: KPI zənciri, kontent sütunları, format, uzunluq, tezlik, CTA. 'strategiya qur', 'nə paylaşım' kimi sorğularda.
---

# TikTok Strategy

## Giriş
- `workspace/account-profile.md` (yoxdursa əvvəlcə `tiktok-account-analyzer`)
- `account.json → performance.groups` (hook_pattern, duration, cta, hashtags, weekday_utc)
- `business.json` (məqsəd, məhsul, auditoriya)

## KPI zənciri
VIEWS → ENGAGEMENT → FOLLOWERS → PROFILE VISITS → LEADS → SALES
- Views/engagement/followers: API ilə ölçülür.
- Profile visits: `UNSUPPORTED_BY_TIKTOK_API` (Display API) → proxy: bio linki klikləri (sahibin öz analitikası), DM sayı (sahib bildirir).
- Leads/sales: `tiktok-leads` və sahibin bildirdiyi real satışlar.

## Strategiya strukturu
1. **Diaqnoz (data):** median baxış, top/bottom fərqi, işləyən/zəif hook tipləri, uzunluq qrupları. `reliable:false` qruplara "hipotez" de.
2. **Məqsəd:** 30 günlük ölçülə bilən hədəf (məs. median baxışı X-dən Y-ə). Rəqəm yalnız hazırkı median-dan hesablanır; zəmanət yoxdur.
3. **Kontent sütunları (3–4):** hər biri üçün məqsəd (reach / trust / conversion), format, nümunə mövzu. Data varsa işləyən mövzuları prioritetləşdir.
4. **Format və uzunluq:** hesabda ən yaxşı median olan uzunluq qrupu; data yoxdursa 15–30s ilə başla və test et.
5. **Tezlik:** sahibin real istehsal gücünə görə (soruşulmayıbsa default: həftədə 4 video) — keyfiyyət > say.
6. **CTA sistemi:** reach videolarında yüngül CTA (şərh/izlə), conversion videolarında DM/link.
7. **Test planı:** hər həftə 1 dəyişən (hook tipi və ya uzunluq), nəticə `tiktok-analytics` ilə ölçülür.
8. **Qadağalar:** fake engagement, spam, follow/unfollow — strategiyaya heç vaxt daxil edilmir.

## Çıxış
`workspace/accounts/<id>/strategy.md`: diaqnoz → məqsəd → sütunlar → format → təqvim → test planı → ölçmə. Hər iddianın yanında mənbə: `[API data]`, `[sahib]`, `[hipotez]`.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
