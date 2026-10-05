// Alət reyestri: Instagram, TikTok, YouTube, Telegram, Shopify, Storage, LearningAgent, SalesAgent çağırıla bilir.
// Giriş/çıxış schema yoxlaması, storage məhdudiyyətləri, bilik bazası icazələri. Real API çağırılmır.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetAll, runtime, fakeRequest, FULL_ENV, TOK, CHAT } from "./wiring-helpers.mjs";
import { APPROVAL_ONLY_PERMISSIONS } from "../src/policy.js";

beforeEach(() => resetAll());

const names = (h) => h.rt.tools.list().map((t) => t.name);

test("reyestrdə bütün platforma, storage, öyrənmə, satış və bilik alətləri var", () => {
  const h = runtime();
  const have = new Set(names(h));
  const need = [
    "instagram.account.get", "instagram.media.list", "instagram.insights.get",
    "tiktok.account.get", "tiktok.videos.list", "tiktok.videos.get",
    "youtube.channel.get", "youtube.videos.list", "youtube.video.get",
    "telegram.bot.get", "telegram.updates.receive", "telegram.voice.get", "telegram.message.send",
    "shopify.shop.get", "shopify.products.list", "shopify.orders.list", "shopify.customers.list",
    "storage.note.put", "storage.note.get", "storage.note.list",
    "learning.record", "learning.analyze", "learning.propose", "learning.list", "learning.apply_rule",
    "lead.create", "lead.get", "lead.list", "sales.pipeline", "sales.message.send",
    "knowledge.search", "knowledge.add",
  ];
  for (const n of need) assert.ok(have.has(n), "alət yoxdur: " + n);
});

test("yazma alətləri yalnız sənədlə yoxlanmış endpoint-lər üçündür və hamısı təsdiq tələb edir; yoxlanmamışlar (upload, delete, qiymət, stok, voice.send) alət deyil", () => {
  const h = runtime();
  const WRITE = ["instagram.media.publish", "instagram.container.publish", "instagram.comments.reply", "instagram.messages.send", "tiktok.video.publish", "youtube.video.update", "shopify.product.update", "telegram.message.send"];
  for (const n of WRITE) {
    const t = h.rt.tools.list().find((x) => x.name === n);
    assert.ok(t, "alət yoxdur: " + n);
    assert.equal(t.requiresApproval, true, n);
    assert.equal(t.risk, "high", n);
  }
  for (const n of ["youtube.video.upload", "youtube.video.delete", "shopify.price.change", "shopify.inventory.set", "telegram.voice.send", "tiktok.video.upload"]) assert.ok(!names(h).includes(n), "yoxlanmamış əməliyyat alət kimi açılıb: " + n);
  // Platforma adlı alətlərdən yalnız bunlar yazma xarakterlidir
  const writeLike = names(h).filter((n) => /^(instagram|tiktok|youtube|shopify|telegram)\..*(publish|send|reply|upload|\.update|delete)/.test(n)).sort();
  assert.deepEqual(writeLike, [...WRITE].sort());
});

test("hər alətin giriş və çıxış schema-sı var, açıq obyekt (additionalProperties) məhdudlaşdırılıb", () => {
  const h = runtime();
  for (const t of h.rt.tools.list()) {
    const d = h.rt.tools.describe(t.name);
    assert.equal(d.inputSchema.type, "object", t.name);
    if (d.inputSchema.properties && Object.keys(d.inputSchema.properties).length && t.name !== "sales.pipeline") assert.equal(d.inputSchema.additionalProperties, false, t.name + " girişi sərbəstdir");
  }
});

test("APPROVAL_ONLY icazəsi olan hər alət təsdiq tələb edir və riski 'low' deyil; təsdiq tələb edən alətdə 'low' risk yoxdur", () => {
  const h = runtime();
  for (const t of h.rt.tools.list()) {
    if (t.permissions.some((p) => APPROVAL_ONLY_PERMISSIONS.includes(p))) {
      assert.equal(t.requiresApproval, true, t.name);
      assert.notEqual(t.risk, "low", t.name);
    }
    if (t.requiresApproval) assert.notEqual(t.risk, "low", t.name);
  }
});

test("alət girişi schema ilə yoxlanır: artıq sahə, yanlış tip, çatışmayan məcburi sahə -> invalid_input, şəbəkə yoxdur", async () => {
  const h = runtime({}, fakeRequest());
  const cases = [
    ["instagram.account.get", { extra: 1 }],
    ["instagram.media.list", { limit: 1000 }],
    ["instagram.insights.get", {}],
    ["tiktok.videos.list", { limit: "20" }],
    ["tiktok.videos.get", { video_ids: [] }],
    ["youtube.video.get", { video_id: "x" }],
    ["shopify.products.list", { first: 9999 }],
    ["storage.note.put", { key: "a" }],
    ["lead.get", {}],
  ];
  for (const [name, input] of cases) {
    const r = await h.rt.tools.run(name, input, h.rt.toolCtx());
    // Ya reyestr schema-sı, ya da adapterin öz yoxlaması rədd edir; hər halda icra uğurlu deyil və şəbəkəyə çıxış yoxdur
    assert.equal(r.ok, false, name);
    assert.ok(r.status === "invalid_input" || r.code === "invalid_input", name + ": " + JSON.stringify(r));
  }
  assert.equal(h.request.calls.length, 0);
});

