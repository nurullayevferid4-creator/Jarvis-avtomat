import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeVideos, followerGrowth, normalizeVideo, UNAVAILABLE_METRICS, hookPattern, median } from "../src/analytics.js";

const videos = JSON.parse(readFileSync(new URL("../mock/fixtures/videos.json", import.meta.url)));

test("Performans yalnız real sahələrdən hesablanır", () => {
  const a = analyzeVideos(videos);
  assert.equal(a.n, 12);
  assert.equal(a.top[0].id, "mock_v02");
  assert.equal(a.bottom[0].id, "mock_v07");
  assert.equal(a.median_views, median(videos.map((v) => v.view_count)));
  for (const k of ["saves", "reach", "retention", "profile_visits"]) assert.match(a.unavailable[k], /UNSUPPORTED_BY_TIKTOK_API/);
  assert.ok(a.videos.every((v) => !("saves" in v) && !("reach" in v)));
  assert.match(a.caveat, /korrelyasiya/);
});

test("Məlumat yoxdursa nəticə çıxarılmır", () => {
  assert.equal(analyzeVideos([]).status, "no_data");
  assert.equal(normalizeVideo({ id: "x" }).engagement_rate, null);
});

test("Follower artımı yalnız snapshot-lardan", () => {
  assert.equal(followerGrowth([{ at: "2026-10-01T00:00:00Z", follower_count: 100 }]).status, "insufficient_snapshots");
  const g = followerGrowth([{ at: "2026-10-01T00:00:00Z", follower_count: 100 }, { at: "2026-10-11T00:00:00Z", follower_count: 150 }]);
  assert.equal(g.delta, 50);
  assert.equal(g.per_day, 5);
});

test("Hook tipləri", () => {
  assert.equal(hookPattern("Niyə tortunuz çökür?"), "sual");
  assert.equal(hookPattern("3 səhv ki, biskvit quru olur"), "rəqəm/siyahı");
  assert.equal(hookPattern("POV: müştəri gəlir"), "pov");
  assert.ok(Object.keys(UNAVAILABLE_METRICS).length >= 6);
});
