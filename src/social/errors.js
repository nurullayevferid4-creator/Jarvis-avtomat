// Sosial qatın vahid xəta növü. Mesajda token, URL və ya cavab gövdəsi olmur.

export const ERROR_CODES = [
  "invalid_request", // giriş səhvdir (istifadəçi düzəldə bilər)
  "not_connected", // platforma qoşulmayıb (token/secret yoxdur)
  "token_expired", // token vaxtı bitib və ya ləğv edilib
  "permission_denied", // scope/icazə çatmır
  "rate_limited", // platforma limitinə dəyildi
  "api_error", // platforma xəta qaytardı
  "not_supported", // bu platforma bu növü dəstəkləmir
  "unaudited_client", // tətbiq auditdən keçməyib (TikTok/YouTube)
  "media_error", // media tapılmadı/uyğun deyil
  "conflict", // platforma 409 qaytardı (məs. eyni bot üçün başqa istifadəçi)
  "timeout", // vaxt limiti
  "approval_required", // təsdiq yoxdur
];

export class SocialError extends Error {
  constructor(code, message, extra = {}) {
    super(String(message || code).slice(0, 300));
    this.name = "SocialError";
    this.code = ERROR_CODES.includes(code) ? code : "api_error";
    this.platform = extra.platform || null;
    this.retriable = extra.retriable === true;
    this.httpStatus = extra.httpStatus || 0;
    this.platformCode = extra.platformCode === undefined ? null : String(extra.platformCode).slice(0, 60);
  }

  toJSON() {
    return { code: this.code, message: this.message, platform: this.platform, retriable: this.retriable, http_status: this.httpStatus || undefined, platform_code: this.platformCode || undefined };
  }
}

export function toSocialError(e, platform) {
  if (e instanceof SocialError) {
    if (!e.platform && platform) e.platform = platform;
    return e;
  }
  const msg = String((e && e.message) || e || "naməlum xəta").slice(0, 200);
  return new SocialError("api_error", msg, { platform });
}
