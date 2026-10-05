// Təsdiqli YAZMA adapterləri: sorğunun forması (rəsmi sənədə görə), təsdiq sübutu tələbi, xəta idarəsi, token sızması yoxdur.
// Hamısı saxta request ilə. Platforma ilə real işləməni YOX, sorğunun FORMASINI yoxlayır (bax tests/live-integrations.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { InstagramAdapter } from "../src/integrations/instagram.js";
import { TikTokAdapter } from "../src/integrations/tiktok.js";
import { YouTubeAdapter } from "../src/integrations/youtube.js";
import { ShopifyAdapter } from "../src/integrations/shopify.js";
import { fakeRequest, FULL_ENV, TOK, err } from "./wiring-helpers.mjs";
import { mintProof, hashInput } from "../src/approval/proof.js";

const J = (data, status = 200) => ({ ok: status < 400, status, data });
const proofFor = async (tool, input) => mintProof({ approvalId: "1234567890123-abcdef", tool, inputHash: await hashInput(input), expiresAt: Date.now() + 60000 });
const noSleep = async () => {};
const hdr = (c, k) => { const h = c.init.headers || {}; const key = Object.keys(h).find((x) => x.toLowerCase() === k); return key ? h[key] : undefined; };

// ---------- Instagram ----------
function igHandler({ status = ["FINISHED"] } = {}) {
  let st = 0;
  return (url, init) => {
    const u = new URL(url);
    if (u.pathname === "/v25.0/me") return J({ user_id: "1784", username: "x" });
    if (u.pathname === "/v25.0/1784/media" && init.method === "POST") return J({ id: "9001" });
    if (u.pathname === "/v25.0/9001" && u.searchParams.get("fields") === "status_code") return J({ status_code: status[Math.min(st++, status.length - 1)] });
    if (u.pathname === "/v25.0/1784/media_publish") return J({ id: "7001" });
    if (u.pathname === "/v25.0/1784/messages") return J({ recipient_id: "555", message_id: "mid.1" });
    if (u.pathname === "/v25.0/66/replies") return J({ id: "88" });
    return undefined;
  };
}
const ig = (handler, extra = {}) => { const request = fakeRequest(handler); return { request, a: new InstagramAdapter({ env: FULL_ENV, request, sleep: noSleep, ...extra }) }; };

