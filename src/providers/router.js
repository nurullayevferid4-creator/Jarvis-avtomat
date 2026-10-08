// Provider marşrutlaşdırıcısı.
//   Claude  = lider (planlama, Azərbaycan dili, alət seçimi)
//   OpenAI  = ehtiyat (fallback) + səs (STT/TTS, bax adapters/openaiAudio.js)
//   Kimi    = araşdırma / ikinci rəy (yalnız açıq-aşkar istənəndə, kritik yola düşmür)
//
// Qaydalar: provider uğursuz olarsa növbəti sınanır; hamısı uğursuz olarsa AppError atılır (saxta uğur YOXDUR).
// Hər cavab hansı provayderdən gəldiyini göstərir. Açar yoxdursa provider "qoşulmayıb" sayılır.

import { AppError, toAppError } from "../errors.js";
import { DEFAULTS } from "../config.js";
import { validate } from "../validate.js";
import { parseJson } from "../util.js";
import { openaiKey } from "../security/envvalue.js";
import { providerCall } from "./http.js";

const FALLBACK_ON = new Set(["AUTH_ERROR", "PERMISSION_ERROR", "RATE_LIMIT", "TIMEOUT", "NETWORK_ERROR", "PROVIDER_ERROR", "NOT_FOUND"]);

async function claudeComplete(env, { system, messages, maxTokens, timeoutMs }) {
  const model = env.CLAUDE_MODEL || DEFAULTS.claudeModel;
  const d = await providerCall("claude", "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  }, timeoutMs);
  const text = (d.content || []).map((b) => (b && b.text) || "").join("");
  if (!text) throw new AppError("PROVIDER_ERROR", "claude: boş cavab", { source: "claude", retryable: true });
  return { text, model };
}

async function chatComplete(provider, url, key, model, { system, messages, maxTokens, timeoutMs }) {
  const d = await providerCall(provider, url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages] }),
  }, timeoutMs);
  const c = d.choices && d.choices[0] && d.choices[0].message;
  const text = c && typeof c.content === "string" ? c.content : "";
  if (!text) throw new AppError("PROVIDER_ERROR", provider + ": boş cavab", { source: provider, retryable: true });
  return { text, model };
}

const openaiComplete = (env, a) => chatComplete("openai", "https://api.openai.com/v1/chat/completions", openaiKey(env), env.OPENAI_MODEL || DEFAULTS.openaiModel, a);

// Kimi (Moonshot) OpenAI-uyğun API-dir. DİQQƏT: real açarla yoxlanmayıb, yalnız mock testlidir.
const kimiBase = (env) => String(env.KIMI_BASE_URL || "https://api.moonshot.ai/v1").replace(/\/+$/, "");
const kimiComplete = (env, a) => chatComplete("kimi", kimiBase(env) + "/chat/completions", env.KIMI_API_KEY, env.KIMI_MODEL || "kimi-k2-0905-preview", a);

