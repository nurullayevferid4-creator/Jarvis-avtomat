// Kiçik ümumi köməkçi funksiyalar.

export function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders },
  });
}

export function normalize(s) {
  return String(s || "").toLocaleLowerCase("az").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}

export function parseJson(text) {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no json");
  return JSON.parse(text.slice(a, b + 1));
}

export function b64(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

// Mühit dəyişənini tam ədədə çevirir. Səhv və ya həddən kənar dəyər olarsa
// limit sönməsin deyə həmişə [min, max] aralığına salınır.
export function clampInt(value, def, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
