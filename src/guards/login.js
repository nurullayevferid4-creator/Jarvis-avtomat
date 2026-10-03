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

async function getCount(env, ip) {
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

export async function recordFailure(env, ip, limits) {
  const count = (await getCount(env, ip)) + 1;
  if (env.JARVIS_KV) {
    await env.JARVIS_KV.put("login:" + ip, String(count), { expirationTtl: limits.loginWindowSeconds });
  } else {
    mem.set(ip, { count, resetAt: Date.now() + limits.loginWindowSeconds * 1000 });
  }
}

export async function clearFailures(env, ip) {
  if (env.JARVIS_KV) await env.JARVIS_KV.delete("login:" + ip);
  else mem.delete(ip);
}

export function _resetLoginMemoryForTests() {
  mem.clear();
}
