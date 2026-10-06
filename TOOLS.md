# Alət reyestri

`src/tools/registry.js` JARVIS-in istifadə edə biləcəyi alətləri təsvir edir. Daxili alətlər `src/tools/builtin.js`-dədir.

**Status:** reyestr hazırdır və testlərlə yoxlanıb, amma alətlər hələ **orkestratora qoşulmayıb**. Onlar yalnız `/api/status`-da siyahıda görünür. Qoşulma sonrakı mərhələdir.

## Hər alətin sahələri

| Sahə | Məna |
|---|---|
| `name` | `kiçik.hərflərlə` ad |
| `description` | nə edir |
| `inputSchema` / `outputSchema` | giriş və çıxış sxemi (`src/validate.js`) |
| `permissions` | tələb olunan icazələr |
| `risk` | `low` / `medium` / `high` |
| `timeoutMs` | vaxt limiti (1–60 san) |
| `retries` | təkrar cəhd (0–2) |
| `requiresApproval` | təsdiq tələbi |

## Qaydalar (qeydiyyat zamanı məcburi)

- Giriş və çıxış sxemi olmalıdır.
- `risk` `medium` və ya `high` olan alət `requiresApproval: true` olmalıdır.
- `publish.social`, `send.message`, `spend.money`, `delete.data`, `deploy.code`, `change.price`, `change.stock`, `place.order` icazəsi olan alət `high` riskdə və təsdiqli olmalıdır.
- `read.secrets` və `change.apikey` icazəsi heç bir aləti qeydiyyatdan keçirmir.

Siyasət bir yerdə dəyişdirilir: `src/policy.js`.

## `run()` axını

1. Alət varmı → yoxdursa `not_found`
2. Giriş sxemi → `invalid_input`
3. İcazə → `denied`
4. Təsdiq tələbi → alət **icra olunmur**, `pending_approval` + `approval_id`
5. İcra (vaxt limiti və təkrar cəhd ilə) → `timeout` / `error`
6. Çıxış sxemi → `invalid_output` (nəticə qaytarılmır)
7. Audit jurnalı (alət adı, status, müddət; giriş məzmunu yox)

## Daxili alətlər

| Alət | Risk | Qeyd |
|---|---|---|
| `web.fetch` | low | Açıq HTTPS səhifəni oxuyur (SSRF qorumalı). Nəticə `<external_content>` qutusunda gəlir. Real internetlə sınanmayıb, yalnız saxta fetch ilə test olunub. |
| `knowledge.search` | low | Bilik bazasında axtarış |
| `knowledge.add` | low | Bilik bazasına qeyd (təkrar saxlanmır) |
| `social.publish` | high | Paylaşım aləti (Instagram, TikTok, YouTube, Telegram). **Özü paylaşmır:** strukturlu təsdiq qeydi (`payload` + hash) açır. Real paylaşımı təsdiqdən sonra `src/social/flow.js` edir. Sahələr: `platform`/`platforms`, `caption`, `title`, `description`, `hashtags`, `media_id`/`media_url`, `media_type`, `thumbnail_media_id`, `privacy` (standart `private`), `made_for_kids`. Bax `SOCIAL.md`. |

## Yeni alət əlavə etmək

`builtin.js`-də `reg.register({...})` çağır, sxemləri və riski yaz. Qaydalara uymasa qeydiyyat xəta ilə dayanır. Yeni alət üçün `tests/tools.test.mjs`-ə test əlavə et.
