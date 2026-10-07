# Xəta aradan qaldırma

| Əlamət | Səbəb | Nə et |
|---|---|---|
| `401` | Parol səhvdir | UI-da parolu yenidən yaz. Parolda ə/ı/ş/ğ ola bilər (Base64 ilə göndərilir) |
| `429` | Çox səhv cəhd (standart 5 → 15 dəq blok) | Gözlə |
| `500 ANTHROPIC_API_KEY və ya OPENAI_API_KEY təyin edilməyib` | Sirr yoxdur | `docs/ENVIRONMENT.md` |
| Status: koordinator «memory» | `COORD` Durable Object bağlanmayıb | Deploy-un migration-ı keçdiyini yoxla (`wrangler.toml` `[[migrations]]`); məsələ həll olmayana qədər çox-nüsxəli yarış qorunması zəifdir |
| Təsdiq `409` | Artıq qərar verilib və ya icra edilib | Normaldır (bir dəfə icra qaydası). Yeni qeyd yarat |
| Təsdiq `403` | Qeyd başqa çat/istifadəçi üçündür | UI/çat uyğunsuzluğu |
| Təsdiq nəticəsi `unknown` | Şəbəkə/vaxt xətası: əməliyyat yarımçıq ola bilər | Platformada əl ilə yoxla; avtomatik təkrarlanmır |
| «icra xidməti 30 dəqiqə» / `expired` | Təsdiqdən sonra icra pəncərəsi bitib | Yeni qeyd yarat |
| `Content-Length lazımdır` (411) | Yükləmə sorğusunda ölçü yoxdur (bəzi proxy-lər çıxarır) | Başqa şəbəkə/brauzer; JPEG/PNG/MP4/MOV/PDF faylı birbaşa seç |
| `Fayl növü dəstəklənmir` | Başlıqdakı növ və ya faylın real baytları uyğun gəlmir | Faylı yenidən eksport et (MP4/H.264) |
| `TOKEN_ENC_KEY təyin edilməyib` | OAuth üçün məcburidir | Secret əlavə et |
| `PUBLIC_BASE_URL (https://...) təyin edilməyib` | OAuth/webhook/media ünvanı üçün lazımdır | Variable əlavə et, sonunda `/` olmasın |
| OAuth «state etibarsızdır» | 10 dəqiqə keçib və ya təkrar | «Qoş»-u yenidən bas |
| Instagram media çəkilmir | `MEDIA_SIGNING_KEY`/`PUBLIC_BASE_URL` yoxdur və ya R2 bucket yoxdur | UI Sistem vəziyyəti |
| Video işi `FAILED: Video emal xidməti qoşulmayıb` | `VIDEO_PROCESSOR_*` yoxdur və redaktə tələb olunur | `docs/VIDEO.md` |
| TikTok «unaudited / SELF_ONLY» | TikTok audit keçməyib | Platforma tərəfində audit |
| YouTube video `private` | API layihəsi təsdiqlənməyib | Google tərəfində verification |
| Telegram cavab vermir | `TELEGRAM_ALLOWED_CHAT_IDS`-də ID yoxdur, webhook qurulmayıb və ya secret uyğun deyil | Webhook-u qur, ID-ni yoxla (icazəsizə **bilərəkdən** cavab verilmir) |
| UI-da heç nə işləmir, boş səhifə | Çox köhnə brauzer (CSP/ES5 xaric funksiyalar) | Başqa/yeni brauzer; səhifə `fetch` və `TextEncoder` tələb edir |
| Səs işləmir | Mikrofon icazəsi, `FEATURE_VOICE=0`, brauzer `MediaRecorder` dəstəkləmir | Mətnlə yaz; icazə ver |

## Hara baxmaq

UI > «Xətalar (bu sessiya)», «Audit jurnalı», «Sistem vəziyyəti». Xəta mətnində sirr, stack və URL olmur; ətraflı texniki məlumat yalnız audit jurnalındadır.
