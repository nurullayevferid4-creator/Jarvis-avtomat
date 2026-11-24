# Vaqif qoyun — v2 (izahlı montaj)

`vaqif_qoyun_v2.mp4` — 82 san, 1080×1920, 30 fps.

Nə dəyişib (v1-ə görə):
- Hook: ilk 2 saniyədə "3 660 ₼ — 1 telefon ya 10 qoyun?"
- İzah: qoyun balasını ~5 ay daşıyır, payızda cütləşmə → yazda quzulama (təqvim animasiyası), əkiz doğum, 6 ay böyümə
- Xərc və risk açıq deyilir; telefonun dəyər itkisi qrafiki (rəqəmsiz)
- Söz-söz işıqlanan altyazı, addım çipi, irəliləmə zolağı, kamera zoom/silkələnmə, kəsid flaşı
- Səs: Speko/Soniox "Adrian" (az) + sintez fon ritmi (96 BPM) + effektlər (whoosh, pop, kassa, boom); musiqi danışıq altında avtomatik azalır

Yeni fakt: qoyunun boğazlıq müddəti ~5 ay (~150 gün) — ümumi baytarlıq bilgisi, ChatGPT mənbə ilə təsdiqləməlidir.
Digər rəqəmlər və fərziyyələr: `../HESABLAMA.md`.

Render: `page.html` = scene.html + timeline.json → `node render.js full frames` → `python3 mix.py` → ffmpeg.
