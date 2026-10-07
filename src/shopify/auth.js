// Shopify OAuth: quraşdırma ünvanı, callback yoxlaması, kod mübadiləsi.
// Token yalnız token anbarına (vault "shopify") yazılır. Heç vaxt cavaba, jurnala və xəta mətninə düşmür.
//
// Callback təhlükəsizlik addımları (sıra vacibdir):
//  1. HMAC-SHA256 (sorğu parametrləri, hmac xaric, əlifba sırası) SHOPIFY_API_SECRET ilə, sabit-vaxtlı müqayisə
//  2. timestamp təzəliyi (<= 10 dəq)
//  3. shop domeni sərt yoxlama
//  4. state bir dəfəlik istehlak (10 dəq), state-dəki shop ilə eyni olmalıdır
//  5. kod mübadiləsi https://<shop>/admin/oauth/access_token
//  6. verilən scope-lar istənilənləri əhatə etməlidir, əks halda token SAXLANMIR

import { AppError } from "../errors.js";
import { getShopifyConfig, normalizeShopDomain, requireOAuthConfig, requireShopDomain, scopesCover, shopifyRedirectUri } from "./config.js";
import { fromHex, hmacSha256, randomHex, timingSafeEqualBytes } from "./crypto.js";
import { shopifyHttp } from "./client.js";

const STATE_TTL_SECONDS = 600;
const MAX_AGE_SECONDS = 600;
const MAX_FUTURE_SECONDS = 60;

// Shopify-in hesablama qaydası: hmac xaric, açar üzrə sıralanmış "k=v" cütləri "&" ilə.
// Dəyərdə % və &, açarda əlavə olaraq = kodlaşdırılır.
function canonicalQuery(params) {
  const keys = [...new Set([...params.keys()])].filter((k) => k !== "hmac").sort();
  return keys
    .map((k) => {
      const ek = k.replace(/%/g, "%25").replace(/&/g, "%26").replace(/=/g, "%3D");
      const ev = String(params.get(k)).replace(/%/g, "%25").replace(/&/g, "%26");
      return ek + "=" + ev;
    })
    .join("&");
}

// params: URLSearchParams. Qaytarır true/false.
export async function verifyOAuthHmac(params, secret) {
  if (!secret) return false;
  const all = params.getAll("hmac");
  if (all.length !== 1) return false;
  for (const k of new Set([...params.keys()])) if (params.getAll(k).length > 1) return false; // təkrarlanan açar şübhəlidir
  const given = fromHex(all[0]);
  if (!given || given.length !== 32) return false;
  const expected = await hmacSha256(secret, canonicalQuery(params));
  return timingSafeEqualBytes(given, expected);
}

// Quraşdırma ünvanını qurur və bir dəfəlik state saxlayır.
export async function buildInstallUrl({ env, store, shop, now = () => Date.now() }) {
  const cfg = requireOAuthConfig(env);
  const s = requireShopDomain(shop || cfg.defaultShop);
  if (cfg.defaultShop && s !== cfg.defaultShop) throw new AppError("VALIDATION_ERROR", "Bu mağaza SHOPIFY_SHOP ilə üst-üstə düşmür", { source: "shopify" });
  const redirect = shopifyRedirectUri(env);
  const state = randomHex(16);
  await store.putRaw("oauthstate:" + state, { platform: "shopify", shop: s, scopes: cfg.scopes, created: now() }, STATE_TTL_SECONDS);
  const q = new URLSearchParams({ client_id: cfg.apiKey, scope: cfg.scopes.join(","), redirect_uri: redirect, state });
  return { url: "https://" + s + "/admin/oauth/authorize?" + q.toString(), shop: s, redirect_uri: redirect, scopes: cfg.scopes, expires_in: STATE_TTL_SECONDS };
}

