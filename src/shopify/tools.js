// Shopify alətləri. registerShopifyTools(registry, { client, vault, audit, env, llm? })
//
// OXUMA alətləri (risk low): təsdiq yoxdur, yan təsir yoxdur.
// YAZMA alətləri (risk high, requiresApproval): registry.run YALNIZ təsdiq qeydi açır, heç nə icra etmir.
//   Sahib təsdiq edəndən sonra src/actions/runner.js approval.execute-u BİR dəfə çağırır.
//   Hər execute: (1) cari vəziyyəti yenidən oxuyur, təsdiqlənmiş "köhnə dəyər" ilə uyğun gəlməsə CONFLICT verir,
//   (2) yazır, (3) Shopify-dan geri oxuyub yoxlayır, fərq varsa PROVIDER_ERROR verir (saxta uğur yoxdur).
// SİLMƏ aləti YOXDUR (silmə qorunması): yalnız shopify.product.archive (status ARCHIVED, geri qaytarıla bilər).
// Webhook qəbulu heç vaxt bu alətləri çağırmır.
//
// `llm` parametri qəbul olunur, amma istifadə edilmir: shopify.product.prepare tam deterministikdir.

import { AppError, toAppError } from "../errors.js";
import { assertNoUserErrors } from "./client.js";
import { shopifyWebhookUri } from "./config.js";
import {
  M_COLLECTION_ADD, M_INVENTORY_ACTIVATE, M_INVENTORY_SET, M_PRODUCT_CREATE, M_PRODUCT_UPDATE, M_VARIANTS_CREATE, M_VARIANTS_UPDATE,
  Q_COLLECTIONS, Q_COLLECTION_INFO, Q_INVENTORY, Q_LOCATIONS, Q_ORDER, Q_ORDERS, Q_PRODUCTS, Q_PRODUCT_COLLECTIONS, Q_WEBHOOKS,
} from "./gql.js";
import { assertShopCurrency, centsOf, findDuplicates, getInventoryLevel, getProduct, getShopInfo, sameCents, toGid } from "./ops.js";
import { cleanLine, htmlToText, LIMITS, normalizeDescription, normalizeTags, parseMoney, pickDraft, prepareProduct } from "./prepare.js";
import { registerShopifyWebhooks, WEBHOOK_TOPICS } from "./webhooks.js";

// policy.js-ə TƏKLİF olunan yeni icazə adları (hazırda alətlər onları tələb ETMİR, risk=high + requiresApproval kifayətdir)
export const SHOPIFY_PERMISSIONS = { read: "shopify.read", write: "shopify.write" };

export const SHOPIFY_READ_TOOLS = ["shopify.shop.info", "shopify.products.search", "shopify.product.get", "shopify.orders.list", "shopify.order.get", "shopify.inventory.get", "shopify.collections.list", "shopify.webhooks.list", "shopify.product.prepare"];
export const SHOPIFY_WRITE_TOOLS = ["shopify.product.create", "shopify.product.update", "shopify.price.update", "shopify.inventory.set", "shopify.product.publish", "shopify.product.archive", "shopify.collection.add", "shopify.webhooks.register"];

const OPTION_NAME = "Variant";
const MAX_ORDERS = 20;

// ---------------------------------------------------------------------------------------------------
// Sxem köməkçiləri
const str = (max, min = 0) => ({ type: "string", minLength: min, maxLength: max });
const idStr = str(80, 1);
const obj = (properties, required = [], extra = {}) => ({ type: "object", required, additionalProperties: false, properties, ...extra });
const bad = (msg) => { throw new Error(msg); };

function q(s, n = 80) {
  const t = String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim();
  return "«" + (t.length > n ? t.slice(0, n - 1) + "…" : t) + "»";
}