test("çıxış schema yoxlanır: cavab formasını pozan handler 'invalid_output' verir, saxta uğur yoxdur", async () => {
  const h = runtime();
  h.rt.tools.register({ name: "test.bad", description: "d", inputSchema: { type: "object", properties: {}, additionalProperties: false }, outputSchema: { type: "object", required: ["a"], properties: { a: { type: "string" } } }, permissions: ["read.knowledge"], risk: "low", async handler() { return { a: 5 }; } });
  const r = await h.rt.tools.run("test.bad", {}, h.rt.toolCtx());
  assert.equal(r.status, "invalid_output");
  assert.equal(r.ok, false);
});

test("oxuma alətləri adapter vasitəsilə işləyir (saxta platforma cavabı), nəticə {mock:false, integration, op, data} formasındadır", async () => {
  const request = fakeRequest((url) => (url.includes("/me?") ? { ok: true, status: 200, data: { user_id: "1784", username: "fn_demo" } } : undefined));
  const h = runtime({}, request);
  const r = await h.rt.tools.run("instagram.account.get", {}, h.rt.toolCtx());
  assert.equal(r.ok, true);
  assert.deepEqual({ mock: r.output.mock, integration: r.output.integration, op: r.output.op }, { mock: false, integration: "instagram", op: "account.get" });
  assert.equal(r.output.data.username, "fn_demo");
});

test("credential yoxdursa platforma aləti not_configured xətası verir və şəbəkəyə çıxmır", async () => {
  const request = fakeRequest();
  const h = runtime({ IG_FNPARFUM_TOKEN: "", TIKTOK_ACCESS_TOKEN: "" }, request);
  for (const n of ["instagram.account.get", "tiktok.account.get"]) {
    const r = await h.rt.tools.run(n, {}, h.rt.toolCtx());
    assert.equal(r.ok, false, n);
    assert.equal(r.code, "not_configured", n);
  }
  assert.equal(request.calls.length, 0);
});

test("icazəsi geri götürülmüş (REVOKED_PERMISSIONS) alət işləmir: read.instagram söndürülüb", async () => {
  const request = fakeRequest();
  const h = runtime({ REVOKED_PERMISSIONS: "read.instagram" }, request);
  const r = await h.rt.tools.run("instagram.account.get", {}, h.rt.toolCtx());
  assert.equal(r.status, "denied");
  assert.equal(request.calls.length, 0);
});

test("Storage: qeyd yazılır/oxunur/siyahılanır; açar yalnız kiçik hərf/rəqəm/_-, başqa bölmələrə (approvals, audit, leads) çatmaq mümkün deyil", async () => {
  const h = runtime();
  const ctx = h.rt.toolCtx();
  assert.equal((await h.rt.tools.run("storage.note.put", { key: "ideya-1", text: "yeni ətir ideyası" }, ctx)).status, "done");
  const g = await h.rt.tools.run("storage.note.get", { key: "ideya-1" }, ctx);
  assert.equal(g.output.found, true);
  assert.equal(g.output.text, "yeni ətir ideyası");
  assert.deepEqual((await h.rt.tools.run("storage.note.list", {}, ctx)).output.keys, ["ideya-1"]);
  const before = new Set((await h.env.JARVIS_KV.list({ prefix: "" })).keys.map((k) => k.name));
  for (const key of ["../approvals", "a/b", "A", "x y", "a:b", "-x", "ü"]) {
    const r = await h.rt.tools.run("storage.note.put", { key, text: "x" }, ctx);
    assert.equal(r.status, "error", key);
  }
  // Düzgün formada olan (məsələn "approval-1") açar da yalnız memory bölməsinin 'note-' önəki ilə yazılır
  assert.equal((await h.rt.tools.run("storage.note.put", { key: "approval-1", text: "x" }, ctx)).status, "done");
  const added = (await h.env.JARVIS_KV.list({ prefix: "" })).keys.map((k) => k.name).filter((k) => !before.has(k) && k.startsWith("fx/"));
  assert.deepEqual(added, ["fx/memory/note-approval-1"]);
});

test("Storage: not mətnində açar/token görünüşlü dəyər saxlanmır (scrub)", async () => {
  const h = runtime();
  const ctx = h.rt.toolCtx();
  const secretLike = "sk-" + "A1b2C3d4E5f6G7h8I9j0K1l2";
  await h.rt.tools.run("storage.note.put", { key: "gizli", text: "token budur " + secretLike }, ctx);
  const g = await h.rt.tools.run("storage.note.get", { key: "gizli" }, ctx);
  assert.ok(!g.output.text.includes(secretLike));
});

