# Fakt videoları üçün yoxlama siyahısı

"14 iqtisadi rayon" videosuna gələn iradlardan çıxarılıb. Hər yeni fakt, xəritə və siyahı videosu yayımdan əvvəl bu siyahıdan keçir. Bir bənd yerinə yetirilməyibsə, video "hazır" sayılmır.

## 1. Əhatə: başlıq nə vəd edirsə, video onu göstərir
- Başlıq "14 rayon" deyirsə, ekranda və səsdə 14 rayonun hər biri adı ilə keçir. Bir neçəsi bir kadrda birləşdirilirsə, səs bunu açıq deyir ("üç cüt qonşu rayonu birlikdə göstəririk").
- İrəliləmə göstəricisi (nöqtələr və sayğac) başlıqdakı rəqəmlə üst-üstə düşür.
- Hər bölgə üçün əvvəlcə "yerli sakin nəyi mütləq gözləyər" siyahısı tutulur: hər rayonun ən tanınmış 1-2 şeyi. Nümunə: Göyçay narı, Qax-İlisu, Bərdə türbəsi, Goranboy gipsi, İmişli nefti, Kəlbəcər civəsi, Balakən xurması, Quba paxlavası.
- Mətn videoya qısaldılanda bu siyahıdakı bəndlər atılmır. Yer çatmırsa, video "seçmələr" kimi təqdim olunur və başlıq da ona uyğun dəyişir.

## 2. Xəritə məlumatı yoxlanmadan istifadə olunmur
- Hazır məlumat bazalarında (Natural Earth və s.) ad səhvləri ola bilər. Səhv nümunəsi: `AZE-1735` "Lankaran" adı ilə yazılıb, əslində Laçındır (`gn_name: Lacin Rayonu`).
- Hər inzibati vahidin `name` sahəsi `gn_name`, `region` və ISO kodu ilə tutuşdurulur. Uyğunsuzluqlar əl ilə düzəldilir.
- Render-dən əvvəl hər bölgənin ayrıca yoxlama xəritəsi çıxarılır: rayon adları üstündə yazılır, bölgə tam bir parça olmalıdır. Bölgə bir neçə parçaya bölünübsə, bunun anklav olduğu təsdiqlənməlidir.
- Hər sancaq öz rayonunun içində olmalıdır. Şəhər sancağı üçün dəqiq koordinat götürülür, eyni adlı vahidlərin orta nöqtəsi götürülmür.

## 3. Faktlar rəsmi mənbə ilə
- Faydalı qazıntı və təsərrüfat faktları rəsmi mənbələrdən yoxlanır: azerbaijan.az, gsaz.az, ensiklopediya.gov.az, rayon icra hakimiyyətləri, nazirliklər. Wikipedia tək mənbə kimi kifayət deyil.
- "Perspektiv var" kimi zəif ifadə işlənən yataq varsa yazılmır (Mil-Muğan: İmişlidə Muradxanlı, Zərdab, Cəfərli yataqları işlənir).
- Mənbələr bir-birinə zidd düşən fakt videoya salınmır, ya da ehtiyatlı ifadə ilə verilir.

## 4. Səs və altyazı
- Hər səs sətri yazıldıqdan sonra mətnə çevrilib ssenari ilə tutuşdurulur. Səhv deyilən söz (nümunə: "molibden" əvəzinə "Malibey") yenidən yazdırılır.
- Altyazı və çip vaxtları hərf sayına görə təxmin edilmir, nitq tanımanın söz vaxtlarından götürülür. Hərf sayına görə təxmin 0,8 saniyəyə qədər səhv verdi.
- Böyük hərflə yazılan Azərbaycan mətni `str.upper()` ilə yox, `i→İ` çevirməsi ilə böyüdülür. Əks halda "İQTİSADİ" yerinə "IQTISADI" çıxır.
- Səs sətirlərini parça-parça birləşdirməkdən qaçılır. Alınmayan sətir bütöv yenidən yazdırılır.

## 5. Kadr-kadr baxış
- Yayımdan əvvəl video saniyədə bir kadr olmaqla baxılır. Üst-üstə düşən yazılar, kəsilən mətn, düymə və altyazı toqquşması axtarılır.

## 6. Komanda yoxlaması
- Fakt siyahısı yayımdan əvvəl canlı yoxlama üçün ChatGPT/Codex-ə verilir (TEAM.md axını).
- Son baxış "şərhçinin gözü" ilə aparılır: hər bölgə üçün "burada yaşayan biri nəyin əskik olduğunu deyər?" sualına cavab yazılır.
- Hesabatda nəyin yoxlandığı, nəyin yalnız oxunduğu ayrıca göstərilir.
