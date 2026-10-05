// İnteqrasiya xətaları. Mesajlar sabitdir: içində token, başlıq və ya xarici cavab mətni olmur.
export class IntegrationError extends Error {
  constructor(code, message, { integration = null, op = null, status = null } = {}) {
    super(message);
    this.name = "IntegrationError";
    this.code = code; // not_configured | disabled | not_implemented | invalid_input | unknown_operation | upstream_error
    this.integration = integration;
    this.op = op;
    this.status = status;
  }
}
