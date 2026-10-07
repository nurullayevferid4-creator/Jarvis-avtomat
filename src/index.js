// JARVIS Voice Hub: Cloudflare Worker giriş nöqtəsi.
// Sirlər (Secrets): ANTHROPIC_API_KEY, OPENAI_API_KEY, PASSCODE (+ sosial platforma sirləri, bax SOCIAL.md).
// İstəyə bağlı: KV (JARVIS_KV), CLAUDE_MODEL, OPENAI_MODEL, OPENAI_WEB_SEARCH_TOOL, TTS_VOICE,
// limitlər (MAX_SUBTASKS, MAX_MODEL_CALLS, MAX_RETRIES, CALL_TIMEOUT_SECONDS,
// LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS), bayraqlar (FEATURE_VOICE, FEATURE_APPROVALS,
// FEATURE_KNOWLEDGE). Bax: .env.example

import { renderPage, pageCsp } from "./ui/page.js";
import { json } from "./util.js";
import { getLimits, getFeatures, DEFAULTS, VERSION } from "./config.js";
import { createRegistry } from "./adapters/registry.js";
import { stt, tts } from "./adapters/openaiAudio.js";
import { ClaudeOrchestrator } from "./orchestrator/ClaudeOrchestrator.js";
import { buildContext } from "./app/context.js";
import { safeEqual, readPasscode, failureCount, recordFailure, clearFailures } from "./guards/login.js";
import { createDefaultToolRegistry } from "./tools/builtin.js";
import { beginOAuth, finishOAuth, OAUTH_PLATFORMS } from "./social/oauth.js";
import { publicJob } from "./media/jobs.js";
import { UPLOAD_TYPES } from "./media/library.js";
import { SocialError } from "./social/errors.js";
import { createTelegramHandler, verifyWebhook } from "./telegram/handler.js";
import { handleShopifyPublicRoute, handleShopifyApiRoute } from "./shopify/index.js";
import { OWNER_PERMISSIONS } from "./policy.js";
import { checkAudioFile, parseVoiceCommand, speakable } from "./voice/command.js";
import { AppError, publicError, toAppError } from "./errors.js";

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
function statusInfo(env, limits, features, tools, extra = {}) {
  return {
    ...extra,
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
    tools: tools.map((t) => ({ name: t.name, description: t.description, risk: t.risk, requiresApproval: t.requiresApproval, executable: t.executable, permissions: t.permissions })),
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
  if (e instanceof AppError || (e && e.name !== "SocialError")) {
    const a = toAppError(e, "api");
    return json({ error: a.code, message: a.toPublic().message, retryable: a.retryable }, a.httpStatus >= 400 ? a.httpStatus : 502);
  }
  const err = e instanceof SocialError ? e : null;
  if (!err) return json({ error: "api_error", message: "Xəta baş verdi" }, 502);
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

// Təhlükəsizlik başlıqları: bütün cavablara əlavə olunur (mövcud başlıq varsa toxunulmur).
function secure(res) {
  const h = new Headers(res.headers);
  const set = (k, v) => { if (!h.has(k)) h.set(k, v); };
  set("x-content-type-options", "nosniff");
  set("referrer-policy", "no-referrer");
  set("x-frame-options", "DENY");
  set("cross-origin-resource-policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  // Gözlənilməyən xəta stack və ya daxili mətn göstərmir: yalnız vahid kod.
  async fetch(req, env, ctx) {
    try {
      return secure(await this.handle(req, env, ctx));
    } catch (e) {
      const err = toAppError(e, "worker");
      try { await buildContext(env).audit.log("worker.unhandled", { code: err.code, detail: err.detail || undefined }); } catch (x) { /* jurnal yazıla bilməsə də cavab verilir */ }
      return secure(json({ error: err.code, message: err.toPublic().message }, err.httpStatus >= 400 ? err.httpStatus : 500));
    }
  },

  async handle(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      return new Response(renderPage(nonce), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": pageCsp(nonce) } });
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
      const runChat = async (text, origin) => {
        if (!env.ANTHROPIC_API_KEY || !env.OPENAI_API_KEY) throw new AppError("AUTH_ERROR", "ANTHROPIC_API_KEY və ya OPENAI_API_KEY təyin edilməyib", { source: "chat" });
        const orchestrator = new ClaudeOrchestrator({ env, registry: createRegistry(env), limits, store: d.store, approvals: features.approvals ? d.approvals : null, tools: features.approvals ? d.tools : null });
        return await orchestrator.handle(text, { origin });
      };
      const handler = createTelegramHandler({ env, hub: d.hub, flow: d.flow, approvals: d.approvals, store: d.store, audit: d.audit, runChat, runner: d.runner, library: d.library });
      const work = handler.handleUpdate(update).catch(() => null);
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
      else await work;
      return new Response("ok", { status: 200 });
    }

    // Shopify: OAuth callback (HMAC + state) və webhook (HMAC). İkisi də imza olmadan heç nə etmir.
    if ((url.pathname === "/oauth/shopify/callback" && req.method === "GET") || (url.pathname === "/shopify/webhook" && req.method === "POST")) {
      const c = buildContext(env);
      const r = await handleShopifyPublicRoute(req, c.shopify.ctx);
      if (r) return r;
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
    const priorFailures = await failureCount(env, ip);
    if (priorFailures >= limits.loginMaxFailures) {
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
    // Hər sorğuda KV yazısı etməmək üçün yalnız əvvəl səhv cəhd olubsa təmizlənir
    if (priorFailures > 0) await clearFailures(env, ip);

    const features = getFeatures(env);
    const { store, audit, approvals, knowledge } = buildContext(env);

    // Model açarı tələb etməyən yollar: açar çatışmasa da vəziyyəti görmək olsun
    if (req.method === "GET" && url.pathname === "/api/status") {
      const c = buildContext(env);
      return json(statusInfo(env, limits, features, c.tools.list(), {
        coordinator: c.coord.kind === "durable_object" ? "durable_object" : "memory (tək nüsxə daxilində; Durable Object bağlanmayıb)",
        providers: c.providers.status(),
        shopify: { configured: !!(env.SHOPIFY_API_KEY && env.SHOPIFY_API_SECRET) },
      }));
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
      if (peek && peek.kind && peek.kind !== "social.publish") {
        // Strukturlu alət qeydi: təsdiq + bir dəfəlik icra (ActionRunner)
        const c = buildContext(env);
        const x = await c.runner.approveAndExecute(apMatch[1], { actor: UI_ACTOR });
        const st = x.ok ? 200 : x.status === "unknown" ? 202 : x.error && x.error.code === "NOT_FOUND" ? 404 : x.error && x.error.code === "CONFLICT" ? 409 : x.error && x.error.code === "PERMISSION_ERROR" ? 403 : 400;
        return json({ status: x.status, output: x.output, error: x.error, note: x.note, record: await approvals.get(apMatch[1]) }, st);
      }
      const r = await approvals.decide(apMatch[1], { decision: body.decision, content: body.content, actor: UI_ACTOR });
      if (r.ok) return json({ record: r.record });
      const code = r.error === "not_found" ? 404 : r.error === "already_decided" || r.error === "expired" ? 409 : 400;
      return json({ error: r.error }, code);
    }

    if (url.pathname.startsWith("/api/shopify/")) {
      const c = buildContext(env);
      const r = await handleShopifyApiRoute(req, c.shopify.ctx, url);
      if (r) return r;
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/api/tools" && req.method === "GET") {
      const c = buildContext(env);
      return json({ tools: c.tools.list().map((t) => ({ name: t.name, description: t.description, risk: t.risk, requiresApproval: t.requiresApproval, executable: t.executable, permissions: t.permissions, timeoutMs: t.timeoutMs, inputSchema: t.inputSchema })) });
    }
    // Alət çağırışı (parollu sahib): təsdiq tələb edən alət icra olunmur, təsdiq qeydi açılır.
    if (url.pathname === "/api/tools/run" && req.method === "POST") {
      const body = await readJson(req);
      if (!body || typeof body.tool !== "string") return json({ error: "VALIDATION_ERROR", message: "tool adı lazımdır" }, 400);
      const c = buildContext(env);
      // Təsdiq mərkəzi söndürülübsə təsdiq tələb edən alətlər açılmır (qeyd yığılıb heç vaxt baxılmasın)
      if (!features.approvals && c.tools.list().some((t) => t.name === body.tool && t.requiresApproval)) return json({ error: "PERMISSION_ERROR", message: "Təsdiq mərkəzi söndürülüb (FEATURE_APPROVALS=0): bu alət istifadə edilə bilməz" }, 403);
      const r = await c.tools.run(body.tool, body.input && typeof body.input === "object" ? body.input : {}, { approvals: c.approvals, origin: UI_ACTOR, source: "api", permissions: OWNER_PERMISSIONS });
      const status = r.status === "done" ? 200 : r.status === "pending_approval" ? 202 : r.status === "not_found" ? 404 : r.status === "invalid_input" || r.status === "invalid_output" ? 400 : r.status === "denied" ? 403 : r.status === "timeout" ? 504 : 502;
      return json({ status: r.status, output: r.output, approval_id: r.approval_id, errors: r.errors, error: r.error ? String(r.error).slice(0, 300) : undefined, error_code: r.error_code }, status);
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
    if (url.pathname.startsWith("/api/social/") || url.pathname === "/api/media" || url.pathname.startsWith("/api/media/") || url.pathname === "/api/telegram/setup") {
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
        // Yükləmə: fayl R2-yə AXINLA yazılır, sonra real növ və video analizi yoxlanır
        if (req.method === "POST" && url.pathname === "/api/media") {
          const ct = String(req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
          const len = parseInt(req.headers.get("content-length") || "0", 10);
          if (!UPLOAD_TYPES[ct]) return json({ error: "VALIDATION_ERROR", message: "Fayl növü dəstəklənmir. İcazəli: JPEG, PNG, MP4, MOV, PDF" }, 400);
          if (!req.body) return json({ error: "VALIDATION_ERROR", message: "fayl göndərilməyib" }, 400);
          if (!len) return json({ error: "VALIDATION_ERROR", message: "Content-Length lazımdır" }, 411);
          const doc = await d.library.ingest({ body: req.body, contentType: ct, length: len, filename: req.headers.get("x-filename") || "" });
          await d.audit.log("social.media_uploaded", { id: doc.id, type: doc.kind, size: doc.size });
          return json({ media: { id: doc.id, type: doc.kind, content_type: doc.content_type, ext: doc.ext, size: doc.size, analysis: doc.analysis } });
        }
        if (req.method === "GET" && url.pathname === "/api/media") return json({ items: await d.library.list(30) });
        const mf = url.pathname.match(/^\/api\/media\/([0-9a-f]{24})(\/file)?$/);
        if (req.method === "GET" && mf) {
          const doc = await d.library.get(mf[1]);
          if (!doc) return json({ error: "NOT_FOUND" }, 404);
          if (!mf[2]) return json({ media: doc });
          const obj = await d.hub.media.stream(mf[1]);
          if (!obj) return json({ error: "NOT_FOUND" }, 404);
          return new Response(obj.body, { headers: { "content-type": doc.content_type, "content-length": String(doc.size), "content-disposition": "attachment", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
        }
        if (url.pathname === "/api/media/jobs" || url.pathname.startsWith("/api/media/jobs/")) {
          if (req.method === "GET" && url.pathname === "/api/media/jobs") return json({ jobs: (await d.mediaJobs.list(15)).map(publicJob) });
          if (req.method === "POST" && url.pathname === "/api/media/jobs") {
            const body = await readJson(req);
            if (!body) return json({ error: "VALIDATION_ERROR", message: "gövdə düzgün deyil" }, 400);
            const job = await d.mediaJobs.submitVideoJob({ media_id: String(body.media_id || ""), platform: String(body.platform || "instagram"), goal: body.goal });
            return json({ job: publicJob((await d.mediaJobs.advance(job.id, { deadlineMs: 8000 })) || job) }, 202);
          }
          const mj = url.pathname.match(/^\/api\/media\/jobs\/(\d{13}-[0-9a-f]{6})\/(advance|retry)$/);
          if (req.method === "POST" && mj) {
            if (mj[2] === "retry") await d.mediaJobs.retry(mj[1]);
            const job = await d.mediaJobs.advance(mj[1], { deadlineMs: 15000 });
            return job ? json({ job: publicJob(job) }) : json({ error: "NOT_FOUND" }, 404);
          }
          const mg = url.pathname.match(/^\/api\/media\/jobs\/(\d{13}-[0-9a-f]{6})$/);
          if (req.method === "GET" && mg) {
            const job = await d.mediaJobs.get(mg[1]);
            return job ? json({ job: publicJob(job) }) : json({ error: "NOT_FOUND" }, 404);
          }
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
      let attachIds = [];
      let heardWake = false;
      try {
        const ct = req.headers.get("content-type") || "";
        if (ct.includes("multipart/form-data")) {
          const fd = await req.formData();
          const f = fd.get("audio");
          attachIds = String(fd.get("attachments") || "").split(",").map((x) => x.trim()).filter(Boolean);
          if (f && typeof f !== "string" && f.size > 0) {
            if (!features.voice) return json({ error: "Səs söndürülüb (FEATURE_VOICE=0). Yazı ilə yaz." }, 400);
            checkAudioFile(f);
            const pc = parseVoiceCommand(await stt(env, f, limits.callTimeoutMs));
            text = pc.text;
            heardWake = pc.wake;
          } else text = String(fd.get("text") || "");
        } else {
          const b = await req.json();
          text = String(b.text || "");
          if (Array.isArray(b.attachments)) attachIds = b.attachments.map(String);
        }
      } catch (e) {
        const pe = publicError(e, "voice");
        return json({ error: pe.message, code: pe.code }, toAppError(e).httpStatus >= 400 ? toAppError(e).httpStatus : 502);
      }
      text = text.trim();
      if (!text) return json({ error: "Səs və ya mətn boşdur." }, 400);

      let result;
      try {
        const c = buildContext(env);
        const orchestrator = new ClaudeOrchestrator({ env, registry: createRegistry(env), limits, store, approvals: features.approvals ? approvals : null, tools: features.approvals ? c.tools : null });
        const attachments = [];
        for (const id of attachIds.slice(0, 5)) {
          const m = /^[0-9a-f]{24}$/.test(id) ? await c.library.get(id) : null;
          if (m) attachments.push(m);
        }
        result = await orchestrator.handle(text, { origin: UI_ACTOR, attachments });
      } catch (e) {
        const pe = publicError(e, "chat");
        result = { status: "blocked", spoken: "Xəta baş verdi. Təfərrüat ekranda yazılıb.", screen: pe.message + " (" + pe.code + ")", tasks: [] };
      }
      await audit.log("talk", { status: result.status, chars: text.length, tasks: (result.tasks || []).length });
      let audio = null;
      if (features.voice) {
        try { audio = await tts(env, speakable(result.spoken), limits.callTimeoutMs); } catch (e) { result.tts_error = publicError(e, "tts").message; }
      }
      return json({ transcript: text, wake: heardWake, ...result, audio });
    }
    return new Response("Not found", { status: 404 });
  },

  // Cron (wrangler.toml): gözləyən paylaşım işlərini irəlilədir və Instagram tokenini vaxtında yeniləyir.
  async scheduled(event, env, ctx) {
    const d = buildSocial(env);
    const work = Promise.all([d.flow.tick({ deadlineMs: 25000 }).catch(() => null), d.mediaJobs.tick({ deadlineMs: 20000 }).catch(() => null)]);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
    else await work;
  },
};