test("Storage: write.storage icazəsi söndürülübsə yazılmır, oxuma isə işləyir", async () => {
  const h = runtime({ REVOKED_PERMISSIONS: "write.storage" });
  const ctx = h.rt.toolCtx();
  assert.equal((await h.rt.tools.run("storage.note.put", { key: "a1", text: "x" }, ctx)).status, "denied");
  assert.equal((await h.rt.tools.run("storage.note.list", {}, ctx)).status, "done");
});

test("Bilik bazası icazələri qorunur: read.knowledge/write.knowledge geri götürüləndə search/add işləmir", async () => {
  const h = runtime({ REVOKED_PERMISSIONS: "read.knowledge,write.knowledge" });
  const ctx = h.rt.toolCtx();
  assert.equal((await h.rt.tools.run("knowledge.search", { query: "ətir" }, ctx)).status, "denied");
  assert.equal((await h.rt.tools.run("knowledge.add", { type: "fact", title: "t", text: "mətn" }, ctx)).status, "denied");
  // ctx-də icazə siyahısı verilməyəndə də yalnız DEFAULT_PERMISSIONS (bilik) sayılır, platforma oxuması yox
  const r = await h.rt.tools.run("instagram.account.get", {}, { integrations: h.rt.integrations });
  assert.equal(r.status, "denied");
});

test("Bilik bazası: add -> search işləyir, planlayıcı mənbəli qeyd 'external' trust ilə qalır", async () => {
  const h = runtime();
  const ctx = h.rt.toolCtx();
  const a = await h.rt.tools.run("knowledge.add", { type: "fact", title: "Oud haqqında", text: "Oud ağacından hazırlanan ətir", trust: "external" }, ctx);
  assert.equal(a.status, "done", JSON.stringify(a));
  const s = await h.rt.tools.run("knowledge.search", { query: "oud ətir" }, ctx);
  assert.ok(s.output.items.some((i) => i.title === "Oud haqqında" && i.trust === "external"));
});

test("Lead/Sales: lead yaradılır, pipeline qaralama verir ('draft_only', 'requires_approval'), real göndərmə yoxdur", async () => {
  const request = fakeRequest();
  const h = runtime({}, request);
  const ctx = h.rt.toolCtx();
  const c = await h.rt.tools.run("lead.create", { name: "Test Müştəri", channel: "other", interests: ["oud"], budget_azn: 300 }, ctx);
  assert.equal(c.status, "done", JSON.stringify(c));
  const p = await h.rt.tools.run("sales.pipeline", { lead_id: c.output.id }, ctx);
  assert.equal(p.status, "done", JSON.stringify(p));
  assert.equal(p.output.draft_only, true);
  assert.equal(p.output.requires_approval, true);
  assert.ok(p.output.qualification && p.output.conversation_plan && p.output.offer);
  assert.equal(request.calls.length, 0);
});

test("Learning: record və propose işləyir; target 'system_prompt' / 'permissions' / 'secret' təklifi rədd olunur; qayda yalnız təsdiqlə", async () => {
  const h = runtime();
  const ctx = h.rt.toolCtx();
  assert.equal((await h.rt.tools.run("learning.record", { task: "t", status: "achieved" }, ctx)).status, "done");
  assert.equal((await h.rt.tools.run("learning.propose", { title: "Qayda", target: "workflow_note", text: "Cavab qısa olsun" }, ctx)).status, "done");
  for (const target of ["system_prompt", "permissions", "secret", "security_rules", "approval"]) {
    const r = await h.rt.tools.run("learning.propose", { title: "Pis qayda", target, text: "dəyiş" }, ctx);
    assert.notEqual(r.status, "done", target);
  }
  const rules = await h.rt.tools.run("learning.list", { what: "rules" }, ctx);
  assert.deepEqual(rules.output.items, []);
  const prop = (await h.rt.tools.run("learning.list", { what: "proposals" }, ctx)).output.items;
  assert.equal(prop.length, 1);
  assert.equal(prop[0].status, "proposed");
});

test("tokenlər alət nəticələrində və audit yazılarında yoxdur", async () => {
  const request = fakeRequest(() => ({ ok: true, status: 200, data: { user_id: "1784", username: "fn_demo" } }));
  const h = runtime({}, request);
  const ctx = h.rt.toolCtx();
  const r = await h.rt.tools.run("instagram.account.get", {}, ctx);
  assert.ok(!JSON.stringify(r).includes(TOK));
  assert.ok(!JSON.stringify(await h.rt.audit.list(100)).includes(TOK));
  void CHAT; void FULL_ENV;
});

test("validate: minItems dəstəklənir (boş video siyahısı şəbəkəyə çıxmadan rədd olunur)", async () => {
  const { validate } = await import("../src/validate.js");
  const sch = { type: "object", properties: { a: { type: "array", minItems: 1, items: { type: "string" } } }, required: ["a"] };
  assert.equal(validate(sch, { a: [] }).ok, false);
  assert.equal(validate(sch, { a: ["x"] }).ok, true);
});
