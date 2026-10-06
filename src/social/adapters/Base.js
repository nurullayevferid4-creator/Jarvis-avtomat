// Bütün platforma adapterlərinin ortaq əsası.
//
// Adapter müqaviləsi (flow.js bunu çağırır):
//   configured()                       → env secret-lər var?
//   status({verify})                   → { platform, state, ... } (token mətni qaytarılmır)
//   authUrl(state, redirectUri)        → OAuth ünvanı (yalnız OAuth platformaları)
//   exchangeCode(code, redirectUri)    → token saxlayır
//   start(req, t) / check(req, t) / commit(req, t) → "waiting" | "ready" | "done"
// "t" = bu platforma üçün iş qeydi: { step, data, post_id, post_url, note }.
// Adapter ÖZÜ təsdiq yoxlamır: onu yalnız flow.js təsdiq bağlandıqdan sonra çağırır.

import { SocialError } from "../errors.js";
import { PLATFORM_INFO } from "../platforms.js";
import { describeToken } from "../tokens.js";

export class BaseAdapter {
  constructor(platform, ctx) {
    this.platform = platform;
    this.ctx = ctx; // { env, vault, media, fetchImpl, now }
    this.info = PLATFORM_INFO[platform];
    this.safeToRestartStart = false;
  }

  get env() { return this.ctx.env; }
  now() { return this.ctx.now ? this.ctx.now() : Date.now(); }
  fopts(timeoutMs) { return { fetchImpl: this.ctx.fetchImpl, platform: this.platform, timeoutMs }; }

  configured() {
    return this.info.secrets.every((k) => Boolean(this.env[k]));
  }

  missingSecrets() {
    return this.info.secrets.filter((k) => !this.env[k]);
  }

  requireConfigured() {
    if (!this.configured()) throw new SocialError("not_connected", this.info.label + ": " + this.missingSecrets().join(", ") + " təyin edilməyib", { platform: this.platform });
  }

  async record() {
    return await this.ctx.vault.get(this.platform);
  }

  // Etibarlı token qeydini qaytarır (lazım olsa yeniləyir). Yoxdursa not_connected, bitibsə token_expired.
  async validRecord() {
    this.requireConfigured();
    let rec = await this.record();
    if (!rec || !rec.access_token) throw new SocialError("not_connected", this.info.label + " hesabı qoşulmayıb", { platform: this.platform });
    const d = describeToken(rec, this.now());
    if (d.expired || (rec.expires_at && rec.expires_at - this.now() < 120000)) {
      if (typeof this.refresh === "function" && (rec.refresh_token || this.platform === "instagram")) {
        rec = await this.refresh(rec);
      } else {
        throw new SocialError("token_expired", this.info.label + " tokeninin vaxtı bitib, yenidən qoşun", { platform: this.platform });
      }
    }
    return rec;
  }

  baseStatus(extra = {}) {
    return { platform: this.platform, label: this.info.label, secrets_missing: this.missingSecrets(), review_note: this.info.review, ...extra };
  }

  // Şəbəkəsiz status (yalnız saxlanmış qeydə görə)
  async cachedStatus() {
    if (!this.configured()) return this.baseStatus({ state: "NOT_CONNECTED", reason: "secret-lər təyin edilməyib" });
    const rec = await this.record();
    if (!rec || !rec.access_token) return this.baseStatus({ state: "NOT_CONNECTED", reason: "hesab qoşulmayıb" });
    const d = describeToken(rec, this.now());
    if (d.expired && !rec.refresh_token && this.platform !== "instagram") return this.baseStatus({ state: "TOKEN_EXPIRED", expires_at: d.expires_at, reason: "token vaxtı bitib" });
    if (d.expired) return this.baseStatus({ state: "TOKEN_EXPIRED", expires_at: d.expires_at, reason: "token vaxtı bitib" });
    return this.baseStatus({ state: "CONNECTED", account: rec.account || null, expires_at: d.expires_at, expires_in_days: d.expires_in_days, scopes: d.scopes, has_refresh: d.has_refresh, verified: false });
  }

  // verify=true olduqda platformaya real sorğu (yalnız oxuma) göndərir
  async status({ verify = false } = {}) {
    const s = await this.cachedStatus();
    if (!verify || s.state !== "CONNECTED") return s;
    try {
      const account = await this.verifyAccount();
      return { ...s, account, verified: true };
    } catch (e) {
      const code = e instanceof SocialError ? e.code : "api_error";
      if (code === "token_expired") return { ...s, state: "TOKEN_EXPIRED", reason: e.message, verified: true };
      if (code === "not_connected") return { ...s, state: "NOT_CONNECTED", reason: e.message, verified: true };
      return { ...s, state: "API_ERROR", reason: String(e.message || "xəta").slice(0, 160), error_code: code, verified: true };
    }
  }
}
