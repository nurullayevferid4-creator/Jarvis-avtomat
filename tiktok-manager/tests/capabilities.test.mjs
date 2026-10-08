import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, STATUS, isCallable, capability } from "../src/capabilities.js";
import { setup } from "./helpers.mjs";

// Rəsmi sənəddən yoxlanmış endpoint-lərin tam siyahısı. Yeni endpoint əlavə etmək = bu siyahını şüurlu dəyişmək.
const VERIFIED = new Set([
  "POST /v2/oauth/token/", "POST /v2/oauth/revoke/", "GET /v2/user/info/", "POST /v2/video/list/", "POST /v2/video/query/",
  "POST /v2/post/publish/creator_info/query/", "POST /v2/post/publish/video/init/", "POST /v2/post/publish/inbox/video/init/",
  "POST /v2/post/publish/content/init/", "POST /v2/post/publish/status/fetch/",
]);

test("API uydurulmur: hər çağırıla bilən endpoint rəsmi yoxlanmış siyahıdadır və mənbəsi developers.tiktok.com-dur", () => {
  for (const [id, c] of Object.entries(CAPABILITIES)) {
    if (!isCallable(id) || !c.endpoint) continue;
    assert.ok(VERIFIED.has(c.method + " " + c.endpoint), "yoxlanmamış endpoint: " + id);
    assert.match(c.source, /^https:\/\/developers\.tiktok\.com\/doc\//, id);
    for (const k of ["method", "scope", "account", "token", "limits", "status"]) assert.ok(c[k] !== undefined, id + " " + k);
  }
});

test("Şərh və DM Login Kit/Display API ilə UNSUPPORTED_BY_TIKTOK_API kimi işarələnib", () => {
  for (const id of ["comments.read", "comments.reply", "dm.read", "dm.send", "insights.saves", "insights.retention", "trends.discover", "engagement.automation"]) {
    assert.equal(capability(id).status, STATUS.UNSUPPORTED, id);
    assert.equal(isCallable(id), false, id);
    assert.ok(capability(id).reason, id + " səbəb");
  }
  assert.equal(capability("nonexistent.feature").status, STATUS.UNSUPPORTED);
});

test("Client dəstəklənməyən funksiyada şəbəkəyə çıxmır", async () => {
  const { client, mock } = setup();
  await assert.rejects(client.api("dm.send", { body: {} }), (e) => e.code === STATUS.UNSUPPORTED);
  await assert.rejects(client.api("comments.read", {}), (e) => e.code === STATUS.UNSUPPORTED);
  await assert.rejects(client.api("made.up.endpoint", {}), (e) => e.code === STATUS.UNSUPPORTED);
  assert.equal(mock.state.calls.length, 0);
});

test("Bütün real çağırışlar yalnız reyestrdəki endpoint-lərə gedir", async () => {
  const { client, mock } = setup();
  await client.userInfo();
  await client.listAllVideos(50);
  await client.queryVideos(["mock_v01"]);
  await client.creatorInfo();
  for (const c of mock.state.calls) {
    assert.equal(c.host, "open.tiktokapis.com");
    assert.ok(VERIFIED.has(c.method + " " + c.path), c.method + " " + c.path);
  }
});

test("Scope-a görə yalnız icazəli user sahələri istənir", async () => {
  const { client, mock } = setup({ env: { TIKTOK_SCOPES: "user.info.basic,video.list" } });
  const r = await client.userInfo();
  assert.ok(!r.fields_requested.includes("follower_count"));
  assert.ok(!r.fields_requested.includes("bio_description"));
  assert.equal(r.user.follower_count, undefined);
  assert.equal(mock.state.calls[0].query.fields.split(",").includes("username"), false);
});
