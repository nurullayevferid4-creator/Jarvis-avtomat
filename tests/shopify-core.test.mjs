// Shopify: mağaza domeni (SSRF), konfiqurasiya, OAuth, client xəta xəritəsi, webhook, marşrutlar.
// HEÇ BİR real şəbəkə çağırışı yoxdur (saxta fetch).
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeShopDomain, getShopifyConfig, DEFAULT_SCOPES, parseScopes, scopesCover } from "../src/shopify/config.js";
import { buildInstallUrl, finishShopifyOAuth, shopifyStatus, verifyOAuthHmac } from "../src/shopify/auth.js";
import { createShopifyClient } from "../src/shopify/client.js";
import { verifyShopifyWebhook, processShopifyWebhook, buildWebhookMutations, MAX_WEBHOOK_BYTES } from "../src/shopify/webhooks.js";
import { handleShopifyApiRoute, handleShopifyPublicRoute } from "../src/shopify/routes.js";
import { Q_SHOP } from "../src/shopify/gql.js";
import { FAKE_SECRET, FAKE_TOKEN, SHOP, createFakeShopify, jsonRes, leaks, shopifyWorld, signedCallback, signOAuthParams, webhookRequest, allAuditText } from "./shopify-helpers.mjs";

const routeCtx = (w) => ({ env: w.env, store: w.store, audit: w.audit, vault: w.vault, client: w.client, approvals: w.approvals, fetchImpl: w.fake.fetchImpl, coord: w.coord, now: w.now });
const stateOf = (url) => new URL(url).searchParams.get("state");

// ---------------------------------------------------------------------------------------------------
test("shop domeni: yalnız ad.myshopify.com qəbul olunur (SSRF halları rədd)", () => {
  assert.equal(normalizeShopDomain("demo-store.myshopify.com"), "demo-store.myshopify.com");
  assert.equal(normalizeShopDomain("Demo-Store.MyShopify.com"), "demo-store.myshopify.com");
  const bad = [
    "https://demo-store.myshopify.com", "http://demo-store.myshopify.com", "demo-store.myshopify.com/admin", "demo-store.myshopify.com/",
    "user@demo-store.myshopify.com", "user:pw@demo-store.myshopify.com", "demo-store.myshopify.com@evil.com", "evil.com@demo-store.myshopify.com",
    "demo-store.myshopify.com:443", "demo-store.myshopify.com.evil.com", "evil.com", "evil.com/.myshopify.com", "-demo.myshopify.com", "demo_store.myshopify.com",
    "a..myshopify.com", ".myshopify.com", "myshopify.com", "127.0.0.1", "localhost", "169.254.169.254", "[::1]", "demo-store.myshopify.com#x", "demo-store.myshopify.com?x=1",
    "demo-store.myshopify.com\\@evil.com", "а.myshopify.com" /* kiril a */, "demo store.myshopify.com", "demo.myshopify.com.", "demo\u0000.myshopify.com", "x".repeat(200) + ".myshopify.com",
    "", null, undefined, 123, {}, [], ["demo-store.myshopify.com"],
  ];
  for (const b of bad) assert.equal(normalizeShopDomain(b), null, "rədd olunmalı idi: " + JSON.stringify(b));
});

test("konfiqurasiya: standart minimal scope (customers yoxdur), API versiyası 2026-07", () => {
  const c = getShopifyConfig({});
  assert.deepEqual(c.scopes, ["read_products", "write_products", "read_orders", "read_inventory", "write_inventory"]);
  assert.deepEqual(DEFAULT_SCOPES, c.scopes);
  assert.ok(!c.scopes.some((s) => /customer/.test(s)));
  assert.equal(c.apiVersion, "2026-07");
  assert.deepEqual(getShopifyConfig({ SHOPIFY_SCOPES: "read_products, write_products read_products" }).scopes, ["read_products", "write_products"]);
  assert.throws(() => getShopifyConfig({ SHOPIFY_SCOPES: "read_products,DROP TABLE;" }), /scope/);
  assert.throws(() => getShopifyConfig({ SHOPIFY_API_VERSION: "latest; rm" }), /SHOPIFY_API_VERSION/);
  assert.equal(getShopifyConfig({ SHOPIFY_API_VERSION: "2026-10" }).apiVersion, "2026-10");
  assert.equal(getShopifyConfig({ SHOPIFY_SHOP: "evil.com" }).defaultShop, null);
  assert.equal(getShopifyConfig({ SHOPIFY_SHOP: "evil.com" }).defaultShopInvalid, true);
  assert.deepEqual(parseScopes("a_b_c"), ["a_b_c"]);
  assert.equal(scopesCover("write_products,read_orders", "read_products,read_orders").ok, true);
  assert.deepEqual(scopesCover("read_products", "read_products,write_products").missing, ["write_products"]);
});

