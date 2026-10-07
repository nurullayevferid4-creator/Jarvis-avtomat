# Mühit dəyişənləri və sirlər

**Sirr** (Secret) = Cloudflare panelində Worker > Settings > Variables and Secrets > Add > Type: **Secret**. Kodda, GitHub-da, çatda **heç vaxt** yazılmır.
**Adi dəyişən** (Variable) = sirr deyil, eyni yerdə «Text» kimi və ya `wrangler.toml` `[vars]` bölməsində.
Bindinqlər (`JARVIS_KV`, `JARVIS_MEDIA`, `COORD`) `wrangler.toml`-dadır, əl ilə yazılmır.

`/api/status` və UI «Sistem vəziyyəti» yalnız «təyin olunub / olunmayıb» göstərir; **düzgünlüyünü** göstərmir. Düzgünlük `docs/SMOKE.md` ilə yoxlanır.

## Məcburi (olmadan `/api/talk` işləmir)

| Ad | Növ | Nə üçün |
|---|---|---|
| `PASSCODE` | Secret | Panelə giriş parolu (ə/ı/ş/ğ ola bilər; güclü seç) |
| `ANTHROPIC_API_KEY` | Secret | Claude (lider model) |
| `OPENAI_API_KEY` | Secret | OpenAI (köməkçi, səs tanıma, səsləndirmə, ehtiyat) |

## Sosial / OAuth / media (platforma qoşmaq üçün məcburi)

| Ad | Növ | Nə üçün |
|---|---|---|
| `PUBLIC_BASE_URL` | Variable | Worker-in `https://host` ünvanı (yolsuz). OAuth callback, Telegram webhook və media ünvanı üçün. Ətrafdakı boşluq/dırnaq və sondakı `/` avtomatik təmizlənir. **Diqqət:** dashboard-da «Text» kimi yazılan dəyişəni `wrangler deploy` silə bilər; repo-da `keep_vars = true` var. Telegram webhook-u üçün dəyər yoxdursa Worker sorğunun öz https ünvanını işlədir və bunu bildirir |
| `TOKEN_ENC_KEY` | Secret | Saxlanmış platforma tokenlərini AES-GCM ilə şifrələyir. **Məcburidir**: onsuz OAuth başlamır, token yazılmır. Dəyişsən tokenlər oxunmur, yenidən qoşmaq lazım olur |
| `MEDIA_SIGNING_KEY` | Secret | Müvəqqəti media ünvanlarının imzası (Instagram media-nı ünvandan çəkir) |
| `TELEGRAM_BOT_TOKEN` | Secret | BotFather tokeni |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | 1-256 simvol, yalnız `A-Z a-z 0-9 _ -` |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Variable/Secret | İdarə edə bilən Telegram istifadəçi ID-ləri (vergüllə). Boşdursa **heç kim** idarə edə bilməz |
| `TELEGRAM_CHANNEL_ID` | Variable | Paylaşım kanalı (`@kanal` və ya `-100...`), bot orada admin olmalıdır |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Secret | Meta tətbiqi (Instagram Login) |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Secret | TikTok developer tətbiqi |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Secret | Google OAuth client (YouTube Data API v3) |

## Shopify (qoşmaq üçün)

| Ad | Növ | Nə üçün |
|---|---|---|
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Secret | Shopify tətbiqinin Client ID / Secret (OAuth və webhook imzası) |
| `SHOPIFY_SHOP` | Variable | İstəyə bağlı: yalnız bu mağaza qoşula bilər |
| `SHOPIFY_SCOPES` | Variable | İstəyə bağlı (standart `read_products,write_products,read_orders,read_inventory,write_inventory`) |
| `SHOPIFY_API_VERSION` | Variable | İstəyə bağlı (standart `2026-07`) |

## İstəyə bağlı

| Ad | Növ | Nə üçün |
|---|---|---|
| `KIMI_API_KEY`, `KIMI_MODEL`, `KIMI_BASE_URL` | Secret/Variable | Üçüncü AI: araşdırma / ikinci rəy. Yoxdursa heç nə pozulmur |
| `VIDEO_PROCESSOR_URL`, `VIDEO_PROCESSOR_TOKEN` | Variable / Secret | Video emal xidməti (`docs/VIDEO.md`). Yoxdursa video emal olunmur, redaktə tələb edən iş `FAILED` olur |
| `CLAUDE_MODEL`, `OPENAI_MODEL`, `OPENAI_WEB_SEARCH_TOOL`, `TTS_VOICE` | Variable | Model adları, səs (standart `onyx`; digərləri: alloy, ash, ballad, coral, echo, fable, nova, sage, shimmer, verse, marin, cedar) |
| `STT_MODEL` | Variable | Səs tanıma modeli (standart `gpt-4o-transcribe`; layihədə yoxdursa avtomatik `whisper-1`) |
| `TTS_MODEL` | Variable | Səsləndirmə modeli (standart `gpt-4o-mini-tts` Azərbaycan təlimatı ilə; yoxdursa avtomatik `tts-1`) |
| `INSTAGRAM_API_VERSION` | Variable | Standart `v25.0` |
| `MAX_SUBTASKS`, `MAX_MODEL_CALLS`, `MAX_RETRIES`, `CALL_TIMEOUT_SECONDS` | Variable | Limitlər |
| `LOGIN_MAX_FAILURES`, `LOGIN_WINDOW_SECONDS` | Variable | Parol cəhd limiti |
| `FEATURE_VOICE`, `FEATURE_APPROVALS`, `FEATURE_KNOWLEDGE` | Variable | `0` ilə söndürür |

## Təsadüfi açar necə yaradılır (Windows 7, yalnız brauzerlə)

`PASSCODE` özün seçdiyin parol olur. `TOKEN_ENC_KEY`, `MEDIA_SIGNING_KEY`, `TELEGRAM_WEBHOOK_SECRET` üçün təsadüfi mətn: brauzerdə istənilən boş səhifəni aç, `F12` → «Console» və bunu yapışdır:

```
[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')
```

Çıxan 64 simvolu **birbaşa Cloudflare-in Secret sahəsinə** köçür. Mənə və ya heç kimə göndərmə, GitHub-a yazma. Hər açar üçün ayrı-ayrı yarat.

## Lokal sınaq

`.dev.vars` faylı (`.gitignore`-dadır) yalnız lokal `wrangler dev` üçündür; real açarları ora yazma, saxta dəyər yaz.
