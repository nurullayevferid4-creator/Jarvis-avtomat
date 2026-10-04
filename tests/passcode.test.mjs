// Parol başlığı: UTF-8 -> Base64 (x-passcode-b64) və köhnə x-passcode uyğunluğu.
// Test parolu uydurmadır (real parol deyil). Heç bir real API çağırılmır.
import test from "node:test";
import assert from "node:assert/strict";
import { readPasscode, _resetLoginMemoryForTests } from "../src/guards/login.js";
import { PAGE } from "../src/ui/page.js";
import { baseEnv, worker } from "./helpers.mjs";

// Azərbaycan hərfləri (ə, ı, ş, ğ, ö, ü, ç) olan uydurma parol: köhnə başlıqla göndərmək mümkün deyil
const AZ_PASS = "Test-ƏıŞğÖüç-123";

const toB64 = (s) => Buffer.from(s, "utf-8").toString("base64");
const reqWith = (headers) => new Request("https://x.dev/api/status", { headers });
let ipSeq = 0;
const nextIp = () => "8.8.8." + ++ipSeq;
const status = (headers, env) => worker.fetch(new Request("https://x.dev/api/status", { headers: { "cf-connecting-ip": nextIp(), ...headers } }), env);
const azEnv = () => ({ ...baseEnv(), PASSCODE: AZ_PASS });

test("readPasscode: Azərbaycan hərfli parol Base64-dən düzgün açılır", () => {
  assert.equal(readPasscode(reqWith({ "x-passcode-b64": toB64(AZ_PASS) })), AZ_PASS);
});

test("readPasscode: köhnə x-passcode işləyir, ikisi də varsa Base64 üstündür", () => {
  assert.equal(readPasscode(reqWith({ "x-passcode": "pw" })), "pw");
  assert.equal(readPasscode(reqWith({ "x-passcode": "kohne", "x-passcode-b64": toB64("yeni") })), "yeni");
  assert.equal(readPasscode(reqWith({})), null);
});

test("readPasscode: pozuq Base64, pozuq UTF-8 və çox uzun başlıq null qaytarır, xəta atmır", () => {
  assert.equal(readPasscode(reqWith({ "x-passcode-b64": "%%%not*base64!!" })), null);
  assert.equal(readPasscode(reqWith({ "x-passcode-b64": "a" })), null); // etibarsız uzunluq
  assert.equal(readPasscode(reqWith({ "x-passcode-b64": Buffer.from([0xff, 0xfe, 0xfd]).toString("base64") })), null); // etibarsız UTF-8
  assert.equal(readPasscode(reqWith({ "x-passcode-b64": "QQ==".repeat(400) })), null); // 1024 simvoldan uzun
  // köhnə başlıq pozuq Base64-ün arxasından keçid olmamalıdır
  assert.equal(readPasscode(reqWith({ "x-passcode-b64": "%%%", "x-passcode": "pw" })), null);
});

test("Worker: Azərbaycan hərfli parol Base64 ilə girir (200)", async () => {
  _resetLoginMemoryForTests();
  assert.equal((await status({ "x-passcode-b64": toB64(AZ_PASS) }, azEnv())).status, 200);
});

test("Worker: səhv Base64 parol 401, parolsuz 401", async () => {
  _resetLoginMemoryForTests();
  assert.equal((await status({ "x-passcode-b64": toB64("Yanlis-ƏıŞ") }, azEnv())).status, 401);
  assert.equal((await status({}, azEnv())).status, 401);
});

test("Worker: pozuq Base64 500 yox, 401 qaytarır", async () => {
  _resetLoginMemoryForTests();
  for (const bad of ["%%%not*base64!!", "a", Buffer.from([0xff, 0xfe]).toString("base64"), "QQ==".repeat(400), ""]) {
    const r = await status({ "x-passcode-b64": bad }, azEnv());
    assert.equal(r.status, 401, "pozuq dəyər: " + bad.slice(0, 20));
    assert.equal((await r.json()).error, "Parol səhvdir.");
  }
});

test("Worker: köhnə x-passcode başlığı hələ işləyir", async () => {
  _resetLoginMemoryForTests();
  assert.equal((await status({ "x-passcode": "pw" }, baseEnv())).status, 200);
  assert.equal((await status({ "x-passcode": "yanlis" }, baseEnv())).status, 401);
});

test("Worker: Base64 yolunda da cəhd limiti işləyir (pozuq və səhv cəhdlər sayılır, bloklu IP doğru parolla da girə bilməz)", async () => {
  _resetLoginMemoryForTests();
  const env = { ...azEnv(), LOGIN_MAX_FAILURES: "3" };
  const ip = "6.6.6.6";
  const hit = (h) => worker.fetch(new Request("https://x.dev/api/status", { headers: { "cf-connecting-ip": ip, ...h } }), env);
  assert.equal((await hit({ "x-passcode-b64": "%%%" })).status, 401);
  assert.equal((await hit({ "x-passcode-b64": toB64("yanlis") })).status, 401);
  assert.equal((await hit({ "x-passcode-b64": toB64("yanlis2") })).status, 401);
  assert.equal((await hit({ "x-passcode-b64": toB64("yanlis3") })).status, 429);
  assert.equal((await hit({ "x-passcode-b64": toB64(AZ_PASS) })).status, 429, "bloklu IP doğru parolla da girə bilməz");
});

test("UI: səhifə parolu Base64 başlıqla göndərir və brauzer başlığı qəbul edir (ISO-8859-1 xətası yoxdur)", async () => {
  assert.ok(PAGE.includes("x-passcode-b64"));
  assert.ok(!PAGE.includes('"x-passcode":'), "səhifədə xam parol başlığı qalmamalıdır");
  // Səhifədəki authHeaders funksiyasını çıxarıb saxta DOM ilə işlədir
  const m = PAGE.match(/function authHeaders\(\)\{[\s\S]*?\n\}\n/);
  assert.ok(m, "authHeaders funksiyası tapılmadı");
  const $ = () => ({ value: AZ_PASS });
  const authHeaders = new Function("$", "TextEncoder", "btoa", m[0] + "; return authHeaders;")($, TextEncoder, btoa);
  const h = authHeaders();
  // Düzgün ASCII başlıq: Headers xəta atmır (xam parolla atırdı)
  assert.throws(() => new Headers({ "x-passcode": AZ_PASS }), TypeError);
  assert.doesNotThrow(() => new Headers(h));
  // Və server bu başlıqla girişi qəbul edir
  _resetLoginMemoryForTests();
  assert.equal((await status(h, azEnv())).status, 200);
});
