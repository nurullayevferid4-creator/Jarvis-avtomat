// Telegram webhook qurulması: konfiqurasiya yoxlaması → getWebhookInfo → (lazımdırsa) setWebhook → getWebhookInfo ilə təsdiq.
//
// Prinsiplər:
//  - Hər uğursuzluq ayrıca "reason" və dəqiq HTTP status ilə qaytarılır (hamısını 409-a yığmaq YOXDUR).
//    409 yalnız Telegram özü 409 Conflict qaytararsa olur.
//  - İdempotent: eyni ünvan artıq qurulubsa heç nə dəyişmir ("already_set").
//  - Başqa ünvan qurulubsa (məs. köhnə n8n) setWebhook onu atomik əvəz edir ("switched"); köhnə ünvandan yalnız host göstərilir.
//  - Uğur yalnız getWebhookInfo qurulmanı təsdiqləyəndən sonra bildirilir.
//  - Token, secret və tam köhnə ünvan heç vaxt cavaba/jurnala düşmür.

import { SocialError } from "../social/errors.js";
import { redactText } from "../social/http.js";
import { WEBHOOK_UPDATES } from "../social/adapters/Telegram.js";
import { cleanEnvValue, inspectPublicBase, hostOf } from "../security/envvalue.js";

export const WEBHOOK_PATH = "/telegram/webhook";
const SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;
const TOKEN_RE = /^\d{1,20}:[A-Za-z0-9_-]{8,}$/;

export class TelegramSetupError extends Error {
  constructor(reason, message, { status = 502, step = "setup", hint = "", retryable = false, extra = {} } = {}) {
    super(String(message).slice(0, 400));
    this.name = "TelegramSetupError";
    this.reason = reason;
    this.status = status;
    this.step = step;
    this.hint = hint;
    this.retryable = retryable;
    this.extra = extra;
  }
}

const CFG_HINT = "Cloudflare → Workers & Pages → jarvis-avtomat → Settings → Variables and Secrets.";

// Şəbəkəsiz yoxlama. origin: sorğunun öz ünvanı (PUBLIC_BASE_URL yoxdursa ehtiyat).
export function inspectConfig(env, origin) {
  const problems = [];
  const warnings = [];
  const token = cleanEnvValue(env.TELEGRAM_BOT_TOKEN);
  const secret = cleanEnvValue(env.TELEGRAM_WEBHOOK_SECRET);
  if (!token) problems.push({ reason: "bot_token_missing", message: "TELEGRAM_BOT_TOKEN təyin edilməyib.", hint: CFG_HINT });
  else if (!TOKEN_RE.test(token)) problems.push({ reason: "bot_token_malformed", message: "TELEGRAM_BOT_TOKEN formatı BotFather tokeninə oxşamır (<rəqəmlər>:<hərf-rəqəm>).", hint: "Tokeni BotFather-dan olduğu kimi yapışdır: əvvəlinə «bot» sözü və ya Bearer yazma." });
  if (!secret) problems.push({ reason: "webhook_secret_missing", message: "TELEGRAM_WEBHOOK_SECRET təyin edilməyib.", hint: CFG_HINT });
  else if (!SECRET_RE.test(secret)) problems.push({ reason: "webhook_secret_invalid", message: "TELEGRAM_WEBHOOK_SECRET yalnız A-Z a-z 0-9 _ - simvollarından ibarət (1-256 simvol) ola bilər.", hint: "Boşluq, nöqtə və xüsusi simvolsuz yeni təsadüfi mətn yarat (docs/ENVIRONMENT.md)." });

  let base = "";
  let baseSource = "env";
  const pb = inspectPublicBase(env.PUBLIC_BASE_URL);
  if (pb.ok) base = pb.url;
  else {
    const o = inspectPublicBase(origin);
    if (o.ok) {
      base = o.url;
      baseSource = "request_origin";
      warnings.push(
        pb.reason === "missing"
          ? "PUBLIC_BASE_URL Worker-ə çatmır (təyin edilməyib və ya deploy zamanı silinib). Bu sorğunun ünvanı istifadə olundu. OAuth və media ünvanları üçün PUBLIC_BASE_URL-u Variables-da təyin et."
          : "PUBLIC_BASE_URL dəyəri düzgün deyil (yalnız https://host, yol və ya boşluqsuz). Bu sorğunun ünvanı istifadə olundu."
      );
    } else {
      baseSource = "none";
      problems.push(
        pb.reason === "missing"
          ? { reason: "public_base_url_missing", message: "PUBLIC_BASE_URL Worker-in mühitində boşdur.", hint: "Plain text Variable kimi yazılıbsa, əvvəlki deploy onu silmiş ola bilər (wrangler.toml-da keep_vars = true olmalıdır). " + CFG_HINT }
          : { reason: "public_base_url_invalid", message: "PUBLIC_BASE_URL dəyəri düzgün deyil: yalnız https://host olmalıdır (yol, sorğu və ya boşluq olmadan).", hint: CFG_HINT }
      );
    }
  }
  if (pb.ok && originDiffers(pb.url, origin)) warnings.push("PUBLIC_BASE_URL bu sorğunun ünvanından fərqlidir; webhook PUBLIC_BASE_URL-a görə qurulur.");

  const idsRaw = cleanEnvValue(env.TELEGRAM_ALLOWED_CHAT_IDS).split(",").map((x) => x.trim()).filter(Boolean);
  const idsOk = idsRaw.filter((x) => /^\d{1,15}$/.test(x)).length;
  if (!idsRaw.length) warnings.push("TELEGRAM_ALLOWED_CHAT_IDS boşdur: webhook qurulsa da bot heç kimin əmrini qəbul etməyəcək.");
  else if (idsOk < idsRaw.length) warnings.push("TELEGRAM_ALLOWED_CHAT_IDS-də rəqəm olmayan dəyər var, o atılacaq (yalnız rəqəmli istifadəçi ID-ləri keçərlidir).");

  return {
    problems,
    warnings,
    base,
    baseSource,
    webhookUrl: base ? base + WEBHOOK_PATH : "",
    checks: { bot_token: !!token, bot_token_format: !!token && TOKEN_RE.test(token), webhook_secret: !!secret, webhook_secret_format: !!secret && SECRET_RE.test(secret), public_base_url: pb.ok, base_source: baseSource, allowed_chat_ids: idsOk },
  };
}

