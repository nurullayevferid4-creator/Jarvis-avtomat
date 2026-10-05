// JARVIS Voice Hub: Cloudflare Worker giriş nöqtəsi.
// Sirlər (Secrets): ANTHROPIC_API_KEY, OPENAI_API_KEY, PASSCODE.
// İstəyə bağlı: KV (JARVIS_KV), CLAUDE_MODEL, OPENAI_MODEL, OPENAI_WEB_SEARCH_TOOL, TTS_VOICE,
// limitlər (MAX_SUBTASKS, MAX_MODEL_CALLS, MAX_RETRIES, CALL_TIMEOUT_SECONDS,
// LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS), bayraqlar (FEATURE_VOICE, FEATURE_APPROVALS,
// FEATURE_KNOWLEDGE, FEATURE_TOOLS, FEATURE_LEARNING), inteqrasiya adları (bax .env.example və docs/WIRING.md).

import { PAGE } from "./ui/page.js";
import { json } from "./util.js";
import { getLimits, getFeatures, DEFAULTS, VERSION } from "./config.js";
import { createRegistry } from "./adapters/registry.js";
import { stt, tts } from "./adapters/openaiAudio.js";
import { ClaudeOrchestrator } from "./orchestrator/ClaudeOrchestrator.js";
import { safeEqual, readPasscode, isBlocked, recordFailure, clearFailures } from "./guards/login.js";
import { ApprovalCenter } from "./approval/center.js";
import { createRuntime } from "./wiring.js";
import { handleTelegramWebhook } from "./telegram/webhook.js";
import { describeStorage } from "./storage/index.js";

const MAX_BODY_BYTES = 20000;
const MAX_EXEC_OUTPUT_CHARS = 4000;
// /api/integrations/<id>/probe: hər platforma üçün YALNIZ OXUMA sınaq əməliyyatı
const PROBE_TOOL = { instagram: "instagram.account.get", tiktok: "tiktok.account.get", youtube: "youtube.channel.get", telegram: "telegram.bot.get", shopify: "shopify.shop.get" };

// Kiçik JSON gövdəsini oxuyur. Pozulmuş və ya çox böyük olarsa null qaytarır.
async function readJson(req) {
  const len = parseInt(req.headers.get("content-length") || "0", 10);
  if (len > MAX_BODY_BYTES) return null;
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch (e) {
    return null;
  }
}

// Sistem vəziyyəti. Açarların YALNIZ təyin olunub-olunmadığı göstərilir, dəyərləri heç vaxt.
function statusInfo(env, limits, features, tools, rt) {
  return {
    version: VERSION,
    storage: env.JARVIS_KV ? "kv" : "memory",
    storageDetail: describeStorage(env),
    secrets: { ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY, OPENAI_API_KEY: !!env.OPENAI_API_KEY, PASSCODE: !!env.PASSCODE },
    models: { claude: env.CLAUDE_MODEL || DEFAULTS.claudeModel, openai: env.OPENAI_MODEL || DEFAULTS.openaiModel },
    features: { ...features, ...rt.wiring },
    limits: {
      maxSubtasks: limits.maxSubtasks,
      maxModelCalls: limits.maxModelCalls,
      callTimeoutSeconds: Math.round(limits.callTimeoutMs / 1000),
      loginMaxFailures: limits.loginMaxFailures,
      loginWindowSeconds: limits.loginWindowSeconds,
    },
    tools,
    integrations: rt.integrations.statuses(), // yalnız adlar və true/false
    telegramWebhook: !!env.TELEGRAM_WEBHOOK_SECRET,
  };
}

