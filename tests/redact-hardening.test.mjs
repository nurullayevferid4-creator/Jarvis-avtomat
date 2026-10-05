// Maskalamanın sinif səviyyəsində yoxlanması (PR #6, Codex review raundları): JSON açarlar, uzun secret quyruğu, etiket variantları,
// unicode, URL/PEM, "artıq maskalanıb" yolu ilə qaçış, yalançı müsbətlər və CPU limiti.
// Açara oxşar mətnlər işləmə vaxtı birləşdirilir: repo-da real açara oxşar mətn olmamalıdır (tests/secrets.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { redactText, redactWithCount, redactSecrets, MASK } from "../src/security/redact.js";

const TAIL = "QUYRUQ9z";
const rep = (s, n) => s.repeat(n);
const SK = "sk" + "-ant-" + rep("Ab12Cd34Ef", 4);
const META = "EA" + "A" + rep("B", 40);
const GH = "gh" + "p_" + rep("a1B2c3", 8);
const JWT_HEAD = "ey" + "J" + rep("a", 20) + "." + rep("b", 20) + ".";
const fullwidth = (s) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join("");

function assertMasked(name, input, secrets, opts = {}) {
  const out = redactText(input);
  for (const s of secrets) assert.ok(!out.includes(s), name + ": açıq qalıb: " + JSON.stringify(s.slice(0, 12)));
  assert.ok(out.includes(MASK), name + ": maska yoxdur");
  if (opts.max) assert.ok(out.length < opts.max, name + ": çıxış çox uzundur " + out.length);
  return out;
}

test("JSON/config açarlarındakı dəyərlər maskalanır, digər sahələr qalır", () => {
  const cases = [
    ['{"password":"hunter2x"}', ["hunter2x"]],
    ['{"user":"bob","api_key":"abcd1234efgh","n":1}', ["abcd1234efgh"]],
    ['{"token": "t0k3n-value", "ok": true}', ["t0k3n-value"]],
    ["{'secret': 'a b c d'}", ["a b c d"]],
    ['{"db_password":"p\\"w rd","k":2}', ["w rd"]],
    ['{"password": 12345678, "user": "a"}', ["12345678"]],
    ['{ "Authorization": "Bearer abc.def.ghi-jkl" }', ["abc.def"]],
    ['{"access_token":"EAAxyz1","refresh_token":"r3fr3sh"}', ["r3fr3sh", "EAAxyz1"]],
    ['{"şifrə":"Salam123"}', ["Salam123"]],
    ['{"client_secret" : "s3cr3tvalue"}', ["s3cr3tvalue"]],
    ["{password => 'rubyPass1'}".replace("{password", "{'password'"), ["rubyPass1"]],
  ];
  for (const [input, secrets] of cases) assertMasked(input, input, secrets);
  assert.equal(redactText('{"user":"bob","api_key":"abcd1234efgh","n":1}'), '{"user":"bob","api_key":' + MASK + ',"n":1}');
  const pretty = redactText('{\n  "user": "bob",\n  "password": "hunter2x",\n  "token": "abc12345"\n}');
  assert.ok(pretty.includes('"user": "bob"') && !/hunter2x|abc12345/.test(pretty));
  assert.equal(redactText('{"user":"bob","name":"Oud 50 ml","price":120}'), '{"user":"bob","name":"Oud 50 ml","price":120}', "adi JSON dəyişmir");
});

test("uzun secret-lərin quyruğu açıq qalmır (açar tipli etiket, JSON, prefiksli tokenlər, parol)", () => {
  const cases = {
    token: "token: " + rep("T1", 3000) + TAIL,
    apiKey: "api key=" + rep("k9", 3000) + TAIL,
    jsonToken: '{"token":"' + rep("T1", 3000) + TAIL + '"}',
    jsonBare: '{"token":' + rep("T1", 3000) + TAIL + "}",
    sk: "açar " + SK + rep("Zz", 3000) + TAIL,
    bearer: "Authorization-siz Bearer " + rep("a1", 3000) + TAIL,
    meta: "x " + META + rep("Q", 3000) + TAIL,
    github: "x " + GH + rep("A", 3000) + TAIL,
    jwt: "x " + JWT_HEAD + rep("c", 5000) + TAIL,
    parol: "password: " + rep("p ", 3000) + TAIL,
  };
  for (const [name, input] of Object.entries(cases)) {
    const out = redactText(input);
    assert.ok(!out.includes(TAIL), name + ": quyruq açıq qalıb");
    assert.ok(out.length < 200, name + ": çıxışda uzun hissə qalıb (" + out.length + ")");
    assert.ok(out.includes(MASK), name);
  }
});

