---
name: tiktok-comments
description: Şərhləri təsnif edir (sentiment, kateqoriya, potensial müştəri) və cavab qaralamaları yazır. Rəsmi Login Kit/Display API şərh vermədiyi üçün oxuma/göndərmə UNSUPPORTED_BY_TIKTOK_API; şərhlər istifadəçidən gəlir.
---

# TikTok Comments

## API statusu
- `comments.read`: **UNSUPPORTED_BY_TIKTOK_API** (Display API yalnız `comment_count` verir).
- `comments.reply`: **UNSUPPORTED_BY_TIKTOK_API**.
- Qeyd: TikTok API for Business (Organic API) rəsmi sənədlərində Business hesabının öz videolarındakı şərhləri oxumaq/cavablamaq səhifələri var. Ayrıca Business developer app + Business hesab + TikTok təsdiqi tələb edir; endpoint detalları yoxlanmayıb və **kodda yoxdur**. Fake adapter yaradılmır.

## Axın (manual)
1. Sahib şərhləri yapışdırır və ya JSON verir: `[{ "id", "text", "video_id" }]`.
2. `node tiktok-manager/cli.mjs leads --file comments.json` → kateqoriya (purchase_intent / question / praise / complaint / spam), sentiment, HOT/WARM/COLD.
3. Hər şərh üçün cavab qaralaması (`tiktok-humanizer` ilə təbiiləşdir). Faktı olmayan cavabda `{{FAKT_LAZIMDIR}}` qalır.
4. Şikayət → sahibə eskalasiya; spam → cavab yox.
5. Cavablar approval-a `comment.reply` kimi düşür (DRAFT→REVIEW→APPROVE); icra `UNSUPPORTED` olduğu üçün sahib əl ilə yapışdırır.

## Qadağa
Saxta şərh, öz videoya saxta hesablardan şərh, kütləvi eyni cavab (spam).

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
