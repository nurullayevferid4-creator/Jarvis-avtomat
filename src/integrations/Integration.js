// İnteqrasiya adapteri üçün baza sinif.
//
// Davranış qaydası (hamısı testlərlə yoxlanır):
//  1) Naməlum əməliyyat və yanlış giriş HEÇ VAXT şəbəkəyə çıxmır.
//  2) "write" əməliyyatları run() ilə həmişə "disabled" verir (mock rejimində də). Yazma yalnız runApproved() ilə,
//     etibarlı ApprovalProof (təsdiqlənmiş, tək istifadəlik, girişə bağlı) varsa və endpoint yoxlanıbsa mümkündür.
//  3) Credential yoxdursa (live rejim) şəbəkə sorğusu YOXDUR: "not_configured".
//  4) Endpoint rəsmi sənədlə yoxlanıb "verified: true" işarələnməyibsə sorğu göndərilmir: "not_implemented".
//     "verified" = sənəd oxunub; canlı hesabla sınanma demək DEYİL (bax docs/WIRING.md "Doğrulama səviyyələri").
//  5) Mock rejimi yalnız konstruktor seçimi ilə açılır (env ilə yox) və hər nəticə "mock: true" daşıyır.
//  6) Token yalnız sorğu anında env-dən oxunur, nə obyektdə saxlanır, nə xəta mətninə düşür.
//  7) Platformadan gələn mətn (başlıq, şərh, ad) ETİBARSIZDIR: modelə yalnız toPromptBox() ilə verilməlidir.
//  8) SSRF: hər sorğunun ünvanı adapterin allowedHosts siyahısında olmalıdır (yalnız https, port 443, loqinsiz, dəqiq host).
//     Yönləndirmə (redirect) izlənmir: token başqa host-a getməsin.

import { httpRequest } from "../guards/http.js";
import { validate } from "../validate.js";
import { wrapExternal } from "../security/sanitize.js";
import { IntegrationError } from "./errors.js";
import { INTEGRATION_POLICY } from "./policy.js";
import { missingEnv } from "./secrets.js";
import { useProof } from "../approval/proof.js";

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OP_NAME = /^[a-z]+(\.[a-z]+)?$/;

// Platforma xəta cavabından qısa, təhlükəsiz kod çıxarır (mətn yox).
export function extractReason(text) {
  try {
    const j = typeof text === "string" ? JSON.parse(text) : text;
    const cands = [typeof (j && j.error) === "string" ? j.error : null, j && j.error && j.error.code, j && j.error && j.error.type, j && j.error && j.error.status, j && j.errors && j.errors[0] && j.errors[0].extensions && j.errors[0].extensions.code];
    return cands.find((c) => typeof c === "string" && /^[A-Za-z_]{3,40}$/.test(c)) || null;
  } catch (e) {
    return null;
  }
}

export class IntegrationAdapter {
  // operations: { "media.list": { kind: "read"|"write", description, input: <schema> } }
  // endpoints: { "media.list": { verified: true|false, build(input, env) -> { url, method?, headers?, body? }, parse(data) }
  //             və ya { verified, exec({ input, env, call }) -> data } (çoxaddımlı) }
  // allowedHosts: sorğuya icazə verilən host-lar (massiv və ya (env) => massiv)
  constructor({ id, label, operations, endpoints = {}, allowedHosts = [], env = {}, mock = false, request = httpRequest, timeoutMs = 25000, sleep = defaultSleep }) {
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
    Object.defineProperty(this, "_sleep", { value: sleep, enumerable: false });
    Object.defineProperty(this, "_allowedHosts", { value: allowedHosts, enumerable: false });
    this.timeoutMs = timeoutMs;
  }

  // Çatışan konfiqurasiya adları (alt siniflər əlavə yoxlama əlavə edə bilər).
  _missing() {
    return missingEnv(this._env, this.id);
  }

