// Planlayıcı yazma aləti seçəndə: yalnız təsdiq qeydi, şəbəkə çağırışı yox; təsdiq UI/API ilə verilir və icra olunur (tam axın).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFetch, standardHandler, baseEnv, talk, ok, worker } from "./helpers.mjs";
import { resetAll, FULL_ENV, FakeKV, TOK } from "./wiring-helpers.mjs";
import { _resetLoginMemoryForTests } from "../src/guards/login.js";

beforeEach(() => { resetAll(); _resetLoginMemoryForTests(); });

const env = () => ({ ...baseEnv(), ...FULL_ENV, JARVIS_KV: new FakeKV() });
const IG = /graph\.instagram\.com/;
const api = (path, e, method = "GET", body) => worker.fetch(new Request("https://x.dev" + path, { method, headers: { "x-passcode": "pw", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), e);

test("planlayıcı Instagram paylaşımı seçir: təsdiq qeydi açılır (şəbəkə yoxdur); Fərid UI/API ilə təsdiq edəndə icra olunur və nəticə qayıdır", async () => {
  const plan = { mode: "task", subtasks: [], tool_calls: [{ id: "c1", tool: "instagram.media.publish", input: { image_url: "https://cdn.example.com/a.jpg", caption: "Yeni ətir" } }], external_action: null };
  const base = standardHandler({ plan });
  const calls = installFetch((u, body, init) => {
    if (IG.test(u)) {
      const p = new URL(u).pathname;
      if (p === "/v25.0/me") return ok({ user_id: "1784" });
      if (p.endsWith("/media")) return ok({ id: "9001" });
      if (p === "/v25.0/9001") return ok({ status_code: "FINISHED" });
      if (p.endsWith("/media_publish")) return ok({ id: "7001" });
    }
    return base(u, body, init);
  });
  const e = env();
  const d = await (await talk(e, "Instagramda bu şəkli paylaş")).json();
  assert.equal(d.status, "pending_approval");
  assert.equal(calls.filter((c) => IG.test(c.url)).length, 0, "təsdiqdən əvvəl Instagram-a sorğu getməməlidir");
  const list = await (await api("/api/approvals?status=pending", e)).json();
  assert.equal(list.approvals.length, 1);
  assert.equal(list.approvals[0].tool, "instagram.media.publish");
  assert.deepEqual(list.approvals[0].input, { image_url: "https://cdn.example.com/a.jpg", caption: "Yeni ətir" });
  assert.ok(list.approvals[0].tool_info.permissions.includes("publish.social"));

  const res = await (await api("/api/approvals/" + d.approvals[0], e, "POST", { decision: "approve" })).json();
  assert.equal(res.execution.ok, true, JSON.stringify(res));
  assert.ok(res.execution.output.includes("7001"));
  assert.ok(!JSON.stringify(res).includes(TOK));
  assert.equal(calls.filter((c) => IG.test(c.url) && c.init.method === "POST").length, 2);
});
