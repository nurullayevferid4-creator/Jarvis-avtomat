// Storage abstraction testləri: interfeys, validasiya, KV/yaddaş davranışı, xəta idarəsi. Heç bir real KV və ya şəbəkə yoxdur.
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStorage } from "../src/storage/MemoryStorage.js";
import { KVStorage } from "../src/storage/KVStorage.js";
import { createStorage, describeStorage, StorageError, STORAGE_NAMESPACES, MAX_VALUE_BYTES, Storage } from "../src/storage/index.js";

class FakeKV {
  constructor() { this.m = new Map(); this.puts = []; this.fail = null; }
  async get(k) { if (this.fail) throw new Error(this.fail); return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v, o) { if (this.fail) throw new Error(this.fail); this.puts.push({ k, o }); this.m.set(k, v); }
  async delete(k) { if (this.fail) throw new Error(this.fail); this.m.delete(k); }
  async list({ prefix, limit, cursor }) {
    if (this.fail) throw new Error(this.fail);
    const all = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? all.findIndex((k) => k === cursor) + 1 : 0;
    const page = all.slice(start, start + limit);
    const done = start + limit >= all.length;
    return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : page[page.length - 1] };
  }
}

const code = async (p) => { try { await p; return null; } catch (e) { return e instanceof StorageError ? e.code : "OTHER:" + e.message; } };

test("Storage baza sinfi: metodlar not_implemented verir (müqavilə aşkardır)", async () => {
  const s = new Storage();
  assert.equal(await code(s.get("memory", "a")), "not_implemented");
  assert.equal(await code(s.put("memory", "a", 1)), "not_implemented");
  assert.equal(s.persistent, false);
});

test("yaddaş backend: put/get/delete/list və JSON nüsxə davranışı", async () => {
  const s = new MemoryStorage();
  const obj = { a: 1, b: ["x"] };
  await s.put("memory", "k1", obj);
  obj.a = 2; // sonradan dəyişmək saxlananı dəyişməməlidir
  assert.deepEqual(await s.get("memory", "k1"), { a: 1, b: ["x"] });
  assert.equal(await s.get("memory", "yoxdur"), null);
  await s.delete("memory", "k1");
  assert.equal(await s.get("memory", "k1"), null);
  assert.equal(s.persistent, false);
  assert.equal(s.backend, "memory");
});

test("açar və bölmə validasiyası: '/' , boş, uzun, naməlum bölmə rədd edilir", async () => {
  const s = new MemoryStorage();
  assert.equal(await code(s.put("memory", "a/b", 1)), "invalid_key");
  assert.equal(await code(s.put("memory", "", 1)), "invalid_key");
  assert.equal(await code(s.put("memory", "x".repeat(129), 1)), "invalid_key");
  assert.equal(await code(s.put("memory", "../etc", 1)), "invalid_key");
  assert.equal(await code(s.put("state", "a", 1)), "invalid_namespace");
  assert.equal(await code(s.get("fx", "a")), "invalid_namespace");
  assert.equal(await code(s.list("memory", { prefix: "a/b" })), "invalid_key");
  assert.ok(STORAGE_NAMESPACES.includes("learning") && STORAGE_NAMESPACES.includes("leads"));
});

test("dəyər validasiyası: undefined, funksiya, dövrü obyekt, çox böyük dəyər rədd edilir", async () => {
  const s = new MemoryStorage();
  assert.equal(await code(s.put("memory", "a", undefined)), "invalid_value");
  assert.equal(await code(s.put("memory", "a", () => 1)), "invalid_value");
  const c = {}; c.self = c;
  assert.equal(await code(s.put("memory", "a", c)), "invalid_value");
  assert.equal(await code(s.put("memory", "a", "x".repeat(MAX_VALUE_BYTES + 1))), "value_too_large");
  await s.put("memory", "ok", "ə".repeat(10)); // UTF-8 çox baytlı simvollar
  assert.equal((await s.get("memory", "ok")).length, 10);
});

test("bölmələr bir-birini görmür", async () => {
  const s = new MemoryStorage();
  await s.put("memory", "k", "m");
  await s.put("leads", "k", "l");
  assert.equal(await s.get("memory", "k"), "m");
  assert.equal(await s.get("leads", "k"), "l");
  assert.deepEqual((await s.list("leads")).keys, ["k"]);
  const scoped = s.scope("learning");
  await scoped.put("r1", { z: 1 });
  assert.deepEqual(await scoped.get("r1"), { z: 1 });
  assert.equal(await s.get("memory", "r1"), null);
  assert.throws(() => s.scope("naməlum"), StorageError);
});

test("ttl: yanlış dəyərlər rədd, vaxtı keçmiş dəyər yox olur (saat inject olunur)", async () => {
  let t = 1_000_000;
  const s = new MemoryStorage({ now: () => t });
  assert.equal(await code(s.put("memory", "a", 1, { ttlSeconds: 30 })), "invalid_ttl");
  assert.equal(await code(s.put("memory", "a", 1, { ttlSeconds: 1.5 })), "invalid_ttl");
  await s.put("memory", "a", 1, { ttlSeconds: 60 });
  assert.equal(await s.get("memory", "a"), 1);
  t += 61_000;
  assert.equal(await s.get("memory", "a"), null);
  assert.deepEqual((await s.list("memory")).keys, []);
});

