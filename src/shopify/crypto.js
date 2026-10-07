// HMAC və sabit-vaxtlı müqayisə köməkçiləri (Web Crypto, asılılıq yoxdur).

const enc = new TextEncoder();

export async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
}

export function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex) {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{2,}$/.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function fromBase64(b64) {
  if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    return null;
  }
}

// Uzunluq fərqi də nəticəyə qarışır, müqayisə erkən çıxmır.
export function timingSafeEqualBytes(a, b) {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

export function randomHex(bytes = 16) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
