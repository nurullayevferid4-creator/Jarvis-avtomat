// Sadə cədvəl modeli (Asia/Baku, UTC+4, yay saatı yoxdur).
//   { kind: "daily", at: "HH:MM" } | { kind: "every_days", n, at } | { kind: "once", at_ms }
const BAKU = 4 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;

const hm = (s) => {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h <= 23 && mi <= 59 ? h * 3600000 + mi * 60000 : null;
};

// Bakı təqvim günündə HH:MM-in UTC ms qarşılığı (dayStartBakuMs = həmin günün Bakı 00:00-ı, UTC ms)
const bakuMidnight = (ms) => Math.floor((ms + BAKU) / DAY) * DAY - BAKU;

export function validSchedule(s) {
  if (!s || typeof s !== "object") return false;
  if (s.kind === "daily") return hm(s.at) !== null;
  if (s.kind === "every_days") return Number.isInteger(s.n) && s.n >= 1 && s.n <= 30 && hm(s.at) !== null;
  if (s.kind === "once") return Number.isFinite(s.at_ms);
  return false;
}

// «hər gün 09:00», «hər 3 gün 20:00», «sabah saat 20:00», «bu gün 18:30»
export function parseSchedule(text, now = Date.now()) {
  const t = String(text || "").toLocaleLowerCase("az").replace(/\s+/g, " ").trim();
  const time = /(\d{1,2}[:.]\d{2})/.exec(t);
  const at = time ? time[1].replace(".", ":").padStart(5, "0") : null;
  if (at === null || hm(at) === null) return null;
  let m;
  if ((m = /h[əe]r (\d{1,2}) g[üu]n/.exec(t))) return { kind: "every_days", n: +m[1], at };
  if (/h[əe]r g[üu]n/.test(t)) return { kind: "daily", at };
  const base = bakuMidnight(now);
  if (/sabah/.test(t)) return { kind: "once", at_ms: base + DAY + hm(at) };
  if (/bu g[üu]n/.test(t)) return { kind: "once", at_ms: base + hm(at) };
  return null;
}

// afterMs-dən SONRAKI ilk icra anı; olmazsa null (bir dəfəlik keçib)
export function nextRun(s, afterMs) {
  if (!validSchedule(s)) return null;
  if (s.kind === "once") return s.at_ms > afterMs ? s.at_ms : null;
  const t = hm(s.at);
  let d = bakuMidnight(afterMs) + t;
  while (d <= afterMs) d += DAY;
  return d; // every_days üçün sonrakı slotu scheduler özü n gün irəli aparır
}

export const nextAfterRun = (s, ranAtMs) => {
  if (s.kind === "every_days") return bakuMidnight(ranAtMs) + s.n * DAY + hm(s.at);
  return nextRun(s, ranAtMs);
};
