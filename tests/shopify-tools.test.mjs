// Shopify alətləri: oxuma, prepare, hər yazma aləti (ToolRegistry + ApprovalCenter + ActionRunner), token sızması.
// HEÇ BİR real şəbəkə çağırışı yoxdur (saxta Shopify).
import test from "node:test";
import assert from "node:assert/strict";
import { ALL_DOCS } from "../src/shopify/gql.js";
import { SHOPIFY_READ_TOOLS, SHOPIFY_WRITE_TOOLS, proposeCreateFromIdea, proposeInventorySet, proposePriceUpdate, proposeProductUpdate, proposePublish, proposeArchive } from "../src/shopify/tools.js";
import { prepareProduct, sanitizeHtml, slugify, parseMoney } from "../src/shopify/prepare.js";
import { FAKE_TOKEN, SHOP, UI, createFakeShopify, leaks, propose, proposeAndApprove, shopifyWorld, allAuditText } from "./shopify-helpers.mjs";

const LOC = "gid://shopify/Location/1";

async function seeded(opts = {}) {
  const w = await shopifyWorld(opts);
  const p = w.fake.addProduct({ title: "Ətir Alfa", handle: "etir-alfa", status: "DRAFT", descriptionHtml: "<p>Köhnə</p>", vendor: "FN", productType: "Parfum", tags: ["a", "b"], variants: [{ title: "Default Title", price: "20.00", sku: "ALFA-1", inventory: 7 }] });
  return { w, p, v: p.variants[0] };
}

const run = (w, name, input) => w.registry.run(name, input, { approvals: w.approvals });
const created = (w) => w.fake.ops().filter((o) => o === "CreateProduct").length;
const writeOps = (w) => w.fake.ops().filter((o) => !/^(ShopInfo|AppScopes|SearchProducts|GetProduct|ListOrders|GetOrder|ProductInventory|InventoryLevelAt|ListLocations|ListCollections|ProductCollections|ListWebhooks)$/.test(o));

// ---------------------------------------------------------------------------------------------------
test("qeydiyyat: oxuma alətləri low/təsdiqsiz, yazma alətləri high/təsdiqli, silmə aləti YOXDUR", async () => {
  const w = await shopifyWorld();
  const list = w.registry.list().filter((t) => t.name.startsWith("shopify."));
  assert.deepEqual(list.map((t) => t.name).sort(), [...SHOPIFY_READ_TOOLS, ...SHOPIFY_WRITE_TOOLS].sort());
  for (const t of list) {
    assert.ok(!/delete|remove|destroy|erase/i.test(t.name), "silmə aləti ola bilməz: " + t.name);
    if (SHOPIFY_WRITE_TOOLS.includes(t.name)) {
      assert.equal(t.risk, "high", t.name);
      assert.equal(t.requiresApproval, true, t.name);
      assert.equal(t.executable, true, t.name);
    } else {
      assert.equal(t.risk, "low", t.name);
      assert.equal(t.requiresApproval, false, t.name);
    }
  }
  assert.ok(list.find((t) => t.name === "shopify.price.update").permissions.includes("change.price"));
  assert.ok(list.find((t) => t.name === "shopify.inventory.set").permissions.includes("change.stock"));
  assert.ok(w.registry.has("shopify.product.archive"));
  // GraphQL sənədlərində silmə mutasiyası yoxdur
  for (const [k, doc] of Object.entries(ALL_DOCS)) assert.ok(!/delete/i.test(doc), "sənəddə delete var: " + k);
});

// ---------------------------------------------------------------------------------------------------
test("oxuma alətləri: shop.info, products.search, product.get, collections.list, webhooks.list", async () => {
  const { w, p } = await seeded();
  let r = await run(w, "shopify.shop.info", {});
  assert.equal(r.ok, true);
  assert.equal(r.output.shop.currency, "AZN");
  assert.equal(r.output.connection.connected, true);
  assert.ok(r.output.connection.scopes.includes("write_products"));
  assert.equal(leaks(r), false);

  r = await run(w, "shopify.products.search", { query: "ətir", limit: 5 });
  assert.equal(r.output.products.length, 1);
  assert.equal(r.output.products[0].variants[0].price, "20.00");
  assert.equal((await run(w, "shopify.products.search", { limit: 21 })).status, "invalid_input");
  // sorğu mətni dəyişən kimi gedir, GraphQL sənədinə qarışmır
  const inj = 'x") { shop { name } } #';
  await run(w, "shopify.products.search", { query: inj });
  const last = w.fake.st.calls.filter((c) => c.op === "SearchProducts").pop();
  assert.equal(last.gql.variables.query, inj);
  assert.ok(!last.gql.query.includes("shop { name }"));

  r = await run(w, "shopify.product.get", { id: p.id });
  assert.equal(r.output.product.title, "Ətir Alfa");
  assert.equal(r.output.product.variants[0].price, "20.00");
  r = await run(w, "shopify.product.get", { id: p.id.split("/").pop() }); // rəqəmli id də olar
  assert.equal(r.ok, true);
  r = await run(w, "shopify.product.get", { id: "gid://shopify/Product/999999" });
  assert.equal(r.ok, false);
  assert.equal(r.error_code, "NOT_FOUND");
  r = await run(w, "shopify.product.get", { id: "gid://shopify/Order/1" });
  assert.equal(r.error_code, "VALIDATION_ERROR");
  r = await run(w, "shopify.product.get", { id: "x; drop" });
  assert.equal(r.error_code, "VALIDATION_ERROR");

  r = await run(w, "shopify.collections.list", {});
  assert.equal(r.output.collections[0].title, "Yeni gələnlər");
  r = await run(w, "shopify.webhooks.list", {});
  assert.deepEqual(r.output.webhooks, []);
  assert.equal(writeOps(w).length, 0, "oxuma alətləri heç bir yazma sorğusu göndərmir");
});

