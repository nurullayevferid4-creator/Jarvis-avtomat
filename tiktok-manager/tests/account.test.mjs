import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeAccount, UNKNOWN } from "../src/account.js";
import { TikTokClient } from "../src/client.js";
import { createMockTikTok } from "../mock/transport.mjs";
import { MODULE_ROOT } from "../src/config.js";
import { setup } from "./helpers.mjs";

test("Hesab analizi profil faylını yaradır, biznes faktları NAMƏLUM qalır (uydurulmur)", async () => {
  const { client, ws, cfg } = setup();
  const p = await analyzeAccount({ client, workspace: ws });
  assert.equal(p.identity.username, "mock_sirniyyat");
  assert.equal(p.stats.followers, 1840);
  for (const k of ["business", "price", "delivery", "payment", "audience"]) assert.equal(p.business[k], UNKNOWN, k);
  const md = readFileSync(join(cfg.workspace, "account-profile.md"), "utf8");
  assert.match(md, /NAMƏLUM/);
  assert.match(md, /UNSUPPORTED_BY_TIKTOK_API/);
  assert.equal(p.growth.status, "insufficient_snapshots");
});

test("Universal: başqa hesab qoşulanda ayrıca yaddaş yaranır və profil yenidən qurulur", async () => {
  const { ws, cfg } = setup();
  const a = createMockTikTok();
  const b = createMockTikTok({ user: { open_id: "mock-open-id-0002", username: "mock_fitness", display_name: "Mock Fitness", follower_count: 90, bio_description: "Fitness coach" }, videos: [] });
  const pa = await analyzeAccount({ client: new TikTokClient(cfg, { fetch: a.fetch }), workspace: ws });
  const pb = await analyzeAccount({ client: new TikTokClient(cfg, { fetch: b.fetch }), workspace: ws });
  assert.equal(pa.switched_account, true);
  assert.equal(pb.switched_account, true);
  assert.equal(ws.activeAccount(), "mock-open-id-0002");
  assert.deepEqual(ws.accounts().sort(), ["mock-open-id-0001", "mock-open-id-0002"]);
  const md = readFileSync(join(cfg.workspace, "account-profile.md"), "utf8");
  assert.match(md, /mock_fitness/);
  assert.doesNotMatch(md, /mock_sirniyyat/);
  assert.equal(pb.performance.n, 0);
  assert.equal(pb.performance.status, "no_data");
});

test("Scope yoxdursa statistika uydurulmur", async () => {
  const { client, ws } = setup({ env: { TIKTOK_SCOPES: "user.info.basic,video.list" } });
  const p = await analyzeAccount({ client, workspace: ws });
  assert.equal(p.stats.followers, UNKNOWN);
  assert.equal(p.identity.bio, UNKNOWN);
});

test("Mənbə kodunda heç bir hesab hardcode edilməyib", () => {
  const dir = join(MODULE_ROOT, "src");
  for (const f of readdirSync(dir)) {
    const s = readFileSync(join(dir, f), "utf8");
    assert.doesNotMatch(s, /mock_sirniyyat|mock-open-id|@[a-z0-9_.]{3,}\b(?!\.)/i, f);
  }
});
