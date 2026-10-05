# Claude ↔ Codex avtomatik dövrü (dizayn və vəziyyət)

Status: **dizayn + test olunan qərar skripti hazırdır; workflow qaralaması AKTİV DEYİL və Actions-da heç vaxt işləməyib.** Aşağıda hər iddianın yanında yoxlanılıb/yoxlanılmayıb yazılıb.

## Model

| Rol | Kim | Nə edir |
|---|---|---|
| Developer | Claude | kod yazır, test edir, commit/push edir, Codex review-nu oxuyur, P1/P2-ni özü koddan yoxlayıb düzəldir |
| Senior Reviewer | Codex (`chatgpt-codex-connector[bot]`) | PR-a review verir, P1/P2-ni göstərir, uyğundursa təmiz nəticə bildirir |
| Əlaqə kanalı | GitHub PR | Claude və Codex birbaşa danışmır, yalnız review/şərh |
| Son qərar | Fərid | merge həmişə onda qalır; dövr merge etmir |

```
Claude push → "@codex review" → Codex review/şərh
   → gate.mjs (qərar) ─ skip / stop (səbəb PR-a yazılır)
                       └ fix → Claude düzəldir + test + push
                              → verify (xətti, ≤3 commit, qadağan yola toxunmayıb)
                              → "@codex review" (yeni commit üçün, bir dəfə) → …
   təmiz rəy (cari commit) → DAYAN. Merge yoxdur.
```

## Codex hadisələrinin real forması (PR #6 və #7-dən oxunub, yoxlanılıb)

