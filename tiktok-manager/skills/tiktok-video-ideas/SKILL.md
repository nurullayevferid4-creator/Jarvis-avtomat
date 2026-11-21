---
name: tiktok-video-ideas
description: Hesabın datası və strategiyasına uyğun video ideyaları yaradır, 'baxış potensialı' ilə şəffaf qiymətləndirir və ən güclüsünü seçir.
---

# TikTok Video Ideas

## Addımlar
1. 8–12 ideya yarat. Hər ideya:
```json
{ "title": "...", "angle": "...", "pillar": "...", "format": "...", "hook_pattern": "sual|rəqəm/siyahı|pov|səhv/xəbərdarlıq|maraq/sirr|birbaşa müraciət|bəyanat",
  "target_kpi": "views|engagement|followers|leads|sales",
  "signals": { "hook_strength": 0-5, "audience_fit": 0-5, "shareability": 0-5, "production_ease": 0-5 },
  "why": "hansı data və ya auditoriya ehtiyacına əsaslanır" }
```
2. `ideas.json`-a yaz və `node tiktok-manager/cli.mjs score-ideas --file ideas.json` işlət. Bal: hook 30%, auditoriya 25%, paylaşılma 20%, istehsal 10%, hesab datası 15% (hook tipinin hesabdakı median baxışı).
3. Ən yüksək balı seç; bərabərdirsə, hesabda daha az sınanmış hook tipini seç (öyrənmə dəyəri).
4. Etiket: "yüksək / orta / aşağı baxış potensialı" + `data_basis`. **"Viral olacaq" yazma.**

## Yüksək baxış prinsipləri (zəmanət deyil)
- İlk 1–3 saniyədə aydın vəd və ya gərginlik.
- Bir video = bir fikir.
- Saxlanmağa/paylaşmağa dəyər: konkret fayda, sürpriz, səhv xəbərdarlığı.
- Hesabda işləyən uzunluq qrupu.

## Çıxış
Sıralanmış siyahı + seçilmiş ideya `tiktok-hooks`-a.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
