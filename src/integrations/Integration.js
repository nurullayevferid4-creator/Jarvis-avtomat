// İnteqrasiya adapteri üçün baza sinif. Yalnız oxuma (read) əməliyyatları icra oluna bilər.
//
// Davranış qaydası (hamısı testlərlə yoxlanır):
//  1) Naməlum əməliyyat və yanlış giriş HEÇ VAXT şəbəkəyə çıxmır.
//  2) "write" əməliyyatları həmişə "disabled" xətası verir (mock rejimində də, təsdiq id-si ilə də).
//  3) Credential yoxdursa (live rejim) şəbəkə sorğusu YOXDUR: "not_configured".
//  4) Endpoint rəsmi sənədlə yoxlanıb "verified: true" işarələnməyibsə sorğu göndərilmir: "not_implemented".
//     Bu mərhələdə heç bir platformanın endpoint-i yoxlanmayıb, ona görə canlı çağırış heç yerdə işləmir.
//  5) Mock rejimi yalnız konstruktor seçimi ilə açılır (env ilə yox) və hər nəticə "mock: true" daşıyır.
//  6) Token yalnız sorğu anında env-dən oxunur, nə obyektdə saxlanır, nə xəta mətninə düşür.
//  7) Platformadan gələn mətn (başlıq, şərh, ad) ETİBARSIZDIR: modelə yalnız toPromptBox() ilə verilməlidir.

import { httpRequest } from "../guards/http.js";
import { validate } from "../validate.js";
import { wrapExternal } from "../security/sanitize.js";
import { IntegrationError } from "./errors.js";
import { INTEGRATION_POLICY } from "./policy.js";
import { missingEnv } from "./secrets.js";

const OP_NAME = /^[a-z]+(\.[a-z]+)?$/;

export class IntegrationAdapter {
  // operations: { "media.list": { kind: "read"|"write", description, input: <schema> } }
  // endpoints: { "media.list": { verified: false, build(input, env) -> { url, method?, headers?, body? }, parse(data) } }
  constructor({ id, label, operations, endpoints = {}, env = {}, mock = false, request = httpRequest, timeoutMs = 25000 }) {
    if (!/^[a-z]+$/.test(id || "")) throw new Error("integration id düzgün deyil");
    for (const [name, op] of Object.entries(operations || {})) {
      if (!OP_NAME.test(name) || !["read", "write"].includes(op.kind) || !op.input) throw new Error("əməliyyat tərifi düzgün deyil: " + name);
    }
    this.id = id;
    this.label = label;
    this.operations = Object.freeze({ ...operations });
    this.endpoints = endpoints;
    this.mock = !!mock;
    // Gizli (enumerable olmayan) sahələr: adapter JSON.stringify/console.log ilə çıxarılsa belə token sızmasın.
    Object.defineProperty(this, "_env", { value: env || {}, enumerable: false });
    Object.defineProperty(this, "_request", { value: request, enumerable: false });
    this.timeoutMs = timeoutMs;
  }

  // Çatışan konfiqurasiya adları (alt siniflər əlavə yoxlama əlavə edə bilər).
  _missing() {
    return missingEnv(this._env, this.id);
  }

  // Yalnız adlar və true/false: dəyər heç vaxt.
  status() {
    const missing = this._missing();
    const names = Object.keys(this.operations);
    const verified = Object.entries(this.endpoints).filter(([, s]) => s && s.verified === true).map(([k]) => k);
    return {
      id: this.id,
      label: this.label,
      mode: this.mock ? "mock" : missing.length ? "unconfigured" : "live",
      configured: missing.length === 0,
      missing,
      readOnly: true,
      writesEnabled: INTEGRATION_POLICY.writesEnabled,
      readOperations: names.filter((n) => this.operations[n].kind === "read"),
      disabledWriteOperations: names.filter((n) => this.operations[n].kind === "write"),
      verifiedEndpoints: verified,
      liveReady: !this.mock && missing.length === 0 && verified.length > 0,
    };
  }

  async run(op, input = {}) {
    const def = Object.prototype.hasOwnProperty.call(this.operations, op) ? this.operations[op] : null;
    const ctx = { integration: this.id, op: String(op).slice(0, 40) };
    if (!def) throw new IntegrationError("unknown_operation", "naməlum əməliyyat", ctx);
    const v = validate(def.input, input);
    if (!v.ok) throw new IntegrationError("invalid_input", "giriş düzgün deyil: " + v.errors.slice(0, 3).join("; "), ctx);
    if (def.kind === "write" && !INTEGRATION_POLICY.writesEnabled) throw new IntegrationError("disabled", "yazma əməliyyatı bu mərhələdə söndürülüb", ctx);

    if (this.mock) {
      const h = this.mockHandlers && this.mockHandlers[op];
      if (typeof h !== "function") throw new IntegrationError("not_implemented", "bu əməliyyat üçün mock yoxdur", ctx);
      return { mock: true, integration: this.id, op, data: h.call(this, input) };
    }

    if (this._missing().length) throw new IntegrationError("not_configured", "credential təyin edilməyib (Cloudflare Secrets)", ctx);
    const spec = this.endpoints[op];
    if (!spec || spec.verified !== true) throw new IntegrationError("not_implemented", "endpoint rəsmi sənədlə yoxlanmayıb, canlı çağırış söndürülüb", ctx);
    return await this._send(op, spec, input, ctx);
  }

  async _send(op, spec, input, ctx) {
    let res;
    try {
      const r = spec.build(input, this._env);
      res = await this._request(r.url, { method: r.method || "GET", headers: r.headers || {}, body: r.body }, this.timeoutMs);
    } catch (e) {
      throw new IntegrationError("upstream_error", "sorğu alınmadı (" + String((e && e.name) || "xəta").slice(0, 40) + ")", ctx);
    }
    if (!res.ok) throw new IntegrationError("upstream_error", "platforma xəta qaytardı", { ...ctx, status: res.status });
    return { mock: false, integration: this.id, op, untrusted: true, data: spec.parse(res.data) };
  }

  // Nəticəni modelə verməzdən əvvəl etibarsız qutuya qoyur.
  toPromptBox(result) {
    return wrapExternal(JSON.stringify(result && result.data !== undefined ? result.data : null), { source: "integration:" + this.id, maxLen: 8000 }).text;
  }
}

// Ortaq giriş sxemləri
export const limitSchema = { type: "integer", minimum: 1, maximum: 50 };
export const cursorSchema = { type: "string", minLength: 1, maxLength: 200 };
export const idSchema = { type: "string", minLength: 1, maxLength: 64 };
export const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false };
export const PAGE_INPUT = { type: "object", properties: { limit: limitSchema, after: cursorSchema }, additionalProperties: false };
