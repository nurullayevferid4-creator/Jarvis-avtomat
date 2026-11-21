---
name: tiktok-script-writer
description: Seçilmiş hook və ideyadan TikTok video ssenarisi yazır: hook → dəyər → sübut (yalnız real) → CTA, saniyə hesabı ilə.
---

# TikTok Script Writer

## Struktur (organik)
1. **Hook** (0–3s) — `tiktok-hooks`-dan.
2. **Kontekst** (3–6s) — niyə vacibdir.
3. **Dəyər** (əsas hissə) — 1 fikir, 2–4 addım/fakt.
4. **Sübut** — yalnız real (sahibin işi, öz nəticəsi, `business.json → proof` verified). Yoxdursa bu hissəni çıxar.
5. **CTA** — `tiktok-sales`-dən, video məqsədinə uyğun.

Reklam ssenarisi üçün `tiktok-ad-creator` strukturundan istifadə et.

## Qaydalar
- Danışıq dili, qısa cümlələr; hesabın dilində. Sonra `tiktok-humanizer`.
- Hədəf uzunluq hesabda ən yaxşı işləyən qrupdan; creator `max_video_post_duration_sec`-i aşmasın.
- Qiymət/çatdırılma/ödəniş yalnız `business.json`-dan; yoxdursa `{{FAKT_LAZIMDIR:price}}`.
- "Viral olacaq", saxta statistika, saxta müştəri hekayəsi yoxdur.

## Çıxış
`script: [{ "label", "start", "end", "text" }]` + tam voice-over mətni.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
