# Canlı yoxlama planı: Claude → GitHub şərhi (`@codex review`) → Codex → GitHub cavabı

Status: **yalnız plan.** Heç bir test PR-ı açılmayıb, heç bir `@codex review` göndərilməyib, `.github/workflows/`-a heç nə köçürülməyib.

## Tək sual
`github-actions[bot]` (yəni `GITHUB_TOKEN`) tərəfindən yazılan `@codex review` şərhinə Codex cavab verirmi?

Sənəd (OpenAI Codex GitHub inteqrasiyası) yalnız "PR şərhində `@codex review` yazın" deyir. Şərhi kimin yaza biləcəyi, bot/App şərhlərinin sayılıb-sayılmadığı və limitin kimə yazıldığı orada **yoxdur**. Ona görə cavab yalnız canlı testlə məlum olur. Nəticə PAT/App token tələb olunurmuş kimi fərz **edilmir**: əvvəl `GITHUB_TOKEN` yoxlanır.

## Niyə `.github/workflows/` qaçılmazdır (səndən icazə tələb olunur)
`github-actions[bot]` müəllifi yalnız workflow-un `GITHUB_TOKEN`-i ilə yarana bilər. Workflow olmadan bu şəxsiyyətlə şərh yazmaq mümkün deyil. Yoxlanan alternativlər:
- Mövcud `claude.yml`-i istifadə etmək: şərhin müəllifi `claude[bot]` (başqa şəxsiyyət) olar və `ANTHROPIC_API_KEY` xərclənər, həm də öz workflow-umuza `@claude` ilə prompt yeritmək yaramaz. **Rədd edildi.**
- `workflow_dispatch`: workflow faylı default branch-da olmalıdır, yəni `main`-ə merge tələb edir. **Rədd edildi** (aktivləşdirmə demək olardı).
- Seçilən yol: `pull_request` hadisəsi workflow-u PR-ın **öz budağından** götürür. Test workflow-u yalnız test PR-ının budağında yaşayır, `main`-ə heç vaxt getmir.

Bu, "test PR `.github/`-a toxunmasın" şərtinə ziddir və yalnız bu birdəfəlik test PR-ı üçün istisnadır. Sən "hə" demədən açılmır.

## Test PR-ının dəqiq scope-u
- Budaq: `claude/codex-probe-<tarix>` (`claude/*`), `main`-dən. **Draft PR**, başlıq `DO NOT MERGE: Codex probe`.
- Fayl 1: `docs/probes/codex-actions-probe.md` (3 sətirlik zərərsiz mətn). Production koduna, testlərə, `src/`-ə, həssas fayla toxunmur.
- Fayl 2: `.github/workflows/codex-probe.yml` ← `.github/workflow-drafts/codex-probe.yml` (bu repo-dakı qaralama). Yalnız bu PR-ın budağında.
- Başqa heç nə: PR #6, PR #8, `claude.yml`, repo ayarları, secret-lər, label-lər dəyişmir.
- Draft olmalıdır: Codex-in "PR açılanda avtomatik review" ayarı varsa, draft PR-da işləmir. Beləcə cavab açılışdan yox, bizim şərhdən gəlir.

## Addımlar
1. Fərid razılıq verir.
2. Budaq + 1-ci commit (fayl 1 və 2) push olunur, draft PR açılır. `opened` hadisəsi workflow-u işə salmır (yalnız `synchronize`).
3. Mən bir kiçik 2-ci commit göndərirəm (fayl 1-ə bir sətir). `synchronize` hadisəsi `post` job-unu başladır: **bir** `@codex review` şərhi, `GITHUB_TOKEN` ilə. Job idempotentdir (artıq belə şərh varsa heç nə yazmır), `timeout 3 dəq`, təkrar cəhd yoxdur.
4. Mən yalnız oxuma rejimində 10 dəqiqə izləyirəm (20 san aralıqla): şərhin müəllifi/type, reaksiyalar, Codex şərhləri/review-ları, Actions run siyahısı.
5. Nəticə hesabatı. Test PR-ının bağlanması/budağın silinməsi üçün ayrıca icazə istəyirəm.

Push zamanı `.github/workflows/` faylı üçün GitHub App tokeninin `workflows` icazəsi olmaya bilər və push rədd oluna bilər (bunu əvvəlcədən bilmirəm). Rədd olunsa, fayl 2-ni PR budağına GitHub veb interfeysində sən əlavə edərsən (mən mətni verərəm).

