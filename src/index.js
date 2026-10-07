// JARVIS Voice Hub: Cloudflare Worker giriş nöqtəsi.
// Sirlər (Secrets): ANTHROPIC_API_KEY, OPENAI_API_KEY, PASSCODE (+ sosial platforma sirləri, bax SOCIAL.md).
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
import { buildContext } from "./app/context.js";
import { safeEqual, readPasscode, isBlocked, recordFailure, clearFailures } from "./guards/login.js";
import { createDefaultToolRegistry } from "./tools/builtin.js";
import { beginOAuth, finishOAuth, OAUTH_PLATFORMS } from "./social/oauth.js";
import { MEDIA_TYPES, MAX_MEDIA_BYTES } from "./social/media.js";
import { SocialError } from "./social/errors.js";
import { createTelegramHandler, verifyWebhook } from "./telegram/handler.js";

const MAX_BODY_BYTES = 20000;
// Parolla daxil olan istifadəçi (sahib). Telegram çatları handler-də öz çat id-si ilə təqdim olunur.
const UI_ACTOR = { channel: "ui" };

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
    // Yalnız "təyin olunub/olunmayıb" göstərilir, dəyərlər heç vaxt.
    social: {
      public_base_url: !!env.PUBLIC_BASE_URL,
      media_store: !!env.JARVIS_MEDIA,
      media_signing_key: !!env.MEDIA_SIGNING_KEY,
      token_encryption: !!env.TOKEN_ENC_KEY,
      telegram: { bot_token: !!env.TELEGRAM_BOT_TOKEN, webhook_secret: !!env.TELEGRAM_WEBHOOK_SECRET, allowed_chat_ids: !!env.TELEGRAM_ALLOWED_CHAT_IDS, channel_id: !!env.TELEGRAM_CHANNEL_ID },
      instagram: { app_id: !!env.INSTAGRAM_APP_ID, app_secret: !!env.INSTAGRAM_APP_SECRET },
      tiktok: { client_key: !!env.TIKTOK_CLIENT_KEY, client_secret: !!env.TIKTOK_CLIENT_SECRET },
      youtube: { client_id: !!env.GOOGLE_CLIENT_ID, client_secret: !!env.GOOGLE_CLIENT_SECRET },
    },
  };
}

function socialErrorResponse(e) {
  const err = e instanceof SocialError ? e : null;
  if (!err) return json({ error: "api_error", message: String((e && e.message) || e).slice(0, 200) }, 502);
  const code = err.code === "invalid_request" || err.code === "media_error" ? 400 : err.code === "not_connected" || err.code === "token_expired" ? 409 : err.code === "permission_denied" ? 403 : 502;
  return json({ error: err.code, message: err.message, platform: err.platform }, code);
}

function oauthPage(ok, message) {
  const esc = String(message).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
  return new Response("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>JARVIS</title><body style='font-family:system-ui;padding:2rem;background:#0b1220;color:#e6edf7'><h2>" + (ok ? "Qoşuldu ✅" : "Qoşulma alınmadı ❌") + "</h2><p>" + esc + "</p></body>", {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "referrer-policy": "no-referrer" },
  });
}

