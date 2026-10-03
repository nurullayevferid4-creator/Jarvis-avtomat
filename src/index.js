// JARVIS Voice Hub: Cloudflare Worker giriş nöqtəsi.
// Sirlər (Secrets): ANTHROPIC_API_KEY, OPENAI_API_KEY, PASSCODE.
// İstəyə bağlı: KV (JARVIS_KV), CLAUDE_MODEL, OPENAI_MODEL, OPENAI_WEB_SEARCH_TOOL, TTS_VOICE,
// limitlər (MAX_SUBTASKS, MAX_MODEL_CALLS, MAX_RETRIES, CALL_TIMEOUT_SECONDS,
// LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS). Bax: .env.example

import { PAGE } from "./ui/page.js";
import { json } from "./util.js";
import { getLimits } from "./config.js";
import { createRegistry } from "./adapters/registry.js";
import { stt, tts } from "./adapters/openaiAudio.js";
import { ClaudeOrchestrator } from "./orchestrator/ClaudeOrchestrator.js";
import { createStore } from "./state/store.js";
import { safeEqual, isBlocked, recordFailure, clearFailures } from "./guards/login.js";

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

    if (!env.ANTHROPIC_API_KEY || !env.OPENAI_API_KEY) return json({ error: "ANTHROPIC_API_KEY və ya OPENAI_API_KEY təyin edilməyib." }, 500);

    const store = createStore(env);
    if (req.method === "GET" && url.pathname === "/api/jobs") return json({ jobs: await store.listJobs() });

    if (req.method === "POST" && url.pathname === "/api/talk") {
      let text = "";
      try {
        const ct = req.headers.get("content-type") || "";
        if (ct.includes("multipart/form-data")) {
          const fd = await req.formData();
          const f = fd.get("audio");
          if (f && typeof f !== "string" && f.size > 0) text = await stt(env, f, limits.callTimeoutMs);
          else text = String(fd.get("text") || "");
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
        const orchestrator = new ClaudeOrchestrator({ env, registry: createRegistry(env), limits, store });
        result = await orchestrator.handle(text);
      } catch (e) {
        const msg = String((e && e.message) || e).slice(0, 300);
        result = { status: "blocked", spoken: "Xəta baş verdi. Təfərrüat ekranda yazılıb.", screen: msg, tasks: [] };
      }
      let audio = null;
      try { audio = await tts(env, result.spoken, limits.callTimeoutMs); } catch (e) { result.tts_error = String((e && e.message) || e).slice(0, 200); }
      return json({ transcript: text, ...result, audio });
    }
    return new Response("Not found", { status: 404 });
  },
};