test("oxuma alətləri: sifarişlər minimal (yalnız ad və şəhər), limit ≤ 20", async () => {
  const { w } = await seeded();
  let r = await run(w, "shopify.orders.list", { limit: 5 });
  assert.equal(r.ok, true);
  const o = r.output.orders[0];
  assert.deepEqual(o.ship_to, { first_name: "Aysel", city: "Bakı" });
  assert.equal(o.total.amount, "59.80");
  const text = JSON.stringify(r.output);
  for (const pii of ["Əliyeva", "aysel@example.com", "+994000000000", "Nizami"]) assert.equal(text.includes(pii), false, "PII sızdı: " + pii);
  assert.equal((await run(w, "shopify.orders.list", { limit: 21 })).status, "invalid_input");
  // sorğu sənədi customer sahəsini istəmir
  const gql = w.fake.st.calls.filter((c) => c.op === "ListOrders").pop().gql;
  assert.equal(gql.variables.first, 5);
  assert.ok(!/customer|email|phone|lastName|address1/i.test(gql.query));
  assert.ok(w.fake.st.calls.every((c) => c.gql === undefined || c.gql.variables.first === undefined || c.gql.variables.first <= 20));

  r = await run(w, "shopify.order.get", { id: "gid://shopify/Order/11" });
  assert.equal(r.output.order.line_items[0].title, "Ətir A");
  assert.equal(JSON.stringify(r.output).includes("aysel@example.com"), false);
  assert.equal((await run(w, "shopify.order.get", { id: "gid://shopify/Order/404" })).error_code, "NOT_FOUND");
});

test("oxuma: inventory.get stoku yerlər üzrə göstərir", async () => {
  const { w, p, v } = await seeded();
  const r = await run(w, "shopify.inventory.get", { productId: p.id });
  assert.equal(r.ok, true);
  assert.equal(r.output.variants[0].inventory_item_id, v.inventoryItem.id);
  assert.equal(r.output.variants[0].levels[0].available, 7);
  assert.equal(r.output.variants[0].levels[0].location_name, "Bakı anbar");
  assert.equal((await run(w, "shopify.inventory.get", { productId: "gid://shopify/Product/1" })).error_code, "NOT_FOUND");
});

test("oxuma alətləri müvəqqəti xətada təkrarlanır (retries), qoşulmayanda AUTH_ERROR", async () => {
  const { w } = await seeded();
  w.fake.st.failOp = { op: "ShopInfo", status: 502, times: 1 };
  const r = await run(w, "shopify.shop.info", {});
  assert.equal(r.ok, true);
  const w2 = await shopifyWorld({ connected: false });
  const r2 = await run(w2, "shopify.shop.info", {});
  assert.equal(r2.ok, false);
  assert.equal(r2.error_code, "AUTH_ERROR");
});

// ---------------------------------------------------------------------------------------------------
test("product.prepare: Azərbaycan hərfləri, handle, SEO limitləri", () => {
  assert.equal(slugify("Şirin Əncir & Çiçək Ətri İĞÖÜ ışı"), "sirin-encir-cicek-etri-igou-isi");
  assert.equal(slugify("  Gözəl  Qoxu!!! "), "gozel-qoxu");
  assert.equal(slugify("Парфюм №5"), "parfyum-no5");
  const d = prepareProduct({ name: "Gözəl Ətir", description: "Çox xoş qoxu.\n\nİkinci abzas", price: "29,90 AZN", currency: "azn", tags: "yeni, Yeni, hədiyyə", category: "Parfum" });
  assert.equal(d.title, "Gözəl Ətir");
  assert.equal(d.handle, "gozel-etir");
  assert.equal(d.price, "29.90");
  assert.equal(d.currency, "AZN");
  assert.equal(d.descriptionHtml, "<p>Çox xoş qoxu.</p><p>İkinci abzas</p>");
  assert.deepEqual(d.tags, ["yeni", "hədiyyə"]);
  assert.equal(d.productType, "Parfum");
  assert.equal(d.status, "DRAFT");
  assert.equal(d.ready, true);
  assert.deepEqual(d.missing, ["images"]);
  const long = prepareProduct({ name: "A".repeat(100) + " " + "b".repeat(100), description: "x ".repeat(300), price: 5 });
  assert.ok(long.seo.title.length <= 70);
  assert.ok(long.seo.description.length <= 160);
  assert.ok(long.handle.length <= 100);
  assert.ok(long.issues.some((i) => i.code === "handle_trimmed"));
});

test("product.prepare: XSS təsvirdən təmizlənir", () => {
  const evil = '<p onclick="x()">Salam</p><script>alert(1)</script><img src=x onerror=alert(2)><iframe src="https://e.com"></iframe><a href="javascript:alert(3)">link</a><a href="https://ok.example/x?a=1&b=2" onmouseover=z>ok</a><style>*{}</style><svg onload=alert(4)></svg><b>qalın</b><!-- gizli -->';
  const out = sanitizeHtml(evil);
  assert.ok(!/script|onerror|onclick|onmouseover|onload|iframe|javascript:|<img|<svg|<style|alert/i.test(out), out);
  assert.ok(out.includes("<b>qalın</b>"));
  assert.ok(out.includes('href="https://ok.example/x?a=1&amp;b=2"'));
  assert.ok(out.includes("<p>Salam</p>"));
  const d = prepareProduct({ name: "x", price: "1", description: evil });
  assert.equal(d.ready, true);
  assert.ok(!/<script|onerror|javascript:/i.test(d.descriptionHtml));
  assert.ok(!d.issues.some((i) => i.code === "unsafe_html"));
  // qırıq/gizlədilmiş cəhdlər
  for (const s of ["<scr<script>ipt>alert(1)</scr</script>ipt>", "<<script>alert(1)</script>>", "<SCRIPT\n>alert(1)</SCRIPT>", "<a href=\"&#106;avascript:alert(1)\">x</a>", "<p/onclick=alert(1)>x", "<img/src=x onerror=alert(1)>", "<script>alert(1)"]) {
    const o = sanitizeHtml(s);
    assert.ok(!/<script|onerror|onclick|javascript|<img/i.test(o), s + " => " + o);
  }
  // sadə mətndə < və & escape olunur
  assert.equal(prepareProduct({ name: "x", price: 1, description: "a < b & c" }).descriptionHtml, "<p>a &lt; b &amp; c</p>");
});

test("product.prepare: çatışmayan sahələr bildirilir, uydurulmur", () => {
  const d = prepareProduct({ name: "Yalnız ad" });
  assert.equal(d.price, null);
  assert.equal(d.descriptionHtml, "");
  assert.deepEqual(d.images, []);
  assert.ok(d.missing.includes("price"));
  assert.ok(d.missing.includes("description"));
  assert.ok(d.missing.includes("images"));
  assert.equal(d.ready, false);
  assert.equal(d.seo.description, "", "təsvir yoxdursa SEO təsviri də uydurulmur");
  assert.equal(d.inventory, null);
  assert.equal(d.currency, null);
  assert.equal(d.vendor, "");
  assert.ok(d.issues.some((i) => i.code === "currency_unspecified" && i.severity === "warning"));
  // ad yoxdur
  const e = prepareProduct({ price: 5 });
  assert.ok(e.missing.includes("title"));
  assert.equal(e.ready, false);
  assert.equal(e.handle, "");
  // yanlış tip
  assert.equal(prepareProduct(null).ready, false);
  assert.equal(prepareProduct("salam").ready, false);
});

