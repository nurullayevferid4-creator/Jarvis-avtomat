// Yaddaş backend-i: JARVIS_KV olmadıqda və testlərdə. Worker yenidən başlayanda silinir (persistent: false).

import { Storage, StorageError, fullKey, listPrefix, encodeValue, decodeValue, checkTtl, checkLimit, KEY_PREFIX } from "./Storage.js";

export class MemoryStorage extends Storage {
  constructor({ now = () => Date.now(), maxEntries = 2000 } = {}) {
    super();
    this.now = now;
    this.maxEntries = maxEntries;
    this.map = new Map(); // tam açar -> { v: JSON mətni, exp: ms|null }
  }
  get backend() { return "memory"; }
  get persistent() { return false; }

  _live(k) {
    const e = this.map.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= this.now()) {
      this.map.delete(k);
      return null;
    }
    return e;
  }

  async get(ns, key) {
    const e = this._live(fullKey(ns, key));
    return e ? decodeValue(e.v) : null;
  }

  async put(ns, key, value, { ttlSeconds } = {}) {
    const k = fullKey(ns, key);
    const v = encodeValue(value);
    const ttl = checkTtl(ttlSeconds);
    if (!this.map.has(k) && this.map.size >= this.maxEntries) throw new StorageError("storage_full", "yaddaş doludur");
    this.map.set(k, { v, exp: ttl === undefined ? null : this.now() + ttl * 1000 });
  }

  async delete(ns, key) {
    this.map.delete(fullKey(ns, key));
  }

  async list(ns, { prefix = "", limit, cursor } = {}) {
    const p = listPrefix(ns, prefix);
    const n = checkLimit(limit);
    const base = KEY_PREFIX + "/" + ns + "/";
    const all = [...this.map.keys()].filter((k) => k.startsWith(p) && this._live(k)).sort();
    const after = cursor ? all.filter((k) => k > base + String(cursor)) : all;
    const page = after.slice(0, n);
    return { keys: page.map((k) => k.slice(base.length)), cursor: after.length > n ? page[page.length - 1].slice(base.length) : null };
  }
}
