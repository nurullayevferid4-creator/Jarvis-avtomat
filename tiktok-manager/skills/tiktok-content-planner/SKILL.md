---
name: tiktok-content-planner
description: Strategiyanı konkret kontent təqviminə çevirir: hansı gün hansı video, sütun, məqsəd, format, CTA. 'kontent planı', 'həftəlik plan' sorğularında.
---

# TikTok Content Planner

## Giriş
`strategy.md`, `account.json → performance`, `business.json`.

## Addımlar
1. Sütunları həftəyə payla (reach 50–60%, trust 25–30%, conversion 15–20% — data başqa göstərirsə ona uyğunlaşdır və səbəbini yaz).
2. Hər slot üçün: tarix, sütun, mövzu, format (talking head / tutorial / POV / before-after / behind the scenes / FAQ cavabı), hədəf uzunluq, hook tipi, CTA tipi, ölçmə metriki.
3. Paylaşım vaxtı: `weekday_utc` qruplarında `reliable:true` varsa istifadə et; yoxdursa "test" kimi müxtəlif günlər seç. Saatlar UTC-dədir, sahibin vaxt zonasına çevir (Bakı = UTC+4).
4. Rəsmi API-də planlı paylaşım yoxdur (`post.schedule` = UNSUPPORTED_BY_TIKTOK_API): təqvim xatırlatma/cron üçün; hər paylaşım yenə approval tələb edir.

## Çıxış
`content-plan.md` cədvəli + hər slot üçün `tiktok-video-ideas`-a ötürülən qısa brief.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
