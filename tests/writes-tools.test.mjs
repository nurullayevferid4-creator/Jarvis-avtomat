// Yazma alətləri tam axında: alət -> təsdiq qeydi -> Fərid təsdiqləyir (via api) -> icazə təkrar yoxlanır -> icra -> audit.
// Gündəlik limitlər, DM qoruması (razılıq, alıcı başına 1), kill switch, rədd, bypass. Real API çağırılmır.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetAll, runtime, fakeRequest, TOK } from "./wiring-helpers.mjs";
import { WRITE_DAILY_CAPS } from "../src/tools/integrationTools.js";
import { plannerCatalog } from "../src/orchestrator/toolPlanning.js";

beforeEach(() => resetAll());

const J = (data, status = 200) => ({ ok: status < 400, status, data });
const PID = "gid://shopify/Product/1234567890";

function platform() {
  return fakeRequest((url, init) => {
    const u = new URL(url);
    const m = init.method || "GET";
    if (u.hostname === "graph.instagram.com") {
      if (u.pathname === "/v25.0/me") return J({ user_id: "1784" });
      if (u.pathname.endsWith("/media") && m === "POST") return J({ id: "9001" });
      if (u.pathname === "/v25.0/9001") return J({ status_code: "FINISHED" });
      if (u.pathname.endsWith("/media_publish")) return J({ id: "7001" });
      if (u.pathname.endsWith("/messages")) return J({ message_id: "mid.1" });
      if (u.pathname.endsWith("/replies")) return J({ id: "88" });
    }
    if (u.hostname === "open.tiktokapis.com") return J({ data: { publish_id: "p1" }, error: { code: "ok" } });
    if (u.hostname === "oauth2.googleapis.com") return J({ access_token: "ya", token_type: "Bearer" });
    if (u.hostname === "www.googleapis.com") return m === "PUT" ? J({ id: "abcDEF12345", snippet: { title: "yeni" } }) : J({ items: [{ id: "abcDEF12345", snippet: { title: "t", categoryId: "22" } }] });
    if (u.hostname.endsWith("myshopify.com")) return J({ data: { productUpdate: { product: { id: PID, title: "yeni", status: "DRAFT" }, userErrors: [] } } });
    return undefined;
  });
}

const CASES = {
  "instagram.media.publish": { image_url: "https://cdn.example.com/a.jpg", caption: "x" },
  "instagram.container.publish": { container_id: "9001" },
  "instagram.comments.reply": { comment_id: "66", text: "təşəkkür" },
  "instagram.messages.send": { recipient_id: "555", text: "salam" },
  "tiktok.video.publish": { video_url: "https://media.example.com/v.mp4", privacy_level: "SELF_ONLY" },
  "youtube.video.update": { video_id: "abcDEF12345", title: "yeni" },
  "shopify.product.update": { product_id: PID, title: "yeni" },
};
const hosts = (h) => new Set(h.request.calls.map((c) => new URL(c.url).hostname));

async function approveAndRun(h, name, input) {
  const r = await h.rt.tools.run(name, input, h.rt.toolCtx());
  assert.equal(r.status, "pending_approval", name);
  const d = await h.rt.approvals.decide(r.approval_id, { decision: "approve", via: "api" });
  assert.equal(d.ok, true);
  return { id: r.approval_id, ex: await h.rt.executor.executeApproved(r.approval_id) };
}

test("hər yazma aləti: run() yalnız təsdiq qeydi açır (şəbəkə yoxdur); təsdiqdən SONRA icra olunur; nəticədə token yoxdur", async () => {
  for (const [name, input] of Object.entries(CASES)) {
    resetAll();
    const h = runtime({}, platform());
    const pend = await h.rt.tools.run(name, input, h.rt.toolCtx());
    assert.equal(pend.status, "pending_approval", name);
    assert.equal(h.request.calls.length, 0, name + ": təsdiqdən əvvəl şəbəkə çağırışı olmamalıdır");
    const rec = await h.rt.approvals.get(pend.approval_id);
    assert.equal(rec.risk, "high");
    assert.equal(rec.status, "pending");
    await h.rt.approvals.decide(pend.approval_id, { decision: "approve", via: "api" });
    assert.equal(h.request.calls.length, 0, name + ": approve özü icra etməməlidir");
    const ex = await h.rt.executor.executeApproved(pend.approval_id);
    assert.equal(ex.ok, true, name + " " + JSON.stringify(ex).slice(0, 200));
    assert.equal(ex.status, "done");
    assert.ok(h.request.calls.length >= 1, name);
    assert.ok(!JSON.stringify(ex).includes(TOK), name);
    assert.ok(!JSON.stringify(await h.rt.audit.list(100)).includes(TOK));
    assert.equal((await h.rt.executor.executeApproved(pend.approval_id)).status, "already_executed");
  }
});

