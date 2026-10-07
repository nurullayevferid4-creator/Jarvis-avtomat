// İşləyən Worker üzərində (wrangler dev --local və ya deploy olunmuş ünvan) real tüstü yoxlaması.
// Heç bir xarici API çağırmır, heç nə paylaşmır. Yaratdığı test mediasını təsdiq axını ilə silir.
//   SMOKE_BASE=http://127.0.0.1:8799 SMOKE_PASSCODE=... node scripts/runtime-smoke.mjs
// Parol YALNIZ mühit dəyişənindən oxunur; heç yerə yazılmır.
import { buildMp4 } from "../tests/fixtures.mjs";

const BASE = (process.env.SMOKE_BASE || "").replace(/\/+$/, "");
const PASS = process.env.SMOKE_PASSCODE || "";
if (!BASE || !PASS) { console.error("SMOKE_BASE və SMOKE_PASSCODE lazımdır"); process.exit(2); }
const h = (extra = {}) => ({ "x-passcode-b64": Buffer.from(PASS, "utf8").toString("base64"), ...extra });
const results = [];
function check(name, ok, detail = "") { results.push({ name, ok: !!ok, detail }); console.log((ok ? "OK   " : "FAIL ") + name + (ok ? "" : "  → " + detail)); }
const jf = async (path, opt = {}) => { const r = await fetch(BASE + path, { ...opt, headers: h(opt.headers) }); let d = {}; try { d = await r.json(); } catch (e) { /* json deyil */ } return { status: r.status, d }; };

const root = await fetch(BASE + "/");
const csp = root.headers.get("content-security-policy") || "";
check("GET / → 200 və CSP nonce", root.status === 200 && /script-src 'nonce-/.test(csp) && !/unsafe-inline/.test(csp), csp);
check("təhlükəsizlik başlıqları", root.headers.get("x-frame-options") === "DENY" && root.headers.get("x-content-type-options") === "nosniff");

const noAuth = await fetch(BASE + "/api/status");
check("parolsuz /api/status → 401", noAuth.status === 401, String(noAuth.status));
const st = await jf("/api/status");
check("parollu /api/status → 200", st.status === 200, String(st.status));
check("status sirr dəyəri vermir", !JSON.stringify(st.d).includes(PASS));
check("koordinator Durable Object", st.d.coordinator === "durable_object", String(st.d.coordinator));

const mp4 = buildMp4();
const up = await jf("/api/media", { method: "POST", headers: { "content-type": "video/mp4", "content-length": String(mp4.length) }, body: mp4 });
const mid = up.d.media && up.d.media.id;
check("media yükləmə (axınla, MP4 analiz)", up.status === 200 && mid && up.d.media.analysis, JSON.stringify(up.d).slice(0, 200));
const fake = await jf("/api/media", { method: "POST", headers: { "content-type": "video/mp4", "content-length": "20" }, body: new Uint8Array(20) });
check("saxta MP4 (yanlış baytlar) rədd edilir", fake.status === 400, String(fake.status));

if (mid) {
  const run = await jf("/api/tools/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "media.delete", input: { media_id: mid, label: "smoke test" } }) });
  check("media.delete → təsdiq qeydi (202), silinmir", run.status === 202 && run.d.approval_id, JSON.stringify(run.d).slice(0, 200));
  const still = await jf("/api/media/" + mid);
  check("təsdiqdən əvvəl media yerindədir", still.status === 200);
  if (run.d.approval_id) {
    const N = 6;
    const rs = await Promise.all(Array.from({ length: N }, () => jf("/api/approvals/" + run.d.approval_id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) })));
    const okCount = rs.filter((r) => r.status === 200).length;
    check("eyni anda " + N + " təsdiq → yalnız 1 icra", okCount === 1, rs.map((r) => r.status).join(","));
    const gone = await jf("/api/media/" + mid);
    check("təsdiqdən sonra media silinib", gone.status === 404, String(gone.status));
  }
}
const a = await jf("/api/audit?limit=10");
check("audit hadisələri yazılır", a.status === 200 && a.d.events && a.d.events.length > 0);
const bad = await jf("/api/tools/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "yoxdur.alet", input: {} }) });
check("naməlum alət → 404", bad.status === 404);

const failed = results.filter((r) => !r.ok);
console.log("\n" + results.length + " yoxlama, " + failed.length + " uğursuz.");
process.exit(failed.length ? 1 : 0);
