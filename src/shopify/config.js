// Shopify modulunun konfiqurasiyası və mağaza domeninin sərt yoxlanması.
//
// Mühit dəyişənləri:
//   SHOPIFY_API_KEY, SHOPIFY_API_SECRET (SİRR, yalnız Cloudflare Secrets)
//   SHOPIFY_SHOP (istəyə bağlı, standart mağaza: my-store.myshopify.com)
//   SHOPIFY_SCOPES (standart minimaldır, "customers" scope-u standart DEYİL)
//   SHOPIFY_API_VERSION (standart 2026-07)

import { AppError } from "../errors.js";
import { publicBaseUrl } from "../security/envvalue.js";

export const DEFAULT_SCOPES = ["read_products", "write_products", "read_orders", "read_inventory", "write_inventory"];
export const DEFAULT_API_VERSION = "2026-07";

// Mağaza domeni YALNIZ bu naxışa uyğun ola bilər: sxem, yol, port, loqin/parol, nöqtəli əlavələr yoxdur.
// Bütün Shopify sorğuları bu domenə qurulur, ona görə SSRF-in qarşısı burada alınır.
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SCOPE_RE = /^[a-z][a-z_]{2,60}$/;
const VERSION_RE = /^\d{4}-(01|04|07|10)$|^unstable$/;

// Düzgün olarsa normallaşmış domeni, əks halda null qaytarır (istisna atmır).
export function normalizeShopDomain(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (s.length < 15 || s.length > 100) return null;
  if (!SHOP_RE.test(s)) return null;
  if (s.includes("..") || s.endsWith("-.myshopify.com")) return null;
  return s;
}

export function requireShopDomain(input) {
  const s = normalizeShopDomain(input);
  if (!s) throw new AppError("VALIDATION_ERROR", "Mağaza domeni düzgün deyil (yalnız ad.myshopify.com qəbul olunur)", { source: "shopify" });
  return s;
}

export function parseScopes(raw) {
  const list = String(raw === undefined || raw === null ? "" : raw)
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const s of list) {
    if (!SCOPE_RE.test(s)) throw new AppError("VALIDATION_ERROR", "SHOPIFY_SCOPES-də yanlış scope adı", { source: "shopify" });
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

// write_X icazəsi read_X-i də əhatə edir (Shopify belə qaytarır)
export function scopesCover(granted, requested) {
  const g = new Set(parseScopesLoose(granted));
  const missing = [];
  for (const r of parseScopesLoose(requested)) {
    if (g.has(r)) continue;
    if (r.startsWith("read_") && g.has("write_" + r.slice(5))) continue;
    missing.push(r);
  }
  return { ok: missing.length === 0, missing };
}

function parseScopesLoose(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  return String(v || "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function getApiVersion(env) {
  const v = String((env && env.SHOPIFY_API_VERSION) || "").trim();
  if (!v) return DEFAULT_API_VERSION;
  if (!VERSION_RE.test(v)) throw new AppError("VALIDATION_ERROR", "SHOPIFY_API_VERSION düzgün deyil (məsələn 2026-07)", { source: "shopify" });
  return v;
}

// Konfiqurasiya xülasəsi. Sirlər yalnız "var/yoxdur" kimi qaytarılır (dəyər yox).
export function getShopifyConfig(env = {}) {
  const defaultShop = env.SHOPIFY_SHOP ? normalizeShopDomain(String(env.SHOPIFY_SHOP)) : null;
  return {
    apiKey: String(env.SHOPIFY_API_KEY || ""),
    apiSecret: String(env.SHOPIFY_API_SECRET || ""),
    defaultShop,
    defaultShopInvalid: Boolean(env.SHOPIFY_SHOP) && !defaultShop,
    scopes: env.SHOPIFY_SCOPES ? parseScopes(env.SHOPIFY_SCOPES) : [...DEFAULT_SCOPES],
    apiVersion: getApiVersion(env),
  };
}

export function requireOAuthConfig(env) {
  const c = getShopifyConfig(env);
  if (!c.apiKey || !c.apiSecret) throw new AppError("AUTH_ERROR", "SHOPIFY_API_KEY və SHOPIFY_API_SECRET təyin edilməyib", { source: "shopify" });
  if (c.defaultShopInvalid) throw new AppError("VALIDATION_ERROR", "SHOPIFY_SHOP düzgün deyil", { source: "shopify" });
  return c;
}

// OAuth callback ünvanı: <PUBLIC_BASE_URL>/oauth/shopify/callback
export function shopifyRedirectUri(env) {
  const base = publicBaseUrl(env);
  if (!base) throw new AppError("VALIDATION_ERROR", "PUBLIC_BASE_URL (https://...) təyin edilməyib", { source: "shopify" });
  return base + "/oauth/shopify/callback";
}

export function shopifyWebhookUri(env) {
  const base = publicBaseUrl(env);
  if (!base) throw new AppError("VALIDATION_ERROR", "PUBLIC_BASE_URL (https://...) təyin edilməyib", { source: "shopify" });
  return base + "/shopify/webhook";
}
