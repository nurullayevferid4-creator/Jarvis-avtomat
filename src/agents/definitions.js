// Agent təriflərinin reyestri. Hamısı "implemented"-dir və yalnız qeydiyyatdan keçmiş real alətləri çağırır:
//   Sales (lead), Marketing (marketinq + paylaşım qaralaması), Manager (hesabat),
//   Order / Logistics / Seller / Fraud-Quality (Shopify oxuma + qaydalar, src/agents/ops.js),
//   Customer Support (təsnif + cavab qaralaması).
// Xarici hesab tələb edən hissə (Shopify) qoşulmayıbsa alət açıq "qoşulmayıb" xətası verir, saxta nəticə yoxdur.

import { LEAD_TOOL_NAMES, MARKETING_TOOL_NAMES } from "./names.js";
import { ORDER_TOOLS, LOGISTICS_TOOLS, SELLER_TOOLS, SUPPORT_TOOLS, FRAUD_TOOLS } from "./ops.js";

// Yalnız insan təsdiqi ilə icra olunan kritik əməliyyat sinifləri. Heç bir agent bunları avtomatik icra edə bilməz.
export const HUMAN_APPROVAL_ONLY = [
  { id: "finance.payment", description: "Ödəniş, pul köçürməsi və hər cür pul xərcləmə" },
  { id: "finance.refund", description: "Geri ödəniş (refund) və kompensasiya" },
  { id: "account.change", description: "Hesab, parol, giriş və icazə dəyişikliyi" },
  { id: "price.change", description: "Qiymət dəyişikliyi" },
  { id: "stock.change", description: "Stok dəyişikliyi" },
  { id: "order.place", description: "Təchizatçıdan/platformadan sifariş vermək" },
  { id: "message.send", description: "Müştəriyə və ya lead-ə mesaj göndərmək" },
  { id: "publish.social", description: "Sosial şəbəkədə paylaşım" },
  { id: "data.delete", description: "Məlumat silmək" },
];

const ALL_APPROVAL_ONLY = HUMAN_APPROVAL_ONLY.map((x) => x.id);

