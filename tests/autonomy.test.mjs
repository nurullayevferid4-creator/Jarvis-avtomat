import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createStore, _resetMemoryForTests } from "../src/state/store.js";
import { parseSchedule, nextRun, nextAfterRun, validSchedule } from "../src/autonomy/schedule.js";
import { tick, MAX_ATTEMPTS, BACKOFF_BASE_MS, loadState, loadHistory } from "../src/autonomy/scheduler.js";
import { createHandlers } from "../src/autonomy/jobs.js";
import { maybeSendDailyReport } from "../src/telegram/dailyReport.js";

beforeEach(() => _resetMemoryForTests());
const bakuMs = (d, h, m = 0) => Date.UTC(2026, 9, d, h - 4, m); // Bakı vaxtı → UTC ms
const ENV = { AUTONOMY_JOBS: "qr_menu.market_research", TELEGRAM_ALLOWED_CHAT_IDS: "1001" };
const T = "qr_menu.market_research";

test("cədvəl: hər gün / hər 3 gün / sabah saat (Bakı)", () => {
  const now = bakuMs(8, 2, 50);
  assert.deepEqual(parseSchedule("hər gün 09:00", now), { kind: "daily", at: "09:00" });
  assert.deepEqual(parseSchedule("Hər 3 gün saat 20:00", now), { kind: "every_days", n: 3, at: "20:00" });
  assert.deepEqual(parseSchedule("sabah saat 20:00", now), { kind: "once", at_ms: bakuMs(9, 20) });
  assert.equal(parseSchedule("bəlkə sonra", now), null);
  assert.equal(parseSchedule("hər gün 25:99", now), null);
  assert.equal(nextRun({ kind: "daily", at: "09:00" }, now), bakuMs(8, 9));
  assert.equal(nextRun({ kind: "daily", at: "02:00" }, now), bakuMs(9, 2));
  assert.equal(nextAfterRun({ kind: "every_days", n: 3, at: "20:00" }, bakuMs(8, 20, 5)), bakuMs(11, 20));
  assert.equal(nextRun({ kind: "once", at_ms: bakuMs(7, 1) }, now), null);
  assert.ok(!validSchedule({ kind: "every_days", n: 0, at: "09:00" }));
});

test("tick: açar yoxdursa job söndürülüb; açıq mənbə yoxdursa uydurma yox, pending", async () => {
  const store = createStore({});
  assert.deepEqual((await tick({ store, env: {}, handlers: createHandlers({}), now: bakuMs(8, 10) })).ran, []);
  const handlers = createHandlers({ env: ENV });
  await tick({ store, env: ENV, handlers, now: bakuMs(8, 8) }); // seed: növbəti slot 09:00
  const r = await tick({ store, env: ENV, handlers, now: bakuMs(8, 9, 1) });
  assert.deepEqual(r.ran, [{ job: T, status: "pending" }]);
  const h = await loadHistory(store);
  assert.match(h[0].summary, /REAL TEST PENDING/);
});

test("tick: eyni slot iki dəfə icra olunmur; məlumat real KV-yə uyğun açarlarla yazılır", async () => {
  const store = createStore({});
  let calls = 0;
  const handlers = { [T]: async () => { calls++; return { status: "ok", summary: "https://example.com ilə bir nəticə" }; } };
  await tick({ store, env: ENV, handlers, now: bakuMs(8, 8) });
  await tick({ store, env: ENV, handlers, now: bakuMs(8, 9, 1) });
  const st = await loadState(store);
  st.jobs[T].next_run_at = bakuMs(8, 9); // eyni slot geri qaytarılır
  await store.putRaw("autostate", st);
  await tick({ store, env: ENV, handlers, now: bakuMs(8, 9, 6) });
  assert.equal(calls, 1);
  assert.equal((await loadState(store)).jobs[T].next_run_at, bakuMs(8, 9)); // slot dəyişməyib, təkrar icra yoxdur
});

test("retry: exponential backoff, max cəhd sonra dayanır, xəbərdarlıq yalnız bir dəfə", async () => {
  const store = createStore({});
  const alerts = [];
  const handlers = { [T]: async () => { throw new Error("API 500"); } };
  const run = (now) => tick({ store, env: ENV, handlers, notify: async (t) => alerts.push(t), now });
  await run(bakuMs(8, 8));
  let now = bakuMs(8, 9, 1);
  await run(now);
  let st = await loadState(store);
  assert.equal(st.jobs[T].attempts, 1);
  assert.equal(st.jobs[T].next_run_at, now + BACKOFF_BASE_MS);
  now = st.jobs[T].next_run_at;
  await run(now);
  st = await loadState(store);
  assert.equal(st.jobs[T].next_run_at, now + BACKOFF_BASE_MS * 2);
  assert.equal(alerts.length, 0);
  now = st.jobs[T].next_run_at;
  await run(now);
  st = await loadState(store);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /uğursuz oldu: qr_menu\.market_research/);
  assert.equal(st.jobs[T].attempts, 0);
  assert.ok(st.jobs[T].next_run_at > now + 3600 * 1000, "növbəti normal slota keçdi, sonsuz təkrar yoxdur");
  assert.equal((await loadHistory(store)).filter((x) => x.status === "failed").length, 1);
  assert.equal(MAX_ATTEMPTS, 3);
});

test("market research: veb axtarış və URL olmadan nəticə qəbul edilmir; mənbəli cavab ok", async () => {
  const mk = (r) => createHandlers({ env: ENV, research: async () => r })[T]();
  assert.equal((await mk({ text: "uydurma mətn", web: false })).status, "pending");
  assert.equal((await mk({ text: "URL yoxdur", web: true })).status, "pending");
  assert.equal((await mk({ text: "Rəqib: https://example.com/q", web: true })).status, "ok");
});

test("gündəlik hesabat REAL store ilə işləyir və avtonom iş nəticələrini göstərir", async () => {
  const store = createStore({});
  await tick({ store, env: ENV, handlers: createHandlers({ env: ENV }), now: bakuMs(8, 8) });
  await tick({ store, env: ENV, handlers: createHandlers({ env: ENV }), now: bakuMs(8, 9, 1) });
  const sent = [];
  const deps = { hub: { adapter: () => ({ sendMessage: async (id, t) => sent.push([id, t]) }) }, flow: { listJobs: async () => [] }, approvals: { list: async () => [] }, store };
  const r = await maybeSendDailyReport({ env: { ...ENV, DAILY_REPORT_HOUR: "9" }, ...deps, now: bakuMs(8, 10) });
  assert.equal(r.sent, 1);
  assert.match(sent[0][1], /Avtonom işlər/);
  assert.match(sent[0][1], /qr_menu\.market_research: pending/);
  assert.equal((await maybeSendDailyReport({ env: { ...ENV, DAILY_REPORT_HOUR: "9" }, ...deps, now: bakuMs(8, 11) })).reason, "already_sent");
});
