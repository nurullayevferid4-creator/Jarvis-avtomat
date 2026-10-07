// Core: vahid xəta modeli, koordinator (kilid/bir dəfə), təsdiq mənşə bağlaması, ActionRunner, paralel icra.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createStore, _resetMemoryForTests } from "../src/state/store.js";
import { createAudit } from "../src/audit/log.js";
import { ApprovalCenter } from "../src/approval/center.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createActionRunner } from "../src/actions/runner.js";
import { MemoryCoordinator, JarvisCoordinator, DoCoordinator, applyOp } from "../src/coord/coordinator.js";
import { AppError, toAppError, ERROR_CODES } from "../src/errors.js";
import { SocialError } from "../src/social/errors.js";

beforeEach(() => _resetMemoryForTests());

function setup() {
  const clock = { t: Date.UTC(2026, 9, 7, 12, 0, 0) };
  const now = () => clock.t;
  const store = createStore({});
  const audit = createAudit(store, now);
  const coord = new MemoryCoordinator(now);
  const approvals = new ApprovalCenter(store, audit, now, coord);
  const calls = [];
  const registry = new ToolRegistry({ audit, approvals, sleep: async () => {} });
  registry.register({
    name: "demo.write",
    description: "Test yazma əməliyyatı",
    inputSchema: { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string", maxLength: 50 }, fail: { type: "string" } } },
    outputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    permissions: ["change.price"],
    risk: "high",
    requiresApproval: true,
    timeoutMs: 2000,
    approval: {
      kind: "demo.write",
      describe: (p) => "Yaradılacaq: " + p.input.name,
      async execute(input, ctx) {
        calls.push({ input, key: ctx.idempotencyKey });
        await new Promise((r) => setTimeout(r, 20));
        if (input.fail === "timeout") throw new AppError("TIMEOUT", "vaxt");
        if (input.fail === "auth") throw new AppError("AUTH_ERROR", "token");
        if (input.fail === "bad") return { nope: 1 };
        return { id: "X-" + input.name };
      },
    },
    async handler() { throw new Error("çatmamalıdır"); },
  });
  const runner = createActionRunner({ approvals, registry, audit });
  return { clock, store, audit, approvals, registry, runner, calls, coord };
}

const UI = { channel: "ui" };
const tg = (chat) => ({ channel: "telegram", chat_id: chat });

test("xəta modeli: sosial və naməlum xətalar vahid kodlara çevrilir, daxili mətn çıxmır", () => {
  assert.equal(toAppError(new SocialError("rate_limited", "x", { retriable: true })).code, "RATE_LIMIT");
  assert.equal(toAppError(new SocialError("token_expired", "x")).code, "AUTH_ERROR");
  assert.equal(toAppError(new SocialError("invalid_request", "x")).code, "VALIDATION_ERROR");
  assert.equal(toAppError(Object.assign(new Error("bad"), { name: "AbortError" })).code, "TIMEOUT");
  assert.equal(toAppError(Object.assign(new Error("x"), { name: "UnsafeUrlError" })).code, "SECURITY_ERROR");
  const pub = toAppError(new Error("secret " + ["sk", "ant", "A".repeat(16)].join("-") + " stack at foo.js:3")).toPublic();
  assert.equal(pub.code, "INTERNAL_ERROR");
  assert.ok(!JSON.stringify(pub).includes("sk-" + "ant"));
  for (const c of ["AUTH_ERROR", "PERMISSION_ERROR", "RATE_LIMIT", "VALIDATION_ERROR", "NETWORK_ERROR", "TIMEOUT", "PROVIDER_ERROR", "NOT_FOUND", "CONFLICT", "SECURITY_ERROR", "APPROVAL_REQUIRED"]) assert.ok(ERROR_CODES.includes(c), c);
});

test("koordinator: eyni açar üçün 'once' yalnız ilk çağırana true verir (50 paralel)", async () => {
  const c = new MemoryCoordinator();
  const r = await Promise.all(Array.from({ length: 50 }, () => c.once("exec:abc")));
  assert.equal(r.filter(Boolean).length, 1);
});

test("koordinator: kilid başqa sahibə verilmir, vaxtı bitəndə açılır, unlock yalnız sahibə işləyir", async () => {
  let t = 1000;
  const c = new MemoryCoordinator(() => t);
  assert.equal(await c.tryLock("job:x", "A", 5000), true);
  assert.equal(await c.tryLock("job:x", "B", 5000), false);
  await c.unlock("job:x", "B"); // sahibi deyil
  assert.equal(await c.tryLock("job:x", "B", 5000), false);
  t += 6000;
  assert.equal(await c.tryLock("job:x", "B", 5000), true);
});

test("koordinator: withLock paralel çağırışlarda yalnız biri işləyir, digərləri CONFLICT alır", async () => {
  const c = new MemoryCoordinator();
  let running = 0;
  let maxRunning = 0;
  const job = async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 30)); running--; return "ok"; };
  const res = await Promise.allSettled(Array.from({ length: 6 }, () => c.withLock("k1", job, { ttlMs: 5000 })));
  assert.equal(res.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(maxRunning, 1);
  assert.ok(res.filter((x) => x.status === "rejected").every((x) => x.reason.code === "CONFLICT"));
});

