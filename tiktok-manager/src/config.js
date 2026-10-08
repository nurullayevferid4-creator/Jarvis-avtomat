// Konfiqurasiya və sirlər. Sirr dəyərləri heç vaxt loglanmır, nəticəyə yazılmır, istisna mətninə düşmür.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_SCOPES } from "./capabilities.js";

export const MODULE_ROOT = new URL("..", import.meta.url).pathname;

export const SECRET_KEYS = Object.freeze([
  "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN", "TIKTOK_REFRESH_TOKEN", "TIKTOK_BUSINESS_SECRET", "TIKTOK_BUSINESS_ACCESS_TOKEN",
]);

export const ENV_VARS = Object.freeze([
  { name: "TIKTOK_CLIENT_KEY", secret: false, required: "OAuth üçün", desc: "TikTok app Client key" },
  { name: "TIKTOK_CLIENT_SECRET", secret: true, required: "OAuth üçün", desc: "TikTok app Client secret" },
  { name: "TIKTOK_REDIRECT_URI", secret: false, required: "OAuth üçün", desc: "App-da qeydiyyatdan keçmiş redirect URI" },
  { name: "TIKTOK_SCOPES", secret: false, required: "yox", desc: "Vergüllə scope siyahısı (standart: " + DEFAULT_SCOPES.join(",") + ")" },
  { name: "TIKTOK_ACCESS_TOKEN", secret: true, required: "API çağırışı üçün (və ya token faylı)", desc: "User access token (24 saat)" },
  { name: "TIKTOK_REFRESH_TOKEN", secret: true, required: "avtomatik yeniləmə üçün", desc: "Refresh token (365 gün)" },
  { name: "TIKTOK_OPEN_ID", secret: false, required: "yox (token cavabından gəlir)", desc: "Qoşulmuş hesabın open_id-si" },
  { name: "TIKTOK_TOKEN_FILE", secret: false, required: "yox", desc: "Token faylı (standart tiktok-manager/.secrets/token.json)" },
  { name: "TIKTOK_API_VERSION", secret: false, required: "yox", desc: "API versiyası (yalnız v2)" },
  { name: "TIKTOK_EXECUTE_ENABLED", secret: false, required: "yox", desc: "Real icra bayrağı, standart false" },
  { name: "TIKTOK_APP_AUDITED", secret: false, required: "yox", desc: "App audit olunubsa true; əks halda yalnız SELF_ONLY" },
  { name: "TIKTOK_WORKSPACE_DIR", secret: false, required: "yox", desc: "Hesab yaddaşı qovluğu" },
  { name: "TIKTOK_MOCK", secret: false, required: "yox", desc: "1 = mock rejimi (şəbəkə yoxdur)" },
  { name: "TIKTOK_BUSINESS_APP_ID", secret: false, required: "gələcək", desc: "TikTok API for Business app id (hələ istifadə olunmur)" },
  { name: "TIKTOK_BUSINESS_SECRET", secret: true, required: "gələcək", desc: "Business app secret (hələ istifadə olunmur)" },
  { name: "TIKTOK_BUSINESS_ACCESS_TOKEN", secret: true, required: "gələcək", desc: "Business access token (hələ istifadə olunmur)" },
]);

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || "").trim());

export function loadConfig(env = process.env) {
  const version = String(env.TIKTOK_API_VERSION || "v2").trim();
  if (version !== "v2") throw new Error("Dəstəklənməyən TIKTOK_API_VERSION: yalnız v2 rəsmi olaraq yoxlanıb");
  const scopes = String(env.TIKTOK_SCOPES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const workspace = env.TIKTOK_WORKSPACE_DIR || join(MODULE_ROOT, "workspace");
  const cfg = {
    clientKey: env.TIKTOK_CLIENT_KEY || "",
    redirectUri: env.TIKTOK_REDIRECT_URI || "",
    scopes: scopes.length ? scopes : [...DEFAULT_SCOPES],
    apiVersion: version,
    executeEnabled: truthy(env.TIKTOK_EXECUTE_ENABLED), // standart: false
    appAudited: truthy(env.TIKTOK_APP_AUDITED),
    mock: truthy(env.TIKTOK_MOCK),
    workspace,
    tokenFile: env.TIKTOK_TOKEN_FILE || join(MODULE_ROOT, ".secrets", "token.json"),
    openId: env.TIKTOK_OPEN_ID || "",
  };
  // Sirlər obyektin sadalanan sahələrində saxlanmır: JSON.stringify(cfg) onları heç vaxt göstərmir.
  const secrets = {
    TIKTOK_CLIENT_SECRET: env.TIKTOK_CLIENT_SECRET || "",
    TIKTOK_ACCESS_TOKEN: env.TIKTOK_ACCESS_TOKEN || "",
    TIKTOK_REFRESH_TOKEN: env.TIKTOK_REFRESH_TOKEN || "",
  };
  Object.defineProperty(cfg, "secret", { enumerable: false, value: (k) => secrets[k] || "" });
  Object.defineProperty(cfg, "secretValues", { enumerable: false, value: () => Object.values(secrets).filter((v) => v && v.length >= 6) });
  return cfg;
}

// Konfiqurasiya vəziyyəti: yalnız "var/yoxdur", dəyər heç vaxt.
export function configStatus(env = process.env) {
  return ENV_VARS.map((v) => ({ name: v.name, secret: v.secret, set: !!(env[v.name] && String(env[v.name]).length), required: v.required }));
}

export function redact(text, secrets = []) {
  let s = String(text == null ? "" : text);
  for (const v of secrets) if (v && v.length >= 6) s = s.split(v).join("[REDACTED]");
  s = s.replace(/(act|rft)\.[A-Za-z0-9._!*-]{8,}/g, "[REDACTED]"); // TikTok token prefiksləri (sənəd nümunəsi: "act.example...")
  s = s.replace(/(access_token|refresh_token|client_secret|code)=([^&\s"]+)/gi, "$1=[REDACTED]");
  s = s.replace(/("(?:access_token|refresh_token|client_secret)"\s*:\s*")[^"]*"/gi, '$1[REDACTED]"');
  s = s.replace(/Bearer\s+[A-Za-z0-9._!*-]+/g, "Bearer [REDACTED]");
  return s;
}

// Token faylı: 0600 icazə ilə, .gitignore-dadır.
export function readTokenFile(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function writeTokenFile(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2), { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* bəzi FS-lərdə chmod yoxdur */ }
}
