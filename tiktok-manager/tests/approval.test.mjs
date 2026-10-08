import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { ApprovalCenter, STATES } from "../src/approval.js";
import { preparePublish, makeExecutor } from "../src/publisher.js";
import { setup, fakeVideo, goodPackage } from "./helpers.mjs";

const ACC = "acc-test-1";

test("Standart: execute_enabled=false", () => {
  const { cfg } = setup();
  assert.equal(cfg.executeEnabled, false);
});

test("Təsdiqsiz publish icra olunmur, şəbəkəyə çağırış getmir", async () => {
  const { cfg, ws, client, mock, dir } = setup({ env: { TIKTOK_EXECUTE_ENABLED: "true" } });
  const ap = new ApprovalCenter(ws, ACC, cfg);
  const prep = await preparePublish({ pkg: goodPackage(), videoPath: fakeVideo(dir), client, approvals: ap, workspace: ws, accountId: ACC, facts: {}, cfg });
  assert.equal(prep.approval.status, STATES.REVIEW);
  const before = mock.state.calls.length;
  await assert.rejects(ap.execute(prep.approval.id, makeExecutor(client)), (e) => e.code === "not_approved");
  assert.equal(mock.state.calls.length, before);
  assert.equal(mock.state.published.length, 0);
});

test("Agent/bot təsdiq verə bilməz", async () => {
  const { cfg, ws } = setup();
  const ap = new ApprovalCenter(ws, ACC, cfg);
  const r = ap.submit(ap.draft("video.publish", { caption: "salam", media: {}, post_info: {} }).id);
  for (const by of [undefined, "", "claude", "agent-x", "system", "auto"]) assert.throws(() => ap.approve(r.id, { by }), /sahibi/);
  assert.equal(ap.approve(r.id, { by: "Fərid" }).status, STATES.APPROVED);
});

test("Təsdiq olunub, amma execute_enabled=false → icra bloklanır", async () => {
  const { cfg, ws, client, mock, dir } = setup();
  const ap = new ApprovalCenter(ws, ACC, cfg);
  const prep = await preparePublish({ pkg: goodPackage(), videoPath: fakeVideo(dir), client, approvals: ap, workspace: ws, accountId: ACC, facts: {}, cfg });
  ap.approve(prep.approval.id, { by: "Fərid" });
  await assert.rejects(ap.execute(prep.approval.id, makeExecutor(client)), (e) => e.code === "execute_disabled");
  assert.equal(mock.state.published.length, 0);
  assert.ok(prep.manual_package.endsWith(".md"), "manual paket yaradılır");
});

test("Tam axın: DRAFT → REVIEW → APPROVE → EXECUTE (mock, SELF_ONLY), ikinci icra yoxdur", async () => {
  const { cfg, ws, client, mock, dir } = setup({ env: { TIKTOK_EXECUTE_ENABLED: "1" } });
  const ap = new ApprovalCenter(ws, ACC, cfg);
  const prep = await preparePublish({ pkg: goodPackage(), videoPath: fakeVideo(dir), client, approvals: ap, workspace: ws, accountId: ACC, facts: {}, cfg });
  ap.approve(prep.approval.id, { by: "Fərid" });
  const r = await ap.execute(prep.approval.id, makeExecutor(client));
  assert.equal(r.status, STATES.EXECUTED, JSON.stringify(r.error));
  assert.equal(r.result.status, "PUBLISH_COMPLETE");
  assert.equal(mock.state.published.length, 1);
  const init = Object.values(mock.state.uploads)[0];
  assert.equal(init.post_info.privacy_level, "SELF_ONLY");
  await assert.rejects(ap.execute(prep.approval.id, makeExecutor(client)), (e) => e.code === "not_approved");
  assert.equal(mock.state.published.length, 1);
});

test("Payload təsdiqdən sonra dəyişsə icra bloklanır", async () => {
  const { cfg, ws } = setup({ env: { TIKTOK_EXECUTE_ENABLED: "1" } });
  const ap = new ApprovalCenter(ws, ACC, cfg);
  const r = ap.submit(ap.draft("video.publish", { caption: "A", media: {}, post_info: { privacy_level: "SELF_ONLY" } }).id);
  ap.approve(r.id, { by: "Fərid" });
  const list = ap.all();
  list[0].payload.caption = "B (gizli dəyişiklik)";
  ap.save(list);
  await assert.rejects(ap.execute(r.id, async () => ({})), (e) => e.code === "payload_changed");
});

