// Shopify skeleti: mağaza/məhsul/sifariş/müştəri OXUMA interfeysi. Məhsul, qiymət, stok, sifariş dəyişikliyi söndürülüb.
// Secret: SHOPIFY_ADMIN_TOKEN (Cloudflare Secret). Gizli olmayan: SHOPIFY_STORE_DOMAIN (yalnız <ad>.myshopify.com).
// Endpoint-lər və API versiyası yoxlanmayıb: canlı çağırış söndürülüb. Müştəri məlumatı şəxsi məlumatdır: yalnız lazım olan sahələr.

import { IntegrationAdapter, PAGE_INPUT, EMPTY_INPUT, idSchema } from "./Integration.js";

export const SHOPIFY_OPERATIONS = {
  "shop.get": { kind: "read", description: "Mağaza məlumatı", input: EMPTY_INPUT },
  "products.list": { kind: "read", description: "Məhsullar", input: PAGE_INPUT },
  "orders.list": { kind: "read", description: "Sifarişlər", input: PAGE_INPUT },
  "customers.list": { kind: "read", description: "Müştərilər (şəxsi məlumat)", input: PAGE_INPUT },
  "product.update": { kind: "write", description: "Məhsul dəyişikliyi (söndürülüb)", input: { type: "object", properties: { product_id: idSchema }, additionalProperties: false } },
  "price.change": { kind: "write", description: "Qiymət dəyişikliyi (söndürülüb)", input: { type: "object", properties: { product_id: idSchema, price: { type: "number", minimum: 0 } }, additionalProperties: false } },
  "inventory.set": { kind: "write", description: "Stok dəyişikliyi (söndürülüb)", input: { type: "object", properties: { item_id: idSchema, quantity: { type: "integer", minimum: 0 } }, additionalProperties: false } },
};

const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

// SSRF qoruması: yalnız <ad>.myshopify.com, port/yol/loqin yoxdur. Düzgün deyilsə null.
export function normalizeShopDomain(value) {
  const v = String(value || "").trim().toLowerCase();
  return SHOP_RE.test(v) ? v : null;
}

export class ShopifyAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "shopify", label: "Shopify (yalnız oxuma)", operations: SHOPIFY_OPERATIONS, endpoints: {}, ...opts });
  }
  get shopDomain() { return normalizeShopDomain(this._env.SHOPIFY_STORE_DOMAIN); }
  // Domen adı düzgün formada olmalıdır, yoxsa "konfiqurasiya olunmayıb" sayılır.
  _missing() {
    const m = super._missing();
    if (!this.shopDomain && !m.includes("SHOPIFY_STORE_DOMAIN")) m.push("SHOPIFY_STORE_DOMAIN");
    return m;
  }
  get mockHandlers() {
    return {
      "shop.get": () => ({ name: "mock mağaza", currency: "AZN" }),
      "products.list": (i) => ({ items: [{ id: "mock_p1", title: "mock məhsul", price: "10.00" }].slice(0, i.limit || 25), next: null }),
      "orders.list": () => ({ items: [], next: null }),
      "customers.list": () => ({ items: [], next: null }),
    };
  }
}