// ---------------------------------------------------------------------------------------------------
test("OAuth: install ünvanı düzgün qurulur, state 10 dəq TTL ilə saxlanır", async () => {
  const w = await shopifyWorld({ connected: false });
  const r = await buildInstallUrl({ env: w.env, store: w.store, shop: SHOP, now: w.now });
  const u = new URL(r.url);
  assert.equal(u.origin, "https://" + SHOP);
  assert.equal(u.pathname, "/admin/oauth/authorize");
  assert.equal(u.searchParams.get("client_id"), "test-key");
  assert.equal(u.searchParams.get("scope"), DEFAULT_SCOPES.join(","));
  assert.equal(u.searchParams.get("redirect_uri"), "https://jarvis.example.dev/oauth/shopify/callback");
  assert.match(u.searchParams.get("state"), /^[0-9a-f]{32}$/);
  const rec = await w.store.getRaw("oauthstate:" + u.searchParams.get("state"));
  assert.equal(rec.platform, "shopify");
  assert.equal(rec.shop, SHOP);
  assert.ok(!r.url.includes(FAKE_SECRET), "API secret ünvana düşməməlidir");
  await assert.rejects(() => buildInstallUrl({ env: w.env, store: w.store, shop: "evil.com" }), (e) => e.code === "VALIDATION_ERROR");
  await assert.rejects(() => buildInstallUrl({ env: { ...w.env, SHOPIFY_API_SECRET: "" }, store: w.store, shop: SHOP }), (e) => e.code === "AUTH_ERROR");
  await assert.rejects(() => buildInstallUrl({ env: { ...w.env, PUBLIC_BASE_URL: "" }, store: w.store, shop: SHOP }), (e) => e.code === "VALIDATION_ERROR");
  await assert.rejects(() => buildInstallUrl({ env: { ...w.env, SHOPIFY_SHOP: "other.myshopify.com" }, store: w.store, shop: SHOP }), (e) => e.code === "VALIDATION_ERROR");
  const dflt = await buildInstallUrl({ env: { ...w.env, SHOPIFY_SHOP: SHOP }, store: w.store });
  assert.equal(dflt.shop, SHOP);
});

async function begin(w, shop = SHOP) {
  const r = await buildInstallUrl({ env: w.env, store: w.store, shop, now: w.now });
  return stateOf(r.url);
}

test("OAuth callback: düzgün imza ilə token vault-a yazılır, heç yerdə görünmür", async () => {
  const w = await shopifyWorld({ connected: false });
  const state = await begin(w);
  const params = await signedCallback(w, { state });
  assert.equal(await verifyOAuthHmac(params, FAKE_SECRET), true);
  const r = await finishShopifyOAuth({ env: w.env, store: w.store, vault: w.vault, audit: w.audit, fetchImpl: w.fake.fetchImpl, params, now: w.now });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.shop, SHOP);
  const rec = await w.vault.get("shopify");
  assert.equal(rec.access_token, FAKE_TOKEN);
  assert.equal(rec.shop, SHOP);
  // yalnız Shopify mağazasına bir mübadilə sorğusu
  const ex = w.fake.st.calls;
  assert.equal(ex.length, 1);
  assert.equal(ex[0].url, "https://" + SHOP + "/admin/oauth/access_token");
  assert.equal(ex[0].method, "POST");
  // heç bir qaytarılan dəyərdə və jurnalda token yoxdur
  assert.equal(leaks(r), false);
  assert.equal(leaks(await shopifyStatus({ env: w.env, vault: w.vault })), false);
  assert.equal((await allAuditText(w)).includes(FAKE_TOKEN), false);
  assert.equal((await allAuditText(w)).includes(FAKE_SECRET), false);
  const st = await shopifyStatus({ env: w.env, vault: w.vault });
  assert.equal(st.connected, true);
  assert.equal(st.token_present, true);
  assert.equal(st.shop, SHOP);
  assert.ok(st.scopes.includes("write_products"));
});

