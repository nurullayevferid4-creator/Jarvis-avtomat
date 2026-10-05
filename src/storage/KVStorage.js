// Cloudflare KV backend-i (JARVIS_KV binding). Real KV namespace bu kodla YARADILMIR: namespace Cloudflare-də əl ilə
// (və ya Fərid-in təsdiqi ilə) yaradılır və wrangler.toml-da bağlanır (bax docs/FOUNDATION.md).
//
// KV son-nəticəli (eventually consistent) saxlanışdır: yazıdan dərhal sonra başqa məntəqədən oxuma qısa müddət köhnə ola bilər.
// Güclü zəmanət (məs. təsdiqlərin yarışı) lazım olanda sonradan D1 / Durable Object tələb olunacaq.

import { Storage, StorageError, fullKey, listPrefix, encodeValue, decodeValue, checkTtl, checkLimit, KEY_PREFIX } from "./Storage.js";

// Backend xətası: mətn kənara olduğu kimi çıxmır (içində başlıq/URL ola bilər).
const backendError = (op, e) => new StorageError("backend_error", "KV " + op + " alınmadı: " + String((e && e.name) || "xəta").slice(0, 40));

export class KVStorage extends Storage {
  constructor(kv) {
    super();
    if (!kv || ["get", "put", "delete", "list"].some((m) => typeof kv[m] !== "function")) throw new StorageError("invalid_binding", "JARVIS_KV binding düzgün deyil");
    this.kv = kv;
  }
  get backend() { return "kv"; }
  get persistent() { return true; }

  async get(ns, key) {
    const k = fullKey(ns, key);
    let text;
    try { text = await this.kv.get(k, "text"); } catch (e) { throw backendError("oxuma", e); }
    return decodeValue(text);
  }

  async put(ns, key, value, { ttlSeconds } = {}) {
    const k = fullKey(ns, key);
    const v = encodeValue(value);
    const ttl = checkTtl(ttlSeconds);
    try { await this.kv.put(k, v, ttl === undefined ? undefined : { expirationTtl: ttl }); } catch (e) { throw backendError("yazma", e); }
  }

  async delete(ns, key) {
    const k = fullKey(ns, key);
    try { await this.kv.delete(k); } catch (e) { throw backendError("silmə", e); }
  }

  async list(ns, { prefix = "", limit, cursor } = {}) {
    const p = listPrefix(ns, prefix);
    const n = checkLimit(limit);
    let r;
    try { r = await this.kv.list({ prefix: p, limit: n, cursor: cursor || undefined }); } catch (e) { throw backendError("siyahı", e); }
    const base = KEY_PREFIX + "/" + ns + "/";
    const keys = ((r && r.keys) || []).map((x) => String(x.name)).filter((k) => k.startsWith(base)).map((k) => k.slice(base.length));
    return { keys, cursor: r && !r.list_complete && r.cursor ? String(r.cursor) : null };
  }
}