  _hosts() {
    const h = typeof this._allowedHosts === "function" ? this._allowedHosts(this._env) : this._allowedHosts;
    return (Array.isArray(h) ? h : []).map((x) => String(x).toLowerCase());
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
      readOnly: !names.some((n) => this.operations[n].kind === "write" && verified.includes(n)),
      writesEnabled: INTEGRATION_POLICY.writesEnabled,
      approvedWritesEnabled: INTEGRATION_POLICY.approvedWritesEnabled,
      readOperations: names.filter((n) => this.operations[n].kind === "read"),
      disabledWriteOperations: names.filter((n) => this.operations[n].kind === "write" && !verified.includes(n)),
      approvalOnlyWriteOperations: names.filter((n) => this.operations[n].kind === "write" && verified.includes(n)),
      verifiedEndpoints: verified,
      liveReady: !this.mock && missing.length === 0 && verified.length > 0,
    };
  }

  _def(op) {
    return Object.prototype.hasOwnProperty.call(this.operations, op) ? this.operations[op] : null;
  }

  _check(op, input) {
    const def = this._def(op);
    const ctx = { integration: this.id, op: String(op).slice(0, 40) };
    if (!def) throw new IntegrationError("unknown_operation", "naməlum əməliyyat", ctx);
    const v = validate(def.input, input);
    if (!v.ok) throw new IntegrationError("invalid_input", "giriş düzgün deyil: " + v.errors.slice(0, 3).join("; "), ctx);
    return { def, ctx };
  }

  // Əlavə, adapterə xas giriş qaydası (məs. Telegram chat allowlist). Şəbəkədən ƏVVƏL çağırılır. Pozulsa IntegrationError atır.
  _precheck(op, input, ctx) {} // eslint-disable-line no-unused-vars

  async run(op, input = {}) {
    const { def, ctx } = this._check(op, input);
    if (def.kind === "write") throw new IntegrationError("disabled", "yazma əməliyyatı təsdiqsiz icra olunmur (yalnız runApproved)", ctx);
    return await this._execute(op, input, ctx);
  }

  // Yazma əməliyyatı: yalnız etibarlı ApprovalProof ilə. Alət adı "<integration>.<op>" olmalıdır.
  async runApproved(op, input = {}, proof) {
    const { def, ctx } = this._check(op, input);
    if (def.kind !== "write") throw new IntegrationError("invalid_input", "bu əməliyyat yazma deyil", ctx);
    if (!INTEGRATION_POLICY.approvedWritesEnabled) throw new IntegrationError("disabled", "təsdiqli yazma söndürülüb", ctx);
    // Şəbəkədən və hətta sübutdan əvvəl adapter qaydası: icazəsiz hədəfə sübut belə sərf olunmasın.
    this._precheck(op, input, ctx);
    const pc = await useProof(proof, { tool: this.id + "." + op, input });
    if (!pc.ok) throw new IntegrationError("approval_required", "Fərid-in təsdiqi yoxdur və ya etibarsızdır (" + pc.reason + ")", ctx);
    return await this._execute(op, input, ctx);
  }

  async _execute(op, input, ctx) {
    this._precheck(op, input, ctx);
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

  // SSRF qoruması: ünvan yalnız https, port 443, loqinsiz və host dəqiq olaraq siyahıda olmalıdır.
  _assertHost(url, ctx) {
    let u;
    try { u = new URL(String(url)); } catch (e) { throw new IntegrationError("upstream_error", "ünvan düzgün deyil", ctx); }
    const ok = u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && this._hosts().includes(u.hostname.toLowerCase());
    if (!ok) throw new IntegrationError("upstream_error", "ünvan icazə verilən host siyahısında deyil", ctx);
    return u;
  }

  // Bir HTTP çağırışı. Qeyri-2xx və şəbəkə xətası IntegrationError olur. Mətn/token xəta mesajına düşmür.
  async _call(url, init, ctx) {
    this._assertHost(url, ctx);
    let res;
    try {
      res = await this._request(url, { ...init, redirect: "manual" }, this.timeoutMs);
    } catch (e) {
      throw new IntegrationError("upstream_error", "sorğu alınmadı (" + String((e && e.name) || "xəta").slice(0, 40) + ")", ctx);
    }
    if (!res.ok) {
      const reason = extractReason(res.data);
      throw new IntegrationError("upstream_error", "platforma xəta qaytardı (HTTP " + res.status + (reason ? " " + reason : "") + ")", { ...ctx, status: res.status, reason });
    }
    return res;
  }

  // Adapterə xas qısa ömürlü token mübadiləsi üçün qarmaq (məs. TikTok refresh). Defolt: env olduğu kimi.
  async _resolveEnv(ctx) { return this._env; } // eslint-disable-line no-unused-vars

  async _send(op, spec, input, ctx) {
    let data;
    try {
      const env = await this._resolveEnv(ctx);
      if (typeof spec.exec === "function") {
        data = await spec.exec({
          input,
          env,
          sleep: (ms) => this._sleep(Math.min(Number(ms) || 0, 3000)),
          call: async (url, init) => (await this._call(url, init || {}, ctx)).data,
          fail: (message, reason) => { throw new IntegrationError("upstream_error", String(message).slice(0, 120), { ...ctx, reason }); },
        });
      } else {
        const r = spec.build(input, env);
        const res = await this._call(r.url, { method: r.method || "GET", headers: r.headers || {}, body: r.body }, ctx);
        data = spec.parse(res.data, env);
      }
    } catch (e) {
      if (e instanceof IntegrationError) throw e;
      throw new IntegrationError("upstream_error", "cavab gözlənilən formada deyil", ctx);
    }
    return { mock: false, integration: this.id, op, untrusted: true, data };
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

// Platformadan gələn cavabın qısa, zəruri sahələrini seçir (qalan hər şey atılır). Mətn sahələri uzunluqla məhdudlanır.
export function pick(obj, keys, maxText = 300) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v.slice(0, maxText) : v;
  }
  return out;
}