test("product.prepare: qiymət, stok, variant, şəkil qaydaları", () => {
  for (const [input, want] of [["29.9", "29.90"], ["29,90", "29.90"], [" 1 234,50 AZN ", "1234.50"], ["1,234.50", "1234.50"], [12, "12.00"], ["₼15", "15.00"], ["0012.5", "12.50"]]) {
    assert.equal(parseMoney(input).value, want, String(input));
  }
  for (const bad of ["abc", "-5", "0", 0, "12.345", NaN, Infinity, "1.2.3", "99999999", {}, [], true]) assert.ok(parseMoney(bad).error, "qəbul olunmamalı: " + String(bad));
  assert.equal(prepareProduct({ name: "x", price: "-5" }).ready, false);
  assert.ok(prepareProduct({ name: "x", price: "12.345" }).issues.some((i) => i.code === "bad_price"));

  const v = prepareProduct({ name: "Ətir", price: "10", variants: ["30ml", { title: "50ml", price: "18,5", sku: "E-50" }, { name: "100ml" }] });
  assert.deepEqual(v.variants.map((x) => [x.title, x.price, x.sku]), [["30ml", "10.00", null], ["50ml", "18.50", "E-50"], ["100ml", "10.00", null]]);
  assert.equal(v.ready, true);
  const nov = prepareProduct({ name: "Ətir", variants: ["30ml"] });
  assert.ok(nov.missing.includes("variants[0].price"));
  assert.equal(nov.ready, false);
  assert.equal(prepareProduct({ name: "x", price: 1, variants: ["a", "A"] }).ready, false, "təkrar variant adı");
  assert.equal(prepareProduct({ name: "x", price: 1, variants: [{ title: "a", sku: "bad sku!" }] }).ready, false);

  assert.equal(prepareProduct({ name: "x", price: 1, inventory: "12" }).inventory, 12);
  assert.equal(prepareProduct({ name: "x", price: 1, inventory: -1 }).ready, false);
  assert.equal(prepareProduct({ name: "x", price: 1, inventory: 1.5 }).ready, false);
  assert.equal(prepareProduct({ name: "x", price: 1, variants: ["a", "b"], inventory: 3 }).ready, false, "çox variantda stok dəstəklənmir");

  const im = prepareProduct({ name: "x", price: 1, images: ["https://cdn.example.com/a.jpg", "http://cdn.example.com/b.jpg", "https://localhost/c.jpg", "https://127.0.0.1/d.jpg", "javascript:alert(1)", "https://cdn.example.com/a.jpg", "https://user:pw@cdn.example.com/e.jpg"] });
  assert.deepEqual(im.images, ["https://cdn.example.com/a.jpg"]);
  assert.equal(im.issues.filter((i) => i.code === "bad_image_url").length, 5);
});

test("product.prepare: nəticə idempotentdir və alət kimi yan təsirsizdir", async () => {
  const idea = { name: "Şirin Ətir", description: "Xoş qoxu <b>güclü</b>", price: "15,5", tags: ["a", "b"], images: ["https://cdn.example.com/a.jpg"], inventory: 4, variants: [{ title: "30ml", price: 10 }, { title: "50ml" }].slice(0, 1) };
  const d1 = prepareProduct(idea);
  const strip = ({ issues, ...rest }) => rest;
  const d2 = prepareProduct({ ...d1 });
  assert.deepEqual(strip(d2), strip(d1));
  const w = await shopifyWorld();
  const r = await run(w, "shopify.product.prepare", idea);
  assert.equal(r.ok, true);
  assert.equal(r.output.handle, "sirin-etir");
  assert.equal(w.fake.st.calls.length, 0, "prepare şəbəkəyə çıxmır");
  assert.equal((await w.approvals.list()).length, 0, "prepare təsdiq qeydi açmır");
  assert.deepEqual(w.fake.ops(), []);
});

// ---------------------------------------------------------------------------------------------------
test("product.create: təsdiqdən əvvəl İCRA OLUNMUR, qeydin mətnində status var, təsdiqdən sonra DRAFT yaranır", async () => {
  const w = await shopifyWorld();
  const draft = prepareProduct({ name: "Yeni Ətir", description: "Təsvir", price: "25", currency: "AZN", tags: ["yeni"], vendor: "FN Parfum", category: "Parfum" });
  const r = await run(w, "shopify.product.create", { draft });
  assert.equal(r.status, "pending_approval");
  assert.equal(w.fake.st.calls.length, 0, "təsdiqdən əvvəl heç bir Shopify çağırışı olmamalıdır");
  const rec = await w.approvals.get(r.approval_id);
  assert.equal(rec.status, "pending");
  assert.equal(rec.kind, "shopify.product.create");
  assert.match(rec.content, /Status: DRAFT/);
  assert.match(rec.content, /Yeni Ətir/);
  assert.match(rec.content, /25\.00 AZN/);
  // təsdiqsiz icra cəhdi
  const early = await w.runner.execute(r.approval_id, { actor: UI });
  assert.equal(early.ok, false);
  assert.equal(early.error.code, "APPROVAL_REQUIRED");
  assert.equal(w.fake.st.calls.length, 0);
  // rədd edilmiş qeyd
  await w.approvals.decide(r.approval_id, { decision: "reject", actor: UI });
  assert.equal((await w.runner.execute(r.approval_id, { actor: UI })).ok, false);
  assert.equal(w.fake.st.calls.length, 0);

  // yeni qeyd -> təsdiq -> icra
  const p2 = await run(w, "shopify.product.create", { draft });
  const out = await w.runner.approveAndExecute(p2.approval_id, { actor: UI });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.output.verified, true);
  assert.equal(out.output.product.status, "DRAFT");
  assert.equal(out.output.product.handle, "yeni-etir");
  assert.equal(out.output.product.variants[0].price, "25.00");
  const sp = [...w.fake.st.products.values()][0];
  assert.equal(sp.status, "DRAFT");
  assert.equal(sp.vendor, "FN Parfum");
  assert.equal(created(w), 1);
  const rec2 = await w.approvals.get(p2.approval_id);
  assert.equal(rec2.execution, "done");
  assert.equal(leaks(out), false);
});

