// Media anbarı (Cloudflare R2, binding: JARVIS_MEDIA) və imzalı müvəqqəti ictimai ünvanlar.
// Instagram mediyanı özü ünvandan çəkir (Meta cURL edir), ona görə qısa ömürlü HMAC imzalı ünvan verilir.
// Bucket ictimai deyil; yalnız /media/<id>.<ext>?exp=..&sig=.. doğru imza ilə açılır.

import { MEDIA_ID_RE } from "./request.js";
import { SocialError } from "./errors.js";
import { publicBaseUrl } from "../security/envvalue.js";

export const MEDIA_TYPES = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
};
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const EXT_TYPE = Object.fromEntries(Object.entries(MEDIA_TYPES).map(([t, v]) => [v.ext, t]));
const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function createMediaStore(env, now = () => Date.now()) {
  const bucket = env.JARVIS_MEDIA || null;
  return {
    available: Boolean(bucket),
    signingConfigured: Boolean(env.MEDIA_SIGNING_KEY && publicBaseUrl(env)),

    async put(bytes, contentType) {
      if (!bucket) throw new SocialError("media_error", "media anbarı (JARVIS_MEDIA) qoşulmayıb");
      const meta = MEDIA_TYPES[contentType];
      if (!meta) throw new SocialError("media_error", "media növü dəstəklənmir");
      const size = bytes.byteLength;
      if (!size) throw new SocialError("media_error", "fayl boşdur");
      if (size > MAX_MEDIA_BYTES) throw new SocialError("media_error", "fayl 64 MB-dan böyükdür");
      const id = hex(crypto.getRandomValues(new Uint8Array(12)));
      await bucket.put("m/" + id, bytes, { httpMetadata: { contentType }, customMetadata: { kind: meta.kind, ext: meta.ext, size: String(size), created: String(now()) } });
      return { id, type: meta.kind, content_type: contentType, ext: meta.ext, size };
    },

    // Axın ilə yazma: fayl Worker yaddaşına yığılmır. length məcburidir (R2 axın üçün bilinən ölçü tələb edir).
    async putStream(stream, { contentType, kind, ext, length, meta = {} }) {
      if (!bucket) throw new SocialError("media_error", "media anbarı (JARVIS_MEDIA) qoşulmayıb");
      if (!Number.isInteger(length) || length <= 0) throw new SocialError("media_error", "fayl ölçüsü məlum deyil");
      const id = hex(crypto.getRandomValues(new Uint8Array(12)));
      await bucket.put("m/" + id, stream, { httpMetadata: { contentType }, customMetadata: { kind, ext, size: String(length), created: String(now()), ...meta } });
      return { id, content_type: contentType, kind, ext, size: length };
    },

    // Bayt aralığı oxuyur (başlıq/metadata analizi üçün); bütün fayl yüklənmir.
    async range(id, offset, length) {
      if (!bucket || !MEDIA_ID_RE.test(id)) throw new SocialError("media_error", "media tapılmadı");
      const o = await bucket.get("m/" + id, { range: { offset, length } });
      if (!o) throw new SocialError("media_error", "media tapılmadı");
      return new Uint8Array(await o.arrayBuffer());
    },

    async size(id) {
      if (!bucket || !MEDIA_ID_RE.test(id)) return null;
      const o = await bucket.head("m/" + id);
      return o ? o.size : null;
    },

    async remove(id) {
      if (!bucket || !MEDIA_ID_RE.test(id)) return false;
      await bucket.delete("m/" + id);
      return true;
    },

    // { id, content_type, kind, ext, size } və ya null
    async head(id) {
      if (!bucket || !MEDIA_ID_RE.test(id)) return null;
      const o = await bucket.head("m/" + id);
      if (!o) return null;
      const ct = (o.httpMetadata && o.httpMetadata.contentType) || "";
      const meta = MEDIA_TYPES[ct];
      if (!meta) return null;
      return { id, content_type: ct, kind: meta.kind, ext: meta.ext, size: o.size };
    },

    async bytes(id) {
      if (!bucket || !MEDIA_ID_RE.test(id)) throw new SocialError("media_error", "media tapılmadı");
      const o = await bucket.get("m/" + id);
      if (!o) throw new SocialError("media_error", "media tapılmadı");
      return await o.arrayBuffer();
    },

    async stream(id) {
      if (!bucket || !MEDIA_ID_RE.test(id)) return null;
      return await bucket.get("m/" + id);
    },

    async signedUrl(id, ext, ttlSeconds = 3600) {
      if (!this.signingConfigured) throw new SocialError("media_error", "MEDIA_SIGNING_KEY və ya PUBLIC_BASE_URL təyin edilməyib");
      if (!MEDIA_ID_RE.test(id) || !EXT_TYPE[ext]) throw new SocialError("media_error", "media ünvanı düzgün deyil");
      const exp = Math.floor(now() / 1000) + Math.min(86400, Math.max(60, ttlSeconds));
      const sig = await hmac(env.MEDIA_SIGNING_KEY, id + "." + ext + ":" + exp);
      return publicBaseUrl(env) + "/media/" + id + "." + ext + "?exp=" + exp + "&sig=" + sig;
    },

    // /media/<id>.<ext>?exp&sig üçün: { ok, id, ext } 
    async verify(pathname, params) {
      const m = /^\/media\/([0-9a-f]{24})\.(jpg|png|mp4|mov)$/.exec(pathname);
      if (!m || !env.MEDIA_SIGNING_KEY) return { ok: false };
      const exp = Number(params.get("exp"));
      const sig = String(params.get("sig") || "");
      if (!Number.isInteger(exp) || exp < Math.floor(now() / 1000)) return { ok: false };
      const want = await hmac(env.MEDIA_SIGNING_KEY, m[1] + "." + m[2] + ":" + exp);
      if (!safeEq(want, sig)) return { ok: false };
      return { ok: true, id: m[1], ext: m[2] };
    },
  };
}
