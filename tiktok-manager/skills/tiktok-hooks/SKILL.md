---
name: tiktok-hooks
description: Seçilmiş video ideyası üçün ilk 1–3 saniyəlik hook variantları (danışıq + ekran mətni + vizual) hazırlayır və hesab datasına görə ən yaxşısını seçir.
---

# TikTok Hooks

## Hook = 3 qat
1. **Söz (voice-over):** ilk cümlə, ≤ 12 söz.
2. **Ekran mətni:** 2–6 söz, böyük şrift.
3. **Vizual:** ilk kadr nədir (hərəkət, nəticə, problem).

## Tiplər
sual · rəqəm/siyahı · səhv/xəbərdarlıq · POV · maraq/sirr · birbaşa müraciət · nəticədən başla (before/after) · ziddiyyət.

## Addımlar
1. 5 variant yaz, ən azı 3 fərqli tip.
2. Hesabın `performance.groups.hook_pattern` cədvəlinə bax: `reliable:true` olan ən yaxşı tipi üstün tut; data yoxdursa ideyanın təbiətinə görə seç.
3. Yoxla: vəd videoda real olaraq verilirmi (clickbait yoxdur), saxta rəqəm/nəticə yoxdur, dil hesabın dilidir.

## Çıxış
`{ "hooks": [{ "type", "voiceover", "on_screen_text", "first_frame", "why" }], "selected": 0 }`

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