test("OAuth callback: yanlış imza, köhnə vaxt, yanlış secret rədd olunur; state yandırılmır", async () => {
  const w = await shopifyWorld({ connected: false });
  const state = await begin(w);
  const run = (params) => finishShopifyOAuth({ env: w.env, store: w.store, vault: w.vault, audit: w.audit, fetchImpl: w.fake.fetchImpl, params, now: w.now });

  const good = await signedCallback(w, { state });
  const tampered = new URLSearchParams(good);
  tampered.set("code", "othercode");
  assert.equal((await run(tampered)).ok, false);
  const wrongSecret = await signedCallback(w, { state, secret: "fake-another-secret-xxxxxxxx" });
  assert.equal((await run(wrongSecret)).ok, false);
  const noHmac = new URLSearchParams(good);
  noHmac.delete("hmac");
  assert.equal((await run(noHmac)).ok, false);
  const badHex = new URLSearchParams(good);
  badHex.set("hmac", "zz".repeat(32));
  assert.equal((await run(badHex)).ok, false);
  const dup = new URLSearchParams(good);
  dup.append("code", "goodcode");
  assert.equal((await run(dup)).ok, false);
  const stale = await signedCallback(w, { state, timestamp: Math.floor(w.now() / 1000) - 601 });
  assert.equal((await run(stale)).ok, false);
  const future = await signedCallback(w, { state, timestamp: Math.floor(w.now() / 1000) + 3600 });
  assert.equal((await run(future)).ok, false);
  assert.equal(w.fake.st.calls.length, 0, "rədd edilən sorğular Shopify-a getməməlidir");
  assert.equal(await w.vault.get("shopify"), null);
  // state pis cəhdlərdən sonra hələ də işləyir
  assert.equal((await run(good)).ok, true);
});

test("OAuth callback: state bir dəfəlikdir (təkrar), yanlış shop, naməlum state, paralel", async () => {
  const w = await shopifyWorld({ connected: false });
  const run = (params) => finishShopifyOAuth({ env: w.env, store: w.store, vault: w.vault, audit: w.audit, fetchImpl: w.fake.fetchImpl, params, now: w.now, coord: w.coord });
  const state = await begin(w);
  const params = await signedCallback(w, { state });
  assert.equal((await run(params)).ok, true);
  assert.equal((await run(params)).ok, false, "təkrar (replay) rədd olunmalıdır");
  assert.equal(w.fake.st.calls.length, 1);

  // state başqa mağaza üçün yaradılıb, callback başqa mağaza üçün düzgün imzalanıb
  const s2 = await begin(w, "other-store.myshopify.com");
  const mism = await signedCallback(w, { state: s2, shop: SHOP });
  assert.equal((await run(mism)).ok, false);
  // naməlum state
  const unknown = await signedCallback(w, { state: "0".repeat(32) });
  assert.equal((await run(unknown)).ok, false);
  const malformed = await signedCallback(w, { state: "../../etc" });
  assert.equal((await run(malformed)).ok, false);
  // SSRF: imzalı, amma shop pis domen
  const evil = await signedCallback(w, { state: s2, shop: "evil.com" });
  assert.equal((await run(evil)).ok, false);
  assert.ok(w.fake.st.calls.every((c) => c.host === SHOP), "yalnız qoşulu mağaza domeninə sorğu");

  // paralel: 8 eyni callback -> yalnız biri keçir
  const w2 = await shopifyWorld({ connected: false });
  const s3 = await begin(w2);
  const p3 = await signedCallback(w2, { state: s3 });
  const rs = await Promise.all(Array.from({ length: 8 }, () => finishShopifyOAuth({ env: w2.env, store: w2.store, vault: w2.vault, audit: w2.audit, fetchImpl: w2.fake.fetchImpl, params: p3, now: w2.now, coord: w2.coord })));
  assert.equal(rs.filter((x) => x.ok).length, 1);
  assert.equal(w2.fake.st.calls.length, 1);
});