// Bütün sosial komponentləri bir yerdə qurur
function buildSocial(env) {
  return buildContext(env);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }

    // --- İctimai marşrutlar (parol yoxdur, hər biri öz üsulu ilə qorunur) ---

    // Telegram webhook: yalnız doğru secret başlığı ilə. Sonra göndərən icazə siyahısında olmalıdır.
    if (req.method === "POST" && url.pathname === "/telegram/webhook") {
      if (!verifyWebhook(req, env)) return new Response("forbidden", { status: 403 });
      const len = parseInt(req.headers.get("content-length") || "0", 10);
      if (len > 200000) return new Response("too large", { status: 413 });
      let update = null;
      try { update = await req.json(); } catch (e) { return new Response("bad request", { status: 400 }); }
      const d = buildSocial(env);
      const limits = getLimits(env);
      const features = getFeatures(env);
      const runChat = async (text) => {
        if (!env.ANTHROPIC_API_KEY || !env.OPENAI_API_KEY) throw new Error("ANTHROPIC_API_KEY və ya OPENAI_API_KEY təyin edilməyib");
        const orchestrator = new ClaudeOrchestrator({ env, registry: createRegistry(env), limits, store: d.store, approvals: features.approvals ? d.approvals : null });
        return await orchestrator.handle(text);
      };
      const handler = createTelegramHandler({ env, hub: d.hub, flow: d.flow, approvals: d.approvals, store: d.store, audit: d.audit, runChat, runner: d.runner });
      const work = handler.handleUpdate(update).catch(() => null);
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
      else await work;
      return new Response("ok", { status: 200 });
    }

    // OAuth callback: doğru bir dəfəlik state olmadan heç nə etmir.
    const oaMatch = url.pathname.match(/^\/oauth\/([a-z]+)\/callback$/);
    if (req.method === "GET" && oaMatch && OAUTH_PLATFORMS.includes(oaMatch[1])) {
      const d = buildSocial(env);
      const r = await finishOAuth({ hub: d.hub, store: d.store, env, platform: oaMatch[1], params: url.searchParams });
      if (r.ok) await d.audit.log("social.connected", { platform: oaMatch[1] });
      return oauthPage(r.ok, r.message);
    }

    // İmzalı müvəqqəti media ünvanı (Instagram mediyanı buradan çəkir)
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/media/")) {
      const d = buildSocial(env);
      const v = await d.hub.media.verify(url.pathname, url.searchParams);
      if (!v.ok) return new Response("Not found", { status: 404 });
      const obj = await d.hub.media.stream(v.id);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = { "content-type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream", "content-length": String(obj.size), "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
      return new Response(req.method === "HEAD" ? null : obj.body, { status: 200, headers });
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
    const { store, audit, approvals, knowledge } = buildContext(env);

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
      const peek = body.decision === "approve" ? await approvals.get(apMatch[1]) : null;
      if (peek && peek.kind === "social.publish") {
        // Sosial paylaşım: təsdiq + iş yaradılması + icra (hash yoxlanır, hər addım bir dəfə)
        const d = buildSocial(env);
        const a = await d.flow.approveAndStart(apMatch[1], { actor: UI_ACTOR });
        if (!a.ok) return json({ error: a.error }, a.error === "not_found" ? 404 : a.error === "already_decided" || a.error === "expired" ? 409 : 400);
        const job = await d.flow.advance(apMatch[1], { deadlineMs: 20000 });
        return json({ record: (await approvals.get(apMatch[1])) || a.record, job: job || a.job });
      }
      const r = await approvals.decide(apMatch[1], { decision: body.decision, content: body.content, actor: UI_ACTOR });
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

    // --- Sosial platformalar (parol tələb olunur) ---
    if (url.pathname.startsWith("/api/social/") || url.pathname === "/api/media" || url.pathname === "/api/telegram/setup") {
      const d = buildSocial(env);
      try {
        if (req.method === "GET" && url.pathname === "/api/social/status") {
          return json(await d.flow.panel({ verify: url.searchParams.get("verify") === "1" }));
        }
        if (req.method === "GET" && url.pathname === "/api/social/jobs") return json({ jobs: await d.flow.listJobs() });
        const adv = url.pathname.match(/^\/api\/social\/jobs\/([^/]+)\/advance$/);
        if (req.method === "POST" && adv) {
          const job = await d.flow.advance(adv[1], { deadlineMs: 20000 });
          return job ? json({ job }) : json({ error: "not_found" }, 404);
        }
        const conn = url.pathname.match(/^\/api\/social\/([a-z]+)\/connect$/);
        if (req.method === "POST" && conn) {
          const r = await beginOAuth({ hub: d.hub, store: d.store, env, platform: conn[1] });
          return json({ url: r.url, redirect_uri: r.redirect_uri });
        }
        if (req.method === "POST" && url.pathname === "/api/social/draft") {
          const body = await readJson(req);
          if (!body) return json({ error: "Sorğu gövdəsi düzgün deyil." }, 400);
          const rec = await d.flow.createDraft(body, { source: "ui" });
          return json({ approval: rec });
        }
        if (req.method === "POST" && url.pathname === "/api/media") {
          const ct = String(req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
          if (!MEDIA_TYPES[ct]) return json({ error: "invalid_request", message: "content-type image/jpeg, image/png, video/mp4 və ya video/quicktime olmalıdır" }, 400);
          const len = parseInt(req.headers.get("content-length") || "0", 10);
          if (len > MAX_MEDIA_BYTES) return json({ error: "invalid_request", message: "fayl 64 MB-dan böyükdür" }, 413);
          const bytes = await req.arrayBuffer();
          const m = await d.hub.media.put(bytes, ct);
          await d.audit.log("social.media_uploaded", { id: m.id, type: m.type, size: m.size });
          return json({ media: m });
        }
        if (req.method === "POST" && url.pathname === "/api/telegram/setup") {
          const base = String(env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
          if (!/^https:\/\/[^\s/]+$/.test(base)) return json({ error: "not_connected", message: "PUBLIC_BASE_URL (https://...) təyin edilməyib" }, 409);
          await d.hub.adapter("telegram").setWebhook(base + "/telegram/webhook");
          await d.audit.log("telegram.webhook_set", {});
          return json({ ok: true, webhook: base + "/telegram/webhook" });
        }
      } catch (e) {
        return socialErrorResponse(e);
      }
      return new Response("Not found", { status: 404 });
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

  // Cron (wrangler.toml): gözləyən paylaşım işlərini irəlilədir və Instagram tokenini vaxtında yeniləyir.
  async scheduled(event, env, ctx) {
    const d = buildSocial(env);
    const work = d.flow.tick({ deadlineMs: 25000 }).catch(() => null);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
    else await work;
  },
};