test("Video faylı təsdiqdən sonra dəyişsə icra FAILED olur, paylaşım yoxdur", async () => {
  const { cfg, ws, client, mock, dir } = setup({ env: { TIKTOK_EXECUTE_ENABLED: "1" } });
  const ap = new ApprovalCenter(ws, ACC, cfg);
  const path = fakeVideo(dir);
  const prep = await preparePublish({ pkg: goodPackage(), videoPath: path, client, approvals: ap, workspace: ws, accountId: ACC, facts: {}, cfg });
  ap.approve(prep.approval.id, { by: "Fərid" });
  writeFileSync(path, Buffer.alloc(4096, 1));
  const r = await ap.execute(prep.approval.id, makeExecutor(client));
  assert.equal(r.status, STATES.FAILED);
  assert.equal(r.error.code, "media_changed");
  assert.equal(mock.state.published.length, 0);
});

test("Comment reply və DM: təsdiqlənsə də və execute açıq olsa da UNSUPPORTED_BY_TIKTOK_API", async () => {
  const { cfg, ws } = setup({ env: { TIKTOK_EXECUTE_ENABLED: "1" } });
  const ap = new ApprovalCenter(ws, ACC, cfg);
  let called = false;
  for (const [kind, payload] of [["comment.reply", { comment_id: "c1", text: "Təşəkkürlər!" }], ["dm.send", { recipients: ["u1"], in_reply_to: "m1", text: "Salam!" }]]) {
    const d = ap.draft(kind, payload);
    assert.equal(d.api_supported, false);
    assert.match(d.note, /UNSUPPORTED_BY_TIKTOK_API/);
    ap.submit(d.id); ap.approve(d.id, { by: "Fərid" });
    await assert.rejects(ap.execute(d.id, async () => { called = true; }), (e) => e.code === "UNSUPPORTED_BY_TIKTOK_API");
  }
  assert.equal(called, false);
});

test("Siyasət pozuntusu olan qaralama REVIEW-a keçmir", () => {
  const { cfg, ws } = setup();
  const ap = new ApprovalCenter(ws, ACC, cfg);
  const d = ap.draft("video.publish", { caption: "Bu video mütləq viral olacaq! Follower satın al", media: {}, post_info: {} });
  assert.ok(d.violations.length >= 2);
  assert.throws(() => ap.submit(d.id), /Siyasət/);
  const dm = ap.draft("dm.send", { recipients: ["a", "b", "c"], text: "Endirim!" });
  assert.ok(dm.violations.some((v) => v.rule === "mass_dm"));
  assert.ok(dm.violations.some((v) => v.rule === "cold_dm"));
});

test("Audit olunmamış app: PUBLIC paylaşım paketi yoxlamada rədd olunur", async () => {
  const { cfg, ws, client, dir } = setup({ env: { TIKTOK_EXECUTE_ENABLED: "1" } });
  const ap = new ApprovalCenter(ws, ACC, cfg);
  const prep = await preparePublish({ pkg: goodPackage("PUBLIC_TO_EVERYONE"), videoPath: fakeVideo(dir), client, approvals: ap, workspace: ws, accountId: ACC, facts: {}, cfg });
  assert.equal(prep.approval, null);
  assert.ok(prep.check.errors.some((e) => /SELF_ONLY/.test(e)));
});

test("TikTok özü də unaudited PUBLIC-i rədd edir (mock sənəd xətası) → FAILED, avtomatik təkrar yoxdur", async () => {
  const { cfg, ws, client, mock, dir } = setup({ env: { TIKTOK_EXECUTE_ENABLED: "1", TIKTOK_APP_AUDITED: "true" } });
  const ap = new ApprovalCenter(ws, ACC, cfg);
  const prep = await preparePublish({ pkg: goodPackage("PUBLIC_TO_EVERYONE"), videoPath: fakeVideo(dir), client, approvals: ap, workspace: ws, accountId: ACC, facts: {}, cfg });
  ap.approve(prep.approval.id, { by: "Fərid" });
  const r = await ap.execute(prep.approval.id, makeExecutor(client));
  assert.equal(r.status, STATES.FAILED);
  assert.equal(r.error.code, "unaudited_client");
  assert.equal(mock.state.calls.filter((c) => c.path === "/v2/post/publish/video/init/").length, 1);
});
