// Günlük Telegram hesabatı (P6). Model çağırışı YOXDUR: yalnız saxlanmış işlərdən deterministik mətn.
// Standart: SÖNDÜRÜLÜB. Yalnız DAILY_REPORT_HOUR (Bakı saatı, 0-23) təyin olunanda işləyir.
// Yalnız TELEGRAM_ALLOWED_CHAT_IDS siyahısındakı öz söhbətinə göndərilir; heç nə dərc/icra olunmur.
import { allowedIds } from "./handler.js";

const BAKU_OFFSET_MS = 4 * 3600 * 1000;

export function reportHour(env) {
  const raw = String((env && env.DAILY_REPORT_HOUR) ?? "").trim();
  if (!/^\d{1,2}$/.test(raw)) return null;
  const h = parseInt(raw, 10);
  return h >= 0 && h <= 23 ? h : null;
}

export function buildReportText({ pending = 0, jobs = [], sinceMs }) {
  const recent = jobs.filter((j) => Number(j.updated_at || j.created_at || 0) >= sinceMs);
  const by = {};
  for (const j of recent) by[j.status] = (by[j.status] || 0) + 1;
  const failed = recent.filter((j) => /fail|error|unknown/i.test(String(j.status)));
  const lines = ["📋 JARVIS gündəlik hesabat (son 24 saat)"];
  lines.push("• Təsdiq gözləyən: " + pending);
  lines.push("• Paylaşım işləri: " + recent.length + (recent.length ? " (" + Object.entries(by).map(([k, v]) => k + ": " + v).join(", ") + ")" : ""));
  if (failed.length) lines.push("• ⚠️ Problemli işlər: " + failed.slice(0, 5).map((j) => String(j.id).slice(-8) + "/" + j.status).join(", ") + " — /jobs yaz");
  if (pending) lines.push("• Qərar üçün /pending yaz.");
  if (!pending && !recent.length) lines.push("• Yeni iş yoxdur.");
  return lines.join("\n");
}

// Qaytarır: { sent: number, reason? }
export async function maybeSendDailyReport({ env, hub, flow, approvals, store, now = Date.now() }) {
  const hour = reportHour(env);
  if (hour === null) return { sent: 0, reason: "disabled" };
  const local = new Date(now + BAKU_OFFSET_MS);
  if (local.getUTCHours() < hour) return { sent: 0, reason: "not_yet" };
  const ids = [...allowedIds(env)];
  if (!ids.length) return { sent: 0, reason: "no_recipient" };
  const key = "dailyreport:" + local.toISOString().slice(0, 10);
  if (await store.getRaw(key)) return { sent: 0, reason: "already_sent" };
  await store.putRaw(key, { t: now }, 172800); // əvvəl qeyd: cron təkrarı iki dəfə göndərməsin
  let pending = 0;
  let jobs = [];
  try { pending = (await approvals.list({ status: "pending", limit: 30 })).length; } catch (e) { /* hesabat yenə də gedir */ }
  try { jobs = await flow.listJobs(30); } catch (e) { /* hesabat yenə də gedir */ }
  const text = buildReportText({ pending, jobs, sinceMs: now - 24 * 3600 * 1000 });
  let sent = 0;
  for (const id of ids) {
    try { await hub.adapter("telegram").sendMessage(id, text); sent++; } catch (e) { /* göndərilməsə də cron pozulmasın */ }
  }
  return { sent };
}
