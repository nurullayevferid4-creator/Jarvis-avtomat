# Bölüm 1 — "iPhone yoxsa qoyun?"

`vaqif_bolum1.mp4` — 65 san, 1080×1920, 30 fps. Musiqi yoxdur. Səs səviyyəsi -14.6 LUFS-dur, ölçülüb.

## Ssenari və səs yoxlaması (QC)

| # | Kim | Sətir | Səs | Yoxlama (səs mətnə çevrildi) |
|---|---|---|---|---|
| 1 | Ramin | Vaqif, bax! Yeni iPhone 18 Pro Max! 3 660 manat! | Echo | ✅ |
| 2 | Vaqif | 3 660? Mən bu pula 10 qoyun alardım. | Adrian | ✅ |
| 3 | Ramin | Qoyun? Ciddisən? Qoyun pul gətirməz! | Echo | ✅ ("Ciddi sən" kimi ayrılıb tanındı, məna eynidir) |
| 4 | Vaqif | Gəl, hesablayaq! | Adrian | ✅ |
| 5 | Vaqif | Bazarda bir qoyun təxminən 350 manatdır. Deməli, 10 qoyun, üstəlik 160 manat da artıq qalır. | Adrian | ✅ |
| 6 | Vaqif | Qoyun balasını 5 ay daşıyır. Payızda cütləşir, yazda quzulayır. Bəziləri əkiz doğur. Beləliklə, 10 qoyundan 12 quzu. | Adrian | ✅ |
| 7 | Vaqif | Quzular 6 ay otlaqda böyüyür. Payızda hərəsi 200 manat. Cəmi 2 400 manat! | Adrian | ✅ |
| 8 | Ramin | Bəs yem? Bəs baytar? | Echo | ✅ |
| 9 | Vaqif | Düz deyirsən. Qış xərci təxminən 700 manatdır. Təmiz qazanc: 1 700 manat. | Adrian | ✅ |
| 10 | Vaqif | Bir ildən sonra… 10 qoyunum yerində qalır. Üstəlik, cibimdə 1 860 manat. Səndə isə, köhnəlmiş telefon. | Adrian | ⚠️→✅ 1-ci take "**11** qoyun", 2-ci take "**12** baş qoyun" kimi eşidildi. Cümlə yenidən quruldu, 3-cü take düzgündür |
| 11 | Ramin | Vaqif… bəlkə mənə də bir qoyun satasan? | Echo | ✅ |

## Rəqəmlər

Mənbələr və fərziyyələr `../../../videos/qoyun/HESABLAMA.md` faylındadır.

Yoxlanmamış qalanlar:
- 200 ₼ quzu qiyməti — elanlara əsaslanır;
- 700 ₼ qış xərci — mənim təxminimdir;
- 350 ₼ qoyun qiymətinin tarixi;
- "~5 ay" boğazlıq müddəti.

Bunları ChatGPT mənbə ilə təsdiqləməlidir.

Dəftərdəki "≈ 5 360 ₼" yazısı səslə deyilmir. Bu, 3 500 ₼ (10 qoyun) + 1 860 ₼ nağd pulun cəmidir.

## Montaj

| Vaxt | Səhnə |
|---|---|
| 0–16 san | Küçədə dialoq. Kadr danışana görə dəyişir (Ramin ↔ Vaqif): ümumi plan → orta plan → yaxın plan. Qiymət etiketi, fikir buludu, "GƏL HESABLAYAQ!" yazısı, ağ flaş və kamera silkələnməsi |
| 16–57 san | Vaqifin dəftəri ekrana açılır. Hesablamalar danışıqla eyni anda əl yazısı ilə yazılır, karandaş yazının ardınca gedir, dairə və xətlər çəkilir, 4 səhifə çevrilir. Aşağıda danışan personaj görünür |
| 57–65 san | Ümumi plan: Ramin uduzur, Bəbə gəlib "mə-ə!" deyir, zınqırov səslənir. Son kart: "Sən hansını seçərdin?" |

**Səs effektləri:** pop, boom, möhür zərbəsi, whoosh, səhifə çevrilməsi, karandaş cızıltısı (hər yazı üçün), ding, kassa, zınqırov.

## Yenidən render etmək

1. Caveat şriftini (SIL OFL 1.1, Google Fonts) yüklə: `caveat-latin.woff2` və `caveat-latin-ext.woff2` fayllarını bu qovluğa qoy. Lisenziyası olmadığı üçün şrift fayllarını repoya əlavə etməmişəm.
2. `python3 lipsync.py '<plan>' 65` — `lip.json` faylını yaradır.
3. `page.html` = `ep1.html`, içindəki `__LIP__` yerinə `lip.json` məzmunu yazılır.
4. `node render.js full frames`
5. `python3 mix.py`
6. ffmpeg ilə kadrlar və səs birləşdirilir.
