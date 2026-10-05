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
| `scripts/codex-loop/gate.mjs` | bütün qərarlar (təmiz funksiyalar) + `decide` / `verify` CLI | yazılıb, 54 testlə yoxlanıb (24 vahid + 30 simulyasiya), PR #6/#7 üzərində oxuma rejimində işlədilib |
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
| 14-15 | merge hüququ yox, qərar Fərid-də | workflow-da merge addımı yoxdur; Claude-a `gh pr merge/close`, force push, `main`-ə push qadağandır (`--disallowedTools`); təmiz rəy yalnız "dayan" deməkdir | statik test; **icra səviyyəsində zəmanət yoxdur**, bax "Məhdudiyyətlər" |
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

## Limit açıldıqdan sonra

1. Fərid dashboard-da limitin açıldığını görür.
2. İki yol:
   - **A (Actions):** workflow aktivdirsə, Actions → "Claude Codex Loop" → Run workflow → `pr_number`. Gate bir `@codex review` yazır, sonrası avtomatikdir.
   - **B (Claude sessiyası, secret tələb etmir):** `node scripts/codex-loop/gate.mjs decide --repo OWNER/REPO --pr N --use-gh` son Codex hadisəsinə baxıb nə ediləcəyini deyir; sessiya düzəldir, test edir, push edir və bir `@codex review` yazır. Bu rejim bu gün işləyir.

## Manual addımlar (Fərid-in icazəsi olmadan edilmir)

1. Workflow-u aktivləşdirmək: qaralamanı `.github/workflows/claude-codex-loop.yml` olaraq köçürmək (ayrıca PR, Fərid baxır).
2. `ANTHROPIC_API_KEY` repo secret-i (Actions rejimi üçün; hazırda yoxdur, mövcud `claude.yml` bu səbəbdən uğursuz olub). B rejimi bunu tələb etmir.
3. İstəyə görə `CODEX_TRIGGER_TOKEN` (fine-grained PAT və ya GitHub App tokeni, yalnız bu repo, yalnız PR/Issue şərh yazma). Səbəb: `@codex review` şərhini `GITHUB_TOKEN` yazarsa (`github-actions[bot]`), Codex-in ona cavab verib-verməyəcəyi **yoxlanılmayıb**.
4. Tövsiyə: `main` üçün branch protection (PR + review tələbi). Hazırda `main` qorunmur.
5. Tövsiyə: üçüncü tərəf action-ları commit SHA-ya pin etmək.

## Məhdudiyyətlər və yoxlanılmayanlar

- Workflow Actions-da bir dəfə də işləməyib. `anthropics/claude-code-action@v1`-in `prompt` / `claude_args` giriş adları və sintaksisi ilk işə salmada yoxlanmalıdır.
- `contents: write` tokeni texniki olaraq qorunmayan `main`-ə push/merge edə bilər. Qadağa alət siyahısı (`--disallowedTools`) və `verify` ilə qoyulub, bu, branch protection qədər möhkəm deyil.
- `pull_request_review` hadisəsində workflow faylı PR-ın merge commit-indən götürülür. Yazma icazəsi olan biri `claude/*` budağında workflow-u dəyişə bilər; fork PR-lar `if` ilə kənarlaşdırılıb. Yazma icazəsi olan şəxs qorunmayan repo-da onsuz da hər şeyi edə bilər.
- Bot tərəfindən başladılan run-larda secret-lərin əlçatan olması yoxlanılmayıb.
- PR #6 `src/security/` və `src/approval/`-a toxunur: bu dövr onu **qəsdən avtomatik düzəltməz** (`sensitive_paths`), insan nəzarətli axın davam edir.
- Codex "clean" siqnalının formatı bir PR-da (#7) müşahidə olunub; Codex mətni dəyişərsə regex-lər yenilənməlidir.
- Naxışlar P0-P3 badge formatına əsaslanır; badge-siz tapıntı "no_actionable" sayılır (səssiz buraxılmaz, `skip` səbəbi PR-a yazılmır, workflow log-undadır).
