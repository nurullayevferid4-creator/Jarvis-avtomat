// /auto əmri və «Nə etdin? / Nə gözləyir? / Nə uğursuz oldu?» cavabları. Model çağırışı YOXDUR (deterministik).
import { loadState, loadHistory, DEFAULT_SCHEDULES } from "./scheduler.js";
import { parseSchedule, nextAfterRun, validSchedule } from "./schedule.js";

const TYPES = Object.keys(DEFAULT_SCHEDULES);
const fmt = (ms) => (ms ? new Date(ms + 4 * 3600000).toISOString().slice(0, 16).replace("T", " ") + " (Bakı)" : "—");
const schedText = (s) => (s.kind === "daily" ? "hər gün " + s.at : s.kind === "every_days" ? "hər " + s.n + " gün " + s.at : "bir dəfə " + fmt(s.at_ms));

// Qaytarır: cavab mətni
export async function autoCommand(store, text, now = Date.now()) {
  const parts = String(text || "").trim().split(/\s+/).slice(1);
  const sub = (parts[0] || "").toLowerCase();
  const state = await loadState(store);
  if (!sub || sub === "status") {
    const jobs = Object.values(state.jobs);
    if (!jobs.length) return "Avtonom iş yoxdur.\nQoşmaq üçün: /auto set <iş> <cədvəl>\nİşlər: " + TYPES.join(", ") + "\nNümunə: /auto set qr_menu.market_research hər gün 09:00";
    return jobs.map((j) => (j.enabled ? "🟢 " : "⚪ ") + j.id + " — " + schedText(j.schedule) + "\n   növbəti: " + fmt(j.next_run_at) + (j.last_status ? " | son: " + j.last_status : "")).join("\n");
  }
  const type = parts[1];
  if (!TYPES.includes(type)) return "Naməlum iş. Mövcud işlər: " + TYPES.join(", ");
  if (sub === "set") {
    const sched = parseSchedule(parts.slice(2).join(" "), now);
    if (!sched || !validSchedule(sched)) return "Cədvəl başa düşülmədi. Nümunə: hər gün 09:00 | hər 3 gün 20:00 | sabah saat 20:00";
    state.jobs[type] = { id: type, type, schedule: sched, enabled: true, attempts: 0, next_run_at: sched.kind === "once" ? sched.at_ms : nextAfterRun(sched, now) };
    if (sched.kind === "once" && sched.at_ms <= now) return "Keçmiş vaxt göstərilib.";
    await store.putRaw("autostate", state);
    return "Quruldu: " + type + " — " + schedText(sched) + ". Növbəti: " + fmt(state.jobs[type].next_run_at) + ". Bu iş heç nə dərc etmir və ya göndərmir.";
  }
  if (sub === "on" || sub === "off") {
    const j = state.jobs[type];
    if (!j) return "Bu iş hələ qurulmayıb. Əvvəl: /auto set " + type + " hər gün 09:00";
    j.enabled = sub === "on";
    if (j.enabled) j.next_run_at = nextAfterRun(j.schedule, now);
    await store.putRaw("autostate", state);
    return type + (j.enabled ? " aktivdir." : " dayandırıldı.");
  }
  return "İstifadə: /auto | /auto set <iş> <cədvəl> | /auto on|off <iş>";
}

// «Nə etdin?» / «Nə gözləyir?» / «Nə uğursuz oldu?» (qısa, deterministik)
export function statusIntent(text) {
  const t = String(text || "").toLocaleLowerCase("az").replace(/[?!.]+$/g, "").trim();
  if (/^(jarvis,? )?n[əe] etdin$/.test(t)) return "did";
  if (/^(jarvis,? )?n[əe] g[öo]zl[əe]yir$/.test(t)) return "waiting";
  if (/^(jarvis,? )?n[əe] u[ğg]ursuz oldu$/.test(t)) return "failed";
  return null;
}

export async function statusAnswer(kind, { store, approvals, flow, now = Date.now() }) {
  const since = now - 24 * 3600000;
  const hist = (await loadHistory(store)).filter((h) => h.ts >= since);
  const jobs = (await flow.listJobs(20).catch(() => [])).filter((j) => Number(j.updated_at || j.created_at || 0) >= since);
  if (kind === "waiting") {
    const pend = await approvals.list({ status: "pending", limit: 30 }).catch(() => []);
    const state = await loadState(store);
    const next = Object.values(state.jobs).filter((j) => j.enabled && j.next_run_at).sort((a, b) => a.next_run_at - b.next_run_at).slice(0, 3);
    return ["⏳ Gözləyən:", "• Təsdiq: " + pend.length + (pend.length ? " (/pending)" : ""), ...next.map((j) => "• " + j.id + " → " + fmt(j.next_run_at))].join("\n");
  }
  if (kind === "failed") {
    const bad = hist.filter((h) => h.status === "failed" || h.status === "retry");
    const badJobs = jobs.filter((j) => /fail|error|unknown/i.test(String(j.status)));
    if (!bad.length && !badJobs.length) return "❌ Son 24 saatda uğursuz iş yoxdur.";
    return ["❌ Uğursuz (son 24 saat):", ...bad.slice(0, 5).map((h) => "• " + h.job + " [" + h.status + "] " + String(h.summary).slice(0, 100)), ...badJobs.slice(0, 5).map((j) => "• paylaşım " + String(j.id).slice(-8) + " [" + j.status + "]")].join("\n");
  }
  const done = hist.filter((h) => h.status === "ok" || h.status === "pending");
  return ["✅ Son 24 saatda:", ...done.slice(0, 6).map((h) => "• " + h.job + " [" + h.status + "]"), "• Paylaşım işləri: " + jobs.length].join("\n");
}