// Qaytarır: { ok, message, shop? }. message-də gizli məlumat yoxdur.
export async function finishShopifyOAuth({ env, store, vault, audit = null, fetchImpl, params, now = () => Date.now(), coord = null }) {
  const fail = async (message, reason) => {
    if (audit) await audit.log("shopify.oauth_failed", { reason });
    return { ok: false, message };
  };
  let cfg;
  try {
    cfg = requireOAuthConfig(env);
  } catch (e) {
    return await fail("Shopify açarları təyin edilməyib.", "not_configured");
  }

  // 1. HMAC (state-i yandırmamaq üçün ilk addım)
  if (!(await verifyOAuthHmac(params, cfg.apiSecret))) return await fail("İmza (hmac) düzgün deyil.", "bad_hmac");

  // 2. timestamp
  const ts = Number(params.get("timestamp"));
  const nowSec = Math.floor(now() / 1000);
  if (!Number.isInteger(ts) || ts <= 0 || nowSec - ts > MAX_AGE_SECONDS || ts - nowSec > MAX_FUTURE_SECONDS) return await fail("Sorğunun vaxtı keçib. Qoşulmanı yenidən başladın.", "stale_timestamp");

  // 3. shop
  const shop = normalizeShopDomain(String(params.get("shop") || ""));
  if (!shop) return await fail("Mağaza domeni düzgün deyil.", "bad_shop");
  if (cfg.defaultShop && shop !== cfg.defaultShop) return await fail("Mağaza SHOPIFY_SHOP ilə üst-üstə düşmür.", "shop_mismatch");

  // 4. state (bir dəfəlik)
  const state = String(params.get("state") || "");
  if (!/^[0-9a-f]{32}$/.test(state)) return await fail("state düzgün deyil.", "bad_state");
  if (coord && typeof coord.once === "function" && !(await coord.once("oauthstate:" + state))) return await fail("state artıq istifadə olunub.", "state_replayed");
  const rec = await store.getRaw("oauthstate:" + state);
  if (rec) await store.deleteRaw("oauthstate:" + state);
  if (!rec || rec.platform !== "shopify" || rec.shop !== shop) return await fail("state etibarsızdır və ya vaxtı bitib. Qoşulmanı yenidən başladın.", "state_invalid");

  if (params.get("error")) return await fail("Shopify icazə verilmədi.", "denied");
  const code = String(params.get("code") || "");
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(code)) return await fail("Kod gəlmədi və ya düzgün deyil.", "bad_code");

  // 5. kod mübadiləsi
  let r;
  try {
    r = await shopifyHttp("https://" + shop + "/admin/oauth/access_token", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ client_id: cfg.apiKey, client_secret: cfg.apiSecret, code }) }, { fetchImpl });
  } catch (e) {
    return await fail("Shopify ilə əlaqə alınmadı.", "exchange_network");
  }
  const tok = r.json && typeof r.json.access_token === "string" ? r.json.access_token : "";
  if (!r.ok || !tok) return await fail("Shopify kodu qəbul etmədi (status " + r.status + ").", "exchange_rejected");

  // 6. scope yoxlaması: token verilib, amma istənilənləri əhatə etmirsə SAXLANMIR
  const granted = String((r.json && r.json.scope) || "");
  const cover = scopesCover(granted, rec.scopes || cfg.scopes);
  if (!cover.ok) return await fail("Verilən icazələr çatmır: " + cover.missing.join(", ").slice(0, 120) + ". Scope-ları tətbiqdə yoxlayıb yenidən qoşun.", "scope_mismatch");

  await vault.put("shopify", { access_token: tok, scope: granted, shop, connected_at: now(), api_version: cfg.apiVersion });
  if (audit) await audit.log("shopify.connected", { shop, scopes: granted.split(",").filter(Boolean).length });
  return { ok: true, shop, message: "Shopify mağazası qoşuldu. Bu pəncərəni bağlaya bilərsiniz." };
}

// Vəziyyət (token YOXDUR, yalnız var/yoxdur)
export async function shopifyStatus({ env, vault }) {
  let cfg;
  let cfgError = null;
  try {
    cfg = getShopifyConfig(env);
  } catch (e) {
    cfgError = String((e && e.message) || "konfiqurasiya xətası").slice(0, 120);
    cfg = { apiKey: "", apiSecret: "", defaultShop: null, scopes: [], apiVersion: null };
  }
  const rec = await vault.get("shopify");
  const present = Boolean(rec && rec.access_token);
  return {
    configured: { api_key: Boolean(cfg.apiKey), api_secret: Boolean(cfg.apiSecret), public_base_url: Boolean(env.PUBLIC_BASE_URL), default_shop: cfg.defaultShop || null },
    config_error: cfgError,
    connected: present,
    shop: present ? rec.shop || null : null,
    scopes: present ? String(rec.scope || "").split(",").filter(Boolean) : [],
    requested_scopes: cfg.scopes,
    token_present: present,
    connected_at: present && rec.connected_at ? new Date(rec.connected_at).toISOString() : null,
    api_version: cfg.apiVersion,
    token_encrypted: Boolean(vault.encrypted),
  };
}