test("etiket variantları: Authorization, Cookie, 'is/budur', Azərbaycan və rus sözləri, =>, ardıcıl söz", () => {
  const cases = [
    ["Authorization: Basic dXNlcjpwYXNz", "dXNlcjpwYXNz"],
    ["Cookie: sid=abc123; theme=dark", "sid=abc123"],
    ["my password is hunter2x", "hunter2x"],
    ["parolum budur - hunter2x", "hunter2x"],
    ["parolum: hunter2x", "hunter2x"],
    ["Şifrəm = hunter2x", "hunter2x"],
    ["api_key => hunter2x", "hunter2x"],
    ["TOKEN=hunter2x", "hunter2x"],
    ["пароль: hunter2x", "hunter2x"],
    ["passphrase = hunter2 x y", "hunter2"],
    ["private_key: hunter2x", "hunter2x"],
    ["credentials=hunter2x", "hunter2x"],
  ];
  for (const [input, secret] of cases) assertMasked(input, input, [secret]);
});

test("unicode: tam enli yazılış, görünməz simvollar və yumşaq defis etiketi pozmur", () => {
  const zw = String.fromCharCode(0x200b);
  const shy = String.fromCharCode(0xad);
  const colon = String.fromCharCode(0xff1a);
  assertMasked("fullwidth", fullwidth("password") + colon + " hunter2x", ["hunter2x"]);
  assertMasked("zero-width", "pass" + zw + "word: hunter2x", ["hunter2x"]);
  assertMasked("soft hyphen", "to" + shy + "ken: hunter2x", ["hunter2x"]);
  assertMasked("json fullwidth", '{"' + fullwidth("token") + '":"hunter2x"}', ["hunter2x"]);
});

test("URL: user:parol@host, sorğu parametrləri, şəxsi açar bloku, Telegram/Shopify/Stripe/AWS", () => {
  const url = redactText("bax https://user:p%40ssw0rd@host.dev/x?y=1");
  assert.ok(!url.includes("p%40ssw0rd") && url.includes("@host.dev/x?y=1"));
  const q = redactText("https://x.dev/cb?code=1&access_token=abc123&sig=zzz9&id=5");
  assert.ok(!/abc123|zzz9/.test(q) && q.includes("code=1") && q.includes("id=5") && q.includes("x.dev/cb"));
  const pem = "-----BEGIN " + "PRIVATE KEY-----\n" + rep("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", 20) + "\n-----END " + "PRIVATE KEY-----";
  const p = redactText("əvvəl\n" + pem + "\nsonra normal mətn");
  assert.ok(!p.includes("MIIE") && p.includes("əvvəl") && p.includes("sonra normal mətn"));
  const long = redactText("-----BEGIN " + "RSA PRIVATE KEY-----\n" + rep("QUJD", 5000) + TAIL);
  assert.ok(!long.includes("QUJD") && !long.includes(TAIL), "bitməmiş şəxsi açar bloku da tam örtülür");
  assertMasked("telegram", "bot " + "123456789" + ":" + rep("A", 35), ["123456789:"]);
  assertMasked("shopify", "tok " + "shp" + "at_" + rep("a", 32), ["shpat_"]);
  assertMasked("stripe", "k " + "sk" + "_live_" + rep("Ab", 12), ["_live_"]);
  assertMasked("aws", "id " + "AKIA" + "ABCDEFGHIJKLMNOP", ["AKIAABCD"]);
});

test("'artıq maskalanıb' yolu ilə qaçış mümkün deyil: maskadan sonra gələn sirr də örtülür", () => {
  for (const input of ["password: " + MASK + "sirr9", "token: " + MASK + "tail7", '{"password":"' + MASK + 'sirr9"}', "parol: " + MASK + " sirr9 daha"]) {
    const out = redactText(input);
    assert.ok(!/sirr9|tail7/.test(out), input + " => " + out);
  }
  assert.equal(redactText("password: " + MASK), "password: " + MASK, "yalnız maskanın özü dəyişmir");
});

test("secrets-only rejimi: token və parol maskalanır, e-poçt qalır; adi rejimdə e-poçt da maskalanır", () => {
  assert.equal(redactSecrets("a@b.co token: abc12345"), "a@b.co token: " + MASK);
  assert.equal(redactWithCount("a@b.co", { email: false }).count, 0);
  assert.equal(redactText("a@b.co"), MASK);
  assert.equal(redactSecrets(undefined), undefined, "string olmayan dəyişmir");
});

