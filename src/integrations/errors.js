// İnteqrasiya xətaları. Mesajlar sabitdir: içində token, başlıq və ya xarici cavab mətni olmur.
// `reason`: platformanın qaytardığı qısa xəta kodu (məs. "OAuthException"), yalnız [A-Za-z_] 3-40 simvol olarsa saxlanılır.
export class IntegrationError extends Error {
  constructor(code, message, { integration = null, op = null, status = null, reason = null } = {}) {
    super(message);
    this.name = "IntegrationError";
    this.code = code; // not_configured | disabled | not_implemented | invalid_input | unknown_operation | upstream_error | approval_required | forbidden_target
    this.integration = integration;
    this.op = op;
    this.status = status;
    this.reason = typeof reason === "string" && /^[A-Za-z_]{3,40}$/.test(reason) ? reason : null;
  }
}
