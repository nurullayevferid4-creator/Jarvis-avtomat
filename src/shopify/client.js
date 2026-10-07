// Shopify Admin GraphQL müştərisi.
//
// - Bütün HTTP çağırışı inyeksiya olunmuş fetchImpl ilə gedir (testlərdə saxta).
// - Token yalnız vault-dan oxunur, yalnız X-Shopify-Access-Token başlığına yazılır.
//   Xəta mətnlərinə, jurnala və cavaba düşmür (scrub ilə təmizlənir).
// - Domen hər dəfə sərt yoxlanır (SSRF): yalnız https://<ad>.myshopify.com
// - Xətalar vahid AppError kodlarına çevrilir. Yazma əməliyyatlarında avtomatik təkrar YOXDUR.
// - Throttle: cavabdakı extensions.cost.throttleStatus izlənir, balans azalıbsa növbəti sorğu gözləyir.

import { AppError } from "../errors.js";
import { assertSafeUrl } from "../security/ssrf.js";
import { getApiVersion, normalizeShopDomain } from "./config.js";

const LOW_WATER = 100; // bu qədər "nöqtə"dən azdırsa gözləyirik
const MAX_PAUSE_MS = 5000;
const MAX_RESPONSE_CHARS = 2_000_000;

// Cavab mətnində və ya xəta mətnində token qalarsa silir
function scrubber(token) {
  return (s) => {
    let t = String(s === undefined || s === null ? "" : s);
    if (token) t = t.split(token).join("[gizli]");
    return t.replace(/[A-Za-z0-9_\-.]{40,}/g, "[gizli]").replace(/\s+/g, " ").slice(0, 200);
  };
}

// Qısa HTTP çağırışı: vaxt limiti, redirect yox, cavab gövdəsi ölçülü. Xətalar AppError olur.
export async function shopifyHttp(url, init = {}, { fetchImpl, timeoutMs = 20000, source = "shopify" } = {}) {
  const f = fetchImpl || ((...a) => globalThis.fetch(...a));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await f(url, { ...init, signal: ctrl.signal, redirect: "manual" });
    } catch (e) {
      if (ctrl.signal.aborted || (e && (e.name === "AbortError" || e.name === "TimeoutError"))) throw new AppError("TIMEOUT", "Shopify cavab vermədi (vaxt limiti)", { source });
      throw new AppError("NETWORK_ERROR", "Shopify ilə şəbəkə xətası", { source });
    }
    let text = "";
    try {
      text = await res.text();
    } catch (e) {
      if (ctrl.signal.aborted) throw new AppError("TIMEOUT", "Shopify cavab vermədi (vaxt limiti)", { source });
      text = "";
    }
    if (text.length > MAX_RESPONSE_CHARS) throw new AppError("PROVIDER_ERROR", "Shopify cavabı çox böyükdür", { source });
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch (e) { json = null; }
    }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, headers: res.headers, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function retryAfter(headers) {
  try {
    const v = Number(headers && headers.get && headers.get("retry-after"));
    return Number.isFinite(v) && v > 0 ? Math.min(60, Math.ceil(v)) : null;
  } catch (e) {
    return null;
  }
}

const VALIDATION_CODES = new Set(["INVALID_VARIABLE", "argumentLiteralsIncompatible", "undefinedField", "undefinedArgument", "missingRequiredArguments", "variableMismatch", "MAX_COST_EXCEEDED", "INVALID_FIELD_ARGUMENTS", "BAD_REQUEST"]);

function mapGraphqlErrors(errors, scrub) {
  const list = Array.isArray(errors) ? errors : [];
  const codes = list.map((e) => String((e && e.extensions && e.extensions.code) || ""));
  const msg = scrub(list.map((e) => (e && e.message) || "").filter(Boolean).slice(0, 3).join("; ")) || "GraphQL xətası";
  if (codes.includes("THROTTLED")) return new AppError("RATE_LIMIT", "Shopify sorğu limiti doldu, bir az sonra təkrar edin", { source: "shopify", retryable: true });
  if (codes.includes("ACCESS_DENIED")) return new AppError("PERMISSION_ERROR", "Shopify icazə vermir (scope çatmır): " + msg, { source: "shopify" });
  if (codes.some((c) => VALIDATION_CODES.has(c))) return new AppError("VALIDATION_ERROR", "Shopify sorğunu qəbul etmədi: " + msg, { source: "shopify" });
  if (codes.includes("SHOP_INACTIVE") || codes.includes("INTERNAL_SERVER_ERROR")) return new AppError("PROVIDER_ERROR", "Shopify xətası: " + msg, { source: "shopify", retryable: true });
  return new AppError("PROVIDER_ERROR", "Shopify xətası: " + msg, { source: "shopify" });
}

// userErrors varsa VALIDATION_ERROR atır. payload: mutasiyanın qaytardığı obyekt.
export function assertNoUserErrors(payload, op) {
  if (!payload || typeof payload !== "object") throw new AppError("PROVIDER_ERROR", (op || "əməliyyat") + ": Shopify boş cavab qaytardı", { source: "shopify" });
  const ue = Array.isArray(payload.userErrors) ? payload.userErrors : [];
  if (ue.length) {
    const text = ue.slice(0, 3).map((u) => String((u && u.message) || "xəta").replace(/\s+/g, " ").slice(0, 120) + (u && Array.isArray(u.field) && u.field.length ? " (" + u.field.join(".").slice(0, 40) + ")" : "")).join("; ");
    throw new AppError("VALIDATION_ERROR", (op ? op + ": " : "") + "Shopify rədd etdi: " + text, { source: "shopify" });
  }
  return payload;
}

