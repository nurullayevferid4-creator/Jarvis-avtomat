// Shopify marşrutları: təmiz funksiyalardır, index.js onları özü bağlayır.
//
//   handleShopifyPublicRoute(req, ctx)       -> Response | null   (parolsuz, hər biri öz üsulu ilə qorunur)
//       GET  /oauth/shopify/callback   (HMAC + state + timestamp)
//       POST /shopify/webhook          (HMAC, topic icazə siyahısı, shop, təkrar qoruması)
//   handleShopifyApiRoute(req, ctx, url)     -> Response | null   (parol ARTIQ yoxlanıb, index.js yoxlayır)
//       POST /api/shopify/connect      body { shop? }
//       GET  /api/shopify/status
//       POST /api/shopify/disconnect
//
// ctx: { env, store, audit, vault, client, approvals, fetchImpl?, coord?, now? }

import { toAppError } from "../errors.js";
import { json } from "../util.js";
import { buildInstallUrl, finishShopifyOAuth, shopifyStatus } from "./auth.js";
import { MAX_WEBHOOK_BYTES, processShopifyWebhook } from "./webhooks.js";

const MAX_BODY = 4000;

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}

function page(ok, message) {
  return new Response("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>JARVIS</title><body style='font-family:system-ui;padding:2rem;background:#0b1220;color:#e6edf7'><h2>" + (ok ? "Shopify qoşuldu" : "Shopify qoşulması alınmadı") + "</h2><p>" + escapeHtml(message) + "</p></body>", {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" },
  });
}

function errorResponse(e) {
  const err = toAppError(e, "shopify");
  return json({ error: err.toPublic() }, err.httpStatus || 500);
}

async function readSmallJson(req) {
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  if (len > MAX_BODY) return null;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return null;
    if (!raw.trim()) return {};
    const b = JSON.parse(raw);
    return b && typeof b === "object" && !Array.isArray(b) ? b : null;
  } catch (e) {
    return null;
  }
}

export async function handleShopifyPublicRoute(req, ctx) {
  const url = new URL(req.url);

  if (url.pathname === "/oauth/shopify/callback") {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
    try {
      const r = await finishShopifyOAuth({ env: ctx.env, store: ctx.store, vault: ctx.vault, audit: ctx.audit, fetchImpl: ctx.fetchImpl, params: url.searchParams, now: ctx.now, coord: ctx.coord });
      return page(r.ok, r.message);
    } catch (e) {
      return page(false, "Qoşulma alınmadı.");
    }
  }

  if (url.pathname === "/shopify/webhook") {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
    const len = parseInt(req.headers.get("content-length") || "0", 10);
    if (len > MAX_WEBHOOK_BYTES) return new Response("too large", { status: 413 });
    let raw;
    try {
      raw = new Uint8Array(await req.arrayBuffer()); // HMAC üçün gövdə YALNIZ BİR DƏFƏ və olduğu kimi oxunur
    } catch (e) {
      return new Response("bad request", { status: 400 });
    }
    try {
      const r = await processShopifyWebhook({ rawBody: raw, headers: req.headers, env: ctx.env, store: ctx.store, vault: ctx.vault, audit: ctx.audit, coord: ctx.coord, now: ctx.now });
      if (r.ok) return new Response(r.duplicate ? "duplicate" : "ok", { status: 200 });
      return new Response(r.reason === "unknown_topic" ? "ignored" : "rejected", { status: r.status || 400 });
    } catch (e) {
      return new Response("error", { status: 500 });
    }
  }
  return null;
}

export async function handleShopifyApiRoute(req, ctx, url) {
  const u = url || new URL(req.url);
  if (!u.pathname.startsWith("/api/shopify/")) return null;

  if (u.pathname === "/api/shopify/status") {
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    try {
      return json(await shopifyStatus({ env: ctx.env, vault: ctx.vault }));
    } catch (e) {
      return errorResponse(e);
    }
  }

  if (u.pathname === "/api/shopify/connect") {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await readSmallJson(req);
    if (!body) return json({ error: { code: "VALIDATION_ERROR", message: "Sorğu gövdəsi düzgün deyil" } }, 400);
    try {
      const r = await buildInstallUrl({ env: ctx.env, store: ctx.store, shop: body.shop, now: ctx.now });
      if (ctx.audit) await ctx.audit.log("shopify.connect_started", { shop: r.shop });
      return json({ url: r.url, shop: r.shop, redirect_uri: r.redirect_uri, scopes: r.scopes, expires_in: r.expires_in });
    } catch (e) {
      return errorResponse(e);
    }
  }

  if (u.pathname === "/api/shopify/disconnect") {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    try {
      const rec = await ctx.vault.get("shopify");
      await ctx.vault.remove("shopify");
      if (ctx.audit) await ctx.audit.log("shopify.disconnected", { shop: rec && rec.shop ? rec.shop : null });
      // Qeyd: bu yalnız JARVIS-dəki tokeni silir. Tətbiqi Shopify admin-dən də silmək tövsiyə olunur.
      return json({ ok: true, disconnected: Boolean(rec) });
    } catch (e) {
      return errorResponse(e);
    }
  }

  return json({ error: "not_found" }, 404);
}
