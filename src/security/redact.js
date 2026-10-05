// Məxfi məlumatın maskalanması.
//
// Məqsəd: istifadəçi və ya model səhvən token, parol və ya e-poçt yazsa, bu məlumat
// uzunmüddətli yaddaşa (bilik bazası, söhbət tarixçəsi, iş qeydləri, təsdiq qeydləri, audit) düşməsin.
//
// QAYDALAR VƏ MƏHDUDİYYƏTLƏR
//  - Yalnız TANINAN formatlar tutulur: aşağıdakı prefikslər, etiketdən sonrakı dəyər ("parol: ...", JSON-da "password":"..."),
//    URL-də "user:parol@", sorğu parametrləri ("?token=..."), şəxsi açar blokları və (istəyə görə) e-poçt.
//    Prefiksi və etiketi olmayan açarlar (məs. Cloudflare API tokeni) və "parolum 12345" kimi etiketsiz yazılış tutulmur.
//  - Telefon nömrələri maskalanmır: sifariş məlumatı üçün lazımdır.
//  - TƏHLÜKƏSİZ İSTİQAMƏT: şübhə olduqda daha ÇOX maskalanır (parol sətrin sonuna qədər), heç vaxt az yox.
//  - Uzunluq limiti YOXDUR: limit olsaydı uzun secret-in quyruğu açıq qalardı. Ona görə naxışlarda ya hər başlanğıc yalnız söz
//    sərhədində ola bilər (lookbehind), ya da uyğunluq tapılanda sətrin sonuna qədər işlənir. Beləliklə iş xətti qalır
//    (tests/redact.test.mjs-də 200 000 simvollu pozucu mətnlərlə ölçülür).
//  - Mətn əvvəlcə kanonikləşdirilir: görünməz simvollar silinir, NFKC tətbiq olunur (tam enli "ｐａｓｓｗｏｒｄ" kimi yazılışlar tutulsun).
//  - "secrets-only" rejimi (email:false): e-poçt maskalanmır. Təsdiq qeydləri və qaralama üçün istifadə olunur, çünki müştəri
//    e-poçtu qaralamanın qanuni hissəsi ola bilər, token və parol isə heç vaxt olmamalıdır.
//  - Prefikslər ictimai məlumata əsaslanır və rəsmi sənədlə yoxlanmayıb (bax Issue #5, ChatGPT hissəsi).

export const MASK = "[gizlədildi]";

