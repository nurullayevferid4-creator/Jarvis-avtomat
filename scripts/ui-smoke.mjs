// UI tüstü yoxlaması: səhifəni real Chromium-da açır, CSP/JS xətası olmadığını və panellərin işlədiyini yoxlayır.
// Worker birbaşa Node-da işləyir (şəbəkə yoxdur, saxta env). İşə salmaq: node scripts/ui-smoke.mjs
// Tələb: playwright paketi (qlobal quraşdırılıb və ya npm i -g playwright) və Chromium.
import { createRequire } from "node:module";
import worker from "../worker.js";
import { buildMp4 } from "../tests/fixtures.mjs";
import { fakeR2 } from "../tests/social-helpers.mjs";

const require = createRequire(import.meta.url);
let chromium;
for (const p of ["playwright", process.env.PLAYWRIGHT_PATH || "", "/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright"]) {
  if (!p) continue;
  try { chromium = require(p).chromium; break; } catch (e) { /* növbəti */ }
}
if (!chromium) { console.error("playwright tapılmadı: yoxlama icra OLUNMADI"); process.exit(2); }

const TG_TOKEN = "123456:UI-SMOKE-BOT-TOKEN-VALUE";
const TG_SECRET = "ui-smoke-webhook-secret";
const env = { ANTHROPIC_API_KEY: "test-a", OPENAI_API_KEY: "test-o", PASSCODE: "şifrə-ə", JARVIS_MEDIA: fakeR2(), TOKEN_ENC_KEY: "ui-smoke-key", PUBLIC_BASE_URL: "https://jarvis.example.dev", TELEGRAM_BOT_TOKEN: TG_TOKEN, TELEGRAM_WEBHOOK_SECRET: TG_SECRET, TELEGRAM_ALLOWED_CHAT_IDS: "1001" };
// Worker Node-da işləyir: Telegram Bot API-yə gedən çağırışlar vəziyyətli saxta serverə yönləndirilir (şəbəkə yoxdur).
const tgState = { url: "", allowed_updates: undefined, rejectToken: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init = {}) => {
  const m = String(u).match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/);
  if (!m) return realFetch(u, init);
  const jr = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "content-type": "application/json" } });
  if (tgState.rejectToken || m[1] !== TG_TOKEN) return jr({ ok: false, error_code: 401, description: "Unauthorized" }, 401);
  const body = init.body ? JSON.parse(String(init.body)) : {};
  if (m[2] === "getMe") return jr({ ok: true, result: { username: "ui_smoke_bot" } });
  if (m[2] === "getWebhookInfo") return jr({ ok: true, result: { url: tgState.url, pending_update_count: 0, ...(tgState.allowed_updates ? { allowed_updates: tgState.allowed_updates } : {}) } });
  if (m[2] === "setWebhook") { tgState.url = body.url; tgState.allowed_updates = body.allowed_updates; return jr({ ok: true, result: true }); }
  return jr({ ok: false, error_code: 404, description: "Not Found" }, 404);
};
const origin = "http://jarvis.test";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push("console." + m.type() + ": " + m.text()); });
await page.route("**/*", async (route) => {
  const req = route.request();
  const body = req.postDataBuffer();
  const r = await worker.fetch(new Request(req.url(), { method: req.method(), headers: { ...req.headers(), ...(body ? { "content-length": String(body.length) } : {}), "cf-connecting-ip": "1.2.3.4" }, body: body && req.method() !== "GET" ? body : undefined }), env, {});
  const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
});
await page.goto(origin + "/");
await page.fill("#pass", "şifrə-ə");
await page.click("#login");
await page.waitForFunction(() => /uğurludur|səhvdir|yoxlanmadı/.test(document.getElementById("loginmsg").textContent), null, { timeout: 5000 }).catch(() => { console.error("login cavabı gəlmədi", problems); });
const login = await page.textContent("#loginmsg");
for (const id of ["d-status", "d-appr", "d-media", "d-audit", "d-acc", "d-jobs"]) {
  await page.evaluate((i) => { document.getElementById(i).open = true; }, id);
}
await page.waitForTimeout(800);
const statusText = await page.textContent("#status");
const apprText = await page.textContent("#appr");
const auditText = await page.textContent("#audit");
const accText = await page.textContent("#sp");
// Media yükləmə → video işi (UI-dan API-yə tam yol)
await page.setInputFiles("#file", { name: "t.mp4", mimeType: "video/mp4", buffer: Buffer.from(buildMp4()) });
await page.click("#upload");
await page.waitForFunction(() => document.getElementById("media").textContent.includes("VIDEO"), null, { timeout: 5000 }).catch(() => problems.push("media siyahısında video görünmədi"));
if (problems.length) { console.error("DEBUG state:", await page.textContent("#state"), "| errs:", await page.textContent("#errs"), "| media:", await page.textContent("#media")); }
await page.click("#media button.p", { timeout: 3000 });
await page.waitForFunction(() => document.getElementById("mjobs").textContent.match(/Bitdi|Uğursuz|İşləyir|Növbədə/), null, { timeout: 8000 }).catch(() => problems.push("video işi görünmədi"));
const mediaText = await page.textContent("#media");
const mjobsText = await page.textContent("#mjobs");
// Telegram webhook düymələri (real Chromium → worker → saxta Telegram)
const tgBox = async () => await page.textContent("#tgres");
const tgWait = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById("tgres").textContent), re.source, { timeout: 5000 });
const tg = {};
await page.evaluate(() => { document.getElementById("d-acc").open = true; });
await page.click("#tgcheck");
await tgWait(/qurulmayıb/).catch(() => problems.push("tgcheck: 'qurulmayıb' görünmədi"));
tg.check_before = await tgBox();
await page.click("#tgsetup");
await tgWait(/QURULDU/).catch(() => problems.push("tgsetup: 'QURULDU' görünmədi"));
tg.setup = await tgBox();
if (tgState.url !== "https://jarvis.example.dev/telegram/webhook") problems.push("Telegram-da webhook ünvanı düzgün qurulmayıb: " + tgState.url);
await page.click("#tgsetup");
await tgWait(/ARTIQ QURULUB/).catch(() => problems.push("ikinci basış idempotent deyil"));
tg.setup_again = await tgBox();
await page.click("#tgcheck");
await tgWait(/Webhook düzgündür/).catch(() => problems.push("tgcheck: 'düzgündür' görünmədi"));
tg.check_after = await tgBox();
tgState.rejectToken = true;
const beforeTg = problems.length;
await page.click("#tgsetup");
await tgWait(/bot_token_rejected/).catch(() => problems.push("token rədd halı UI-da dəqiq səbəblə görünmədi"));
tg.rejected = await tgBox();
await page.waitForTimeout(100);
// Qəsdən yaradılan 424 brauzer konsol xətası problem sayılmır
const tgNoise = problems.splice(beforeTg).filter((m) => !/424/.test(m));
problems.push(...tgNoise);
const tgAll = Object.values(tg).join(" | ") + (await page.textContent("#errs")) + (await page.textContent("#state"));
const tgLeak = tgAll.includes(TG_TOKEN) || tgAll.includes("UI-SMOKE-BOT-TOKEN") || tgAll.includes(TG_SECRET);
if (/\b409\b/.test(tg.rejected)) problems.push("token rədd halı 409 kimi göstərilir");
const before = problems.length;
await page.fill("#pass", "yanlış");
await page.click("#login");
await page.waitForFunction(() => document.getElementById("loginmsg").textContent.includes("səhvdir"), null, { timeout: 5000 });
await browser.close();
// Səhv parolun qəsdən yaratdığı 401 brauzer xətası problem sayılmır
const wrongPassNoise = problems.splice(before).filter((m) => !/401/.test(m));
problems.push(...wrongPassNoise);
const out = { login, status_has_secret_flags: /ANTHROPIC_API_KEY/.test(statusText), approvals: apprText.slice(0, 40), media: mediaText.slice(0, 60), video_job: mjobsText.slice(0, 80), audit: auditText.slice(0, 40), accounts: accText.slice(0, 60), telegram: tg, problems };
console.log(JSON.stringify(out, null, 1));
const secretLeak = /test-a|test-o|şifrə-ə/.test(statusText + apprText + auditText + accText) || tgLeak;
if (!/uğurludur/.test(login) || problems.length || secretLeak) { console.error("UI YOXLAMASI UĞURSUZ", secretLeak ? "(sirr sızması)" : ""); process.exit(1); }
console.log("UI OK");
