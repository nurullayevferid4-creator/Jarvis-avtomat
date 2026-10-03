// Standart dəyərlər və limitlər.
// Gizli açarlar (ANTHROPIC_API_KEY, OPENAI_API_KEY, PASSCODE) buraya YAZILMIR.
// Onlar yalnız Cloudflare Secrets-də (və ya lokal .dev.vars faylında) saxlanılır.

import { clampInt } from "./util.js";

export const DEFAULTS = {
  claudeModel: "claude-sonnet-5-5",
  openaiModel: "gpt-4o",
  ttsVoice: "onyx",
  openaiWebSearchTool: "web_search",
};

// Hər limit mühit dəyişəni ilə dəyişdirilə bilər, amma həmişə təhlükəsiz aralıqda qalır.
export function getLimits(env = {}) {
  return {
    maxSubtasks: clampInt(env.MAX_SUBTASKS, 4, 1, 8), // bir sorğuda alt tapşırıq sayı
    maxModelCalls: clampInt(env.MAX_MODEL_CALLS, 12, 3, 30), // bir sorğuda ümumi model çağırışı
    maxRetries: clampInt(env.MAX_RETRIES, 3, 0, 3), // yoxlamada tapılan problemə görə təkrar cəhd
    callTimeoutMs: clampInt(env.CALL_TIMEOUT_SECONDS, 25, 5, 60) * 1000, // hər API çağırışı
    loginMaxFailures: clampInt(env.LOGIN_MAX_FAILURES, 5, 3, 20), // səhv parol cəhdi
    loginWindowSeconds: clampInt(env.LOGIN_WINDOW_SECONDS, 900, 60, 86400), // bloklanma müddəti
    maxRounds: 6, // asılılıq dövrlərinin sayı (sonsuz dövrün qarşısı)
  };
}
