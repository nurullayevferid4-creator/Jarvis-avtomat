// Shopify testləri üçün köməkçilər. HEÇ BİR real şəbəkə çağırışı yoxdur: saxta Shopify serveri (yaddaşda).
// Token və sirlər icra zamanı qurulur və açıq-aydın saxtadır.
import { _resetMemoryForTests, createStore } from "../src/state/store.js";
import { createAudit } from "../src/audit/log.js";
import { ApprovalCenter } from "../src/approval/center.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createActionRunner } from "../src/actions/runner.js";
import { MemoryCoordinator } from "../src/coord/coordinator.js";
import { createTokenVault } from "../src/social/tokens.js";
import { createShopifyClient } from "../src/shopify/client.js";
import { registerShopifyTools } from "../src/shopify/tools.js";
import { hmacSha256, toHex } from "../src/shopify/crypto.js";

export const SHOP = "demo-store.myshopify.com";
export const FAKE_TOKEN = "faketok_" + "a1b2c3d4e5f6".repeat(3);
export const FAKE_SECRET = "fake-shopify-api-" + "secret-for-tests";
export const NOW0 = 1_800_000_000_000;

export const jsonRes = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

const ext = (avail = 900) => ({ cost: { requestedQueryCost: 10, actualQueryCost: 8, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: avail, restoreRate: 50 } } });