// Görünməz format simvolları (zero-width, bidi, soft hyphen) və idarəedici simvollar. \n \r \t qalır.
const CTRL_RE = /[\p{Cf}\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/gu;

// Parol tipli etiketlər: dəyər BOŞLUQLU ola bilər, ona görə dırnaqsızdırsa sətrin sonuna qədər maskalanır.
const PASS_NAME = String.raw`(?:(?:parol|şifrə|şifre|sifrə|sifre)\p{L}{0,4}|пароль|password|passwd|passphrase|pass[ _-]phrase|pwd|passcode|authorization|cookie)`;
// Açar tipli etiketlər: dəyər tək sözdür.
const KEY_NAME = String.raw`(?:token|secret|api[ _-]?key|access[ _-]?key|private[ _-]?key|credentials?|açar\p{L}{0,3}|bearer)`;

// Dırnaqlı sətir (JSON kimi, \" ilə), uzunluq limiti yox. Bağlanmayan dırnaq düşür və "qalan hissə" variantı işləyir.
const DQ = String.raw`"((?:[^"\\\n]|\\.)*)"`;
const SQ = String.raw`'([^'\n]*)'`;

// 1) JSON / config açarı dırnaqda: {"password":"..."}, 'api_key': '...', "Authorization": "Bearer ..."
//    Dırnaqsız dəyər (rəqəm, true və s.) vergülə, } və ] işarəsinə qədər.
const JSON_KV_RE = new RegExp(
  String.raw`(["'\x60][^"'\x60\n]{0,40}(?:${PASS_NAME}|${KEY_NAME})[^"'\x60\n]{0,20}["'\x60][ \t]{0,3}(?::|=>)[ \t]{0,3})` +
    String.raw`(?:${DQ}|${SQ}|\x60([^\x60\n]*)\x60|((?:\[gizlədildi\]|[^,}\]\n])+))`,
  "giu"
);

// 2) Parol tipli etiket düz mətndə: "parol: ...", "password = ...", "password is ...", "parol budur - ..."
const PASS_PLAIN_RE = new RegExp(
  String.raw`(${PASS_NAME}[ \t]{0,3}(?:=>|[:=]|[ \t]{1,3}(?:is|budur|—|–|-)[ \t]{1,3})[ \t]{0,3})(?:${DQ}|${SQ}|([^\n]{3,}))`,
  "giu"
);

// 3) Açar tipli etiket: "token: ...", "api key=...", "secret => ..." (tək söz, & işarəsinə qədər)
const KEY_PLAIN_RE = new RegExp(String.raw`(${KEY_NAME}[ \t]{0,3}(?:=>|[:=])[ \t]{0,3})(?:${DQ}|${SQ}|([^\s&]{3,}))`, "giu");

// 4) URL sorğu parametrləri: ?token=..., &api_key=..., &sig=...
const QUERY_RE = /([?&][\w.%-]{0,30}?(?:key|token|secret|passw(?:or)?d|pwd|signature|sig|auth)[\w.%-]{0,10}=)([^&\s#"'<>]+)/gi;

// 5) URL-də loqin:parol — https://user:parol@host
const URL_CRED_RE = /(?<=:\/\/)[^\s/@:]{1,100}:[^\s/@]+(?=@)/g;

// 6) Şəxsi açar bloku (PEM): başlıq + gövdə + (varsa) son sətir. Gövdə yalnız base64 simvolları və boşluqdur, ona görə iş xəttidir.
const PEM_RE = /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[A-Za-z0-9+/=\s]*(?:-----END [A-Z ]{0,30}PRIVATE KEY-----)?/g;

// 7) Prefiksi məlum olan açarlar. Hər başlanğıc söz sərhədindədir (lookbehind), uzunluq üst həddi yoxdur.
const VALUE_PATTERNS = [
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{10,}/g, // sk-... (Anthropic, OpenAI və b.)
  /(?<![A-Za-z0-9])[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe gizli açarı
  /(?<![A-Za-z0-9])Bearer[ \t]{1,5}[A-Za-z0-9._~+/=-]{10,}/gi, // Authorization: Bearer ...
  /(?<![A-Za-z0-9])EAA[A-Za-z0-9]{20,}/g, // Meta / Facebook giriş tokeni
  /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokeni
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained tokeni
  /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack tokeni
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/g, // AWS giriş açarı identifikatoru
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/g, // Google API açarı
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /(?<![0-9A-Za-z:])\d{8,10}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g, // Telegram bot tokeni
  /(?<![A-Za-z0-9])shp(?:at|ca|pa|ss)_[a-f0-9]{32}/g, // Shopify giriş tokeni
];

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g;

// Qaytarır: { text, count }. String olmayan giriş dəyişmədən qaytarılır (çağıran tərəf əvvəlcədən String-ə çevirməlidir).
// opts.email === false: e-poçt maskalanmır ("secrets-only").
export function redactWithCount(value, opts = {}) {
  if (typeof value !== "string" || !value) return { text: value, count: 0 };
  let count = 0;
  const hit = () => {
    count++;
    return MASK;
  };
  // Yalnız dəyər MASK-ın özüdürsə "artıq maskalanıb" sayılır. "[gizlədildi]sirr" kimi yazılış bu yolla qaça bilməz.
  const labeled = (m, head, ...g) => {
    const val = g.slice(0, g.length - 2).find((x) => typeof x === "string");
    if (val === undefined || val === "" || val === MASK) return m;
    count++;
    return head + MASK;
  };

  let s = value.replace(CTRL_RE, "").normalize("NFKC");
  s = s.replace(JSON_KV_RE, labeled);
  s = s.replace(QUERY_RE, (m, head, val) => (val === MASK ? m : (count++, head + MASK)));
  s = s.replace(PASS_PLAIN_RE, labeled);
  s = s.replace(KEY_PLAIN_RE, labeled);
  s = s.replace(URL_CRED_RE, hit);
  s = s.replace(PEM_RE, hit);
  for (const re of VALUE_PATTERNS) s = s.replace(re, hit);
  if (opts.email !== false) s = s.replace(EMAIL_RE, hit);
  return { text: s, count };
}

export function redactText(value) {
  return redactWithCount(value).text;
}

// Təsdiq qeydləri və təsdiq gözləyən qaralama üçün: token və parol maskalanır, e-poçt qalır.
export function redactSecrets(value) {
  return redactWithCount(value, { email: false }).text;
}
