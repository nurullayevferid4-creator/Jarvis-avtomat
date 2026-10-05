// Shopify Admin GraphQL adapteri: mağaza, məhsul, sifariş, müştəri OXUMA + məhsul redaktəsi (productUpdate) YALNIZ təsdiqlə (runApproved + sübut).
// Qiymət/stok/sifariş dəyişikliyi interfeysdir (mutation sxemləri yoxlanmayıb): alət kimi qeydə alınmır və icra olunmur.
// Konfiqurasiya: SHOPIFY_STORE_DOMAIN (gizli olmayan, <ad>.myshopify.com), SHOPIFY_ADMIN_TOKEN (Cloudflare Secret).
// Alternativ (Dev Dashboard tətbiqi): SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Secret) -> client_credentials ilə 24 saatlıq token hər çağırışda alınır.
//
// Rəsmi sənəd yoxlaması (2026-10-05, shopify.dev, WebFetch xülasəsi; canlı mağaza ilə sınanmayıb):
//  - POST https://{shop}.myshopify.com/admin/api/{version}/graphql.json, başlıqlar X-Shopify-Access-Token və Content-Type: application/json.
//  - Versiyalar rüblük; 2026-10 ən son stabil, 2026-07 stabil (hər biri ≥12 ay dəstək). Burada 2026-07 pinlənir (SHOPIFY_API_VERSION ilə dəyişdirilə bilər).
//  - Kök sahələr: shop (name, currencyCode, myshopifyDomain, plan{publicDisplayName shopifyPlus partnerDevelopment}), products, orders, customers.
//    Müştəri e-poçt sahəsi köhnəlib (Customer.email) — sorğulanmır. numberOfOrders UnsignedInt64 (JSON-da sətir).
//  - Səhifələmə: first/after, pageInfo{hasNextPage endCursor}; max 250 obyekt/səhifə (burada limit ≤ 50).
//  - Xətalar HTTP 200 ilə, cavabın "errors" massivində gəlir (THROTTLED, ACCESS_DENIED...): hər cavab yoxlanır.
//  - Skopelər: read_products, read_orders (yalnız son 60 gün; köhnələri read_all_orders + Shopify təsdiqi), read_customers.
//  - Qorunan müştəri məlumatı (ad, e-poçt, telefon, ünvan) üçün ayrıca tələblər var; təsdiqlənməyən sahələr maskalanır. "customers.list" bu səbəbdən təsdiq tələb edir.
//  - YAZMA (shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate, 2026-10-05, WebFetch xülasəsi): mutation productUpdate(product: ProductUpdateInput!, media?, identifier?)
//    -> { product, userErrors{ field message } }; skope write_products. ProductUpdateInput: id, title, descriptionHtml, status (ACTIVE...), tags, vendor, productType, handle, seo, metafields.
//    userErrors boş deyilsə əməliyyat UĞURSUZ sayılır (HTTP 200 ilə gəlir). YOXLANMAYIB: status enum-un tam siyahısı (ACTIVE/DRAFT/ARCHIVED sənəd nümunələrindən tanışdır).
//  - YENİ admin-created custom app yaratmaq artıq mümkün deyil (sənəd): mövcud köhnə token və ya Dev Dashboard tətbiqi lazımdır.
//    Dev Dashboard client_credentials yalnız tətbiq və mağaza eyni Shopify təşkilatındadırsa işləyir.

import { IntegrationAdapter, PAGE_INPUT, EMPTY_INPUT, idSchema, pick } from "./Integration.js";
import { IntegrationError } from "./errors.js";

export const SHOPIFY_API_VERSION = "2026-07";
const VERSION_RE = /^\d{4}-(01|04|07|10)$/;
const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
const PRODUCT_GID_RE = /^gid:\/\/shopify\/Product\/\d{1,20}$/;
const CURSOR_RE = /^[A-Za-z0-9_=+\/.-]{1,300}$/;