test("OAuth callback: scope uyğunsuzluğu token saxlamır; kod rədd olunarsa da saxlamır; icazə rədd", async () => {
  const fake = createFakeShopify({ scope: "read_products,read_orders" }); // write_* verilməyib
  const w = await shopifyWorld({ connected: false, fake });
  const run = (params) => finishShopifyOAuth({ env: w.env, store: w.store, vault: w.vault, audit: w.audit, fetchImpl: w.fake.fetchImpl, params, now: w.now });
  const state = await begin(w);
  const r = await run(await signedCallback(w, { state }));
  assert.equal(r.ok, false);
  assert.match(r.message, /write_products/);
  assert.equal(await w.vault.get("shopify"), null);
  assert.equal(leaks(r), false);

  const w2 = await shopifyWorld({ connected: false });
  const s2 = await begin(w2);
  const r2 = await finishShopifyOAuth({ env: w2.env, store: w2.store, vault: w2.vault, audit: w2.audit, fetchImpl: w2.fake.fetchImpl, params: await signedCallback(w2, { state: s2, code: "badcode" }), now: w2.now });
  assert.equal(r2.ok, false);
  assert.equal(await w2.vault.get("shopify"), null);

  const s3 = await begin(w2);
  const r3 = await finishShopifyOAuth({ env: w2.env, store: w2.store, vault: w2.vault, audit: w2.audit, fetchImpl: w2.fake.fetchImpl, params: await signedCallback(w2, { state: s3, code: undefined, extra: { error: "access_denied" } }), now: w2.now });
  assert.equal(r3.ok, false);

  // write_products read_products-u əhatə edir
  const fake3 = createFakeShopify({ scope: "write_products,read_orders,write_inventory" });
  const w3 = await shopifyWorld({ connected: false, fake: fake3 });
  const s4 = await begin(w3);
  const r4 = await finishShopifyOAuth({ env: w3.env, store: w3.store, vault: w3.vault, audit: w3.audit, fetchImpl: fake3.fetchImpl, params: await signedCallback(w3, { state: s4 }), now: w3.now });
  assert.equal(r4.ok, true, r4.message);
});

// ---------------------------------------------------------------------------------------------------
test("client: GraphQL çağırışı düzgün başlıq, URL və versiya ilə gedir; token yalnız başlıqda", async () => {
  const w = await shopifyWorld();
  const d = await w.client.query(Q_SHOP, {});
  assert.equal(d.shop.currencyCode, "AZN");
  const c = w.fake.st.calls[0];
  assert.equal(c.url, "https://" + SHOP + "/admin/api/2026-07/graphql.json");
  assert.equal(c.headers["x-shopify-access-token"], FAKE_TOKEN);
  assert.ok(!String(c.body).includes(FAKE_TOKEN));
  const w2 = await shopifyWorld({ envExtra: { SHOPIFY_API_VERSION: "2026-10" } });
  await w2.client.query(Q_SHOP, {});
  assert.equal(w2.fake.st.calls[0].version, "2026-10");
  assert.equal(JSON.stringify(await w.client.connection()).includes(FAKE_TOKEN), false);
});