// ---- Saxta Shopify ------------------------------------------------------------------------------------
export function createFakeShopify(opts = {}) {
  const st = {
    token: opts.token || FAKE_TOKEN,
    scope: opts.scope || "read_products,write_products,read_orders,read_inventory,write_inventory",
    seq: 1000,
    products: new Map(),
    inventory: new Map(), // "itemId|locId" -> { id, available }
    collections: new Map([["gid://shopify/Collection/1", { id: "gid://shopify/Collection/1", title: "Yeni gələnlər", handle: "yeni", products: new Set() }]]),
    orders: [
      { id: "gid://shopify/Order/11", name: "#1001", createdAt: "2026-10-01T10:00:00Z", displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED", currentTotalPriceSet: { shopMoney: { amount: "59.80", currencyCode: "AZN" } }, shippingAddress: { firstName: "Aysel", city: "Bakı" }, customer: { firstName: "Aysel", lastName: "Əliyeva", email: "aysel@example.com" }, email: "aysel@example.com", phone: "+994000000000", lineItems: { nodes: [{ title: "Ətir A", quantity: 2, sku: "A-1" }] } },
    ],
    webhooks: [],
    locations: [{ id: "gid://shopify/Location/1", name: "Bakı anbar", isActive: true }],
    currency: "AZN",
    // sınaq düymələri
    ignoreVariantPriceUpdate: false,
    ignoreInventorySet: false,
    ignoreStatusUpdate: false,
    failOp: null, // { op, status, body }
    throttleAvail: 900,
    delayMs: 0,
    calls: [],
  };
  const nid = () => ++st.seq;

  function addProduct(p) {
    const id = "gid://shopify/Product/" + nid();
    const variants = (p.variants || [{ title: "Default Title", price: "10.00" }]).map((v) => {
      const vid = "gid://shopify/ProductVariant/" + nid();
      const iid = "gid://shopify/InventoryItem/" + nid();
      if (v.inventory !== undefined) st.inventory.set(iid + "|gid://shopify/Location/1", { id: "gid://shopify/InventoryLevel/" + nid(), available: v.inventory });
      return { id: vid, title: v.title, sku: v.sku || null, price: v.price, compareAtPrice: null, inventoryItem: { id: iid, tracked: v.tracked !== false } };
    });
    const prod = { id, title: p.title, handle: p.handle, status: p.status || "ACTIVE", descriptionHtml: p.descriptionHtml || "", vendor: p.vendor || "", productType: p.productType || "", tags: p.tags || [], seo: p.seo || { title: "", description: "" }, variants, mediaCount: p.mediaCount || 0 };
    st.products.set(id, prod);
    return prod;
  }

  const prodOut = (p) => ({
    id: p.id, title: p.title, handle: p.handle, status: p.status, descriptionHtml: p.descriptionHtml, vendor: p.vendor, productType: p.productType, tags: p.tags,
    totalInventory: p.variants.reduce((a, v) => a + (([...st.inventory].find(([k]) => k.startsWith(v.inventoryItem.id + "|")) || [0, { available: 0 }])[1].available), 0),
    mediaCount: { count: p.mediaCount }, seo: p.seo,
    variants: { nodes: p.variants.map((v) => ({ id: v.id, title: v.title, sku: v.sku, price: v.price, compareAtPrice: v.compareAtPrice, inventoryItem: { id: v.inventoryItem.id, tracked: v.inventoryItem.tracked } })) },
  });

  function levelsOf(item) {
    return [...st.inventory].filter(([k]) => k.startsWith(item.id + "|")).map(([k, l]) => ({ location: st.locations.find((x) => x.id === k.split("|")[1]) || { id: k.split("|")[1], name: "?" }, quantities: [{ name: "available", quantity: l.available }] }));
  }

  function run(op, v, query) {
    switch (op) {
      case "ShopInfo": return { shop: { name: "Demo mağaza", myshopifyDomain: SHOP, currencyCode: st.currency, ianaTimezone: "Asia/Baku", primaryDomain: { url: "https://demo.example" } } };
      case "AppScopes": return { currentAppInstallation: { accessScopes: st.scope.split(",").map((handle) => ({ handle })) } };
      case "SearchProducts": {
        const q = String(v.query || "");
        let list = [...st.products.values()];
        const h = q.match(/^handle:(\S+)$/);
        const t = q.match(/^title:"(.*)"$/);
        if (h) list = list.filter((p) => p.handle === h[1]);
        else if (t) list = list.filter((p) => p.title.toLowerCase().includes(t[1].toLowerCase()));
        else if (q) list = list.filter((p) => p.title.toLowerCase().includes(q.toLowerCase()));
        return { products: { nodes: list.slice(0, v.first).map((p) => ({ id: p.id, title: p.title, handle: p.handle, status: p.status, totalInventory: prodOut(p).totalInventory, variants: { nodes: p.variants.map((x) => ({ id: x.id, title: x.title, sku: x.sku, price: x.price })) } })) } };
      }
      case "GetProduct": { const p = st.products.get(v.id); return { product: p ? prodOut(p) : null }; }
      case "ListOrders": return { orders: { nodes: st.orders.slice(0, v.first).map(orderNode) } };
      case "GetOrder": { const o = st.orders.find((x) => x.id === v.id); return { order: o ? { ...orderNode(o), cancelledAt: null, lineItems: o.lineItems } : null }; }
      case "ProductInventory": {
        const p = st.products.get(v.id);
        if (!p) return { product: null };
        return { product: { id: p.id, title: p.title, variants: { nodes: p.variants.map((x) => ({ id: x.id, title: x.title, sku: x.sku, inventoryItem: { id: x.inventoryItem.id, tracked: x.inventoryItem.tracked, inventoryLevels: { nodes: levelsOf(x.inventoryItem) } } })) } } };
      }
      case "InventoryLevelAt": {
        const item = [...st.products.values()].flatMap((p) => p.variants).find((x) => x.inventoryItem.id === v.itemId);
        if (!item) return { inventoryItem: null };
        const l = st.inventory.get(v.itemId + "|" + v.locationId);
        return { inventoryItem: { id: v.itemId, tracked: item.inventoryItem.tracked, inventoryLevel: l ? { id: l.id, quantities: [{ name: "available", quantity: l.available }] } : null } };
      }
      case "ListLocations": return { locations: { nodes: st.locations } };
      case "ListCollections": return { collections: { nodes: [...st.collections.values()].map((c) => ({ id: c.id, title: c.title, handle: c.handle, productsCount: { count: c.products.size } })) } };
      case "CollectionInfo": {
        const c = st.collections.get(v.id);
        return { collection: c ? { id: c.id, title: c.title, ruleSet: c.ruleSet || null } : null };
      }
      case "ProductCollections": {
        const p = st.products.get(v.id);
        if (!p) return { product: null };
        return { product: { id: p.id, collections: { nodes: [...st.collections.values()].filter((c) => c.products.has(p.id)).map((c) => ({ id: c.id })) } } };
      }
      case "ListWebhooks": return { webhookSubscriptions: { nodes: st.webhooks } };
      case "CreateProduct": {
        const pi = v.product;
        const first = pi.productOptions && pi.productOptions[0] && pi.productOptions[0].values[0].name;
        const p = addProduct({ title: pi.title, handle: pi.handle, status: pi.status, descriptionHtml: pi.descriptionHtml, vendor: pi.vendor, productType: pi.productType, tags: pi.tags, seo: pi.seo ? { title: pi.seo.title || "", description: pi.seo.description || "" } : undefined, mediaCount: (v.media || []).length, variants: [{ title: first || "Default Title", price: "0.00", tracked: false }] });
        return { productCreate: { product: { id: p.id, title: p.title, handle: p.handle, status: p.status, variants: { nodes: [{ id: p.variants[0].id, inventoryItem: { id: p.variants[0].inventoryItem.id } }] } }, userErrors: [] } };
      }
      case "UpdateVariants": {
        const p = st.products.get(v.productId);
        if (!p) return { productVariantsBulkUpdate: { productVariants: null, userErrors: [{ field: ["productId"], message: "Product does not exist" }] } };
        for (const x of v.variants) {
          const vv = p.variants.find((y) => y.id === x.id);
          if (!vv) return { productVariantsBulkUpdate: { productVariants: null, userErrors: [{ field: ["variants"], message: "Variant not found" }] } };
          if (x.price !== undefined && !st.ignoreVariantPriceUpdate) vv.price = x.price;
          if (x.inventoryItem) { if (x.inventoryItem.sku) vv.sku = x.inventoryItem.sku; if (x.inventoryItem.tracked !== undefined) vv.inventoryItem.tracked = x.inventoryItem.tracked; }
        }
        return { productVariantsBulkUpdate: { productVariants: p.variants.map((y) => ({ id: y.id, title: y.title, sku: y.sku, price: y.price, compareAtPrice: null })), userErrors: [] } };
      }
      case "CreateVariants": {
        const p = st.products.get(v.productId);
        const made = v.variants.map((x) => {
          const vv = { id: "gid://shopify/ProductVariant/" + nid(), title: x.optionValues[0].name, sku: (x.inventoryItem && x.inventoryItem.sku) || null, price: x.price, compareAtPrice: null, inventoryItem: { id: "gid://shopify/InventoryItem/" + nid(), tracked: true } };
          p.variants.push(vv);
          return { id: vv.id, title: vv.title, sku: vv.sku, price: vv.price, inventoryItem: { id: vv.inventoryItem.id } };
        });
        return { productVariantsBulkCreate: { productVariants: made, userErrors: [] } };
      }
      case "UpdateProduct": {
        const pi = v.product;
        const p = st.products.get(pi.id);
        if (!p) return { productUpdate: { product: null, userErrors: [{ field: ["id"], message: "Product does not exist" }] } };
        for (const k of ["title", "descriptionHtml", "vendor", "productType", "tags"]) if (pi[k] !== undefined) p[k] = pi[k];
        if (pi.status !== undefined && !st.ignoreStatusUpdate) p.status = pi.status;
        if (pi.seo) p.seo = { ...p.seo, ...pi.seo };
        return { productUpdate: { product: { id: p.id, title: p.title, handle: p.handle, status: p.status }, userErrors: [] } };
      }
      case "ActivateInventory": {
        st.inventory.set(v.inventoryItemId + "|" + v.locationId, { id: "gid://shopify/InventoryLevel/" + nid(), available: 0 });
        return { inventoryActivate: { inventoryLevel: { id: "x" }, userErrors: [] } };
      }
      case "SetInventory": {
        for (const q of v.input.quantities) {
          const l = st.inventory.get(q.inventoryItemId + "|" + q.locationId);
          if (!l) return { inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: ["input"], code: "ITEM_NOT_STOCKED_AT_LOCATION", message: "not stocked" }] } };
          if (q.changeFromQuantity !== l.available) return { inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: ["input"], code: "CHANGE_FROM_QUANTITY_MISMATCH", message: "changeFromQuantity does not match" }] } };
          if (!st.ignoreInventorySet) l.available = q.quantity;
        }
        return { inventorySetQuantities: { inventoryAdjustmentGroup: { id: "g", changes: [] }, userErrors: [] } };
      }
      case "AddToCollection": {
        const c = st.collections.get(v.id);
        if (!c) return { collectionAddProducts: { collection: null, userErrors: [{ field: ["id"], message: "Collection not found" }] } };
        for (const pid of v.productIds) c.products.add(pid);
        return { collectionAddProducts: { collection: { id: c.id, title: c.title }, userErrors: [] } };
      }
      case "CreateWebhook": {
        st.webhooks.push({ id: "gid://shopify/WebhookSubscription/" + nid(), topic: v.topic, uri: v.webhookSubscription.uri });
        return { webhookSubscriptionCreate: { webhookSubscription: { id: "w", topic: v.topic }, userErrors: [] } };
      }
      default:
        throw new Error("TEST: saxta Shopify bu əməliyyatı bilmir: " + op + " :: " + query.slice(0, 40));
    }
  }

  // Müştəri şəxsi məlumatı saxta cavabda VAR (soyad, e-poçt, telefon): alətlər onu çıxışa buraxmamalıdır
  function orderNode(o) {
    return { id: o.id, name: o.name, createdAt: o.createdAt, displayFinancialStatus: o.displayFinancialStatus, displayFulfillmentStatus: o.displayFulfillmentStatus, currentTotalPriceSet: o.currentTotalPriceSet, shippingAddress: { ...o.shippingAddress, lastName: "Əliyeva", address1: "Nizami küç. 1", phone: o.phone }, customer: o.customer, email: o.email };
  }

  async function fetchImpl(url, init = {}) {
    const u = new URL(String(url));
    const headers = {};
    const h = init.headers || {};
    for (const [k, val] of h instanceof Headers ? h.entries() : Object.entries(h)) headers[k.toLowerCase()] = String(val);
    const rec = { url: String(url), host: u.host, path: u.pathname, method: (init.method || "GET").toUpperCase(), headers, body: init.body, signal: init.signal };
    st.calls.push(rec);
    if (st.delayMs) await new Promise((r, rej) => { const t = setTimeout(r, st.delayMs); if (init.signal) init.signal.addEventListener("abort", () => { clearTimeout(t); const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); });
    if (u.pathname === "/admin/oauth/access_token") {
      const b = JSON.parse(init.body);
      rec.json = b;
      if (b.code !== "goodcode") return jsonRes({ error: "invalid_request" }, 400);
      return jsonRes({ access_token: st.token, scope: st.scope });
    }
    const m = u.pathname.match(/^\/admin\/api\/([^/]+)\/graphql\.json$/);
    if (!m) return new Response("nope", { status: 404 });
    rec.version = m[1];
    if (headers["x-shopify-access-token"] !== st.token) return jsonRes({ errors: "[API] Invalid API key or access token" }, 401);
    const b = JSON.parse(init.body);
    rec.gql = b;
    const op = (b.query.match(/^\s*(?:query|mutation)\s+(\w+)/) || [])[1];
    rec.op = op;
    if (st.failOp && st.failOp.op === op) {
      const f = st.failOp;
      if (f.times !== undefined && f.times <= 0) st.failOp = null;
      else {
        if (f.times !== undefined) f.times--;
        if (f.body) return jsonRes(f.body, f.status || 200, f.headers || {});
        return new Response("x", { status: f.status, headers: f.headers || {} });
      }
    }
    return jsonRes({ data: run(op, b.variables || {}, b.query), extensions: ext(st.throttleAvail) });
  }

  return { st, fetchImpl, addProduct, ops: () => st.calls.filter((c) => c.op).map((c) => c.op) };
}

