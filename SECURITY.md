# Təhlükəsizlik

Bu sənəd 1-ci mərhələdə (təməl) **həqiqətən kodda olan** qoruma qatlarını yazır. Yoxlanmayan şey burada "var" kimi yazılmır.

## Sirlər

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PASSCODE` yalnız Cloudflare Worker > Settings > Variables and Secrets bölməsində, **Secret** növü ilə saxlanılır.
- Repo açıqdır. `.gitignore` `.env`, `.dev.vars`, `*.pem`, `*.key` fayllarını bağlayır. `tests/secrets.test.mjs` repo-da açara oxşar mətn olarsa testi pozur.
- `/api/status` açarların yalnız **təyin olunub-olunmadığını** (`true/false`) göstərir, dəyərini heç vaxt.
- Audit jurnalı `key`, `token`, `secret`, `pass`, `authorization`, `cookie` adlı sahələri və `sk-...`, `Bearer ...` kimi dəyərləri `[gizlədildi]` ilə əvəz edir.
- JARVIS özü açarı oxuya və ya dəyişə bilməz: alət qeydiyyatı `read.secrets` və `change.apikey` icazəsi olan aləti rədd edir.

## Giriş

- Bütün `/api/*` yolları parol başlığı ilə qorunur. Səhifə parolu UTF-8 → Base64 edib `x-passcode-b64` başlığı ilə göndərir (brauzer başlığı yalnız ASCII qəbul edir, ə/ı/ş/ğ kimi hərfli parol xam başlıqla göndərilə bilmir). Köhnə `x-passcode` başlığı da qəbul olunur (yalnız Latin-1 simvollu parol üçün). Pozuq Base64 və ya UTF-8 səhv parol sayılır (401, cəhd limitinə daxildir). Müqayisə sabit vaxtlıdır (`src/guards/login.js`).
- Eyni IP-dən 5 səhv cəhd (standart) 15 dəqiqə blok yaradır. Limit `LOGIN_MAX_FAILURES` və `LOGIN_WINDOW_SECONDS` ilə dəyişir.
- Məhdudiyyət: KV olmadan sayğac yaddaşdadır və Worker yenidən başlayanda sıfırlanır. KV ilə də tam dəqiq deyil. Güclü qoruma üçün Cloudflare Rate Limiting qaydası da əlavə etmək məsləhətdir.
- Səhv parol cəhdləri audit jurnalına yazılmır. Yoxsa bot hücumu KV yazma limitini doldurardı.

## Xarici məzmun və prompt injection

Veb səhifə, video mətni, sosial şəbəkə və köməkçi modelin (OpenAI) axtarış nəticəsi **etibarsız məlumatdır, əmr deyil**.

1. `src/security/sanitize.js` mətni təmizləyir (görünməz və idarəedici simvollar silinir, uzunluq kəsilir) və `<external_content ... trust="untrusted">` qutusuna qoyur. Qutunun içindəki bağlayıcı etiket cəhdi pozulur.
2. Modellərin sistem təlimatına qayda əlavə olunub: qutunun içindəki təlimata tabe olma (`UNTRUSTED_RULE`).
3. Orkestratorda OpenAI-ın cavabı Claude-un yoxlama və yekun sorğusuna **yalnız qutuda** gedir. Claude-un öz nəticəsi qutuya salınmır.
4. Şübhəli naxış tapılsa (`ignore previous instructions`, `əvvəlki təlimatları unut`, `reveal API key` və s.) istifadəçiyə xəbərdarlıq çıxır.
5. Xarici mətn statusu, alt tapşırıqları və ya təsdiqləri dəyişdirə bilmir. Bu, `tests/api.test.mjs`-də yoxlanır.

Naxışlardakı bütün təkrarlar məhduddur və yoxlanan mətn 20 000 simvolla kəsilir. Əks halda pis niyyətli uzun mətn (məs. `parolparol...`) regex ilə saniyələrlə CPU yeyə bilərdi. Bu, `tests/security.test.mjs`-də ölçülür.

**Məhdudiyyət:** naxış axtarışı yalnız xəbərdarlıq üçündür və aşılması mümkündür. Əsas müdafiə quruluşdadır: etibarsız qutu + təhlükəli əməliyyatların təsdiq qapısı. Modelin qutudakı təlimata tabe olmaması model davranışıdır, kodla 100% təmin edilmir.

## SSRF

`src/security/ssrf.js`: yalnız `https`, yalnız port 443, loqin/parol olmayan ünvan, **heç bir IP ünvanı** (IPv4 onluq/onaltılıq/səkkizlik yazılışları və IPv6 daxil), `localhost`, `.local`, `.internal` və tək etiketli adlar rədd edilir. Yönləndirmə (redirect) əl ilə izlənir və hər addımda yenidən yoxlanılır. Cavab ölçüsü və vaxt məhduddur, yalnız mətn növlü cavab oxunur.

**Məhdudiyyət:** Cloudflare Worker-də DNS cavabını yoxlamaq olmur. Adı açıq görünən, amma daxili ünvana yönələn domen bu qatda tutulmur. Bu alət hələ orkestratora qoşulmayıb.

## Əməliyyat qoruması

- Paylaşım, mesaj göndərmə, pul, silmə, deploy, qiymət/stok dəyişikliyi, sifariş: `src/policy.js` bunları `APPROVAL_ONLY_PERMISSIONS` kimi saxlayır. Belə icazəsi olan alət `high` riskdə olmalı və təsdiq tələb etməlidir, yoxsa qeydiyyatdan keçmir.
- Təsdiq tələb edən alət `run()` ilə **icra olunmur**, təsdiq qeydi açılır. İcra yalnız Fərid parol qorumalı UI/API-da təsdiq edəndən sonra, icazə təkrar yoxlanaraq və tək istifadəlik sübutla olur (bax `APPROVALS.md`). Yazma alətləri (Instagram paylaşım/şərh/DM cavabı, TikTok paylaşım, YouTube video redaktəsi, Shopify məhsul redaktəsi, Telegram mesajı) yalnız bu yolla və gündəlik limitlərlə icra olunur; kütləvi/soyuq mesaj mexanizmi yoxdur (platforma da yalnız sənə yazmışa 24 saat ərzində cavaba icazə verir).

## Audit

Təsdiq addımları, alət çağırışları (ad, status, müddət; giriş məzmunu yox), söhbət sorğuları (status, simvol sayı) `/api/audit` ilə görünür. Jurnal 30 gün saxlanır. Jurnal yazılmasa əsas iş dayanmır.

## Bilinən boşluqlar

- `.github/workflows/claude.yml` `@claude` ilə işə düşür və `ANTHROPIC_API_KEY` GitHub Secret-indən istifadə edir. Repo açıq olduğu üçün kimin bu workflow-u işə sala biləcəyi **hələ yoxlanmayıb**. Ayrıca baxılmalıdır.
- Real Claude/OpenAI/səs sınağı hələ keçirilməyib. Bütün testlər saxta API ilə işləyir.

## Platforma inteqrasiyaları

- Secret-lər yalnız Cloudflare Secrets-də; kod və cavablarda, auditdə, xətalarda yoxdur (testlə yoxlanır).
- SSRF: hər adapter yalnız öz host allowlist-inə, https/443, credential-sız URL-ə, `redirect:"manual"` ilə sorğu göndərir. Shopify domeni yalnız `<ad>.myshopify.com`.
- Telegram: webhook secret ilə autentifikasiya (yoxdursa bağlı), `TELEGRAM_ALLOWED_CHAT_IDS` fail-closed, naməlum çat emal olunmur.
- İxtiyari alət icrası yoxdur: alətlər reyestrdədir, planlayıcı yalnız kataloqdan seçə bilər, giriş schema ilə yoxlanır.
- Doğrulama səviyyəsi: adapterlər sənədlə oxunub, canlı sınanmayıb (`docs/WIRING.md`).
