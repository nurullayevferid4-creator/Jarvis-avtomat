import test from "node:test";
import assert from "node:assert/strict";
import { maybeSendDailyReport, buildReportText, reportHour } from "../src/telegram/dailyReport.js";

const mk = () => {
  const sent = []; const kv = new Map();
  return {
    sent,
    deps: {
      hub: { adapter: () => ({ sendMessage: async (id, t) => { sent.push([id, t]); } }) },
      flow: { listJobs: async () => [{ id: "job-12345678", status: "failed", updated_at: Date.UTC(2026, 9, 8, 3) }, { id: "old", status: "done", updated_at: 1 }] },
      approvals: { list: async () => [{ id: "a" }] },
      store: { getRaw: async (k) => kv.get(k), putRaw: async (k, v) => { kv.set(k, v); } },
    },
  };
};
const env = { DAILY_REPORT_HOUR: "9", TELEGRAM_ALLOWED_CHAT_IDS: "1001" };
const at = (h) => Date.UTC(2026, 9, 8, h - 4, 30); // Bakı saatı h:30

test("günlük hesabat: standart söndürülüb; saatdan əvvəl göndərilmir", async () => {
  const { deps, sent } = mk();
  assert.equal((await maybeSendDailyReport({ env: { TELEGRAM_ALLOWED_CHAT_IDS: "1001" }, ...deps, now: at(10) })).reason, "disabled");
  assert.equal((await maybeSendDailyReport({ env, ...deps, now: at(8) })).reason, "not_yet");
  assert.equal(sent.length, 0);
  assert.equal(reportHour({ DAILY_REPORT_HOUR: "25" }), null);
});

test("günlük hesabat: gündə bir dəfə, yalnız icazəli söhbətə, model çağırışsız mətn", async () => {
  const { deps, sent } = mk();
  assert.equal((await maybeSendDailyReport({ env, ...deps, now: at(10) })).sent, 1);
  assert.equal((await maybeSendDailyReport({ env, ...deps, now: at(11) })).reason, "already_sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "1001");
  assert.match(sent[0][1], /Təsdiq gözləyən: 1/);
  assert.match(sent[0][1], /Problemli işlər/);
  assert.ok(!/old/.test(sent[0][1]), "24 saatdan köhnə iş sayılmır");
  assert.match(buildReportText({ sinceMs: 0 }), /Yeni iş yoxdur/);
});