test("list: prefiks, limit, cursor ilə səhifələmə və limit validasiyası", async () => {
  const s = new MemoryStorage();
  for (const k of ["a-1", "a-2", "a-3", "b-1"]) await s.put("jobs", k, k);
  assert.deepEqual((await s.list("jobs", { prefix: "a-" })).keys, ["a-1", "a-2", "a-3"]);
  const p1 = await s.list("jobs", { prefix: "a-", limit: 2 });
  assert.deepEqual(p1.keys, ["a-1", "a-2"]);
  assert.ok(p1.cursor);
  const p2 = await s.list("jobs", { prefix: "a-", limit: 2, cursor: p1.cursor });
  assert.deepEqual(p2.keys, ["a-3"]);
  assert.equal(p2.cursor, null);
  assert.equal(await code(s.list("jobs", { limit: 0 })), "invalid_limit");
  assert.equal(await code(s.list("jobs", { limit: 101 })), "invalid_limit");
});

test("yaddaş doludursa yeni açar yazılmır (təhlükəsiz xəta)", async () => {
  const s = new MemoryStorage({ maxEntries: 2 });
  await s.put("memory", "a", 1);
  await s.put("memory", "b", 1);
  assert.equal(await code(s.put("memory", "c", 1)), "storage_full");
  await s.put("memory", "a", 2); // mövcud açarı yeniləmək olar
  assert.equal(await s.get("memory", "a"), 2);
});

test("KV: açarlar fx/ prefiksi ilə yazılır, mövcud KV açarlarına toxunmur", async () => {
  const kv = new FakeKV();
  kv.m.set("state", '{"history":[]}');
  kv.m.set("job:123", "{}");
  const s = new KVStorage(kv);
  await s.put("jobs", "j1", { ok: true });
  assert.deepEqual([...kv.m.keys()].sort(), ["fx/jobs/j1", "job:123", "state"]);
  assert.deepEqual(await s.get("jobs", "j1"), { ok: true });
  assert.equal(s.persistent, true);
  assert.equal(s.backend, "kv");
  assert.deepEqual((await s.list("jobs")).keys, ["j1"]); // "state" və "job:123" siyahıda görünmür
  await s.delete("jobs", "j1");
  assert.equal(kv.m.has("fx/jobs/j1"), false);
  assert.equal(kv.m.has("state"), true);
});

test("KV: ttl expirationTtl kimi ötürülür, cursor səhifələməsi işləyir", async () => {
  const kv = new FakeKV();
  const s = new KVStorage(kv);
  await s.put("memory", "t", 1, { ttlSeconds: 120 });
  assert.deepEqual(kv.puts[0], { k: "fx/memory/t", o: { expirationTtl: 120 } });
  await s.put("memory", "t2", 1);
  assert.equal(kv.puts[1].o, undefined);
  for (const k of ["p1", "p2", "p3"]) await s.put("audit", k, 1);
  const a = await s.list("audit", { limit: 2 });
  assert.deepEqual(a.keys, ["p1", "p2"]);
  assert.ok(a.cursor);
  const b = await s.list("audit", { limit: 2, cursor: a.cursor });
  assert.deepEqual(b.keys, ["p3"]);
  assert.equal(b.cursor, null);
});

test("KV xətası: mesaj kənara sızmır (içində gizli mətn ola bilər), kod backend_error", async () => {
  const kv = new FakeKV();
  const s = new KVStorage(kv);
  kv.fail = "Authorization: Bearer SECRET-TOKEN-VALUE";
  for (const op of [() => s.get("memory", "a"), () => s.put("memory", "a", 1), () => s.delete("memory", "a"), () => s.list("memory")]) {
    try { await op(); assert.fail("xəta gözlənilirdi"); } catch (e) {
      assert.equal(e.code, "backend_error");
      assert.ok(!/SECRET|Bearer/.test(e.message));
    }
  }
});

test("KV: pozulmuş saxlanmış dəyər 'corrupt' xətası verir (səssiz null yox)", async () => {
  const kv = new FakeKV();
  kv.m.set("fx/memory/bad", "{not json");
  assert.equal(await code(new KVStorage(kv).get("memory", "bad")), "corrupt");
});

test("KV binding düzgün deyilsə konstruktor rədd edir", () => {
  assert.throws(() => new KVStorage(null), StorageError);
  assert.throws(() => new KVStorage({ get() {} }), StorageError);
});

test("createStorage/describeStorage: KV varsa KV, yoxdursa paylaşılan yaddaş; dəyər göstərilmir", async () => {
  const kv = new FakeKV();
  assert.equal(createStorage({ JARVIS_KV: kv }).backend, "kv");
  const a = createStorage({});
  const b = createStorage({});
  assert.equal(a.backend, "memory");
  assert.equal(a, b, "yaddaş backend-i Worker sorğuları arasında paylaşılır");
  assert.notEqual(createStorage({}, { isolated: true }), a);
  assert.deepEqual(describeStorage({}), { backend: "memory", persistent: false, binding: "JARVIS_KV" });
  assert.deepEqual(describeStorage({ JARVIS_KV: kv }), { backend: "kv", persistent: true, binding: "JARVIS_KV" });
});
