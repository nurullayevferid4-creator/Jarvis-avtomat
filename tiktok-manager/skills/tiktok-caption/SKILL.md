---
name: tiktok-caption
description: TikTok caption yazır: hook-u gücləndirən ilk sətir, kontekst, CTA; ≤2200 simvol (UTF-16) limitini və hesabın dilini nəzərə alır.
---

# TikTok Caption

## Qaydalar
- İlk sətir: hook-u təkrar etmə, tamamla (sual, maraq, fayda).
- 1–3 qısa sətir kontekst; açar sözlər təbii şəkildə (TikTok axtarışı üçün).
- CTA: bir dənə, aydın.
- Limit: caption + hashtag ≤ 2200 simvol (Direct Post `title`, UTF-16). `validate-package` yoxlayır.
- Qiymət/çatdırılma/ödəniş yalnız `business.json`-dan.
- Emoji ölçülü; hesabın tonuna uyğun.
- Kommersiya kontentidirsə paket `publish.commercial_content: true` + `brand_organic`/`brand_content` (TikTok açıqlama qaydası).

## Çıxış
`caption` (hashtag-sız) — hashtag-lar `tiktok-hashtags`-dan ayrıca.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
