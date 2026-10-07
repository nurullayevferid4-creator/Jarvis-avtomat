# Real tüstü sınağı (açarlar əlavə olunandan sonra)

Məqsəd: «saxta testlər keçir» ilə «real işləyir» arasındakı boşluğu bağlamaq. **Heç bir real paylaşım etmə**; hər platformanı yalnız özünün test hesabı ilə, və paylaşımı təsdiq paneli ilə, bilərəkdən və ayrıca sına.

## 1. Deploydan sonra (hamısı sirsiz, risksiz)

Kompüterdə Node 22 varsa (Windows 7-də yox; başqa maşın):

```
SMOKE_BASE=https://<worker-ünvanın> SMOKE_PASSCODE=<parolun> node scripts/runtime-smoke.mjs
```

Parolu komanda sətrində yazmaq əvəzinə mühit dəyişəni kimi ver; heç yerə yazılmır. Skript: səhifə/CSP, 401, status, koordinatorun `durable_object` olması, media yükləmə, saxta MP4-ün rədd edilməsi, təsdiq axını, **6 paralel təsdiq → yalnız 1 icra**, audit. Yaratdığı test mediasını təsdiq axını ilə silir. Real Cloudflare-də koordinator `durable_object` deyilsə → `COORD` binding və migration yoxlanmalıdır.

Node yoxdursa əl ilə (brauzerdə): UI-a gir → «Sistem vəziyyəti»: koordinator `durable_object`, yaddaş `KV`, media anbarı `qoşulub`, sirlər `təyin olunub`.

## 2. Modellər (az pul xərcləyir)

Node olan maşında: `ANTHROPIC_API_KEY` və `OPENAI_API_KEY` mühit dəyişəni ilə `npm run test:live`. Və ya UI-da «salam» yaz: cavab gəlməlidir. Səs: «Jarvis, salam» de, azərbaycanca cavab və səs gəlməlidir.

## 3. Platformalar (hər biri ayrı, yalnız test hesabı)

1. UI > Qoşulu hesablar > «Qoş» (OAuth) > icazə ver > «Canlı yoxla»: hesab adı görünməlidir.
2. Test məzmunu: UI «Əmr» sahəsinə «telegram test kanalına “test” yaz» və ya `POST /api/social/draft` → təsdiq qeydi açılmalıdır, **hələ heç nə göndərilməməlidir** (bu özü bir yoxlamadır).
3. Yalnız test kanalı/hesabı üçün təsdiq et. Nəticənin (`post id`/link) platformada həqiqətən göründüyünü gözünlə yoxla.
4. Shopify: yalnız **inkişaf/test mağazasında** məhsul hazırla → təsdiq → Shopify admin-də DRAFT olaraq göründüyünü yoxla. Sonra arxivlə.
5. Video: UI > Media > test videosu yüklə > «Video işi başlat». Emal xidməti qoşulubsa nəticənin yoxlama mərhələsindən keçdiyini gör.

## Nəticəni necə oxumaq

- Hər addım uğurlu → «real işləyir» (yalnız həmin hissə üçün).
- Platforma xətası → «Xətalar» bölməsi və audit jurnalı; sirr göstərilmir. `docs/TROUBLESHOOTING.md`.
- `unknown` status → əməliyyat yarımçıq qala bilər; platformada əl ilə yoxla, avtomatik təkrarlanmır.
