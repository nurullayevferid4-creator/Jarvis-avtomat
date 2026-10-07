// Shopify webhook qəbulu.
//
// QAYDA: webhook qəbul etmək YALNIZ audit/event qeydi deməkdir (və app/uninstalled-də tokenin silinməsi).
// Webhook gələndə heç bir biznes əməliyyatı (qiymət, stok, sifariş, mesaj) AVTOMATİK icra olunmur.
//
// Yoxlama sırası: konfiqurasiya -> ölçü -> HMAC (base64, sabit-vaxtlı) -> topic icazə siyahısı ->
// shop başlığı qoşulu mağaza ilə eyni -> webhook id -> təkrar (replay) qoruması.

import { AppError } from "../errors.js";
import { makeId } from "../state/store.js";
import { normalizeShopDomain, shopifyWebhookUri } from "./config.js";
import { fromBase64, hmacSha256, timingSafeEqualBytes } from "./crypto.js";
import { M_WEBHOOK_CREATE, Q_WEBHOOKS } from "./gql.js";

export const MAX_WEBHOOK_BYTES = 1024 * 1024; // 1 MB
export const WEBHOOK_TTL_SECONDS = 3 * 24 * 3600;
const EVENT_TTL_SECONDS = 30 * 24 * 3600;

// Topic icazə siyahısı -> GraphQL enum
export const WEBHOOK_TOPICS = {
  "products/update": "PRODUCTS_UPDATE",
  "products/create": "PRODUCTS_CREATE",
  "orders/create": "ORDERS_CREATE",
  "orders/updated": "ORDERS_UPDATED",
  "inventory_levels/update": "INVENTORY_LEVELS_UPDATE",
  "app/uninstalled": "APP_UNINSTALLED",
};

function header(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return String(headers[k] || "");
  return "";
}

function toBytes(raw) {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (typeof raw === "string") return new TextEncoder().encode(raw);
  return null;
}

// Qaytarır: { ok:true, topic, shop, webhookId } və ya { ok:false, reason, status }
export async function verifyShopifyWebhook(rawBodyBytes, headers, env, opts = {}) {
  const secret = String((env && env.SHOPIFY_API_SECRET) || "");
  if (!secret) return { ok: false, reason: "not_configured", status: 503 };
  const body = toBytes(rawBodyBytes);
  if (!body) return { ok: false, reason: "bad_body", status: 400 };
  if (body.byteLength > MAX_WEBHOOK_BYTES) return { ok: false, reason: "too_large", status: 413 };

  const given = fromBase64(header(headers, "x-shopify-hmac-sha256").trim());
  if (!given || given.length !== 32) return { ok: false, reason: "bad_hmac", status: 401 };
  const expected = await hmacSha256(secret, body);
  if (!timingSafeEqualBytes(given, expected)) return { ok: false, reason: "bad_hmac", status: 401 };

  // İmza düzgündür: bundan sonrakı rədd səbəbləri artıq autentifikasiya olunmuş sorğuya aiddir
  const topic = header(headers, "x-shopify-topic").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(WEBHOOK_TOPICS, topic)) return { ok: false, reason: "unknown_topic", status: 400 };
  const shop = normalizeShopDomain(header(headers, "x-shopify-shop-domain"));
  if (!shop) return { ok: false, reason: "bad_shop", status: 401 };
  if (opts.expectedShop && shop !== opts.expectedShop) return { ok: false, reason: "wrong_shop", status: 401 };
  const webhookId = header(headers, "x-shopify-webhook-id").trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(webhookId)) return { ok: false, reason: "bad_webhook_id", status: 400 };
  return { ok: true, topic, shop, webhookId, status: 200 };
}

// Yalnız qeydə alınan, minimal və şəxsi məlumatsız xülasə (tam yük SAXLANMIR)
function summarize(topic, payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const s = (v, n = 120) => (v === undefined || v === null ? undefined : String(v).slice(0, n));
  if (topic.startsWith("products/")) return { resource_id: s(p.id, 40), title: s(p.title), status: s(p.status, 20) };
  if (topic.startsWith("orders/")) return { resource_id: s(p.id, 40), name: s(p.name, 30), financial_status: s(p.financial_status, 30), fulfillment_status: s(p.fulfillment_status, 30) };
  if (topic === "inventory_levels/update") return { inventory_item_id: s(p.inventory_item_id, 40), location_id: s(p.location_id, 40), available: Number.isFinite(p.available) ? p.available : undefined };
  return {};
}

