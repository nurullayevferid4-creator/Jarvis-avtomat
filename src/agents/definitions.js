// Agent təriflərinin reyestri. Burada YALNIZ real mövcud olanlar "implemented" sayılır:
//   Sales (lead alətləri), Marketing (marketinq alətləri), Manager (hesabat).
// Qalanları "interface_only"-dir: kod yoxdur, işə düşmür, saxta agent yoxdur. capabilities boşdur;
// planlaşdırılan imkanlar yalnız planned_capabilities sənədidir və heç bir alətə bağlı deyil.

import { LEAD_TOOL_NAMES, MARKETING_TOOL_NAMES } from "./names.js";

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
    description: "Sifarişlərin qəbulu və izlənməsi.",
    status: "interface_only",
    capabilities: [],
    planned_capabilities: ["order.list", "order.get", "order.status"],
    requiresApprovalFor: ["order.place", "order.cancel"],
    humanApprovalOnly: ["order.place", "finance.payment"],
    inputs: "Shopify sifariş hadisələri (qoşulmayıb).",
    outputs: "Sifariş statusu və növbəti addım (qoşulmayıb).",
  },
  {
    id: "logistics",
    role: "Logistics",
    description: "Çatdırılma və izləmə.",
    status: "interface_only",
    capabilities: [],
    planned_capabilities: ["shipment.track", "shipment.estimate"],
    requiresApprovalFor: ["shipment.create", "shipment.cancel"],
    humanApprovalOnly: ["finance.payment"],
    inputs: "FulfillmentProvider (qoşulmayıb).",
    outputs: "İzləmə məlumatı (qoşulmayıb).",
  },
  {
    id: "seller",
    role: "Seller",
    description: "Məhsul, qiymət və stokun idarəsi (dropshipping/e-commerce).",
    status: "interface_only",
    capabilities: [],
    planned_capabilities: ["catalog.list", "supplier.search"],
    requiresApprovalFor: ["price.change", "stock.change", "order.place"],
    humanApprovalOnly: ["price.change", "stock.change", "order.place", "finance.payment"],
    inputs: "SupplierProvider (qoşulmayıb).",
    outputs: "Təchizatçı məlumatı (qoşulmayıb).",
  },
  {
    id: "customer_support",
    role: "CustomerSupport",
    description: "Müştəri sorğularına cavab qaralamaları və eskalasiya.",
    status: "interface_only",
    capabilities: [],
    planned_capabilities: ["support.draft_reply", "support.classify"],
    requiresApprovalFor: ["message.send", "finance.refund"],
    humanApprovalOnly: ["message.send", "finance.refund", "account.change"],
    inputs: "Müştəri mesajları (qoşulmayıb).",
    outputs: "Cavab qaralaması (qoşulmayıb).",
  },
  {
    id: "fraud_quality",
    role: "FraudQuality",
    description: "Saxtakarlıq və keyfiyyət siqnalları.",
    status: "interface_only",
    capabilities: [],
    planned_capabilities: ["fraud.flag", "quality.review"],
    requiresApprovalFor: ["account.change", "finance.refund"],
    humanApprovalOnly: ["account.change", "finance.refund", "finance.payment"],
    inputs: "Sifariş və ödəniş siqnalları (qoşulmayıb).",
    outputs: "Risk işarəsi (qoşulmayıb).",
  },
];
