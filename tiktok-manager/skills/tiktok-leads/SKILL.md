---
name: tiktok-leads
description: Şərh və DM-lərdən potensial müştəriləri müəyyən edir və HOT/WARM/COLD kimi təsnif edir, hər biri üçün növbəti satış addımını verir.
---

# TikTok Leads

## Təsnifat (src/leads.js, izah olunan siqnallarla)
| Tier | Siqnal | Növbəti addım |
|---|---|---|
| HOT | alış niyyəti ("almaq istəyirəm", "necə sifariş"), ödəniş sualı, əlaqə nömrəsi, qiymət + çatdırılma birlikdə | Dərhal cavab, sifariş addımı, əlaqə kanalı |
| WARM | qiymət, mövcudluq, ölçü/rəng, maraq | Sual cavabı + yumşaq CTA (DM/link) |
| COLD | tərif, emoji, ümumi | Təşəkkür və ya cavab yox; satış təklifi yox |
| spam / complaint | follow back, link spam / şikayət, geri qaytarma | Spam: yox; şikayət: sahibə |

## Əmr
`node tiktok-manager/cli.mjs leads --file messages.json` → sıralanmış siyahı (HOT əvvəl) + təklif olunan cavab + `missing_facts`.

## Saxlama
Lead-lər `workspace/accounts/<id>/leads.json`-a yazılır (şəxsi məlumat, repo-ya getmir). Telefon nömrəsi kimi şəxsi data yalnız sahibin iş üçün istifadəsinə.

## Qadağa
Lead-ləri kənar siyahılara satmaq, icazəsiz kütləvi mesaj.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
