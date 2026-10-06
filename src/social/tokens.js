// Sosial token anbarı. Token KOD-da yoxdur: yalnız KV-də (və ya yaddaşda) saxlanır.
// TOKEN_ENC_KEY varsa qeyd AES-GCM ilə şifrələnir. Token heç vaxt log-a, cavaba və ya UI-a getmir.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(secret) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode("jarvis-token-v1:" + secret));
  return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(record, secret) {
  if (!secret) return { v: 1, plain: record };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(JSON.stringify(record)));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

async function open(sealed, secret) {
  if (!sealed) return null;
  if (sealed.plain) return sealed.plain;
  if (!sealed.ct || !secret) return null; // şifrəli qeyd var, amma açar yoxdur
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, await aesKey(secret), unb64(sealed.ct));
    return JSON.parse(dec.decode(pt));
  } catch (e) {
    return null;
  }
}

export function createTokenVault(env, store) {
  const secret = env.TOKEN_ENC_KEY || "";
  return {
    encrypted: Boolean(secret),
    async get(platform) {
      const sealed = await store.getRaw("secret:" + platform);
      const rec = await open(sealed, secret);
      // TOKEN_ENC_KEY sonradan təyin olunubsa köhnə açıq qeyd oxunan kimi şifrələnir
      if (rec && secret && sealed && sealed.plain) await store.putRaw("secret:" + platform, await seal(rec, secret));
      return rec;
    },
    async put(platform, record) {
      const clean = { ...record, saved_at: Date.now() };
      await store.putRaw("secret:" + platform, await seal(clean, secret));
    },
    async remove(platform) {
      await store.deleteRaw("secret:" + platform);
    },
  };
}

// Token qeydinin vəziyyəti (token mətni qaytarılmır)
export function describeToken(rec, now = Date.now()) {
  if (!rec || !rec.access_token) return { present: false };
  const exp = rec.expires_at || 0;
  return {
    present: true,
    expires_at: exp || null,
    expired: exp ? now >= exp : false,
    expires_in_days: exp ? Math.max(0, Math.floor((exp - now) / 86400000)) : null,
    has_refresh: Boolean(rec.refresh_token),
    scopes: rec.scope || null,
  };
}
