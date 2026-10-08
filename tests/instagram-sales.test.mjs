// Instagram satış sistemi: OAuth, hesab oxuma, webhook, DM/şərh qəbulu, təsnif/qaralama, lead dedup, təsdiq, audit/xəta.
// HEÇ BİR real şəbəkə çağırışı yoxdur (saxta fetch). Real Instagram hesabı ilə sınaq: docs/INSTAGRAM.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { json, installSocialFetch, bodyJson, world, seedToken } from "./social-helpers.mjs";
import { createSales, STAGES } from "../src/instagram/sales.js";
import { classifyDm, classifyIgComment, draftDm, replyIsSafe, draftCommentReply } from "../src/instagram/analyze.js";
import { verifyChallenge, verifySignature, parseWebhook, createInbox } from "../src/instagram/inbox.js";
import { registerInstagramSalesTools } from "../src/instagram/tools.js";
import { createIgCommands, igIntent } from "../src/instagram/commands.js";
import { createDefaultToolRegistry } from "../src/tools/builtin.js";
import { createActionRunner } from "../src/actions/runner.js";
import { createCoordinator } from "../src/coord/coordinator.js";
import { SCOPES } from "../src/social/adapters/Instagram.js";

const HOUR = 3600000;
const DAY = 24 * HOUR;
const OWNER = { channel: "telegram", chat_id: "1001", user_id: "1001" };
const SCOPE = SCOPES.join(",");

