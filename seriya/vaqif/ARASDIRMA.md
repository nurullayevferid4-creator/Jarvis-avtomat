# Araşdırma: dublaj, montaj, seriya personajı

Tarix: 24.11.2026. Mənbələrin çoxu blog yazılarıdır. Statistik rəqəmlər bu mənbələrin öz iddiasıdır, mən onları ayrıca yoxlamamışam.

## 1. Peşəkar dublaj necə qurulur

Dublaj studiyaları təxminən eyni ardıcıllıqla işləyir:
material qəbulu → ssenarinin adaptasiyası → səs kastinqi → mətni take-lərə bölmək → rejissorla yazılış → redaktə və sinxron → miks → son yoxlama.

- Mənbələr: hertzstudio.com/en/dubbing-process, sukudostudios.com/blog/dubbing-services-complete-guide, voicebros.com/en/blog/lip-sync-dubbing, postproduction.studio/en/sound/adr-voice

**Bizə tətbiqi:**
- Hər sətir ayrıca take kimi yazılır. Bu dəfə Echo səsi "Gəl hesablayaq!" sətrini atmışdı. Yalnız həmin sətri yenidən yazdım, qalanına toxunmadım.
- Hər personajın sabit səsi olmalıdır.
- Hər take mətnə çevrilərək yoxlanır.

## 2. Qısa videoda tamaşaçını saxlamaq (retention)

- İlk 3 saniyə həlledicidir. Bir mənbəyə görə tamaşaçıların 50–60%-i məhz bu müddətdə videodan çıxır — biolinky.co/blog/retention-editing-guide.
- Video hərəkətin ortasından başlamalıdır. Logo, giriş, "salam dostlar" olmamalıdır — asendify.co/blog/short-form-retention-editing.
- Görüntü hər 2–4 saniyədə dəyişməlidir: zoom, kəsik və ya ekranda yazı — biolinky, gpt.social.
- Altyazı mütləqdir, çünki çox adam videoya səssiz baxır. Mənbənin iddiasına görə altyazı baxış müddətini ~18% artırır.
- Bir videoda bir fikir olmalıdır.
- Son kadr başlanğıca bağlanmalıdır (loop). Sonda "abunə ol" kimi çıxış hissəsi tamaşaçıya çıxmaq üçün səbəb verir — asendify.
- Strukturu: hook → gözlənilməz dəyişiklik → vəd edilən nəticə — revid.ai/blog/short-form-video-trends.
- İşləyən hook-un **sözlərini yox, strukturunu** təkrarlamaq lazımdır. Eyni açılış cümləsi təkrarlananda artıq diqqət çəkmir — kompozy.io/how-to/write-viral-hooks.

## 3. Seriyada personajın eyni qalması

- Personaj vərəqində bunlar olur: öndən, 3/4 və profildən görünüş, yaxın plan, ifadələr vərəqi, proporsiyalar, geyimlər, imza əşyaları və **dəyişdirilməsi qadağan olan cizgilər** — uselamina.ai, SCAD character sheets PDF.
- AI ilə yaradılan videoda personaj hər bölümdə bir az dəyişir (çənə, geyim, işıq).

**Bizə tətbiqi:** Vaqifi kodla çəkilmiş vektor rig kimi qurdum. Ona görə hər bölümdə piksel-piksel eyni görünür və video yaratmaq üçün kredit lazım deyil.

**Hələ yoxdur:** 3/4 və profil görünüşləri.

## 4. Ağız sinxronu (lip-sync)

- Rhubarb Lip Sync pulsuz və açıq kodlu alətdir (github.com/DanielSWolf/rhubarb-lip-sync). 9 ağız forması istifadə edir: A–H və X. Fonetik rejimi dildən asılı deyil, yəni Azərbaycan dilində də işləyir.
- Bu sessiyada alətin yüklənib işə salınması sistem tərəfindən rədd edildi. Əvəzinə `demo/lipsync.py` yazdım: səsin enerjisinə, hecaların zirvələrinə və tembrinə baxıb eyni 9 formanı çıxarır. Rhubarb qədər dəqiq deyil.

## 5. Azərbaycan dilində səslər (Speko)

| Səs | Provayder | Nəticə (mətnə çevirib yoxladım) |
|---|---|---|
| Adrian | Soniox, pulsuz | Əvvəlki videolarda düzgün idi |
| Daniel | Soniox, pulsuz | "Vaqifəm" əvəzinə "Bağıfəm" |
| Echo | OpenAI, pulsuz | Ad düzgündür. "Gəl hesablayaq!" sətrini atdı, ayrıca take ilə düzəldildi. "isə" sözü "ise" kimi tanındı |
| Cedar | OpenAI, pulsuz | "qoyun" əvəzinə "qoyum", "Ciddisən" əvəzinə "Ciddi sən" |
| Arif, Abbas, İbrahim Məmmədli, Amalya | ElevenLabs v3, doğma az səslər | Yoxlanmadı: Speko ilk dəfə ən azı $5 balans artırmağı tələb edir |

**Nəticə:** Ən doğma səsi ya ElevenLabs-ın Azərbaycan səsləri, ya da real insan dublajı verəcək. Hər iki yol Fəridin qərarıdır.
