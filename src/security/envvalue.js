// Mühit dəyişəni dəyərlərinin təmizlənməsi. Dashboard-a yapışdırarkən əlavə olan boşluq, sətir sonu və
// ətrafdakı dırnaqlar ən çox rast gəlinən "təyin olunub, amma işləmir" səbəbidir.
// Funksiyalar dəyəri heç vaxt jurnala və ya cavaba yazmır.

// "  \"abc\"\n" → "abc". Yalnız eyni növ ətraf dırnaq götürülür.
export function cleanEnvValue(v) {
  let s = String(v === undefined || v === null ? "" : v).trim();
  for (let i = 0; i < 2; i++) {
    if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) s = s.slice(1, -1).trim();
  }
  return s;
}

// PUBLIC_BASE_URL → { ok, url, reason }. reason: "missing" | "invalid"
// Düzgün forma: https://host (yol, sorğu və fraqment olmadan), sonundakı "/" atılır.
export function inspectPublicBase(raw) {
  const s = cleanEnvValue(raw).replace(/\/+$/, "");
  if (!s) return { ok: false, url: "", reason: "missing" };
  if (!/^https:\/\/[^\s/?#@]+$/i.test(s)) return { ok: false, url: "", reason: "invalid" };
  return { ok: true, url: s, reason: null };
}

// Düzgün PUBLIC_BASE_URL və ya "" (OAuth/media/Shopify üçün)
export function publicBaseUrl(env) {
  return inspectPublicBase(env && env.PUBLIC_BASE_URL).url;
}

// Yalnız host (yol və sorğu Telegram/n8n ünvanlarında gizli hissə ola bilər, göstərilmir).
export function hostOf(u) {
  try {
    return new URL(String(u)).host;
  } catch (e) {
    return "";
  }
}

// OpenAI açarı: təmizlənmiş dəyər (boşluq, sətir sonu, ətraf dırnaq, səhvən yapışdırılmış "Bearer " atılır).
export function openaiKey(env) {
  return cleanEnvValue(env && env.OPENAI_API_KEY).replace(/^bearer\s+/i, "");
}

// Açarın özünü YOX, yalnız formasını təsvir edir (dəyər, uzunluq və simvollar qaytarılmır).
export function inspectOpenAIKey(env) {
  const raw = String((env && env.OPENAI_API_KEY) || "");
  const k = openaiKey(env);
  if (!k) return { set: false, shape: "missing", cleaned: false };
  const shape = /^sk-admin-/.test(k) ? "admin" : /^sk-proj-/.test(k) ? "project" : /^sk-svcacct-/.test(k) ? "service_account" : /^sk-[A-Za-z0-9_-]+$/.test(k) ? "legacy" : "unexpected";
  // Son 4 simvol: OpenAI Dashboard → API keys siyahısı açarları məhz belə göstərir («sk-...abcd»), uyğunluğu yoxlamaq üçün.
  return { set: true, shape, cleaned: raw !== k, has_inner_space: /\s/.test(k), last4: k.length >= 24 ? k.slice(-4) : null };
}
