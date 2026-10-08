// Instagram satış anbarı: lead-lər, satış mərhələləri, təkrar yoxlaması, hadisə dedup-u, göndərmə qaydaları.
// Hamısı "igleads" (lead-lər) və "igevents" (işlənmiş hadisə id-ləri) xam açarlarındadır; yazma koordinator kilidi altında.
// Bu modul şəbəkəyə çıxmır, heç nə göndərmir.

import { AppError } from "../errors.js";
import { normHandle } from "../leads/model.js";
import { cleanText } from "../security/sanitize.js";

export const STAGES = ["NEW", "CONTACTED", "INTERESTED", "QUALIFIED", "NEGOTIATION", "WON", "LOST"];
export const STAGE_TRANSITIONS = {
  NEW: ["CONTACTED", "INTERESTED", "QUALIFIED", "LOST"],
  CONTACTED: ["INTERESTED", "QUALIFIED", "LOST"],
  INTERESTED: ["CONTACTED", "QUALIFIED", "NEGOTIATION", "LOST"],
  QUALIFIED: ["NEGOTIATION", "WON", "LOST"],
  NEGOTIATION: ["QUALIFIED", "WON", "LOST"],
  WON: [],
  LOST: ["NEW"],
};
const MAX_LEADS = 500;
const LOG_MAX = 20;
const EVENTS_MAX = 600;
const HOUR = 3600000;
export const DM_WINDOW_MS = 24 * HOUR; // istifadəçi yazandan sonra cavab pəncərəsi
export const PRIVATE_REPLY_MS = 7 * 24 * HOUR; // şərhə private reply pəncərəsi
export const DAILY_DM_CAP = 30; // platforma limitindən xeyli aşağı, kütləvi göndəriş yoxdur
const BAKU = 4 * HOUR;

export const bakuDay = (ms) => new Date(ms + BAKU).toISOString().slice(0, 10);
const clip = (v, n) => cleanText(String(v == null ? "" : v), n).text.replace(/\s+/g, " ").trim().slice(0, n);

export function scoreLead(l) {
  let s = 10;
  s += l.interest === "hot" ? 50 : l.interest === "warm" ? 25 : 0;
  if (l.asked_price) s += 10;
  if (l.business_type) s += 10;
  if (l.city) s += 5;
  if ((l.inbound_count || 0) >= 2) s += 10;
  if (l.stage === "NEGOTIATION" || l.stage === "QUALIFIED") s += 5;
  return Math.max(0, Math.min(100, s));
}

const INTEREST_RANK = { cold: 0, warm: 1, hot: 2 };

