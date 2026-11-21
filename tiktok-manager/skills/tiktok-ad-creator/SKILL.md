---
name: tiktok-ad-creator
description: Məhsul/xidmət tanıtımı, lead, DM, trafik, satış və brend məlumatlılığı üçün TikTok reklam videosu hazırlayır: Hook → Problem → Solution → Product → Benefit → Proof (yalnız real) → CTA.
---

# TikTok Ad Creator

## Məqsədlər və CTA
| Məqsəd | CTA nümunəsi | Ölçmə |
|---|---|---|
| Məhsul/xidmət tanıtımı | "Profildəki linkə bax" | views, shares |
| Lead generation | "DM-də 'X' yaz" | DM sayı (sahib bildirir), HOT lead |
| DM | "Sualın varsa DM yaz" | DM sayı |
| Website traffic | "Link bio-da" | sahibin sayt analitikası |
| Satış | "Sifariş üçün DM / link" | real satış (sahib) |
| Brand awareness | "İzlə, davamı gəlir" | views, followers |

## Struktur (məcburi)
```json
{ "hook": "...", "problem": "...", "solution": "...", "product": "...", "benefit": "...",
  "proof": { "text": "...", "evidence": { "source": "URL və ya sənəd", "verified": true } },
  "cta": "..." }
```
- `proof` yalnız real sübut varsa (`business.json → proof` və ya sahibin verdiyi mənbə). Yoxdursa **proof sahəsini çıxar** — `checkAd` saxta proof-u bloklayır.
- Saxta review, saxta müştəri, saxta "1000 satış", saxta before/after QADAĞANDIR.
- Qiymət/endirim/çatdırılma yalnız `business.json`-dan.
- Kommersiya açıqlaması: `publish.commercial_content: true`, öz biznesin üçün `brand_organic: true`.

## Paid ads
TikTok Ads Manager kampaniya yaratma bu modulun hissəsi deyil (Marketing API ayrıca developer girişi tələb edir). Kreativ paket hazırlanır, kampaniyanı sahib qurur.

## Çıxış
Reklam strukturu + ssenari + səhnələr → `tiktok-publisher` paketinə `ad` sahəsi kimi.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