test("rədd edilən yazma əməliyyatı HEÇ VAXT icra olunmur; söhbətdə 'hə' (via olmadan) onu təsdiqləmir", async () => {
  for (const [name, input] of Object.entries(CASES)) {
    resetAll();
    const h = runtime({}, platform());
    const pend = await h.rt.tools.run(name, input, h.rt.toolCtx());
    const chat = await h.rt.approvals.decide(pend.approval_id, { decision: "approve" });
    assert.deepEqual({ ok: chat.ok, error: chat.error }, { ok: false, error: "api_required" }, name);
    await h.rt.approvals.decide(pend.approval_id, { decision: "reject", via: "api" });
    assert.notEqual((await h.rt.executor.executeApproved(pend.approval_id)).ok, true, name);
    assert.equal(h.request.calls.length, 0, name);
  }
});

test("icazə geri götürülübsə (REVOKED_PERMISSIONS) təsdiqlənmiş yazma da icra olunmur: publish.social, send.message, edit.video, edit.product", async () => {
  const map = { "instagram.media.publish": "publish.social", "tiktok.video.publish": "publish.social", "instagram.messages.send": "send.message", "instagram.comments.reply": "send.message", "youtube.video.update": "edit.video", "shopify.product.update": "edit.product" };
  for (const [name, perm] of Object.entries(map)) {
    resetAll();
    const request = platform();
    const h = runtime({}, request);
    const pend = await h.rt.tools.run(name, CASES[name], h.rt.toolCtx());
    await h.rt.approvals.decide(pend.approval_id, { decision: "approve", via: "api" });
    // icra anında kill switch aktivdir
    const h2 = runtime({ REVOKED_PERMISSIONS: perm }, request);
    h2.env.JARVIS_KV = h.env.JARVIS_KV;
    const ex = await h2.rt.executor.executeApproved(pend.approval_id);
    assert.equal(ex.ok, false, name);
    assert.equal(request.calls.length, 0, name + ": kill switch şəbəkəyə çıxmağa icazə verməməlidir");
  }
});

test("gündəlik limit: təsdiqlənmiş olsa belə limit aşıla bilməz (TikTok paylaşım gündə ≤ 3)", async () => {
  const h = runtime({}, platform());
  const cap = WRITE_DAILY_CAPS["tiktok.video.publish"];
  assert.equal(cap, 3);
  for (let i = 0; i < cap; i++) {
    const { ex } = await approveAndRun(h, "tiktok.video.publish", { ...CASES["tiktok.video.publish"], title: "v" + i });
    assert.equal(ex.ok, true, "çağırış " + i);
  }
  const before = h.request.calls.length;
  const { ex } = await approveAndRun(h, "tiktok.video.publish", { ...CASES["tiktok.video.publish"], title: "v-extra" });
  assert.equal(ex.ok, false);
  assert.equal(ex.code || (ex.error && /limit/i.test(ex.error) ? "rate_limited" : ""), "rate_limited", JSON.stringify(ex).slice(0, 200));
  assert.equal(h.request.calls.length, before, "limit dolduqdan sonra şəbəkə çağırışı yoxdur");
});