| Hadisə | Necə gəlir | GitHub event |
|---|---|---|
| Tapıntı | `pull_request_review` (state `COMMENTED`, `commit_id` = baxılan commit). P1/P2 ya review mətnində (permalink + `![P2 Badge]`), ya inline şərhdə | `pull_request_review: submitted` və `pull_request_review_comment` |
| Təmiz nəticə | **review deyil**, PR-ın adi şərhi: `Codex Review: Didn't find any major issues` + `**Reviewed commit:** \`sha10\`` (PR #7-də 👍 reaksiya da var) | `issue_comment: created` |
| Limit | adi şərh: `You have reached your Codex usage limits for code reviews.` | `issue_comment: created` |
| Bot kimliyi | `user.login = chatgpt-codex-connector[bot]`, `user.type = Bot`, `author_association = NONE` | |

Nəticə: yalnız `pull_request_review` kifayət etmir. Təmiz nəticə və limit mesajı üçün `issue_comment` da dinlənir. Bot hadisələrinin workflow run yaratdığı yoxlanılıb (mövcud `claude.yml`-in `pull_request_review_comment` run-ları Codex şərhlərindən sonra yaranıb; `if` şərti ödənmədiyi üçün "skipped").

## Fayllar

| Fayl | Rol | Vəziyyət |
|---|---|---|
| `scripts/codex-loop/gate.mjs` | bütün qərarlar (təmiz funksiyalar) + `decide` / `verify` CLI | yazılıb, 61 testlə yoxlanıb (31 vahid/statik + 30 simulyasiya), PR #6/#7 üzərində oxuma rejimində işlədilib |
| `scripts/codex-loop/config.json` | bot adı, budaq prefiksi, raund limiti, həssas/workflow yolları | hazır |
| `.github/workflow-drafts/claude-codex-loop.yml` | workflow qaralaması | **aktiv deyil**, YAML sintaksisi parse olunur, Actions-da işləməyib |
| `tests/codex-loop.test.mjs` | gate + qaralamanın statik təhlükəsizlik yoxlamaları | `npm test`-ə daxildir |
| `tests/codex-loop-simulation.test.mjs` | 17 ssenari cədvəli + saxta GitHub dünyasında bütöv dövr | `npm test`-ə daxildir |

Mövcud `.github/workflows/claude.yml`-ə toxunulmayıb (yalnız `@claude` ilə işləyir, `ANTHROPIC_API_KEY` tələb edir).

## Tələblərin necə ödənildiyi

| # | Tələb | Mexanizm | Yoxlama |
|---|---|---|---|
| 1-3 | workflow audit, Codex event-i, `pull_request_review` əsaslı mexanizm | yuxarıdakı cədvəl, qaralama | audit real məlumatla, qaralama işləməyib |
| 5 | review oxumaq, P1/P2 ayırmaq | `parseFindings`: `![P0-P3 Badge]` həm review mətnində, həm inline | test (real forma) |
| 6 | stale review | `review.commit_id === pr.head.sha`, təmiz rəydə `Reviewed commit` prefiksi cari başla uyğun olmalıdır; fix job başlayanda HEAD yenidən yoxlanır | test |
| 7 | sonsuz dövr | review id və commit SHA state-də; eyni id/commit ikinci dəfə işlənmir; state fix-dən ƏVVƏL yazılır; bot-şərhləri süzgəcdən keçmir (github-actions[bot] `if`-dən çıxır) | test |
| 8 | raund limiti | `max_rounds = 8`; dolanda `stopped`, `reset` limiti sıfırlamır | test |
| 9 | yalnız `claude/*` | `if` + `eligibility`: açıq PR, eyni repo (fork yox), `claude/` prefiksi, baza `main` | test |
| 10 | yalnız gözlənilən bot | `login` + `type=Bot` dəqiq uyğunluq; payload yox, API-dən yenidən oxunan review/şərh | test |
| 11 | review mətni etibarsızdır | `<external_content trust="untrusted">` qutusu; ümumi və dövrə xas injection izi (`gh pr merge`, `--force`, `.github/workflows`, açar adları…) tapılsa `injection_suspected` və insan | test |
| 12 | P0 / həssas dəyişiklik | P0 → stop; PR-da `src/security/`, `src/approval/`, `src/guards/`, `src/audit/`, `SECURITY.md`, `wrangler.toml`, `package.json`, `AGENTS/CLAUDE/TEAM.md`, `scripts/codex-loop/` varsa avtomatik düzəliş yox | test |
| 13 | `.github/` dəyişiklikləri | gate-də stop və düzəlişdən sonra `verify`-də stop | test |
| 14-15 | merge hüququ yox, qərar Fərid-də | workflow-da merge addımı yoxdur; Claude-a `gh pr merge/close`, force push, `main`-ə push qadağandır (`--disallowedTools`); təmiz rəy yalnız "dayan" deməkdir | statik test + `verify` guard-ı; **icra səviyyəsində zəmanət yoxdur**, bax "Pre-activation audit" |
| 16 | concurrency | `concurrency: codex-loop-pr-<N>`, `cancel-in-progress: false` | statik test; Actions-da yoxlanmayıb |
| 17 | review ID + SHA saxlanması | PR-dakı gizli state şərhi (`<!-- codex-loop-state:v1 {...} -->`), yalnız `github-actions[bot]` tərəfindən yazılanı qəbul olunur, pozulmuş state → stop | test |
| 18 | limitdən sonra mövcud PR-lar | `workflow_dispatch` (pr_number); `codex_limit` şərhi dövrü `waiting_limit`-ə qoyur və yeni sorğu yazmır | test |

Əlavə: skript PR budağından yox, **main-dən (trusted) checkout** ilə işləyir; PR-ın dəyişdirdiyi gate.mjs qərar vermir. `verify` Claude-un push-undan sonra: xətti irəliləmə, ≤3 commit, `.github/` və həssas yola toxunmama yoxlayır, sonra `@codex review` yazır.

## Simulyasiya (aktivləşdirmədən əvvəl)

`tests/codex-loop-simulation.test.mjs`: şəbəkə yoxdur (fetch söndürülür), GitHub-a yazma yoxdur (saxta api yalnız oxuyur), giriş deep-freeze edilir, hər ssenari iki dəfə işləyib eyni nəticə verir.

17 ssenari: P1/P2 → fix; təmiz şərh → stop; limit → stop; köhnə commit → skip; təkrar review → skip; 8 raund → stop; P0 → stop; `.github/` → stop; həssas fayl → stop; `gh pr merge`/`--force` izi → stop; etibarsız bot → skip; bağlı PR → skip; `claude/*` olmayan budaq → skip; fork → skip; cari HEAD + P1/P2 → fix; adi şərh kimi təmiz nəticə → stop; adi şərh kimi limit → stop.

Bütöv dövr (saxta dünya, `collect` → `decide` → Claude düzəlişi → `verifyFix` → `@codex review`): P2 → fix → sorğu → P1 → fix → sorğu → təmiz → stop; eyni review 5 dəfə → 1 düzəliş; sonsuz tapıntı → 8 düzəlişdən sonra stop; Claude dəyişiklik etməsə və ya `.github/`/həssas yola toxunsa sorğu yoxdur; limit → dispatch ilə bir sorğu; yarımçıq düzəlişdə eyni commit üçün təkrar iş yoxdur; həssas fayllı PR-da heç bir düzəliş başlamır.

Simulyasiyanın tapdığı və düzəldilən 3 boşluq: (1) `claude/` ilə başlayan qeyri-standart simvollu budaq adı prompta qutudan kənarda düşə bilərdi, indi `[A-Za-z0-9._/-]{1,100}` tələb olunur (workflow-dakı yoxlama ilə eyni); (2) yol qaydaları hərf registrinə həssas idi, indi deyil; (3) tanınmayan formatlı inline Codex şərhi səssizcə `skip` olurdu, indi `unparsed_findings` ilə dayanır.

Bilinən sərhəd: Claude-un düzəliş işi yarımçıq qalsa, həmin commit üçün gələn yeni review `sha_already_handled` ilə buraxılır (sonsuz dövr yoxdur, amma dövr irəliləmir). Davam etmək üçün yeni commit (əl ilə düzəliş) lazımdır.

## Pre-activation audit (70dcb93 üzərindən)

Mənbələr: `anthropics/claude-code-action` `main` budağının `action.yml`, `docs/usage.md`, `docs/security.md`, `src/github/validation/{actor,permissions}.ts`, `src/github/token.ts`, `src/modes/detector.ts` (WebFetch ilə oxunub, xülasə şəklində; action icra edilməyib); GitHub sənədləri (events, triggering a workflow, concurrency); repo-nun real Actions run siyahısı.

### A) Sübut edilmiş (sənəd və ya real məlumatla)
- Action input-ları `prompt`, `claude_args`, `anthropic_api_key`, `github_token`, `allowed_bots` `action.yml`-də mövcuddur. `claude_args` sənədi `--max-turns`, `--allowedTools`, `--disallowedTools` nümunələrini göstərir. Qaralamada başqa input yoxdur (test bunu yoxlayır).
- **Düzəldilən problem 1:** action default olaraq botları rədd edir ("Workflow initiated by non-human actor … Add bot to allowed_bots"). Bizdə actor Codex botudur, ona görə `allowed_bots: chatgpt-codex-connector` əlavə olundu ("*" yox). Müqayisə `[bot]` şəkilçisini və hərf registrini nəzərə almır.
- **Düzəldilən problem 2:** `id-token: write` və Claude App OIDC yolu lazımsız idi. `github_token` verildikdə action OIDC mübadiləsini atlayır (`OVERRIDE_GITHUB_TOKEN`). `github_token: ${{ github.token }}` verildi, `id-token` silindi.
- `prompt` verildikdə `issue_comment`/`pull_request_review`-da action agent rejiminə keçir və `@claude` tələb etmir (`detector.ts`).
- **Codex botunun hadisələri workflow run yaradır:** real run siyahısında `actor=chatgpt-codex-connector[bot]` ilə `issue_comment` (limit şərhi, 12:47Z) və `pull_request_review_comment` run-ları var (`skipped`, çünki `claude.yml`-in `if` şərti ödənmir). Approval-required vəziyyəti görünmür.
- Codex-in üç nəticə forması (review, adi şərh kimi təmiz nəticə, adi şərh kimi limit) PR #6/#7-dən oxunub və testlərdə eyni formada işlənir.
- **GITHUB_TOKEN rekursiyası:** GitHub sənədi: `GITHUB_TOKEN` ilə törədilən hadisələr yeni workflow run yaratmır (istisna: `workflow_dispatch`, `repository_dispatch`, `pull_request` opened/synchronize/reopened approval-required halda). Nəticə: workflow-un state/bildiriş şərhləri, `@codex review` şərhi və Claude-un push-u (`GITHUB_TOKEN`) yeni run başlatmır, öz-özünə dövr mümkün deyil. Bu, sənəd əsaslıdır; canlıda yoxlanmayıb. `CODEX_TRIGGER_TOKEN` (PAT/App) verilərsə, onun şərhi `issue_comment` run-ı yarada bilər: `if` süzgəci (yalnız Codex botu) onu dayandırır.
- `issue_comment` və `workflow_dispatch` workflow faylı default branch-dan götürülür və orada mövcud olmalıdır. `issue_comment` payload-ında PR-ın head məlumatı yoxdur: gate onu API-dən oxuyur (payload-a etibar edilmir).
- **Fork:** sənəd: fork-dan gələn hadisədə secret-lər ötürülmür və `GITHUB_TOKEN` yalnız oxuyur. Qaralamada fork PR üç səviyyədə bloklanır: gate job `if`, gate.mjs `eligibility` (`fork_or_unknown_head`) və fix job `if` (`head.repo.full_name == github.repository` + yalnız `pull_request_review`). Fork üçün fix heç vaxt işləmir.
- Permission-lar minimuma endirildi: workflow default `contents: read`; gate `issues: write` (state/bildiriş şərhi); fix `contents: write` + `pull-requests: read` + `issues: read`; post `issues: write`. **`contents: write` niyə:** Claude düzəlişi PR budağına `git push origin HEAD` ilə göndərir, bunun başqa yolu yoxdur. `pull-requests: write` heç yerdə yoxdur (statik test).
- **Merge guard-ları (qatlar):** (1) workflow-da merge addımı yoxdur; (2) Claude-a `gh pr merge/close`, force push, `main`-ə push qadağandır, icazə siyahısı dardır; (3) fix job tokeni `pull-requests: read`; (4) `verify` Claude-dan sonra PR-ın açıq və merge olunmamış olduğunu, `main`-in SHA-sının dəyişmədiyini (gate job-da yazılan SHA ilə) və dəyişikliyin xətti, ≤3 commit, `.github/`/həssas yola toxunmayan olduğunu yoxlayır; pozulubsa `@codex review` yazılmır və dövr dayanır. Hamısı statik və simulyasiya testlərindədir.
- `.github/`, həssas fayl, P0, `unparsed_findings`, injection izi, raund limiti, təkrar review ID/SHA, köhnə review: hamısı `gate.mjs`-də (61 test) və workflow-da yalnız gate-in `fix`/`request_review` qərarı ilə icra olunur; fix job `needs.gate.outputs.action == 'fix'` olmadan başlamır; state fix-dən əvvəl yazılır.
- gate.mjs yalnız `trusted/` (default branch) checkout-dan işləyir; qaralamada PR budağından işləyən heç bir `node …gate.mjs` yoxdur (statik test).

### B) Hələ nəzəri / sübut olunmayan
- Action heç vaxt icra olunmayıb. İnput-lar `main` budağında yoxlanıb; `@v1` etiketinin eyni olduğu yoxlanmayıb. `github_token` + `allowed_bots` + agent rejimi `pull_request_review`-da birlikdə canlı yoxlanmayıb.
- Codex `github-actions[bot]` tərəfindən yazılan `@codex review` şərhinə cavab verəcəkmi: **bilinmir** (açıq risk). Əvvəlki sorğular sənin hesabınla yazılıb.
- Bot tərəfindən başladılan eyni-repo run-larında secret-lərin (`ANTHROPIC_API_KEY`) əlçatanlığı: GitHub sənədi yalnız fork və Dependabot üçün məhdudiyyət göstərir; üçüncü tərəf App hadisəsi üçün canlı yoxlanmayıb.
- `pull_request_review` hadisəsində hansı workflow faylı versiyasının işləməsi: sənəd xülasəsi "base repo default branch versiyası" deyir, mən əvvəl PR merge commit-i fərz etmişdim. Hər iki halda gate trusted checkout-dandır; birincidirsə, workflow yalnız `main`-ə merge olunandan sonra işləyir.
- Merge API-nin tələb etdiyi dəqiq token icazəsi (`pull-requests: write` + `contents: write`) sənəddən çıxarıla bilmədi (səhifə kəsildi). `pull-requests: read` guard-ı gözlənilən, amma canlıda sınanmayıb.
- **Concurrency:** GitHub sənədi: qrupda eyni anda 1 icra və 1 gözləyən ola bilər, yeni gələn gözləyəni **ləğv edib əvəz edir**. Fix işləyərkən (dəqiqələr) bir-birinin ardınca 2+ hadisə gəlsə, aralarındakı hadisə itə bilər. Normal axında Codex yeni review-nu yalnız bizim `@codex review`-dan sonra verir, ona görə nadirdir, amma istisna deyil. İtmiş hadisəni `workflow_dispatch` ilə bərpa etmək olar.
- `ANTHROPIC_API_KEY` secret-inin mövcudluğu mənə görünmür.

## Limit açıldıqdan sonra

1. Fərid dashboard-da limitin açıldığını görür.
2. İki yol:
   - **A (Actions):** workflow aktivdirsə, Actions → "Claude Codex Loop" → Run workflow → `pr_number`. Gate bir `@codex review` yazır, sonrası avtomatikdir.
   - **B (Claude sessiyası, secret tələb etmir):** `node scripts/codex-loop/gate.mjs decide --repo OWNER/REPO --pr N --use-gh` son Codex hadisəsinə baxıb nə ediləcəyini deyir; sessiya düzəldir, test edir, push edir və bir `@codex review` yazır. Bu rejim bu gün işləyir.

## Manual addımlar (Fərid-in icazəsi olmadan edilmir)

1. Workflow-u aktivləşdirmək: qaralamanı `.github/workflows/claude-codex-loop.yml` olaraq köçürmək (ayrıca PR, Fərid baxır).
2. `ANTHROPIC_API_KEY` repo secret-i (Actions rejimi üçün). Vəziyyəti mən görə bilmirəm: `claude.yml`-in 04.10 run-ı auth səbəbindən uğursuz olub, sonrakı run-larda action addımı "success" göstərir, amma log-lar əlçatan deyil (proxy bloklayır), ona görə bunun real işlədiyini bilmirəm. B rejimi bunu tələb etmir.
3. İstəyə görə `CODEX_TRIGGER_TOKEN` (fine-grained PAT və ya GitHub App tokeni, yalnız bu repo, yalnız PR/Issue şərh yazma). Səbəb: `@codex review` şərhini `GITHUB_TOKEN` yazarsa (`github-actions[bot]`), Codex-in ona cavab verib-verməyəcəyi **yoxlanılmayıb**.
4. Tövsiyə: `main` üçün branch protection (PR + review tələbi). Hazırda `main` qorunmur.
5. Tövsiyə: üçüncü tərəf action-ları commit SHA-ya pin etmək.

## Məhdudiyyətlər və yoxlanılmayanlar

Ətraflı siyahı yuxarıdakı "Pre-activation audit" bölməsindədir (A sübut edilmiş, B nəzəri). Qısa: workflow Actions-da işləməyib; `contents: write` tokeni qorunmayan `main`-ə texniki olaraq push edə bilər (qadağa alət siyahısı, `pull-requests: read` və `verify`-dəki `main` SHA yoxlaması ilə qoyulub, branch protection qədər möhkəm deyil); `pull_request_review`-da workflow faylı versiyası, bot run-larında secret əlçatanlığı və Codex-in `github-actions[bot]` şərhinə cavabı canlı yoxlanmayıb; PR #6 `src/security/` və `src/approval/`-a toxunur və bu dövr onu qəsdən avtomatik düzəltməz; Codex "clean" siqnalının formatı bir PR-da (#7) müşahidə olunub, mətn dəyişərsə regex-lər yenilənməlidir; badge-siz tapıntı `no_actionable` sayılır (inline şərhdirsə `unparsed_findings` ilə dayanır).

## Aktivləşdirmə PR-ı (yekun)
- Aktiv fayl: `.github/workflows/claude-codex-loop.yml` (qaralama ilə eyni gövdə, `tests/codex-loop-activation.test.mjs`). Ayrıca PR-dadır, PR #8-in budağı üzərindədir (yalnız bu fayl + test + bu bölmə fərqlidir). `claude.yml`-ə, PR #6/#7-yə toxunulmayıb.
- **Sıra (Fərid-in təsdiqi ilə):** (1) PR #8 merge; (2) aktivləşdirmə PR-ı merge. Sıra pozulsa gate addımı `gate.mjs` tapmayıb xəta verir, Claude işə düşmür (fail-closed).
- **Lazım olan secret-lər:** `ANTHROPIC_API_KEY` (fix job; mövcudluğu mənə məlum deyil, mən yaratmıram/dəyişmirəm). İstəyə bağlı: `CODEX_TRIGGER_TOKEN` (yalnız `GITHUB_TOKEN` şərhini Codex qəbul etməsə). Başqa secret yoxdur.
- **Sübut olunmayıb:** workflow Actions-da heç vaxt işləməyib; `github-actions[bot]` `@codex review` şərhinə Codex-in cavabı; bot tərəfindən başlayan run-da secret əlçatanlığı; `claude-code-action@v1` input-larının tag-da eyni olması; `pull_request_review`-da hansı workflow faylı versiyasının işlədiyi; concurrency növbəsində hadisə itkisi.
- **Səssiz dayanma:** Codex cavab verməzsə dövr heç nə etmir və bildiriş də yoxdur (watchdog yoxdur). Təhlükəsizdir, amma səssizdir.
- **PR #6 üçün:** `src/security/` və `src/approval/`-a toxunduğu üçün gate onu `sensitive_paths` ilə dayandırır (stop şərhi düşər); PR #6 yalnız əl ilə (Claude sessiyası) aparılır.
- **Gecikmə riski:** push-dan dərhal sonra `pulls/N` `head.sha` bir neçə saniyə köhnə qala bilər; `verify` onu "dəyişiklik yoxdur" kimi oxuyub dayana bilər (səhv istiqamət yox, yalnız lazımsız dayanma).

## ANTHROPIC_API_KEY olmadıqda (düzəliş)
- Problem (audit): açar yoxdursa gate yenə raundu artırıb state-i `fixing` edir, fix job-u isə xəta verir; raundlar boşuna yanır, eyni review yenidən işlənmir.
- Düzəliş: workflow açarın **mövcudluğunu** (`true/false`, dəyər yox) `--fix-available` ilə gate-ə verir. Açar yoxdursa və tapıntı real P1/P2-dirsə gate `skip: fix_unavailable_no_api_key` qaytarır: raund sərf olunmur, state dəyişmir, PR-da bir dəfə xəbərdarlıq düşür. P0, `.github/`, həssas yol, stale/duplicate və s. dayanmaları əvvəlki kimidir (açar yoxlaması onlardan sonradır). `--fix-available` verilməsə (Claude sessiyası yolu) fix mümkündür.
- **Açarsız işləyən yol (B):** Claude sessiyası `node scripts/codex-loop/gate.mjs decide --repo ... --pr N --use-gh` ilə Codex review-unu oxuyur, P1/P2-ni özü doğrulayıb düzəldir, test edib push edir və yeni `@codex review` istəyir. Action və API açarı tələb olunmur.
- Açar əlavə olunandan sonra: yeni Codex review (və ya `@codex review`) eyni dövrü sıfırdan itkisiz başladır.
- Alternativ autentifikasiya (**yoxlanmayıb, yalnız `claude-code-action`-ın `main` mənbəyində oxunub**): `claude_code_oauth_token` input-u `anthropic_api_key`-in əvəzi kimi göstərilir. Bu da secret tələb edir və workflow-a daxil edilməyib.
- Repo ayarları oxuna bilmədi (proxy `actions/permissions` yolunu bloklayır). `main` qorunmur (branch protection yoxdur): oxundu.