function cleanQuery(s) {
  return String(s === undefined || s === null ? "" : s).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

function money(v, field) {
  const m = parseMoney(v);
  if (m.missing) bad(field + " məcburidir");
  if (m.error) bad(field + ": " + m.error);
  return m.value;
}

function pct(oldP, newP) {
  const o = centsOf(oldP);
  const n = centsOf(newP);
  if (!o || n === null) return "";
  const d = ((n - o) / o) * 100;
  return " (" + (d >= 0 ? "+" : "") + d.toFixed(1) + "%)";
}

function mismatch(msg, details) {
  return new AppError("CONFLICT", msg + (details ? ": " + details : ""), { source: "shopify" });
}

function readbackFail(what, diffs, id) {
  return new AppError("PROVIDER_ERROR", "Yazıldı, amma Shopify-dan geri oxuma uyğun gəlmir (" + what + "): " + diffs.join("; ").slice(0, 200) + (id ? ". id: " + id : "") + ". Shopify admin-də yoxlayın.", { source: "shopify", retryable: false });
}

const sameSet = (a, b) => {
  const x = [...(a || [])].map((s) => String(s).toLowerCase()).sort();
  const y = [...(b || [])].map((s) => String(s).toLowerCase()).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

function brief(p) {
  return { id: p.id, title: p.title, handle: p.handle, status: p.status, variants: p.variants.map((v) => ({ id: v.id, title: v.title, sku: v.sku, price: v.price })) };
}

// ---------------------------------------------------------------------------------------------------
// Oxuma çıxışları
const orderOut = (o) => ({
  id: o.id,
  name: o.name,
  created_at: o.createdAt,
  financial_status: o.displayFinancialStatus || null,
  fulfillment_status: o.displayFulfillmentStatus || null,
  total: o.currentTotalPriceSet && o.currentTotalPriceSet.shopMoney ? { amount: o.currentTotalPriceSet.shopMoney.amount, currency: o.currentTotalPriceSet.shopMoney.currencyCode } : null,
  // Şəxsi məlumat minimumu: yalnız ad və şəhər (soyad, telefon, e-poçt, küçə ünvanı QAYTARILMIR)
  ship_to: o.shippingAddress ? { first_name: o.shippingAddress.firstName || null, city: o.shippingAddress.city || null } : null,
});

// ---------------------------------------------------------------------------------------------------
// Təsdiq mətnləri (describe): YALNIZ payload-dan çıxarılır, deterministikdir. Runner icra anında yenidən hesablayıb müqayisə edir.

function describeCreate(payload) {
  const i = payload.input;
  const d = i.draft;
  const status = i.status === "ACTIVE" ? "ACTIVE" : "DRAFT";
  const lines = ["Shopify: yeni məhsul yaradılacaq (silmə yoxdur, yalnız yaratma)."];
  lines.push("Başlıq: " + q(d.title, 120));
  lines.push("Handle: " + d.handle);
  lines.push(status === "ACTIVE" ? "Status: ACTIVE (mağazada DƏRHAL satışa çıxır)" : "Status: DRAFT (qaralama, mağazada görünmür)");
  const cur = d.currency || "mağaza valyutası";
  if (d.variants && d.variants.length > 1) lines.push("Variantlar (" + d.variants.length + "): " + d.variants.map((v) => q(v.title, 30) + " = " + v.price + (v.sku ? " [" + v.sku + "]" : "")).join(", ") + " " + cur);
  else lines.push("Qiymət: " + (d.variants && d.variants.length === 1 ? d.variants[0].price : d.price) + " " + cur + (d.variants && d.variants.length === 1 && d.variants[0].sku ? " [SKU " + d.variants[0].sku + "]" : ""));
  if (d.inventory !== null && d.inventory !== undefined) lines.push("Stok: " + d.inventory + " ədəd (yer: " + i.locationId + ")");
  lines.push("Şəkil: " + ((d.images && d.images.length) || 0));
  if (d.tags && d.tags.length) lines.push("Etiketlər: " + d.tags.join(", "));
  if (d.productType) lines.push("Növ: " + d.productType);
  if (d.vendor) lines.push("Satıcı: " + d.vendor);
  lines.push("Təsvir (" + htmlToText(d.descriptionHtml).length + " simvol): " + q(htmlToText(d.descriptionHtml), 400));
  lines.push("SEO başlıq: " + q(d.seo && d.seo.title, 70));
  if (d.seo && d.seo.description) lines.push("SEO təsvir: " + q(d.seo.description, 170));
  return lines.join("\n");
}

function describeUpdate(payload) {
  const i = payload.input;
  const lines = ["Shopify: məhsul yenilənəcək: " + (i.product_title ? q(i.product_title, 80) + " " : "") + i.id];
  for (const k of Object.keys(i.changes)) {
    const o = i.before[k];
    const n = i.changes[k];
    if (k === "tags") lines.push("tags: [" + (o || []).join(", ") + "] -> [" + n.join(", ") + "]");
    else if (k === "descriptionHtml") lines.push("təsvir: " + htmlToText(o).length + " simvol -> " + htmlToText(n).length + " simvol: " + q(htmlToText(n), 120));
    else lines.push(k + ": " + q(o, 80) + " -> " + q(n, 80));
  }
  return lines.join("\n");
}

function describePrice(payload) {
  const i = payload.input;
  const lines = ["Shopify: QİYMƏT dəyişəcək. Məhsul: " + (i.product_title ? q(i.product_title, 80) + " " : "") + i.productId + (i.currency ? " (" + i.currency + ")" : "")];
  for (const v of i.variants) {
    const big = centsOf(v.new_price) > centsOf(v.old_price) * 2 || centsOf(v.new_price) * 2 < centsOf(v.old_price);
    lines.push("- " + v.id + (v.title ? " " + q(v.title, 40) : "") + ": " + v.old_price + " -> " + v.new_price + pct(v.old_price, v.new_price) + (big ? "  DİQQƏT: qiymət 2 dəfədən çox dəyişir" : ""));
  }
  return lines.join("\n");
}

function describeInventory(payload) {
  const i = payload.input;
  return "Shopify: STOK dəyişəcək. " + (i.product_title ? q(i.product_title, 80) + " " : "") + "Stok vahidi: " + i.inventoryItemId + ", yer: " + i.locationId + (i.location_name ? " " + q(i.location_name, 40) : "") + "\nMövcud (available): " + i.old_quantity + " -> " + i.new_quantity + " (" + (i.new_quantity - i.old_quantity >= 0 ? "+" : "") + (i.new_quantity - i.old_quantity) + ")";
}

function describePublish(payload) {
  const i = payload.input;
  return "Shopify: məhsul SATIŞA ÇIXARILACAQ (status " + i.expected_status + " -> ACTIVE): " + (i.product_title ? q(i.product_title, 80) + " " : "") + i.id + ". Qeyd: satış kanalına (Online Store) çıxarış bu əməliyyata daxil deyil.";
}

function describeArchive(payload) {
  const i = payload.input;
  return "Shopify: məhsul ARXİVLƏNƏCƏK (status " + i.expected_status + " -> ARCHIVED, SİLİNMİR, geri qaytarıla bilər): " + (i.product_title ? q(i.product_title, 80) + " " : "") + i.id;
}

function describeCollection(payload) {
  const i = payload.input;
  return "Shopify: " + i.productIds.length + " məhsul kolleksiyaya əlavə ediləcək. Kolleksiya: " + (i.collection_title ? q(i.collection_title, 80) + " " : "") + i.collectionId + "\nMəhsullar: " + i.productIds.join(", ");
}

function describeWebhooks(env) {
  return (payload) => {
    const t = payload.input.topics;
    return "Shopify: webhook abunəlikləri yaradılacaq (yalnız bildiriş, avtomatik əməliyyat yoxdur).\nÜnvan: " + shopifyWebhookUri(env) + "\nTopic-lər: " + t.join(", ");
  };
}

// ---------------------------------------------------------------------------------------------------
export function registerShopifyTools(registry, deps) {
  const { client, vault, audit = null, env = {} } = deps || {};
  if (!client) throw new Error("registerShopifyTools: client məcburidir");

  const readTool = (def) => registry.register({ permissions: [], risk: "low", requiresApproval: false, timeoutMs: 25000, retries: 1, backoffMs: 300, ...def });
  const noExec = async () => { throw new Error("Bu alət yalnız təsdiq axını ilə icra olunur"); };
  const log = async (event, data) => { if (audit) await audit.log(event, data); };

  // ---- OXUMA ------------------------------------------------------------------------------------------
  readTool({
    name: "shopify.shop.info",
    description: "Qoşulu Shopify mağazasının adı, valyutası, saat qurşağı və qoşulma vəziyyəti (token göstərilmir).",
    inputSchema: obj({}),
    outputSchema: { type: "object", required: ["shop", "connection"], properties: { shop: { type: "object" }, connection: { type: "object" } } },
    async handler() {
      const shop = await getShopInfo(client);
      const c = await client.connection();
      return { shop, connection: { connected: c.connected, scopes: String(c.scope || "").split(",").filter(Boolean), api_version: c.apiVersion || null } };
    },
  });

  readTool({
    name: "shopify.products.search",
    description: "Məhsulları açar sözlə (Shopify axtarış sintaksisi) axtarır. Maks 20 nəticə.",
    inputSchema: obj({ query: str(200), limit: { type: "integer", minimum: 1, maximum: 20 } }),
    outputSchema: { type: "object", required: ["products"], properties: { products: { type: "array" } } },
    async handler(input) {
      const d = await client.query(Q_PRODUCTS, { first: input.limit || 10, query: cleanQuery(input.query) || null });
      const products = ((d.products && d.products.nodes) || []).map((p) => ({ id: p.id, title: p.title, handle: p.handle, status: p.status, total_inventory: p.totalInventory === undefined ? null : p.totalInventory, variants: ((p.variants && p.variants.nodes) || []).map((v) => ({ id: v.id, title: v.title, sku: v.sku || null, price: v.price })) }));
      return { products };
    },
  });

  readTool({
    name: "shopify.product.get",
    description: "Bir məhsulun tam məlumatı (id ilə): status, təsvir, variantlar, qiymətlər.",
    inputSchema: obj({ id: idStr }, ["id"]),
    outputSchema: { type: "object", required: ["product"], properties: { product: { type: "object" } } },
    async handler(input) {
      return { product: await getProduct(client, toGid("product", input.id)) };
    },
  });

  readTool({
    name: "shopify.orders.list",
    description: "Son sifarişlər (maks 20, minimal sahələr: nömrə, status, məbləğ, alıcının adı və şəhəri).",
    inputSchema: obj({ query: str(200), limit: { type: "integer", minimum: 1, maximum: MAX_ORDERS } }),
    outputSchema: { type: "object", required: ["orders"], properties: { orders: { type: "array" } } },
    async handler(input) {
      const d = await client.query(Q_ORDERS, { first: Math.min(MAX_ORDERS, input.limit || 10), query: cleanQuery(input.query) || null });
      return { orders: ((d.orders && d.orders.nodes) || []).map(orderOut) };
    },
  });

  readTool({
    name: "shopify.order.get",
    description: "Bir sifarişin minimal məlumatı və məhsul sətirləri (id ilə). Alıcının yalnız adı və şəhəri.",
    inputSchema: obj({ id: idStr }, ["id"]),
    outputSchema: { type: "object", required: ["order"], properties: { order: { type: "object" } } },
    async handler(input) {
      const d = await client.query(Q_ORDER, { id: toGid("order", input.id) });
      if (!d.order) throw new AppError("NOT_FOUND", "Sifariş tapılmadı", { source: "shopify" });
      return { order: { ...orderOut(d.order), cancelled_at: d.order.cancelledAt || null, line_items: ((d.order.lineItems && d.order.lineItems.nodes) || []).map((l) => ({ title: l.title, quantity: l.quantity, sku: l.sku || null })) } };
    },
  });

  readTool({
    name: "shopify.inventory.get",
    description: "Məhsulun variantları üzrə stok (yerlərə görə mövcud say).",
    inputSchema: obj({ productId: idStr }, ["productId"]),
    outputSchema: { type: "object", required: ["product", "variants"], properties: { product: { type: "object" }, variants: { type: "array" } } },
    async handler(input) {
      const d = await client.query(Q_INVENTORY, { id: toGid("product", input.productId) });
      if (!d.product) throw new AppError("NOT_FOUND", "Məhsul tapılmadı", { source: "shopify" });
      return {
        product: { id: d.product.id, title: d.product.title },
        variants: ((d.product.variants && d.product.variants.nodes) || []).map((v) => ({
          id: v.id,
          title: v.title,
          sku: v.sku || null,
          inventory_item_id: v.inventoryItem ? v.inventoryItem.id : null,
          tracked: v.inventoryItem ? Boolean(v.inventoryItem.tracked) : null,
          levels: ((v.inventoryItem && v.inventoryItem.inventoryLevels && v.inventoryItem.inventoryLevels.nodes) || []).map((l) => ({ location_id: l.location && l.location.id, location_name: l.location && l.location.name, available: ((l.quantities || []).find((x) => x.name === "available") || {}).quantity ?? null })),
        })),
      };
    },
  });

  readTool({
    name: "shopify.collections.list",
    description: "Kolleksiyaların siyahısı (maks 20).",
    inputSchema: obj({ query: str(200), limit: { type: "integer", minimum: 1, maximum: 20 } }),
    outputSchema: { type: "object", required: ["collections"], properties: { collections: { type: "array" } } },
    async handler(input) {
      const d = await client.query(Q_COLLECTIONS, { first: input.limit || 10, query: cleanQuery(input.query) || null });
      return { collections: ((d.collections && d.collections.nodes) || []).map((c) => ({ id: c.id, title: c.title, handle: c.handle, products_count: c.productsCount ? c.productsCount.count : null })) };
    },
  });

  readTool({
    name: "shopify.webhooks.list",
    description: "Mağazada qeydiyyatlı webhook abunəlikləri.",
    inputSchema: obj({}),
    outputSchema: { type: "object", required: ["webhooks"], properties: { webhooks: { type: "array" } } },
    async handler() {
      const d = await client.query(Q_WEBHOOKS, {});
      return { webhooks: ((d.webhookSubscriptions && d.webhookSubscriptions.nodes) || []).map((w) => ({ id: w.id, topic: w.topic, uri: w.uri })) };
    },
  });

  // Yan təsirsiz, təsdiqsiz: ideyanı yoxlanmış qaralamaya çevirir
  registry.register({
    name: "shopify.product.prepare",
    description: "Məhsul ideyasını (ad, təsvir, qiymət...) yoxlanmış və normallaşmış Shopify qaralamasına çevirir. Şəbəkə və yan təsir yoxdur. Çatışmayan sahələr `missing`-də bildirilir, uydurulmur.",
    inputSchema: obj({
      name: str(400), title: str(400), description: str(20000), descriptionHtml: str(20000), handle: str(200),
      price: {}, currency: str(10), images: { type: "array", maxItems: 30 }, variants: { type: "array", maxItems: 50 },
      inventory: {}, tags: {}, category: str(255), productType: str(255), vendor: str(255), seo: { type: "object" },
    }),
    outputSchema: { type: "object", required: ["title", "handle", "descriptionHtml", "variants", "seo", "issues", "missing", "ready"], properties: { title: { type: "string" }, handle: { type: "string" }, descriptionHtml: { type: "string" }, variants: { type: "array" }, seo: { type: "object" }, issues: { type: "array" }, missing: { type: "array" }, ready: { type: "boolean" } } },
    permissions: [],
    risk: "low",
    requiresApproval: false,
    timeoutMs: 5000,
    async handler(input) {
      return prepareProduct(input);
    },
  });

  // ---- YAZMA (hamısı təsdiqlə) -------------------------------------------------------------------------
  const writeTool = (def) => registry.register({ risk: "high", requiresApproval: true, timeoutMs: 55000, retries: 0, handler: noExec, ...def });

  // 1) Məhsul yaratma
  writeTool({
    name: "shopify.product.create",
    description: "Shopify-da YENİ məhsul yaradır (shopify.product.prepare qaralaması ilə). Status həmişə DRAFT, yalnız təsdiqlənmiş sorğuda açıq ACTIVE yazılıbsa ACTIVE. Eyni handle/başlıq varsa CONFLICT.",
    inputSchema: obj({
      draft: { type: "object", required: ["title", "handle"], properties: { title: str(400, 1), handle: str(200, 1), descriptionHtml: { type: "string" }, variants: { type: "array" }, images: { type: "array" }, tags: { type: "array" }, seo: { type: "object" } } },
      status: { type: "string", enum: ["DRAFT", "ACTIVE"] },
      locationId: idStr,
    }, ["draft"]),
    outputSchema: { type: "object", required: ["product", "verified"], properties: { product: { type: "object" }, verified: { type: "boolean" } } },
    auditEvent: "shopify.product.create",
    approval: {
      kind: "shopify.product.create",
      describe: describeCreate,
      build(input) {
        const d = prepareProduct(input.draft);
        if (!d.ready) bad("Qaralama hazır deyil: " + [...d.missing.filter((m) => m !== "description" && m !== "images"), ...d.issues.filter((x) => x.severity === "error").map((x) => x.message)].join("; ").slice(0, 300));
        const status = input.status === "ACTIVE" ? "ACTIVE" : "DRAFT";
        const out = { draft: pickDraft(d), status };
        if (d.inventory !== null) {
          if (!input.locationId) bad("Stok verilib, amma stok yeri (locationId) yoxdur");
          out.locationId = toGid("location", input.locationId);
        }
        const payload = { input: out };
        return { content: describeCreate(payload).slice(0, 4000), payload };
      },
      async execute(input, ctx) {
        const dd = prepareProduct(input.draft);
        if (!dd.ready) throw new AppError("VALIDATION_ERROR", "Qaralama artıq etibarlı deyil", { source: "shopify" });
        const d = pickDraft(dd);
        const status = input.status === "ACTIVE" ? "ACTIVE" : "DRAFT";
        await assertShopCurrency(client, d.currency);
        const dups = await findDuplicates(client, { handle: d.handle, title: d.title });
        if (dups.length) throw mismatch("Eyni handle və ya başlıqla məhsul artıq var", dups.slice(0, 3).map((x) => x.handle + " (" + x.id + ", " + x.status + ")").join(", "));

        const multi = d.variants.length > 1;
        const product = { title: d.title, handle: d.handle, status, descriptionHtml: d.descriptionHtml, tags: d.tags };
        if (d.vendor) product.vendor = d.vendor;
        if (d.productType) product.productType = d.productType;
        const seo = {};
        if (d.seo.title) seo.title = d.seo.title;
        if (d.seo.description) seo.description = d.seo.description;
        if (Object.keys(seo).length) product.seo = seo;
        if (multi) product.productOptions = [{ name: OPTION_NAME, values: [{ name: d.variants[0].title }] }];
        const media = d.images.length ? d.images.map((u) => ({ originalSource: u, mediaContentType: "IMAGE", alt: d.title.slice(0, 120) })) : null;

        const created = await client.mutate(M_PRODUCT_CREATE, { product, media }, "productCreate");
        const p = created.product;
        if (!p || !p.id) throw new AppError("PROVIDER_ERROR", "Shopify məhsul id-si qaytarmadı", { source: "shopify" });
        const step = { n: "yaratma" };
        try {
          const v0 = p.variants && p.variants.nodes && p.variants.nodes[0];
          if (!v0) throw new AppError("PROVIDER_ERROR", "Əsas variant tapılmadı", { source: "shopify" });
          const first = d.variants.length ? d.variants[0] : { price: d.price, sku: null };
          const item = {};
          if (first.sku) item.sku = first.sku;
          if (d.inventory !== null) item.tracked = true;
          const v0in = { id: v0.id, price: first.price };
          if (Object.keys(item).length) v0in.inventoryItem = item;
          step.n = "əsas variantın qiyməti";
          await client.mutate(M_VARIANTS_UPDATE, { productId: p.id, variants: [v0in] }, "productVariantsBulkUpdate");
          if (multi) {
            step.n = "əlavə variantlar";
            const rest = d.variants.slice(1).map((v) => {
              const o = { price: v.price, optionValues: [{ optionName: OPTION_NAME, name: v.title }] };
              if (v.sku) o.inventoryItem = { sku: v.sku };
              return o;
            });
            await client.mutate(M_VARIANTS_CREATE, { productId: p.id, variants: rest }, "productVariantsBulkCreate");
          }
          if (d.inventory !== null) {
            step.n = "stok";
            const itemId = v0.inventoryItem && v0.inventoryItem.id;
            if (!itemId) throw new AppError("PROVIDER_ERROR", "Stok vahidi tapılmadı", { source: "shopify" });
            await setInitialInventory(itemId, input.locationId, d.inventory);
          }
        } catch (e) {
          const err = toAppError(e, "shopify");
          throw new AppError("PROVIDER_ERROR", "Məhsul yaradıldı (" + p.id + ", status " + status + "), amma «" + step.n + "» addımı alınmadı: " + err.message + " [" + err.code + "]. Shopify admin-də yoxlayın, təkrar yaratmayın.", { source: "shopify", retryable: false });
        }

        // Geri oxuma yoxlaması
        const back = await getProduct(client, p.id);
        const diffs = [];
        if (back.title !== d.title) diffs.push("başlıq");
        if (back.handle !== d.handle) diffs.push("handle (" + back.handle + ")");
        if (back.status !== status) diffs.push("status (" + back.status + ")");
        if (!sameSet(back.tags, d.tags)) diffs.push("etiketlər");
        if (d.seo.title && back.seo && back.seo.title !== d.seo.title) diffs.push("seo.title");
        if (d.descriptionHtml && !htmlToText(back.descriptionHtml)) diffs.push("təsvir boşdur");
        const want = d.variants.length > 1 ? d.variants : [{ title: null, price: d.variants.length === 1 ? d.variants[0].price : d.price, sku: d.variants.length === 1 ? d.variants[0].sku : null }];
        if (back.variants.length !== want.length) diffs.push("variant sayı " + back.variants.length + " != " + want.length);
        else {
          want.forEach((w, i) => {
            const bv = w.title === null ? back.variants[i] : back.variants.find((x) => x.title === w.title);
            if (!bv) diffs.push("variant tapılmadı: " + w.title);
            else {
              if (!sameCents(bv.price, w.price)) diffs.push("qiymət " + bv.price + " != " + w.price);
              if (w.sku && bv.sku !== w.sku) diffs.push("sku");
            }
          });
        }
        if (d.inventory !== null) {
          const lv = await getInventoryLevel(client, back.variants[0].inventoryItemId, input.locationId);
          if (lv.available !== d.inventory) diffs.push("stok " + lv.available + " != " + d.inventory);
        }
        if (diffs.length) throw readbackFail("yaratma", diffs, p.id);
        return { product: brief(back), verified: true, images: { requested: d.images.length, attached: back.mediaCount === undefined ? null : back.mediaCount, note: d.images.length ? "Şəkillər Shopify tərəfindən asinxron emal olunur" : undefined } };
      },
    },
  });

  // Stok qurma (yaratma və inventory.set üçün ortaq): yer aktiv deyilsə aktivləşdirir, CAS ilə yazır, geri oxuyur
  async function setInitialInventory(itemId, locationId, qty) {
    let lv = await getInventoryLevel(client, itemId, locationId);
    if (!lv.levelId) {
      await client.mutate(M_INVENTORY_ACTIVATE, { inventoryItemId: itemId, locationId }, "inventoryActivate");
      lv = await getInventoryLevel(client, itemId, locationId);
      if (!lv.levelId) throw new AppError("PROVIDER_ERROR", "Stok yeri aktivləşdirilə bilmədi", { source: "shopify" });
    }
    await writeInventory(itemId, locationId, lv.available === null ? 0 : lv.available, qty);
    const after = await getInventoryLevel(client, itemId, locationId);
    if (after.available !== qty) throw readbackFail("stok", ["stok " + after.available + " != " + qty]);
  }

  async function writeInventory(itemId, locationId, oldQty, newQty) {
    const data = await client.query(M_INVENTORY_SET, { input: { name: "available", reason: "correction", quantities: [{ inventoryItemId: itemId, locationId, quantity: newQty, changeFromQuantity: oldQty }] } });
    const pl = data.inventorySetQuantities;
    if (pl && Array.isArray(pl.userErrors) && pl.userErrors.some((u) => /change.?from|compare|mismatch|stale/i.test(String((u.code || "") + " " + (u.message || ""))))) throw mismatch("Stok artıq dəyişib (Shopify müqayisəsi uyğun gəlmir)");
    assertNoUserErrors(pl, "inventorySetQuantities");
  }

  // 2) Məhsul yeniləmə (köhnə dəyərlər payload-dadır)
  writeTool({
    name: "shopify.product.update",
    description: "Mövcud məhsulun başlığı, təsviri, satıcısı, növü, etiketləri və SEO sahələrini dəyişir. `before` təsdiqlənmiş köhnə dəyərlərdir: cari vəziyyət uyğun gəlməsə CONFLICT. Status/qiymət/stok burada dəyişmir.",
    inputSchema: obj({
      id: idStr,
      product_title: str(255),
      changes: { type: "object", additionalProperties: false, properties: { title: str(400), descriptionHtml: str(20000), vendor: str(400), productType: str(400), tags: { type: "array", maxItems: 40 }, seoTitle: str(200), seoDescription: str(400) } },
      before: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, descriptionHtml: { type: "string" }, vendor: { type: "string" }, productType: { type: "string" }, tags: { type: "array" }, seoTitle: { type: "string" }, seoDescription: { type: "string" } } },
    }, ["id", "changes", "before"]),
    outputSchema: { type: "object", required: ["product", "verified"], properties: { product: { type: "object" }, verified: { type: "boolean" } } },
    auditEvent: "shopify.product.update",
    approval: {
      kind: "shopify.product.update",
      describe: describeUpdate,
      build(input) {
        const ch = normChanges(input.changes);
        const keys = Object.keys(ch);
        if (!keys.length) bad("Dəyişiklik yoxdur");
        const before = {};
        for (const k of keys) {
          if (input.before[k] === undefined) bad("«before." + k + "» (köhnə dəyər) məcburidir");
          before[k] = input.before[k];
          if (k === "tags" ? sameList(before[k], ch[k]) : before[k] === ch[k]) bad(k + ": yeni dəyər köhnə ilə eynidir");
        }
        const out = { id: toGid("product", input.id), changes: ch, before };
        if (input.product_title) out.product_title = input.product_title;
        const payload = { input: out };
        return { content: describeUpdate(payload).slice(0, 4000), payload };
      },
      async execute(input) {
        const cur = await getProduct(client, input.id);
        if (input.product_title && cur.title !== input.product_title) throw mismatch("Məhsulun adı təsdiqdəkindən fərqlidir", cur.title);
        const curView = { title: cur.title, descriptionHtml: cur.descriptionHtml || "", vendor: cur.vendor || "", productType: cur.productType || "", tags: cur.tags || [], seoTitle: (cur.seo && cur.seo.title) || "", seoDescription: (cur.seo && cur.seo.description) || "" };
        const stale = Object.keys(input.changes).filter((k) => (k === "tags" ? !sameList(curView.tags, input.before.tags) : curView[k] !== input.before[k]));
        if (stale.length) throw mismatch("Məhsul təsdiqdən sonra dəyişib", stale.join(", "));
        const ch = input.changes;
        const pin = { id: input.id };
        if (ch.title !== undefined) pin.title = ch.title;
        if (ch.descriptionHtml !== undefined) pin.descriptionHtml = ch.descriptionHtml;
        if (ch.vendor !== undefined) pin.vendor = ch.vendor;
        if (ch.productType !== undefined) pin.productType = ch.productType;
        if (ch.tags !== undefined) pin.tags = ch.tags;
        if (ch.seoTitle !== undefined || ch.seoDescription !== undefined) {
          pin.seo = {};
          if (ch.seoTitle !== undefined) pin.seo.title = ch.seoTitle;
          if (ch.seoDescription !== undefined) pin.seo.description = ch.seoDescription;
        }
        await client.mutate(M_PRODUCT_UPDATE, { product: pin }, "productUpdate");
        const back = await getProduct(client, input.id);
        const diffs = [];
        if (ch.title !== undefined && back.title !== ch.title) diffs.push("title");
        if (ch.vendor !== undefined && (back.vendor || "") !== ch.vendor) diffs.push("vendor");
        if (ch.productType !== undefined && (back.productType || "") !== ch.productType) diffs.push("productType");
        if (ch.tags !== undefined && !sameSet(back.tags, ch.tags)) diffs.push("tags");
        if (ch.seoTitle !== undefined && ((back.seo && back.seo.title) || "") !== ch.seoTitle) diffs.push("seoTitle");
        if (ch.seoDescription !== undefined && ((back.seo && back.seo.description) || "") !== ch.seoDescription) diffs.push("seoDescription");
        if (ch.descriptionHtml !== undefined && htmlToText(back.descriptionHtml) !== htmlToText(ch.descriptionHtml)) diffs.push("descriptionHtml");
        if (diffs.length) throw readbackFail("yeniləmə", diffs, input.id);
        return { product: brief(back), verified: true };
      },
    },
  });

  // 3) Qiymət dəyişmə
  writeTool({
    name: "shopify.price.update",
    description: "Variant qiymətlərini dəyişir. Hər variant üçün təsdiqlənmiş köhnə qiymət (old_price) göstərilməlidir: cari qiymət uyğun gəlməsə CONFLICT.",
    inputSchema: obj({
      productId: idStr,
      product_title: str(255),
      currency: str(10),
      variants: { type: "array", maxItems: 20, items: obj({ id: idStr, title: str(100), old_price: {}, new_price: {} }, ["id", "old_price", "new_price"]) },
    }, ["productId", "variants"]),
    outputSchema: { type: "object", required: ["product", "verified"], properties: { product: { type: "object" }, verified: { type: "boolean" } } },
    permissions: ["change.price"],
    auditEvent: "shopify.price.update",
    approval: {
      kind: "shopify.price.update",
      describe: describePrice,
      build(input) {
        if (!input.variants.length) bad("Variant siyahısı boşdur");
        const seen = new Set();
        const variants = input.variants.map((v) => {
          const id = toGid("variant", v.id);
          if (seen.has(id)) bad("Variant təkrarlanır: " + id);
          seen.add(id);
          const o = { id, old_price: money(v.old_price, "old_price"), new_price: money(v.new_price, "new_price") };
          if (o.old_price === o.new_price) bad(id + ": yeni qiymət köhnə ilə eynidir");
          if (v.title) o.title = v.title;
          return o;
        });
        const out = { productId: toGid("product", input.productId), variants };
        if (input.currency) out.currency = String(input.currency).toUpperCase();
        if (input.product_title) out.product_title = input.product_title;
        const payload = { input: out };
        return { content: describePrice(payload).slice(0, 4000), payload };
      },
      async execute(input) {
        await assertShopCurrency(client, input.currency);
        const cur = await getProduct(client, input.productId);
        if (input.product_title && cur.title !== input.product_title) throw mismatch("Məhsulun adı təsdiqdəkindən fərqlidir", cur.title);
        for (const v of input.variants) {
          const cv = cur.variants.find((x) => x.id === v.id);
          if (!cv) throw new AppError("NOT_FOUND", "Variant bu məhsulda tapılmadı: " + v.id, { source: "shopify" });
          if (!sameCents(cv.price, v.old_price)) throw mismatch("Qiymət təsdiqdən sonra dəyişib (" + v.id + ")", "indi " + cv.price + ", təsdiqdə " + v.old_price);
        }
        await client.mutate(M_VARIANTS_UPDATE, { productId: input.productId, variants: input.variants.map((v) => ({ id: v.id, price: v.new_price })) }, "productVariantsBulkUpdate");
        const back = await getProduct(client, input.productId);
        const diffs = input.variants.filter((v) => { const bv = back.variants.find((x) => x.id === v.id); return !bv || !sameCents(bv.price, v.new_price); }).map((v) => v.id + " != " + v.new_price);
        if (diffs.length) throw readbackFail("qiymət", diffs, input.productId);
        return { product: brief(back), verified: true, changes: input.variants.map((v) => ({ variant_id: v.id, old: v.old_price, new: v.new_price })) };
      },
    },
  });

  // 4) Stok dəyişmə
  writeTool({
    name: "shopify.inventory.set",
    description: "Bir yerdə (location) bir stok vahidinin mövcud (available) sayını təyin edir. old_quantity təsdiqlənmiş köhnə saydır: cari say uyğun gəlməsə CONFLICT.",
    inputSchema: obj({
      inventoryItemId: idStr, locationId: idStr, old_quantity: { type: "integer", minimum: 0, maximum: LIMITS.inventory }, new_quantity: { type: "integer", minimum: 0, maximum: LIMITS.inventory },
      product_title: str(255), location_name: str(100),
    }, ["inventoryItemId", "locationId", "old_quantity", "new_quantity"]),
    outputSchema: { type: "object", required: ["inventory", "verified"], properties: { inventory: { type: "object" }, verified: { type: "boolean" } } },
    permissions: ["change.stock"],
    auditEvent: "shopify.inventory.set",
    approval: {
      kind: "shopify.inventory.set",
      describe: describeInventory,
      build(input) {
        if (input.old_quantity === input.new_quantity) bad("Yeni say köhnə ilə eynidir");
        const out = { inventoryItemId: toGid("inventoryItem", input.inventoryItemId), locationId: toGid("location", input.locationId), old_quantity: input.old_quantity, new_quantity: input.new_quantity };
        if (input.product_title) out.product_title = input.product_title;
        if (input.location_name) out.location_name = input.location_name;
        const payload = { input: out };
        return { content: describeInventory(payload).slice(0, 4000), payload };
      },
      async execute(input) {
        const lv = await getInventoryLevel(client, input.inventoryItemId, input.locationId);
        if (!lv.levelId) throw new AppError("NOT_FOUND", "Bu yerdə bu stok vahidi üçün stok qeydi yoxdur", { source: "shopify" });
        if (!lv.tracked) throw new AppError("VALIDATION_ERROR", "Bu stok vahidində izləmə (tracked) söndürülüb", { source: "shopify" });
        if (lv.available !== input.old_quantity) throw mismatch("Stok təsdiqdən sonra dəyişib", "indi " + lv.available + ", təsdiqdə " + input.old_quantity);
        await writeInventory(input.inventoryItemId, input.locationId, input.old_quantity, input.new_quantity);
        const after = await getInventoryLevel(client, input.inventoryItemId, input.locationId);
        if (after.available !== input.new_quantity) throw readbackFail("stok", ["stok " + after.available + " != " + input.new_quantity], input.inventoryItemId);
        return { inventory: { inventory_item_id: input.inventoryItemId, location_id: input.locationId, old: input.old_quantity, new: after.available }, verified: true };
      },
    },
  });

  // 5) Satışa çıxarma
  writeTool({
    name: "shopify.product.publish",
    description: "Məhsulun statusunu ACTIVE edir (satışa çıxarır). expected_status cari statusla uyğun olmalıdır. Qiyməti 0 olan variant varsa rədd edir.",
    inputSchema: obj({ id: idStr, expected_status: { type: "string", enum: ["DRAFT", "ARCHIVED"] }, product_title: str(255) }, ["id", "expected_status"]),
    outputSchema: { type: "object", required: ["product", "verified"], properties: { product: { type: "object" }, verified: { type: "boolean" } } },
    auditEvent: "shopify.product.publish",
    approval: {
      kind: "shopify.product.publish",
      describe: describePublish,
      build(input) {
        const out = { id: toGid("product", input.id), expected_status: input.expected_status };
        if (input.product_title) out.product_title = input.product_title;
        const payload = { input: out };
        return { content: describePublish(payload).slice(0, 4000), payload };
      },
      async execute(input) {
        const cur = await getProduct(client, input.id);
        if (input.product_title && cur.title !== input.product_title) throw mismatch("Məhsulun adı təsdiqdəkindən fərqlidir", cur.title);
        if (cur.status !== input.expected_status) throw mismatch("Məhsulun statusu dəyişib", "indi " + cur.status + ", təsdiqdə " + input.expected_status);
        if (!cur.variants.length || cur.variants.some((v) => !(centsOf(v.price) > 0))) throw new AppError("VALIDATION_ERROR", "Qiyməti 0 və ya boş olan variant var, satışa çıxarmaq olmaz", { source: "shopify" });
        await client.mutate(M_PRODUCT_UPDATE, { product: { id: input.id, status: "ACTIVE" } }, "productUpdate");
        const back = await getProduct(client, input.id);
        if (back.status !== "ACTIVE") throw readbackFail("status", ["status " + back.status], input.id);
        return { product: brief(back), verified: true };
      },
    },
  });

  // 6) Arxivləmə (SİLMƏ DEYİL)
  writeTool({
    name: "shopify.product.archive",
    description: "Məhsulu ARXİVLƏYİR (status ARCHIVED). Məhsul SİLİNMİR, geri qaytarıla bilər. Silmə aləti mövcud deyil.",
    inputSchema: obj({ id: idStr, expected_status: { type: "string", enum: ["ACTIVE", "DRAFT"] }, product_title: str(255) }, ["id", "expected_status"]),
    outputSchema: { type: "object", required: ["product", "verified"], properties: { product: { type: "object" }, verified: { type: "boolean" } } },
    auditEvent: "shopify.product.archive",
    approval: {
      kind: "shopify.product.archive",
      describe: describeArchive,
      build(input) {
        const out = { id: toGid("product", input.id), expected_status: input.expected_status };
        if (input.product_title) out.product_title = input.product_title;
        const payload = { input: out };
        return { content: describeArchive(payload).slice(0, 4000), payload };
      },
      async execute(input) {
        const cur = await getProduct(client, input.id);
        if (input.product_title && cur.title !== input.product_title) throw mismatch("Məhsulun adı təsdiqdəkindən fərqlidir", cur.title);
        if (cur.status !== input.expected_status) throw mismatch("Məhsulun statusu dəyişib", "indi " + cur.status + ", təsdiqdə " + input.expected_status);
        await client.mutate(M_PRODUCT_UPDATE, { product: { id: input.id, status: "ARCHIVED" } }, "productUpdate");
        const back = await getProduct(client, input.id);
        if (back.status !== "ARCHIVED") throw readbackFail("status", ["status " + back.status], input.id);
        return { product: brief(back), verified: true };
      },
    },
  });

  // 7) Kolleksiyaya əlavə
  writeTool({
    name: "shopify.collection.add",
    description: "Məhsulları (maks 20) mövcud (əl ilə idarə olunan) kolleksiyaya əlavə edir. Artıq üzv olanlar atlanır, nəticə geri oxunub yoxlanır.",
    inputSchema: obj({ collectionId: idStr, productIds: { type: "array", minItems: 1, maxItems: 20, items: idStr }, collection_title: str(255) }, ["collectionId", "productIds"]),
    outputSchema: { type: "object", required: ["collection_id", "members", "verified"], properties: { collection_id: { type: "string" }, members: { type: "array" }, verified: { type: "boolean" } } },
    auditEvent: "shopify.collection.add",
    approval: {
      kind: "shopify.collection.add",
      describe: describeCollection,
      async build(input) {
        if (!input.productIds.length) bad("Məhsul siyahısı boşdur");
        const ids = [...new Set(input.productIds.map((x) => toGid("product", x)))];
        const out = { collectionId: toGid("collection", input.collectionId), productIds: ids };
        // Kolleksiyanın REAL adı Shopify-dan oxunur və təsdiq mətnində göstərilir (istifadəçi mətninə etibar edilmir)
        const info = await client.query(Q_COLLECTION_INFO, { id: out.collectionId });
        if (!info.collection) bad("Kolleksiya tapılmadı: " + out.collectionId);
        if (info.collection.ruleSet) bad("Bu avtomatik (qaydalı) kolleksiyadır, əl ilə məhsul əlavə edilə bilməz");
        if (input.collection_title && input.collection_title !== info.collection.title) bad("Verilən kolleksiya adı real adla uyğun gəlmir: real ad «" + info.collection.title + "»");
        out.collection_title = info.collection.title;
        const payload = { input: out };
        return { content: describeCollection(payload).slice(0, 4000), payload };
      },
      async execute(input) {
        const member = async (pid) => {
          const d = await client.query(Q_PRODUCT_COLLECTIONS, { id: pid });
          if (!d.product) throw new AppError("NOT_FOUND", "Məhsul tapılmadı: " + pid, { source: "shopify" });
          return ((d.product.collections && d.product.collections.nodes) || []).some((c) => c.id === input.collectionId);
        };
        // Yazmadan ƏVVƏL: kolleksiya hələ təsdiqdəki kolleksiyadır (ad dəyişibsə və ya avtomatikə çevrilibsə heç nə yazılmır)
        const info = await client.query(Q_COLLECTION_INFO, { id: input.collectionId });
        if (!info.collection) throw new AppError("NOT_FOUND", "Kolleksiya tapılmadı", { source: "shopify" });
        if (info.collection.ruleSet) throw mismatch("Kolleksiya avtomatikdir, heç nə yazılmadı");
        if (input.collection_title && info.collection.title !== input.collection_title) throw mismatch("Kolleksiyanın adı təsdiqdəkindən fərqlidir, heç nə yazılmadı", info.collection.title);
        const toAdd = [];
        for (const pid of input.productIds) if (!(await member(pid))) toAdd.push(pid);
        if (toAdd.length) {
          const r = await client.mutate(M_COLLECTION_ADD, { id: input.collectionId, productIds: toAdd }, "collectionAddProducts");
          if (input.collection_title && r.collection && r.collection.title !== input.collection_title) throw mismatch("Kolleksiyanın adı təsdiqdəkindən fərqlidir (əlavə artıq icra olundu)", r.collection.title);
        }
        const diffs = [];
        for (const pid of input.productIds) if (!(await member(pid))) diffs.push(pid);
        if (diffs.length) throw readbackFail("kolleksiya", diffs.map((x) => x + " üzv deyil"), input.collectionId);
        return { collection_id: input.collectionId, members: input.productIds, added: toAdd, verified: true };
      },
    },
  });

  // 8) Webhook abunəlikləri (yalnız sahibin açıq tələbi ilə)
  writeTool({
    name: "shopify.webhooks.register",
    description: "Shopify webhook abunəliklərini <PUBLIC_BASE_URL>/shopify/webhook ünvanına yaradır. Yalnız bildiriş: qəbul olunan webhook heç bir əməliyyat icra etmir.",
    inputSchema: obj({ topics: { type: "array", maxItems: 10, items: str(40, 3) } }),
    outputSchema: { type: "object", required: ["created", "already", "verified"], properties: { created: { type: "array" }, already: { type: "array" }, verified: { type: "boolean" } } },
    auditEvent: "shopify.webhooks.register",
    approval: {
      kind: "shopify.webhooks.register",
      describe: describeWebhooks(env),
      build(input) {
        const topics = [...new Set(input.topics && input.topics.length ? input.topics : Object.keys(WEBHOOK_TOPICS))];
        for (const t of topics) if (!Object.prototype.hasOwnProperty.call(WEBHOOK_TOPICS, t)) bad("Dəstəklənməyən topic: " + String(t).slice(0, 40));
        const payload = { input: { topics } };
        return { content: describeWebhooks(env)(payload).slice(0, 4000), payload };
      },
      async execute(input) {
        const r = await registerShopifyWebhooks({ client, env, topics: input.topics });
        return { ...r, verified: true };
      },
    },
  });

  return registry;
}