test("client: xəta xəritəsi (401, 403, 404, 429, 5xx, GraphQL errors, userErrors, timeout, şəbəkə)", async () => {
  const code = async (w, op, fo) => {
    w.fake.st.failOp = { op: "ShopInfo", ...fo };
    try {
      await w.client.query(Q_SHOP, {});
      return "OK";
    } catch (e) {
      return e;
    }
  };
  const w = await shopifyWorld();
  assert.equal((await code(w, "ShopInfo", { status: 401 })).code, "AUTH_ERROR");
  assert.equal((await code(w, "ShopInfo", { status: 403 })).code, "PERMISSION_ERROR");
  assert.equal((await code(w, "ShopInfo", { status: 404 })).code, "NOT_FOUND");
  const rl = await code(w, "ShopInfo", { status: 429, headers: { "retry-after": "7" } });
  assert.equal(rl.code, "RATE_LIMIT");
  assert.equal(rl.retryable, true);
  assert.equal(rl.retryAfterSeconds, 7);
  assert.match(rl.message, /7/);
  assert.equal((await code(w, "ShopInfo", { status: 502 })).code, "PROVIDER_ERROR");
  assert.equal((await code(w, "ShopInfo", { status: 200, body: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } })).code, "RATE_LIMIT");
  assert.equal((await code(w, "ShopInfo", { status: 200, body: { errors: [{ message: "nope", extensions: { code: "ACCESS_DENIED" } }] } })).code, "PERMISSION_ERROR");
  assert.equal((await code(w, "ShopInfo", { status: 200, body: { errors: [{ message: "bad var", extensions: { code: "INVALID_VARIABLE" } }] } })).code, "VALIDATION_ERROR");
  assert.equal((await code(w, "ShopInfo", { status: 200, body: { errors: [{ message: "boom" }] } })).code, "PROVIDER_ERROR");
  assert.equal((await code(w, "ShopInfo", { status: 200, body: { data: null } })).code, "PROVIDER_ERROR");
  // Shopify cavabı tokeni əks etdirsə belə xəta mətninə düşmür
  const echo = await code(w, "ShopInfo", { status: 200, body: { errors: [{ message: "bad token " + FAKE_TOKEN + " rejected" }] } });
  assert.equal(echo.code, "PROVIDER_ERROR");
  assert.equal(echo.message.includes(FAKE_TOKEN), false);
  assert.equal(JSON.stringify(echo.toPublic()).includes(FAKE_TOKEN), false);

  // userErrors -> VALIDATION_ERROR
  const w2 = await shopifyWorld();
  w2.fake.st.failOp = { op: "UpdateProduct", status: 200, body: { data: { productUpdate: { product: null, userErrors: [{ field: ["title"], message: "Title can't be blank" }] } } } };
  await assert.rejects(() => w2.client.mutate("mutation UpdateProduct($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { message } } }", { product: {} }, "productUpdate"), (e) => e.code === "VALIDATION_ERROR" && /blank/.test(e.message));

  // timeout
  const w3 = await shopifyWorld();
  w3.fake.st.delayMs = 300;
  const fast = createShopifyClient({ env: w3.env, vault: w3.vault, fetchImpl: w3.fake.fetchImpl, timeoutMs: 20 });
  await assert.rejects(() => fast.query(Q_SHOP, {}), (e) => e.code === "TIMEOUT" && e.retryable === true);

  // şəbəkə xətası
  const net = createShopifyClient({ env: w3.env, vault: w3.vault, fetchImpl: async () => { throw new TypeError("fetch failed " + FAKE_TOKEN); } });
  await assert.rejects(() => net.query(Q_SHOP, {}), (e) => e.code === "NETWORK_ERROR" && !e.message.includes(FAKE_TOKEN));

  // qoşulmayıb
  const w4 = await shopifyWorld({ connected: false });
  await assert.rejects(() => w4.client.query(Q_SHOP, {}), (e) => e.code === "AUTH_ERROR");
  assert.equal(w4.fake.st.calls.length, 0);
});

test("client: SSRF (vault-dakı pis domen, SHOPIFY_SHOP uyğunsuzluğu) heç bir sorğu göndərmir", async () => {
  const w = await shopifyWorld();
  await w.vault.put("shopify", { access_token: FAKE_TOKEN, scope: "read_products", shop: "evil.com/x?y=" });
  await assert.rejects(() => w.client.query(Q_SHOP, {}), (e) => e.code === "SECURITY_ERROR");
  await w.vault.put("shopify", { access_token: FAKE_TOKEN, scope: "read_products", shop: SHOP });
  const c2 = createShopifyClient({ env: { ...w.env, SHOPIFY_SHOP: "other.myshopify.com" }, vault: w.vault, fetchImpl: w.fake.fetchImpl });
  await assert.rejects(() => c2.query(Q_SHOP, {}), (e) => e.code === "SECURITY_ERROR");
  assert.equal(w.fake.st.calls.length, 0);
});

test("client: throttle balansı azdırsa növbəti sorğu gözləyir", async () => {
  const sleeps = [];
  const w = await shopifyWorld({ sleep: async (ms) => { sleeps.push(ms); } });
  w.fake.st.throttleAvail = 10;
  await w.client.query(Q_SHOP, {});
  assert.equal(sleeps.length, 0);
  await w.client.query(Q_SHOP, {});
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] > 0 && sleeps[0] <= 5000);
  assert.equal(w.client.cost().available, 10);
});

