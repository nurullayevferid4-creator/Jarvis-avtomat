// Standart dəyərlər və limitlər.
// Gizli açarlar (ANTHROPIC_API_KEY, OPENAI_API_KEY, PASSCODE) buraya YAZILMIR.
// Onlar yalnız Cloudflare Secrets-də (və ya lokal .dev.vars faylında) saxlanılır.

import { clampInt } from "./util.js";

export const VERSION = "1.2.0-phase1";

// Xüsusiyyət bayraqları: FEATURE_VOICE, FEATURE_APPROVALS, FEATURE_KNOWLEDGE = 0 / 1 (standart: 1)
export function getFeatures(env = {}) {
  const on = (v) => (v === undefined || v === null || v === "" ? true : !/^(0|false|off|no)$/i.test(String(v)));
  return { voice: on(env.FEATURE_VOICE), approvals: on(env.FEATURE_APPROVALS), knowledge: on(env.FEATURE_KNOWLEDGE) };
}

export const DEFAULTS = {
  claudeModel: "claude-sonnet-5-5",
  openaiModel: "gpt-4o",
  ttsVoice: "onyx",
  // Səs tanıma: gpt-4o-transcribe (çoxdilli keyfiyyət daha yüksəkdir); layihədə əlçatan deyilsə avtomatik whisper-1.
  sttModel: "gpt-4o-transcribe",
  sttFallbackModel: "whisper-1",
  // Səsləndirmə: gpt-4o-mini-tts "instructions" qəbul edir (tts-1 qəbul etmir); alınmasa tts-1.
  ttsModel: "gpt-4o-mini-tts",
  ttsFallbackModel: "tts-1",
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
