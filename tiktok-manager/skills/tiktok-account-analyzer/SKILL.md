---
name: tiktok-account-analyzer
description: Qoşulmuş istənilən TikTok hesabını rəsmi API ilə analiz edir və workspace/account-profile.md profilini qurur. Yeni hesab qoşulanda, hesab dəyişəndə və ya 'hesabımı analiz et' deyiləndə ilk işləyən skill.
---

# TikTok Account Analyzer

Hər işin təməli. Heç bir skill hesab profili olmadan strategiya, ideya və ya satış mətni yazmır.

## Nə vaxt
- Yeni hesab qoşulub (`exchange` / token) və ya `active.json` dəyişib.
- Profil 7 gündən köhnədir və ya istifadəçi "analiz et" deyir.
- Hər `tiktok-growth` dövründən əvvəl (follower snapshot-u üçün).

## Addımlar
1. `node tiktok-manager/cli.mjs config` → hesab qoşulubmu (`connected`). Qoşulmayıbsa: istifadəçinin verdiyi məlumatla məhdud profil, `blocked: not_connected` qeyd et, OAuth addımlarını README-dən göstər.
2. `node tiktok-manager/cli.mjs analyze` → rəsmi `GET /v2/user/info/` + `POST /v2/video/list/` (≤100 video). Nəticə:
   - `workspace/account-profile.md` (aktiv hesab), `workspace/accounts/<open_id>/{account.json, videos.json, snapshots.json, business.json}`.
3. Profili oxu və istifadəçiyə **qısa** xülasə ver:
   - username, bio, follower/like/video sayı (API)
   - ən yaxşı 3 və ən zəif 3 video + niyə (yalnız `why_top_worked` müşahidələri, "korrelyasiya" kimi)
   - dil (heuristik → təsdiq lazımdır), mövzu hipotezləri (caption sözləri)
4. `missing_business_facts` boş deyilsə: biznes, məhsul/xidmət, auditoriya, bazar, məqsəd, qiymət, çatdırılma, ödəniş, əlaqə — bunları **bir mesajda** soruş və `business.json`-a yaz. Sahib cavab verməyibsə, sahələr `NAMƏLUM` qalır; iş dayanmır, amma satış mətnlərində marker qalır.

## Video analizi hüdudları
- API video faylı vermir: görüntü, ilk 1–3 saniyə, səs/voice-over analizi yalnız istifadəçi faylı verəndə mümkündür (`video.file` = UNSUPPORTED_BY_TIKTOK_API). `cover_image_url` (6 saat TTL) yalnız örtük şəklidir.
- Hook = caption-un ilk cümləsi (mətn hook-u). Vizual hook-u təxmin etmə.
- Retention, saves, reach: `UNSUPPORTED_BY_TIKTOK_API` — yazma, təxmin etmə.

## Çıxış
`account-profile.md` + 5–8 sətirlik xülasə. Uydurulmuş heç bir rəqəm yoxdur.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