async function salesWorld(envExtra = {}) {
  const w = world(envExtra);
  await seedToken(w, "instagram", { access_token: "IGTOK_SECRET", user_id: "178", scope: SCOPE, account: { username: "qrmenu_az" }, obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  const coord = createCoordinator(w.env);
  const sales = createSales({ store: w.store, coord, now: w.now });
  const tools = createDefaultToolRegistry({ audit: w.audit, approvals: w.approvals });
  registerInstagramSalesTools(tools, { hub: w.hub, sales, audit: w.audit });
  const runner = createActionRunner({ approvals: w.approvals, registry: tools, audit: w.audit });
  const draftFn = async ({ analysis }) => ({ text: "Salam! Sahibimiz sizinlə əlaqə saxlayacaq.", source: "template", needs_owner: analysis.needs_owner });
  const inbox = createInbox({ env: w.env, hub: w.hub, sales, runner, audit: w.audit, now: w.now, draftFn });
  return { ...w, sales, tools, runner, inbox };
}

// Telegram + Instagram saxta serverləri
function servers({ sendMessage = () => json({ message_id: "mid.1" }), conv = null } = {}) {
  const tgMessages = [];
  const routes = [
    [/api\.telegram\.org\/bot[^/]+\/sendMessage/, (c) => { tgMessages.push(bodyJson(c)); return json({ ok: true, result: { message_id: 1 } }); }],
    [/graph\.instagram\.com\/v25\.0\/178\/messages/, sendMessage],
    [/graph\.instagram\.com\/v25\.0\/\d+\?.*fields=name/, () => json({ name: "Aysel", username: "aysel_cafe" })],
    [/graph\.instagram\.com\/v25\.0\/\d+\/replies/, () => json({ id: "17999000111" })],
    [/graph\.instagram\.com\/v25\.0\/178\/conversations/, () => json(conv || { data: [] })],
  ];
  return { routes, tgMessages };
}

// ---------- OAuth / hesab ----------
test("Instagram scope-ları DM və şərh icazələrini də istəyir", () => {
  for (const s of ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_messages", "instagram_business_manage_comments"]) assert.ok(SCOPES.includes(s), s);
});

test("OAuth: webhook abunəliyi alınmasa 'subscribed' DEYİLİR (saxta uğur yoxdur)", async () => {
  const w = world();
  installSocialFetch([
    [/api\.instagram\.com\/oauth\/access_token/, () => json({ data: [{ access_token: "S", user_id: "178", permissions: SCOPES }] })],
    [/graph\.instagram\.com\/access_token\?/, () => json({ access_token: "L", expires_in: 5184000 })],
    [/graph\.instagram\.com\/v25\.0\/me\?/, () => json({ user_id: "178", username: "qrmenu_az", account_type: "BUSINESS" })],
    [/subscribed_apps/, () => json({ error: { code: 10, message: "permission" } }, 400)],
  ]);
  const r = await w.hub.adapter("instagram").exchangeCode("C", "https://jarvis.example.dev/oauth/instagram/callback");
  assert.match(r.webhook, /^failed:permission_denied/);
  assert.equal(r.account.username, "qrmenu_az");
});

test("hesab oxuma: salesStatus token günü və icazələri göstərir; köhnə tokendə (icazəsiz) DM/şərh ❌", async () => {
  const w = await salesWorld();
  installSocialFetch([[/\/me\?/, () => json({ user_id: "178", username: "qrmenu_az", account_type: "BUSINESS" })]]);
  const s = await w.hub.adapter("instagram").salesStatus();
  assert.equal(s.account.username, "qrmenu_az");
  assert.equal(s.expires_in_days, 30);
  assert.ok(s.messaging_scope && s.comments_scope && s.publish_scope);
  await seedToken(w, "instagram", { access_token: "T", user_id: "178", scope: "instagram_business_basic,instagram_business_content_publish", obtained_at: w.now(), expires_at: w.now() + 5 * DAY });
  const old = await w.hub.adapter("instagram").salesStatus();
  assert.equal(old.messaging_scope, false);
  assert.equal(old.comments_scope, false);
});

test("token xətası: bitmiş token token_expired, API 190 xətası uğur kimi göstərilmir", async () => {
  const w = await salesWorld();
  const ig = w.hub.adapter("instagram");
  installSocialFetch([[/\/me\?/, () => json({ error: { code: 190, type: "OAuthException", message: "Error validating access token: Session has expired" } }, 400)]]);
  await assert.rejects(() => ig.salesStatus(), (e) => e.code === "token_expired");
  await seedToken(w, "instagram", { access_token: "T", user_id: "178", scope: SCOPE, obtained_at: w.now() - 70 * DAY, expires_at: w.now() - DAY });
  await assert.rejects(() => ig.salesStatus(), (e) => e.code === "token_expired");
});

// ---------- webhook ----------
test("webhook: verify token və HMAC imzası yoxlanır", async () => {
  const env = { INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "vt-123", INSTAGRAM_APP_SECRET: "appsecret" };
  const u = (q) => new URL("https://x.dev/instagram/webhook?" + q);
  assert.equal(verifyChallenge(u("hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=CH42"), env), "CH42");
  assert.equal(verifyChallenge(u("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CH42"), env), null);
  assert.equal(verifyChallenge(u("hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=CH42"), {}), null, "token təyin olunmayıbsa heç vaxt qəbul olunmur");
  const body = JSON.stringify({ entry: [] });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("appsecret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const good = "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifySignature(body, good, env), true);
  assert.equal(await verifySignature(body + " ", good, env), false, "gövdə dəyişsə imza keçmir");
  assert.equal(await verifySignature(body, "sha256=" + "0".repeat(64), env), false);
  assert.equal(await verifySignature(body, null, env), false);
  assert.equal(await verifySignature(body, good, {}), false, "secret yoxdursa rədd");
});

test("webhook parse: DM və şərh çıxarılır; echo, mətnsiz və tanınmayan atılır", () => {
  const ev = parseWebhook({ entry: [{ id: "178", messaging: [
    { sender: { id: "5551234" }, recipient: { id: "178" }, timestamp: 1, message: { mid: "m1", text: "Salam, qiymət nədir?" } },
    { sender: { id: "178" }, recipient: { id: "5551234" }, message: { mid: "m2", text: "echo", is_echo: true } },
    { sender: { id: "5551234" }, message: { mid: "m3" } },
  ], changes: [
    { field: "comments", value: { id: "17900000001", text: "Necə sifariş edim?", from: { id: "777001", username: "kafe_baki" }, media: { id: "18000000001" } } },
    { field: "mentions", value: { id: "x" } },
  ] }] });
  assert.deepEqual(ev.map((e) => e.type + ":" + e.id), ["dm:m1", "comment:17900000001"]);
  assert.deepEqual(parseWebhook(null), []);
  assert.deepEqual(parseWebhook({ entry: "x" }), []);
});

// ---------- təsnif / qaralama ----------
test("DM təsnifatı: qiymət, alış niyyəti, demo, şikayət, spam, təhqir; biznes növü və şəhər", () => {
  assert.equal(classifyDm("Salam, qiymət nə qədərdir?").kind, "price");
  assert.equal(classifyDm("Kafem üçün QR menyu almaq istəyirəm, Bakıdayıq").kind, "buy_intent");
  const a = classifyDm("Kafem üçün QR menyu almaq istəyirəm, Bakıdayıq");
  assert.equal(a.interest, "hot");
  assert.equal(a.business_type, "kafe");
  assert.equal(a.city, "Bakı");
  assert.equal(classifyDm("nümunə göstərə bilərsiniz?").kind, "demo_request");
  assert.equal(classifyDm("işləmir, problem var").kind, "complaint");
  assert.equal(classifyDm("check https://spam.example casino bonus").kind, "spam");
  assert.equal(classifyDm("sən axmaqsan").kind, "abuse");
  assert.equal(classifyDm("qiymət?").needs_owner, true);
});

test("şərh təsnifatı: spam, təhqir, qiymət, şikayət; spam/təhqirə cavab yoxdur", () => {
  assert.equal(classifyIgComment("follow me crypto"), "spam");
  assert.equal(classifyIgComment("idiot"), "abuse");
  assert.equal(classifyIgComment("neçəyədir? qiymət"), "price_question");
  assert.equal(classifyIgComment("pis idi, problem"), "complaint");
  assert.equal(draftCommentReply("spam"), null);
  assert.equal(draftCommentReply("abuse"), null);
  assert.ok(draftCommentReply("price_question"));
});

test("DM qaralaması: qiymət/endirim/yad link olan Claude cavabı atılır, şablon qalır; təhlükəsiz cavab qəbul olunur; qiymət sualı modelə getmir", async () => {
  const env = { ANTHROPIC_API_KEY: "k" };
  const mk = (text) => ({ complete: async () => ({ text }) });
  const q = classifyDm("QR menyu nədir?");
  const bad = await draftDm({ env, text: "QR menyu nədir?", analysis: q, router: mk("Əlbəttə! İndi 50% endirim var, 10 AZN-ə.") });
  assert.equal(bad.source, "template");
  const link = await draftDm({ env, text: "QR menyu nədir?", analysis: q, router: mk("Baxın: https://evil.example/x") });
  assert.equal(link.source, "template");
  const ok = await draftDm({ env, text: "QR menyu nədir?", analysis: q, router: mk("Salam! Masadakı QR kodu oxudanda menyu telefonda açılır. Nümunə: https://weenetwork.menu/ru/menu/29") });
  assert.equal(ok.source, "claude");
  let called = 0;
  const price = await draftDm({ env, text: "qiymət?", analysis: classifyDm("qiymət nə qədər?"), router: { complete: async () => { called++; return { text: "x" }; } } });
  assert.equal(called, 0, "qiymət sualı modelə verilmir: sabit şablon");
  assert.match(price.text, /sahibimiz/);
  assert.ok(!/\d\s*(azn|₼|%)/i.test(price.text));
  assert.equal(replyIsSafe("10 AZN"), false);
  assert.equal(replyIsSafe("Nümunə: https://weenetwork.menu/ru/menu/29"), true);
  const noKey = await draftDm({ env: {}, text: "QR menyu nədir?", analysis: q });
  assert.equal(noKey.source, "template", "ANTHROPIC_API_KEY yoxdursa şablon, OpenAI-yə keçid yoxdur");
});

// ---------- lead / satış axını ----------
test("lead dedup: eyni IGSID və ya username təkrar lead yaratmır; username sonradan IGSID ilə birləşir", async () => {
  const w = await salesWorld();
  const a = await w.sales.upsert({ username: "@Kafe_Baki", source: "comment", inbound: true, kind: "comment", comment_id: "179", text: "necə sifariş?", interest: "hot" });
  assert.equal(a.created, true);
  const b = await w.sales.upsert({ username: "kafe_baki", igsid: "5551234", source: "dm", inbound: true, kind: "dm", text: "salam" });
  assert.equal(b.created, false);
  assert.equal(b.lead.id, a.lead.id);
  assert.equal(b.lead.igsid, "5551234");
  const c = await w.sales.upsert({ igsid: "5551234", inbound: true, kind: "dm", text: "yenə mən" });
  assert.equal(c.created, false);
  assert.equal((await w.sales.summary()).total, 1);
  await assert.rejects(() => w.sales.upsert({ text: "heç nə" }), /username və ya IGSID/);
});

test("satış mərhələləri: NEW→…→WON; qadağan keçid rədd; WON son; sistem özü WON/LOST qoymur", async () => {
  const w = await salesWorld();
  const { lead } = await w.sales.upsert({ username: "bar_x", igsid: "6001001", inbound: true, kind: "dm", text: "demo istəyirəm", interest: "hot" });
  assert.equal(lead.stage, "INTERESTED", "isti DM NEW→INTERESTED");
  assert.deepEqual(STAGES, ["NEW", "CONTACTED", "INTERESTED", "QUALIFIED", "NEGOTIATION", "WON", "LOST"]);
  await assert.rejects(() => w.sales.setStage(lead.id, "WON"), /keçidi mümkün deyil/);
  await w.sales.setStage(lead.id, "QUALIFIED");
  await w.sales.setStage(lead.id, "NEGOTIATION");
  assert.equal((await w.sales.setStage(lead.id, "won")).stage, "WON");
  await assert.rejects(() => w.sales.setStage(lead.id, "LOST"), /keçidi mümkün deyil/);
  await assert.rejects(() => w.sales.setStage("L9999", "LOST"), /tapılmadı/);
  await assert.rejects(() => w.sales.setStage(lead.id, "BANANA"), /Mərhələ/);
});

test("göndərmə qaydası: 24 saat pəncərəsi, soyuq DM = manual_action_required, private reply yalnız bir dəfə / 7 gün", async () => {
  const w = await salesWorld();
  const dm = (await w.sales.upsert({ igsid: "7001001", username: "u1", inbound: true, kind: "dm", text: "salam" })).lead;
  assert.deepEqual(w.sales.sendPolicy(dm, w.now()), { ok: true, mode: "reply", recipient_id: "7001001" });
  const late = w.sales.sendPolicy(dm, w.now() + 25 * HOUR);
  assert.equal(late.ok, false);
  assert.equal(late.mode, "manual_action_required");
  const cold = (await w.sales.upsert({ username: "cold_cafe", source: "manual" })).lead;
  assert.equal(w.sales.sendPolicy(cold).mode, "manual_action_required", "yazmamış istifadəçiyə soyuq DM yoxdur");
  const cm = (await w.sales.upsert({ username: "comm_user", igsid: "7002002", inbound: true, kind: "comment", comment_id: "17900000009", text: "qiymət?" })).lead;
  assert.equal(w.sales.sendPolicy(cm).mode, "private_reply");
  assert.equal(w.sales.sendPolicy(cm, w.now() + 8 * DAY).ok, false);
  await w.sales.recordOutbound(cm.id, { kind: "dm", text: "x", private_reply: true });
  assert.equal(w.sales.sendPolicy(await w.sales.get(cm.id)).ok, false, "private reply ikinci dəfə olmaz");
});

// ---------- DM qəbulu → təsdiq → göndərmə ----------
test("DM qəbulu: lead yaranır, təsdiq qeydi açılır, Telegram-a düymələrlə bildiriş gedir, Instagram-a HEÇ NƏ göndərilmir", async () => {
  const w = await salesWorld();
  const s = servers();
  const calls = installSocialFetch(s.routes);
  const r = await w.inbox.handleWebhook({ entry: [{ messaging: [{ sender: { id: "5551234" }, message: { mid: "m1", text: "Salam, kafem üçün QR menyu qiyməti nədir?" } }] }] });
  assert.equal(r.dms, 1);
  assert.equal(calls.filter((c) => c.url.includes("/messages")).length, 0, "təsdiqsiz DM göndərilməməlidir");
  const lead = (await w.sales.list())[0];
  assert.equal(lead.username, "aysel_cafe");
  assert.equal(lead.business_type, "kafe");
  assert.ok(lead.asked_price);
  const pend = (await w.approvals.list({ status: "pending", limit: 10 })).filter((a) => a.kind === "instagram.dm.send");
  assert.equal(pend.length, 1);
  assert.match(pend[0].content, /Instagram DM → @aysel_cafe/);
  const note = s.tgMessages[0];
  assert.equal(note.chat_id, "1001");
  assert.match(note.text, /yeni lead/);
  assert.equal(note.reply_markup.inline_keyboard[0][0].callback_data, "ap:" + pend[0].id + ":y");
  assert.equal(note.reply_markup.inline_keyboard[0][1].callback_data, "ap:" + pend[0].id + ":n");
  // eyni webhook təkrar gəlsə (Meta təkrar göndərir) ikinci lead/təsdiq yaranmır
  const again = await w.inbox.handleWebhook({ entry: [{ messaging: [{ sender: { id: "5551234" }, message: { mid: "m1", text: "Salam, kafem üçün QR menyu qiyməti nədir?" } }] }] });
  assert.equal(again.dup, 1);
  assert.equal((await w.approvals.list({ status: "pending", limit: 10 })).filter((a) => a.kind === "instagram.dm.send").length, 1);
});

test("təsdiqdən sonra DM bir dəfə göndərilir; ikinci icra bloklanır; lead CONTACTED olur; audit yazılır", async () => {
  const w = await salesWorld();
  const s = servers();
  const calls = installSocialFetch(s.routes);
  await w.inbox.handleWebhook({ entry: [{ messaging: [{ sender: { id: "5551234" }, message: { mid: "m1", text: "Kafem üçün QR menyu istəyirəm" } }] }] });
  const rec = (await w.approvals.list({ status: "pending", limit: 10 })).find((a) => a.kind === "instagram.dm.send");
  const r = await w.runner.approveAndExecute(rec.id, { actor: OWNER });
  assert.equal(r.status, "done");
  assert.equal(r.output.sent, true);
  assert.equal(r.output.message_id, "mid.1");
  const sent = calls.filter((c) => c.url.includes("/178/messages"));
  assert.equal(sent.length, 1);
  assert.deepEqual(bodyJson(sent[0]).recipient, { id: "5551234" });
  assert.equal(sent[0].headers.authorization, "Bearer IGTOK_SECRET");
  assert.equal((await w.sales.get("aysel_cafe")).stage, "CONTACTED");
  const second = await w.runner.execute(rec.id, { actor: OWNER });
  assert.equal(second.ok, false);
  assert.equal(calls.filter((c) => c.url.includes("/178/messages")).length, 1, "ikinci göndərmə olmamalıdır");
  const audit = JSON.stringify(await w.audit.list?.(50) || await w.store.listDocs("audit", 40));
  assert.match(audit, /instagram\.dm\.sent/);
  assert.ok(!audit.includes("IGTOK_SECRET"), "token auditdə olmamalıdır");
});

test("başqa çat təsdiq edə bilməz; rədd edilən DM göndərilmir", async () => {
  const w = await salesWorld();
  const s = servers();
  const calls = installSocialFetch(s.routes);
  await w.inbox.handleWebhook({ entry: [{ messaging: [{ sender: { id: "5551234" }, message: { mid: "m1", text: "salam" } }] }] });
  const rec = (await w.approvals.list({ status: "pending", limit: 10 })).find((a) => a.kind === "instagram.dm.send");
  const r = await w.runner.approveAndExecute(rec.id, { actor: { channel: "telegram", chat_id: "9999", user_id: "9999" } });
  assert.equal(r.ok, false);
  await w.approvals.decide(rec.id, { decision: "reject", actor: OWNER });
  assert.equal((await w.runner.execute(rec.id, { actor: OWNER })).ok, false);
  assert.equal(calls.filter((c) => c.url.includes("/178/messages")).length, 0);
});

test("API uğursuzdursa və ya message_id qaytarmırsa 'göndərildi' DEYİLİR, lead CONTACTED olmur", async () => {
  const w = await salesWorld();
  let mode = "noid";
  const s = servers({ sendMessage: () => (mode === "noid" ? json({}) : json({ error: { code: 10, message: "no permission" } }, 400)) });
  installSocialFetch(s.routes);
  await w.inbox.handleWebhook({ entry: [{ messaging: [{ sender: { id: "5551234" }, message: { mid: "m1", text: "salam" } }] }] });
  const rec = (await w.approvals.list({ status: "pending", limit: 10 })).find((a) => a.kind === "instagram.dm.send");
  const r = await w.runner.approveAndExecute(rec.id, { actor: OWNER });
  assert.notEqual(r.status, "done");
  assert.ok(!r.output);
  const lead = await w.sales.get("aysel_cafe");
  assert.notEqual(lead.stage, "CONTACTED");
  assert.equal(lead.outbound_count, 0);
  assert.equal((await w.sales.summary()).dm_sent_today, 0, "uğursuz göndərmə gündəlik limiti yemir");
});

test("pəncərə bağlanıbsa təsdiqlənmiş DM də göndərilmir (manual_action_required)", async () => {
  const w = await salesWorld();
  const s = servers();
  const calls = installSocialFetch(s.routes);
  await w.inbox.handleWebhook({ entry: [{ messaging: [{ sender: { id: "5551234" }, message: { mid: "m1", text: "salam" } }] }] });
  const rec = (await w.approvals.list({ status: "pending", limit: 10 })).find((a) => a.kind === "instagram.dm.send");
  w.advanceTime(26 * HOUR);
  const r = await w.runner.approveAndExecute(rec.id, { actor: OWNER });
  assert.notEqual(r.status, "done");
  assert.match(JSON.stringify(r.error), /manual_action_required/);
  assert.equal(calls.filter((c) => c.url.includes("/178/messages")).length, 0);
});

test("soyuq lead üçün DM qaralaması yaranmır: manual_action_required (bypass yoxdur)", async () => {
  const w = await salesWorld();
  const s = servers();
  const calls = installSocialFetch(s.routes);
  const { lead } = await w.sales.upsert({ username: "yeni_restoran", source: "manual", reason: "yeni açılıb" });
  const r = await w.inbox.draftFirstContact(lead.id);
  assert.equal(r.ok, false);
  assert.equal(r.manual, true);
  assert.match(r.text, /manual action required/);
  assert.equal((await w.approvals.list({ status: "pending", limit: 10 })).filter((a) => a.kind === "instagram.dm.send").length, 0);
  assert.equal(calls.filter((c) => c.url.includes("/messages")).length, 0);
});

test("spam və təhqir DM-inə cavab hazırlanmır, təsdiq qeydi açılmır", async () => {
  const w = await salesWorld();
  const s = servers();
  installSocialFetch(s.routes);
  await w.inbox.handleWebhook({ entry: [{ messaging: [{ sender: { id: "5551234" }, message: { mid: "m1", text: "free casino bonus https://x.example" } }, { sender: { id: "5551235" }, message: { mid: "m2", text: "sən axmaqsan" } }] }] });
  assert.equal((await w.approvals.list({ status: "pending", limit: 10 })).length, 0);
  assert.equal(s.tgMessages.length, 2);
});

// ---------- şərhlər ----------
test("şərh qəbulu: alış niyyəti → lead + təsdiq; spam səssiz; təhqir cavabsız; öz şərhimiz və cavablar atılır", async () => {
  const w = await salesWorld();
  const s = servers();
  const calls = installSocialFetch(s.routes);
  const c = (id, text, username, extra = {}) => ({ field: "comments", value: { id, text, from: { id: "9" + id.slice(-5), username }, media: { id: "18000000001" }, ...extra } });
  const r = await w.inbox.handleWebhook({ entry: [{ changes: [
    c("17900000001", "Necə sifariş edim? almaq istəyirəm", "kafe_baki"),
    c("17900000002", "follow me crypto giveaway", "spamer"),
    c("17900000003", "idiot", "troll"),
    c("17900000004", "təşəkkürlər", "qrmenu_az"),
    c("17900000005", "salam sual var?", "someone", { parent_id: "17900000001" }),
  ] }] });
  assert.equal(r.errors, 0);
  const pend = (await w.approvals.list({ status: "pending", limit: 10 })).filter((a) => a.kind === "instagram.comment.reply");
  assert.equal(pend.length, 1);
  assert.match(pend[0].content, /İCTİMAİ/);
  const lead = await w.sales.get("kafe_baki");
  assert.equal(lead.interest, "hot");
  assert.equal(await w.sales.get("spamer"), null, "spam lead olmur");
  assert.equal(await w.sales.get("troll"), null);
  assert.equal(calls.filter((x) => x.url.includes("/replies")).length, 0, "təsdiqsiz cavab yoxdur");
  // təsdiqlə cavab
  const run = await w.runner.approveAndExecute(pend[0].id, { actor: OWNER });
  assert.equal(run.status, "done");
  assert.equal(calls.filter((x) => x.url.includes("/17900000001/replies")).length, 1);
});

test("şərh cavabı API-də id qaytarmasa uğur sayılmır", async () => {
  const w = await salesWorld();
  const calls = installSocialFetch([[/api\.telegram\.org/, () => json({ ok: true, result: {} })], [/\/replies/, () => json({})]]);
  const { approval_id } = await w.runner.propose("instagram.comment.reply", { comment_id: "17900000001", text: "Salam! DM yazın." }, { origin: OWNER });
  const r = await w.runner.approveAndExecute(approval_id, { actor: OWNER });
  assert.notEqual(r.status, "done");
  assert.equal(calls.filter((c) => c.url.includes("/replies")).length, 1);
});

// ---------- polling ----------
test("DM polling: köhnə və öz mesajlarımız atılır, yeni mesaj eyni ingest yolundan keçir, təkrar yoxlamada dublikat yoxdur", async () => {
  const w = await salesWorld();
  const created = new Date(w.now() - HOUR).toISOString();
  const old = new Date(w.now() - 30 * HOUR).toISOString();
  const conv = { data: [{ id: "c1", messages: { data: [
    { id: "pm1", message: "Salam, demo göstərin", from: { id: "5551234", username: "aysel_cafe" }, created_time: created },
    { id: "pm2", message: "bizim cavab", from: { id: "178", username: "qrmenu_az" }, created_time: created },
    { id: "pm3", message: "çox köhnə", from: { id: "5559999", username: "old" }, created_time: old },
  ] } }] };
  const s = servers({ conv });
  installSocialFetch(s.routes);
  const r1 = await w.inbox.pollDms();
  assert.equal(r1.dms, 1);
  const r2 = await w.inbox.pollDms();
  assert.equal(r2.dms, 0);
  assert.equal(r2.dup, 1);
  assert.equal((await w.sales.summary()).total, 1);
});

// ---------- Telegram əmrləri ----------
test("Telegram əmr niyyətləri: 9 əmr tanınır, adi paylaşım/reklam əmri tutulmur", () => {
  const m = (t) => (igIntent(t) || {}).cmd;
  assert.equal(m("Instagram status"), "status");
  assert.equal(m("DM-ləri yoxla"), "dms");
  assert.equal(m("Şərhləri yoxla"), "comments");
  assert.equal(m("Müştəri tap"), "find");
  assert.equal(m("Lead-ləri göstər"), "leads");
  assert.equal(m("Satışları göstər"), "sales");
  assert.equal(m("Bugünkü Instagram hesabatını ver"), "report");
  assert.deepEqual(igIntent("lead L0001 qualified"), { cmd: "stage", ref: "l0001", stage: "QUALIFIED" });
  assert.equal(m("dm hazırla L0002"), "draftdm");
  assert.equal(igIntent("Instagram-da paylaş"), null);
  assert.equal(igIntent("QR Menu reklam hazırla"), null);
  assert.equal(igIntent("salam necəsən"), null);
});

test("Telegram əmrləri: status (icazə/token), lead siyahısı, mərhələ dəyişmə, hesabat, əl ilə lead təkrar yaratmır", async () => {
  const w = await salesWorld({ KIMI_API_KEY: "" });
  const s = servers();
  installSocialFetch([...s.routes, [/\/me\?/, () => json({ user_id: "178", username: "qrmenu_az", account_type: "BUSINESS" })]]);
  const cmds = createIgCommands({ env: w.env, hub: w.hub, sales: w.sales, inbox: w.inbox, flow: w.flow, approvals: w.approvals, now: w.now });
  const st = await cmds.run({ cmd: "status" });
  assert.match(st, /@qrmenu_az/);
  assert.match(st, /DM ✅/);
  assert.match(st, /30 gün/);
  assert.match(st, /INSTAGRAM_WEBHOOK_VERIFY_TOKEN/);
  assert.match(await cmds.run({ cmd: "leads" }), /Hələ lead yoxdur/);
  const add = await cmds.run({ cmd: "addlead", ref: "yeni_cay", note: "Bakı çayxana" });
  assert.match(add, /Əlavə olundu/);
  assert.match(await cmds.run({ cmd: "addlead", ref: "yeni_cay", note: "" }), /təkrar yaradılmadı/);
  assert.match(await cmds.run({ cmd: "stage", ref: "l0001", stage: "CONTACTED" }), /CONTACTED/);
  assert.match(await cmds.run({ cmd: "stage", ref: "l0001", stage: "WON" }), /keçidi mümkün deyil/);
  assert.match(await cmds.run({ cmd: "sales" }), /CONTACTED: 1/);
  const rep = await cmds.run({ cmd: "report" });
  assert.match(rep, /Bugünkü Instagram hesabatı/);
  const find = await cmds.run({ cmd: "find", arg: "" });
  assert.match(find, /uydurma lead yaradılmır/);
});

test("Telegram status: token bitibsə / icazə yoxdursa aydın xəbərdarlıq; API xətası gizlədilmir", async () => {
  const w = await salesWorld();
  await seedToken(w, "instagram", { access_token: "T", user_id: "178", scope: "instagram_business_basic", account: { username: "qrmenu_az" }, obtained_at: w.now(), expires_at: w.now() + 3 * DAY });
  installSocialFetch([[/\/me\?/, () => json({ user_id: "178", username: "qrmenu_az", account_type: "BUSINESS" })]]);
  const cmds = createIgCommands({ env: w.env, hub: w.hub, sales: w.sales, inbox: w.inbox, flow: w.flow, approvals: w.approvals, now: w.now });
  const st = await cmds.run({ cmd: "status" });
  assert.match(st, /yaxında bitir/);
  assert.match(st, /yenidən qoş: \/connect instagram/);
  installSocialFetch([[/\/me\?/, () => json({ error: { code: 190, message: "expired" } }, 400)]]);
  assert.match(await cmds.run({ cmd: "status" }), /Canlı yoxlama alınmadı/);
});

// ---------- paylaşım: təkrar qorunması ----------
test("eyni kontentin ikinci Instagram paylaşımı bloklanır (paylaşıldıqdan və nəticə bilinmədikdən sonra); fərqli mətn icazəlidir", async () => {
  const w = world();
  await seedToken(w, "instagram", { access_token: "T", user_id: "178", scope: SCOPE, obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  const calls = installSocialFetch([
    [/\/178\/media_publish/, () => json({ id: "POST_1" })],
    [/\/178\/media$/, () => json({ id: "CONT_1" })],
    [/\/CONT_1\?/, () => json({ status_code: "FINISHED" })],
    [/\/POST_1\?/, () => json({ permalink: "https://www.instagram.com/p/XYZ/" })],
  ]);
  const input = { platform: "instagram", caption: "QR Menu reklamı", media_url: "https://cdn.example.com/reel.mp4", media_type: "video" };
  const rec = await w.flow.createDraft(input, { source: "test" });
  await w.flow.approveAndStart(rec.id);
  const job = await w.flow.advance(rec.id);
  assert.equal(job.status, "done");
  assert.equal(job.targets.instagram.post_id, "POST_1");
  await assert.rejects(() => w.flow.createDraft(input, { source: "test" }), /artıq Instagram-da paylaşılıb \(id: POST_1\)/);
  const other = await w.flow.createDraft({ ...input, caption: "Başqa mətn" }, { source: "test" });
  assert.equal(other.status, "pending");
  assert.equal(calls.filter((c) => c.url.includes("media_publish")).length, 1);
});

test("təsdiq qeydi yaradılandan sonra eyni kontent paylaşılıbsa, ikinci qeydin işi icradan əvvəl bloklanır", async () => {
  const w = world();
  await seedToken(w, "instagram", { access_token: "T", user_id: "178", scope: SCOPE, obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  const calls = installSocialFetch([
    [/\/178\/media_publish/, () => json({ id: "POST_1" })],
    [/\/178\/media$/, () => json({ id: "CONT_1" })],
    [/\/CONT_1\?/, () => json({ status_code: "FINISHED" })],
    [/\/POST_1\?/, () => json({ permalink: "https://www.instagram.com/p/XYZ/" })],
  ]);
  const input = { platform: "instagram", caption: "Eyni mətn", media_url: "https://cdn.example.com/a.jpg", media_type: "image" };
  const r1 = await w.flow.createDraft(input, { source: "test" });
  const r2 = await w.flow.createDraft(input, { source: "test" }); // hələ heç biri paylaşılmayıb: ikisi də qaralamadır
  await w.flow.approveAndStart(r1.id);
  await w.flow.advance(r1.id);
  await w.flow.approveAndStart(r2.id);
  const j2 = await w.flow.advance(r2.id);
  assert.equal(j2.status, "failed");
  assert.match(j2.targets.instagram.error.message, /artıq Instagram-da paylaşılıb/);
  assert.equal(calls.filter((c) => c.url.includes("media_publish")).length, 1);
});

// ---------- worker marşrutları ----------
import worker from "../worker.js";

const hmac = async (secret, body) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
};

test("/instagram/webhook: GET doğrulama, imzasız/səhv imzalı POST 403 (heç nə işlənmir), düzgün imzalı DM işlənir və Telegram-a düşür", async () => {
  const w = await salesWorld({ INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "vt-xyz" });
  const s = servers();
  const calls = installSocialFetch(s.routes);
  const get = (q) => worker.fetch(new Request("https://jarvis.example.dev/instagram/webhook?" + q), w.env);
  const ok = await get("hub.mode=subscribe&hub.verify_token=vt-xyz&hub.challenge=777");
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "777");
  assert.equal((await get("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=777")).status, 403);

  const body = JSON.stringify({ entry: [{ messaging: [{ sender: { id: "5551234" }, message: { mid: "w1", text: "Salam, kafem üçün QR menyu istəyirəm" } }] }] });
  const post = (sig) => worker.fetch(new Request("https://jarvis.example.dev/instagram/webhook", { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-hub-signature-256": sig } : {}) }, body }), w.env);
  assert.equal((await post(null)).status, 403);
  assert.equal((await post("sha256=" + "a".repeat(64))).status, 403);
  assert.equal((await w.sales.summary()).total, 0, "imzasız hadisə lead yaratmamalıdır");
  assert.equal(calls.length, 0);
  assert.equal((await post(await hmac("ig-secret", body))).status, 200);
  assert.equal((await w.sales.summary()).total, 1);
  assert.ok(s.tgMessages.some((m) => /Instagram DM/.test(m.text)));
  assert.equal(calls.filter((c) => c.url.includes("/178/messages")).length, 0, "webhook özü heç vaxt DM göndərmir");
});

test("Telegram: «Instagram status» və «Lead-ləri göstər» Claude/OpenAI çağırmadan cavablanır; icazəsiz göndərənə cavab yoxdur", async () => {
  const w = await salesWorld();
  const s = servers();
  const calls = installSocialFetch([...s.routes, [/\/me\?/, () => json({ user_id: "178", username: "qrmenu_az", account_type: "BUSINESS" })], [/api\.(anthropic|openai)\.com/, () => { throw new Error("AI çağırılmamalıdır"); }]]);
  let uid = 9100;
  const say = (text, from = 1001) => worker.fetch(new Request("https://jarvis.example.dev/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "whsec_test-1" }, body: JSON.stringify({ update_id: ++uid, message: { message_id: 1, from: { id: from }, chat: { id: from, type: "private" }, text } }) }), w.env);
  assert.equal((await say("Instagram status")).status, 200);
  assert.ok(s.tgMessages.some((m) => /Instagram: CONNECTED/.test(m.text) && /@qrmenu_az/.test(m.text)));
  await say("Lead-ləri göstər");
  assert.ok(s.tgMessages.some((m) => /Hələ lead yoxdur/.test(m.text)));
  const before = s.tgMessages.length;
  await say("Instagram status", 4242);
  assert.equal(s.tgMessages.length, before, "icazəsiz göndərənə cavab verilmir");
  assert.equal(calls.filter((c) => /anthropic|openai/.test(c.url)).length, 0);
});
