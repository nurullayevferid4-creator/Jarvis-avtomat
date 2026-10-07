# Təsdiq mərkəzi

Xarici təsiri olan hər iş (paylaşım, mesaj, pul, silmə, qiymət/stok, deploy) əvvəl burada **gözləyir**. Fərid bunları qərara bağlayır.

## Vacib: təsdiq icra demək deyil

**Adi qeydlər:** Shopify və s. üçün inteqrasiya yoxdur. Ona görə APPROVE heç nəyi icra etmir. Qeyd `status: approved`, `execution: manual` olur, yəni "təsdiq alındı, icra Fərid-in özündədir". Bunu `tests/approvals.test.mjs` və `tests/api.test.mjs` yoxlayır.

**Sosial paylaşım qeydləri (`kind: "social.publish"`):** qeyddə strukturlu `payload` və onun SHA-256 `payload_hash`-i saxlanır. Təsdiqdən sonra icranı `src/social/flow.js` edir (təsdiq mərkəzinin özü yenə şəbəkəyə çıxmır): qeyd `approved` olmalıdır və hash dəyişməməlidir, yoxsa icra bloklanır (`execution: "blocked"`). Bu tip qeyd `edit` oluna bilmir (`edit_not_supported`): rədd edib yenisini hazırlatmaq lazımdır. `execution` dəyərləri: `pending` (təsdiqləndi, iş başlamayıb) → `running` → `done` | `partial` | `failed` | `unknown` | `blocked`. Bax `SOCIAL.md`.

## Qeyd necə görünür

```
id, ts, status, action, content, risk, source, revisions, expires_at, decided_at, execution
```

- `status`: `pending` → `approved` | `rejected` | `expired`
- `risk`: `low` | `medium` | `high`
- Gözləyən qeyd 7 gündən sonra `expired` olur və təsdiqlənə bilməz.
- Qərar verilmiş qeyd bir də dəyişmir (`409 already_decided`).

## İki yol, bir qeyd

1. **Söhbətdə:** JARVIS "təsdiq lazımdır" deyəndə qeyd açılır. "hə" qeydi `approved`, "yox" `rejected` edir. Köhnə davranış dəyişməyib: "hə"-dən sonra yalnız qaralama qaytarılır.
2. **API ilə:**
   - `GET /api/approvals?status=pending`
   - `POST /api/approvals/<id>` gövdə: `{"decision":"approve"}`, `{"decision":"reject"}` və ya `{"decision":"edit","content":"yeni mətn"}` (edit qeydi gözləyən saxlayır, `revisions` artır)

Bütün yollar parol tələb edir (`x-passcode-b64`, bax `SECURITY.md`). Bayraq: `FEATURE_APPROVALS=0` API-ni söndürür.

## Alətlərlə əlaqə

`src/tools/registry.js` təsdiq tələb edən aləti çağıranda aləti icra etmir, bu mərkəzdə qeyd açır və `pending_approval` + `approval_id` qaytarır. Bax `TOOLS.md`.

## Strukturlu qeydlər və icra

Alət qeydi `kind` + dəqiq `payload` + `payload_hash` + `summary_hash` + `origin` daşıyır. Təsdiq edəndə `ActionRunner` (sosial paylaşım üçün `social flow`):

1. qeydin bu çat/istifadəçi üçün icazəli olduğunu yoxlayır (`origin`);
2. `payload` hash-ini və xülasəni yenidən hesablayıb qeyddəkilə tutuşdurur (təsdiq mətni = icra olunan əməliyyat);
3. `decide` və `exec` addımlarını Durable Object üzərindən atomik "bir dəfə" markeri ilə götürür (eyni anda iki təsdiq → biri icra, digəri `409`);
4. icra edir, nəticəni qeydə yazır, audit jurnalına yazır. 30 dəqiqədən köhnə təsdiq icra olunmur.

Şəbəkə/vaxt xətasında nəticə `unknown` olur və **avtomatik təkrarlanmır**.

## Məhdudiyyətlər

- UI-da («Təsdiqlər» bölməsi) bütün gözləyən qeydlər üçün Təsdiq/Rədd düymələri var; Telegram-da sosial paylaşım üçün düymə var.
- Tək istifadəçi (sahib) üçündür; fərqli çatların təsdiqi bir-birinə keçmir.
- `COORD` (Durable Object) bağlanmayıbsa yaddaş koordinatoru işləyir və yalnız bir Worker nüsxəsində etibarlıdır; `/api/status` bunu göstərir. Real Cloudflare-də çox-məntəqəli yoxlama `docs/SMOKE.md` ilə edilməlidir.
- KV olmadan qeydlər Worker yenidən başlayanda itir.
