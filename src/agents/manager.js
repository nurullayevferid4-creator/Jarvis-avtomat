// Manager hesabatı. YALNIZ qoşulmuş providerlərdən real məlumat toplayır.
// Qoşulmayan bölmə "qoşulmayıb" yazır: sıfır göstərmir (sıfır = "yoxdur" demək olardı, bu isə yalandır).
// Risklər və tövsiyələr deterministik qaydalardandır (aşağıda adları ilə), model çağırışı yoxdur.
//
// Provider müqavilələri (hamısı asinxron, hamısı ixtiyari):
//   leads     : { list() -> [{ id, status, score, created_at, updated_at, last_outreach_ts }] }
//   approvals : { list({ limit }) -> təsdiq qeydləri } (ApprovalCenter birbaşa uyğundur)
//   jobs      : { list({ limit }) -> [{ id, status, updated_at }] }
//   shopify   : { list({ limit }) -> [{ id, status, created_at }] } (createShopifyProvider; token yoxdursa «qoşulmayıb»)
//   marketing : { list({ limit }) -> [{ type, status, created_at }] } (hazırda real provider yoxdur)

import { toAppError } from "../errors.js";
import { HUMAN_APPROVAL_ONLY } from "./definitions.js";

export const MANAGER_RULES = {
  stale_awaiting_days: 3, // təsdiq gözləyən lead bu qədər gündən çox gözləyirsə
  contacted_followup_days: 7, // əl ilə əlaqədən sonra bu qədər gün cavab statusu yoxdursa
  approval_old_hours: 24,
  approval_expiring_hours: 24,
  running_stale_minutes: 60,
};

const HOUR = 3600000;
const DAY = 86400000;
const FUNNEL = ["new", "qualified", "scored", "message_ready", "awaiting_approval", "approved", "contacted_manually", "replied", "won"];
const OFF_FUNNEL = ["filtered_out", "lost", "do_not_contact"];
const LIMIT = 40;

const ts = (v) => (typeof v === "number" ? v : Date.parse(v) || 0);
const countBy = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});

async function readSection(provider, call) {
  if (!provider) return { connected: false, label: "qoşulmayıb" };
  try {
    return { connected: true, status: "ok", ...(await call()) };
  } catch (e) {
    const err = toAppError(e, "manager");
    // Provider «qoşulmayıb» deyirsə (məs. Shopify tokeni yoxdur) bu xəta deyil, qoşulmamış mənbədir
    if (err.code === "AUTH_ERROR" && err.source === "shopify") return { connected: false, label: "qoşulmayıb" };
    return { connected: true, status: "error", error: { code: err.code, message: err.message } };
  }
}

function leadsSection(rows, now) {
  const by_status = countBy(rows, (r) => r.status || "unknown");
  const funnel = FUNNEL.map((stage) => ({ stage, count: by_status[stage] || 0 }));
  const off_funnel = OFF_FUNNEL.map((stage) => ({ stage, count: by_status[stage] || 0 }));
  const contacted = (by_status.contacted_manually || 0) + (by_status.replied || 0) + (by_status.won || 0);
  const answered = (by_status.replied || 0) + (by_status.won || 0);
  const staleAwaiting = rows.filter((r) => r.status === "awaiting_approval" && now - ts(r.updated_at) > MANAGER_RULES.stale_awaiting_days * DAY).length;
  const followup = rows.filter((r) => r.status === "contacted_manually" && now - ts(r.updated_at) > MANAGER_RULES.contacted_followup_days * DAY).length;
  return {
    total: rows.length,
    by_status,
    funnel,
    off_funnel,
    reply_rate_pct: contacted > 0 ? Math.round((answered / contacted) * 1000) / 10 : null,
    reply_rate_note: contacted > 0 ? "cavab (replied+won) / əlaqə qurulanlar; kiçik nümunə ola bilər (" + contacted + ")" : "əlaqə qurulan lead yoxdur: dərəcə hesablanmır",
    stale_awaiting_approval: staleAwaiting,
    contacted_without_update: followup,
  };
}