function originDiffers(base, origin) {
  const o = inspectPublicBase(origin);
  return o.ok && o.url.toLowerCase() !== base.toLowerCase();
}

function configError(cfg) {
  const first = cfg.problems[0];
  return new TelegramSetupError(first.reason, first.message, { status: 412, step: "config", hint: first.hint, extra: { problems: cfg.problems } });
}

// Telegram xətasını dəqiq səbəbə çevirir
function mapTelegramError(e, step) {
  if (e instanceof TelegramSetupError) return e;
  if (!(e instanceof SocialError)) throw e;
  const pc = Number(e.platformCode) || 0; // yalnız Telegram-ın öz JSON error_code-u
  const hs = pc || e.httpStatus || 0;
  if (e.code === "token_expired" || (e.code === "api_error" && pc === 404))
    return new TelegramSetupError("bot_token_rejected", "Telegram bu bot tokenini qəbul etmir (HTTP " + pc + "). Token səhvdir, BotFather-da ləğv edilib (/revoke) və ya başqa botun tokenidir.", { status: 424, step, hint: "BotFather → /mybots → botu seç → API Token. Yeni tokeni TELEGRAM_BOT_TOKEN secret-inə yaz və Worker-i yenidən deploy et." });
  if (e.code === "conflict")
    return new TelegramSetupError("telegram_conflict", e.message, { status: 409, step, hint: "Eyni bot üçün başqa proses (long polling / başqa xidmət) işləyə bilər. Onu dayandırıb düyməni yenidən bas." });
  if (e.code === "rate_limited")
    return new TelegramSetupError("telegram_rate_limited", e.message, { status: 429, step, retryable: true, hint: e.retryAfter ? e.retryAfter + " saniyə sonra yenidən sına." : "Bir az sonra yenidən sına.", extra: e.retryAfter ? { retry_after: e.retryAfter } : {} });
  if (e.code === "permission_denied") return new TelegramSetupError("telegram_forbidden", e.message, { status: 424, step });
  if (e.code === "invalid_request") return new TelegramSetupError("telegram_rejected", e.message, { status: 424, step, hint: "Telegram sorğunu rədd etdi; mətni yoxla (ünvan Telegram-ın çata biləcəyi ictimai https olmalıdır)." });
  if (e.code === "timeout") return new TelegramSetupError("telegram_unreachable", "Telegram API-yə vaxtında çatmaq olmadı.", { status: 504, step, retryable: true, hint: "Bir az sonra yenidən sına." });
  if (e.code === "not_connected") return new TelegramSetupError("config_missing", e.message, { status: 412, step: "config", hint: CFG_HINT });
  return new TelegramSetupError(hs >= 500 ? "telegram_unavailable" : "telegram_unreachable", e.message, { status: 502, step, retryable: e.retriable === true, hint: "Bir az sonra yenidən sına." });
}

async function call(step, fn) {
  try {
    return await fn();
  } catch (e) {
    throw mapTelegramError(e, step);
  }
}

const sameUpdates = (a) => Array.isArray(a) && a.length === WEBHOOK_UPDATES.length && WEBHOOK_UPDATES.every((u) => a.includes(u));

function publicInfo(info) {
  const err = info.last_error_message ? { message: redactText(info.last_error_message, 200), at: info.last_error_date ? new Date(Number(info.last_error_date) * 1000).toISOString() : null } : null;
  return { pending: Number(info.pending_update_count) || 0, allowed_updates: Array.isArray(info.allowed_updates) ? info.allowed_updates.map(String).slice(0, 20) : [], last_error: err };
}

