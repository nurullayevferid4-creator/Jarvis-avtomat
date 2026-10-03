// JARVIS Voice Hub: Cloudflare Worker giriş nöqtəsi.
// Sirlər (Secrets): ANTHROPIC_API_KEY, OPENAI_API_KEY, PASSCODE.
// İstəyə bağlı: KV (JARVIS_KV), CLAUDE_MODEL, OPENAI_MODEL, OPENAI_WEB_SEARCH_TOOL, TTS_VOICE,
// limitlər (MAX_SUBTASKS, MAX_MODEL_CALLS, MAX_RETRIES, CALL_TIMEOUT_SECONDS,
// LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS), bayraqlar (FEATURE_VOICE, FEATURE_APPROVALS,
// FEATURE_KNOWLEDGE). Bax: .env.example

import { PAGE } from "./ui/page.js";
import { json } from "./util.js";
import { getLimits, getFeatures, DEFAULTS, VERSION } from "./config.js";
import { createRegistry } from "./adapters/registry.js";
import { stt, tts } from "./adapters/openaiAudio.js";
import { ClaudeOrchestrator } from "./orchestrator/ClaudeOrchestrator.js";
import { createStore } from "./state/store.js";
import { safeEqual, isBlocked, recordFailure, clearFailures } from "./guards/login.js";
import { createAudit } from "./audit/log.js";
import { ApprovalCenter } from "./approval/center.js";
import { KnowledgeBase } from "./knowledge/KnowledgeBase.js";
import { createDefaultToolRegistry } from "./tools/builtin.js";

const MAX_BODY_BYTES = 20000;

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
function statusInfo(env, limits, features, tools) {
  return {
    version: VERSION,
    storage: env.JARVIS_KV ? "kv" : "memory",
    secrets: { ANTHROPIC_API_KEY: !!env.ANTHROPIC_API_KEY, OPENAI_API_KEY: !!env.OPENAI_API_KEY, PASSCODE: !!env.PASSCODE },
    models: { claude: env.CLAUDE_MODEL || DEFAULTS.claudeModel, openai: env.OPENAI_MODEL || DEFAULTS.openaiModel },
    features,
    limits: {
      maxSubtasks: limits.maxSubtasks,
      maxModelCalls: limits.maxModelCalls,
      callTimeoutSeconds: Math.round(limits.callTimeoutMs / 1000),
      loginMaxFailures: limits.loginMaxFailures,
      loginWindowSeconds: limits.loginWindowSeconds,
    },
    tools,
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
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
    if (!safeEqual(req.headers.get("x-passcode"), env.PASSCODE)) {
      await recordFailure(env, ip, limits);
      return json({ error: "Parol səhvdir." }, 401);
    }
    await clearFailures(env, ip);

    const features = getFeatures(env);
    const store = createStore(env);
    const audit = createAudit(store);
    const approvals = new ApprovalCenter(store, audit);
    const knowledge = new KnowledgeBase(store, audit);

    // Model açarı tələb etməyən yollar: açar çatışmasa da vəziyyəti görmək olsun
    if (req.method === "GET" && url.pathname === "/api/status") {
      return json(statusInfo(env, limits, features, createDefaultToolRegistry({ audit, approvals }).list()));
    }

    if (url.pathname === "/api/audit" && req.method === "GET") {
      return json({ events: await audit.list(parseInt(url.searchParams.get("limit") || "30", 10) || 30) });
    }

    if (features.approvals && url.pathname === "/api/approvals" && req.method === "GET") {
      const status = url.searchParams.get("status") || undefined;
      return json({ approvals: await approvals.list({ status }) });
    }
    const apMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
    if (features.approvals && apMatch && req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json({ error: "Sorğu gövdəsi düzgün deyil." }, 400);
      const r = await approvals.decide(apMatch[1], { decision: body.decision, content: body.content });
      if (r.ok) return json({ record: r.record });
      const code = r.error === "not_found" ? 404 : r.error === "already_decided" || r.error === "expired" ? 409 : 400;
      return json({ error: r.error }, code);
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
        const orchestrator = new ClaudeOrchestrator({ env, registry: createRegistry(env), limits, store, approvals: features.approvals ? approvals : null });
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