function approvalsSection(recs, now, limit) {
  const pending = recs.filter((r) => r.status === "pending");
  const view = [...pending]
    .sort((a, b) => ts(a.ts) - ts(b.ts))
    .slice(0, 10)
    .map((r) => ({ id: r.id, action: r.action, risk: r.risk, age_hours: Math.round(((now - ts(r.ts)) / HOUR) * 10) / 10, expires_in_hours: Math.round(((ts(r.expires_at) - now) / HOUR) * 10) / 10 }));
  return {
    sample_size: recs.length,
    truncated: recs.length >= limit,
    by_status: countBy(recs, (r) => r.status || "unknown"),
    pending_count: pending.length,
    pending: view,
    pending_old: pending.filter((r) => now - ts(r.ts) > MANAGER_RULES.approval_old_hours * HOUR).length,
    pending_expiring: pending.filter((r) => ts(r.expires_at) - now < MANAGER_RULES.approval_expiring_hours * HOUR).length,
    execution_unknown: recs.filter((r) => r.execution === "unknown").length,
    execution_failed: recs.filter((r) => r.execution === "failed").length,
    execution_running_stale: recs.filter((r) => r.execution === "running" && now - ts(r.exec_started_at) > MANAGER_RULES.running_stale_minutes * 60000).length,
  };
}

function jobsSection(jobs, now, limit) {
  const by_status = countBy(jobs, (j) => j.status || "unknown");
  const pick = (st) => jobs.filter((j) => j.status === st).slice(0, 10).map((j) => ({ id: j.id, status: j.status }));
  return {
    sample_size: jobs.length,
    truncated: jobs.length >= limit,
    by_status,
    failed: pick("failed"),
    unknown: pick("unknown"),
    partial: pick("partial"),
    running_stale: jobs.filter((j) => (j.status === "running" || j.status === "queued") && now - ts(j.updated_at) > MANAGER_RULES.running_stale_minutes * 60000).length,
  };
}

function simpleListSection(items, limit) {
  return { sample_size: items.length, truncated: items.length >= limit, by_status: countBy(items, (x) => x.status || "unknown") };
}

