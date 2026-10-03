// SSRF qoruması: JARVIS yalnız açıq internetdəki HTTPS ünvanlara qoşula bilər.
//
// Qaydalar: yalnız https, port 443, loqin/parol yoxdur, IP ünvanı yoxdur (IPv4 və IPv6),
// localhost/.internal/.local kimi daxili adlar yoxdur, yönləndirmə hər addımda yenidən yoxlanır.
//
// MƏHDUDİYYƏT: Cloudflare Worker-də DNS cavabını yoxlamaq olmur. Adı açıq görünən, amma daxili
// ünvana yönələn domen bu qatda tutulmur. Bunu Cloudflare-in öz şəbəkə qoruması azaldır, amma
// 100% zəmanət deyil. Bu səbəbdən alət yalnız oxuma edir və nəticəsi etibarsız məzmun sayılır.

export class UnsafeUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const BAD_TLDS = new Set(["localhost", "local", "internal", "localdomain", "lan", "home", "corp", "intranet", "onion"]);

export function assertSafeUrl(input) {
  const raw = String(input === undefined || input === null ? "" : input).trim();
  if (!raw) throw new UnsafeUrlError("ünvan boşdur");
  if (raw.length > 2048) throw new UnsafeUrlError("ünvan çox uzundur");

  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    throw new UnsafeUrlError("ünvan düzgün deyil");
  }
  if (u.protocol !== "https:") throw new UnsafeUrlError("yalnız https ünvanlara icazə var");
  if (u.username || u.password) throw new UnsafeUrlError("ünvanda loqin/parol ola bilməz");
  if (u.port && u.port !== "443") throw new UnsafeUrlError("yalnız 443 portuna icazə var");

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("host boşdur");
  // IPv6 ünvanı (URL onu [..] ilə qaytarır)
  if (host.startsWith("[") || host.includes(":")) throw new UnsafeUrlError("IP ünvanlara icazə yoxdur");
  // IPv4 və onun müxtəlif yazılışları (URL bunları a.b.c.d formasına çevirir)
  if (/^[\d.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) throw new UnsafeUrlError("IP ünvanlara icazə yoxdur");
  if (!host.includes(".")) throw new UnsafeUrlError("daxili ad kimi görünür");

  const tld = host.split(".").pop();
  if (BAD_TLDS.has(tld)) throw new UnsafeUrlError("daxili ad kimi görünür");
  if (/^\d+$/.test(tld)) throw new UnsafeUrlError("IP ünvana oxşayır");
  return u;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const TEXT_TYPE = /^(text\/|application\/(json|xml|xhtml\+xml)|application\/[\w.+-]+\+(json|xml))/i;

async function readLimited(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const t = await res.text();
    return { text: t.slice(0, maxBytes), truncated: t.length > maxBytes };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
  let text = "";
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += dec.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      truncated = true;
      try { await reader.cancel(); } catch (e) { /* əhəmiyyətsiz */ }
      break;
    }
  }
  text += dec.decode();
  return { text: text.slice(0, maxBytes), truncated };
}

// Təhlükəsiz GET. Qaytarır: { ok, status, url, contentType, text, truncated }.
// fetchImpl testlərdə saxta fetch vermək üçündür.
export async function safeFetch(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || ((...a) => globalThis.fetch(...a));
  const timeoutMs = opts.timeoutMs || 10000;
  const maxBytes = opts.maxBytes || 200000;
  const maxRedirects = opts.maxRedirects === undefined ? 3 : opts.maxRedirects;

  let current = assertSafeUrl(url).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": "JARVIS/1.2 personal-assistant", accept: "text/html,text/plain,application/json,application/xml;q=0.9" },
      });
      if (REDIRECTS.has(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) throw new UnsafeUrlError("yönləndirmə ünvanı yoxdur");
        current = assertSafeUrl(new URL(loc, current).toString()).toString();
        continue;
      }
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) return { ok: false, status: res.status, url: current, contentType, text: "", truncated: false };
      if (!TEXT_TYPE.test(contentType)) throw new UnsafeUrlError("məzmun növü dəstəklənmir: " + contentType.slice(0, 60));
      const body = await readLimited(res, maxBytes);
      return { ok: true, status: res.status, url: current, contentType, text: body.text, truncated: body.truncated };
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error("vaxt limiti aşıldı (" + Math.round(timeoutMs / 1000) + " san)");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new UnsafeUrlError("çox yönləndirmə");
}