test("koordinator: açar adı yoxlanır", async () => {
  const c = new MemoryCoordinator();
  await assert.rejects(() => c.once("../x"), (e) => e.code === "VALIDATION_ERROR");
});

test("Durable Object sinfi: fetch RPC-si applyOp ilə işləyir, DoCoordinator onu çağırır (saxta storage ilə)", async () => {
  const map = new Map();
  const storage = { get: async (k) => map.get(k), put: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); } };
  const obj = new JarvisCoordinator({ storage });
  const ns = { idFromName: (n) => n, get: () => ({ fetch: (url, init) => obj.fetch(new Request(url, init)) }) };
  const dc = new DoCoordinator(ns);
  assert.equal(await dc.once("exec:z"), true);
  assert.equal(await dc.once("exec:z"), false);
  assert.equal(await dc.tryLock("l:1", "a"), true);
  assert.equal(await dc.tryLock("l:1", "b"), false);
  const bad = await obj.fetch(new Request("https://x/op", { method: "POST", body: JSON.stringify({ op: "once", key: "../bad" }) }));
  assert.equal(bad.status, 400);
  assert.equal((await obj.fetch(new Request("https://x/op"))).status, 405);
  await assert.rejects(() => applyOp(storage, { op: "wat", key: "okkey" }, 1), (e) => e.code === "VALIDATION_ERROR");
});

test("DoCoordinator: koordinator əlçatmaz olarsa fail-closed (NETWORK_ERROR), 'once' true vermir", async () => {
  const ns = { idFromName: () => "x", get: () => ({ fetch: async () => { throw new Error("down"); } }) };
  const dc = new DoCoordinator(ns);
  await assert.rejects(() => dc.once("exec:q"), (e) => e.code === "NETWORK_ERROR");
});

test("təsdiq: təsdiqsiz icra bloklanır (APPROVAL_REQUIRED), alət işə düşmür", async () => {
  const { registry, runner, calls, approvals } = setup();
  const r = await registry.run("demo.write", { name: "a" }, { approvals, origin: tg(111) });
  assert.equal(r.status, "pending_approval");
  const ex = await runner.execute(r.approval_id, { actor: tg(111) });
  assert.equal(ex.ok, false);
  assert.equal(ex.error.code, "APPROVAL_REQUIRED");
  assert.equal(calls.length, 0);
});

test("təsdiq: başqa çatın təsdiqi işləmir, sahib çat və UI işləyir", async () => {
  const { registry, runner, calls, approvals } = setup();
  const r = await registry.run("demo.write", { name: "b" }, { approvals, origin: tg(111) });
  const other = await runner.approveAndExecute(r.approval_id, { actor: tg(222) });
  assert.equal(other.ok, false);
  assert.equal(other.error.code, "PERMISSION_ERROR");
  assert.equal((await approvals.get(r.approval_id)).status, "pending");
  assert.equal(calls.length, 0);
  const own = await runner.approveAndExecute(r.approval_id, { actor: tg(111) });
  assert.equal(own.ok, true);
  assert.equal(own.output.id, "X-b");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, r.approval_id, "idempotentlik açarı = təsdiq id");

  const r2 = await registry.run("demo.write", { name: "c" }, { approvals, origin: tg(111) });
  assert.equal((await runner.approveAndExecute(r2.approval_id, { actor: UI })).ok, true, "UI sahibi hər qeydi idarə edə bilir");
});

test("təsdiq: aktorsuz çağırış mənşəli qeydi təsdiq edə bilmir", async () => {
  const { registry, approvals } = setup();
  const r = await registry.run("demo.write", { name: "d" }, { approvals, origin: tg(5) });
  const d = await approvals.decide(r.approval_id, { decision: "approve" });
  assert.equal(d.error, "forbidden_origin");
});

test("təsdiq: eyni qeydin 20 paralel icrasından yalnız biri keçir", async () => {
  const { registry, runner, calls, approvals } = setup();
  const r = await registry.run("demo.write", { name: "e" }, { approvals, origin: tg(9) });
  await approvals.decide(r.approval_id, { decision: "approve", actor: tg(9) });
  const res = await Promise.all(Array.from({ length: 20 }, () => runner.execute(r.approval_id, { actor: tg(9) })));
  assert.equal(res.filter((x) => x.ok).length, 1);
  assert.equal(calls.length, 1);
  assert.ok(res.filter((x) => !x.ok).every((x) => x.status === "already_executed" && x.error.code === "CONFLICT"));
});

