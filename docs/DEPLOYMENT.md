# Deploy

Deploy **sənin təsdiqinlə** edilir. Heç bir avtomatik deploy `main`-ə toxunmur: Claude `main`-ə push etmir, yalnız budaq və PR hazırlayır.

## Yoxlama (deploydan əvvəl)

Hər PR-da `ci.yml` bunları işlədir (secret istifadə etmir):

1. `npm run lint`: bütün `.js/.mjs` fayllarının sintaksisi
2. `node scripts/static-audit.mjs`: TODO/STUB/sirr nümunəsi/hardcoded chat_id axtarışı
3. `npm test`: bütün testlər (real API çağırmır)
4. `wrangler deploy --dry-run`: paketləmə və binding yoxlaması (deploy ETMİR)

Lokal olaraq nəticə (bu budaqda): bax son hesabat və `docs/SMOKE.md`.

## Real deploy

1. PR-ı merge et (`main`).
2. Cloudflare Workers Builds `main`-dən avtomatik build/deploy edir (Git bağlantısı artıq qurulub). İlk deployda `COORD` Durable Object (`JarvisCoordinator`, migration `v1`) özü yaranır; əlavə resurs yaratmaq lazım deyil.
3. Cron: hər 5 dəqiqədən bir gözləyən işləri irəlilədir. Yalnız təsdiq verilmiş işlərə toxunur.
4. Deploydan sonra `docs/SMOKE.md`.

## Geri qaytarma

Cloudflare > Workers > `jarvis-avtomat` > Deployments > əvvəlki versiyanı «Rollback». Durable Object migration geri alınmır; lakin köhnə kod `COORD` binding-i istifadə etmir və zərər vermir. KV/R2-dəki data qalır.

## Diqqət

- `PUBLIC_BASE_URL`-i deploydan **sonra** (Worker ünvanı bəlli olanda) yaz; OAuth redirect URI-ləri (Meta/TikTok/Google/Shopify panelində) bu ünvanla **eyni** olmalıdır: `<PUBLIC_BASE_URL>/oauth/<platform>/callback` (Shopify: `/oauth/shopify/callback`).
- `TOKEN_ENC_KEY`-i bir dəfə yarat və dəyişmə.
- Telegram webhook: UI > «Qoşulu hesablar» > «Telegram webhook-u qur» (və ya `POST /api/telegram/setup`).