async function botName(adapter) {
  try {
    const me = await adapter.getMe();
    return me && me.username ? "@" + String(me.username).slice(0, 64) : null;
  } catch (e) {
    return null;
  }
}

// Yalnız oxuma. Konfiqurasiya problemi olsa da (token varsa) vəziyyət göstərilir.
export async function webhookStatus({ adapter, env, origin }) {
  const cfg = inspectConfig(env, origin);
  const out = { ok: true, expected: cfg.webhookUrl || null, base_source: cfg.baseSource, config: cfg.checks, problems: cfg.problems, warnings: cfg.warnings, webhook: null, bot: null, verdict: "config_problem" };
  if (!cfg.checks.bot_token) return out;
  const info = await call("getWebhookInfo", () => adapter.getWebhookInfo());
  const url = String(info.url || "");
  const p = publicInfo(info);
  out.bot = await botName(adapter);
  out.webhook = { set: !!url, host: hostOf(url) || null, matches_expected: !!url && url === cfg.webhookUrl, updates_ok: sameUpdates(info.allowed_updates), pending_updates: p.pending, last_error: p.last_error };
  if (cfg.problems.length) out.verdict = "config_problem";
  else if (!url) out.verdict = "not_set";
  else if (url !== cfg.webhookUrl) out.verdict = "other_url";
  else if (p.last_error) out.verdict = "delivery_error";
  else out.verdict = "ok";
  return out;
}

// Qurulum. Uğurlu nəticə obyektini qaytarır, əks halda TelegramSetupError atır.
export async function setupWebhook({ adapter, env, origin, force = false }) {
  const cfg = inspectConfig(env, origin);
  if (cfg.problems.length) throw configError(cfg);
  const expected = cfg.webhookUrl;

  const before = await call("getWebhookInfo", () => adapter.getWebhookInfo());
  const current = String(before.url || "");
  const same = current === expected;
  const bp = publicInfo(before);
  let status;
  let dropped = false;
  if (same && sameUpdates(before.allowed_updates) && !bp.last_error && !force) {
    status = "already_set";
  } else {
    // Yeni və ya başqa ünvandan keçid: köhnə istehlakçıya aid gözləyən yeniləmələr atılır.
    // Eyni ünvanın təzələnməsi: gözləyən yeniləmələr saxlanır.
    dropped = !same;
    await call("setWebhook", () => adapter.setWebhook(expected, { dropPending: dropped }));
    status = !current ? "created" : same ? "refreshed" : "switched";
  }

  // Təsdiq: uğur yalnız Telegram real vəziyyəti göstərəndən sonra bildirilir
  const after = status === "already_set" ? before : await call("verify", () => adapter.getWebhookInfo());
  if (String(after.url || "") !== expected || !sameUpdates(after.allowed_updates)) {
    throw new TelegramSetupError("webhook_not_applied", "setWebhook cavab verdi, lakin getWebhookInfo gözlənilən webhook-u göstərmir. Qurulum təsdiqlənmədi.", { status: 502, step: "verify", hint: "Düyməni bir daha bas; təkrarlanarsa docs/TROUBLESHOOTING.md-ə bax." });
  }
  const p = publicInfo(after);
  const warnings = [...cfg.warnings];
  if (p.last_error) warnings.push("Telegram son çatdırma xətası göstərir: " + p.last_error.message + (/40[13]/.test(p.last_error.message) ? " (secret uyğunsuzluğu ola bilər: TELEGRAM_WEBHOOK_SECRET dəyişibsə düyməni yenidən bas)" : ""));
  const bot = await botName(adapter);
  const labels = { created: "quruldu", switched: "başqa ünvandan JARVIS-ə keçirildi", refreshed: "yenidən tətbiq olundu", already_set: "artıq düzgün qurulub, dəyişiklik edilmədi" };
  return {
    ok: true,
    status,
    message: "Telegram webhook " + labels[status] + (bot ? " (" + bot + ")" : "") + ".",
    webhook: expected,
    host: hostOf(expected),
    previous_host: status === "switched" ? hostOf(current) || null : undefined,
    base_source: cfg.baseSource,
    bot,
    pending_updates: p.pending,
    dropped_pending: dropped && Number(before.pending_update_count) > 0 ? Number(before.pending_update_count) : 0,
    allowed_updates: p.allowed_updates,
    allowed_chats: cfg.checks.allowed_chat_ids,
    last_error: p.last_error,
    warnings,
  };
}

// Cavab gövdəsi + status. Xam xətanın mətni (naməlum xəta) çıxmır.
export function setupErrorBody(e) {
  if (e instanceof TelegramSetupError) {
    return { status: e.status, body: { error: e.reason === "telegram_conflict" ? "CONFLICT" : e.status === 412 ? "CONFIG_ERROR" : e.status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR", reason: e.reason, step: e.step, message: e.message, hint: e.hint || undefined, retryable: e.retryable, ...e.extra } };
  }
  return { status: 500, body: { error: "INTERNAL_ERROR", reason: "internal", step: "setup", message: "Daxili xəta baş verdi. Webhook qurulmadı.", retryable: false } };
}