export function createShopifyClient({ env = {}, vault, fetchImpl, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 20000 } = {}) {
  let throttle = null; // { available, restoreRate, at }
  let lastCost = null;

  async function credentials() {
    const rec = vault ? await vault.get("shopify") : null;
    if (!rec || !rec.access_token) throw new AppError("AUTH_ERROR", "Shopify qoşulmayıb. Əvvəlcə mağazanı qoşun.", { source: "shopify" });
    const shop = normalizeShopDomain(String(rec.shop || ""));
    if (!shop) throw new AppError("SECURITY_ERROR", "Saxlanmış mağaza domeni düzgün deyil", { source: "shopify" });
    const configured = env.SHOPIFY_SHOP ? normalizeShopDomain(String(env.SHOPIFY_SHOP)) : null;
    if (configured && configured !== shop) throw new AppError("SECURITY_ERROR", "Qoşulu mağaza SHOPIFY_SHOP ilə üst-üstə düşmür", { source: "shopify" });
    return { token: String(rec.access_token), shop, scope: rec.scope || "" };
  }

  async function pauseIfThrottled() {
    if (!throttle || throttle.available >= LOW_WATER) return;
    const rate = throttle.restoreRate > 0 ? throttle.restoreRate : 50;
    const need = Math.ceil(((LOW_WATER - throttle.available) / rate) * 1000) - (now() - throttle.at);
    if (need > 0) await sleep(Math.min(MAX_PAUSE_MS, need));
    throttle = null;
  }

  function rememberCost(ext) {
    const cost = ext && ext.cost;
    if (!cost) return;
    const ts = cost.throttleStatus || {};
    lastCost = { requested: cost.requestedQueryCost, actual: cost.actualQueryCost, available: ts.currentlyAvailable, max: ts.maximumAvailable, restoreRate: ts.restoreRate };
    if (Number.isFinite(ts.currentlyAvailable)) throttle = { available: ts.currentlyAvailable, restoreRate: Number(ts.restoreRate) || 50, at: now() };
  }

  // Qaytarır: data obyekti. Xəta halında AppError.
  async function query(gql, variables = {}) {
    if (typeof gql !== "string" || !gql.trim()) throw new AppError("VALIDATION_ERROR", "GraphQL sənədi boşdur", { source: "shopify" });
    const version = getApiVersion(env);
    const c = await credentials();
    const scrub = scrubber(c.token);
    const url = assertSafeUrl("https://" + c.shop + "/admin/api/" + version + "/graphql.json").toString();
    await pauseIfThrottled();
    let r;
    try {
      r = await shopifyHttp(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-shopify-access-token": c.token }, body: JSON.stringify({ query: gql, variables }) }, { fetchImpl, timeoutMs });
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("NETWORK_ERROR", "Shopify ilə şəbəkə xətası", { source: "shopify" });
    }
    if (r.status === 401) throw new AppError("AUTH_ERROR", "Shopify tokeni etibarsızdır və ya ləğv edilib. Mağazanı yenidən qoşun.", { source: "shopify" });
    if (r.status === 402 || r.status === 403) throw new AppError("PERMISSION_ERROR", "Shopify bu əməliyyata icazə vermir (scope və ya mağaza vəziyyəti)", { source: "shopify" });
    if (r.status === 404) throw new AppError("NOT_FOUND", "Shopify mağazası və ya API versiyası tapılmadı", { source: "shopify" });
    if (r.status === 429) {
      const ra = retryAfter(r.headers);
      const err = new AppError("RATE_LIMIT", "Shopify sorğu limiti doldu" + (ra ? " (" + ra + " san sonra təkrar edin)" : ""), { source: "shopify", retryable: true });
      err.retryAfterSeconds = ra;
      throw err;
    }
    if (r.status >= 500) throw new AppError("PROVIDER_ERROR", "Shopify müvəqqəti xəta qaytardı (" + r.status + ")", { source: "shopify", retryable: true });
    if (!r.ok) throw new AppError("PROVIDER_ERROR", "Shopify gözlənilməz status qaytardı (" + r.status + ")", { source: "shopify" });
    if (!r.json || typeof r.json !== "object") throw new AppError("PROVIDER_ERROR", "Shopify cavabı oxuna bilmədi", { source: "shopify" });
    rememberCost(r.json.extensions);
    if (Array.isArray(r.json.errors) && r.json.errors.length) throw mapGraphqlErrors(r.json.errors, scrub);
    if (!r.json.data || typeof r.json.data !== "object") throw new AppError("PROVIDER_ERROR", "Shopify cavabında data yoxdur", { source: "shopify" });
    return r.json.data;
  }

  // Mutasiya: data[key] qaytarır, userErrors varsa VALIDATION_ERROR atır
  async function mutate(gql, variables, key) {
    const data = await query(gql, variables);
    return assertNoUserErrors(data[key], key);
  }

  return {
    query,
    mutate,
    cost: () => (lastCost ? { ...lastCost } : null),
    apiVersion: () => getApiVersion(env),
    // Token QAYTARILMIR
    async connection() {
      const rec = vault ? await vault.get("shopify") : null;
      if (!rec || !rec.access_token) return { connected: false };
      return { connected: true, shop: rec.shop || null, scope: rec.scope || "", apiVersion: getApiVersion(env) };
    },
  };
}
