# Cloudflare KV qurulumu (JARVIS_KV)

Hazırda Cloudflare hesabında JARVIS üçün KV namespace **yoxdur**. KV olmadan təsdiq qeydləri, bilik bazası, öyrənmə, lead-lər və Telegram təkrar-qorunması yalnız Worker prosesinin yaddaşında qalır və yenidən başlayanda itir. Namespace ID-ni uydurmaq olmaz: real ID yalnız namespace yaradılandan sonra Cloudflare verir.

## Nə lazımdır
- Cloudflare hesabında Workers KV yaratmaq icazəsi (Workers KV Storage: Edit) olan istifadəçi və ya API token.
- Bu repoda `wrangler.toml`-da KV bloku **şərhdədir**. İD yazılmadan açılsa deploy uğursuz olur.

## Addımlar (sən edirsən)
1. Namespace yarat, birini seç:
   - Terminal: `npx wrangler login`, sonra `npx wrangler kv namespace create JARVIS_KV`. Çıxışda `id = "…"` (32 hex simvol) görünəcək.
   - Dashboard: Storage & Databases → KV → Create Instance → ad `JARVIS_KV`; yaradılan namespace-in ID-ni kopyala.
2. `wrangler.toml`-da 3 şərhli sətri aç və real ID-ni yaz:
   ```toml
   [[kv_namespaces]]
   binding = "JARVIS_KV"
   id = "<real 32 simvollu id>"
   ```
3. Branch/PR ilə commit et. Deploy-dan sonra `/api/status` cavabında `storage: "kv"` görünməlidir.

Namespace ID gizli məlumat deyil, commit etmək olar. API token isə **heç vaxt** repoya yazılmır.

## Yoxlama
- `npx wrangler deploy --dry-run` — binding `env.JARVIS_KV (<id>) KV Namespace` kimi göstərilməlidir. (Bu mərhələdə ID olmadığı üçün dry-run "No bindings found" göstərir; scratch nüsxədə sınaq ID ilə binding-in düzgün oxunduğu yoxlanıb.)
- Mövcud storage/state kodu dəyişməyib: `JARVIS_KV` varsa KV, yoxdursa yaddaş istifadə olunur.

## Qeyd
`wrangler.toml`-da `keep_vars = true` əlavə olunub: dashboard-da yazdığın gizli olmayan dəyişənlər (`TELEGRAM_ALLOWED_CHAT_IDS`, `SHOPIFY_STORE_DOMAIN`) deploy zamanı silinmir. Secret-lərə bu ayar təsir etmir.
