// Marketinq mətninin təhlükəsizlik və doğruluq yoxlamaları. Model nəticəsi (və ya şablon) bu süzgəcdən keçmədən
// çıxmır. Qaydalar deterministikdir.
//
//  - stripUnsafe       : HTML, idarəedici simvollar, icazəsiz linklər və <external_content> izləri silinir
//  - findClaims        : qiymət, endirim, faiz, zəmanət və üstünlük iddialarını tapır
//  - unsupportedClaims : iddia giriş məlumatında (sahibin verdiyi mətndə) YOXDURSA "təsdiqsiz" sayılır
//  - normalizeHashtags : #teq formatı, təkrarsız, ən çox max

import { cleanText } from "../security/sanitize.js";

export const LIMITS = {
  instagram: { caption: 2200, hashtags: 30 },
  tiktok: { caption: 2200, hashtags: 30 },
  youtube: { title: 100, description: 5000, hashtags: 15 },
};
export const PLATFORMS = ["instagram", "tiktok", "youtube"];

const URL_RE = /(?:https?:\/\/|www\.)[^\s)>\]"']+/gi;

export function stripUnsafe(text, { allowedLinks = [] } = {}) {
  let s = cleanText(String(text === undefined || text === null ? "" : text), 20000).text;
  s = s.replace(/<\s*\/?\s*external_content[^>]*>/gi, "").replace(/<[^>]{0,200}>/g, "");
  const allowed = new Set(allowedLinks.map((x) => x.replace(/\/+$/, "")));
  s = s.replace(URL_RE, (raw) => {
    const trail = (raw.match(/[.,;:!?]+$/) || [""])[0];
    const core = raw.slice(0, raw.length - trail.length).replace(/\/+$/, "");
    return allowed.has(core) ? raw : "";
  });
  s = s.replace(/javascript:/gi, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

const CLAIM_PATTERNS = [
  /\d[\d\s.,]*\s?(?:₼|azn|manat|man\b|usd|\$|eur|€|rub|₽)/gi, // 20 AZN, 15₼
  /(?:₼|\$|€)\s?\d[\d.,]*/g, // ₼15, $20
  /\d+(?:[.,]\d+)?\s?%/g, // 30%
  /(?<![\p{L}\p{N}])(?:endirim|aksiya|kampaniya|pulsuz|bonus|zəmanət|garanti|sertifikat|orijinal|rekord|yeganə)/giu,
  /(?<![\p{L}\p{N}])(?:discount|sale|free|guarantee|guaranteed|cheapest|best\s+price)(?![\p{L}])/giu,
  /(?:№|#)\s?1\b|nömrə\s?1\b/gi,
  /(?<![\p{L}\p{N}])ən\s+(?:yaxşı|ucuz|sürətli|keyfiyyətli|populyar|çox\s+satılan|böyük)(?![\p{L}])/giu,
];

function squash(s) {
  return String(s).toLocaleLowerCase("az").replace(/\s+/g, " ").trim();
}

// Mətndəki bütün iddia parçaları (təkrarsız)
export function findClaims(text) {
  const out = new Set();
  const t = String(text || "");
  for (const re of CLAIM_PATTERNS) for (const m of t.matchAll(new RegExp(re.source, re.flags))) out.add(squash(m[0]).replace(/[.,;:]+$/, ""));
  return [...out];
}

// supportedText: sahibin giriş mətni (məqsəd, təklif, faktlar, qeydlər). İddia orada olmalıdır.
export function unsupportedClaims(text, supportedText) {
  const nospace = (x) => String(x).replace(/\s+/g, "");
  const sup = nospace(squash(supportedText || ""));
  return findClaims(text).filter((c) => !sup.includes(nospace(c)));
}

export function containsForbidden(text, pattern) {
  return !!(pattern && pattern.test(String(text || "")));
}

// "#Qr Menyu" -> "#qrmenyu". Yalnız hərf, rəqəm, alt xətt. Boş/yararsız -> "".
export function normalizeHashtag(t) {
  let s = String(t || "").toLocaleLowerCase("az").replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  if (!s || s.length > 40 || /^\d+$/.test(s)) return "";
  return "#" + s;
}

export function normalizeHashtags(list, max = 30) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const h = normalizeHashtag(x);
    if (h && !seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
    if (out.length >= max) break;
  }
  return out;
}

// Giriş obyektindən "sahibin dəstəklədiyi mətn": iddialar yalnız burada olarsa icazəlidir
export function supportedTextOf(input) {
  const parts = [input.goal, input.brief, input.topic, input.offer, input.notes, input.audience, ...(Array.isArray(input.themes) ? input.themes : [])];
  if (input.facts && typeof input.facts === "object") parts.push(...Object.values(input.facts));
  return parts.filter((x) => typeof x === "string").join(" \n ");
}

// Obyektdəki bütün sətirləri toplayır (yoxlamalar üçün)
export function collectStrings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}