// ---------------------------------------------------------------------------------------------------
test("webhook: verifyShopifyWebhook halları (etibarlı, imza, topic, shop, id, ölçü)", async () => {
  const body = JSON.stringify({ id: 1, title: "x" });
  const bytes = new TextEncoder().encode(body);
  const hdr = async (o = {}) => { const r = await webhookRequest(body, o); return r.headers; };
  const env = { SHOPIFY_API_SECRET: FAKE_SECRET };

  const ok = await verifyShopifyWebhook(bytes, await hdr(), env, { expectedShop: SHOP });
  assert.equal(ok.ok, true);
  assert.equal(ok.topic, "products/update");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr({ secret: "fake-wrong-secret-xxxxxxxx" }), env)).reason, "bad_hmac");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr({ hmac: "" }), env)).reason, "bad_hmac");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr({ hmac: "not base64!!" }), env)).reason, "bad_hmac");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr({ hmac: btoa("short") }), env)).reason, "bad_hmac");
  assert.equal((await verifyShopifyWebhook(new TextEncoder().encode(body + " "), await hdr(), env)).reason, "bad_hmac", "gövdə dəyişdirilsə imza pozulur");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr({ topic: "customers/data_request" }), env)).reason, "unknown_topic");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr({ topic: "products/delete" }), env)).reason, "unknown_topic");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr({ shop: "evil.com" }), env)).reason, "bad_shop");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr({ shop: "other.myshopify.com" }), env, { expectedShop: SHOP })).reason, "wrong_shop");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr({ id: "x" }), env)).reason, "bad_webhook_id");
  assert.equal((await verifyShopifyWebhook(bytes, await hdr(), {})).reason, "not_configured");
  for (const t of ["products/update", "products/create", "orders/create", "orders/updated", "inventory_levels/update", "app/uninstalled"]) {
    assert.equal((await verifyShopifyWebhook(bytes, await hdr({ topic: t }), env)).ok, true, t);
  }
  const big = new Uint8Array(MAX_WEBHOOK_BYTES + 1);
  assert.equal((await verifyShopifyWebhook(big, await hdr(), env)).reason, "too_large");
  // başlıqlar adi obyekt kimi də verilə bilər
  assert.equal((await verifyShopifyWebhook(bytes, Object.fromEntries((await hdr()).entries()), env)).ok, true);
});

test("webhook marşrutu: yalnız qeyd (event+audit), biznes əməliyyatı YOXDUR, təkrar qorunur", async () => {
  const w = await shopifyWorld();
  const ctx = routeCtx(w);
  const payload = { id: 123, title: "Ətir A", status: "active", secret_field: "x", customer: { email: "a@b.c" } };
  const r1 = await handleShopifyPublicRoute(await webhookRequest(payload), ctx);
  assert.equal(r1.status, 200);
  assert.equal(await r1.text(), "ok");
  const r2 = await handleShopifyPublicRoute(await webhookRequest(payload), ctx);
  assert.equal(r2.status, 200);
  assert.equal(await r2.text(), "duplicate");
  const events = await w.store.listDocs("event", 10);
  assert.equal(events.length, 1);
  assert.equal(events[0].topic, "products/update");
  assert.equal(events[0].title, "Ətir A");
  assert.equal(JSON.stringify(events).includes("a@b.c"), false, "tam yük saxlanmır");
  assert.equal(w.fake.st.calls.length, 0, "webhook heç bir Shopify sorğusu göndərmir");
  assert.equal((await w.approvals.list()).length, 0, "webhook təsdiq qeydi də açmır");
  assert.ok(await w.store.getRaw("shwebhook:wh-0001-aaaa-bbbb"));
  const audits = (await w.audit.list(40)).map((a) => a.event);
  assert.ok(audits.includes("shopify.webhook"));
  // yeni id ilə eyni gövdə yenidən qəbul olunur
  const r3 = await handleShopifyPublicRoute(await webhookRequest(payload, { id: "wh-0002-cccc-dddd" }), ctx);
  assert.equal(await r3.text(), "ok");
  assert.equal((await w.store.listDocs("event", 10)).length, 2);
});

