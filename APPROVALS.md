# Təsdiq mərkəzi

Xarici təsiri olan hər iş (paylaşım, mesaj, pul, silmə, qiymət/stok, deploy) əvvəl burada **gözləyir**. Fərid bunları qərara bağlayır.

## Vacib: təsdiq icra demək deyil

Bu versiyada Shopify, Instagram, Telegram kimi inteqrasiya yoxdur. Ona görə **APPROVE heç nəyi icra etmir**. Qeyd `status: approved`, `execution: manual` olur, yəni "təsdiq alındı, icra Fərid-in özündədir". Bunu `tests/approvals.test.mjs` və `tests/api.test.mjs` yoxlayır.

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

## Məhdudiyyətlər

- Telefon səhifəsində "Təsdiqlər" paneli var: gözləyən qeydlər, risk, icazələr, icra olunacaq giriş, "Təsdiq et" / "Rədd et". Parol mövcud `x-passcode-b64` ilə gedir.
- Tək istifadəçi üçündür. Eyni anda iki qərarın yarışına qarşı kilid yoxdur.
- KV olmadan qeydlər Worker yenidən başlayanda itir.
- KV son-nəticəli (eventually consistent) saxlanışdır: qərardan dərhal sonra başqa Cloudflare məntəqəsindən oxuma qısa müddət köhnə vəziyyət göstərə bilər. Tək istifadəçi üçün bu qəbul edilən riskdir. Güclü zəmanət (iki qərarın toqquşmaması) üçün sonradan D1 və ya Durable Object lazımdır.

## Təsdiq → icra (alət çağırışları)

`kind: "tool_call"` qeydləri: `pending → approved (execution: awaiting) → running → done|failed`; rədd → `not_executed`.
- Qərar yalnız `via:"api"` (parol qorumalı UI/API) ilə verilir. Söhbətdə "hə", səs və Telegram bu qeydi təsdiqləyə bilməz (`api_required`, 403).
- Redaktə olunmur: təsdiq edilən giriş (sha256 heşi qeydlə birlikdə saxlanır) icradan əvvəl yenidən yoxlanır.
- İcra yalnız `ApprovalExecutor` tərəfindən: icazələr təkrar yoxlanır (`REVOKED_PERMISSIONS` daxil), tək istifadəlik sübut verilir, retries=0, 15 dəqiqəlik pəncərə.
- Audit giriş məzmunu olmadan `execution.done` / `execution.failed` yazır.
Ətraflı: `docs/WIRING.md`.
