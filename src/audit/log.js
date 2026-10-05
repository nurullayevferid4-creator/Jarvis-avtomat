// Audit jurnalı: kim, nə vaxt, nəyi etdi. Gizli məlumat jurnala düşmür.
//
// Jurnala yalnız təsdiqlənmiş (parolu doğru) sorğular yazılır. Səhv parol cəhdləri yazılmır:
// yoxsa bot hücumu KV yazma limitini doldura bilərdi.

import { makeId } from "../state/store.js";
import { redactText } from "../security/redact.js";

const SECRET_KEY =/(key|token|secret|pass|authorization|cookie|bearer)/i;
const AUDIT_TTL_SECONDS = 60 * 60 * 24 * 30;

export function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  // Əvvəl maskalanır, sonra kəsilir (20000 yalnız CPU üçün üst həddir)
  if (typeof value === "string") return redactText(value.slice(0, 20000)).slice(0, 300);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[çox dərin]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).slice(0, 30)) {
      // Açar adının özü də maskalanır (obyekt açarı kimi token yazıla bilər)
      const name = redactText(String(k).slice(0, 2000)).slice(0, 80);
      out[name] = SECRET_KEY.test(k) ? "[gizlədildi]" : redact(value[k], depth + 1);
    }
    return out;
  }
  return redactText(String(value).slice(0, 20000)).slice(0, 100);
}

export function createAudit(store, now = () => Date.now()) {
  return {
    // Jurnal yazılmasa əsas iş dayanmasın deyə xəta udulur və false qaytarılır.
    async log(event, data = {}) {
      try {
        const id = makeId(now());
        await store.putDoc("audit", id, { id, ts: new Date(now()).toISOString(), event: redactText(String(event).slice(0, 2000)).slice(0, 80), data: redact(data) }, AUDIT_TTL_SECONDS);
        return true;
      } catch (e) {
        return false;
      }
    },
    async list(limit = 30) {
      return await store.listDocs("audit", limit);
    },
  };
}
