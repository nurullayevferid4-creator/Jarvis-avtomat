// Shopify oxuma əməliyyatları və normallaşdırma. Yazma alətləri bunlarla "köhnə dəyəri" oxuyur və nəticəni yoxlayır.

import { AppError } from "../errors.js";
import { Q_INVENTORY_LEVEL, Q_PRODUCT, Q_PRODUCTS, Q_SHOP } from "./gql.js";
import { slugify, transliterate } from "./prepare.js";

const GID_TYPES = { product: "Product", variant: "ProductVariant", collection: "Collection", inventoryItem: "InventoryItem", location: "Location", order: "Order" };

// Həm gid://shopify/Product/123, həm də 123 qəbul edilir; həmişə gid qaytarır.
export function toGid(kind, value) {
  const type = GID_TYPES[kind];
  if (!type) throw new Error("naməlum id növü");
  const s = String(value === undefined || value === null ? "" : value).trim();
  if (/^\d{1,20}$/.test(s)) return "gid://shopify/" + type + "/" + s;
  if (new RegExp("^gid://shopify/" + type + "/\\d{1,20}$").test(s)) return s;
  throw new AppError("VALIDATION_ERROR", kind + " id düzgün deyil (gid://shopify/" + type + "/... gözlənilir)", { source: "shopify" });
}

const num = (v) => (v === undefined || v === null ? null : Number(v));

export function normProduct(p) {
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    status: p.status,
    descriptionHtml: p.descriptionHtml === undefined ? undefined : p.descriptionHtml,
    vendor: p.vendor === undefined ? undefined : p.vendor,
    productType: p.productType === undefined ? undefined : p.productType,
    tags: Array.isArray(p.tags) ? p.tags : undefined,
    totalInventory: p.totalInventory === undefined ? undefined : num(p.totalInventory),
    mediaCount: p.mediaCount ? num(p.mediaCount.count) : undefined,
    seo: p.seo ? { title: p.seo.title || "", description: p.seo.description || "" } : undefined,
    variants: ((p.variants && p.variants.nodes) || []).map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku || null,
      price: v.price === undefined ? undefined : String(v.price),
      compareAtPrice: v.compareAtPrice === undefined || v.compareAtPrice === null ? null : String(v.compareAtPrice),
      inventoryItemId: v.inventoryItem ? v.inventoryItem.id : null,
      tracked: v.inventoryItem ? Boolean(v.inventoryItem.tracked) : null,
    })),
  };
}

export async function getProduct(client, id) {
  const d = await client.query(Q_PRODUCT, { id });
  if (!d.product) throw new AppError("NOT_FOUND", "Məhsul tapılmadı: " + String(id).slice(0, 60), { source: "shopify" });
  return normProduct(d.product);
}

export async function getShopInfo(client) {
  const d = await client.query(Q_SHOP, {});
  const s = d.shop || {};
  return { name: s.name, domain: s.myshopifyDomain, currency: s.currencyCode, timezone: s.ianaTimezone, url: (s.primaryDomain && s.primaryDomain.url) || null };
}

// Draft-da valyuta göstərilibsə mağaza valyutasına bərabər olmalıdır (Shopify qiyməti mağaza valyutasında saxlayır)
export async function assertShopCurrency(client, currency) {
  if (!currency) return;
  const s = await getShopInfo(client);
  if (s.currency && String(s.currency).toUpperCase() !== String(currency).toUpperCase()) {
    throw new AppError("VALIDATION_ERROR", "Valyuta uyğun deyil: sorğu " + currency + ", mağaza " + s.currency, { source: "shopify" });
  }
}

const normTitle = (t) => transliterate(String(t || "")).toLowerCase().replace(/[^a-z0-9]+/g, "");

// Eyni handle və ya eyni başlıqlı məhsulları qaytarır (arxivlənmişlər də daxil).
// Shopify axtarışı hərf/durğu işarəsinə həssasdır, ona görə üç sorğu: verilən handle, başlıqdan çıxarılan handle, başlıq ifadəsi.
export async function findDuplicates(client, { handle, title }) {
  const found = new Map();
  const run = async (q) => {
    const d = await client.query(Q_PRODUCTS, { first: 10, query: q });
    for (const n of (d.products && d.products.nodes) || []) found.set(n.id, n);
  };
  const h1 = handle ? slugify(handle) : "";
  const h2 = title ? slugify(title) : "";
  if (h1) await run("handle:" + h1);
  if (h2 && h2 !== h1) await run("handle:" + h2);
  const t = String(title || "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (t) await run('title:"' + t.slice(0, 120) + '"');
  const nt = normTitle(title);
  return [...found.values()]
    .filter((p) => (h1 && p.handle === h1) || (h2 && p.handle === h2) || (nt && normTitle(p.title) === nt))
    .map((p) => ({ id: p.id, title: p.title, handle: p.handle, status: p.status }));
}

// Stok səviyyəsi: { tracked, levelId, available } (səviyyə yoxdursa levelId null)
export async function getInventoryLevel(client, itemId, locationId) {
  const d = await client.query(Q_INVENTORY_LEVEL, { itemId, locationId });
  const it = d.inventoryItem;
  if (!it) throw new AppError("NOT_FOUND", "Stok vahidi tapılmadı", { source: "shopify" });
  const lvl = it.inventoryLevel;
  let available = null;
  if (lvl) {
    const q = (lvl.quantities || []).find((x) => x.name === "available");
    available = q ? Number(q.quantity) : null;
  }
  return { tracked: Boolean(it.tracked), levelId: lvl ? lvl.id : null, available };
}

export const sameCents = (a, b) => {
  const ca = centsOf(a);
  const cb = centsOf(b);
  return ca !== null && cb !== null && ca === cb;
};

export function centsOf(str) {
  const m = String(str === undefined || str === null ? "" : str).match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = (m[2] || "").replace(/0+$/, "");
  if (frac.length > 2) return null;
  return Number(m[1]) * 100 + Number((frac + "00").slice(0, 2));
}