## Gözlənilən siqnallar və formaları
| Siqnal | Harada görünür | Event / forma |
|---|---|---|
| Şərhin özü | PR şərhi | `user.login = github-actions[bot]`, `user.type = Bot`, `body = "@codex review"`. `GITHUB_TOKEN` hadisəsi olduğu üçün yeni workflow run yaranmır |
| 👀 reaksiya | `/issues/comments/{id}/reactions` | müvəqqəti (bir neçə dəqiqə sonra silinir), workflow event-i yoxdur |
| Limit cavabı | Codex-in adi PR şərhi | `issue_comment: created`, `user.login = chatgpt-codex-connector[bot]`, mətn `You have reached your Codex usage limits…`. Real forma əvvəl PR #6-da müşahidə olunub. Mövcud `claude.yml` bu event-də `skipped` run yaradacaq (siyahıda görünür) |
| Təmiz nəticə | adi şərh + PR-da 👍 | `issue_comment: created`, `Didn't find any major issues` + `**Reviewed commit:** \`sha10\`` |
| Tapıntı | review + inline şərhlər | `pull_request_review: submitted` (state `COMMENTED`, `commit_id` = baş) və hər inline üçün `pull_request_review_comment: created`. Probe workflow-unun `observe` job-u bu hadisədə başlayırsa, run adında (`display_title`) actor/state/user/type görünür |
| Cavab yoxdur | — | heç bir şərh, review, reaksiya |

Limit hələ aktivdirsə (hazırda aktivdir), gözlənilən cavab saniyələr içində gələn **limit mesajıdır**: bu, kvota xərcləmədən Codex-in bot şərhini qəbul etdiyini sübut edir. Limit açılıbsa, kiçik fayl üçün qısa review və ya təmiz nəticə gəlir (bir review kvotası xərclənir).

## Nəticələr və qərar ağacı
- **Uğurlu** (limit mesajı, 👀, review və ya təmiz nəticə 10 dəqiqə içində): `GITHUB_TOKEN` ilə zəncir işləyir, `CODEX_TRIGGER_TOKEN` lazım deyil. Hansı event gəldiyi hesabata yazılır. Loop-un aktivləşdirmə PR-ı üçün əsas risk bağlanır.
- **Cavabsız** (10 dəqiqə heç bir siqnal): nəticə "Codex bot şərhini qəbul etmir və ya ona cavab vermir". Nəzarət: eyni test PR-ında eyni mətni **insan hesabı** ilə yazmaq (limit aktivdirsə saniyələr içində limit mesajı gəlməlidir). Nəzarət cavab verirsə, bot şərhi rədd edilir və növbəti qərar səndədir (PAT/App token, yoxsa Claude sessiyası ilə əl rejimi B). Nəzarət də susursa, problem testdədir və nəticə "qeyri-müəyyən" yazılır.
- **Uğursuz** (probe job-u xəta verir, şərh yazılmır): heç nə baş vermir, Codex-ə sorğu getmir. Səbəb run siyahısında görünür; aydınlaşmadan təkrar yoxlama yoxdur.

## Təhlükəsiz dayanma
- Probe: ən çox **bir** şərh (idempotent), `timeout`, təkrar yoxdur, dövr yoxdur (`GITHUB_TOKEN` hadisəsi workflow başlatmır, `observe` job-unda yazma icazəsi yoxdur: `permissions: {}`).
- Probe workflow-u `main`-ə getmir, test PR-ı draft-dır və "merge etmə" başlığı daşıyır; `claude/*` olmayan və ya fork budaqlarında şərt ödənmir.
- Loop (hələ aktiv deyil): `@codex review` yazandan sonra state `awaiting_review` + `requested_sha` olur. Cavab gəlməzsə **heç nə baş vermir**: təkrar sorğu, düzəliş, push, merge yoxdur. Bu təhlükəsiz dayanmadır, amma **səssizdir**: gate-də "X dəqiqə cavab gəlmədi" bildirişi yoxdur. Bu, bu audit-in tapdığı boşluqdur: aktivləşdirmə PR-ına nəzarət edən qısa vaxtaşırı yoxlama (watchdog) əlavə edilməlidir. İndi əlavə edilməyib.

## Risklər
- Push-un `workflows` icazəsi səbəbilə rədd olunması (yuxarıda).
- Mümkündür ki, Codex yalnız ChatGPT hesabı ilə əlaqəli GitHub istifadəçilərinin şərhlərinə cavab verir. Bu yalnız fərziyyədir: sənəd bunu nə təsdiq edir, nə inkar edir. Cavabsız nəticə yalnız "bu şəxsiyyətlə cavab alınmadı" kimi oxunur (səbəb bilinmir).
- Limit aktivdirsə test yalnız qəbulu sübut edir, review məzmununu yox. Məzmun forması PR #6/#7-də artıq real görünüb.
- Test PR-ı repo-da müvəqqəti iz buraxır (draft PR, budaq). Cloudflare preview şərhi də düşə bilər.
- Probe sübutu yalnız `GITHUB_TOKEN` identifikasiyası üçündür. Bu, `pull_request_review`-da secret əlçatanlığı və `ANTHROPIC_API_KEY` suallarına cavab vermir (ayrıca yoxlama).

## Səndən tələb olunanlar
1. Test PR-ına icazə, o cümlədən yalnız onun budağında `.github/workflows/codex-probe.yml` faylına.
2. Push `workflows` icazəsi səbəbilə rədd olunarsa, faylı veb interfeysdə əlavə etmək.
3. Test bitəndən sonra PR-ın bağlanması və budağın silinməsi üçün razılıq.
