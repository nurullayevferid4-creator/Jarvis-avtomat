# YouTube planı: 1000 abunə + 10 milyon baxış

Status: **qaralama**. Heç nə paylaşılmayıb, heç bir hesaba toxunulmayıb.

## 0. Nəyə əsaslanır (dürüst)

**İlham videosu** (`youtube.com/shorts/9JTSZ32JQuY`). Səhifənin metadata-sını oxudum, videonun özünə baxmadım (transkript yoxdur):

| Sahə | Dəyər (2026-11-23 oxunub) |
|---|---|
| Kanal | Haritanın Ardı (@haritaninardi), türkcə |
| Başlıq | "İstanbul'dan Yürüyerek Geçen Bu Adam Eve 28 Yılda Döndü" |
| Mövzu | Çilidən İngiltərəyə piyada gedən adam (#karlbushby), xəritə üzərində marşrut |
| Müddət | 1:59 |
| Baxış / bəyənmə | ~876 min / ~12.7 min, 2026-11-11-də yüklənib |
| Qeyd | YouTube "Made with AI" (süni intellektlə hazırlanıb) işarəsi var |

**Formulun özü (kopyalamadan götürdüyümüz):**
1. Real, inanılmaz insan hekayəsi + xəritədə görünən marşrut.
2. Başlıq tamaşaçının **öz yerinə** bağlanır ("İstanbul'dan geçen"), halbuki hekayə əslində Çili–İngiltərədir. Yerli bağ = klik.
3. Başlıqda rəqəm və ziddiyyət: "28 ildə evə döndü".
4. Kateqoriya "Education", ailəvi məzmun.

**Bilmədiyim:** hansı kanalın "ən çox baxış gətirən" olduğunu. Repo-da bu yazılmayıb. Plan xəritə/hekayə formatına qurulub; kanal başqa mövzudadırsa, formul (yerli bağ + rəqəm + vizual marşrut) yenə tətbiq olunur, mövzu siyahısı dəyişir.

## 1. Hədəfin riyaziyyatı

1000 abunə + 10M Shorts baxışı (90 gündə) YouTube Partnyor Proqramının Shorts yoludur, ümumi biliyimə görə. **2026 üçün şərt YouTube Studio-da yoxlanmalıdır.**

- 90 gün × gündə 2 Short = **180 video**.
- 10M / 180 = orta **~55 min baxış/video**. Real həyatda bərabər paylanmır: 5–10 "hit" (500K–2M) yükün çoxunu daşıyır, qalanları 2–20K olur.
- Deməli strategiya: **çox sayda test → qalibi tap → qalibin variantlarını tez çıxar.**

## 2. Öz formatımız: "Xəritədə 1 dəqiqə" (işçi ad)

Fərq: azərbaycanca səs, **hər videoda Azərbaycan və ya Türk dünyası bağı**, öz vizual stil (kart-animasiya: `anthropic-skills:kart-animasiya-izahat-video-style`). Türk kanalının başlıqlarını, qrafikasını, səsini, musiqisini götürmürük.

**3 seriya (A/B test üçün):**
| Seriya | Nümunə bucaq |
|---|---|
| A. Yol hekayələri | Azərbaycandan keçən/başlayan qeyri-adi səyahətlər, köçlər, ekspedisiyalar |
| B. Qəribə xəritə | sərhəd, anklav, dəniz/göl mübahisəsi kimi "bunu bilmirdin" faktları |
| C. Rəqəmlə tarix | "X il", "Y km", "Z gün" ilə tarixi hadisə, xəritədə animasiya |

**Hər videonun skeleti (45–60 s):**
- 0–2 s: başlıqdakı ziddiyyət ekranda + xəritə zoom (səssiz izləyən də anlasın, subtitr məcburi).
- 2–10 s: "niyə maraqlıdır" bir cümlə.
- 10–50 s: marşrut xəritədə irəliləyir, hər 5–7 s yeni vizual dəyişiklik.
- son 5 s: sual ("Sən olsan hansı yolu seçərdin?") + başa qayıdan kadr (loop).

**Başlıq qəlibi:** `[Yerli yer] + [inanılmaz rəqəm] + [nəticə]`. Məs.: "Bakıdan çıxan bu karvan Çinə N ayda çatdı" (rəqəm faktla doldurulmalıdır).

## 3. İlk 30 mövzu namizədi

**Hamısı faktiki yoxlamadan keçməlidir (ChatGPT hissəsi).** Burada yalnız istiqamət var, rəqəm yazmamışam ki, uydurma olmasın.

1. Naxçıvanın Azərbaycanın qalanı ilə quru sərhədinin olmaması
2. Xəzər: dənizdir, yoxsa göl? Hüquqi mübahisə
3. Nobel qardaşları və Bakı nefti: dünyanın ilk neft tankeri ideyası
4. İpək yolunun Azərbaycandan keçən qolları
5. Xınalıq: dağda min illik kənd, öz dili
6. Yanardağ: niyə sönmür
7. Qobustan qayaüstü təsvirləri və Yer üzündə nadir palçıq vulkanları
8. Kür çayı haradan başlayıb haraya axır
9. Neft Daşları: dənizin ortasında şəhər
10. Bakı–Tbilisi–Ceyhan boru kəmərinin marşrutu
11. Azərbaycandan keçən köç quşlarının yolu
12. Marko Polo / digər səyyahların Azərbaycan qeydləri
13. Şəki xan sarayının mismarsız tikilməsi
14. Ağsu, Şamaxı zəlzələləri və paytaxtın köçü
15. Orta Dəhlizdə Bakı limanının yeri
16–30. Seriya B və C üçün ChatGPT 15 namizəd daha toplayır (mənbə ilə).

## 4. 90 günlük plan

| Mərhələ | Gün | İş | Qərar meyarı |
|---|---|---|---|
| 0. Audit | 1–3 | Fərid kanalı seçir, son 90 günün Studio göstəricilərini verir (ən yaxşı 10 video, izlənmə %, abunə mənbəyi) | kanal və başlanğıc rəqəmlər məlumdur |
| 1. Test | 4–21 | 3 seriyadan cəmi 30 video, gündə 1–2 | hər seriyanın orta baxışı və "izlədi / sürüşdürdü" nisbəti |
| 2. Böyüt | 22–60 | ən yaxşı seriyaya 70% vaxt, 2/gün; hit olan videonun 3 davamı ("Hissə 2") | hit = kanal medianının 5 qatı |
| 3. Abunəyə çevir | 30–90 | hər hitə 6–10 dəq. uzun video (Shorts-dan bağlantı), pinned şərhdə seriya | abunə/1000 baxış artır |
| 4. Nəzarət | hər bazar | həftəlik hesabat: nə işlədi, nə dayandırılır | 2 həftə nəticəsiz format dayanır |

**Qərar qaydaları (bizim qayda, YouTube faktı deyil):**
- İlk 2 saniyədə sürüşdürmə yüksəkdirsə: hook dəyişir, mövzu yox.
- İzlənmə % aşağıdırsa: video 10 s qısalır.
- Baxış var, abunə yoxdursa: seriya adı, "Hissə 1/3", sonda davam vədi.

## 5. Abunə üçün

- Kanal adı + banner + təsvir bir cümlədə vəd versin: "Hər gün 1 xəritə hekayəsi, azərbaycanca".
- Seriyalar pleylistdə; hər Short-un pinned şərhində növbəti hissə.
- Şərhlərə ilk 1 saatda cavab (Fərid-in əl işi; agentlər mesaj göndərmir).
- Ayda 2 uzun video: Shorts tamaşaçısını "abunəyə dəyər" kanala çevirir.

## 6. Risklər

- **Faktiki səhv** = kanalın etibarı ölür. Hər skript mənbə ilə yoxlanır.
- **Təkrar/oğurlanmış məzmun:** başqa kanalların kliplərini, xəritə animasiyalarını, səsini götürmək olmaz; monetizasiya rədd oluna bilər.
- **Süni intellekt işarəsi:** realistik dəyişdirilmiş/yaradılmış vizual varsa YouTube-da açıqlama işarəsi qoyulur (ilham videosunda da var).
- **Musiqi:** yalnız YouTube Audio Library və ya lisenziyalı.
- **Real şəxslər:** sağ insan haqqında hekayədə şəxsi məlumat, təhqir yoxdur.

## 7. İş bölgüsü

| Kim | İş | Qəbul meyarı |
|---|---|---|
| Claude | Format, skript qəlibi, ilk 10 skript (azərbaycanca), başlıq variantları, həftəlik hesabat qəlibi | 10 skript faylı, hər birində hook/kadr/subtitr/mənbə yeri |
| ChatGPT | 30 mövzunun faktları + mənbə linkləri; oxşar azərbaycan/türk xəritə kanallarının siyahısı (yalnız real, yoxlanan) | hər fakt üçün ən az 1 etibarlı mənbə linki |
| Fərid | Kanalı seçmək, Studio rəqəmləri, montaj/yükləmə, "təsdiq" | kanal adı + 90 günlük rəqəmlər Issue-da |

## Hesabat

```
Nəticə: draft_only
Edildi: ilham videosunun metadata-sı oxundu (video izlənmədi), 90 günlük plan yazıldı.
Bloklayıcı: hansı kanal olduğu və onun Studio rəqəmləri məlum deyil; faktlar yoxlanmayıb.
Növbəti addım: Fərid kanalı və son 90 günün göstəricilərini versin.
```
