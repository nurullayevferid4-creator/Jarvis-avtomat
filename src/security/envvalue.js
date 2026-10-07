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

// OpenAI açarı yalnız A-Z a-z 0-9 _ - simvollarından ibarətdir. Yapışdırma zamanı əlavə olunan hər şey atılır:
// boşluq, sətir sonu (içəridə də), görünməz simvollar (BOM, zero-width, NBSP), adi və "ağıllı" dırnaqlar,
// "Bearer " və "OPENAI_API_KEY=" prefiksi. Açarın özü dəyişmir (onun tərkibində bu simvollar olmur).
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00A0]/g;
const QUOTES = /^[\s"'“”„«»‘’`]+|[\s"'“”„«»‘’`]+$/g;

function normalizeOpenAIKey(raw) {
  let k = String(raw === undefined || raw === null ? "" : raw).replace(INVISIBLE, "");
  k = k.replace(QUOTES, "");
  k = k.replace(/^OPENAI_API_KEY\s*[=:]\s*/i, "").replace(QUOTES, "");
  k = k.replace(/^bearer\s+/i, "").replace(QUOTES, "");
  return k.replace(/[\s\x00-\x1F\x7F]+/g, "");
}

export function openaiKey(env) {
  return normalizeOpenAIKey(env && env.OPENAI_API_KEY);
}

// HTTP başlığına yazıla bilən, OpenAI açarı formasında dəyər (sk-..., yalnız icazəli simvollar)
export const OPENAI_KEY_RE = /^sk-[A-Za-z0-9_-]{20,}$/;

// Açarın özünü YOX, yalnız formasını və tapılan problem növlərini təsvir edir (simvolların özü göstərilmir).
export function inspectOpenAIKey(env) {
  const raw = String((env && env.OPENAI_API_KEY) || "");
  const k = openaiKey(env);
  if (!k) return { set: !!raw, shape: "missing", cleaned: !!raw, usable: false, sendable: false, problems: raw ? ["only_whitespace_or_quotes"] : [] };
  const problems = [];
  const core = raw.trim();
  if (/[\r\n]/.test(core)) problems.push("line_break_inside");
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(raw)) problems.push("control_chars");
  if (/[ \t]/.test(core.replace(/^bearer\s+/i, "").replace(/^OPENAI_API_KEY\s*[=:]\s*/i, ""))) problems.push("space_inside");
  if (INVISIBLE.test(raw)) problems.push("invisible_chars");
  INVISIBLE.lastIndex = 0;
  if (/^[\s]*["'“”„«»‘’`]/.test(raw)) problems.push("wrapping_quotes");
  if (/^\s*["'“”„«»‘’`]*\s*bearer\s/i.test(raw)) problems.push("bearer_prefix");
  if (/^\s*["'“”„«»‘’`]*\s*OPENAI_API_KEY\s*[=:]/i.test(raw)) problems.push("name_prefix");
  if (!/^sk-/.test(k)) problems.push("not_sk_prefix");
  if (/[^A-Za-z0-9_-]/.test(k)) problems.push(/[^\x00-\x7F]/.test(k) ? "non_ascii_chars" : "invalid_chars");
  if (k.length < 24) problems.push("too_short");
  const shape = /^sk-admin-/.test(k) ? "admin" : /^sk-proj-/.test(k) ? "project" : /^sk-svcacct-/.test(k) ? "service_account" : /^sk-/.test(k) ? "legacy" : "unexpected";
  // usable: OpenAI açarı formasındadır. sendable: HTTP başlığına yazıla bilər (yalnız çap olunan ASCII).
  // Sorğu yalnız sendable=false olanda bloklanır; format qərarını OpenAI-ın öz cavabı verir.
  const usable = OPENAI_KEY_RE.test(k);
  const sendable = /^[\x21-\x7E]+$/.test(k);
  // Son 4 simvol: OpenAI Dashboard → API keys siyahısı açarları məhz belə göstərir («sk-...abcd»), uyğunluğu yoxlamaq üçün.
  return { set: true, shape, cleaned: raw !== k, usable, sendable, problems, has_inner_space: problems.includes("space_inside") || problems.includes("line_break_inside"), last4: sendable && k.length >= 24 ? k.slice(-4) : null };
}
