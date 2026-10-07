// Shopify modulunun giriş nöqtəsi (inteqrasiya üçün).
//
//   import { createShopify } from "./shopify/index.js";
//   const shop = createShopify({ env, store, audit, coord });      // vault, client, ctx
//   registerShopifyTools(registry, { client: shop.client, vault: shop.vault, audit, env });
//   const res = await handleShopifyPublicRoute(req, shop.ctx);     // OAuth callback + webhook
//   const api = await handleShopifyApiRoute(req, shop.ctx, url);   // parol yoxlanandan sonra

import { createTokenVault } from "../social/tokens.js";
import { createShopifyClient } from "./client.js";

export { createShopifyClient } from "./client.js";
export { handleShopifyApiRoute, handleShopifyPublicRoute } from "./routes.js";
export { registerShopifyTools, SHOPIFY_PERMISSIONS, SHOPIFY_READ_TOOLS, SHOPIFY_WRITE_TOOLS, proposeCreateFromIdea, proposePriceUpdate, proposeInventorySet, proposeProductUpdate, proposePublish, proposeArchive } from "./tools.js";
export { buildInstallUrl, finishShopifyOAuth, shopifyStatus, verifyOAuthHmac } from "./auth.js";
export { buildWebhookMutations, processShopifyWebhook, registerShopifyWebhooks, verifyShopifyWebhook, WEBHOOK_TOPICS } from "./webhooks.js";
export { normalizeShopDomain, getShopifyConfig, DEFAULT_SCOPES, DEFAULT_API_VERSION } from "./config.js";
export { prepareProduct } from "./prepare.js";

export function createShopify({ env, store, audit = null, coord = null, fetchImpl, now, sleep }) {
  const vault = createTokenVault(env, store);
  const client = createShopifyClient({ env, vault, fetchImpl, now, sleep });
  return { vault, client, ctx: { env, store, audit, vault, client, coord, fetchImpl, now } };
}
