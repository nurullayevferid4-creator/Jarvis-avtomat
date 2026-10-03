// Təsdiq mərkəzi, audit jurnalı və sənəd anbarı.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createStore, _resetMemoryForTests, makeId, isValidId } from "../src/state/store.js";
import { createAudit, redact } from "../src/audit/log.js";
import { ApprovalCenter } from "../src/approval/center.js";

beforeEach(() => _resetMemoryForTests());

function setup(startMs = Date.UTC(2026, 9, 3, 12, 0, 0)) {
  const clock = { t: startMs };
  const now = () => clock.t;
  const store = createStore({});
  const audit = createAudit(store, now);
  const approvals = new ApprovalCenter(store, audit, now);
  return { clock, store, audit, approvals };
}

const events = async (audit) => (await audit.list(40)).map((e) => e.event);

test("anbar: sənəd növü və id yoxlanır", async () => {
  const store = createStore({});
  await assert.rejects(() => store.putDoc("secrets", makeId(), {}), /naməlum/);
  await assert.rejects(() => store.putDoc("approval", "../state", {}), /id/);
  await assert.rejects(() => store.getDoc("approval", "state"), /id/);
  assert.equal(isValidId(makeId()), true);
  assert.equal(isValidId("abc"), false);
});

test("anbar: siyahı ən yenidən köhnəyə doğrudur", async () => {
  const store = createStore({});
  const t = Date.UTC(2026, 9, 3);
  for (const n of [1, 2, 3]) await store.putDoc("audit", makeId(t + n * 1000), { n });
  assert.deepEqual((await store.listDocs("audit", 10)).map((d) => d.n), [3, 2, 1]);
  assert.equal((await store.listDocs("audit", 2)).length, 2);
});

test("anbar: KV varsa 'növ:id' açarı ilə yazır, köhnə 'state' və 'job:' açarlarına toxunmur", async () => {
  const kv = new Map();
  const env = {
    JARVIS_KV: {
      put: async (k, v) => kv.set(k, v),
      get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null),
      list: async ({ prefix, limit }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })) }),
    },
  };
  const store = createStore(env);
  const id = makeId();
  await store.putDoc("approval", id, { a: 1 }, 100);
  assert.ok(kv.has("approval:" + id));
  assert.deepEqual(await store.getDoc("approval", id), { a: 1 });
  assert.deepEqual(await store.listDocs("approval"), [{ a: 1 }]);
  assert.ok(![...kv.keys()].some((k) => k === "state" || k.startsWith("job:")));
});

test("təsdiq: qeyd yaranır, gözləyənlər siyahıda görünür", async () => {
  const { approvals } = setup();
  const rec = await approvals.create({ action: "Instagram paylaşımı", content: "Qaralama mətni", risk: "medium", source: "test" });
  assert.equal(rec.status, "pending");
  assert.equal(rec.execution, null);
  const list = await approvals.list({ status: "pending" });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, rec.id);
});

test("təsdiq: yanlış risk və boş əməliyyat rədd edilir, uzun mətn kəsilir", async () => {
  const { approvals } = setup();
  await assert.rejects(() => approvals.create({ action: "x", content: "y", risk: "extreme" }), /risk/);
  await assert.rejects(() => approvals.create({ action: "  ", content: "y" }), /boşdur/);
  const rec = await approvals.create({ action: "x", content: "a".repeat(9000) });
  assert.equal(rec.content.length, 4000);
});

test("təsdiq: APPROVE qeyd edir, amma HEÇ NƏ icra etmir (execution: manual)", async () => {
  const { approvals } = setup();
  const rec = await approvals.create({ action: "Qiymət dəyişikliyi", content: "10 -> 12 AZN", risk: "high" });
  const r = await approvals.decide(rec.id, { decision: "approve" });
  assert.equal(r.ok, true);
  assert.equal(r.record.status, "approved");
  assert.equal(r.record.execution, "manual");
  assert.ok(r.record.decided_at);
});