test("təsdiq: approve ilə reject yarışında yalnız biri qalib gəlir", async () => {
  const { registry, approvals } = setup();
  const r = await registry.run("demo.write", { name: "f" }, { approvals });
  const [a, b] = await Promise.all([approvals.decide(r.approval_id, { decision: "approve", actor: UI }), approvals.decide(r.approval_id, { decision: "reject", actor: UI })]);
  assert.equal([a, b].filter((x) => x.ok).length, 1);
  const rec = await approvals.get(r.approval_id);
  assert.equal(rec.status, [a, b].find((x) => x.ok).record.status);
});

test("təsdiq: payload dəyişdirilsə icra bloklanır, xülasə dəyişdirilsə də", async () => {
  const s1 = setup();
  const r = await s1.registry.run("demo.write", { name: "g" }, { approvals: s1.approvals });
  await s1.approvals.decide(r.approval_id, { decision: "approve", actor: UI });
  const rec = await s1.approvals.get(r.approval_id);
  rec.payload.input.name = "hacked";
  await s1.store.putDoc("approval", rec.id, rec);
  const ex = await s1.runner.execute(rec.id, { actor: UI });
  assert.equal(ex.ok, false);
  assert.equal(s1.calls.length, 0);

  const s2 = setup();
  const r2 = await s2.registry.run("demo.write", { name: "h" }, { approvals: s2.approvals });
  await s2.approvals.decide(r2.approval_id, { decision: "approve", actor: UI });
  const rec2 = await s2.approvals.get(r2.approval_id);
  rec2.content = "Başqa şey göstərilib";
  await s2.store.putDoc("approval", rec2.id, rec2);
  const ex2 = await s2.runner.execute(rec2.id, { actor: UI });
  assert.equal(ex2.ok, false);
  assert.equal(ex2.error.code, "SECURITY_ERROR");
  assert.equal(s2.calls.length, 0);
});

test("təsdiq: icra pəncərəsi bitibsə icra olunmur", async () => {
  const { registry, runner, approvals, clock, calls } = setup();
  const r = await registry.run("demo.write", { name: "i" }, { approvals });
  await approvals.decide(r.approval_id, { decision: "approve", actor: UI });
  clock.t += 31 * 60 * 1000;
  const ex = await runner.execute(r.approval_id, { actor: UI });
  assert.equal(ex.ok, false);
  assert.equal(calls.length, 0);
});

test("icra: vaxt aşımı 'unknown' olur (təkrar edilmir), auth xətası 'failed', yanlış çıxış uğur sayılmır", async () => {
  const s = setup();
  const mk = async (fail) => { const r = await s.registry.run("demo.write", { name: "j" + fail, fail }, { approvals: s.approvals }); return await s.runner.approveAndExecute(r.approval_id, { actor: UI }); };
  const t = await mk("timeout");
  assert.equal(t.status, "unknown");
  assert.equal(t.error.code, "TIMEOUT");
  const a = await mk("auth");
  assert.equal(a.status, "failed");
  const b = await mk("bad");
  assert.equal(b.ok, false);
  assert.equal(b.status, "unknown");
  // unknown olan qeyd yenidən icra oluna bilməz
  const rec = (await s.approvals.list({ limit: 10 })).find((x) => x.execution === "unknown");
  const again = await s.runner.execute(rec.id, { actor: UI });
  assert.equal(again.status, "already_executed");
});

test("icra: icra uğurlu olanda qeyddə nəticə və audit hadisəsi var, gizli açar yoxdur", async () => {
  const { registry, runner, approvals, audit } = setup();
  const r = await registry.run("demo.write", { name: "k" }, { approvals });
  const ex = await runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(ex.status, "done");
  const rec = await approvals.get(r.approval_id);
  assert.equal(rec.execution, "done");
  assert.ok(rec.result.summary.includes("X-k"));
  const events = (await audit.list(40)).map((e) => e.event);
  assert.ok(events.includes("tool.demo.write.executed"));
  assert.ok(events.includes("approval.execution_claimed"));
});

test("reyestr: execute üçün describe məcburidir, təsdiq növü təkrarlana bilməz", () => {
  const reg = new ToolRegistry({});
  const base = { description: "x", inputSchema: { type: "object" }, outputSchema: { type: "object" }, permissions: ["change.price"], risk: "high", requiresApproval: true, handler: async () => ({}) };
  assert.throws(() => reg.register({ ...base, name: "t.one", approval: { kind: "k1", build: () => ({ content: "c", payload: {} }), execute: async () => ({}) } }), /describe/);
  reg.register({ ...base, name: "t.two", approval: { kind: "k2", describe: () => "c", execute: async () => ({}) } });
  assert.throws(() => reg.register({ ...base, name: "t.three", approval: { kind: "k2", describe: () => "c", execute: async () => ({}) } }), /artıq var/);
});
