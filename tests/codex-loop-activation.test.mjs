// Aktiv workflow auditdən keçmiş qaralama ilə eyni gövdəyə malik olmalıdır (şərh sətirləri istisna), claude.yml-ə toxunulmamalıdır.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const body = (p) => readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("aktiv workflow qaralama ilə eyni gövdədədir", () => {
  assert.equal(body(".github/workflows/claude-codex-loop.yml"), body(".github/workflow-drafts/claude-codex-loop.yml"));
});

test(".github/workflows/ yalnız claude.yml və claude-codex-loop.yml-dən ibarətdir (probe aktiv deyil)", () => {
  assert.deepEqual(readdirSync(".github/workflows").sort(), ["claude-codex-loop.yml", "claude.yml"]);
});

test("aktiv workflow: id-token yoxdur, yalnız icazə verilən secret-lər, allowed_bots dardır", () => {
  const w = body(".github/workflows/claude-codex-loop.yml");
  assert.ok(!/id-token/.test(w));
  const secrets = [...w.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  for (const s of secrets) assert.ok(["ANTHROPIC_API_KEY", "CODEX_TRIGGER_TOKEN", "GITHUB_TOKEN"].includes(s), s);
  assert.match(w, /allowed_bots: chatgpt-codex-connector\n/);
  assert.equal((w.match(/contents: write/g) || []).length, 1);
});
