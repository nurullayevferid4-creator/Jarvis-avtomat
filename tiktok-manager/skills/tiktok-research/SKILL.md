---
name: tiktok-research
description: Auditoriya, rəqib və bazar araşdırması: yalnız real mənbələrlə (hesab datası, sahibin məlumatı, açılmış veb mənbələr). Rəsmi trend API-si olmadığını nəzərə alır.
---

# TikTok Research

## Nə edir
- Auditoriyanın ağrıları, sualları, dili (şərhlərdən — istifadəçi yapışdırırsa; API şərh vermir).
- Bazar/niche konteksti, rəqib hesabların açıq məzmunu (yalnız açıq veb səhifələr).
- Trend mövzular: **rəsmi trend API-si yoxdur** (`trends.discover` = UNSUPPORTED_BY_TIKTOK_API). TikTok Creative Center veb-saytdır: sahib əl ilə baxa bilər və ya veb axtarışla açıq səhifələr oxunur.

## Qaydalar
- Yalnız həqiqətən açdığın mənbəyə istinad et (URL). Açmadığın linki yazma.
- Auditoriya demoqrafiyası API-də yoxdur: "auditoriya" = sahibin bildirdiyi + kontent dili + şərh nümunələri. Hər birini mənbə ilə işarələ.
- Rəqib rəqəmləri (follower, baxış) yalnız açıq səhifədən oxunubsa və tarixi ilə.
- Research API (akademik) bu sistem üçün əlçatan deyil.

## Çıxış
`research.md`: auditoriya profili (mənbəli), 10 ağrı/sual, 5 mövzu bucağı, rəqib müşahidələri, mənbələr siyahısı.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
