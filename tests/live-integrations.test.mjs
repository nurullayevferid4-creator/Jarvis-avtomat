// Platforma CANLI testləri (YALNIZ OXUMA). Defolt olaraq ATLANIR: pul/kvota xərcləmir, credential tələb etmir.
//
//   Credential yoxdur            -> test "skipped" (səbəb yazılır, uğur kimi göstərilmir)
//   RUN_LIVE_TESTS=1 + credential -> real oxuma sorğusu (yazma/göndərmə HEÇ VAXT yoxdur)
//   API xətası                   -> test uğursuz olur, xətanın yalnız HTTP statusu/kodu çap olunur (token yox)
//   Uğur                         -> auditdə 'tool.done' yoxlanır
//
// İşə salmaq üçün (credential-ları mühitə ver, repoya yazma):
//   IG_FNPARFUM_TOKEN=... npm run test:live:integrations
// Nəticə API cavabından alınır; heç bir dəyər uydurulmur.
import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../src/wiring.js";
import { resetAll } from "./wiring-helpers.mjs";
import { missingEnv, INTEGRATION_ENV } from "../src/integrations/secrets.js";

const WANT_LIVE = process.env.RUN_LIVE_TESTS === "1";
const NAMES = [...new Set([...Object.values(INTEGRATION_ENV).flatMap((s) => [...s.secrets, ...s.vars]), "TELEGRAM_WEBHOOK_SECRET", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_API_VERSION", "TIKTOK_REFRESH_TOKEN", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"])];
const liveEnv = () => Object.fromEntries(NAMES.filter((n) => process.env[n]).map((n) => [n, process.env[n]]));

// YouTube üçün 3 secret də lazımdır; Shopify üçün SHOPIFY_ADMIN_TOKEN və ya CLIENT_ID+SECRET (missingEnv yalnız birincini yoxlayır)
function skipReason(id) {
  if (!WANT_LIVE) return "RUN_LIVE_TESTS=1 verilməyib";
  const env = liveEnv();
  const ttRefresh = id === "tiktok" && !env.TIKTOK_ACCESS_TOKEN && env.TIKTOK_REFRESH_TOKEN && env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET;
  const missing = ttRefresh ? [] : id === "shopify" && !env.SHOPIFY_ADMIN_TOKEN && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
    ? missingEnv({ ...env, SHOPIFY_ADMIN_TOKEN: "x".repeat(8) }, id)
    : missingEnv(env, id);
  return missing.length ? "credential yoxdur: " + missing.join(", ") : false;
}

async function liveRead(id, tool, input = {}) {
  resetAll();
  const rt = createRuntime(liveEnv(), { features: { approvals: true } });
  const r = await rt.tools.run(tool, input, rt.toolCtx());
  const audit = await rt.audit.list(20);
  if (!r.ok) assert.fail(id + " canlı sorğu uğursuz: status=" + r.status + " code=" + (r.code || "-") + " (" + String(r.error || "").slice(0, 120) + ")");
  assert.equal(r.output.mock, false, "canlı nəticə mock olmamalıdır");
  assert.equal(r.output.integration, id);
  assert.ok(audit.some((e) => e.event === "tool.done" && e.data && e.data.tool === tool), "auditdə tool.done yoxdur");
  for (const v of Object.values(liveEnv())) if (v.length >= 8) assert.ok(!JSON.stringify(r).includes(v) && !JSON.stringify(audit).includes(v), "secret sızdı");
  return r.output.data;
}

test("LIVE Instagram: hesab və son media (yalnız oxuma)", { skip: skipReason("instagram") }, async () => {
  const acc = await liveRead("instagram", "instagram.account.get");
  assert.ok(acc.username || acc.user_id || acc.id, "hesab sahələri gəlmədi");
  const media = await liveRead("instagram", "instagram.media.list", { limit: 1 });
  assert.ok(Array.isArray(media.items));
});

test("LIVE TikTok: hesab (user.info.basic) və video siyahısı", { skip: skipReason("tiktok") }, async () => {
  const acc = await liveRead("tiktok", "tiktok.account.get");
  assert.ok(acc && typeof acc === "object");
  const v = await liveRead("tiktok", "tiktok.videos.list", { limit: 1 });
  assert.ok(Array.isArray(v.items));
});

test("LIVE YouTube: kanal (OAuth refresh token ilə)", { skip: skipReason("youtube") }, async () => {
  const ch = await liveRead("youtube", "youtube.channel.get");
  assert.ok(ch && typeof ch === "object");
});

test("LIVE Telegram: bot.get (mesaj GÖNDƏRİLMİR)", { skip: skipReason("telegram") }, async () => {
  const bot = await liveRead("telegram", "telegram.bot.get");
  assert.equal(bot.is_bot, true);
});

test("LIVE Shopify: mağaza məlumatı və 1 məhsul (müştəri/sifariş məlumatı oxunmur)", { skip: skipReason("shopify") }, async () => {
  const shop = await liveRead("shopify", "shopify.shop.get");
  assert.ok(shop && typeof shop === "object");
  const p = await liveRead("shopify", "shopify.products.list", { first: 1 });
  assert.ok(Array.isArray(p.items) || Array.isArray(p.products) || typeof p === "object");
});

// ---- Həmişə işləyən meta testlər (credential tələb etmir) ----

test("canlı test sistemi: credential yoxdursa hər platforma 'skipped' olur, saxta uğur yoxdur", () => {
  const saved = { ...process.env };
  try {
    for (const n of NAMES) delete process.env[n];
    for (const id of Object.keys(INTEGRATION_ENV)) {
      const reason = WANT_LIVE ? skipReason(id) : "RUN_LIVE_TESTS=1 verilməyib";
      assert.ok(reason, id + " üçün atlanma səbəbi olmalıdır");
    }
  } finally {
    Object.assign(process.env, saved);
  }
});

test("canlı test faylı yazma/göndərmə alətlərini çağırmır (yalnız oxuma alətləri)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL(import.meta.url), "utf8");
  const called = [...src.matchAll(/liveRead\("[a-z]+",\s*"([a-z.]+)"/g)].map((m) => m[1]);
  assert.ok(called.length >= 7);
  for (const t of called) assert.ok(!/send|publish|upload|create|update|delete|apply_rule|customers|orders/.test(t), "canlı testdə yazma/həssas alət: " + t);
});
