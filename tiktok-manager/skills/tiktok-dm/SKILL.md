---
name: tiktok-dm
description: DM-lərə cavab sistemi: müştəri mesajı → ehtiyac → məhsul uyğunlaşdırma → cavab → lead → satış. Rəsmi Login Kit/Display API DM vermədiyi üçün oxuma/göndərmə UNSUPPORTED_BY_TIKTOK_API; mesajlar istifadəçidən gəlir.
---

# TikTok DM

## API statusu
- `dm.read`, `dm.send`: **UNSUPPORTED_BY_TIKTOK_API** (Login Kit / Display / Content Posting API-də DM yoxdur).
- TikTok **Business Messaging API** rəsmi olaraq mövcuddur, amma yalnız uyğun Business hesablar, TikTok təsdiqli app və bazar məhdudiyyəti ilə. **Kodda yoxdur.** Giriş alınarsa ayrıca, sənədlə yoxlanmış adapter yazılmalıdır.

## Axın
Müştəri mesajı → ehtiyacı müəyyən et → məhsul/xidmət uyğunlaşdır → cavab hazırla → lead müəyyən et → satışa yönləndir
1. Sahib mesajı yapışdırır (və ya ekran şəkli mətnini).
2. `leads --text "..."` → tier + siqnallar.
3. Uyğun məhsul/xidmət yalnız `business.json → products/services`-dən.
4. Cavab: qısa, insan kimi (`tiktok-humanizer`), bir növbəti addım. Qiymət/çatdırılma/ödəniş yoxdursa uydurma → `{{FAKT_LAZIMDIR:...}}` və sahibdən soruş.
5. Approval: `dm.send` (yalnız 1 alıcı, `in_reply_to` məcburi). İcra UNSUPPORTED_BY_TIKTOK_API olduğu üçün sahib təsdiqləyir və əl ilə göndərir.

## Qadağa
Soyuq DM, kütləvi DM, eyni mesajı çox adama, təzyiqli satış.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
