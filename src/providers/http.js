// Provider HTTP çağırışları: hər xəta vahid AppError koduna çevrilir.
// Provider cavabının gövdəsi istifadəçiyə çıxmır (yalnız qısa, təmizlənmiş səbəb).

import { httpRequest, TimeoutError } from "../guards/http.js";
import { AppError } from "../errors.js";

export function providerHttpError(provider, status, body) {
  const s = Number(status) || 0;
  const brief = String(typeof body === "string" ? body : "").replace(/\s+/g, " ").slice(0, 120);
  const label = provider + " " + s;
  if (s === 401) return new AppError("AUTH_ERROR", label + ": açar etibarsızdır və ya yoxdur", { source: provider, retryable: false, detail: brief });
  if (s === 403) return new AppError("PERMISSION_ERROR", label + ": icazə yoxdur", { source: provider, detail: brief });
  if (s === 404) return new AppError("NOT_FOUND", label + ": model və ya ünvan tapılmadı", { source: provider, detail: brief });
  if (s === 408) return new AppError("TIMEOUT", label + ": vaxt limiti", { source: provider, detail: brief });
  if (s === 429) return new AppError("RATE_LIMIT", label + ": limit dolub", { source: provider, detail: brief });
  if (s === 400 || s === 422) return new AppError("VALIDATION_ERROR", label + ": sorğu qəbul edilmədi", { source: provider, retryable: false, detail: brief });
  return new AppError("PROVIDER_ERROR", label + ": " + brief, { source: provider, retryable: s >= 500 || s === 529, detail: brief });
}

// Qaytarır: { data } və ya AppError atır.
export async function providerCall(provider, url, init, timeoutMs) {
  let r;
  try {
    r = await httpRequest(url, init, timeoutMs);
  } catch (e) {
    if (e instanceof TimeoutError || (e && e.name === "TimeoutError")) throw new AppError("TIMEOUT", provider + ": vaxt limiti aşıldı", { source: provider });
    throw new AppError("NETWORK_ERROR", provider + ": şəbəkə xətası", { source: provider, detail: String(e && e.message) });
  }
  if (!r.ok) throw providerHttpError(provider, r.status, r.data);
  if (!r.data || typeof r.data !== "object") throw new AppError("PROVIDER_ERROR", provider + ": cavab formatı düzgün deyil", { source: provider, retryable: true });
  return r.data;
}
