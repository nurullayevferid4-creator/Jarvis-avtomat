// Real adapterlər: sorğunun düzgün qurulması (rəsmi sənədlə yoxlanmış forma), cavabın təhlükəsiz ayrışdırılması, xəta idarəsi.
// Hamısı saxta request ilə. Bu testlər sorğunun FORMASINI yoxlayır; platforma ilə real işləməni YOX (bax tests/live-integrations.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { createIntegrationRegistry } from "../src/integrations/registry.js";
import { InstagramAdapter } from "../src/integrations/instagram.js";
import { ShopifyAdapter } from "../src/integrations/shopify.js";
import { TelegramAdapter } from "../src/integrations/telegram.js";
import { fakeRequest, FULL_ENV, TOK, TG_TOKEN, err } from "./wiring-helpers.mjs";

const reg = (handler, env = FULL_ENV) => { const request = fakeRequest(handler); return { request, r: createIntegrationRegistry(env, { request }) }; };
const J = (data, status = 200) => ({ ok: status < 400, status, data });
const sameOrigin = (u) => new URL(u);

// ---------- Instagram ----------
test("Instagram account.get: graph.instagram.com/v25.0/me, sənədləşdirilmiş sahələr, token yalnız access_token parametrində", async () => {
  const { request, r } = reg(() => J({ id: "1", user_id: "17841", username: "fnparfum", account_type: "BUSINESS", followers_count: 10, media_count: 3, secret_extra: "atılır" }));
  const out = await r.run("instagram", "account.get", {});
  const u = sameOrigin(request.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://graph.instagram.com/v25.0/me");
  assert.equal(u.searchParams.get("access_token"), TOK);
  assert.deepEqual(u.searchParams.get("fields").split(","), ["user_id", "username", "name", "account_type", "profile_picture_url", "followers_count", "follows_count", "media_count"]);
  assert.equal(request.calls[0].init.method || "GET", "GET");
  assert.equal(request.calls[0].init.redirect, "manual", "yönləndirmə izlənmir");
  assert.equal(out.mock, false);
  assert.equal(out.untrusted, true);
  assert.equal(out.data.username, "fnparfum");
  assert.equal(out.data.secret_extra, undefined, "gözlənilməyən sahə atılır");
  assert.ok(!JSON.stringify(out).includes(TOK));
});

test("Instagram media.list: əvvəl /me (user_id), sonra /<IG_ID>/media (/me/media istifadə OLUNMUR), sahələr açıq istənir, səhifələmə", async () => {
  const { request, r } = reg((url) => {
    if (new URL(url).pathname === "/v25.0/me") return J({ user_id: "17841400000", id: "9" });
    return J({ data: [{ id: "m1", caption: "salam", media_type: "IMAGE", permalink: "https://x", like_count: 4, hidden: "x" }], paging: { cursors: { after: "CUR1" }, next: "https://graph.instagram.com/next" } });
  });
  const out = await r.run("instagram", "media.list", { limit: 5, after: "AFTER0" });
  assert.equal(request.calls.length, 2);
  const m = sameOrigin(request.calls[1].url);
  assert.equal(m.pathname, "/v25.0/17841400000/media");
  assert.equal(m.searchParams.get("limit"), "5");
  assert.equal(m.searchParams.get("after"), "AFTER0");
  assert.ok(m.searchParams.get("fields").includes("caption") && m.searchParams.get("fields").includes("timestamp"));
  assert.ok(!request.calls.some((c) => sameOrigin(c.url).pathname === "/v25.0/me/media"));
  assert.deepEqual(out.data.items[0], { id: "m1", caption: "salam", media_type: "IMAGE", permalink: "https://x", like_count: 4 });
  assert.equal(out.data.next, "CUR1");
});

test("Instagram insights.get: hesab üçün metric+period+metric_type, media üçün /<MEDIA_ID>/insights; metrik adı və media id yoxlanır", async () => {
  const { request, r } = reg((url) => (new URL(url).pathname.endsWith("/me") ? J({ user_id: "555" }) : J({ data: [{ name: "reach", period: "day", total_value: { value: 7 }, title: "Reach", extra: 1 }] })));
  const a = await r.run("instagram", "insights.get", { metrics: ["reach", "views"], period: "week" });
  const u = sameOrigin(request.calls[1].url);
  assert.equal(u.pathname, "/v25.0/555/insights");
  assert.equal(u.searchParams.get("metric"), "reach,views");
  assert.equal(u.searchParams.get("period"), "week");
  assert.equal(u.searchParams.get("metric_type"), "total_value");
  assert.deepEqual(a.data.metrics[0].total_value, { value: 7 });
  const before = request.calls.length;
  await r.run("instagram", "insights.get", { metrics: ["reach"], media_id: "1789" });
  assert.equal(sameOrigin(request.calls[before].url).pathname, "/v25.0/1789/insights");
  assert.equal(request.calls.length, before + 1, "media insights üçün /me lazım deyil");
  for (const bad of [{ metrics: ["a/b"] }, { metrics: ["reach"], media_id: "1/../me" }, { metrics: ["Reach"] }]) {
    assert.equal((await err(r.run("instagram", "insights.get", bad))).code, "invalid_input", JSON.stringify(bad));
  }
  assert.equal((await err(r.run("instagram", "media.list", { after: "a b&c=d" }))).code, "invalid_input");
});

test("Instagram: platforma xətası (401 OAuthException) düzgün xəta olur, token/mətn sızmır; yanlış formada cavab 'fake uğur' olmur", async () => {
  const { r } = reg(() => J(JSON.stringify({ error: { message: "Invalid OAuth access token " + TOK, type: "OAuthException", code: 190 } }), 401));
  const e = await err(r.run("instagram", "account.get", {}));
  assert.equal(e.code, "upstream_error");
  assert.equal(e.status, 401);
  assert.equal(e.reason, "OAuthException");
  assert.ok(!e.message.includes(TOK) && !e.message.includes("Invalid OAuth"));
  const shape = reg(() => J({ error: { message: "x" } })).r;
  assert.equal((await err(shape.run("instagram", "account.get", {}))).code, "upstream_error");
  const garbage = reg(() => J("<html>")).r;
  assert.equal((await err(garbage.run("instagram", "account.get", {}))).code, "upstream_error");
});

// ---------- TikTok ----------
test("TikTok account.get: GET /v2/user/info/?fields (yalnız user.info.basic), Authorization: Bearer; profil/statistika yalnız istəyəndə", async () => {
  const { request, r } = reg(() => J({ data: { user: { open_id: "o1", display_name: "FN", avatar_url: "https://a", extra: 1 } }, error: { code: "ok", message: "", log_id: "L" } }));
  const out = await r.run("tiktok", "account.get", {});
  const c = request.calls[0];
  assert.equal(c.url, "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name");
  assert.equal(c.init.headers.authorization, "Bearer " + TOK);
  assert.deepEqual(out.data, { open_id: "o1", avatar_url: "https://a", display_name: "FN" });
  await r.run("tiktok", "account.get", { include_stats: true });
  assert.ok(request.calls[1].url.includes("follower_count,following_count,likes_count,video_count"));
  assert.ok(!request.calls[1].url.includes("bio_description"));
});

test("TikTok videos.list: POST /v2/video/list/, max_count ≤ 20, cursor tam ədəd; videos.get: POST /v2/video/query/ filters.video_ids ≤ 20", async () => {
  const { request, r } = reg(() => J({ data: { videos: [{ id: "1", title: "t", view_count: 5, like_count: 1 }], cursor: 1700000000000, has_more: true }, error: { code: "ok" } }));
  const out = await r.run("tiktok", "videos.list", { limit: 50, after: "1699999999999" });
  const c = request.calls[0];
  assert.equal(c.init.method, "POST");
  assert.ok(c.url.startsWith("https://open.tiktokapis.com/v2/video/list/?fields=id,title"));
  assert.deepEqual(JSON.parse(c.body), { max_count: 20, cursor: 1699999999999 });
  assert.equal(c.init.headers["content-type"], "application/json");
  assert.equal(out.data.next, "1700000000000");
  assert.equal(out.data.items[0].view_count, 5);
  await r.run("tiktok", "videos.get", { video_ids: ["11", "22"] });
  assert.equal(request.calls[1].url.split("?")[0], "https://open.tiktokapis.com/v2/video/query/");
  assert.deepEqual(JSON.parse(request.calls[1].body), { filters: { video_ids: ["11", "22"] } });
  assert.equal((await err(r.run("tiktok", "videos.get", { video_ids: Array.from({ length: 21 }, (_, i) => String(i + 1)) }))).code, "invalid_input");
  assert.equal((await err(r.run("tiktok", "videos.get", { video_ids: ["../x"] }))).code, "invalid_input");
  assert.equal((await err(r.run("tiktok", "videos.list", { after: "abc" }))).code, "invalid_input");
});

test("TikTok: error.code 'ok' deyilsə və ya 401 access_token_invalid olarsa düzgün xəta", async () => {
  const bad = reg(() => J({ data: {}, error: { code: "rate_limit_exceeded", message: "x" } })).r;
  assert.equal((await err(bad.run("tiktok", "videos.list", {}))).code, "upstream_error");
  const e = await err(reg(() => J(JSON.stringify({ error: { code: "access_token_invalid", message: "Access token is invalid" } }), 401)).r.run("tiktok", "account.get", {}));
  assert.equal(e.status, 401);
  assert.equal(e.reason, "access_token_invalid");
});

// ---------- YouTube ----------
test("YouTube: token yeniləmə POST oauth2.googleapis.com/token (form), sonra Bearer ilə channels.list?mine=true; access token nəticədə yoxdur", async () => {
  const { request, r } = reg((url, init) => {
    if (url === "https://oauth2.googleapis.com/token") return J({ access_token: "ya29.ACCESS-SECRET-VALUE", expires_in: 3600, token_type: "Bearer", scope: "x" });
    return J({ items: [{ id: "UC1", snippet: { title: "Kanal" }, statistics: { viewCount: "9", subscriberCount: "3", videoCount: "2" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] });
  });
  const out = await r.run("youtube", "channel.get", {});
  const t = request.calls[0];
  assert.equal(t.init.method, "POST");
  assert.equal(t.init.headers["content-type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(t.body);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("client_id"), TOK + "1");
  assert.equal(form.get("refresh_token"), TOK + "3");
  const c = request.calls[1];
  assert.equal(c.url, "https://www.googleapis.com/youtube/v3/channels?part=snippet%2Cstatistics%2CcontentDetails&mine=true");
  assert.equal(c.init.headers.authorization, "Bearer ya29.ACCESS-SECRET-VALUE");
  assert.deepEqual(out.data, { id: "UC1", title: "Kanal", statistics: { viewCount: "9", subscriberCount: "3", videoCount: "2" } });
  assert.ok(!JSON.stringify(out).includes("ACCESS-SECRET"));
});

test("YouTube videos.list: channels(contentDetails) -> uploads playlist -> playlistItems (maxResults ≤ 50, pageToken); video.get: videos?id=", async () => {
  const { request, r } = reg((url) => {
    if (url.includes("oauth2")) return J({ access_token: "tok", token_type: "Bearer" });
    if (url.includes("/channels")) return J({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UUabc123" } } }] });
    if (url.includes("/playlistItems")) return J({ items: [{ snippet: { title: "V1", publishedAt: "2026-01-01T00:00:00Z" }, contentDetails: { videoId: "vid12345678" } }], nextPageToken: "NPT" });
    return J({ items: [{ id: "vid12345678", snippet: { title: "V1", publishedAt: "2026-01-01" }, contentDetails: { duration: "PT1M" }, statistics: { viewCount: "5" } }] });
  });
  const out = await r.run("youtube", "videos.list", { limit: 3, after: "PT_1" });
  const p = sameOrigin(request.calls[2].url);
  assert.equal(p.pathname, "/youtube/v3/playlistItems");
  assert.equal(p.searchParams.get("playlistId"), "UUabc123");
  assert.equal(p.searchParams.get("maxResults"), "3");
  assert.equal(p.searchParams.get("pageToken"), "PT_1");
  assert.deepEqual(out.data.items[0], { video_id: "vid12345678", title: "V1", published_at: "2026-01-01T00:00:00Z" });
  assert.equal(out.data.next, "NPT");
  const v = await r.run("youtube", "video.get", { video_id: "vid12345678" });
  assert.equal(sameOrigin(request.calls[request.calls.length - 1].url).searchParams.get("id"), "vid12345678");
  assert.equal(v.data.statistics.viewCount, "5");
  assert.equal((await err(r.run("youtube", "video.get", { video_id: "a/b" }))).code, "invalid_input");
});

test("YouTube: refresh token etibarsızdırsa (400 invalid_grant) video sorğusuna keçilmir; xəta düzgündür, secret sızmır", async () => {
  const { request, r } = reg(() => J(JSON.stringify({ error: "invalid_grant", error_description: "Bad " + TOK }), 400));
  const e = await err(r.run("youtube", "channel.get", {}));
  assert.equal(e.code, "upstream_error");
  assert.equal(e.reason, "invalid_grant");
  assert.equal(request.calls.length, 1);
  assert.ok(!e.message.includes(TOK) && !e.message.includes("Bad"));
});

// ---------- Telegram ----------
test("Telegram bot.get/updates.receive/voice.get: api.telegram.org/bot<token>/METHOD; getUpdates yalnız allowlist çatlarını qaytarır", async () => {
  const { request, r } = reg((url) => {
    if (url.includes("/getMe")) return J({ ok: true, result: { id: 1, is_bot: true, first_name: "J", username: "jarvis_bot", secret: "x" } });
    if (url.includes("/getUpdates")) return J({ ok: true, result: [{ update_id: 10, message: { message_id: 1, chat: { id: 4242 }, text: "salam" } }, { update_id: 11, message: { message_id: 2, chat: { id: 999 }, text: "yad adam" } }] });
    return J({ ok: true, result: { file_id: "f1", file_unique_id: "u1", file_size: 100, file_path: "voice/file_1.oga" } });
  });
  assert.equal((await r.run("telegram", "bot.get", {})).data.username, "jarvis_bot");
  assert.equal(request.calls[0].url, "https://api.telegram.org/bot" + TG_TOKEN + "/getMe");
  const up = await r.run("telegram", "updates.receive", { limit: 5, offset: 3 });
  const u = sameOrigin(request.calls[1].url);
  assert.equal(u.pathname, "/bot" + TG_TOKEN + "/getUpdates");
  assert.equal(u.searchParams.get("timeout"), "0");
  assert.equal(u.searchParams.get("limit"), "5");
  assert.equal(u.searchParams.get("offset"), "3");
  assert.equal(up.data.updates.length, 1, "naməlum çat qəbul edilmir");
  assert.equal(up.data.updates[0].chatId, "4242");
  assert.equal(up.data.rejected_count, 1);
  assert.equal(up.data.max_update_id, 11);
  assert.ok(!JSON.stringify(up).includes("yad adam"), "naməlum çatın mətni nəticəyə düşmür");
  const f = await r.run("telegram", "voice.get", { file_id: "f1" });
  assert.deepEqual(f.data, { file_id: "f1", file_unique_id: "u1", file_size: 100, downloadable: true });
  assert.equal(JSON.stringify(f).includes("file_1.oga"), false, "fayl yolu qaytarılmır (yükləmə ünvanı yoxlanmayıb)");
  assert.equal((await err(r.run("telegram", "voice.get", { file_id: "a/b" }))).code, "invalid_input");
});

test("Telegram: bot token yol-inyeksiyası: düzgün formada olmayan token 'not_configured' sayılır, şəbəkə yoxdur; allowlist boşdursa da", async () => {
  for (const bad of ["x/../y", "123:abc", "123456789:AAA BBB CCCDDDEEE", ""]) {
    const { request, r } = reg(() => J({ ok: true, result: {} }), { ...FULL_ENV, TELEGRAM_BOT_TOKEN: bad });
    assert.equal((await err(r.run("telegram", "bot.get", {}))).code, "not_configured", JSON.stringify(bad));
    assert.equal(request.calls.length, 0);
  }
  const { request, r } = reg(() => J({ ok: true, result: {} }), { ...FULL_ENV, TELEGRAM_ALLOWED_CHAT_IDS: "" });
  assert.equal((await err(r.run("telegram", "bot.get", {}))).code, "not_configured");
  assert.equal(request.calls.length, 0);
});

test("Telegram: sendMessage yalnız allowlist çatına gedir (chat_id/text JSON); replyToOwner naməlum çata göndərmir", async () => {
  const { request } = reg();
  const sent = [];
  const tg = new TelegramAdapter({ env: FULL_ENV, request: async (url, init) => { sent.push({ url, init }); return J({ ok: true, result: { message_id: 7 } }); } });
  const out = await tg.replyToOwner("4242", "salam");
  assert.deepEqual(out.data, { sent: true, message_id: 7 });
  assert.equal(sent[0].url, "https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage");
  assert.deepEqual(JSON.parse(sent[0].init.body), { chat_id: "4242", text: "salam" });
  assert.equal(JSON.parse(sent[0].init.body).parse_mode, undefined, "parse_mode yoxdur: mətn kod kimi şərh olunmur");
  for (const id of ["999", "4242 ", "-1", "../4242"]) assert.equal((await err(tg.replyToOwner(id, "x"))).code, "forbidden_target", id);
  assert.equal(sent.length, 1);
  assert.equal(request.calls.length, 0);
});

// ---------- Shopify ----------
test("Shopify: POST https://<mağaza>/admin/api/<versiya>/graphql.json, X-Shopify-Access-Token, GraphQL sorğusu və dəyişənlər", async () => {
  const { request, r } = reg(() => J({ data: { shop: { name: "FN Parfum", currencyCode: "AZN", myshopifyDomain: "demo-shop.myshopify.com", plan: { publicDisplayName: "Basic", shopifyPlus: false, partnerDevelopment: false } } } }));
  const out = await r.run("shopify", "shop.get", {});
  const c = request.calls[0];
  assert.equal(c.url, "https://demo-shop.myshopify.com/admin/api/2026-07/graphql.json");
  assert.equal(c.init.method, "POST");
  assert.equal(c.init.headers["x-shopify-access-token"], TOK);
  assert.equal(c.init.headers["content-type"], "application/json");
  assert.ok(JSON.parse(c.body).query.includes("plan { publicDisplayName shopifyPlus partnerDevelopment }"), "köhnəlmiş plan.displayName istifadə olunmur");
  assert.deepEqual(out.data, { name: "FN Parfum", currencyCode: "AZN", myshopifyDomain: "demo-shop.myshopify.com", plan: { publicDisplayName: "Basic", shopifyPlus: false, partnerDevelopment: false } });
});

test("Shopify products/orders/customers: first/after dəyişənləri, nodes+pageInfo, köhnəlmiş Customer.email sorğulanmır, sifarişdə müştəri məlumatı yoxdur", async () => {
  const { request, r } = reg((url, init) => {
    const q = JSON.parse(init.body).query;
    if (q.includes("products(")) return J({ data: { products: { nodes: [{ id: "gid://shopify/Product/1", title: "Ətir", status: "ACTIVE", handle: "etir", totalInventory: 4, priceRangeV2: { minVariantPrice: { amount: "10.0", currencyCode: "AZN" }, maxVariantPrice: { amount: "20.0", currencyCode: "AZN" } } }], pageInfo: { hasNextPage: true, endCursor: "C1" } } } });
    if (q.includes("orders(")) return J({ data: { orders: { nodes: [{ id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-10-01T00:00:00Z", displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED", totalPriceSet: { shopMoney: { amount: "30.0", currencyCode: "AZN" } } }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    return J({ data: { customers: { nodes: [{ id: "gid://shopify/Customer/1", displayName: "Ayşən", numberOfOrders: "2" }], pageInfo: { hasNextPage: false } } } });
  });
  const p = await r.run("shopify", "products.list", { limit: 7, after: "CUR0" });
  assert.deepEqual(JSON.parse(request.calls[0].body).variables, { first: 7, after: "CUR0" });
  assert.deepEqual(p.data.items[0].price_min, { amount: "10.0", currencyCode: "AZN" });
  assert.equal(p.data.next, "C1");
  const o = await r.run("shopify", "orders.list", {});
  const oq = JSON.parse(request.calls[1].body).query;
  assert.ok(!/email|phone|address|customer\b|billingAddress|shippingAddress/i.test(oq), "sifariş sorğusunda şəxsi məlumat sahəsi yoxdur");
  assert.equal(o.data.items[0].total.amount, "30.0");
  assert.equal(o.data.next, null);
  const c = await r.run("shopify", "customers.list", {});
  const cq = JSON.parse(request.calls[2].body).query;
  assert.ok(!/\bemail\b|phone|address/i.test(cq), "Customer.email köhnəlib və PII sorğulanmır");
  assert.deepEqual(c.data.items[0], { id: "gid://shopify/Customer/1", displayName: "Ayşən", numberOfOrders: "2" });
  assert.equal((await err(r.run("shopify", "products.list", { after: "x y" }))).code, "invalid_input");
});

test("Shopify: HTTP 200 + errors massivi (THROTTLED/ACCESS_DENIED) 'uğur' DEYİL, düzgün xəta olur", async () => {
  const e = await err(reg(() => J({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] })).r.run("shopify", "products.list", {}));
  assert.equal(e.code, "upstream_error");
  assert.equal(e.reason, "THROTTLED");
  assert.match(e.message, /THROTTLED/);
  assert.equal((await err(reg(() => J({ errors: [{ extensions: { code: "ACCESS_DENIED" } }] })).r.run("shopify", "shop.get", {}))).reason, "ACCESS_DENIED");
  assert.equal((await err(reg(() => J({})).r.run("shopify", "shop.get", {}))).code, "upstream_error", "data yoxdursa saxta uğur olmur");
  const http401 = await err(reg(() => J("Unauthorized", 401)).r.run("shopify", "shop.get", {}));
  assert.equal(http401.status, 401);
});

test("Shopify: SHOPIFY_ADMIN_TOKEN yoxdursa Dev Dashboard client_credentials ilə token alınır (24 saatlıq), sonra GraphQL", async () => {
  const env = { SHOPIFY_STORE_DOMAIN: "demo-shop.myshopify.com", SHOPIFY_CLIENT_ID: "client-id-1234", SHOPIFY_CLIENT_SECRET: "client-secret-5678" };
  const { request, r } = reg((url, init) => (url.endsWith("/admin/oauth/access_token") ? J({ access_token: "shpat_DYNAMIC_TOKEN", scope: "read_products", expires_in: 86399 }) : J({ data: { shop: { name: "N", currencyCode: "AZN" } } })), env);
  const out = await r.run("shopify", "shop.get", {});
  assert.equal(request.calls[0].url, "https://demo-shop.myshopify.com/admin/oauth/access_token");
  const form = new URLSearchParams(request.calls[0].body);
  assert.equal(form.get("grant_type"), "client_credentials");
  assert.equal(request.calls[1].init.headers["x-shopify-access-token"], "shpat_DYNAMIC_TOKEN");
  assert.ok(!JSON.stringify(out).includes("DYNAMIC_TOKEN"));
  assert.equal(createIntegrationRegistry(env).get("shopify").status().configured, true);
});

test("Shopify: SHOPIFY_API_VERSION yalnız rüblük formatda qəbul olunur, əks halda standart", async () => {
  const run = async (v) => { const { request, r } = reg(() => J({ data: { shop: { name: "N" } } }), { ...FULL_ENV, SHOPIFY_API_VERSION: v }); await r.run("shopify", "shop.get", {}); return request.calls[0].url; };
  assert.ok((await run("2026-10")).includes("/admin/api/2026-10/"));
  assert.ok((await run("../../evil")).includes("/admin/api/2026-07/"));
  assert.ok((await run("2026-13")).includes("/admin/api/2026-07/"));
});

// ---------- Ümumi: SSRF host allowlist, yönləndirmə, credential-sız ----------
test("SSRF: endpoint başqa host qaytarsa belə sorğu getmir (host allowlist); redirect:'manual'", async () => {
  for (const evil of ["https://evil.example/x", "http://graph.instagram.com/x", "https://graph.instagram.com.evil.example/x", "https://user:pw@graph.instagram.com/x", "https://graph.instagram.com:8443/x", "https://169.254.169.254/latest", "https://localhost/x"]) {
    const request = fakeRequest(() => J({}));
    const ig = new InstagramAdapter({ env: FULL_ENV, request, endpoints: { "account.get": { verified: true, build: () => ({ url: evil }), parse: (d) => d } } });
    const e = await err(ig.run("account.get", {}));
    assert.equal(e && e.code, "upstream_error", evil);
    assert.equal(request.calls.length, 0, evil);
  }
});

test("Shopify SSRF: domen allowlist yalnız konfiqurasiyadakı <ad>.myshopify.com; başqa domen konfiqurasiyanı pozur", async () => {
  for (const d of ["evil.com", "demo-shop.myshopify.com.evil.com", "169.254.169.254", "localhost"]) {
    const request = fakeRequest(() => J({ data: {} }));
    const sh = new ShopifyAdapter({ env: { ...FULL_ENV, SHOPIFY_STORE_DOMAIN: d }, request });
    assert.equal((await err(sh.run("shop.get", {}))).code, "not_configured", d);
    assert.equal(request.calls.length, 0);
  }
});

test("credential olmadan: 5 platformanın hər oxuma əməliyyatı not_configured verir, şəbəkəyə çıxmır (saxta nəticə yoxdur)", async () => {
  const { request, r } = reg(() => J({}), {});
  const inputs = { "videos.get": { video_ids: ["1"] }, "insights.get": { metrics: ["reach"] }, "video.get": { video_id: "abcDEF12345" }, "voice.get": { file_id: "f1" } };
  for (const id of r.list()) for (const op of r.get(id).status().readOperations) {
    const e = await err(r.run(id, op, inputs[op] || {}));
    assert.equal(e.code, "not_configured", id + "." + op);
  }
  assert.equal(request.calls.length, 0);
});

test("hər endpoint-in sənəd mənbəyi başlıq şərhində göstərilib (verified yalnız sənədlə yoxlananlarda)", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["instagram", "tiktok", "youtube", "telegram", "shopify"]) {
    const t = readFileSync("src/integrations/" + f + ".js", "utf8");
    assert.match(t, /Rəsmi sənəd yoxlaması \(2026-10-05/, f);
  }
  const probe = createIntegrationRegistry({});
  for (const s of probe.statuses()) assert.ok(s.disabledWriteOperations.length + s.approvalOnlyWriteOperations.length >= 1, s.id + ": yazma interfeysləri mövcuddur");
  assert.deepEqual(probe.get("telegram").status().approvalOnlyWriteOperations, ["message.send"]);
  for (const id of ["instagram", "tiktok", "youtube", "shopify"]) assert.deepEqual(probe.get(id).status().approvalOnlyWriteOperations, [], id + ": yoxlanmamış yazma endpoint-i icra oluna bilməz");
});