export async function buildManagerReport({ providers = {}, now = () => Date.now() } = {}) {
  const t = now();
  const sections = {
    leads: await readSection(providers.leads, async () => leadsSection(await providers.leads.list(), t)),
    approvals: await readSection(providers.approvals, async () => approvalsSection(await providers.approvals.list({ limit: LIMIT }), t, LIMIT)),
    jobs: await readSection(providers.jobs, async () => jobsSection(await providers.jobs.list({ limit: LIMIT }), t, LIMIT)),
    shopify: await readSection(providers.shopify, async () => simpleListSection(await providers.shopify.list({ limit: LIMIT }), LIMIT)),
    marketing: await readSection(providers.marketing, async () => simpleListSection(await providers.marketing.list({ limit: LIMIT }), LIMIT)),
  };

  const risks = [];
  const recs = [];
  const risk = (id, severity, message, count) => risks.push({ id, severity, message, ...(count === undefined ? {} : { count }) });
  const rec = (id, priority, text, basis) => recs.push({ id, priority, text, basis });

  const a = sections.approvals;
  if (a.status === "ok") {
    if (a.execution_unknown) risk("approvals.execution_unknown", "high", "Təsdiqlənmiş əməliyyatın nəticəsi bilinmir: xarici sistemdə əl ilə yoxlayın, avtomatik təkrar edilmir.", a.execution_unknown);
    if (a.execution_failed) risk("approvals.execution_failed", "medium", "Təsdiqlənmiş əməliyyat uğursuz bitib.", a.execution_failed);
    if (a.execution_running_stale) risk("approvals.execution_stuck", "medium", "İcrası başlayıb, amma uzun müddətdir bitməyən əməliyyat var.", a.execution_running_stale);
    if (a.pending_expiring) risk("approvals.expiring", "high", "Vaxtı bitmək üzrə olan gözləyən təsdiq var (24 saatdan az).", a.pending_expiring);
    else if (a.pending_old) risk("approvals.old_pending", "medium", "24 saatdan çox gözləyən təsdiq var.", a.pending_old);
    if (a.pending_count) rec("approvals.review_pending", a.pending_expiring ? "high" : "medium", a.pending_count + " gözləyən təsdiq var: baxıb təsdiq və ya rədd edin.", "approvals.pending_count=" + a.pending_count);
    if (a.truncated) rec("approvals.sample", "low", "Yalnız ən son " + a.sample_size + " təsdiq qeydi oxundu: daha köhnələr hesabata düşmür.", "approvals.truncated");
  }
  const j = sections.jobs;
  if (j.status === "ok") {
    if (j.unknown.length) risk("jobs.unknown", "high", "Nəticəsi bilinməyən iş var: platformada əl ilə yoxlayın.", j.unknown.length);
    if (j.failed.length) risk("jobs.failed", "medium", "Uğursuz bitən iş var.", j.failed.length);
    if (j.partial.length) risk("jobs.partial", "medium", "Qismən tamamlanan iş var.", j.partial.length);
    if (j.running_stale) risk("jobs.stuck", "medium", "Uzun müddətdir işləyən/növbədə olan iş var.", j.running_stale);
    if (j.failed.length || j.unknown.length) rec("jobs.inspect", "high", "Uğursuz/naməlum işlərin səbəbini yoxlayın (audit jurnalı və platforma).", "jobs.failed+unknown=" + (j.failed.length + j.unknown.length));
  }
  const l = sections.leads;
  if (l.status === "ok") {
    if (l.stale_awaiting_approval) risk("leads.stale_awaiting", "medium", "Təsdiq gözləyən outreach qaralaması " + MANAGER_RULES.stale_awaiting_days + " gündən çoxdur gözləyir.", l.stale_awaiting_approval);
    if (l.stale_awaiting_approval) rec("leads.resolve_awaiting", "medium", "Köhnəlmiş qaralamaları göndərib təsdiq edin və ya lead.update_status ilə message_ready-ə qaytarın.", "leads.stale_awaiting_approval=" + l.stale_awaiting_approval);
    const scored = l.by_status.scored || 0;
    if (scored) rec("leads.prepare_outreach", "low", scored + " lead qiymətləndirilib, outreach qaralaması hazırlanmayıb (gündə ən çox 5 qaralama).", "leads.by_status.scored=" + scored);
    if (l.contacted_without_update) rec("leads.update_contacted", "low", l.contacted_without_update + " lead-ə " + MANAGER_RULES.contacted_followup_days + " gündən çox əvvəl əl ilə yazılıb: cavab varsa statusu yeniləyin (replied/lost). Təkrar outreach 30 gün keçməmiş mümkün deyil.", "leads.contacted_without_update=" + l.contacted_without_update);
    if (!l.total) rec("leads.empty", "low", "Lead yoxdur: açıq mənbəli namizədləri lead.research ilə əlavə edin (partiyada ən çox 10).", "leads.total=0");
  }

  const notConnected = Object.entries(sections).filter(([, s]) => !s.connected).map(([k]) => k);
  const connectedCount = Object.keys(sections).length - notConnected.length;
  if (!connectedCount) risk("report.no_data", "high", "Heç bir məlumat mənbəyi qoşulmayıb: hesabatda real məlumat yoxdur.");
  for (const k of notConnected) rec("source.not_connected." + k, "low", k + " mənbəyi qoşulmayıb: bu bölmə üçün məlumat yoxdur (sıfır deyil).", "providers." + k + "=missing");
  const errors = Object.entries(sections).filter(([, s]) => s.status === "error").map(([k]) => k);
  for (const k of errors) risk("source.error." + k, "medium", k + " bölməsi oxuna bilmədi: bu bölmənin rəqəmləri hesabatda yoxdur.");

  const order = { high: 0, medium: 1, low: 2 };
  risks.sort((x, y) => order[x.severity] - order[y.severity]);
  recs.sort((x, y) => order[x.priority] - order[y.priority]);

  return {
    generated_at: new Date(t).toISOString(),
    sections,
    not_connected: notConnected,
    risks,
    recommendations: recs,
    human_approval_only: HUMAN_APPROVAL_ONLY,
    note: "Hesabat yalnız qoşulmuş mənbələrin real məlumatlarından hazırlanıb. Qoşulmayan bölmələr 'qoşulmayıb' göstərilir.",
  };
}
