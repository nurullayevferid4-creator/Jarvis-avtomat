# AI Auditor (Kimi)

Kimi (Moonshot) burada **ikinci, müstəqil auditordur**. İcraçı deyil. Claude-un işinə kənardan baxır və hesabat yazır. Qərarı insan (Fərid) verir.

Kod: `src/adapters/KimiAuditorAdapter.js`. Testlər: `tests/kimi-auditor.test.mjs` (mock) və `tests/kimi-auditor.live.test.mjs` (real, açarsız atlanır).

## Nə edir

```
Claude işi bitirir
 ↓
submitForAudit({ taskSummary, codeDiff, testResults })
 ↓
Kimi API (yalnız oxu/təhlil)
 ↓
hesabat → "auditreport" sənədi + audit jurnalı (yalnız meta-məlumat)
 ↓
getAuditReport(auditId) → insana göstərilən oxuma modeli
```

- `submitForAudit(...)`: gizli məlumatı təmizləyir, mətni `<external_content trust="untrusted">` qutularına qoyub Kimi-yə göndərir, cavabı saxlayır. `{ auditId, status, verdict, findingCount, advisoryOnly: true, executable: false }` qaytarır.
- `getAuditReport(auditId)`: saxlanmış hesabatı qaytarır (tapılmasa `null`). Kimi-yə sorğu göndərmir, açar tələb etmir.

## Nə etmir

- **İcra etmir.** Adapterin `run()` funksiyası yoxdur və `AdapterRegistry`-yə qoşula bilmir (`auditOnly = true`). Qoşulsaydı `registry.helpers()` onu lider modelin planında icraçı köməkçi edərdi. `registry.set()` onu rədd edir, bu testlə yoxlanır.
- **Kimi cavabı heç vaxt icra planı olmur.** Cavabdan yalnız `verdict`, `summary`, `findings[].{severity,location,issue,suggestion}` götürülür. `actions`, `tasks`, `execute`, `plan` kimi sahələr atılır. Cavabda "icra et" yazılsa belə bu yalnız mətndir, hesabat həmişə `advisory_only: true`, `executable: false`, `trust: "untrusted"` işarələnir. Şübhəli təlimat izləri `output_flags` ilə qeyd olunur.
- **Təsdiq zəncirini dəyişmir.** `APPROVALS.md`, `src/approval/*`, `src/policy.js`, audit jurnalı, limitlər toxunulmayıb. Real iş yenə yalnız Fərid-in təsdiqi ilə.
- **Saxta uğur qaytarmır.** Açar yoxdursa, vaxt bitibsə, 4xx/5xx gəlibsə, cavab boşdursa xəta atılır.

## Quraşdırma

Açarı **heç vaxt** chata, GitHub-a, Issue-ya və ya fayla yazma. Repo açıqdır.

Cloudflare-də Secret kimi:

```
wrangler secret put KIMI_API_KEY
```

Əmr açarı soruşur, sən terminalda yapışdırırsan. İstəyə bağlı model adı (Secret deyil, `wrangler.toml` `[vars]` və ya `.env.example`-dakı kimi): `KIMI_MODEL` (standart `kimi-k3`). Lokal sınaq üçün `.dev.vars` faylına yaz (`.gitignore` ilə qorunur).

## Hansı halda nə olur

| Hal | Nəticə |
|---|---|
| `KIMI_API_KEY` yoxdur və ya boşdur | `KimiAuditorError` `not_configured`: `KIMI_API_KEY is not configured`. Şəbəkəyə çıxmır, heç nə yazılmır. Sistem "qoşuludur" demir. |
| `taskSummary` boş, `codeDiff` və `testResults` ikisi də boş | `invalid_input` |
| Çağırış limiti dolub | `BudgetExceededError`, Kimi-yə getmir |
| Vaxt limiti (`CALL_TIMEOUT_SECONDS`) | `timeout` |
| Şəbəkə xətası | `network_error` |
| 401 / 403 | `auth_error` |
| 429 | `rate_limited` |
| digər 4xx | `client_error` |
| 5xx | `server_error` |
| Cavabda mətn yoxdur | `bad_response` |
| Cavab JSON deyil | Hesabat saxlanır: `parse_ok: false`, `verdict: "unparsed"`, mətn `raw_text`-də |

