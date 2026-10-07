import { createCoordinator } from "../coord/coordinator.js";
// Parol qorunması: sabit müddətli müqayisə + səhv cəhd limiti.
// Cəhd sayı KV varsa orada (JARVIS_KV), yoxdursa yaddaşda saxlanılır.
// Qeyd: yaddaş variantı zəifdir (Worker yenidən başlayanda sıfırlanır), KV variantı
// isə "eventual consistency" səbəbindən tam dəqiq deyil. Güclü qoruma üçün
// Cloudflare-in öz Rate Limiting qaydasını da əlavə etmək olar.

const mem = new Map(); // ip -> { count, resetAt }

export function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a ?? ""));
  const y = enc.encode(String(b ?? ""));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const MAX_B64_HEADER = 1024;

// Sorğudan parolu oxuyur.
// 1) x-passcode-b64: parol UTF-8 -> Base64 (brauzer başlığı yalnız ASCII qəbul edir, ə/ı/ş/ğ kimi hərflər üçün).
// 2) x-passcode: köhnə uyğunluq (yalnız Latin-1 simvollu parol).
// Pozuq Base64 və ya pozuq UTF-8 olarsa null qaytarır (çağıran bunu səhv parol sayır, 500 yox).
export function readPasscode(req) {
  const b64 = req.headers.get("x-passcode-b64");
  if (b64 !== null) {
    if (b64.length > MAX_B64_HEADER) return null;
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      return null;
    }
  }
  return req.headers.get("x-passcode");
}

// Durable Object bağlıdırsa sayğac ATOMİKDİR (paralel səhv cəhdləri hamısı sayılır).
// Koordinator əlçatmazdırsa sahib bloklanmasın deyə KV/yaddaş sayğacına düşür (daha zəif, amma açıqdır).
function coordFor(env) {
  return env && env.COORD && typeof env.COORD.idFromName === "function" ? createCoordinator(env) : null;
}
const ckey = (ip) => "login:" + String(ip).slice(0, 60).replace(/[^a-z0-9_.:-]/gi, "_");

async function getCount(env, ip) {
  const c = coordFor(env);
  if (c) {
    try { return await c.count(ckey(ip)); } catch (e) { /* ehtiyat sayğaca düş */ }
  }
  if (env.JARVIS_KV) {
    const v = await env.JARVIS_KV.get("login:" + ip);
    return parseInt(v, 10) || 0;
  }
  const e = mem.get(ip);
  if (!e) return 0;
  if (Date.now() >= e.resetAt) {
    mem.delete(ip);
    return 0;
  }
  return e.count;
}

export async function isBlocked(env, ip, limits) {
  return (await getCount(env, ip)) >= limits.loginMaxFailures;
}

export async function failureCount(env, ip) {
  return await getCount(env, ip);
}

export async function recordFailure(env, ip, limits) {
  const c = coordFor(env);
  if (c) {
    try { await c.incr(ckey(ip), { ttlMs: limits.loginWindowSeconds * 1000 }); return; } catch (e) { /* ehtiyat sayğaca düş */ }
  }
  const count = (await getCount(env, ip)) + 1;
  if (env.JARVIS_KV) {
    await env.JARVIS_KV.put("login:" + ip, String(count), { expirationTtl: limits.loginWindowSeconds });
  } else {
    mem.set(ip, { count, resetAt: Date.now() + limits.loginWindowSeconds * 1000 });
  }
}

export async function clearFailures(env, ip) {
  const c = coordFor(env);
  if (c) {
    try { await c.forget(ckey(ip)); } catch (e) { /* ehtiyat sayğac aşağıda təmizlənir */ }
  }
  if (env.JARVIS_KV) await env.JARVIS_KV.delete("login:" + ip);
  else mem.delete(ip);
}

export function _resetLoginMemoryForTests() {
  mem.clear();
}