export function createSales({ store, coord = null, now = () => Date.now() }) {
  async function load() {
    const d = await store.getRaw("igleads");
    return d && typeof d === "object" && d.leads ? d : { v: 1, seq: 0, leads: {}, counters: {} };
  }
  async function tx(fn) {
    const run = async () => {
      const st = await load();
      const out = await fn(st);
      await store.putRaw("igleads", st);
      return out;
    };
    return coord ? await coord.withLock("igleads", run, { ttlMs: 10000, waitMs: 5000 }) : await run();
  }

  function findIn(st, { igsid, username }) {
    const u = normHandle(username || "");
    for (const l of Object.values(st.leads)) {
      if (igsid && l.igsid && l.igsid === String(igsid)) return l;
      if (u && l.username === u) return l;
    }
    return null;
  }

  // Dedup: eyni IGSID və ya username → mövcud lead yenilənir. Qaytarır: { lead, created }
  async function upsert(i) {
    return await tx(async (st) => {
      const username = normHandle(i.username || "");
      const igsid = i.igsid ? String(i.igsid).replace(/\D/g, "").slice(0, 30) : "";
      if (!username && !igsid) throw new AppError("VALIDATION_ERROR", "Lead üçün username və ya IGSID lazımdır", { source: "ig.sales" });
      const t = now();
      let l = findIn(st, { igsid, username });
      let created = false;
      if (!l) {
        if (Object.keys(st.leads).length >= MAX_LEADS) throw new AppError("VALIDATION_ERROR", "Lead limiti dolub (" + MAX_LEADS + ")", { source: "ig.sales" });
        st.seq = (st.seq || 0) + 1;
        l = { id: "L" + String(st.seq).padStart(4, "0"), username, igsid, name: "", city: "", business_type: "", reason: "", stage: "NEW", interest: "cold", score: 0, source: clip(i.source || "manual", 20), created_at: t, updated_at: t, inbound_count: 0, outbound_count: 0, asked_price: false, log: [] };
        st.leads[l.id] = l;
        created = true;
      }
      if (username && !l.username) l.username = username;
      if (igsid && !l.igsid) l.igsid = igsid;
      for (const k of ["name", "city", "business_type"]) if (i[k] && !l[k]) l[k] = clip(i[k], 80);
      if (i.reason) l.reason = clip(i.reason, 200);
      if (i.asked_price) l.asked_price = true;
      if (i.interest && INTEREST_RANK[i.interest] > INTEREST_RANK[l.interest]) l.interest = i.interest;
      if (i.inbound) {
        l.inbound_count += 1;
        if (i.kind === "dm") l.last_inbound_at = t;
        if (i.kind === "comment" && i.comment_id) { l.last_comment_id = String(i.comment_id); l.last_comment_at = t; }
        if (l.stage === "NEW" && (l.interest === "hot" || l.interest === "warm")) l.stage = "INTERESTED"; // yalnız irəli, sistem WON/LOST qoymur
      }
      if (i.text) {
        l.log.push({ t, dir: i.inbound ? "in" : "out", kind: i.kind || "note", text: clip(i.text, 300) });
        l.log = l.log.slice(-LOG_MAX);
      }
      l.score = scoreLead(l);
      l.updated_at = t;
      return { lead: { ...l, log: [...l.log] }, created };
    });
  }

  async function get(ref) {
    const st = await load();
    const r = String(ref || "").trim();
    if (st.leads[r.toUpperCase()]) return st.leads[r.toUpperCase()];
    return findIn(st, { username: r, igsid: /^\d{5,30}$/.test(r) ? r : "" });
  }

  async function list({ stage = null, limit = 10 } = {}) {
    const st = await load();
    let a = Object.values(st.leads);
    if (stage) a = a.filter((l) => l.stage === stage);
    return a.sort((x, y) => y.score - x.score || y.updated_at - x.updated_at).slice(0, limit);
  }

  async function setStage(ref, stage, { by = "owner" } = {}) {
    const to = String(stage || "").toUpperCase();
    if (!STAGES.includes(to)) throw new AppError("VALIDATION_ERROR", "Mərhələ: " + STAGES.join(" → "), { source: "ig.sales" });
    return await tx(async (st) => {
      const r = String(ref || "").trim();
      const l = st.leads[r.toUpperCase()] || findIn(st, { username: r });
      if (!l) throw new AppError("NOT_FOUND", "Lead tapılmadı: " + clip(ref, 40), { source: "ig.sales" });
      if (l.stage === to) return { ...l };
      if (!STAGE_TRANSITIONS[l.stage].includes(to)) throw new AppError("VALIDATION_ERROR", l.stage + " → " + to + " keçidi mümkün deyil (icazəli: " + (STAGE_TRANSITIONS[l.stage].join(", ") || "yoxdur") + ")", { source: "ig.sales" });
      l.log.push({ t: now(), dir: "sys", kind: "stage", text: l.stage + " → " + to + " (" + by + ")" });
      l.log = l.log.slice(-LOG_MAX);
      l.stage = to;
      l.updated_at = now();
      l.score = scoreLead(l);
      return { ...l };
    });
  }

  // Göndərmə qaydası. Platformanın icazə verdiyi mexanizm yoxdursa mode:"manual_action_required".
  function sendPolicy(lead, t = now()) {
    if (!lead) return { ok: false, mode: "manual_action_required", reason: "lead tapılmadı" };
    if (lead.stage === "LOST" || lead.do_not_contact) return { ok: false, mode: "manual_action_required", reason: "lead LOST/əlaqə qadağandır" };
    if (lead.igsid && lead.last_inbound_at && t - lead.last_inbound_at <= DM_WINDOW_MS) return { ok: true, mode: "reply", recipient_id: lead.igsid };
    if (lead.last_comment_id && lead.last_comment_at && t - lead.last_comment_at <= PRIVATE_REPLY_MS && !lead.private_reply_used) return { ok: true, mode: "private_reply", comment_id: lead.last_comment_id };
    return { ok: false, mode: "manual_action_required", reason: "Instagram yalnız istifadəçi yazandan sonra 24 saat ərzində cavaba və ya şərhə 7 gün ərzində bir dəfə private reply-a icazə verir. Soyuq DM göndərilmir: əl ilə yazın." };
  }

  // Göndərmədən əvvəl gündəlik limit (atomik sayğac)
  async function reserveDaily() {
    return await tx(async (st) => {
      const d = bakuDay(now());
      st.counters = st.counters && st.counters.day === d ? st.counters : { day: d, dm: 0 };
      if (st.counters.dm >= DAILY_DM_CAP) return false;
      st.counters.dm += 1;
      return true;
    });
  }
  async function releaseDaily() {
    await tx(async (st) => { if (st.counters && st.counters.dm > 0) st.counters.dm -= 1; });
  }

  async function recordOutbound(leadId, { kind, text, private_reply = false }) {
    return await tx(async (st) => {
      const l = st.leads[leadId];
      if (!l) return null;
      const t = now();
      l.outbound_count += 1;
      l.last_outbound_at = t;
      if (private_reply) l.private_reply_used = true;
      if (l.stage === "NEW") l.stage = "CONTACTED";
      l.log.push({ t, dir: "out", kind, text: clip(text, 300) });
      l.log = l.log.slice(-LOG_MAX);
      l.updated_at = t;
      l.score = scoreLead(l);
      return { ...l };
    });
  }

  // Hadisə id-si ilk dəfə görünürsə true (və yadda saxlanır)
  async function firstSeen(id) {
    const key = String(id || "");
    if (!key) return false;
    const run = async () => {
      const d = (await store.getRaw("igevents")) || { ids: [] };
      if (d.ids.includes(key)) return false;
      d.ids.push(key);
      await store.putRaw("igevents", { ids: d.ids.slice(-EVENTS_MAX) });
      return true;
    };
    return coord ? await coord.withLock("igevents", run, { ttlMs: 10000, waitMs: 5000 }) : await run();
  }

  // Gündəlik qəbul sayğacı (hesabat üçün)
  async function bumpRx(kind) {
    await tx(async (st) => {
      const d = bakuDay(now());
      st.rx = st.rx && st.rx.day === d ? st.rx : { day: d, dm: 0, comment: 0, new_leads: 0 };
      if (st.rx[kind] !== undefined) st.rx[kind] += 1;
    });
  }

  async function summary() {
    const st = await load();
    const by = Object.fromEntries(STAGES.map((s) => [s, 0]));
    for (const l of Object.values(st.leads)) by[l.stage] += 1;
    const today = bakuDay(now());
    const rx = st.rx && st.rx.day === today ? st.rx : { dm: 0, comment: 0, new_leads: 0 };
    return { total: Object.keys(st.leads).length, by_stage: by, dm_sent_today: st.counters && st.counters.day === today ? st.counters.dm : 0, dm_received_today: rx.dm, comments_today: rx.comment, new_leads_today: rx.new_leads };
  }

  return { upsert, get, list, setStage, sendPolicy, reserveDaily, releaseDaily, recordOutbound, firstSeen, bumpRx, summary, load };
}

export function presentLead(l) {
  const who = l.username ? "@" + l.username : "IGSID " + l.igsid;
  return l.id + " " + who + " · " + l.stage + " · bal " + l.score + " · " + l.interest + (l.business_type ? " · " + l.business_type : "") + (l.city ? " · " + l.city : "");
}
