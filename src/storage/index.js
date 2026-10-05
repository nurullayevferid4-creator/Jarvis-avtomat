// Storage seçimi: JARVIS_KV binding varsa KV, yoxdursa yaddaş (persistent: false).
// Bu fayl mövcud src/index.js-ə QOŞULMAYIB. Gələcək mərhələdə orkestrator/bilik bazası bunu istifadə edəcək.

import { KVStorage } from "./KVStorage.js";
import { MemoryStorage } from "./MemoryStorage.js";

export { Storage, ScopedStorage, StorageError, STORAGE_NAMESPACES, MAX_VALUE_BYTES } from "./Storage.js";
export { KVStorage, MemoryStorage };

// Worker sorğular arasında modul yaddaşını saxlaya bilər, ona görə yaddaş backend-i modul səviyyəsində paylaşılır.
let shared = null;

// opts.isolated: paylaşılmayan təzə yaddaş (testlər üçün)
export function createStorage(env = {}, { isolated = false, now } = {}) {
  if (env && env.JARVIS_KV) return new KVStorage(env.JARVIS_KV);
  if (isolated) return new MemoryStorage({ now });
  if (!shared) shared = new MemoryStorage();
  return shared;
}

// Açar/dəyər göstərmir, yalnız hansı backend olduğunu.
export function describeStorage(env = {}) {
  const kv = !!(env && env.JARVIS_KV);
  return { backend: kv ? "kv" : "memory", persistent: kv, binding: "JARVIS_KV" };
}