Göndərmə başladıqdan sonrakı xətalarda `status: "failed"` hesabatı yazılır və xətanın `auditId` sahəsi olur.

Real testlər (`npm run test:live`) iki halda **atlanır** və səbəb test çıxışında görünür: `KIMI_API_KEY` yoxdur, ya da `RUN_LIVE_TESTS=1` verilməyib. Atlanan test "keçdi" sayılmır.

## Gizlilik

- Kod fərqi **xarici şirkətin API-sinə** göndərilir. Göndərməzdən əvvəl `sk-...`, `Bearer ...`, `gh*_...`, `AKIA...`, `*_KEY=`/`*_TOKEN=`/`*_SECRET=`/`*_PASSWORD=` tipli dəyərlər və private key blokları `[REDACTED]` ilə əvəz olunur. Bu **ən yaxşı cəhddir, 100% zəmanət deyil**. Auditə yalnız göndərilməsinə razı olduğun kodu ver.
- Ölçü limiti: tapşırıq 4 000, diff 60 000, test nəticəsi 20 000 simvol. Artığı kəsilir və hesabatda `truncated: true` yazılır.
- Audit jurnalına yalnız meta-məlumat düşür (id, model, simvol sayı, verdict, tapıntı sayı). Hesabat mətni jurnala düşmür.
- Hesabatlar 30 gün saxlanır.

## API sənədi: təsdiq gözləyir

Aşağıdakılar Kimi-nin rəsmi sənədindən (`platform.kimi.ai/docs/api/chat`, köhnə `platform.moonshot.ai` ünvanı ora yönləndirir) **2026-10-05-də oxunub**:

- `POST https://api.moonshot.ai/v1/chat/completions`
- `Authorization: Bearer <açar>`
- Gövdə: `model`, `messages`, `max_completion_tokens` (8000), `reasoning_effort` (`low`; `kimi-k3` həmişə düşünür, sənəd defoltu `max`-dır), `response_format: {"type":"json_object"}` (JSON Mode; sənəd promptda JSON sahələrinin təsvirini tələb edir, `AUDITOR_SYSTEM` bunu edir)
- Cavab: `choices[0].message.content`
- Sənəddəki nümunə model: `kimi-k3`

**Format sənədlə təsdiqlənib** (endpoint, Bearer, `kimi-k3`, `max_completion_tokens`, `reasoning_effort`, `response_format`).

**Hələ təsdiqlənməyib (real açarla sınaq gözləyir):**

- Real `KIMI_API_KEY` ilə **heç bir real sorğu göndərilməyib**. Bütün mock testlər yalnız adapterin nə göndərdiyini yoxlayır. Real uyğunluğu yalnız `tests/kimi-auditor.live.test.mjs` göstərə bilər.
- Reasoning tokenlərinin `max_completion_tokens`-ə daxil olub-olmadığı sənəddə yazılmayıb. 8000 limiti və `low` səviyyəsi bu risk üçün ehtiyatdır; cavab yenə də kəsilərsə hesabat `unparsed` olur.
- `reasoning_effort` sənəddə yalnız `kimi-k3` üçündür. `KIMI_MODEL` ilə başqa model seçilsə sorğu 400 ilə rədd oluna bilər.
- Sənəddə yalnız 400, 401, 500 xəta kodları yazılıb. 403 və 429 ehtiyat üçün ayrıca işlənir.
- Tapıntılar 10-la məhdudlanır (`maxFindings`).

## Məhdudiyyətlər

- Adapter hələ orkestratora və ya HTTP ünvanına (`/api/...`) qoşulmayıb. Hazırda kodla çağırılır. Hesabatı telefon səhifəsində göstərmək ayrıca iş və Fərid-in qərarıdır.
- `/api/status` Kimi açarının təyin olunub-olunmadığını hələ göstərmir.
- KV son-nəticəli saxlanışdır (bax `APPROVALS.md`). KV olmadan hesabatlar Worker yenidən başlayanda itir.
- Auditor yanılabilir. Hesabat qərar deyil, ikinci rəydir.
