// Bütün xarici API sorğuları buradan keçir: hər birinin vaxt limiti var.
// Cavab gəlməzsə sorğu dayandırılır və xəta atılır (saxta uğur yoxdur).

export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

// as: "json" (standart) və ya "buffer". Uğursuz cavabda data = xəta mətninin ilk 200 simvolu.
export async function httpRequest(url, init, timeoutMs, as = "json") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let data;
    if (!res.ok) data = (await res.text()).slice(0, 200);
    else if (as === "buffer") data = await res.arrayBuffer();
    else data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    if (ctrl.signal.aborted) throw new TimeoutError("vaxt limiti aşıldı (" + Math.round(timeoutMs / 1000) + " san)");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
