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
  assert.equal(redactText("parol: Salam12345 sonra"), "parol: " + MASK, "dırnaqsız parol sətrin sonuna qədər maskalanır");
  assert.equal(redactText("Şifrə = abc12345"), "Şifrə = " + MASK);
  assert.equal(redactText("password=hunter2x"), "password=" + MASK);
  assert.equal(redactText("api key: zzzzzzzz"), "api key: " + MASK);
  assert.equal(redactText("token: abc12345 sonra"), "token: " + MASK + " sonra", "açar tipli etiket yalnız tək sözü maskalayır");
});

// Codex review raund 1 (PR #6, P1): boşluqlu parol (passphrase) tam maskalanmalıdır
test("boşluqlu və dırnaqlı parol tam maskalanır, qalan mətn qorunur", () => {
  const r1 = redactWithCount("parol: correct horse battery staple");
  assert.equal(r1.text, "parol: " + MASK);
  assert.ok(!/horse|battery|staple|correct/.test(r1.text));
  assert.equal(redactText("password = \"my long pass phrase\" və adi mətn qalır"), "password = " + MASK + " və adi mətn qalır");
  assert.equal(redactText("pwd: 'iki söz parol' sonra"), "pwd: " + MASK + " sonra");
  assert.equal(redactText("passphrase=alpha beta gamma delta"), "passphrase=" + MASK);
  assert.equal(redactText("parol: bir iki üç\nsonrakı sətir adi mətndir"), "parol: " + MASK + "\nsonrakı sətir adi mətndir", "yalnız həmin sətir maskalanır");
  const long = redactText("parol: " + "a ".repeat(500));
  assert.equal(long, "parol: " + MASK, "uzun dəyər də tam maskalanır");
});

// Codex review raund 3 (PR #6, P2): 200 simvoldan uzun parol dəyərinin quyruğu açıq qalmamalıdır
test("200 simvoldan uzun parol dəyəri (boşluqsuz, boşluqlu, dırnaqlı) tam maskalanır, növbəti sətir qalır", () => {
  const TAIL = "QUYRUQ" + "Zz9";
  const cases = {
    boşluqsuz: "password: " + "A1b2".repeat(80) + TAIL,
    boşluqlu: "parol: " + "kəlmə ".repeat(60) + TAIL,
    dırnaqlıUzun: 'pwd="' + "x1".repeat(150) + TAIL + '" sonra',
    təkDırnaq: "passphrase='" + "ab ".repeat(100) + TAIL + "'",
  };
  for (const [name, input] of Object.entries(cases)) {
    const out = redactText(input);
    assert.ok(!out.includes(TAIL), name + ": quyruq açıq qalıb");
    assert.ok(!/A1b2|kəlmə|x1x1|ab ab/.test(out), name + ": dəyər açıq qalıb");
    assert.ok(out.includes(MASK), name);
    assert.ok(out.length < 100, name + ": çıxış " + out.length);
  }
  assert.equal(redactText("parol: " + "a".repeat(5000) + "\nsonrakı sətir adi mətndir"), "parol: " + MASK + "\nsonrakı sətir adi mətndir");
  assert.equal(redactWithCount("password: " + "A1b2".repeat(80) + TAIL).count, 1);
  const again = redactText(redactText(cases.boşluqsuz));
  assert.equal(again, redactText(cases.boşluqsuz), "təkrar çağırışda dəyişmir");
});

test("maskalama təkrar çağırışda dəyişmir (idempotent), dırnaqlı halda da", () => {
  for (const s of ["parol: correct horse battery staple", "token: abc12345 sonra", "x " + META + " y"]) {
    const once = redactWithCount(s);
    const twice = redactWithCount(once.text);
    assert.equal(twice.text, once.text, s);
    assert.equal(twice.count, 0, s);
  }
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
    parolBoşluqlu: "parol: ".repeat(N / 7),
    parolDırnaq: 'password="'.repeat(N / 10),
    parolTəkDırnaq: "pwd='a ".repeat(N / 7),
    parolUzunSətir: "parol:" + "a b ".repeat(N / 4),
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
