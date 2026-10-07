// OAuth bağlantısı: yalnız parolla girmiş sahib başlada bilər. "state" bir dəfəlik və 10 dəqiqə etibarlıdır.
// Callback ictimai ünvandır, amma doğru state olmadan heç nə etmir.

import { SocialError } from "./errors.js";
import { PLATFORMS } from "./platforms.js";

const OAUTH_PLATFORMS = ["instagram", "tiktok", "youtube"];

function randomState() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function redirectUri(env, platform) {
  const base = String(env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+$/.test(base)) throw new SocialError("not_connected", "PUBLIC_BASE_URL (https://...) təyin edilməyib", { platform });
  return base + "/oauth/" + platform + "/callback";
}

export async function beginOAuth({ hub, store, env, platform }) {
  if (!OAUTH_PLATFORMS.includes(platform)) throw new SocialError("not_supported", "bu platforma OAuth ilə qoşulmur", { platform });
  const adapter = hub.adapter(platform);
  adapter.requireConfigured();
  if (!env.TOKEN_ENC_KEY) throw new SocialError("not_connected", "TOKEN_ENC_KEY təyin edilməyib: token şifrəsiz saxlanmadığı üçün qoşulma başladılmır", { platform });
  const uri = redirectUri(env, platform);
  const state = randomState();
  await store.putRaw("oauthstate:" + state, { platform, created: Date.now() }, 600);
  return { url: adapter.authUrl(state, uri), redirect_uri: uri };
}

// Qaytarır: { ok, platform?, message } (mesajda gizli məlumat yoxdur)
export async function finishOAuth({ hub, store, env, platform, params }) {
  if (!OAUTH_PLATFORMS.includes(platform)) return { ok: false, message: "Naməlum platforma." };
  const state = String(params.get("state") || "");
  if (!/^[0-9a-f]{32}$/.test(state)) return { ok: false, message: "state düzgün deyil." };
  const rec = await store.getRaw("oauthstate:" + state);
  if (rec) await store.deleteRaw("oauthstate:" + state); // bir dəfəlik
  if (!rec || rec.platform !== platform) return { ok: false, message: "state etibarsızdır və ya vaxtı bitib. Qoşulmanı yenidən başladın." };
  if (params.get("error")) return { ok: false, platform, message: "Platforma icazə verilmədi." };
  const code = params.get("code");
  if (!code) return { ok: false, platform, message: "Kod gəlmədi." };
  try {
    await hub.adapter(platform).exchangeCode(code, redirectUri(env, platform));
    return { ok: true, platform, message: "Qoşuldu. Bu pəncərəni bağlaya bilərsiniz." };
  } catch (e) {
    return { ok: false, platform, message: String((e && e.message) || "qoşulma alınmadı").slice(0, 160) };
  }
}

export { OAUTH_PLATFORMS, PLATFORMS };
