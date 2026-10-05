// REAL API TESTİ: Kimi AI Auditor. Bu fayldakı testlər MOCK DEYİL.
// Defolt olaraq ATLANIR (skip). "Keçdi" kimi hesablanmır, atlanma səbəbi test çıxışında görünür.
//   - KIMI_API_KEY yoxdursa:  skip, səbəb: "KIMI_API_KEY is not configured"
//   - RUN_LIVE_TESTS=1 yoxdursa: skip (real sorğu pul xərcləyə bilər)
// İşə salmaq üçün (açarı yalnız lokal mühit dəyişəni kimi ver, heç vaxt fayla/chata yazma):
//   KIMI_API_KEY=... RUN_LIVE_TESTS=1 npm run test:live
import test from "node:test";
import assert from "node:assert/strict";
import { KimiAuditorAdapter } from "../src/adapters/KimiAuditorAdapter.js";
import { createStore } from "../src/state/store.js";
import { createAudit } from "../src/audit/log.js";

const hasKey = typeof process.env.KIMI_API_KEY === "string" && process.env.KIMI_API_KEY.trim() !== "";
const skip = !hasKey
  ? "KIMI_API_KEY is not configured (real Kimi inteqrasiya testi atlandı, bu 'keçdi' DEYİL)"
  : process.env.RUN_LIVE_TESTS !== "1"
    ? "RUN_LIVE_TESTS=1 verilməyib (real sorğu pul xərcləyə bilər, atlandı, bu 'keçdi' DEYİL)"
    : false;

test("LIVE: Kimi real audit hesabatı qaytarır və hesabat icra olunmaz işarələnir", { skip }, async () => {
  const env = process.env;
  const store = createStore(env);
  const adapter = new KimiAuditorAdapter(env, { store, audit: createAudit(store) });
  const r = await adapter.submitForAudit(
    {
      taskSummary: "Add a helper that adds two numbers.",
      codeDiff: "+ export const add = (a, b) => a + b;",
      testResults: "1 test, 1 pass, 0 fail",
    },
    { budget: { spend() {} }, timeoutMs: 60000 },
  );
  assert.equal(r.status, "completed");
  assert.equal(r.executable, false);
  const rec = await adapter.getAuditReport(r.auditId);
  assert.equal(rec.status, "completed");
  assert.equal(rec.advisory_only, true);
  assert.equal(rec.executable, false);
  assert.ok(["no_issues", "concerns", "blocking_concerns", "unparsed"].includes(rec.verdict));
});