test("product.create: status yalnız təsdiqlənmiş sorğuda açıq ACTIVE olarsa ACTIVE (qaralamadakı status sahəsi nəzərə alınmır)", async () => {
  const w = await shopifyWorld();
  const draft = { ...prepareProduct({ name: "Aktiv Ətir", price: 9 }), status: "ACTIVE" };
  const a = await proposeAndApprove(w, "shopify.product.create", { draft });
  assert.match((await w.approvals.get(a.id)).content, /Status: DRAFT/);
  assert.equal([...w.fake.st.products.values()][0].status, "DRAFT");

  const w2 = await shopifyWorld();
  const b = await proposeAndApprove(w2, "shopify.product.create", { draft: prepareProduct({ name: "Aktiv Ətir", price: 9 }), status: "ACTIVE" });
  assert.match((await w2.approvals.get(b.id)).content, /Status: ACTIVE \(mağazada DƏRHAL/);
  assert.equal(b.out.output.product.status, "ACTIVE");
  assert.equal([...w2.fake.st.products.values()][0].status, "ACTIVE");
  assert.equal((await run(w2, "shopify.product.create", { draft, status: "PUBLISHED" })).status, "invalid_input");
});

test("product.create: hazır olmayan qaralama (qiymət yox, XSS) təsdiq qeydi açmır", async () => {
  const w = await shopifyWorld();
  const noPrice = await run(w, "shopify.product.create", { draft: prepareProduct({ name: "Qiymətsiz" }) });
  assert.equal(noPrice.status, "invalid_input");
  assert.match(noPrice.errors.join(" "), /price/);
  assert.equal((await w.approvals.list()).length, 0);
  // qaralama əl ilə pozulubsa (təhlükəli HTML) build onu yenidən təmizləyir
  const d = { ...prepareProduct({ name: "XSS", price: 5 }), descriptionHtml: "<script>alert(1)</script><p>ok</p>" };
  const r = await run(w, "shopify.product.create", { draft: d });
  assert.equal(r.status, "pending_approval");
  const rec = await w.approvals.get(r.approval_id);
  assert.ok(!/<script|alert/i.test(JSON.stringify(rec.payload)));
  // stok verilib, yer yoxdur
  const inv = await run(w, "shopify.product.create", { draft: prepareProduct({ name: "Stoklu", price: 5, inventory: 3 }) });
  assert.equal(inv.status, "invalid_input");
  assert.match(inv.errors.join(" "), /locationId/);
});

test("product.create: 10 paralel icra yalnız bir məhsul yaradır", async () => {
  const w = await shopifyWorld();
  const r = await run(w, "shopify.product.create", { draft: prepareProduct({ name: "Paralel", price: 7 }) });
  await w.approvals.decide(r.approval_id, { decision: "approve", actor: UI });
  const res = await Promise.all(Array.from({ length: 10 }, () => w.runner.execute(r.approval_id, { actor: UI })));
  assert.equal(res.filter((x) => x.ok).length, 1);
  assert.equal(res.filter((x) => x.status === "already_executed").length, 9);
  assert.equal(created(w), 1);
  assert.equal(w.fake.st.products.size, 1);
});

test("product.create: təkrar (eyni handle və ya başlıq) CONFLICT, heç nə yaradılmır", async () => {
  const { w } = await seeded();
  const before = w.fake.st.products.size;
  // eyni handle
  let x = await proposeAndApprove(w, "shopify.product.create", { draft: prepareProduct({ name: "Ətir Alfa", price: 5 }) });
  assert.equal(x.out.ok, false);
  assert.equal(x.out.error.code, "CONFLICT");
  // başlıq fərqli yazılışla (böyük/kiçik hərf, əlavə işarə), handle fərqli
  x = await proposeAndApprove(w, "shopify.product.create", { draft: prepareProduct({ name: "ƏTİR  ALFA!", handle: "basqa-handle", price: 5 }) });
  assert.equal(x.out.error.code, "CONFLICT");
  assert.equal(created(w), 0);
  assert.equal(w.fake.st.products.size, before);
  // arxivlənmiş məhsul da təkrar sayılır
  w.fake.addProduct({ title: "Arxiv Məhsul", handle: "arxiv-mehsul", status: "ARCHIVED" });
  x = await proposeAndApprove(w, "shopify.product.create", { draft: prepareProduct({ name: "Arxiv Məhsul", price: 5 }) });
  assert.equal(x.out.error.code, "CONFLICT");
  // proposeCreateFromIdea təklif mərhələsində də tutur
  const pr = await proposeCreateFromIdea({ registry: w.registry, client: w.client, idea: { name: "Ətir Alfa", price: 5 }, ctx: { approvals: w.approvals } });
  assert.equal(pr.ok, false);
  assert.equal(pr.stage, "duplicate");
  assert.equal(pr.duplicates[0].handle, "etir-alfa");
});

test("product.create: variantlar və stok yaradılır, geri oxuma ilə yoxlanır", async () => {
  const w = await shopifyWorld();
  const draft = prepareProduct({ name: "Çoxlu Ətir", price: "10", variants: [{ title: "30ml", sku: "C-30" }, { title: "50ml", price: "18.50", sku: "C-50" }], images: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"], tags: ["x"] });
  const a = await proposeAndApprove(w, "shopify.product.create", { draft });
  assert.equal(a.out.ok, true, JSON.stringify(a.out));
  const vs = a.out.output.product.variants;
  assert.deepEqual(vs.map((v) => [v.title, v.price, v.sku]).sort(), [["30ml", "10.00", "C-30"], ["50ml", "18.50", "C-50"]]);
  assert.equal(a.out.output.images.requested, 2);
  const created1 = w.fake.st.calls.find((c) => c.op === "CreateProduct").gql.variables;
  assert.equal(created1.product.status, "DRAFT");
  assert.equal(created1.media.length, 2);

  const w2 = await shopifyWorld();
  const single = prepareProduct({ name: "Stoklu Ətir", price: "12", inventory: 9 });
  const b = await proposeAndApprove(w2, "shopify.product.create", { draft: single, locationId: LOC });
  assert.equal(b.out.ok, true, JSON.stringify(b.out));
  const item = [...w2.fake.st.products.values()][0].variants[0].inventoryItem;
  assert.equal(w2.fake.st.inventory.get(item.id + "|" + LOC).available, 9);
  assert.match((await w2.approvals.get(b.id)).content, /Stok: 9/);
});

test("product.create: geri oxuma uyğun gəlmirsə PROVIDER_ERROR (saxta uğur yoxdur); yarımçıq addım xətası bildirilir", async () => {
  const fake = createFakeShopify();
  fake.st.ignoreVariantPriceUpdate = true; // Shopify "qəbul edir", amma qiyməti yazmır
  const w = await shopifyWorld({ fake });
  const a = await proposeAndApprove(w, "shopify.product.create", { draft: prepareProduct({ name: "Uyğunsuz", price: "30" }) });
  assert.equal(a.out.ok, false);
  assert.equal(a.out.status, "failed");
  assert.equal(a.out.error.code, "PROVIDER_ERROR");
  assert.match(a.out.error.message, /geri oxuma/);
  assert.match(a.out.error.message, /gid:\/\/shopify\/Product\//);
  assert.equal((await w.approvals.get(a.id)).execution, "failed");

  const w2 = await shopifyWorld();
  w2.fake.st.failOp = { op: "UpdateVariants", status: 200, body: { data: { productVariantsBulkUpdate: { productVariants: null, userErrors: [{ field: ["variants"], message: "Price is invalid" }] } } } };
  const b = await proposeAndApprove(w2, "shopify.product.create", { draft: prepareProduct({ name: "Yarımçıq", price: "30" }) });
  assert.equal(b.out.ok, false);
  assert.match(b.out.error.message, /yaradıldı/);
  assert.match(b.out.error.message, /təkrar yaratmayın/);
  // təkrar təsdiq: eyni ad artıq var -> CONFLICT (ikiqat yaratma yoxdur)
  const c = await proposeAndApprove(w2, "shopify.product.create", { draft: prepareProduct({ name: "Yarımçıq", price: "30" }) });
  assert.equal(c.out.error.code, "CONFLICT");
  assert.equal(created(w2), 1);
});

test("product.create: valyuta uyğunsuzluğu və şəbəkə vaxt aşımı (nəticə bilinmir, təkrar yoxdur)", async () => {
  const w = await shopifyWorld();
  const a = await proposeAndApprove(w, "shopify.product.create", { draft: prepareProduct({ name: "USD ətir", price: "5", currency: "USD" }) });
  assert.equal(a.out.error.code, "VALIDATION_ERROR");
  assert.equal(created(w), 0);

  const w2 = await shopifyWorld();
  w2.fake.st.failOp = { op: "CreateProduct", status: 504 };
  const b = await proposeAndApprove(w2, "shopify.product.create", { draft: prepareProduct({ name: "Gecikən", price: "5" }) });
  assert.equal(b.out.ok, false);
  assert.equal(created(w2), 1, "avtomatik təkrar yoxdur");
});

// ---------------------------------------------------------------------------------------------------
test("təsdiq qeydi dəyişdirilərsə icra bloklanır (xülasə = icra)", async () => {
  const w = await shopifyWorld();
  const r = await run(w, "shopify.product.create", { draft: prepareProduct({ name: "Təmiz", price: 5 }) });
  const rec = await w.approvals.get(r.approval_id);
  rec.payload.input.draft.title = "Başqa Məhsul";
  rec.payload.input.draft.handle = "basqa-mehsul";
  await w.store.putDoc("approval", rec.id, rec);
  await w.approvals.decide(rec.id, { decision: "approve", actor: UI });
  const out = await w.runner.execute(rec.id, { actor: UI });
  assert.equal(out.ok, false);
  assert.ok(["blocked"].includes(out.status), out.status);
  assert.equal(w.fake.st.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------------
test("price.update: köhnə->yeni qeyddə görünür, icra və geri oxuma", async () => {
  const { w, p, v } = await seeded();
  const input = { productId: p.id, product_title: p.title, variants: [{ id: v.id, title: v.title, old_price: "20.00", new_price: "24.5" }] };
  const r = await run(w, "shopify.price.update", input);
  assert.equal(r.status, "pending_approval");
  assert.equal(writeOps(w).length, 0);
  const rec = await w.approvals.get(r.approval_id);
  assert.match(rec.content, /20\.00 -> 24\.50/);
  assert.match(rec.content, /\+22\.5%/);
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.output.product.variants[0].price, "24.50");
  assert.equal(w.fake.st.products.get(p.id).variants[0].price, "24.50");
  assert.equal(out.output.verified, true);
});

test("price.update: təsdiqdən sonra qiymət dəyişibsə CONFLICT və yazılmır; 2 dəfə dəyişmə qoruması", async () => {
  const { w, p, v } = await seeded();
  const r = await run(w, "shopify.price.update", { productId: p.id, variants: [{ id: v.id, old_price: "20.00", new_price: "30.00" }] });
  w.fake.st.products.get(p.id).variants[0].price = "22.00"; // kimsə admin-dən dəyişdi
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "CONFLICT");
  assert.match(out.error.message, /indi 22\.00, təsdiqdə 20\.00/);
  assert.equal(w.fake.st.products.get(p.id).variants[0].price, "22.00");
  assert.ok(!w.fake.ops().includes("UpdateVariants"));
  // eyni qeydi təkrar icra etmək olmur
  assert.equal((await w.runner.execute(r.approval_id, { actor: UI })).status, "already_executed");
});

test("price.update: geri oxuma uyğunsuzluğu, yanlış variant, valyuta, eyni qiymət, böyük dəyişiklik xəbərdarlığı", async () => {
  const fake = createFakeShopify();
  const { w, p, v } = await (async () => { const w = await shopifyWorld({ fake }); const p = fake.addProduct({ title: "Q", handle: "q", variants: [{ title: "Default Title", price: "10.00" }] }); return { w, p, v: p.variants[0] }; })();
  fake.st.ignoreVariantPriceUpdate = true;
  let x = await proposeAndApprove(w, "shopify.price.update", { productId: p.id, variants: [{ id: v.id, old_price: "10.00", new_price: "11.00" }] });
  assert.equal(x.out.ok, false);
  assert.equal(x.out.error.code, "PROVIDER_ERROR");
  fake.st.ignoreVariantPriceUpdate = false;

  x = await proposeAndApprove(w, "shopify.price.update", { productId: p.id, variants: [{ id: "gid://shopify/ProductVariant/5", old_price: "10.00", new_price: "11.00" }] });
  assert.equal(x.out.error.code, "NOT_FOUND");
  x = await proposeAndApprove(w, "shopify.price.update", { productId: p.id, currency: "USD", variants: [{ id: v.id, old_price: "10.00", new_price: "11.00" }] });
  assert.equal(x.out.error.code, "VALIDATION_ERROR");
  assert.equal((await propose(w, "shopify.price.update", { productId: p.id, variants: [{ id: v.id, old_price: "10.00", new_price: "10" }] })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.price.update", { productId: p.id, variants: [{ id: v.id, old_price: "10.00", new_price: "-1" }] })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.price.update", { productId: p.id, variants: [] })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.price.update", { productId: "salam", variants: [{ id: v.id, old_price: "1", new_price: "2" }] })).status, "invalid_input");
  const big = await propose(w, "shopify.price.update", { productId: p.id, variants: [{ id: v.id, old_price: "10.00", new_price: "35.00" }] });
  assert.match((await w.approvals.get(big.approval_id)).content, /DİQQƏT/);
});

test("price.update: proposePriceUpdate cari qiyməti özü oxuyub köhnə dəyər kimi yazır", async () => {
  const { w, p, v } = await seeded();
  const r = await proposePriceUpdate({ registry: w.registry, client: w.client, productId: p.id, prices: [{ variantId: v.id, newPrice: "21" }], ctx: { approvals: w.approvals } });
  assert.equal(r.status, "pending_approval");
  assert.match((await w.approvals.get(r.approval_id)).content, /20\.00 -> 21\.00/);
});

// ---------------------------------------------------------------------------------------------------
test("inventory.set: köhnə->yeni, icra, geri oxuma", async () => {
  const { w, v } = await seeded();
  const input = { inventoryItemId: v.inventoryItem.id, locationId: LOC, old_quantity: 7, new_quantity: 12 };
  const r = await run(w, "shopify.inventory.set", input);
  assert.equal(r.status, "pending_approval");
  assert.equal(writeOps(w).length, 0);
  assert.match((await w.approvals.get(r.approval_id)).content, /7 -> 12 \(\+5\)/);
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual([out.output.inventory.old, out.output.inventory.new], [7, 12]);
  assert.equal(w.fake.st.inventory.get(v.inventoryItem.id + "|" + LOC).available, 12);
  const sets = w.fake.st.calls.filter((c) => c.op === "SetInventory");
  assert.equal(sets.length, 1);
  assert.equal(sets[0].gql.variables.input.quantities[0].changeFromQuantity, 7, "Shopify tərəfində də müqayisə (CAS)");
});

test("inventory.set: stok dəyişibsə CONFLICT; geri oxuma uyğunsuzluğu PROVIDER_ERROR; izləmə söndürülübsə rədd", async () => {
  const { w, v } = await seeded();
  const input = { inventoryItemId: v.inventoryItem.id, locationId: LOC, old_quantity: 7, new_quantity: 3 };
  const r = await run(w, "shopify.inventory.set", input);
  w.fake.st.inventory.get(v.inventoryItem.id + "|" + LOC).available = 5; // satış oldu
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(out.error.code, "CONFLICT");
  assert.equal(w.fake.st.inventory.get(v.inventoryItem.id + "|" + LOC).available, 5);
  assert.ok(!w.fake.ops().includes("SetInventory"));

  w.fake.st.ignoreInventorySet = true;
  const x = await proposeAndApprove(w, "shopify.inventory.set", { ...input, old_quantity: 5 });
  assert.equal(x.out.error.code, "PROVIDER_ERROR");
  w.fake.st.ignoreInventorySet = false;

  v.inventoryItem.tracked = false;
  const y = await proposeAndApprove(w, "shopify.inventory.set", { ...input, old_quantity: 5 });
  assert.equal(y.out.error.code, "VALIDATION_ERROR");
  assert.equal((await propose(w, "shopify.inventory.set", { ...input, new_quantity: 7 })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.inventory.set", { ...input, new_quantity: -1 })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.inventory.set", { ...input, locationId: "gid://shopify/Product/1" })).status, "invalid_input");
});

test("inventory.set: proposeInventorySet cari sayı oxuyub köhnə dəyər kimi yazır", async () => {
  const { w, v } = await seeded();
  const r = await proposeInventorySet({ registry: w.registry, client: w.client, inventoryItemId: v.inventoryItem.id, locationId: LOC, newQuantity: 20, ctx: { approvals: w.approvals } });
  assert.equal(r.status, "pending_approval");
  assert.match((await w.approvals.get(r.approval_id)).content, /7 -> 20/);
});

// ---------------------------------------------------------------------------------------------------
test("product.update: köhnə->yeni, təsdiqdən sonra dəyişibsə CONFLICT, no-op rədd", async () => {
  const { w, p } = await seeded();
  const r = await proposeProductUpdate({ registry: w.registry, client: w.client, id: p.id, changes: { title: "Ətir Alfa Yeni", tags: ["a", "c"], descriptionHtml: "Yeni <b>təsvir</b><script>x</script>" }, ctx: { approvals: w.approvals } });
  assert.equal(r.status, "pending_approval");
  const rec = await w.approvals.get(r.approval_id);
  assert.match(rec.content, /title: «Ətir Alfa» -> «Ətir Alfa Yeni»/);
  assert.match(rec.content, /tags: \[a, b\] -> \[a, c\]/);
  assert.ok(!/<script|alert/.test(JSON.stringify(rec.payload)));
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(w.fake.st.products.get(p.id).title, "Ətir Alfa Yeni");
  assert.deepEqual(w.fake.st.products.get(p.id).tags, ["a", "c"]);
  assert.equal(out.output.product.handle, "etir-alfa", "handle dəyişmir");

  // stale
  const r2 = await proposeProductUpdate({ registry: w.registry, client: w.client, id: p.id, changes: { vendor: "Yeni Satıcı" }, ctx: { approvals: w.approvals } });
  w.fake.st.products.get(p.id).vendor = "Başqa";
  const o2 = await w.runner.approveAndExecute(r2.approval_id, { actor: UI });
  assert.equal(o2.error.code, "CONFLICT");
  assert.equal(w.fake.st.products.get(p.id).vendor, "Başqa");
  // dəyişiklik yoxdur / eyni dəyər / before yoxdur / status dəyişmir
  assert.equal((await propose(w, "shopify.product.update", { id: p.id, changes: {}, before: {} })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.product.update", { id: p.id, changes: { vendor: "X" }, before: { vendor: "X" } })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.product.update", { id: p.id, changes: { vendor: "X" }, before: {} })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.product.update", { id: p.id, changes: { status: "ACTIVE" }, before: { status: "DRAFT" } })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.product.update", { id: p.id, changes: { seoTitle: "x".repeat(71) }, before: { seoTitle: "" } })).status, "invalid_input");
});

// ---------------------------------------------------------------------------------------------------
test("product.publish: DRAFT -> ACTIVE yalnız təsdiqlə, status uyğunsuzluğu CONFLICT, geri oxuma yoxlanır, 0 qiymət rədd", async () => {
  const { w, p } = await seeded();
  const r = await proposePublish({ registry: w.registry, client: w.client, id: p.id, ctx: { approvals: w.approvals } });
  assert.equal(r.status, "pending_approval");
  assert.equal(w.fake.st.products.get(p.id).status, "DRAFT", "təsdiqdən əvvəl dəyişməyib");
  assert.match((await w.approvals.get(r.approval_id)).content, /DRAFT -> ACTIVE/);
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(w.fake.st.products.get(p.id).status, "ACTIVE");

  // stale: təsdiqdən sonra kimsə artıq ACTIVE edib
  const q = w.fake.addProduct({ title: "Q2", handle: "q2", status: "DRAFT", variants: [{ title: "Default Title", price: "5.00" }] });
  const r2 = await run(w, "shopify.product.publish", { id: q.id, expected_status: "DRAFT" });
  q.status = "ARCHIVED";
  assert.equal((await w.runner.approveAndExecute(r2.approval_id, { actor: UI })).error.code, "CONFLICT");

  // geri oxuma uyğunsuz
  const z = w.fake.addProduct({ title: "Z", handle: "z", status: "DRAFT", variants: [{ title: "Default Title", price: "5.00" }] });
  w.fake.st.ignoreStatusUpdate = true;
  const x = await proposeAndApprove(w, "shopify.product.publish", { id: z.id, expected_status: "DRAFT" });
  assert.equal(x.out.error.code, "PROVIDER_ERROR");
  w.fake.st.ignoreStatusUpdate = false;

  // qiyməti 0 olan məhsul satışa çıxmır
  const zero = w.fake.addProduct({ title: "Sıfır", handle: "sifir", status: "DRAFT", variants: [{ title: "Default Title", price: "0.00" }] });
  const y = await proposeAndApprove(w, "shopify.product.publish", { id: zero.id, expected_status: "DRAFT" });
  assert.equal(y.out.error.code, "VALIDATION_ERROR");
  assert.equal(zero.status, "DRAFT");
  // artıq aktiv məhsul üçün təklif
  await assert.rejects(() => proposePublish({ registry: w.registry, client: w.client, id: p.id, ctx: { approvals: w.approvals } }), (e) => e.code === "CONFLICT");
});

test("product.archive: məhsul ARCHIVED olur, SİLİNMİR; heç bir silmə əməliyyatı göndərilmir", async () => {
  const { w, p } = await seeded();
  p.status = "ACTIVE";
  const r = await proposeArchive({ registry: w.registry, client: w.client, id: p.id, ctx: { approvals: w.approvals } });
  assert.match((await w.approvals.get(r.approval_id)).content, /SİLİNMİR/);
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(w.fake.st.products.has(p.id), "məhsul yerindədir");
  assert.equal(w.fake.st.products.get(p.id).status, "ARCHIVED");
  assert.equal(out.output.product.status, "ARCHIVED");
  for (const op of w.fake.ops()) assert.ok(!/delete/i.test(op), op);
  for (const c of w.fake.st.calls.filter((x) => x.gql)) assert.ok(!/delete/i.test(c.gql.query));
  // stale
  const r2 = await run(w, "shopify.product.archive", { id: p.id, expected_status: "ACTIVE" });
  assert.equal((await w.runner.approveAndExecute(r2.approval_id, { actor: UI })).error.code, "CONFLICT");
});

// ---------------------------------------------------------------------------------------------------
test("collection.add: əlavə, artıq üzv atlanır, olmayan kolleksiya xətası, geri oxuma", async () => {
  const { w, p } = await seeded();
  const p2 = w.fake.addProduct({ title: "İkinci", handle: "ikinci", variants: [{ title: "Default Title", price: "1.00" }] });
  const col = "gid://shopify/Collection/1";
  const r = await run(w, "shopify.collection.add", { collectionId: col, productIds: [p.id, p2.id.split("/").pop(), p.id] });
  assert.equal(r.status, "pending_approval");
  const rec = await w.approvals.get(r.approval_id);
  assert.equal(rec.payload.input.productIds.length, 2, "təkrarlar silinir, rəqəmli id gid-ə çevrilir");
  assert.equal(w.fake.st.collections.get(col).products.size, 0);
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.output.verified, true);
  assert.equal(w.fake.st.collections.get(col).products.size, 2);

  const n = w.fake.ops().filter((o) => o === "AddToCollection").length;
  const again = await proposeAndApprove(w, "shopify.collection.add", { collectionId: col, productIds: [p.id] });
  assert.equal(again.out.ok, true);
  assert.deepEqual(again.out.output.added, []);
  assert.equal(w.fake.ops().filter((o) => o === "AddToCollection").length, n, "artıq üzv olana mutasiya göndərilmir");

  assert.equal((await propose(w, "shopify.collection.add", { collectionId: "gid://shopify/Collection/999", productIds: [p.id] })).status, "invalid_input", "olmayan kolleksiya təsdiq qeydi açılmadan rədd edilir");
  assert.equal((await propose(w, "shopify.collection.add", { collectionId: col, productIds: [p.id], collection_title: "Yanlış ad" })).status, "invalid_input", "verilən ad real adla uyğun gəlmir");
  assert.ok(rec.payload.input.collection_title, "real ad payload-a yazılır");
  assert.ok(rec.content.includes(rec.payload.input.collection_title), "təsdiq mətni real kolleksiya adını göstərir");
  // təsdiqdən sonra kolleksiya avtomatikə çevrilsə və ya adı dəyişsə heç nə yazılmır
  const w3 = await seeded();
  const r3 = await run(w3.w, "shopify.collection.add", { collectionId: col, productIds: [w3.p.id] });
  w3.w.fake.st.collections.get(col).title = "Başqa ad";
  const o3 = await w3.w.runner.approveAndExecute(r3.approval_id, { actor: UI });
  assert.equal(o3.ok, false);
  assert.equal(o3.error.code, "CONFLICT");
  assert.equal(w3.w.fake.ops().filter((o) => o === "AddToCollection").length, 0, "ad uyğunsuzluğunda mutasiya göndərilmir");
  assert.equal((await propose(w, "shopify.collection.add", { collectionId: col, productIds: [] })).status, "invalid_input");
  assert.equal((await propose(w, "shopify.collection.add", { collectionId: col, productIds: Array.from({ length: 21 }, (_, i) => String(i + 1)) })).status, "invalid_input");
});

test("webhooks.register: yalnız təsdiqlə, ünvan qeyddə görünür, təkrar yaratmır", async () => {
  const w = await shopifyWorld();
  const r = await run(w, "shopify.webhooks.register", {});
  assert.equal(r.status, "pending_approval");
  assert.equal(w.fake.st.calls.length, 0);
  const rec = await w.approvals.get(r.approval_id);
  assert.match(rec.content, /https:\/\/jarvis\.example\.dev\/shopify\/webhook/);
  assert.match(rec.content, /app\/uninstalled/);
  const out = await w.runner.approveAndExecute(r.approval_id, { actor: UI });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.output.created.length, 6);
  assert.equal(w.fake.st.webhooks.length, 6);
  const two = await proposeAndApprove(w, "shopify.webhooks.register", { topics: ["products/update", "orders/create"] });
  assert.equal(two.out.ok, true);
  assert.equal(two.out.output.created.length, 0);
  assert.equal(w.fake.st.webhooks.length, 6);
  assert.equal((await propose(w, "shopify.webhooks.register", { topics: ["customers/redact"] })).status, "invalid_input");
  const w2 = await shopifyWorld({ envExtra: { PUBLIC_BASE_URL: "" } });
  assert.equal((await propose(w2, "shopify.webhooks.register", {})).status, "invalid_input");
});

// ---------------------------------------------------------------------------------------------------
test("proposeCreateFromIdea: hazır -> təsdiq qeydi; hazır deyil -> qeyd yox; stok yeri avtomatik/yoxdur", async () => {
  const w = await shopifyWorld();
  const ctx = { approvals: w.approvals };
  let r = await proposeCreateFromIdea({ registry: w.registry, client: w.client, idea: { name: "İdeya Ətri", price: "19.9", description: "Qısa" }, ctx });
  assert.equal(r.ok, true);
  assert.ok(r.approval_id);
  assert.match((await w.approvals.get(r.approval_id)).content, /Status: DRAFT/);
  assert.equal(created(w), 0);

  const before = (await w.approvals.list()).length;
  r = await proposeCreateFromIdea({ registry: w.registry, client: w.client, idea: { name: "Qiymətsiz ideya" }, ctx });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "prepare");
  assert.ok(r.draft.missing.includes("price"));
  assert.equal((await w.approvals.list()).length, before);

  // bir aktiv yer varsa stok yeri avtomatik tapılır
  r = await proposeCreateFromIdea({ registry: w.registry, client: w.client, idea: { name: "Stoklu ideya", price: 5, inventory: 4 }, ctx });
  assert.equal(r.ok, true);
  assert.equal((await w.approvals.get(r.approval_id)).payload.input.locationId, LOC);
  // iki yer varsa təxmin etmir
  w.fake.st.locations.push({ id: "gid://shopify/Location/2", name: "İkinci", isActive: true });
  r = await proposeCreateFromIdea({ registry: w.registry, client: w.client, idea: { name: "Stoklu ideya 2", price: 5, inventory: 4 }, ctx });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "location");
});

