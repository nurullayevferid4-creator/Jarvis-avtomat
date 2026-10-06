// Sosial API çağırışları üçün fetch qabığı: vaxt limiti, tolerant JSON, token təmizlənməsi.
// Xəta mesajlarında URL, token və cavab gövdəsi olmur.

import { SocialError } from "./errors.js";

export async function socialFetch(url, init = {}, opts = {}) {
  const fetchImpl = opts.fetchImpl || ((...a) => globalThis.fetch(...a));
  const timeoutMs = opts.timeoutMs || 20000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: ctrl.signal, redirect: "manual" });
  } catch (e) {
    if (ctrl.signal.aborted) throw new SocialError("timeout", "vaxt limiti aşıldı", { platform: opts.platform, retriable: true });
    throw new SocialError("api_error", "şəbəkə xətası", { platform: opts.platform, retriable: true });
  } finally {
    clearTimeout(timer);
  }
  let text = "";
  try { text = await res.text(); } catch (e) { text = ""; }
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch (e) { json = null; }
  }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json, text: json ? "" : text.slice(0, 200), headers: res.headers };
}

export function formBody(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p.toString();
}

export function qs(obj) {
  return formBody(obj);
}

// Platforma xəta mətnində təsadüfən token/uzun gizli sətir olarsa maskalayır.
export function redactText(s, max = 160) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/[A-Za-z0-9_\-\.]{32,}/g, "[gizli]")
    .replace(/\s+/g, " ")
    .slice(0, max);
}