// ---------------------------------------------------------------------------------------------------
// product.update köməkçiləri
const sameList = (a, b) => JSON.stringify([...(a || [])].map(String).sort()) === JSON.stringify([...(b || [])].map(String).sort());

function normChanges(c) {
  const out = {};
  if (c.title !== undefined) {
    const t = cleanLine(c.title);
    if (!t || t.length > LIMITS.title) bad("title düzgün deyil");
    out.title = t;
  }
  if (c.descriptionHtml !== undefined) {
    const h = normalizeDescription(c.descriptionHtml);
    if (h.length > LIMITS.description) bad("təsvir çox uzundur");
    out.descriptionHtml = h;
  }
  if (c.vendor !== undefined) out.vendor = cleanLine(c.vendor).slice(0, LIMITS.title);
  if (c.productType !== undefined) out.productType = cleanLine(c.productType).slice(0, LIMITS.title);
  if (c.tags !== undefined) out.tags = normalizeTags(c.tags);
  if (c.seoTitle !== undefined) {
    const t = cleanLine(c.seoTitle);
    if (t.length > LIMITS.seoTitle) bad("seoTitle " + LIMITS.seoTitle + " simvoldan uzundur");
    out.seoTitle = t;
  }
  if (c.seoDescription !== undefined) {
    const t = cleanLine(c.seoDescription);
    if (t.length > LIMITS.seoDescription) bad("seoDescription " + LIMITS.seoDescription + " simvoldan uzundur");
    out.seoDescription = t;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Söhbət axını üçün köməkçilər: cari vəziyyəti OXUYUR, sonra təsdiq qeydi AÇIR (heç nə icra etmir).

// idea -> prepare -> (təkrar yoxlama) -> shopify.product.create təsdiq qeydi
export async function proposeCreateFromIdea({ registry, client = null, idea, ctx = {}, status, locationId, precheck = true }) {
  const draft = prepareProduct(idea);
  if (!draft.ready) return { ok: false, stage: "prepare", draft, reason: "Qaralama hazır deyil" };
  if (client && precheck) {
    const dups = await findDuplicates(client, { handle: draft.handle, title: draft.title });
    if (dups.length) return { ok: false, stage: "duplicate", draft, duplicates: dups, error: { code: "CONFLICT", message: "Eyni handle və ya başlıqla məhsul artıq var" } };
  }
  let loc = locationId;
  if (draft.inventory !== null && !loc && client) {
    try {
      const d = await client.query(Q_LOCATIONS, {});
      const active = ((d.locations && d.locations.nodes) || []).filter((l) => l.isActive !== false);
      if (active.length === 1) loc = active[0].id;
    } catch (e) {
      loc = undefined;
    }
  }
  if (draft.inventory !== null && !loc) return { ok: false, stage: "location", draft, reason: "Stok üçün yer (locationId) təyin edilməyib və avtomatik tapılmadı" };
  const input = { draft: pickDraft(draft) };
  if (status === "ACTIVE") input.status = "ACTIVE";
  if (loc) input.locationId = loc;
  const r = await registry.run("shopify.product.create", input, ctx);
  return { ok: r.status === "pending_approval", draft, result: r, approval_id: r.approval_id || null };
}

export async function proposePriceUpdate({ registry, client, productId, prices, ctx = {} }) {
  const cur = await getProduct(client, toGid("product", productId));
  const variants = prices.map((p) => {
    const cv = cur.variants.find((v) => v.id === toGid("variant", p.variantId));
    if (!cv) throw new AppError("NOT_FOUND", "Variant tapılmadı: " + p.variantId, { source: "shopify" });
    return { id: cv.id, title: cv.title.slice(0, 100), old_price: cv.price, new_price: p.newPrice };
  });
  return await registry.run("shopify.price.update", { productId: cur.id, product_title: cur.title.slice(0, 255), variants }, ctx);
}

export async function proposeInventorySet({ registry, client, inventoryItemId, locationId, newQuantity, ctx = {} }) {
  const lv = await getInventoryLevel(client, toGid("inventoryItem", inventoryItemId), toGid("location", locationId));
  if (!lv.levelId || lv.available === null) throw new AppError("NOT_FOUND", "Bu yerdə stok qeydi yoxdur", { source: "shopify" });
  return await registry.run("shopify.inventory.set", { inventoryItemId: toGid("inventoryItem", inventoryItemId), locationId: toGid("location", locationId), old_quantity: lv.available, new_quantity: newQuantity }, ctx);
}

export async function proposeProductUpdate({ registry, client, id, changes, ctx = {} }) {
  const cur = await getProduct(client, toGid("product", id));
  const view = { title: cur.title, descriptionHtml: cur.descriptionHtml || "", vendor: cur.vendor || "", productType: cur.productType || "", tags: cur.tags || [], seoTitle: (cur.seo && cur.seo.title) || "", seoDescription: (cur.seo && cur.seo.description) || "" };
  const before = {};
  for (const k of Object.keys(changes)) before[k] = view[k];
  return await registry.run("shopify.product.update", { id: cur.id, product_title: cur.title.slice(0, 255), changes, before }, ctx);
}

export async function proposePublish({ registry, client, id, ctx = {} }) {
  const cur = await getProduct(client, toGid("product", id));
  if (cur.status === "ACTIVE") throw mismatch("Məhsul artıq ACTIVE-dir");
  return await registry.run("shopify.product.publish", { id: cur.id, expected_status: cur.status, product_title: cur.title.slice(0, 255) }, ctx);
}

export async function proposeArchive({ registry, client, id, ctx = {} }) {
  const cur = await getProduct(client, toGid("product", id));
  if (cur.status === "ARCHIVED") throw mismatch("Məhsul artıq arxivdədir");
  return await registry.run("shopify.product.archive", { id: cur.id, expected_status: cur.status, product_title: cur.title.slice(0, 255) }, ctx);
}