test("webhook marşrutu: yanlış imza/shop/topic/ölçü/metod rədd, pozulmuş JSON qeyd olunur", async () => {
  const w = await shopifyWorld();
  const ctx = routeCtx(w);
  const body = { id: 1 };
  assert.equal((await handleShopifyPublicRoute(await webhookRequest(body, { secret: "fake-wrong-secret-xxxxxxxx" }), ctx)).status, 401);
  assert.equal((await handleShopifyPublicRoute(await webhookRequest(body, { shop: "other.myshopify.com" }), ctx)).status, 401);
  assert.equal((await handleShopifyPublicRoute(await webhookRequest(body, { shop: "evil.com" }), ctx)).status, 401);
  assert.equal((await handleShopifyPublicRoute(await webhookRequest(body, { topic: "customers/redact" }), ctx)).status, 400);
  assert.equal((await handleShopifyPublicRoute(await webhookRequest(body, { id: "short" }), ctx)).status, 400);
  assert.equal((await w.store.listDocs("event", 10)).length, 0);

  // həddindən böyük gövdə
  const bigReq = new Request("https://jarvis.example.dev/shopify/webhook", { method: "POST", headers: { "content-length": String(MAX_WEBHOOK_BYTES + 5) }, body: "x" });
  assert.equal((await handleShopifyPublicRoute(bigReq, ctx)).status, 413);
  const bigBody = "a".repeat(MAX_WEBHOOK_BYTES + 10);
  assert.equal((await handleShopifyPublicRoute(await webhookRequest(bigBody), ctx)).status, 413);

  assert.equal((await handleShopifyPublicRoute(new Request("https://jarvis.example.dev/shopify/webhook"), ctx)).status, 405);
  assert.equal(await handleShopifyPublicRoute(new Request("https://jarvis.example.dev/other"), ctx), null);

  // imza düzgün, JSON pozulub: qəbul + qeyd (parsed:false)
  const r = await handleShopifyPublicRoute(await webhookRequest("{not json", { id: "wh-0003-eeee-ffff" }), ctx);
  assert.equal(r.status, 200);
  const ev = await w.store.listDocs("event", 10);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].parsed, false);

  // imza yoxdur: konfiqurasiya yoxdursa 503
  const w0 = await shopifyWorld({ envExtra: { SHOPIFY_API_SECRET: "" } });
  assert.equal((await handleShopifyPublicRoute(await webhookRequest(body), routeCtx(w0))).status, 503);
});

test("webhook: eyni id ilə 10 paralel çatdırılma yalnız bir dəfə qeyd olunur", async () => {
  const w = await shopifyWorld();
  const ctx = routeCtx(w);
  const rs = await Promise.all(Array.from({ length: 10 }, async () => handleShopifyPublicRoute(await webhookRequest({ id: 5, title: "p" }, { id: "wh-par-0001-xxxx" }), ctx)));
  const texts = await Promise.all(rs.map((r) => r.text()));
  assert.equal(texts.filter((t) => t === "ok").length, 1);
  assert.equal((await w.store.listDocs("event", 20)).length, 1);
});

test("webhook: app/uninstalled tokeni silir, başqa heç nə etmir", async () => {
  const w = await shopifyWorld();
  assert.ok(await w.vault.get("shopify"));
  const r = await handleShopifyPublicRoute(await webhookRequest({ id: 1 }, { topic: "app/uninstalled", id: "wh-uninst-0001-x" }), routeCtx(w));
  assert.equal(r.status, 200);
  assert.equal(await w.vault.get("shopify"), null);
  assert.equal(w.fake.st.calls.length, 0);
  const evs = (await w.audit.list(40)).map((a) => a.event);
  assert.ok(evs.includes("shopify.uninstalled"));
  // başqa mağazanın uninstalled-i tokeni silmir
  const w2 = await shopifyWorld();
  const r2 = await handleShopifyPublicRoute(await webhookRequest({ id: 1 }, { topic: "app/uninstalled", shop: "other.myshopify.com", id: "wh-uninst-0002-x" }), routeCtx(w2));
  assert.equal(r2.status, 401);
  assert.ok(await w2.vault.get("shopify"));
});

test("webhook: sifariş və stok webhook-ları yalnız minimal xülasə saxlayır", async () => {
  const w = await shopifyWorld();
  const ctx = routeCtx(w);
  await handleShopifyPublicRoute(await webhookRequest({ id: 77, name: "#1002", financial_status: "paid", email: "x@y.z", shipping_address: { address1: "gizli küçə" } }, { topic: "orders/create", id: "wh-ord-00001-aa" }), ctx);
  await handleShopifyPublicRoute(await webhookRequest({ inventory_item_id: 5, location_id: 1, available: 3 }, { topic: "inventory_levels/update", id: "wh-inv-00001-aa" }), ctx);
  const evs = await w.store.listDocs("event", 10);
  assert.equal(evs.length, 2);
  const text = JSON.stringify(evs) + (await allAuditText(w));
  assert.equal(text.includes("x@y.z"), false);
  assert.equal(text.includes("gizli küçə"), false);
});

test("registerWebhooks köməkçisi: yalnız mutasiya dəyişənlərini qurur, icazə siyahısından kənarı rədd edir", () => {
  const env = { PUBLIC_BASE_URL: "https://jarvis.example.dev" };
  const m = buildWebhookMutations(env);
  assert.equal(m.length, 6);
  assert.ok(m.every((x) => x.variables.webhookSubscription.uri === "https://jarvis.example.dev/shopify/webhook" && x.variables.webhookSubscription.format === "JSON"));
  assert.ok(m.some((x) => x.variables.topic === "APP_UNINSTALLED"));
  assert.throws(() => buildWebhookMutations(env, ["customers/redact"]), /topic/);
  assert.throws(() => buildWebhookMutations({}), /PUBLIC_BASE_URL/);
});

