# Quraşdırma (sıfırdan, brauzerlə)

Hamısı **sənin hesablarında** edilir. Heç bir açarı çatda paylaşma. Kod tərəfi hazırdır; burada yalnız hesab/açar addımları var.

## Windows 7 haqqında

- Node.js 22 və `wrangler` Windows 7-də **işləmir**. Ona görə hər şey brauzerdən (Cloudflare və GitHub panelləri) edilir; terminal tələb olunmur.
- Cloudflare paneli köhnə brauzerdə düzgün açılmasa, telefonda və ya başqa kompüterdə aç. Bu mənim yoxlaya bilmədiyim məsələdir.
- Video emal serveri (`docs/VIDEO.md`) Windows 7-də işləmir: Linux VPS və ya başqa müasir kompüter lazımdır.
- `npm test` / `npm run check` yoxlamalarını Windows 7-də işlədə bilməzsən; onları GitHub Actions (`ci.yml`) avtomatik edir (PR-da yaşıl/qırmızı görünür).

## Addım 1: GitHub

1. Repo: `nurullayevferid4-creator/Jarvis-avtomat`. Pull request-ləri aç və merge et (hazır budaq: `feature/jarvis-production`).
2. Settings > Secrets and variables > Actions > New repository secret: ad `ANTHROPIC_API_KEY` (yalnız GitHub-da `@claude` komandasını istəyirsənsə). Dəyəri yalnız bu sahəyə yaz.

## Addım 2: Cloudflare Worker

1. Cloudflare > Workers & Pages > `jarvis-avtomat` (Git ilə bağlı). KV (`jarvis-kv`) və R2 (`jarvis-r2`) artıq `wrangler.toml`-da göstərilib. R2 bucket **ictimai olmamalıdır** (R2 > jarvis-r2 > Settings: Public access söndürülü).
2. Worker > Settings > Variables and Secrets: `docs/ENVIRONMENT.md`-dəki məcburi sirləri əlavə et: `PASSCODE`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TOKEN_ENC_KEY`, `MEDIA_SIGNING_KEY` və Variable kimi `PUBLIC_BASE_URL`.
3. Deploy (`docs/DEPLOYMENT.md`) bitəndən sonra Worker ünvanını aç, parolu yaz, «Daxil ol / yoxla» bas.
4. «Sistem vəziyyəti» bölməsində koordinator `durable_object`, yaddaş `KV`, media anbarı `qoşulub` görünməlidir.
5. `docs/SMOKE.md`-dəki sınaqları icra et.

## Addım 3: Platformalar (hər biri ayrı, istədiyin qədər)

Təfərrüat `docs/INTEGRATIONS.md`-dədir. Hər platforma üçün əvvəl yalnız **özünün test/şəxsi hesabı** ilə sına, real auditoriya hesabında yox. Platforma təsdiqləri (Meta App Review, TikTok audit, Google verification) mənim əlimdə deyil.

## Addım 4: Video emalı (istəyə bağlı)

`docs/VIDEO.md`. Bunsuz şəkil, video yükləmə, analiz və paylaşım işləyir; yalnız avtomatik kəsmə/format çevirmə işləmir.

## Nəyi heç vaxt etmə

- Açarı kodda, issue-da, PR-da, çatda, ekran görüntüsündə paylaşma.
- Real sosial hesabda test paylaşımı etmə (`social.publish` yalnız sənin təsdiqinlə işləyir; yenə də test üçün ayrıca hesab işlət).
