import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../src/tools/registry.js";
import { registerInstagramReadTools, classifyComment, draftReply } from "../src/social/insights.js";
import { OWNER_PERMISSIONS } from "../src/policy.js";
import { installSocialFetch, json, world, seedToken } from "./social-helpers.mjs";
const DAY = 86400000;

const setup = async () => {
  const w = world();
  await seedToken(w, "instagram", { access_token: "LONG_T", user_id: "178", obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  const reg = new ToolRegistry({ sleep: async () => {} });
  registerInstagramReadTools(reg, { hub: w.hub });
  return { w, run: (n, i) => reg.run(n, i, { permissions: OWNER_PERMISSIONS }) };
};

test("təsnifat: qiymət/sifariş/şikayət/spam/sual; spam üçün cavab təklif olunmur", () => {
  assert.equal(classifyComment("Qiyməti nə qədərdir?"), "price_question");
  assert.equal(classifyComment("Sifariş vermək istəyirəm"), "buy_intent");
  assert.equal(classifyComment("Çox pis idi, problem var"), "complaint");
  assert.equal(classifyComment("follow me https://x.com"), "spam");
  assert.equal(classifyComment("Nə vaxt açılır?"), "question");
  assert.equal(draftReply("spam"), null);
  assert.ok(!/\d/.test(draftReply("price_question")), "qaralamada uydurma qiymət/rəqəm yoxdur");
});

test("instagram.media.recent və comments.review: yalnız GET, token cavabda yoxdur, heç nə göndərilmir", async () => {
  const { run } = await setup();
  const calls = installSocialFetch([
    [/graph\.instagram\.com\/[^/]+\/178\/media\?/, () => json({ data: [{ id: "1790000001", media_type: "REELS", permalink: "https://instagram.com/p/x", timestamp: "2026-10-07T10:00:00+0000", like_count: 12, comments_count: 3, caption: "salam" }] })],
    [/graph\.instagram\.com\/[^/]+\/1790000001\/comments\?/, () => json({ data: [{ id: "c1", text: "Qiyməti nə qədərdir?", username: "ali" }, { id: "c2", text: "dm me http://spam.com", username: "bot" }] })],
  ]);
  const m = await run("instagram.media.recent", {});
  assert.equal(m.status, "done", JSON.stringify(m));
  assert.deepEqual(m.output.totals, { posts: 1, likes: 12, comments: 3 });
  const c = await run("instagram.comments.review", { media_id: "1790000001" });
  assert.equal(c.status, "done", JSON.stringify(c));
  assert.equal(c.output.sent, false);
  assert.equal(c.output.leads, 1);
  assert.equal(c.output.items[1].draft_reply, null);
  assert.ok(calls.length >= 2 && calls.every((x) => x.method === "GET"), "yalnız GET");
  assert.ok(!JSON.stringify([m, c]).includes("LONG_T"), "token cavabda yoxdur");
  assert.notEqual((await run("instagram.comments.review", { media_id: "../x" })).status, "done"); // adapter media id-ni yoxlayır
});

test("hesab qoşulmayıbsa aydın xəta (saxta uğur yoxdur)", async () => {
  const w = world();
  const reg = new ToolRegistry({ sleep: async () => {} });
  registerInstagramReadTools(reg, { hub: w.hub });
  installSocialFetch([]);
  const r = await reg.run("instagram.media.recent", {}, { permissions: OWNER_PERMISSIONS });
  assert.notEqual(r.status, "done");
});
