// EventBus: yalnız ƏLAVƏ edilən (append-only) hadisə jurnalı. Hadisələr "event" sənəd növündə saxlanır.
// Dəyişdirmə və silmə metodu YOXDUR. Abunəçilər yalnız proses daxilindədir (başqa Worker nüsxələrinə çatmır).
//
// Nümunə növlər: lead.created, lead.status_changed, lead.outreach_prepared, lead.contacted_manually, lead.do_not_contact,
// approval.created, job.finished, shopify.order_seen. Növ adı /^[a-z][a-z0-9_.]{2,60}$/ olmalıdır.
// Hadisə məlumatından açar/token kimi sahələr audit redaktoru ilə gizlədilir.

import { makeId } from "../state/store.js";
import { redact } from "../audit/log.js";
import { AppError } from "../errors.js";

const TYPE_RE = /^[a-z][a-z0-9_.]{2,60}$/;
const MAX_DATA_CHARS = 1500;
const EVENT_TTL_SECONDS = 60 * 60 * 24 * 90;

export const KNOWN_EVENT_TYPES = ["lead.created", "lead.status_changed", "lead.outreach_prepared", "lead.contacted_manually", "lead.do_not_contact", "approval.created", "approval.decided", "job.finished", "shopify.order_seen"];

export function createEventBus({ store, now = () => Date.now() } = {}) {
  if (!store) throw new Error("EventBus üçün store lazımdır");
  const subs = []; // { type, fn }

  const bus = {
    // Hadisəni yazır, sonra abunəçilərə bildirir. Abunəçi xətası jurnalı və digər abunəçiləri dayandırmır.
    async emit(type, data = {}) {
      if (typeof type !== "string" || !TYPE_RE.test(type)) throw new AppError("VALIDATION_ERROR", "hadisə növü düzgün deyil");
      let safe = redact(data && typeof data === "object" ? data : { value: data });
      if (JSON.stringify(safe).length > MAX_DATA_CHARS) safe = { truncated: true };
      const t = now();
      const ev = { id: makeId(t), ts: new Date(t).toISOString(), type, data: safe };
      await store.putDoc("event", ev.id, ev, EVENT_TTL_SECONDS);
      for (const s of [...subs]) {
        if (s.type !== "*" && s.type !== type && !(s.type.endsWith(".*") && type.startsWith(s.type.slice(0, -1)))) continue;
        try {
          await s.fn(ev);
        } catch (e) {
          /* abunəçi xətası hadisə yazılmasına təsir etmir */
        }
      }
      return ev;
    },

    // Ən yenidən köhnəyə. limit ≤ 40 (KV oxuma limiti); type verilsə süzülür (nəticə az ola bilər).
    async list({ type, limit = 30 } = {}) {
      const docs = await store.listDocs("event", Math.min(40, Math.max(1, limit | 0)));
      return type ? docs.filter((d) => d.type === type) : docs;
    },

    // type: dəqiq ad, "lead.*" və ya "*". Qaytarır: abunəlikdən çıxma funksiyası
    subscribe(type, fn) {
      if (typeof fn !== "function") throw new AppError("VALIDATION_ERROR", "abunəçi funksiya olmalıdır");
      if (type !== "*" && !/^[a-z][a-z0-9_.]{2,60}(\.\*)?$/.test(String(type))) throw new AppError("VALIDATION_ERROR", "abunə növü düzgün deyil");
      const s = { type, fn };
      subs.push(s);
      return () => {
        const i = subs.indexOf(s);
        if (i >= 0) subs.splice(i, 1);
      };
    },
  };
  return Object.freeze(bus);
}
