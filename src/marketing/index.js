// Marketinq planlayıcısının giriş nöqtəsi. Qoşulma: registerMarketingTools(registry, { llm, now }).
// deps.llm = { completeJson({system, user, schema, maxTokens}) -> obyekt, provider: "claude"|"openai"|"template" } (ixtiyari).
// İcazə adı (DEFAULT_PERMISSIONS-a əlavə olunmalıdır): MARKETING_PERMISSIONS = ["use.marketing"].

export { registerMarketingTools, MARKETING_PERMISSIONS } from "./tools.js";
export { BRANDS, BRAND_IDS, QR_MENU_URL, getBrand, requestsDigitalCard } from "./brands.js";
export { analyzePerformance } from "./performance.js";
export { LIMITS, findClaims, unsupportedClaims, normalizeHashtags, stripUnsafe } from "./safety.js";