export const SHOPIFY_OPERATIONS = {
  "shop.get": { kind: "read", description: "Mağaza məlumatı (ad, valyuta, plan)", input: EMPTY_INPUT },
  "products.list": { kind: "read", description: "Məhsullar (ad, status, stok, qiymət aralığı)", input: PAGE_INPUT },
  "orders.list": { kind: "read", description: "Sifarişlər (nömrə, tarix, status, məbləğ; müştəri məlumatı yoxdur; son 60 gün)", input: PAGE_INPUT },
  "customers.list": { kind: "read", description: "Müştərilər (şəxsi məlumat: ad və sifariş sayı)", input: PAGE_INPUT },
  "product.update": { kind: "write", description: "Məhsul redaktəsi (ad, təsvir, status, teqlər, vendor, növ). Qiymət/stok deyil", input: { type: "object", properties: { product_id: { type: "string", minLength: 20, maxLength: 64 }, title: { type: "string", minLength: 1, maxLength: 255 }, description_html: { type: "string", maxLength: 10000 }, status: { type: "string", enum: ["ACTIVE", "DRAFT", "ARCHIVED"] }, tags: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 255 } }, vendor: { type: "string", minLength: 1, maxLength: 255 }, product_type: { type: "string", minLength: 1, maxLength: 255 } }, required: ["product_id"], additionalProperties: false } },
  "price.change": { kind: "write", description: "Qiymət dəyişikliyi (hazırlanmayıb)", input: { type: "object", properties: { product_id: idSchema, price: { type: "number", minimum: 0 } }, additionalProperties: false } },
  "inventory.set": { kind: "write", description: "Stok dəyişikliyi (hazırlanmayıb)", input: { type: "object", properties: { item_id: idSchema, quantity: { type: "integer", minimum: 0 } }, additionalProperties: false } },
};

// SSRF qoruması: yalnız <ad>.myshopify.com, port/yol/loqin yoxdur. Düzgün deyilsə null.
export function normalizeShopDomain(value) {
  const v = String(value || "").trim().toLowerCase();
  return SHOP_RE.test(v) ? v : null;
}

const present = (v, min = 8) => typeof v === "string" && v.trim().length >= min;

const Q = {
  "shop.get": "query { shop { name currencyCode myshopifyDomain plan { publicDisplayName shopifyPlus partnerDevelopment } } }",
  "products.list": "query($first:Int!,$after:String){ products(first:$first, after:$after){ nodes{ id title status handle totalInventory priceRangeV2{ minVariantPrice{ amount currencyCode } maxVariantPrice{ amount currencyCode } } } pageInfo{ hasNextPage endCursor } } }",
  "orders.list": "query($first:Int!,$after:String){ orders(first:$first, after:$after, reverse:true){ nodes{ id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet{ shopMoney{ amount currencyCode } } } pageInfo{ hasNextPage endCursor } } }",
  "customers.list": "query($first:Int!,$after:String){ customers(first:$first, after:$after){ nodes{ id displayName numberOfOrders } pageInfo{ hasNextPage endCursor } } }",
};

const PRODUCT_UPDATE = "mutation($product:ProductUpdateInput!){ productUpdate(product:$product){ product{ id title status handle tags vendor productType } userErrors{ field message } } }";

function productInput(i) {
  const p = { id: i.product_id };
  if (i.title !== undefined) p.title = i.title;
  if (i.description_html !== undefined) p.descriptionHtml = i.description_html;
  if (i.status !== undefined) p.status = i.status;
  if (i.tags !== undefined) p.tags = i.tags;
  if (i.vendor !== undefined) p.vendor = i.vendor;
  if (i.product_type !== undefined) p.productType = i.product_type;
  return p;
}

const money = (m) => (m && typeof m === "object" ? pick(m, ["amount", "currencyCode"], 20) : undefined);
const page = (conn, mapNode) => {
  if (!conn || !Array.isArray(conn.nodes)) throw new Error("bad shape");
  const pi = conn.pageInfo || {};
  return { items: conn.nodes.slice(0, 50).map(mapNode), next: pi.hasNextPage === true && typeof pi.endCursor === "string" ? pi.endCursor.slice(0, 300) : null };
};

const MAP = {
  "shop.get": (d) => ({ ...pick(d.shop, ["name", "currencyCode", "myshopifyDomain"], 200), plan: pick(d.shop && d.shop.plan, ["publicDisplayName", "shopifyPlus", "partnerDevelopment"], 60) }),
  "products.list": (d) => page(d.products, (n) => ({ ...pick(n, ["id", "title", "status", "handle", "totalInventory"], 300), price_min: money(n.priceRangeV2 && n.priceRangeV2.minVariantPrice), price_max: money(n.priceRangeV2 && n.priceRangeV2.maxVariantPrice) })),
  "orders.list": (d) => page(d.orders, (n) => ({ ...pick(n, ["id", "name", "createdAt", "displayFinancialStatus", "displayFulfillmentStatus"], 100), total: money(n.totalPriceSet && n.totalPriceSet.shopMoney) })),
  "customers.list": (d) => page(d.customers, (n) => pick(n, ["id", "displayName", "numberOfOrders"], 200)),
  "product.update": (d) => {
    const p = d.productUpdate && d.productUpdate.product;
    if (!p || typeof p !== "object") throw new Error("bad shape");
    return { updated: true, product: pick(p, ["id", "title", "status", "handle", "vendor", "productType"], 300), tags: Array.isArray(p.tags) ? p.tags.slice(0, 20).map((t) => String(t).slice(0, 80)) : [] };
  },
};