test("Instagram DM: eyni alıcıya gündə yalnız 1; fərqli alıcıya icazə var; ümumi gündəlik limit var", async () => {
  const h = runtime({}, platform());
  assert.equal((await approveAndRun(h, "instagram.messages.send", { recipient_id: "555", text: "salam" })).ex.ok, true);
  const n = h.request.calls.length;
  const again = await approveAndRun(h, "instagram.messages.send", { recipient_id: "555", text: "yenə salam" });
  assert.equal(again.ex.ok, false);
  assert.equal(h.request.calls.length, n, "ikinci mesaj şəbəkəyə çıxmır");
  assert.equal((await approveAndRun(h, "instagram.messages.send", { recipient_id: "556", text: "salam" })).ex.ok, true);
  assert.equal(WRITE_DAILY_CAPS["instagram.messages.send"], 10);
});

test("Instagram DM: razılığı 'denied' olan və ya bağlanmış lead-ə mesaj getmir (kütləvi/istənməyən mesaj mexanizmi yoxdur)", async () => {
  const h = runtime({}, platform());
  const ctx = h.rt.toolCtx();
  const denied = await h.rt.tools.run("lead.create", { channel: "instagram", consent: "denied", ig_scoped_id: "777" }, ctx);
  const lost = await h.rt.tools.run("lead.create", { channel: "instagram", stage: "lost", ig_scoped_id: "778" }, ctx);
  assert.equal(denied.status, "done", JSON.stringify(denied));
  assert.equal(lost.status, "done");
  for (const rid of ["777", "778"]) {
    const { ex } = await approveAndRun(h, "instagram.messages.send", { recipient_id: rid, text: "salam" });
    assert.equal(ex.ok, false, rid);
  }
  assert.equal(h.request.calls.length, 0);
  assert.equal((await h.rt.tools.run("lead.create", { channel: "instagram", ig_scoped_id: "abc" }, ctx)).ok, false, "IGSID yalnız rəqəm");
});

test("SalesAgent: Instagram lead-i üçün sales.message.send özü göndərmir, instagram.messages.send-i göstərir; hər ikisi ayrıca təsdiq tələb edir", async () => {
  const h = runtime({}, platform());
  const ctx = h.rt.toolCtx();
  const lead = await h.rt.tools.run("lead.create", { channel: "instagram", consent: "given", ig_scoped_id: "555", name: "Test" }, ctx);
  assert.equal(lead.status, "done", JSON.stringify(lead));
  const { ex } = await approveAndRun(h, "sales.message.send", { lead_id: lead.output.id, text: "salam" });
  assert.equal(ex.ok, true);
  assert.equal(ex.output.sent, false);
  assert.equal(ex.output.delivery, "use_instagram_messages_send");
  assert.equal(h.request.calls.length, 0, "sales.message.send heç nə göndərmir");
  const pipe = await h.rt.tools.run("sales.pipeline", { lead_id: lead.output.id }, ctx);
  assert.equal(pipe.status, "done", JSON.stringify(pipe));
});

test("planlayıcı kataloqunda yazma alətləri 'təsdiq tələb edir' kimi görünür; gündəlik limit sabitləri tam siyahıdadır", async () => {
  const h = runtime();
  const cat = plannerCatalog(h.rt.tools, h.rt.toolCtx().permissions);
  for (const name of Object.keys(CASES)) assert.equal(cat.find((t) => t.name === name).requiresApproval, true, name);
  for (const name of Object.keys(CASES)) assert.ok(WRITE_DAILY_CAPS[name] > 0, name + ": limit yoxdur");
  assert.ok(Object.isFrozen(WRITE_DAILY_CAPS));
});

test("credential olmadan təsdiqlənmiş yazma 'not_configured' ilə bitir (saxta uğur yoxdur), şəbəkə yoxdur", async () => {
  const h = runtime({ IG_FNPARFUM_TOKEN: "", TIKTOK_ACCESS_TOKEN: "", SHOPIFY_ADMIN_TOKEN: "" }, platform());
  for (const name of ["instagram.media.publish", "tiktok.video.publish", "shopify.product.update"]) {
    const { ex } = await approveAndRun(h, name, CASES[name]);
    assert.equal(ex.ok, false, name);
    assert.ok(/not_configured|credential/.test(JSON.stringify(ex)), name + " " + JSON.stringify(ex).slice(0, 160));
  }
  assert.equal(h.request.calls.length, 0);
  assert.ok(hosts(h).size === 0);
});
