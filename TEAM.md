# Üçlü: Fərid + Claude + ChatGPT

Bu repo üç tərəfin ortaq iş lövhəsidir. Tapşırıq bir Issue kimi açılır, iş bölünür, hər kəs öz hissəsini görür və bir-birini yoxlayır.

## Rollar

| Kim | Vəzifə |
|---|---|
| Fərid | Tapşırığı verir, təsdiq lazım olan işlərə "təsdiq" yazır. |
| Claude (lead) | Planı qurur, işi bölür, mühakimə, uzun yazı, Azərbaycanca mətn, kod, inteqrasiya və yekun hesabat. |
| ChatGPT (Codex) | Canlı araşdırma, məlumat toplama, şəkil, alternativ həll və Claude-un işinin yoxlanması. |

## Axın

1. Fərid GitHub tətbiqində yeni Issue açır ("Tapşırıq" şablonu). Telefonun klaviaturasındakı mikrofonla diktə edə bilər.
2. Claude Issue-ya plan yazır: "Claude hissəsi", "ChatGPT hissəsi" və hər hissənin qəbul meyarı.
3. Claude öz hissəsini branch və PR ilə edir. ChatGPT hissəsi üçün Issue-da `@codex` ilə ona tapşırıq yazır.
4. ChatGPT öz hissəsini PR ilə təhvil verir.
5. Çarpaz yoxlama: Claude ChatGPT-nin PR-nı, ChatGPT Claude-un PR-nı yoxlayır (`@codex review`, `@claude review`).
6. Claude Issue-da yekun hesabatı yazır və Fərid-in cavabını gözləyir.

## Hesabat formatı

```
Nəticə: achieved / partial / blocked / pending_approval / draft_only
Edildi: real icra olunan işin 1-2 sətri
Bloklayıcı: dəqiq səbəb və nə lazımdır, yoxdursa "yoxdur"
Növbəti addım: Fərid-dən nə lazımdır, yoxdursa "yoxdur"
```

## Sərt qaydalar

- Uydurma yoxdur. Yoxlanmayan şeyi "bitdi" adlandırmaq, uydurma link və rəqəm yazmaq qadağandır.
- Təsdiq qapısı: paylaşım, qiymət və stok dəyişikliyi, pul xərcləmək, başqasına mesaj göndərmək, silmək. Agentlər bunları icra etmir, yalnız qaralama hazırlayır və Issue-da Fərid-dən "təsdiq" gözləyir. Təsdiqdən sonra da icra Fərid-in özündədir, çünki bu repo-da Shopify, Instagram kimi inteqrasiya yoxdur.
- Bu repo açıqdır. Açar, parol, token və şəxsi məlumat nə fayla, nə Issue-ya, nə şərhə yazılmır. Açarlar yalnız GitHub Secrets bölməsindədir.
- Hər kəs cavabı azərbaycanca, qısa və birbaşa yazır.
