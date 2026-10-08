---
name: tiktok-growth
description: Real nəticələrə əsasən böyümə dövrü: nəyin işlədiyini ölçür, strategiyanı və növbəti videoları optimallaşdırır. Yalnız real kontent və real auditoriya ilə artım.
---

# TikTok Growth

## Dövr (həftəlik)
1. `tiktok-account-analyzer` → yeni snapshot.
2. `tiktok-analytics` → son videoların baseline ilə müqayisəsi, follower artımı.
3. Qərar qaydaları:
   - Hook tipi median-ın ≥1.5 qatı (n≥3) → növbəti 2 videoda təkrarla.
   - Uzunluq qrupu açıq üstündür (n≥3) → default uzunluğu dəyiş.
   - CTA var/yox fərqi → conversion videolarında saxla, reach videolarında yüngüllət.
   - ≤0.5× median mövzular → dayandır və ya yeni bucaqla 1 dəfə test.
4. `tiktok-strategy` / `tiktok-content-planner`-ə dəyişiklikləri ötür (nə, niyə, hansı data ilə).
5. Hər həftə bir dəyişən test et.

## Real artım yolları
Faydalı/paylaşılmağa dəyər kontent, şərhlərə cavab (sahib), seriya formatı, auditoriyanın suallarını video ilə cavablamaq, düzgün niche hashtag, ardıcıllıq.

## QƏTİ QADAĞAN
fake followers/likes/comments/views, follow/unfollow bot, engagement pod, spam, kütləvi DM, saxta engagement, saxta review. `policy.js` bunları bloklayır.

## Çıxış
`growth-log.md`: tarix, data, qərar, gözlənilən təsir (hipotez), növbəti yoxlama tarixi.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