test("yalançı müsbət yoxdur: adi mətn dəyişmir", () => {
  const ok = [
    "Bu gün token haqqında danışdıq",
    "Parol sahəsi boşdur",
    "password reset link sent",
    "basic understanding of tokens",
    "task-force qrupu",
    "secret agent filmi",
    "50 ml Oud 120 AZN, tel +994 50 123 45 67",
    "api key almaq lazımdır",
    "açar söz tapıldı",
    "Telefon: 050 123 45 67",
    "Ünvan: Bakı, Nizami küç. 5",
    "key lime pie",
    "https://fnparfum.az/products?id=5&color=blue",
    "pass-through effect",
    "Sifariş nömrəsi: 12345",
    '{"user":"bob","size":"50ml"}',
  ];
  for (const s of ok) {
    const r = redactWithCount(s);
    assert.equal(r.text, s);
    assert.equal(r.count, 0, s);
  }
});

test("təkrar çağırış: sabit hallarda dəyişmir, qalan hallarda heç vaxt daha az maskalamır", () => {
  const stable = ["parol: correct horse battery staple", '{"password":"hunter2x","n":1}', "token: abc12345 sonra", "https://u:pw@h.dev/x", "Cookie: a=b"];
  for (const s of stable) {
    const once = redactText(s);
    assert.equal(redactText(once), once, s);
  }
  const quoted = redactText('password = "a b c d" sonra');
  assert.ok(!redactText(quoted).includes("a b c d"), "ikinci keçid sirri açmır");
});

test("CPU: yeni naxışlar 200 000 simvollu pozucu mətndə iş xəttidir", () => {
  const N = 200000;
  const inputs = {
    jwtTekrar: rep("ey" + "J", N / 3),
    jwtParcalar: rep("ey" + "Jaaaaaaaaaaaa.b.", N / 16),
    pemTekrar: rep("-----BEGIN " + "PRIVATE KEY-----", N / 27),
    jsonAcarTekrar: rep('{"password":"', N / 13),
    jsonDirnaqsiz: '"password":"' + rep("a", N),
    jsonDirnaqlar: '"password":' + rep('"', N),
    jsonVergul: '{"token":' + rep("a,", N / 2),
    urlTekrar: rep("://a:", N / 5),
    urlUzun: "://" + rep("a", N / 2) + ":" + rep("b", N / 2),
    sorgu: rep("?token=", N / 7),
    sorguQisa: rep("&k=", N / 3),
    isTekrar: rep("password is ", N / 12),
    ayiracsiz: rep("password  ", N / 10),
    backslash: 'password: "' + rep("\\", N),
    dirnaqTekrar: rep('password: "', N / 11),
    bearer: rep("Bearer ", N / 7),
    skTekrar: rep("sk-", N / 3),
    nfkc: rep("ﬁ", N),
    zeroWidth: rep(String.fromCharCode(0x200b), N),
    labelsiz: rep("token", N / 5),
    cookie: rep("cookie:", N / 7),
  };
  for (const [name, input] of Object.entries(inputs)) {
    const t = Date.now();
    redactText(input);
    const ms = Date.now() - t;
    assert.ok(ms < 1500, name + " üçün " + ms + " ms çəkdi");
  }
});

test("etiketdən sonra çox qısa dəyər (1-2 simvol) də maskalanır, boş dəyər və yalnız boşluq yox", () => {
  for (const input of ["password: x", "parol = 1", "Şifrəm: ab", "token: z", "api_key=9", "secret => q", "passcode is 7", "Authorization: x", "Cookie: a", "{'pwd': 'x'}", '{"token":"y"}']) {
    const out = redactText(input);
    assert.ok(out.includes(MASK), input + " => " + out);
    assert.ok(!/[:=>]\s*[xz9q7ab1y]\s*$/.test(out.replace(MASK, "")) || out.includes(MASK), input);
  }
  assert.equal(redactText("password: x"), "password: " + MASK);
  assert.equal(redactText("token: z sonra"), "token: " + MASK + " sonra", "açar tipli etiket tək sözü örtür");
  assert.equal(redactText("parol: z sonra"), "parol: " + MASK, "parol tipli etiket sətrin sonuna qədər");
  assert.equal(redactText("password:"), "password:");
  assert.equal(redactText("password:   "), "password:   ");
  assert.equal(redactText("token:\nabc"), "token:\nabc", "növbəti sətirə keçmir");
  assert.equal(redactText("password: " + MASK), "password: " + MASK);
});
