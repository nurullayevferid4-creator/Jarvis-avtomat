// Məxfi məlumatın maskalanması.
//
// Məqsəd: istifadəçi və ya model səhvən token, parol və ya e-poçt yazsa, bu məlumat
// uzunmüddətli yaddaşa (bilik bazası, söhbət tarixçəsi, iş qeydləri, audit) düşməsin.
//
// QAYDALAR VƏ MƏHDUDİYYƏTLƏR
//  - Yalnız TANINAN formatlar tutulur: aşağıdakı prefikslər, "parol: ..." kimi etiketdən sonrakı dəyər və e-poçt.
//    Prefiksi olmayan açarlar (məs. Cloudflare API tokeni) tutulmur.
//  - Telefon nömrələri maskalanmır: sifariş məlumatı üçün lazımdır.
//  - Naxışların hamısı məhduddur, nəzarətsiz təkrar yoxdur: pis niyyətli uzun mətn CPU-nu tükəndirməsin
//    (tests/redact.test.mjs-də ölçülür).
//  - Bu funksiya təsdiq qeydlərinə və təsdiq gözləyən qaralamaya TƏTBİQ OLUNMUR: Fərid nəyi təsdiq edirsə,
//    onu olduğu kimi görməlidir.
//  - Prefikslər ictimai məlumata əsaslanır və hər biri rəsmi sənədlə yoxlanmalıdır (bax Issue #5, ChatGPT hissəsi).

export const MASK = "[gizlədildi]";

// Etiketdən sonrakı dəyər: "parol: Abc123", "password=...", "api key: ...".
const LABEL_RE = /((?:parol|şifrə|sifre|password|passwd|pwd|passcode|token|secret|api[ _-]?key|açar)[ \t]{0,3}[:=][ \t]{0,3})(\S{3,200})/gi;

// Prefiksi məlum olan açarlar. Hamısı məhduddur.
const VALUE_PATTERNS = [
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{10,200}/g, // sk-... (Anthropic, OpenAI və b.)
  /\bBearer[ \t]{1,5}[A-Za-z0-9._~+/=-]{10,500}/gi, // Authorization: Bearer ...
  /\bEAA[A-Za-z0-9]{20,300}/g, // Meta / Facebook giriş tokeni
  /\bgh[pousr]_[A-Za-z0-9]{20,255}/g, // GitHub tokeni
  /\bgithub_pat_[A-Za-z0-9_]{20,255}/g, // GitHub fine-grained tokeni
  /\bxox[abprs]-[A-Za-z0-9-]{10,200}/g, // Slack tokeni
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS giriş açarı identifikatoru
  /\bAIza[0-9A-Za-z_-]{30,50}/g, // Google API açarı
  /\beyJ[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{5,2000}/g, // JWT
];

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g;

// Qaytarır: { text, count }. String olmayan giriş dəyişmədən qaytarılır.
export function redactWithCount(value) {
  if (typeof value !== "string" || !value) return { text: value, count: 0 };
  let count = 0;
  const hit = () => {
    count++;
    return MASK;
  };
  let s = value.replace(LABEL_RE, (m, head, val) => {
    if (val === MASK) return m; // artıq maskalanıb
    count++;
    return head + MASK;
  });
  for (const re of VALUE_PATTERNS) s = s.replace(re, hit);
  s = s.replace(EMAIL_RE, hit);
  return { text: s, count };
}

export function redactText(value) {
  return redactWithCount(value).text;
}
