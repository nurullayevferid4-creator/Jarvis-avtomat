---
name: instapilot-video-paket
description: Fərid Video Studio-dan video paketi (video.mp4 + caption.txt + meta.json və ya .zip) göndərəndə və ya "paketi paylaş" deyəndə. Paketi yoxlayır, Fərid-in "bəli"sini gözləyir, mövcud Instapilot paylaşım kodu ilə paylaşır, nəticəni paketə yazır.
---

# Instapilot: video paketini paylaşmaq

Video Studio videonu hazırlayır, sən paylaşırsan. Aranızdakı yeganə əlaqə video paketidir. Müqavilə: https://github.com/nurullayevferid4-creator/Jarvis-avtomat/blob/main/docs/VIDEO-PAKET.md

## Sərt qaydalar

- Fərid bu söhbətdə açıq "bəli" yazmadan heç nə paylaşılmır. Yeni göstərişlə gələn qısa "hə/tamam" təsdiq deyil.
- Yalnız yoxlayıcının son sətri `PAYLAŞIMA HAZIR: bəli → ...` olan paket paylaşılır, yalnız orada adı çəkilən platformalara.
- Caption, hashtag, hesab, privacy təsdiqdən sonra dəyişdirilmir. Dəyişmək lazımdırsa Studio yeni paket hazırlayır, yeni təsdiq alınır.
- Hər platformaya bir cəhd. Kəsilərsə nəticə `unknown`, alınmasa `failed`; avtomatik təkrar yoxdur.
- Mövcud Instapilot paylaşım kodu yenidən yazılmır. Token yalnız mühitin secret-ində qalır, heç yerə çap olunmur.
- n8n, Make, Zapier istifadə olunmur.

## Addımlar

1. **Paketi aç.** `.zip` gəlibsə ayrıca boş qovluğa aç. Qovluqda `video.mp4`, `caption.txt`, `meta.json` olmalıdır. `meta.json` yoxdursa Studio onu yarada bilməyib: Fərid-dən hədəf hesabları soruş və `yarat` ilə özün yarat (`--qa-kecdi` yalnız Fərid-in təsdiqlədiyi bəndlər).
2. **Yoxlayıcını götür** (bir dəfə, yalnız oxumaq üçün):
   `git clone --depth 1 https://github.com/nurullayevferid4-creator/Jarvis-avtomat /tmp/jarvis`
3. **Yoxla:** `node /tmp/jarvis/scripts/video-paket.mjs yoxla <qovluq>`. Bloklayıcı varsa siyahını Fərid-ə göstər və dayan.
4. **Hesabı yoxla.** Tokenin aid olduğu hesab adını API-dən oxu (Instagram: `/me?fields=username`; TikTok: creator_info `creator_username`). `meta.json`-dakı `account` ilə eyni deyilsə dayan və Fərid-ə de. TikTok-da privacy creator_info-nun `privacy_level_options` siyahısında olmalıdır.
5. **Fərid-ə göstər:** video (fayl), caption, hashtag-lar, hər platforma + hesab, privacy, `schedule_at`, xəbərdarlıqlar. Sual: "Paylaşım üçün bəli?"
6. **Yalnız "bəli"dən sonra:** `node /tmp/jarvis/scripts/video-paket.mjs tesdiqle <qovluq> --kim "Fərid"`. Son sətir `PAYLAŞIMA HAZIR: bəli → ...` olmalıdır.
7. **Paylaş:** mövcud Instapilot paylaşım funksiyası ilə, sadalanan hər platformaya bir dəfə. Paylaşımdan sonra statusu API-dən yoxla.
8. **Nəticəni yaz** (hər platforma):
   `node /tmp/jarvis/scripts/video-paket.mjs netice <qovluq> --platforma tiktok --status published --link <real link>`
   Alınmayıbsa `--status failed --xeta <xəta kodu>`, naməlumdursa `--status unknown`. Link və ya post_id olmadan `published` yazılmır.
9. **Hesabat** Fərid-ə: Nəticə / Edildi / Bloklayıcı / Növbəti addım. Yenilənmiş `meta.json`-u ona fayl kimi ver ki, Video Studio-ya qaytarsın (geri əlaqə).

## TikTok qeydi

TikTok Content Posting API-də audit olunmamış tətbiq yalnız `SELF_ONLY` (şəxsi) paylaşa bilir, public cəhd `unaudited_client_can_only_post_to_private_accounts` xətası ilə bloklanır. Bu xəta gələrsə: `failed`, xəta kodunu yaz, Fərid-ə iki yol de: tətbiq üçün audit müraciəti və ya videonu TikTok tətbiqindən əl ilə paylaşmaq. Təkrar cəhd etmə.