test("təsdiq: REJECT işləyir; qərar verilmişə ikinci qərar 409 səbəbi ilə rədd edilir", async () => {
  const { approvals } = setup();
  const rec = await approvals.create({ action: "Mesaj göndərmək", content: "salam" });
  assert.equal((await approvals.decide(rec.id, { decision: "reject" })).record.status, "rejected");
  const again = await approvals.decide(rec.id, { decision: "approve" });
  assert.equal(again.ok, false);
  assert.equal(again.error, "already_decided");
  assert.equal(again.record.status, "rejected", "rədd edilmiş qeyd sonradan təsdiqlənə bilməz");
});

test("təsdiq: EDIT mətni dəyişir, qeyd gözləyən qalır, məzmun boş ola bilməz", async () => {
  const { approvals } = setup();
  const rec = await approvals.create({ action: "Post", content: "köhnə" });
  assert.equal((await approvals.decide(rec.id, { decision: "edit", content: "  " })).error, "content_required");
  const r = await approvals.decide(rec.id, { decision: "edit", content: "yeni mətn" });
  assert.equal(r.record.status, "pending");
  assert.equal(r.record.content, "yeni mətn");
  assert.equal(r.record.revisions, 1);
  assert.equal((await approvals.decide(rec.id, { decision: "approve" })).record.content, "yeni mətn");
});

test("təsdiq: naməlum və yanlış formatlı id, yanlış qərar", async () => {
  const { approvals } = setup();
  assert.equal((await approvals.decide(makeId(), { decision: "approve" })).error, "not_found");
  assert.equal((await approvals.decide("../../state", { decision: "approve" })).error, "not_found");
  const rec = await approvals.create({ action: "x", content: "y" });
  assert.equal((await approvals.decide(rec.id, { decision: "icra et" })).error, "bad_decision");
  assert.equal((await approvals.get(rec.id)).status, "pending", "yanlış qərar vəziyyəti dəyişmir");
});

test("təsdiq: 7 gündən köhnə gözləyən qeyd təsdiqlənə bilmir (expired)", async () => {
  const { approvals, clock } = setup();
  const rec = await approvals.create({ action: "x", content: "y" });
  clock.t += 8 * 86400000;
  assert.equal((await approvals.list({ status: "expired" })).length, 1, "siyahıda expired görünür");
  const r = await approvals.decide(rec.id, { decision: "approve" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "expired");
  assert.equal((await approvals.get(rec.id)).status, "expired");
});

test("audit: təsdiq addımları jurnala yazılır", async () => {
  const { approvals, audit } = setup();
  const rec = await approvals.create({ action: "x", content: "y" });
  await approvals.decide(rec.id, { decision: "edit", content: "z" });
  await approvals.decide(rec.id, { decision: "approve" });
  const ev = await events(audit);
  for (const e of ["approval.created", "approval.edit", "approval.approve"]) assert.ok(ev.includes(e), e + " jurnalda yoxdur");
});

test("audit: açar, token, parol dəyərləri jurnala düşmür", async () => {
  const { audit } = setup();
  // Repo-da açara oxşar mətn qalmasın deyə saxta dəyərlər işləmə vaxtı yığılır
  const fakeAnthropic = "sk-" + "ant-" + "abcdefghijklmnop";
  const fakeProject = "sk-" + "proj-" + "ABCDEFGHIJKLMNOP";
  await audit.log("test", {
    api_key: fakeAnthropic,
    PASSCODE: "mənim-parolum",
    authorization: "Bearer abcdefghijklmnopqrst",
    note: "mətn içində " + fakeProject + " var",
    nested: { token: "t0k3n", ok: "normal" },
  });
  const raw = JSON.stringify(await audit.list(5));
  for (const leaked of [fakeAnthropic, "mənim-parolum", "abcdefghijklmnopqrst", fakeProject, "t0k3n"]) {
    assert.ok(!raw.includes(leaked), "jurnala düşdü: " + leaked);
  }
  assert.ok(raw.includes("normal"));
});

test("audit: redact dərin və böyük obyektlərdə partlamır", () => {
  let deep = {};
  let cur = deep;
  for (let i = 0; i < 10; i++) { cur.x = {}; cur = cur.x; }
  assert.doesNotThrow(() => redact(deep));
  assert.equal(redact("a".repeat(1000)).length, 300);
});

test("audit: anbar xəta versə əsas iş dayanmır", async () => {
  const broken = { putDoc: async () => { throw new Error("KV down"); }, listDocs: async () => [] };
  assert.equal(await createAudit(broken).log("x", {}), false);
});
