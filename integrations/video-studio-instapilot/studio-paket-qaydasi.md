# Video Studio: son addım — video paketi

Bu fayl CLAUDE AI VIDEO STUDIO layihəsinə əlavə qaydadır. Studio-nun mövcud bilik bazasını (Master Video KB, SMM KB) dəyişmir: onların hamısı əvvəlki kimi işləyir, bu fayl yalnız işin sonuna bir addım əlavə edir. Ziddiyyət olsa Fərid-in son göstərişi və Studio KB üstündür.

Müqavilə: https://github.com/nurullayevferid4-creator/Jarvis-avtomat/blob/main/docs/VIDEO-PAKET.md

## Nə vaxt

Video render olunub, QA keçib, Fərid preview-a baxıb. Bundan sonra videonu sadəcə fayl kimi yox, **video paketi** kimi təhvil ver. Instapilot AI yalnız paketi qəbul edir.

## Paket

Qovluq adı `package_id`-dir (kiçik hərf, rəqəm, `-`; məs. `2026-11-16-qr-menyu`). İçində:

1. `video.mp4`: hazır video.
2. `caption.txt`: paylaşım mətni (açar söz CTA ilə), olduğu kimi.
3. `meta.json`: aşağıdakı kimi.

Fərid-ə üç faylı və ya qovluğun `.zip`-ini göndər (telefonda bir fayl daşımaq asandır).

## meta.json necə doldurulur

**A yolu (kod icrası və GitHub-a çıxış varsa):**

```
git clone --depth 1 https://github.com/nurullayevferid4-creator/Jarvis-avtomat /tmp/jarvis
node /tmp/jarvis/scripts/video-paket.mjs yarat <qovluq> --hedef tiktok:@_weemenu_baku --paket-id <ad> --hashtag a,b --qa-kecdi <real keçən bəndlər>
```

Son sətir `PAYLAŞIMA HAZIR: xeyr (Fərid-in təsdiqi gözlənilir)` olmalıdır. Bloklayıcı varsa düzəlt və `--yenile` ilə təkrarla.

**B yolu (GitHub-a çıxış yoxdursa):** `docs/VIDEO-PAKET.md`-dəki şablonu doldur, hash-ləri `sha256sum video.mp4 caption.txt` ilə hesabla. Kod icrası da yoxdursa bunu Fərid-ə de: hash-ləri Instapilot tərəfi `yarat` ilə hesablayacaq.

## Qaydalar

- **Hesab adı mütləq.** Hər hədəf `platforma + @hesab`. Hansı hesab olduğunu bilmirsənsə Fərid-dən soruş (`@_weemenu_baku`, `@weecardglobal` və s. qarışmasın).
- **privacy** standart `private`. `public` yalnız Fərid açıq "public" deyibsə.
- **qa** bəndləri yalnız real yoxlanıbsa `true`: hook ilk 1-3 san, Azərbaycan hərfləri əllə yoxlanıb, bir mesaj bir CTA, lisenziya aydın, başqasının loqosu yoxdur, səs piki -1 dB-dən aşağı, telefonda başdan sona izlənib. Yoxlanmayanı `false` saxla və səbəbini Fərid-ə yaz.
- **ai_generated** real görünən AI insan və ya səs varsa `true`.
- **status** həmişə `pending_approval`. Studio heç vaxt `approved` yazmır və heç nə paylaşmır.
- Təhvil hesabatı: Nəticə / Edildi / Bloklayıcı / Növbəti addım. Videonu "render olunub, hələ paylaşılmayıb" adlandır.

## Geri əlaqə

Instapilot paylaşdıqdan sonra `meta.json`-un `results` bölməsində hər platformanın linki və statusu olur. Fərid bu faylı Studio-ya qaytaranda:
- linkləri və statusu oxu, alınmayan platformanı (`failed`) qeyd et;
- 24/72 saat rəqəmlərini mənbəsi ilə topla (Studio SMM axını) və növbəti brief-ə dərs kimi yaz;
- nəticəni təxmin etmə: rəqəm yoxdursa "data yoxdur" de.