// ---- Dünya (store + audit + approvals + registry + runner + client) --------------------------------------
export async function shopifyWorld({ connected = true, envExtra = {}, fake, sleep = async () => {} } = {}) {
  _resetMemoryForTests();
  const env = { SHOPIFY_API_KEY: "test-key", SHOPIFY_API_SECRET: FAKE_SECRET, PUBLIC_BASE_URL: "https://jarvis.example.dev", TOKEN_ENC_KEY: "test-token-enc-key", ...envExtra };
  const store = createStore(env);
  let t = NOW0;
  const now = () => t;
  const audit = createAudit(store, now);
  const coord = new MemoryCoordinator(now);
  const approvals = new ApprovalCenter(store, audit, now, coord);
  const vault = createTokenVault(env, store);
  const fk = fake || createFakeShopify();
  if (connected) await vault.put("shopify", { access_token: fk.st.token, scope: fk.st.scope, shop: SHOP, connected_at: NOW0, api_version: "2026-07" });
  const client = createShopifyClient({ env, vault, fetchImpl: fk.fetchImpl, now, sleep });
  const registry = new ToolRegistry({ audit, approvals, sleep: async () => {} });
  registerShopifyTools(registry, { client, vault, audit, env });
  const runner = createActionRunner({ approvals, registry, audit });
  return { env, store, audit, coord, approvals, vault, client, registry, runner, fake: fk, now, advance: (ms) => { t += ms; } };
}

