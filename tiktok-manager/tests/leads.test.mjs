import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { triage, classifyMessage, suggestReply } from "../src/leads.js";
import { ApprovalCenter } from "../src/approval.js";
import { setup } from "./helpers.mjs";

const comments = JSON.parse(readFileSync(new URL("../mock/fixtures/comments.json", import.meta.url)));

test("HOT/WARM/COLD təsnifatı", () => {
  const r = triage(comments, {});
  const by = Object.fromEntries(r.leads.map((l) => [l.id, l]));
  assert.equal(by.mock_c3.tier, "HOT");
  assert.equal(by.mock_c1.tier, "HOT"); // qiymət + çatdırılma
  assert.equal(by.mock_c6.tier, "WARM");
  assert.equal(by.mock_c2.tier, "COLD");
  assert.equal(by.mock_c4.category, "spam");
  assert.equal(by.mock_c5.category, "complaint");
  assert.equal(r.leads[0].tier, "HOT");
});

test("Biznes faktı yoxdursa cavabda marker qalır və approval bloklayır", () => {
  const lead = classifyMessage("Qiyməti neçəyədir?");
  const s = suggestReply(lead, {});
  assert.ok(s.missing_facts.includes("price"));
  const { cfg, ws } = setup();
  const ap = new ApprovalCenter(ws, "acc", cfg);
  const d = ap.draft("comment.reply", { comment_id: "c1", text: s.reply });
  assert.ok(d.violations.some((v) => v.rule === "missing_fact"));
  const ok = suggestReply(lead, { price: "25 AZN" });
  assert.match(ok.reply, /25 AZN/);
  assert.equal(ok.missing_facts.length, 0);
});

test("Spam-a cavab verilmir", () => {
  assert.equal(suggestReply(classifyMessage("follow back pls"), {}).reply, null);
});
