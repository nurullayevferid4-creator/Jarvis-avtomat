---
name: tiktok-analytics
description: Real TikTok nəticələrini izləyir və analiz edir: video performansı, hook/mövzu/uzunluq/CTA qrupları, follower artımı (snapshot), paylaşılmış videoların baseline ilə müqayisəsi.
---

# TikTok Analytics

## Mənbələr (rəsmi)
- `POST /v2/video/list/`, `POST /v2/video/query/` → views, likes, comments, shares, duration, create_time.
- `GET /v2/user/info/` → follower/like/video sayı (snapshot olaraq saxlanılır).

## Mövcud olmayanlar
saves, reach, impressions, retention, watch time, profil baxışı, demoqrafiya, trafik mənbəyi → `UNSUPPORTED_BY_TIKTOK_API`. Sahib TikTok tətbiqindəki Analytics-dən ekran şəkli verərsə, onu `[sahib, ekran]` mənbəsi ilə istifadə et.

## Əmrlər
- `analyze` → bütün qruplar + top/bottom + why_top_worked.
- `track <video_id...>` → paylaşılmış video vs hesabın median baxışı (`median-dan yaxşı/səviyyəsində/zəif`).
- Follower artımı: `snapshots.json` (ən azı 2 snapshot; analiz fərqli günlərdə işlədilməlidir).

## Hesabat
1. Rəqəmlər (yalnız API) 2. Nə işlədi (müşahidə, n ilə) 3. Nə işləmədi 4. Növbəti test.
Az nümunəli nəticəni "hipotez" adlandır. Korrelyasiyanı səbəb kimi təqdim etmə.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