export const AGENT_DEFINITIONS = [
  {
    id: "sales",
    role: "Sales",
    description: "Lead tapılması, süzülməsi, qiymətləndirilməsi və outreach QARALAMASI. Mesajı özü göndərmir: sahib əl ilə göndərir.",
    status: "implemented",
    capabilities: LEAD_TOOL_NAMES,
    requiresApprovalFor: ["lead.outreach.prepare"],
    humanApprovalOnly: ["message.send"],
    inputs: "Açıq mənbə ünvanı olan lead namizədləri (ən çox 10 partiya), ICP seçimi, status dəyişiklikləri.",
    outputs: "Saxlanmış lead-lər, izahlı bal (0-100), outreach qaralaması və təsdiq qeydi, əl ilə göndərmə qeydi.",
  },
  {
    id: "marketing",
    role: "Marketing",
    description: "Kampaniya, caption, hashteq, hook, təqvim, seqment və performans təhlili QARALAMALARI. Heç nə dərc etmir.",
    status: "implemented",
    capabilities: MARKETING_TOOL_NAMES,
    requiresApprovalFor: [],
    humanApprovalOnly: ["publish.social"],
    inputs: "Brend (qr_menu, fn_parfum), mövzu, sahibin verdiyi faktlar, performans göstəriciləri.",
    outputs: "Qaralamalar (source: claude/openai/template), performans statistikası (yalnız verilmiş rəqəmlərdən).",
  },
  {
    id: "manager",
    role: "Manager",
    description: "Yalnız real mənbələrdən (qoşulmuş providerlərdən) yığılan hesabat: təsdiqlər, işlər, lead funnel, risklər, tövsiyələr.",
    status: "implemented",
    capabilities: ["manager.report", "agents.list"],
    requiresApprovalFor: [],
    humanApprovalOnly: ALL_APPROVAL_ONLY,
    inputs: "Providerlər: leads, approvals, jobs (məcburi deyil), shopify, marketing (ixtiyari).",
    outputs: "Hesabat: say, gözləyən təsdiqlər, uğursuz/naməlum işlər, funnel, risklər, qaydalarla çıxarılan tövsiyələr. Qoşulmayan bölmə 'qoşulmayıb' yazır.",
  },
  {
    id: "order",
    role: "Order",
    description: "Shopify sifarişlərinin xülasəsi və tək sifarişin vəziyyəti (oxuma). Sifariş vermək/ləğv etmək yalnız insan təsdiqi ilə.",
    status: "implemented",
    capabilities: [...ORDER_TOOLS, "shopify.orders.list", "shopify.order.get"],
    requiresApprovalFor: [],
    humanApprovalOnly: ["order.place", "finance.payment", "finance.refund"],
    inputs: "Shopify Admin API (qoşulmuş mağaza): sifariş siyahısı, sifariş nömrəsi (#1001).",
    outputs: "Status üzrə say, valyuta üzrə cəm, göndərilməyən ödənilmiş sifarişlər; tək sifarişin ödəniş/göndəriş/məhsul məlumatı.",
  },
  {
    id: "logistics",
    role: "Logistics",
    description: "Göndəriş və izləmə (Shopify fulfillment + tracking), gecikən sifarişlər. Göndəriş yaratmaq/ləğv etmək yoxdur.",
    status: "implemented",
    capabilities: [...LOGISTICS_TOOLS],
    requiresApprovalFor: [],
    humanApprovalOnly: ["finance.payment"],
    inputs: "Shopify sifarişləri və onların fulfillment/tracking qeydləri.",
    outputs: "Daşıyıcı, izləmə nömrəsi/linki (yalnız Shopify-da olan), göndərilmə/çatdırılma tarixləri, N gündən çox gecikən sifarişlər.",
  },
  {
    id: "seller",
    role: "Seller",
    description: "Kataloq: məhsul axtarışı, kataloq sağlamlığı (təsvir/şəkil/SKU/qiymət/stok), DRAFT məhsul hazırlığı. Yazma yalnız təsdiqlə, yeni məhsul həmişə DRAFT.",
    status: "implemented",
    capabilities: [...SELLER_TOOLS, "shopify.products.search", "shopify.product.get", "shopify.inventory.get", "shopify.product.prepare", "shopify.product.create"],
    requiresApprovalFor: ["shopify.product.create"],
    humanApprovalOnly: ["price.change", "stock.change", "order.place", "finance.payment"],
    inputs: "Shopify kataloqu; sahibin verdiyi məhsul məlumatı.",
    outputs: "Problemli məhsullar siyahısı və say; DRAFT məhsul qaralaması (təsdiq qeydi).",
  },
  {
    id: "customer_support",
    role: "CustomerSupport",
    description: "Müştəri mesajının təsnifi (status, gecikmə, qaytarma, şikayət...) və cavab QARALAMASI (Shopify statusu ilə). Göndərmir, vəd vermir.",
    status: "implemented",
    capabilities: [...SUPPORT_TOOLS],
    requiresApprovalFor: [],
    humanApprovalOnly: ["message.send", "finance.refund", "account.change"],
    inputs: "Sahibin yapışdırdığı müştəri mesajı (etibarsız məlumat kimi), istəyə bağlı sifariş nömrəsi.",
    outputs: "Kateqoriya, təcililik, dil, sifariş nömrəsi; cavab qaralaması (Claude və ya şablon) və insan qərarı tələb edən məqamlar.",
  },
  {
    id: "fraud_quality",
    role: "FraudQuality",
    description: "Sifariş risk balı (Shopify risk + öz qaydalar) və paylaşım mətninin keyfiyyət yoxlaması. Yalnız tövsiyə.",
    status: "implemented",
    capabilities: [...FRAUD_TOOLS],
    requiresApprovalFor: [],
    humanApprovalOnly: ["account.change", "finance.refund", "finance.payment"],
    inputs: "Shopify sifarişi və son sifarişlər; paylaşım mətni və sahibin faktları.",
    outputs: "0-100 bal, izahlı faktorlar, tövsiyə (ok/review/hold_and_review); mətn problemləri (limit, heşteq, dəstəklənməyən iddia).",
  },
];
