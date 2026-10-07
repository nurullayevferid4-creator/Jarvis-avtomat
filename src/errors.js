// Vahid xəta modeli. Bütün qatlar (alət reyestri, təsdiq, icra, providerlər, platformalar) eyni kodlarla danışır.
// İstifadəçiyə yalnız toPublic() qaytarır: stack, URL, token, cavab gövdəsi çıxmır.

export const ERROR_CODES = [
  "AUTH_ERROR", // giriş/token/parol səhvdir
  "PERMISSION_ERROR", // icazə/scope çatmır
  "RATE_LIMIT", // limit dolub
  "VALIDATION_ERROR", // giriş məlumatı səhvdir
  "NETWORK_ERROR", // şəbəkə/DNS/qoşulma
  "TIMEOUT", // vaxt limiti
  "PROVIDER_ERROR", // xarici provider/platforma xətası
  "NOT_FOUND", // tapılmadı
  "CONFLICT", // təkrar/yarış/artıq icra edilib
  "SECURITY_ERROR", // təhlükəsizlik qaydası pozuldu
  "APPROVAL_REQUIRED", // təsdiq lazımdır
  "INTERNAL_ERROR", // gözlənilməz daxili xəta (ətraflı məlumat yalnız jurnala)
];

const DEFAULT_RETRYABLE = new Set(["RATE_LIMIT", "NETWORK_ERROR", "TIMEOUT"]);
const HTTP = {
  AUTH_ERROR: 401,
  PERMISSION_ERROR: 403,
  RATE_LIMIT: 429,
  VALIDATION_ERROR: 400,
  NETWORK_ERROR: 502,
  TIMEOUT: 504,
  PROVIDER_ERROR: 502,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SECURITY_ERROR: 403,
  APPROVAL_REQUIRED: 202,
  INTERNAL_ERROR: 500,
};

// Köhnə sosial qat kodlarının xəritəsi
const SOCIAL_MAP = {
  invalid_request: "VALIDATION_ERROR",
  not_connected: "AUTH_ERROR",
  token_expired: "AUTH_ERROR",
  permission_denied: "PERMISSION_ERROR",
  rate_limited: "RATE_LIMIT",
  api_error: "PROVIDER_ERROR",
  not_supported: "VALIDATION_ERROR",
  unaudited_client: "PERMISSION_ERROR",
  media_error: "VALIDATION_ERROR",
  timeout: "TIMEOUT",
  approval_required: "APPROVAL_REQUIRED",
};

export class AppError extends Error {
  constructor(code, message, extra = {}) {
    super(String(message || code).slice(0, 300));
    this.name = "AppError";
    this.code = ERROR_CODES.includes(code) ? code : "INTERNAL_ERROR";
    this.retryable = extra.retryable === undefined ? DEFAULT_RETRYABLE.has(this.code) : extra.retryable === true;
    this.source = extra.source ? String(extra.source).slice(0, 60) : null;
    this.httpStatus = HTTP[this.code];
    this.detail = extra.detail ? String(extra.detail).slice(0, 300) : null; // yalnız jurnal üçün
  }

  // İstifadəçiyə çıxan forma
  toPublic() {
    return { code: this.code, message: this.message, retryable: this.retryable, source: this.source || undefined };
  }
}

const SAFE_INTERNAL = "Daxili xəta baş verdi. Əməliyyat tamamlanmadı.";

// İstənilən xətanı AppError-a çevirir. Naməlum xətanın mətni istifadəçiyə çıxmır.
export function toAppError(e, source) {
  if (e instanceof AppError) return e;
  if (e && e.name === "SocialError") {
    const code = SOCIAL_MAP[e.code] || "PROVIDER_ERROR";
    const err = new AppError(code, e.message, { retryable: e.retriable === true || DEFAULT_RETRYABLE.has(code), source: e.platform || source });
    return err;
  }
  if (e && e.name === "UnsafeUrlError") return new AppError("SECURITY_ERROR", String(e.message || "təhlükəli ünvan").slice(0, 200), { source });
  if (e && (e.name === "AbortError" || e.name === "TimeoutError")) return new AppError("TIMEOUT", "Vaxt limiti aşıldı", { source });
  const msg = String((e && e.message) || e || "");
  if (e instanceof TypeError && /fetch|network|connect|dns/i.test(msg)) return new AppError("NETWORK_ERROR", "Şəbəkə xətası", { source, detail: msg });
  return new AppError("INTERNAL_ERROR", SAFE_INTERNAL, { source, detail: msg });
}

export function publicError(e, source) {
  return toAppError(e, source).toPublic();
}
