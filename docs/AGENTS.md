# Agent reyestri, hadisələr, Manager hesabatı

Kod: `src/agents/`, `src/commerce/interfaces.js`. Qoşulma: `createAgentRegistry(deps)` və `registerAgentTools(toolRegistry, agents)` (`src/agents/index.js`).

## Agentlər

| Agent | Status | İmkanlar (alətlər) | Təsdiq tələb edir |
|---|---|---|---|
| Sales (`sales`) | **implemented** | `lead.*` alətləri (9) | `lead.outreach.prepare` |
| Marketing (`marketing`) | **implemented** | `marketing.*` alətləri (7) | yoxdur (dərc ayrıca təsdiqli axındadır) |
| Manager (`manager`) | **implemented** | `manager.report`, `agents.list` | yoxdur |
| Order, Logistics, Seller, CustomerSupport, FraudQuality | **interface_only** | yoxdur | planlaşdırılan əməliyyatlar `requiresApprovalFor`-da sənədləşib |

`interface_only` agent işə düşmür: `agents.run(...)` `AppError("VALIDATION_ERROR", "Bu agent hələ qoşulmayıb")` atır. Bu agentlərin kodu, saxta alətləri və saxta nəticələri yoxdur; `planned_capabilities` yalnız plan sənədidir.

`implemented` agent yalnız öz `capabilities` siyahısındakı alətləri çağıra bilər və çağırış `ToolRegistry`-dən keçir: giriş, icazə və təsdiq qapıları orada işləyir. Agent təsdiq qapısını keçə bilmir (`lead.outreach.prepare` agent vasitəsilə də `pending_approval` qaytarır).

## Yalnız insan təsdiqi ilə icra olunanlar

`finance.payment`, `finance.refund`, `account.change`, `price.change`, `stock.change`, `order.place`, `message.send`, `publish.social`, `data.delete`. Siyahı `HUMAN_APPROVAL_ONLY` və `agents.list` çıxışında görünür. Agent reyestri bu adlı əməliyyatı `SECURITY_ERROR` ilə rədd edir. Hələ bu sinifdə heç bir real alət avtomatik icra olunmur.

## EventBus

`createEventBus({ store, now })`: hadisələr `event` sənəd növündə **yalnız əlavə olunur** (dəyişdirmə/silmə metodu yoxdur, obyekt dondurulub). `emit(type, data)`, `list({ type, limit })` (ən çox 40), `subscribe(type | "lead.*" | "*", fn)`. Abunəçilər **yalnız eyni prosesdədir**: başqa Worker nüsxələrinə çatmır. Abunəçi xətası hadisənin yazılmasına təsir etmir. `data` audit redaktorundan keçir (açar/token sahələri gizlənir).

Hazırda yazılan hadisələr: `lead.created`, `lead.status_changed`, `lead.outreach_prepared`, `lead.contacted_manually`, `lead.do_not_contact`, `agent.run`. `approval.created`, `job.finished`, `shopify.order_seen` adları qoşulma üçün ayrılıb: onları **yazan kod hələ qoşulmayıb** (yalnız `emit` ilə istənilən yerdən yazıla bilər).

## Manager hesabatı (`manager.report`)

Yalnız inyeksiya olunan providerlərdən oxuyur:

| Provider | Müqavilə | Hazır adapter |
|---|---|---|
| `leads` | `list()` | `registerLeadTools(...).provider` |
| `approvals` | `list({limit})` | `ApprovalCenter` birbaşa və ya `createApprovalProvider` |
| `jobs` | `list({limit})` | `createJobProvider(store)` (`socialjob` sənədləri) |
| `shopify` | `list({limit})` | **yoxdur** (qoşulmayıb) |
| `marketing` | `list({limit})` | **yoxdur** (qoşulmayıb) |

Provider yoxdursa bölmə `{ connected: false, label: "qoşulmayıb" }` olur: sıfır göstərilmir. Provider xəta verərsə bölmə `status: "error"` olur, rəqəm uydurulmur. Təsdiq və iş siyahıları KV limitinə görə ən çox 40 qeyddir; belə olanda `truncated: true` göstərilir.

Risk və tövsiyə qaydaları (deterministik, `src/agents/manager.js`): icrası naməlum/uğursuz təsdiq, naməlum/uğursuz/qismən iş, vaxtı bitmək üzrə (24 saatdan az) və ya 24 saatdan çox gözləyən təsdiq, 3 gündən çox gözləyən outreach qaralaması, qiymətləndirilib outreach-i olmayan lead-lər, əl ilə əlaqədən 7 gün sonra statusu yenilənməyən lead-lər, qoşulmayan mənbələr. Hər tövsiyənin `basis` sahəsi var (hansı rəqəmdən çıxıb).

## Commerce interfeysləri (`src/commerce/interfaces.js`)

`SupplierProvider`, `PaymentProvider`, `FulfillmentProvider` yalnız **sənədləşmiş müqavilələrdir**. `NotConfiguredSupplier/Payment/Fulfillment` hər metodda `AppError("VALIDATION_ERROR", "... qoşulmayıb")` atır. Real təchizatçı, ödəniş və ya çatdırılma inteqrasiyası **yoxdur**. Pul və ya sifariş yaradan metodlar müqavilədə `human_approval_only` kimi işarələnib.

## Qoşulma qeydi

Yeni icazə adları `src/policy.js` `DEFAULT_PERMISSIONS`-a əlavə olunmalıdır: `read.leads`, `write.leads`, `use.marketing`, `read.agents`, `read.reports`. `lead.outreach.prepare` üçün `send.message` təsdiq-yalnız icazədir və əlavə edilmir.

`src/tools/registry.js`-də bir sətir dəyişdi: `approval.build` indi `await` ilə çağırılır (asinxron ola bilər). Köhnə sinxron `build` funksiyaları eyni işləyir.
