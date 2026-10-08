---
name: tiktok-hashtags
description: Hesabın real hashtag performansı və mövzuya görə hashtag dəsti seçir (3–6 fokuslu). Hashtag həcmi üçün rəsmi API olmadığını nəzərə alır.
---

# TikTok Hashtags

## Data
- `performance.groups.hashtags`: hesabda hər hashtag-ın median baxışı (n ≥ 2). Bu yeganə real hashtag datasıdır.
- Hashtag baxış həcmi / trend: rəsmi API yoxdur (`trends.discover` = UNSUPPORTED_BY_TIKTOK_API). Creative Center-ə sahib əl ilə baxa bilər.

## Dəst (3–6)
1. 1–2 **niche** (mövzu dəqiq: #biskvit, #tortresepti)
2. 1–2 **auditoriya/bazar** (dil/şəhər: #bakı, #azərbaycan — yalnız bazar həqiqətən oradırsa)
3. 1 **brend** (sahibin öz hashtag-ı, varsa)
4. Hesabda `reliable:true` və median-dan yuxarı olan hashtag-ları üstün tut; median-dan aşağı olanları xəbərdarlıqla.

## Qadağa
Əlaqəsiz trend hashtag-ları (#fyp spam, mövzuya aid olmayan) — real auditoriyanı çaşdırır.

## Çıxış
`hashtags: ["#..."]` + hər birinin səbəbi (`[hesab datası]` / `[mövzu]`).

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
