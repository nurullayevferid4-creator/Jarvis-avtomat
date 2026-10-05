// Məxfi məlumatın maskalanması: naxışlar, yalançı müsbətlər, CPU limiti və audit ilə uyğunluq.
// Test açarları işləmə vaxtı hissələrdən birləşdirilir: repo-da açara oxşar mətn olmamalıdır (tests/secrets.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { redactText, redactWithCount, MASK } from "../src/security/redact.js";
import { redact } from "../src/audit/log.js";

const ANT = "sk" + "-ant-" + "Ab12Cd34Ef".repeat(4);
const PROJ = "sk" + "-proj-" + "Zy98Xw76Vu".repeat(4);
const META = "EA" + "A" + "B".repeat(40);
const GH = "gh" + "p_" + "a1B2c3".repeat(8);
const GHPAT = "github" + "_pat_" + "Q1w2E3".repeat(8);
const SLACK = "xo" + "xb-" + "1234567890-abcdefghij";
const AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const GOOG = "AI" + "za" + "x".repeat(35);
const JWT = "ey" + "J" + "a".repeat(20) + "." + "b".repeat(20) + "." + "c".repeat(10);
const TOKENS = { ANT, PROJ, META, GH, GHPAT, SLACK, AWS, GOOG, JWT };

test("token naxışları: hər biri maskalanır", () => {
  for (const [name, tok] of Object.entries(TOKENS)) {
    assert.equal(redactText("başlıq " + tok + " son"), "başlıq " + MASK + " son", name + " maskalanmadı");
  }
});

test("Bearer başlığı maskalanır, 'Authorization:' sözü qalır", () => {
  assert.equal(redactText("Authorization: Bearer abcdefghij1234567890"), "Authorization: " + MASK);
});

test("etiketdən sonrakı dəyər maskalanır (parol, şifrə, password, api key)", () => {
  assert.equal(redactText("parol: Salam12345 sonra"), "parol: " + MASK + " sonra");
  assert.equal(redactText("Şifrə = abc12345"), "Şifrə = " + MASK);
  assert.equal(redactText("password=hunter2x"), "password=" + MASK);
  assert.equal(redactText("api key: zzzzzzzz"), "api key: " + MASK);
});

test("e-poçt maskalanır, sayı düzgündür", () => {
  const r = redactWithCount("yaz ferid@example.com və ya a.b+c@mail.example.co.uk");
  assert.equal(r.text, "yaz " + MASK + " və ya " + MASK);
  assert.equal(r.count, 2);
});

test("URL-dəki token maskalanır", () => {
  const out = redactText("https://x.dev/cb?access_token=" + META + "&x=1");
  assert.ok(out.includes(MASK));
  assert.ok(!out.includes(META));
});

test("adi mətn dəyişmir: ətir adı, qiymət, telefon, 'task-force', etiketsiz 'token' və 'açar söz'", () => {
  const s = "Oud 50 ml, qiymət 120 AZN, telefon +994 50 123 45 67, task-force-alpha-bravo-charlie, token haqqında, açar söz seçimi";
  assert.equal(redactText(s), s);
  assert.equal(redactWithCount(s).count, 0);
});

test("string olmayan giriş xəta atmır və dəyişmir", () => {
  for (const v of [null, undefined, 5, true, {}, [], ""]) assert.deepEqual(redactText(v), v);
});

test("təkrar maskalama eyni nəticəni verir və artıq maskalanmışı saymır", () => {
  const once = redactText("parol: abcdef və " + ANT + " və x@y.com");
  assert.equal(redactText(once), once);
  assert.equal(redactWithCount("parol: " + MASK).count, 0);
});

test("CPU: pozucu uzun mətndə maskalama saniyələrlə işləmir", () => {
  const N = 200000;
  const inputs = {
    düzMətn: "a".repeat(N),
    emailZənciri: "a@".repeat(N / 2),
    nöqtəZənciri: "a.".repeat(N / 2) + "@x",
    domenZənciri: "x@" + "a.".repeat(N / 2),
    tireZənciri: "x@" + "a-".repeat(N / 2),
    parolTəkrarı: "parol ".repeat(N / 6),
    parolİkiNöqtə: "parol:".repeat(N / 6),
    boşluqSonra: " ".repeat(N) + "parol",
    skTəkrarı: "sk-".repeat(N / 3),
    jwtBaşlanğıcı: ("ey" + "J" + "a".repeat(1990)).repeat(N / 1994),
    bearerTəkrarı: "Bearer ".repeat(N / 7),
    ghTəkrarı: ("gh" + "p_" + "a".repeat(10)).repeat(N / 14),
  };
  for (const [name, s] of Object.entries(inputs)) {
    const t0 = Date.now();
    redactText(s);
    const ms = Date.now() - t0;
    assert.ok(ms < 1500, name + " üçün " + ms + " ms çəkdi");
  }
});

test("audit redact(): ortaq naxışları işlədir, köhnə davranış qalır", () => {
  assert.equal(redact({ api_key: "x" }).api_key, MASK, "açar adı ilə maskalama qalır");
  assert.equal(redact("Bearer abcdefghij1234567890"), MASK);
  assert.equal(redact("tok " + META), "tok " + MASK, "yeni naxış auditə də tətbiq olunur");
  assert.equal(redact("a".repeat(1000)).length, 300, "300 simvol limiti qalır");
});