// Təsdiq qeydinin UI görünüşü: alət haqqında risk/icazə məlumatı əlavə olunur (giriş mətni UI-da yalnız textContent ilə göstərilir).
function approvalView(rec, tools) {
  if (!ApprovalCenter.isToolCall(rec)) return rec;
  const t = tools.describe(rec.tool);
  const { input_hash, ...rest } = rec; // eslint-disable-line no-unused-vars
  return { ...rest, tool_info: t ? { description: t.description, permissions: t.permissions, risk: t.risk } : null };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }

    // Telegram webhook: parol yox, webhook secret ilə autentifikasiya olunur (bax src/telegram/webhook.js)
    if (url.pathname === "/telegram/webhook") {
      const features = getFeatures(env);
      const rt = createRuntime(env, { features });
      return await handleTelegramWebhook(req, env, rt, {
        waitUntil: ctx && typeof ctx.waitUntil === "function" ? (p) => ctx.waitUntil(p) : undefined,
        handleText: async (text) => {
          if (!env.ANTHROPIC_API_KEY || !env.OPENAI_API_KEY) return { spoken: "ANTHROPIC_API_KEY və ya OPENAI_API_KEY təyin edilməyib.", screen: "", status: "blocked" };
          const limits = getLimits(env);
          const orchestrator = new ClaudeOrchestrator({ env, registry: createRegistry(env), limits, store: rt.store, approvals: features.approvals ? rt.approvals : null, tools: rt.wiring.tools ? { registry: rt.tools, ctx: rt.toolCtx(), knowledge: features.knowledge, learning: rt.wiring.learning } : null });
          return await orchestrator.handle(text);
        },
      });
    }

    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    if (!env.PASSCODE) return json({ error: "PASSCODE təyin edilməyib. Worker-in Secrets bölməsinə PASSCODE əlavə et." }, 500);

    const limits = getLimits(env);
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    if (await isBlocked(env, ip, limits)) {
      return json(
        { error: "Çox sayda səhv parol cəhdi. Bir az sonra yenidən yoxla." },
        429,
        { "retry-after": String(limits.loginWindowSeconds) },
      );
    }
    if (!safeEqual(readPasscode(req), env.PASSCODE)) {
      await recordFailure(env, ip, limits);
      return json({ error: "Parol səhvdir." }, 401);
    }
    await clearFailures(env, ip);

    const features = getFeatures(env);
    const rt = createRuntime(env, { features });
    const { store, audit, approvals, knowledge } = rt;

    // Model açarı tələb etməyən yollar: açar çatışmasa da vəziyyəti görmək olsun
    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(statusInfo(env, limits, features, rt.tools.list(), rt));
    }

    if (url.pathname === "/api/audit" && req.method === "GET") {
      return json({ events: await audit.list(parseInt(url.searchParams.get("limit") || "30", 10) || 30) });
    }

    // Platforma vəziyyəti (yalnız adlar və true/false) və YALNIZ OXUMA sınağı (credential yoxdursa "skipped")
    if (req.method === "GET" && url.pathname === "/api/integrations") return json({ integrations: rt.integrations.statuses() });
    const probe = url.pathname.match(/^\/api\/integrations\/([a-z]+)\/probe$/);
    if (probe && req.method === "POST") {
      const id = probe[1];
      const toolName = Object.prototype.hasOwnProperty.call(PROBE_TOOL, id) ? PROBE_TOOL[id] : null;
      if (!toolName) return json({ error: "naməlum inteqrasiya" }, 404);
      const st = rt.integrations.get(id).status();
      if (!st.configured) {
        await audit.log("integration.probe", { id, result: "skipped" });
        return json({ id, status: "skipped", reason: "not_configured", missing: st.missing });
      }
      const r = await rt.tools.run(toolName, {}, rt.toolCtx());
      await audit.log("integration.probe", { id, result: r.ok ? "ok" : r.status, code: r.code || null });
      if (r.ok) return json({ id, status: "ok", mock: r.output.mock, data_keys: Object.keys(r.output.data || {}).slice(0, 20) });
      return json({ id, status: "error", error: String(r.error || r.status).slice(0, 200), code: r.code || null }, 502);
    }

    if (features.approvals && url.pathname === "/api/approvals" && req.method === "GET") {
      const status = url.searchParams.get("status") || undefined;
      return json({ approvals: (await approvals.list({ status })).map((a) => approvalView(a, rt.tools)) });
    }
    const apMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
    if (features.approvals && apMatch && req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json({ error: "Sorğu gövdəsi düzgün deyil." }, 400);
      // via:"api": qərar yalnız parol qorumalı bu yoldan verilir. Alət çağırışı qeydləri başqa yolla təsdiqlənə bilməz.
      const r = await approvals.decide(apMatch[1], { decision: body.decision, content: body.content, via: "api" });
      if (!r.ok) {
        const code = r.error === "not_found" ? 404 : r.error === "already_decided" || r.error === "expired" ? 409 : r.error === "api_required" ? 403 : 400;
        return json({ error: r.error }, code);
      }
      // Təsdiq -> icazənin təkrar yoxlanması -> icra -> audit -> nəticə. Rədd edilən qeyd heç vaxt icra olunmur.
      if (body.decision === "approve" && ApprovalCenter.isToolCall(r.record)) {
        const ex = await rt.executor.executeApproved(apMatch[1]);
        const out = ex.output === undefined ? undefined : JSON.stringify(ex.output).slice(0, MAX_EXEC_OUTPUT_CHARS);
        return json({ record: approvalView(ex.record || r.record, rt.tools), execution: { ok: ex.ok, status: ex.status, error: ex.error || null, output: out } });
      }
      return json({ record: approvalView(r.record, rt.tools) });
    }

    if (features.knowledge && url.pathname === "/api/knowledge") {
      if (req.method === "GET") {
        const q = url.searchParams.get("q") || "";
        return json({ items: await knowledge.search(q, { limit: parseInt(url.searchParams.get("limit") || "5", 10) || 5, type: url.searchParams.get("type") || undefined }) });
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        if (!body) return json({ error: "Sorğu gövdəsi düzgün deyil." }, 400);
        const r = await knowledge.add(body);
        return json(r.ok ? { status: r.status, id: r.id } : { error: r.error }, r.ok ? 200 : 400);
      }
    }

    if (!env.ANTHROPIC_API_KEY || !env.OPENAI_API_KEY) return json({ error: "ANTHROPIC_API_KEY və ya OPENAI_API_KEY təyin edilməyib." }, 500);

    if (req.method === "GET" && url.pathname === "/api/jobs") return json({ jobs: await store.listJobs() });

    if (req.method === "POST" && url.pathname === "/api/talk") {
      let text = "";
      try {
        const ct = req.headers.get("content-type") || "";
        if (ct.includes("multipart/form-data")) {
          const fd = await req.formData();
          const f = fd.get("audio");
          if (f && typeof f !== "string" && f.size > 0) {
            if (!features.voice) return json({ error: "Səs söndürülüb (FEATURE_VOICE=0). Yazı ilə yaz." }, 400);
            text = await stt(env, f, limits.callTimeoutMs);
          } else text = String(fd.get("text") || "");
        } else {
          const b = await req.json();
          text = String(b.text || "");
        }
      } catch (e) {
        return json({ error: String((e && e.message) || e).slice(0, 300) }, 502);
      }
      text = text.trim();
      if (!text) return json({ error: "Səs və ya mətn boşdur." }, 400);

      let result;
      try {
        const orchestrator = new ClaudeOrchestrator({
          env,
          registry: createRegistry(env),
          limits,
          store,
          approvals: features.approvals ? approvals : null,
          tools: rt.wiring.tools ? { registry: rt.tools, ctx: rt.toolCtx(), knowledge: features.knowledge, learning: rt.wiring.learning } : null,
        });
        result = await orchestrator.handle(text);
      } catch (e) {
        const msg = String((e && e.message) || e).slice(0, 300);
        result = { status: "blocked", spoken: "Xəta baş verdi. Təfərrüat ekranda yazılıb.", screen: msg, tasks: [] };
      }
      await audit.log("talk", { status: result.status, chars: text.length, tasks: (result.tasks || []).length });
      let audio = null;
      if (features.voice) {
        try { audio = await tts(env, result.spoken, limits.callTimeoutMs); } catch (e) { result.tts_error = String((e && e.message) || e).slice(0, 200); }
      }
      return json({ transcript: text, ...result, audio });
    }
    return new Response("Not found", { status: 404 });
  },
};