test("Instagram media.publish: /<IG_ID>/media (JSON, Bearer) -> status_code -> /<IG_ID>/media_publish {creation_id}", async () => {
  const { request, a } = ig(igHandler());
  const input = { image_url: "https://cdn.example.com/p/a.jpg", caption: "Yeni ətir" };
  const r = await a.runApproved("media.publish", input, await proofFor("instagram.media.publish", input));
  assert.deepEqual(r.data, { published: true, media_id: "7001", container_id: "9001" });
  const posts = request.calls.filter((c) => c.init.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(new URL(posts[0].url).pathname, "/v25.0/1784/media");
  assert.deepEqual(JSON.parse(posts[0].body), { image_url: input.image_url, caption: "Yeni ətir" });
  assert.equal(hdr(posts[0], "authorization"), "Bearer " + TOK);
  assert.equal(hdr(posts[0], "content-type"), "application/json");
  assert.ok(!posts[0].url.includes(TOK), "yazma sorğusunda token URL-də deyil, başlıqdadır");
  assert.deepEqual(JSON.parse(posts[1].body), { creation_id: "9001" });
  assert.ok(!JSON.stringify(r).includes(TOK));
});

test("Instagram media.publish: konteyner hazır deyilsə PUBLISH EDİLMİR (published:false), sonra container.publish ilə dərc olunur; ERROR olarsa xəta", async () => {
  const a1 = ig(igHandler({ status: ["IN_PROGRESS"] }));
  const input = { image_url: "https://cdn.example.com/p/a.jpg" };
  const r = await a1.a.runApproved("media.publish", input, await proofFor("instagram.media.publish", input));
  assert.deepEqual(r.data, { published: false, container_id: "9001", status_code: "IN_PROGRESS" });
  assert.ok(!a1.request.calls.some((c) => c.url.includes("media_publish")));

  const a2 = ig(igHandler({ status: ["FINISHED"] }));
  const ci = { container_id: "9001" };
  const r2 = await a2.a.runApproved("container.publish", ci, await proofFor("instagram.container.publish", ci));
  assert.equal(r2.data.published, true);

  const a3 = ig(igHandler({ status: ["ERROR"] }));
  const e = await err(a3.a.runApproved("media.publish", input, await proofFor("instagram.media.publish", input)));
  assert.equal(e.code, "upstream_error");
  assert.ok(!a3.request.calls.some((c) => c.url.includes("media_publish")));
});

test("Instagram media.publish: ictimai olmayan/təhlükəli şəkil ünvanı şəbəkəyə çıxmadan rədd olunur", async () => {
  const { request, a } = ig(igHandler());
  for (const image_url of ["http://cdn.example.com/a.jpg", "https://127.0.0.1/a.jpg", "https://localhost/a.jpg", "https://user:pw@cdn.example.com/a.jpg", "https://169.254.169.254/x.jpg", "ftp://x.com/a.jpg", "javascript:alert(1)", "https://intranet.local/a.jpg"]) {
    const input = { image_url };
    const e = await err(a.runApproved("media.publish", input, await proofFor("instagram.media.publish", input)));
    assert.equal(e.code, "invalid_input", image_url);
  }
  assert.equal(request.calls.length, 0);
});

test("Instagram messages.send: POST /<IG_ID>/messages {recipient:{id}, message:{text}}, Bearer; 1000 bayt limiti və IGSID formatı yoxlanır", async () => {
  const { request, a } = ig(igHandler());
  const input = { recipient_id: "555", text: "Salam, sifarişiniz hazırdır" };
  const r = await a.runApproved("messages.send", input, await proofFor("instagram.messages.send", input));
  assert.equal(r.data.sent, true);
  const c = request.calls.find((x) => new URL(x.url).pathname === "/v25.0/1784/messages");
  assert.deepEqual(JSON.parse(c.body), { recipient: { id: "555" }, message: { text: input.text } });
  assert.equal(hdr(c, "authorization"), "Bearer " + TOK);
  const before = request.calls.length;
  for (const bad of [{ recipient_id: "abc", text: "x" }, { recipient_id: "5 5", text: "x" }, { recipient_id: "555", text: "ə".repeat(600) }, { recipient_id: "555", text: "" }]) {
    const e = await err(a.runApproved("messages.send", bad, await proofFor("instagram.messages.send", bad)));
    assert.equal(e.code, "invalid_input", JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(request.calls.length, before);
});

test("Instagram comments.reply: POST /<COMMENT_ID>/replies {message}", async () => {
  const { request, a } = ig(igHandler());
  const input = { comment_id: "66", text: "Təşəkkürlər!" };
  const r = await a.runApproved("comments.reply", input, await proofFor("instagram.comments.reply", input));
  assert.equal(r.data.replied, true);
  const c = request.calls.find((x) => x.url.includes("/66/replies"));
  assert.deepEqual(JSON.parse(c.body), { message: "Təşəkkürlər!" });
  assert.equal(hdr(c, "authorization"), "Bearer " + TOK);
});

test("Instagram yazma: sübutsuz/başqa girişli sübutla icra yoxdur, run() disabled, platforma xətası düzgün xətadır və token sızmır", async () => {
  const { request, a } = ig(igHandler());
  const input = { recipient_id: "555", text: "salam" };
  assert.equal((await err(a.runApproved("messages.send", input))).code, "approval_required");
  assert.equal((await err(a.runApproved("messages.send", input, await proofFor("instagram.messages.send", { ...input, text: "başqa" })))).code, "approval_required");
  assert.equal((await err(a.runApproved("messages.send", input, await proofFor("instagram.comments.reply", input)))).code, "approval_required");
  assert.equal((await err(a.run("messages.send", input))).code, "disabled");
  assert.equal(request.calls.length, 0);

  const bad = ig((url) => (new URL(url).pathname === "/v25.0/me" ? J({ user_id: "1784" }) : J({ error: { message: "outside window " + TOK, code: 10 } }, 400)));
  const e = await err(bad.a.runApproved("messages.send", input, await proofFor("instagram.messages.send", input)));
  assert.equal(e.code, "upstream_error");
  assert.ok(!JSON.stringify({ m: e.message, c: e.code, ctx: e.ctx }).includes(TOK));
});

// ---------- TikTok ----------
const ttOk = (data) => J({ data, error: { code: "ok", message: "" } });
const PUB = { video_url: "https://media.example.com/v/1.mp4", privacy_level: "SELF_ONLY", title: "Yeni ətir" };

test("TikTok video.publish: POST /v2/post/publish/video/init/ (Bearer, JSON), post_info + source_info PULL_FROM_URL; privacy_level məcburidir", async () => {
  const request = fakeRequest(() => ttOk({ publish_id: "v_pub_url~v2.123" }));
  const a = new TikTokAdapter({ env: FULL_ENV, request });
  const r = await a.runApproved("video.publish", PUB, await proofFor("tiktok.video.publish", PUB));
  assert.deepEqual(r.data, { submitted: true, publish_id: "v_pub_url~v2.123" });
  const c = request.calls[0];
  assert.equal(c.url, "https://open.tiktokapis.com/v2/post/publish/video/init/");
  assert.equal(c.init.method, "POST");
  assert.equal(hdr(c, "authorization"), "Bearer " + TOK);
  assert.match(hdr(c, "content-type"), /application\/json/);
  assert.deepEqual(JSON.parse(c.body), { post_info: { privacy_level: "SELF_ONLY", title: "Yeni ətir" }, source_info: { source: "PULL_FROM_URL", video_url: PUB.video_url } });
  for (const bad of [{ video_url: PUB.video_url }, { ...PUB, privacy_level: "EVERYONE" }, { ...PUB, video_url: "http://x.com/a.mp4" }, { ...PUB, video_url: "https://10.0.0.1/a.mp4" }]) {
    const e = await err(a.runApproved("video.publish", bad, await proofFor("tiktok.video.publish", bad)));
    assert.equal(e.code, "invalid_input");
  }
  assert.equal(request.calls.length, 1);
});

test("TikTok video.publish: sübutsuz icra yoxdur; error.code 'ok' deyilsə (məs. unaudited_client) xəta olur, uğur DEYİL", async () => {
  const request = fakeRequest(() => J({ error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "x" } }, 403));
  const a = new TikTokAdapter({ env: FULL_ENV, request });
  assert.equal((await err(a.runApproved("video.publish", PUB))).code, "approval_required");
  assert.equal(request.calls.length, 0);
  const e = await err(a.runApproved("video.publish", PUB, await proofFor("tiktok.video.publish", PUB)));
  assert.equal(e.code, "upstream_error");
  const r2 = fakeRequest(() => J({ data: {}, error: { code: "spam_risk", message: "m" } }, 200));
  const e2 = await err(new TikTokAdapter({ env: FULL_ENV, request: r2 }).runApproved("video.publish", PUB, await proofFor("tiktok.video.publish", PUB)));
  assert.ok(e2, "ok olmayan error.code uğur sayılmamalıdır");
});

test("TikTok post.status (oxuma): POST /v2/post/publish/status/fetch/ {publish_id}", async () => {
  const request = fakeRequest(() => ttOk({ status: "PUBLISH_COMPLETE" }));
  const a = new TikTokAdapter({ env: FULL_ENV, request });
  const r = await a.run("post.status", { publish_id: "v_pub_url~v2.123" });
  assert.equal(r.data.status, "PUBLISH_COMPLETE");
  assert.equal(request.calls[0].url, "https://open.tiktokapis.com/v2/post/publish/status/fetch/");
  assert.deepEqual(JSON.parse(request.calls[0].body), { publish_id: "v_pub_url~v2.123" });
  assert.equal((await err(a.run("post.status", { publish_id: "../x y" }))).code, "invalid_input");
});

test("TikTok token yeniləmə: refresh credential-ları varsa POST /v2/oauth/token/ (form), sonra təzə access token ilə çağırış; token nəticədə yoxdur", async () => {
  const env = { TIKTOK_REFRESH_TOKEN: "rft_" + TOK, TIKTOK_CLIENT_KEY: "ck_" + TOK, TIKTOK_CLIENT_SECRET: "cs_" + TOK };
  const request = fakeRequest((url) => (url.endsWith("/v2/oauth/token/") ? J({ access_token: "act_FRESH_" + TOK, expires_in: 86400, refresh_token: "rft_" + TOK, refresh_expires_in: 31536000, scope: "user.info.basic" }) : ttOk({ user: { open_id: "o1", display_name: "x" } })));
  const a = new TikTokAdapter({ env, request });
  assert.equal(a.status().configured, true);
  const r = await a.run("account.get", {});
  assert.equal(r.data.open_id, "o1");
  const t = request.calls[0];
  assert.equal(t.url, "https://open.tiktokapis.com/v2/oauth/token/");
  assert.equal(hdr(t, "content-type"), "application/x-www-form-urlencoded");
  const form = new URLSearchParams(t.body);
  assert.deepEqual([form.get("client_key"), form.get("grant_type"), form.get("refresh_token")], ["ck_" + TOK, "refresh_token", "rft_" + TOK]);
  assert.equal(hdr(request.calls[1], "authorization"), "Bearer act_FRESH_" + TOK);
  assert.ok(!JSON.stringify(r).includes("FRESH") && !JSON.stringify(a).includes(TOK));
  assert.equal(r.warning, undefined);
});

test("TikTok token yeniləmə: refresh token rotasiya olunarsa 'refresh_token_rotated' xəbərdarlığı (yeni dəyər GÖSTƏRİLMİR); yeniləmə xətası xəta olur", async () => {
  const env = { TIKTOK_REFRESH_TOKEN: "rft_old_" + TOK, TIKTOK_CLIENT_KEY: "ck_" + TOK, TIKTOK_CLIENT_SECRET: "cs_" + TOK };
  const rot = fakeRequest((url) => (url.endsWith("/v2/oauth/token/") ? J({ access_token: "act_" + TOK, refresh_token: "rft_NEW_" + TOK }) : ttOk({ user: { open_id: "o1" } })));
  const r = await new TikTokAdapter({ env, request: rot }).run("account.get", {});
  assert.equal(r.warning, "refresh_token_rotated");
  assert.ok(!JSON.stringify(r).includes("NEW_"));
  const fail = fakeRequest(() => J({ error: "invalid_grant", error_description: "bad " + TOK }, 400));
  const e = await err(new TikTokAdapter({ env, request: fail }).run("account.get", {}));
  assert.equal(e.code, "upstream_error");
  assert.ok(!e.message.includes(TOK));
  assert.equal(fail.calls.length, 1, "yeniləmə uğursuzsa API sorğusuna keçilmir");
});

test("TikTok: nə access token, nə də tam refresh dəsti yoxdursa not_configured, şəbəkə yoxdur", async () => {
  const request = fakeRequest();
  const a = new TikTokAdapter({ env: { TIKTOK_REFRESH_TOKEN: "rft_" + TOK }, request });
  assert.equal(a.status().configured, false);
  assert.equal((await err(a.run("account.get", {}))).code, "not_configured");
  assert.equal(request.calls.length, 0);
});

// ---------- YouTube ----------
const YT_SNIPPET = { title: "Köhnə ad", description: "Köhnə təsvir", categoryId: "22", tags: ["a", "b"], defaultLanguage: "az", publishedAt: "2026-01-01T00:00:00Z", channelId: "UC1", thumbnails: {} };
const ytHandler = (snippet = YT_SNIPPET) => (url, init) => {
  const u = new URL(url);
  if (u.hostname === "oauth2.googleapis.com") return J({ access_token: "ya_" + TOK, expires_in: 3600, token_type: "Bearer" });
  if (u.pathname === "/youtube/v3/videos" && (init.method || "GET") === "GET") return J({ items: snippet ? [{ id: "abcDEF12345", snippet }] : [] });
  if (u.pathname === "/youtube/v3/videos" && init.method === "PUT") { const b = JSON.parse(init.body); return J({ id: b.id, snippet: b.snippet }); }
  return undefined;
};

test("YouTube video.update: əvvəl mövcud snippet oxunur, sonra PUT /videos?part=snippet tam (birləşdirilmiş) snippet ilə; verilməyən sahələr SİLİNMİR", async () => {
  const request = fakeRequest(ytHandler());
  const a = new YouTubeAdapter({ env: FULL_ENV, request });
  const input = { video_id: "abcDEF12345", title: "Yeni ad" };
  const r = await a.runApproved("video.update", input, await proofFor("youtube.video.update", input));
  assert.deepEqual(r.data, { updated: true, id: "abcDEF12345", title: "Yeni ad" });
  const put = request.calls.find((c) => c.init.method === "PUT");
  assert.equal(new URL(put.url).searchParams.get("part"), "snippet");
  assert.equal(hdr(put, "authorization"), "Bearer ya_" + TOK);
  assert.deepEqual(JSON.parse(put.body), { id: "abcDEF12345", snippet: { title: "Yeni ad", description: "Köhnə təsvir", categoryId: "22", tags: ["a", "b"], defaultLanguage: "az" } });
  assert.ok(!JSON.stringify(r).includes(TOK));
});

test("YouTube video.update: təsvir/teq dəyişikliyi başlığı saxlayır; heç bir dəyişiklik və ya categoryId olmayan snippet icra olunmur", async () => {
  const request = fakeRequest(ytHandler());
  const a = new YouTubeAdapter({ env: FULL_ENV, request });
  const input = { video_id: "abcDEF12345", description: "Yeni təsvir", tags: ["x"] };
  await a.runApproved("video.update", input, await proofFor("youtube.video.update", input));
  const body = JSON.parse(request.calls.find((c) => c.init.method === "PUT").body);
  assert.equal(body.snippet.title, "Köhnə ad");
  assert.equal(body.snippet.description, "Yeni təsvir");
  assert.deepEqual(body.snippet.tags, ["x"]);
  const none = { video_id: "abcDEF12345" };
  assert.equal((await err(a.runApproved("video.update", none, await proofFor("youtube.video.update", none)))).code, "invalid_input");
  const r2 = fakeRequest(ytHandler({ title: "t" }));
  const e = await err(new YouTubeAdapter({ env: FULL_ENV, request: r2 }).runApproved("video.update", input, await proofFor("youtube.video.update", input)));
  assert.equal(e.code, "upstream_error");
  assert.ok(!r2.calls.some((c) => c.init.method === "PUT"), "categoryId olmadan PUT göndərilmir (sahələr silinərdi)");
});

test("YouTube yazma: sübutsuz icra yoxdur; 403 (scope çatmır) düzgün xətadır; upload/delete hələ disabled", async () => {
  const request = fakeRequest((url, init) => (init.method === "PUT" ? J({ error: { code: 403, status: "PERMISSION_DENIED" } }, 403) : ytHandler()(url, init)));
  const a = new YouTubeAdapter({ env: FULL_ENV, request });
  const input = { video_id: "abcDEF12345", title: "x" };
  assert.equal((await err(a.runApproved("video.update", input))).code, "approval_required");
  assert.equal(request.calls.length, 0);
  const e = await err(a.runApproved("video.update", input, await proofFor("youtube.video.update", input)));
  assert.equal(e.code, "upstream_error");
  assert.equal((await err(a.runApproved("video.upload", { title: "x" }, await proofFor("youtube.video.upload", { title: "x" })))).code, "not_implemented");
  assert.equal((await err(a.runApproved("video.delete", { video_id: "v1" }, await proofFor("youtube.video.delete", { video_id: "v1" })))).code, "not_implemented");
});

// ---------- Shopify ----------
const PID = "gid://shopify/Product/1234567890";
const shHandler = (payload) => (url) => (url.includes("/graphql.json") ? J(payload) : undefined);

test("Shopify product.update: POST graphql.json, mutation productUpdate(product: $product), dəyişkənlər yalnız verilən sahələr", async () => {
  const request = fakeRequest(shHandler({ data: { productUpdate: { product: { id: PID, title: "Yeni", status: "DRAFT", handle: "yeni", tags: ["a"], vendor: "FN", productType: "ətir" }, userErrors: [] } } }));
  const a = new ShopifyAdapter({ env: FULL_ENV, request });
  const input = { product_id: PID, title: "Yeni", status: "DRAFT", tags: ["a"], description_html: "<p>x</p>" };
  const r = await a.runApproved("product.update", input, await proofFor("shopify.product.update", input));
  assert.equal(r.data.updated, true);
  assert.equal(r.data.product.title, "Yeni");
  const c = request.calls[0];
  assert.equal(c.url, "https://demo-shop.myshopify.com/admin/api/2026-07/graphql.json");
  assert.equal(hdr(c, "x-shopify-access-token"), TOK);
  const body = JSON.parse(c.body);
  assert.match(body.query, /mutation\(\$product:ProductUpdateInput!\)\{ productUpdate\(product:\$product\)/);
  assert.deepEqual(body.variables, { product: { id: PID, title: "Yeni", descriptionHtml: "<p>x</p>", status: "DRAFT", tags: ["a"] } });
});

test("Shopify product.update: userErrors boş deyilsə və ya GraphQL errors olarsa UĞUR DEYİL; yanlış gid, dəyişiklik olmaması rədd edilir", async () => {
  const ue = fakeRequest(shHandler({ data: { productUpdate: { product: null, userErrors: [{ field: ["product", "title"], message: "Title can't be blank <script>" }] } } }));
  const input = { product_id: PID, title: "x" };
  const e1 = await err(new ShopifyAdapter({ env: FULL_ENV, request: ue }).runApproved("product.update", input, await proofFor("shopify.product.update", input)));
  assert.equal(e1.code, "upstream_error");
  assert.ok(!e1.message.includes("<script>"), "platforma mətni xəta mesajına düşmür");
  const ge = fakeRequest(shHandler({ errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] }));
  const e2 = await err(new ShopifyAdapter({ env: FULL_ENV, request: ge }).runApproved("product.update", input, await proofFor("shopify.product.update", input)));
  assert.equal(e2.code, "upstream_error");
  const none = fakeRequest();
  const a = new ShopifyAdapter({ env: FULL_ENV, request: none });
  for (const bad of [{ product_id: "123", title: "x" }, { product_id: PID }, { product_id: PID, status: "DELETED" }, { product_id: "gid://shopify/Product/1; DROP", title: "x" }]) {
    assert.equal((await err(a.runApproved("product.update", bad, await proofFor("shopify.product.update", bad)))).code, "invalid_input", JSON.stringify(bad));
  }
  assert.equal(none.calls.length, 0);
  assert.equal((await err(a.run("product.update", input))).code, "disabled");
  assert.equal((await err(a.runApproved("price.change", { product_id: "p", price: 1 }, await proofFor("shopify.price.change", { product_id: "p", price: 1 })))).code, "not_implemented");
});
