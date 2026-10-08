import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, detectIntent, SKILLS, PIPELINES } from "../src/manager.js";
import { rankIdeas, scoreIdea } from "../src/content.js";
import { analyzeVideos } from "../src/analytics.js";
import { readFileSync } from "node:fs";

test("Niyyət təyini", () => {
  assert.equal(detectIntent("TikTokumu böyüt"), "grow");
  assert.equal(detectIntent("Yeni məhsul üçün reklam videosu hazırla"), "ad");
  assert.equal(detectIntent("Şərhlərə bax"), "comments");
  assert.equal(detectIntent("hesabımı analiz et"), "analyze");
});

test("'TikTokumu böyüt' 18 addımın hamısını əhatə edir və yalnız publish təsdiq istəyir", () => {
  const p = plan("TikTokumu böyüt", { connected: true });
  assert.equal(p.intent, "grow");
  assert.ok(p.steps.length >= 18);
  const approvals = p.steps.filter((s) => s.approval_required);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].skill, "tiktok-publisher");
  assert.ok(p.steps.filter((s) => s.auto).length >= 17);
});

test("Dəstəklənməyən API addımları manual fallback ilə işarələnir", () => {
  const p = plan("DM-lərə cavab ver", { connected: true });
  const read = p.steps.find((s) => s.capability === "dm.read");
  assert.equal(read.api_status, "UNSUPPORTED_BY_TIKTOK_API");
  assert.ok(read.fallback);
});

test("Pipeline-larda istifadə olunan bütün skill-lər mövcuddur və 20 skill var", () => {
  assert.equal(SKILLS.length, 20);
  for (const steps of Object.values(PIPELINES)) for (const s of steps) assert.ok(SKILLS.includes(s.skill), s.skill);
});

test("İdeya balı 'baxış potensialı'dır, zəmanət deyil; hesab datası nəzərə alınır", () => {
  const a = analyzeVideos(JSON.parse(readFileSync(new URL("../mock/fixtures/videos.json", import.meta.url))));
  const ranked = rankIdeas([
    { title: "Vlog", hook_pattern: "bəyanat", signals: { hook_strength: 2, audience_fit: 3, shareability: 1, production_ease: 5 } },
    { title: "3 səhv", hook_pattern: "sual", signals: { hook_strength: 5, audience_fit: 5, shareability: 4, production_ease: 4 } },
  ], a);
  assert.equal(ranked[0].title, "3 səhv");
  assert.match(ranked[0].potential.label, /baxış potensialı/);
  assert.doesNotMatch(JSON.stringify(ranked), /viral olacaq/);
  assert.match(scoreIdea({ signals: {} }, null).data_basis, /yoxdur/);
});