// rawBody: ArrayBuffer/Uint8Array (HMAC üçün olduğu kimi). Qaytarır: { ok, status, reason?, duplicate?, topic? }
export async function processShopifyWebhook({ rawBody, headers, env, store, vault, audit = null, coord = null, now = () => Date.now() }) {
  const rec = vault ? await vault.get("shopify") : null;
  const expectedShop = (rec && rec.shop) || (env.SHOPIFY_SHOP ? normalizeShopDomain(String(env.SHOPIFY_SHOP)) : null);
  if (!expectedShop) return { ok: false, status: 401, reason: "no_shop" };

  const v = await verifyShopifyWebhook(rawBody, headers, env, { expectedShop });
  if (!v.ok) {
    if (audit && v.reason !== "not_configured") await audit.log("shopify.webhook_rejected", { reason: v.reason });
    return { ok: false, status: v.status, reason: v.reason };
  }

  const key = "shwebhook:" + v.webhookId;
  if (await store.getRaw(key)) return { ok: true, status: 200, duplicate: true, topic: v.topic };
  if (coord && typeof coord.once === "function" && !(await coord.once(key, { ttlMs: WEBHOOK_TTL_SECONDS * 1000 }))) return { ok: true, status: 200, duplicate: true, topic: v.topic };
  await store.putRaw(key, { topic: v.topic, ts: now() }, WEBHOOK_TTL_SECONDS);

  try {
    let payload = null;
    try {
      payload = JSON.parse(new TextDecoder().decode(toBytes(rawBody)));
    } catch (e) {
      payload = null; // pozulmuş JSON: yenə də qəbul hadisəsi qeyd olunur
    }
    const info = summarize(v.topic, payload);
    const event = { id: makeId(now()), ts: new Date(now()).toISOString(), type: "shopify.webhook", topic: v.topic, shop: v.shop, webhook_id: v.webhookId, parsed: payload !== null, bytes: toBytes(rawBody).byteLength, ...info };
    await store.putDoc("event", event.id, event, EVENT_TTL_SECONDS);
    if (audit) await audit.log("shopify.webhook", { topic: v.topic, shop: v.shop, webhook_id: v.webhookId, ...info });
    if (v.topic === "app/uninstalled") {
      await vault.remove("shopify");
      if (audit) await audit.log("shopify.uninstalled", { shop: v.shop });
    }
  } catch (e) {
    await store.deleteRaw(key); // Shopify yenidən göndərə bilsin
    return { ok: false, status: 500, reason: "internal" };
  }
  return { ok: true, status: 200, topic: v.topic };
}

// webhookSubscriptionCreate dəyişənlərini qurur. HEÇ NƏ İCRA ETMİR.
export function buildWebhookMutations(env, topics = Object.keys(WEBHOOK_TOPICS)) {
  const uri = shopifyWebhookUri(env);
  return topics.map((t) => {
    if (!Object.prototype.hasOwnProperty.call(WEBHOOK_TOPICS, t)) throw new AppError("VALIDATION_ERROR", "Dəstəklənməyən webhook topic: " + String(t).slice(0, 40), { source: "shopify" });
    return { topic: t, document: M_WEBHOOK_CREATE, variables: { topic: WEBHOOK_TOPICS[t], webhookSubscription: { uri, format: "JSON" } } };
  });
}

// Yalnız sahibin açıq tələbi ilə (tool + təsdiq) çağırılır. Mövcud olanı təkrar yaratmır, sonda yoxlayır.
export async function registerShopifyWebhooks({ client, env, topics }) {
  const plan = buildWebhookMutations(env, topics);
  const uri = shopifyWebhookUri(env);
  const list = async () => {
    const d = await client.query(Q_WEBHOOKS, {});
    return ((d.webhookSubscriptions && d.webhookSubscriptions.nodes) || []).filter((n) => n && n.uri === uri).map((n) => n.topic);
  };
  const existing = new Set(await list());
  const created = [];
  const skipped = [];
  for (const p of plan) {
    if (existing.has(p.variables.topic)) { skipped.push(p.topic); continue; }
    await client.mutate(p.document, p.variables, "webhookSubscriptionCreate");
    created.push(p.topic);
  }
  const after = new Set(await list());
  const missing = plan.filter((p) => !after.has(p.variables.topic)).map((p) => p.topic);
  if (missing.length) throw new AppError("PROVIDER_ERROR", "Webhook yaradıldı, amma yoxlamada görünmür: " + missing.join(", "), { source: "shopify" });
  return { created, already: skipped, callback: uri };
}