function makeSpec(op) {
  return {
    verified: true,
    async exec({ input, env, call, fail }) {
      const domain = normalizeShopDomain(env.SHOPIFY_STORE_DOMAIN);
      if (!domain) throw new Error("no domain");
      let token = env.SHOPIFY_ADMIN_TOKEN;
      if (!present(token)) {
        const body = new URLSearchParams({ grant_type: "client_credentials", client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET }).toString();
        const t = await call("https://" + domain + "/admin/oauth/access_token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
        if (!t || typeof t.access_token !== "string" || !t.access_token) throw new Error("bad shape");
        token = t.access_token;
      }
      const version = VERSION_RE.test(String(env.SHOPIFY_API_VERSION || "")) ? env.SHOPIFY_API_VERSION : SHOPIFY_API_VERSION;
      const variables = op === "shop.get" ? undefined : op === "product.update" ? { product: productInput(input) } : { first: input.limit || 10, after: input.after || null };
      const d = await call("https://" + domain + "/admin/api/" + version + "/graphql.json", {
        method: "POST",
        headers: { "content-type": "application/json", "x-shopify-access-token": token },
        body: JSON.stringify({ query: op === "product.update" ? PRODUCT_UPDATE : Q[op], ...(variables ? { variables } : {}) }),
      });
      if (!d || typeof d !== "object") throw new Error("bad shape");
      if (Array.isArray(d.errors) && d.errors.length) {
        const code = d.errors[0] && d.errors[0].extensions && d.errors[0].extensions.code;
        fail("Shopify GraphQL xəta qaytardı" + (typeof code === "string" && /^[A-Z_]{3,40}$/.test(code) ? " (" + code + ")" : ""), code);
      }
      if (!d.data || typeof d.data !== "object") throw new Error("bad shape");
      if (op === "product.update") {
        const ue = d.data.productUpdate && d.data.productUpdate.userErrors;
        if (Array.isArray(ue) && ue.length) fail("Shopify productUpdate userErrors (" + ue.length + ")" + (Array.isArray(ue[0] && ue[0].field) ? ": " + ue[0].field.join(".").replace(/[^A-Za-z0-9_.]/g, "").slice(0, 60) : ""), "user_errors");
      }
      return MAP[op](d.data);
    },
  };
}

export class ShopifyAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({
      id: "shopify",
      label: "Shopify (oxuma + təsdiqli məhsul redaktəsi)",
      operations: SHOPIFY_OPERATIONS,
      endpoints: { "shop.get": makeSpec("shop.get"), "products.list": makeSpec("products.list"), "orders.list": makeSpec("orders.list"), "customers.list": makeSpec("customers.list"), "product.update": makeSpec("product.update") },
      allowedHosts: (env) => [normalizeShopDomain(env && env.SHOPIFY_STORE_DOMAIN)].filter(Boolean),
      ...opts,
    });
  }
  get shopDomain() { return normalizeShopDomain(this._env.SHOPIFY_STORE_DOMAIN); }
  // Domen düzgün formada olmalıdır; token ya SHOPIFY_ADMIN_TOKEN, ya da SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET olmalıdır.
  _missing() {
    const e = this._env;
    const m = [];
    if (!present(e.SHOPIFY_ADMIN_TOKEN) && !(present(e.SHOPIFY_CLIENT_ID) && present(e.SHOPIFY_CLIENT_SECRET))) m.push("SHOPIFY_ADMIN_TOKEN");
    if (!this.shopDomain) m.push("SHOPIFY_STORE_DOMAIN");
    return m;
  }
  _precheck(op, input, ctx) {
    if (input.after !== undefined && !CURSOR_RE.test(input.after)) throw new IntegrationError("invalid_input", "after düzgün deyil", ctx);
    if (op === "product.update") {
      if (!PRODUCT_GID_RE.test(input.product_id)) throw new IntegrationError("invalid_input", "product_id gid://shopify/Product/<rəqəm> formasında olmalıdır", ctx);
      if (!["title", "description_html", "status", "tags", "vendor", "product_type"].some((k) => input[k] !== undefined)) throw new IntegrationError("invalid_input", "heç bir dəyişiklik verilməyib", ctx);
    }
  }
  get mockHandlers() {
    return {
      "shop.get": () => ({ name: "mock mağaza", currencyCode: "AZN" }),
      "products.list": (i) => ({ items: [{ id: "mock_p1", title: "mock məhsul", status: "ACTIVE" }].slice(0, i.limit || 25), next: null }),
      "orders.list": () => ({ items: [], next: null }),
      "customers.list": () => ({ items: [], next: null }),
      "product.update": (i) => ({ updated: true, product: { id: i.product_id, title: i.title || "mock məhsul", status: i.status || "DRAFT" }, tags: i.tags || [] }),
    };
  }
}