// ---------------------------------------------------------------------------------------------------
test("API marşrutları: connect, status, disconnect (token heç vaxt qaytarılmır)", async () => {
  const w = await shopifyWorld({ connected: false, envExtra: { SHOPIFY_SHOP: SHOP } });
  const ctx = routeCtx(w);
  const post = (path, body) => new Request("https://jarvis.example.dev" + path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  let r = await handleShopifyApiRoute(post("/api/shopify/connect", { shop: SHOP }), ctx);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(new URL(j.url).host, SHOP);
  assert.equal(j.expires_in, 600);
  r = await handleShopifyApiRoute(post("/api/shopify/connect", {}), ctx); // SHOPIFY_SHOP standartı
  assert.equal(r.status, 200);
  r = await handleShopifyApiRoute(post("/api/shopify/connect", { shop: "evil.com" }), ctx);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "VALIDATION_ERROR");
  r = await handleShopifyApiRoute(new Request("https://x.dev/api/shopify/connect", { method: "POST", body: "{bad" }), ctx);
  assert.equal(r.status, 400);
  r = await handleShopifyApiRoute(new Request("https://x.dev/api/shopify/connect", { method: "GET" }), ctx);
  assert.equal(r.status, 405);

  // qoş (callback) və status
  const state = stateOf(j.url);
  const cb = await handleShopifyPublicRoute(new Request("https://jarvis.example.dev/oauth/shopify/callback?" + (await signedCallback(w, { state })).toString()), ctx);
  assert.equal(cb.status, 200);
  assert.equal(/faketok/.test(await cb.clone().text()), false);
  r = await handleShopifyApiRoute(new Request("https://x.dev/api/shopify/status"), ctx);
  const st = await r.json();
  assert.equal(st.connected, true);
  assert.equal(st.token_present, true);
  assert.equal(st.shop, SHOP);
  assert.equal(JSON.stringify(st).includes(FAKE_TOKEN), false);
  assert.equal(st.configured.api_secret, true);
  assert.equal(JSON.stringify(st).includes(FAKE_SECRET), false);

  r = await handleShopifyApiRoute(post("/api/shopify/disconnect"), ctx);
  assert.equal((await r.json()).disconnected, true);
  assert.equal(await w.vault.get("shopify"), null);
  st.connected = null;
  r = await handleShopifyApiRoute(new Request("https://x.dev/api/shopify/status"), ctx);
  assert.equal((await r.json()).token_present, false);
  assert.equal(await handleShopifyApiRoute(new Request("https://x.dev/api/other"), ctx), null);
  assert.equal((await handleShopifyApiRoute(new Request("https://x.dev/api/shopify/zzz"), ctx)).status, 404);
});

test("OAuth callback marşrutu: GET-dən başqa metod rədd, pis imza 400 və HTML-də token yoxdur", async () => {
  const w = await shopifyWorld({ connected: false });
  const ctx = routeCtx(w);
  assert.equal((await handleShopifyPublicRoute(new Request("https://jarvis.example.dev/oauth/shopify/callback", { method: "POST" }), ctx)).status, 405);
  const r = await handleShopifyPublicRoute(new Request("https://jarvis.example.dev/oauth/shopify/callback?shop=" + SHOP + "&code=x&hmac=00&state=" + "0".repeat(32) + "&timestamp=1"), ctx);
  assert.equal(r.status, 400);
  assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(w.fake.st.calls.length, 0);
});

test("imza köməkçisi: testin müstəqil hesablaması Shopify qaydasına uyğundur (sıralama, hmac xaric)", async () => {
  const p = { b: "2", a: "1", hmac: "ignored", c: "x y" };
  const sig = await signOAuthParams(p);
  const usp = new URLSearchParams({ c: "x y", a: "1", b: "2", hmac: sig });
  assert.equal(await verifyOAuthHmac(usp, FAKE_SECRET), true);
  usp.set("a", "2");
  assert.equal(await verifyOAuthHmac(usp, FAKE_SECRET), false);
  assert.equal(await verifyOAuthHmac(usp, ""), false);
  void jsonRes;
});