// ---------------------------------------------------------------------------------------------------
test("token heç bir qaytarılan dəyərdə, təsdiq qeydində və audit jurnalında yoxdur; yalnız qoşulu mağaza domeninə sorğu", async () => {
  const { w, p, v } = await seeded();
  const results = [];
  for (const [n, i] of [["shopify.shop.info", {}], ["shopify.products.search", { query: "ətir" }], ["shopify.product.get", { id: p.id }], ["shopify.orders.list", {}], ["shopify.order.get", { id: "gid://shopify/Order/11" }], ["shopify.inventory.get", { productId: p.id }], ["shopify.collections.list", {}], ["shopify.webhooks.list", {}], ["shopify.product.prepare", { name: "x", price: 1 }]]) results.push(await run(w, n, i));
  const writes = [
    ["shopify.product.create", { draft: prepareProduct({ name: "Token sınağı", price: 3 }) }],
    ["shopify.price.update", { productId: p.id, variants: [{ id: v.id, old_price: "20.00", new_price: "21.00" }] }],
    ["shopify.inventory.set", { inventoryItemId: v.inventoryItem.id, locationId: LOC, old_quantity: 7, new_quantity: 8 }],
    ["shopify.product.publish", { id: p.id, expected_status: "DRAFT" }],
    ["shopify.collection.add", { collectionId: "gid://shopify/Collection/1", productIds: [p.id] }],
    ["shopify.webhooks.register", {}],
  ];
  for (const [n, i] of writes) results.push(await proposeAndApprove(w, n, i));
  // uğursuz yollar da
  w.fake.st.failOp = { op: "ShopInfo", status: 200, body: { errors: [{ message: "token " + FAKE_TOKEN }] } };
  results.push(await run(w, "shopify.shop.info", {}));
  w.fake.st.failOp = null;
  assert.ok(results.length > 15);
  assert.equal(leaks(results), false, "nəticələrdə token izi");
  assert.equal(leaks(await w.approvals.list({ limit: 40 })), false, "təsdiq qeydlərində token izi");
  assert.equal((await allAuditText(w)).includes(FAKE_TOKEN), false, "audit jurnalında token izi");
  assert.equal(JSON.stringify(await w.registry.list()).includes(FAKE_TOKEN), false);
  assert.ok(w.fake.st.calls.length > 20);
  assert.ok(w.fake.st.calls.every((c) => c.host === SHOP), "yalnız qoşulu mağaza domeni");
  assert.ok(w.fake.st.calls.every((c) => c.url.startsWith("https://" + SHOP + "/admin/api/2026-07/graphql.json")));
  assert.ok(w.fake.st.calls.every((c) => !String(c.body || "").includes(FAKE_TOKEN)), "token sorğu gövdəsinə yazılmır");
});
