// Storage abstraction (təməl). Gələcək persistent məlumat (yaddaş, iş tarixçəsi, bilik, təsdiq, audit, öyrənmə, lead) bura yazılacaq.
//
// DİQQƏT: bu qat MÖVCUD src/state/store.js-ə qoşulmayıb və onu dəyişmir. Açarlar "fx/<namespace>/<key>" prefiksi ilə saxlanır,
// beləliklə mövcud KV açarları ("state", "job:...", "approval:..." və s.) ilə toqquşma mümkün deyil.
// Sirləri (API açar/token) bura yazmaq QADAĞANDIR: bu, məlumat anbarıdır, secret anbarı deyil.

export class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

// Yalnız bu bölmələrə icazə var (açar adı kənardan gələn mətnlə düzəldilmir).
export const STORAGE_NAMESPACES = Object.freeze(["memory", "jobs", "knowledge", "approvals", "audit", "learning", "leads", "integrations"]);

export const KEY_PREFIX = "fx";
export const MAX_VALUE_BYTES = 100000; // JSON mətninin ölçüsü
export const MIN_TTL_SECONDS = 60; // Cloudflare KV minimumu
export const MAX_TTL_SECONDS = 365 * 24 * 3600;
export const LIST_DEFAULT = 50;
export const LIST_MAX = 100;

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function assertNamespace(ns) {
  if (!STORAGE_NAMESPACES.includes(ns)) throw new StorageError("invalid_namespace", "naməlum storage bölməsi");
  return ns;
}

export function assertKey(key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) throw new StorageError("invalid_key", "açar düzgün deyil (hərf, rəqəm, . _ : - ; max 128; '/' yoxdur)");
  return key;
}

export function fullKey(ns, key) {
  return KEY_PREFIX + "/" + assertNamespace(ns) + "/" + assertKey(key);
}

export function listPrefix(ns, prefix = "") {
  if (prefix !== "" && (typeof prefix !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(prefix))) throw new StorageError("invalid_key", "prefiks düzgün deyil");
  return KEY_PREFIX + "/" + assertNamespace(ns) + "/" + prefix;
}

// Dəyəri JSON mətninə çevirir və ölçünü yoxlayır. undefined, funksiya, dövrü struktur qəbul edilmir.
export function encodeValue(value) {
  let s;
  try {
    s = JSON.stringify(value);
  } catch (e) {
    throw new StorageError("invalid_value", "dəyər JSON-a çevrilə bilmir");
  }
  if (typeof s !== "string") throw new StorageError("invalid_value", "dəyər saxlanıla bilməz (undefined/funksiya)");
  if (new TextEncoder().encode(s).length > MAX_VALUE_BYTES) throw new StorageError("value_too_large", "dəyər çox böyükdür (max " + MAX_VALUE_BYTES + " bayt)");
  return s;
}

export function decodeValue(text) {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new StorageError("corrupt", "saxlanmış dəyər pozulub");
  }
}

export function checkTtl(ttlSeconds) {
  if (ttlSeconds === undefined || ttlSeconds === null) return undefined;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) throw new StorageError("invalid_ttl", "ttlSeconds " + MIN_TTL_SECONDS + ".." + MAX_TTL_SECONDS + " aralığında tam ədəd olmalıdır");
  return ttlSeconds;
}

export function checkLimit(limit) {
  if (limit === undefined || limit === null) return LIST_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX) throw new StorageError("invalid_limit", "limit 1.." + LIST_MAX + " aralığında tam ədəd olmalıdır");
  return limit;
}

// Bütün backend-lərin riayət etməli olduğu müqavilə.
export class Storage {
  get backend() { return "abstract"; }
  get persistent() { return false; }
  async get(ns, key) { throw new StorageError("not_implemented", "get yazılmayıb"); }
  async put(ns, key, value, opts) { throw new StorageError("not_implemented", "put yazılmayıb"); }
  async delete(ns, key) { throw new StorageError("not_implemented", "delete yazılmayıb"); }
  // Qaytarır: { keys: [açar, ...], cursor: string|null }
  async list(ns, opts) { throw new StorageError("not_implemented", "list yazılmayıb"); }

  // Bir bölməyə bağlı görünüş: agentlər yalnız öz bölməsini görür.
  scope(ns) {
    assertNamespace(ns);
    return new ScopedStorage(this, ns);
  }
}

export class ScopedStorage {
  constructor(storage, ns) {
    this.storage = storage;
    this.ns = ns;
  }
  get persistent() { return this.storage.persistent; }
  get(key) { return this.storage.get(this.ns, key); }
  put(key, value, opts) { return this.storage.put(this.ns, key, value, opts); }
  delete(key) { return this.storage.delete(this.ns, key); }
  list(opts) { return this.storage.list(this.ns, opts); }
}