export const UI = { channel: "ui" };

// Alət çağırır, təsdiq qeydini yaradır
export async function propose(w, tool, input) {
  const r = await w.registry.run(tool, input, { approvals: w.approvals, source: "test" });
  return r;
}

export async function proposeAndApprove(w, tool, input) {
  const r = await propose(w, tool, input);
  if (r.status !== "pending_approval") return { proposed: r };
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  return { proposed: r, out, id: r.approval_id };
}

// ---- OAuth / webhook imza köməkçiləri (testin öz müstəqil tətbiqi) ------------------------------------
export async function signOAuthParams(params, secret = FAKE_SECRET) {
  const msg = Object.keys(params).filter((k) => k !== "hmac").sort().map((k) => k + "=" + params[k]).join("&");
  return toHex(await hmacSha256(secret, msg));
}

export async function signedCallback(w, { shop = SHOP, code = "goodcode", state, timestamp, extra = {}, secret = FAKE_SECRET } = {}) {
  const params = { code, shop, state, timestamp: String(timestamp === undefined ? Math.floor(w.now() / 1000) : timestamp), host: "YWRtaW4", ...extra };
  params.hmac = await signOAuthParams(params, secret);
  return new URLSearchParams(params);
}

export async function webhookRequest(body, { topic = "products/update", shop = SHOP, id = "wh-0001-aaaa-bbbb", secret = FAKE_SECRET, hmac, path = "https://jarvis.example.dev/shopify/webhook" } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const bytes = new TextEncoder().encode(raw);
  const sig = hmac !== undefined ? hmac : btoa(String.fromCharCode(...(await hmacSha256(secret, bytes))));
  const headers = { "content-type": "application/json", "x-shopify-hmac-sha256": sig, "x-shopify-topic": topic, "x-shopify-shop-domain": shop, "x-shopify-webhook-id": id };
  return new Request(path, { method: "POST", headers, body: bytes });
}

// JSON-u ağac boyu axtarır: token izi varmı
export function leaks(value, needle = FAKE_TOKEN) {
  return JSON.stringify(value === undefined ? null : value).includes(needle);
}

export async function allAuditText(w) {
  return JSON.stringify(await w.audit.list(40));
}