export function createProviderRouter(env, { timeoutMs = 25000, maxCalls = 8, impls = {} } = {}) {
  const table = {
    claude: { role: "lead", configured: () => !!env.ANTHROPIC_API_KEY, call: impls.claude || ((a) => claudeComplete(env, a)) },
    openai: { role: "fallback", configured: () => !!env.OPENAI_API_KEY, call: impls.openai || ((a) => openaiComplete(env, a)) },
    kimi: { role: "research", configured: () => !!env.KIMI_API_KEY, call: impls.kimi || ((a) => kimiComplete(env, a)) },
  };
  let calls = 0;
  const router = { lastProvider: "claude" };

  async function one(id, args) {
    const p = table[id];
    if (!p.configured()) throw new AppError("AUTH_ERROR", id + " açarı təyin edilməyib", { source: id, retryable: false });
    if (++calls > maxCalls) throw new AppError("RATE_LIMIT", "Model çağırış limiti dolub", { source: "router", retryable: false });
    try {
      const r = await p.call({ ...args, timeoutMs });
      return { ...r, provider: id };
    } catch (e) {
      throw toAppError(e, id);
    }
  }

  // order: provayder ardıcıllığı. Uğursuzluq FALLBACK_ON koduna uyğundursa növbətiyə keçilir.
  async function complete({ system, user, messages, maxTokens = 1500, order = ["claude", "openai"] }) {
    const msgs = messages || [{ role: "user", content: String(user || "") }];
    const attempts = [];
    for (const id of order) {
      if (!table[id]) continue;
      try {
        const r = await one(id, { system, messages: msgs, maxTokens });
        router.lastProvider = id;
        return { ...r, attempts: [...attempts, { provider: id, ok: true }] };
      } catch (e) {
        attempts.push({ provider: id, ok: false, code: e.code });
        if (!FALLBACK_ON.has(e.code) || e.source === "router") break; // qəti xəta və ya öz limitimiz: növbətini sınamırıq
      }
    }
    throw finalError(attempts, "Heç bir model cavab vermədi");
  }

  function finalError(attempts, prefix) {
    const allAuth = attempts.length > 0 && attempts.every((a) => a.code === "AUTH_ERROR");
    const code = allAuth ? "AUTH_ERROR" : "PROVIDER_ERROR";
    const err = new AppError(code, prefix + " (" + attempts.map((a) => a.provider + ":" + a.code).join(", ") + ")", { source: "router", retryable: !allAuth });
    err.attempts = attempts;
    return err;
  }

  // JSON cavab: yanlış formada gələrsə eyni provayderə bir dəfə düzəliş sorğusu, sonra növbəti provayder.
  async function completeJson({ system, user, schema, maxTokens = 1500, order = ["claude", "openai"] }) {
    const attempts = [];
    for (const id of order) {
      if (!table[id] || !table[id].configured()) {
        attempts.push({ provider: id, ok: false, code: "AUTH_ERROR" });
        continue;
      }
      let msgs = [{ role: "user", content: String(user || "") + "\n\nReply with ONLY one valid JSON object." }];
      for (let round = 0; round < 2; round++) {
        try {
          const r = await one(id, { system, messages: msgs, maxTokens });
          let obj;
          try { obj = parseJson(r.text); } catch (e) { obj = null; }
          const check = obj && schema ? validate(schema, obj) : { ok: !!obj, errors: ["JSON tapılmadı"] };
          if (check.ok) {
            router.lastProvider = id;
            return obj;
          }
          attempts.push({ provider: id, ok: false, code: "malformed" });
          msgs = [...msgs, { role: "assistant", content: r.text.slice(0, 4000) }, { role: "user", content: "Invalid JSON or schema: " + (check.errors || []).slice(0, 5).join("; ") + ". Reply again with ONLY the corrected JSON object." }];
        } catch (e) {
          attempts.push({ provider: id, ok: false, code: e.code });
          if (!FALLBACK_ON.has(e.code)) {
            const err = new AppError(e.code, e.message, { source: "router", retryable: e.retryable });
            err.attempts = attempts;
            throw err;
          }
          break; // bu provayder işləmir, növbətiyə
        }
      }
    }
    throw finalError(attempts, "Model cavabı alınmadı və ya formatı düzgün deyil");
  }

  // Kimi: yalnız ikinci rəy. Açar yoxdursa açıq-aşkar AUTH_ERROR (səssiz fallback yoxdur).
  async function secondOpinion({ system, user, maxTokens = 1200 }) {
    return await one("kimi", { system, messages: [{ role: "user", content: String(user || "") }], maxTokens });
  }

  // Kimi: market_research / lead_research. Kimi əsasdır, alınmasa Claude (OpenAI heç vaxt). Qərarı Claude verir.
  async function research({ kind = "market_research", system, user, maxTokens = 1200 }) {
    if (kind !== "market_research" && kind !== "lead_research") throw new AppError("VALIDATION_ERROR", "research növü yanlışdır", { source: "router", retryable: false });
    return await complete({ system, user, maxTokens, order: ["kimi", "claude"] });
  }

  function status() {
    return Object.entries(table).map(([id, p]) => ({ id, role: p.role, configured: p.configured(), model: id === "claude" ? env.CLAUDE_MODEL || DEFAULTS.claudeModel : id === "openai" ? env.OPENAI_MODEL || DEFAULTS.openaiModel : env.KIMI_MODEL || "kimi-k2-0905-preview" }));
  }

  // marketing/leads üçün "llm" interfeysi: provider sahəsi son uğurlu provayderi göstərir
  function asLlm() {
    return {
      get provider() { return router.lastProvider; },
      completeJson: (a) => completeJson(a),
    };
  }

  return Object.assign(router, { complete, completeJson, secondOpinion, research, status, asLlm, callCount: () => calls });
}
