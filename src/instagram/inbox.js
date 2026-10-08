// Instagram gələn qutusu: webhook (DM + şərh) və polling eyni ingest yolundan keçir.
// Hər hadisə: dedup → təsnif → lead (təkrar yoxdur) → qaralama cavab → TƏSDİQ QEYDİ → Telegram bildirişi.
// Heç nə avtomatik göndərilmir. Spam/təhqirə cavab hazırlanmır. Tokenlər heç yerdə yazılmır.

import { safeEqual } from "../guards/login.js";
import { allowedIds } from "../telegram/handler.js";
import { cleanText } from "../security/sanitize.js";
import { classifyDm, classifyIgComment, draftDm, draftCommentReply, COMMENT_SENSITIVE } from "./analyze.js";
import { presentLead } from "./sales.js";

const MAX_PER_RUN = 10;
const COMMENT_MAX_AGE_MS = 3 * 86400000;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const show = (s, n = 300) => cleanText(String(s || ""), n).text.replace(/\s+/g, " ").trim();

// ---- webhook təhlükəsizliyi ----
export function verifyChallenge(url, env) {
  const want = String(env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "");
  const q = url.searchParams;
  if (!want || q.get("hub.mode") !== "subscribe" || !safeEqual(q.get("hub.verify_token") || "", want)) return null;
  return String(q.get("hub.challenge") || "");
}

export async function verifySignature(rawBody, header, env) {
  const secret = String(env.INSTAGRAM_APP_SECRET || "");
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header || ""));
  if (!secret || !m) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return safeEqual(sig, m[1].toLowerCase());
}

// Webhook gövdəsi → normallaşmış hadisələr. Tanınmayan formalar atılır.
export function parseWebhook(body) {
  const out = [];
  if (!body || typeof body !== "object" || !Array.isArray(body.entry)) return out;
  for (const e of body.entry) {
    for (const m of Array.isArray(e.messaging) ? e.messaging : []) {
      const msg = m && m.message;
      if (!msg || msg.is_echo || !msg.mid || typeof msg.text !== "string" || !m.sender || !m.sender.id) continue;
      out.push({ type: "dm", id: String(msg.mid), from_id: String(m.sender.id), username: "", text: msg.text, ts: Number(m.timestamp) || 0 });
    }
    for (const c of Array.isArray(e.changes) ? e.changes : []) {
      const v = c && c.value;
      if (!c || c.field !== "comments" || !v || !v.id || typeof v.text !== "string") continue;
      out.push({ type: "comment", id: String(v.id), media_id: v.media && v.media.id ? String(v.media.id) : "", from_id: v.from && v.from.id ? String(v.from.id) : "", username: v.from && v.from.username ? String(v.from.username) : "", text: v.text, parent_id: v.parent_id ? String(v.parent_id) : "", ts: Number(v.timestamp) || 0 });
    }
  }
  return out;
}

export function createInbox({ env, hub, sales, runner, audit = null, now = () => Date.now(), draftFn = draftDm }) {
  const ig = () => hub.adapter("instagram");
  const tg = () => hub.adapter("telegram");
  const log = async (event, data) => { if (audit) await audit.log(event, data); };
  const ownerChat = () => [...allowedIds(env)][0] || null;

  async function notify(text, approvalId = null) {
    const chat = ownerChat();
    if (!chat || !tg().configured()) return false;
    const extra = approvalId ? { reply_markup: { inline_keyboard: [[{ text: "✅ Təsdiq et", callback_data: "ap:" + approvalId + ":y" }, { text: "❌ Ləğv et", callback_data: "ap:" + approvalId + ":n" }]] } } : {};
    try { await tg().sendMessage(chat, text.slice(0, 3900), extra); return true; } catch (e) { return false; }
  }

  async function propose(tool, input) {
    const chat = ownerChat();
    try {
      const r = await runner.propose(tool, input, { origin: chat ? { channel: "telegram", chat_id: chat, user_id: chat } : null, source: "instagram" });
      if (r.status === "pending_approval") return { approval_id: r.approval_id };
      const reason = (r.errors && r.errors.join("; ")) || r.error || r.status;
      return { manual: /manual_action_required/.test(String(reason)), error: String(reason).slice(0, 300) };
    } catch (e) {
      return { error: String((e && e.message) || e).slice(0, 200) };
    }
  }

  async function ingestDm(ev) {
    if (!(await sales.firstSeen("dm:" + ev.id))) return { dup: true };
    const a = classifyDm(ev.text);
    const known = await sales.get(ev.from_id);
    let prof = null;
    if (!known && !ev.username) prof = await ig().userProfile(ev.from_id).catch(() => null);
    const { lead, created } = await sales.upsert({
      igsid: ev.from_id, username: ev.username || (prof && prof.username) || "", name: prof && prof.name, source: "dm", inbound: true, kind: "dm", text: ev.text,
      interest: a.interest, asked_price: a.asked_price, business_type: a.business_type, city: a.city, reason: "DM: " + a.kind,
    });
    await sales.bumpRx("dm");
    if (created) await sales.bumpRx("new_leads");
    await log("instagram.dm.received", { lead_id: lead.id, kind: a.kind, interest: a.interest, created });
    const head = "📩 Instagram DM " + (created ? "(yeni lead)" : "") + "\n" + presentLead(lead) + "\n«" + show(ev.text) + "»\nTəsnif: " + a.kind + " · maraq: " + a.interest;
    if (a.kind === "spam" || a.kind === "abuse") {
      await notify(head + "\n🚫 " + (a.kind === "abuse" ? "Təhqir" : "Spam") + ": cavab hazırlanmadı.");
      return { lead, kind: a.kind };
    }
    const d = await draftFn({ env, text: ev.text, analysis: a });
    const p = await propose("instagram.dm.send", { lead_id: lead.id, text: d.text });
    if (p.approval_id) await notify(head + "\n\nQaralama cavab (" + d.source + "):\n«" + d.text + "»" + (a.needs_owner ? "\n⚠️ Həssas mövzu: göndərməzdən əvvəl yoxla." : "") + "\n\nGöndərilsin?", p.approval_id);
    else await notify(head + "\n\n" + (p.manual ? "🖐 manual action required: " + p.error : "Qaralama hazırlanmadı: " + p.error));
    return { lead, kind: a.kind, approval_id: p.approval_id || null };
  }

  async function ingestComment(ev) {
    if (ev.parent_id) return { skipped: "reply" }; // cavablarla (bizimki daxil) məşğul olmuruq
    const acct = (await ig().record().catch(() => null)) || {};
    const own = (acct.account && acct.account.username) || "";
    if ((acct.user_id && ev.from_id === String(acct.user_id)) || (own && ev.username.toLowerCase() === own.toLowerCase())) return { skipped: "own" };
    if (!(await sales.firstSeen("c:" + ev.id))) return { dup: true };
    const kind = classifyIgComment(ev.text);
    await sales.bumpRx("comment");
    await log("instagram.comment.received", { comment_id: ev.id, kind });
    if (kind === "spam") return { kind }; // səssiz: bildiriş/lead/cavab yoxdur
    let lead = null;
    if (ev.username && (kind === "buy_intent" || kind === "price_question" || kind === "question" || kind === "complaint")) {
      const r = await sales.upsert({ username: ev.username, igsid: ev.from_id, source: "comment", inbound: true, kind: "comment", comment_id: ev.id, text: ev.text, interest: kind === "buy_intent" ? "hot" : kind === "complaint" ? "cold" : "warm", asked_price: kind === "price_question", reason: "Şərh: " + kind });
      lead = r.lead;
      if (r.created) await sales.bumpRx("new_leads");
    }
    const head = "💬 Instagram şərh" + (ev.username ? " @" + ev.username : "") + "\n«" + show(ev.text) + "»\nTəsnif: " + kind + (lead ? "\nLead: " + presentLead(lead) : "");
    if (kind === "abuse") { await notify(head + "\n🚫 Təhqir: cavab hazırlanmadı, lazım olsa Instagram-da əl ilə gizlət/blokla."); return { kind }; }
    const reply = draftCommentReply(kind);
    if (!reply) return { kind, lead };
    const p = await propose("instagram.comment.reply", { comment_id: ev.id, text: reply, author: ev.username.slice(0, 40), original: show(ev.text, 200) });
    if (p.approval_id) await notify(head + "\n\nQaralama (ictimai cavab):\n«" + reply + "»" + (COMMENT_SENSITIVE.has(kind) ? "\n⚠️ Həssas: diqqətlə yoxla." : "") + "\n\nCavab verilsin?", p.approval_id);
    else await notify(head + "\n\nCavab qaralaması hazırlanmadı: " + p.error);
    return { kind, lead, approval_id: p.approval_id || null };
  }

  async function ingest(events) {
    const res = { dms: 0, comments: 0, dup: 0, errors: 0 };
    for (const ev of events.slice(0, MAX_PER_RUN)) {
      try {
        const r = ev.type === "dm" ? await ingestDm(ev) : await ingestComment(ev);
        if (r.dup) res.dup += 1;
        else if (!r.skipped) res[ev.type === "dm" ? "dms" : "comments"] += 1;
      } catch (e) {
        res.errors += 1;
        await log("instagram.ingest_error", { type: ev.type, code: e && e.code, message: String((e && e.message) || "").slice(0, 120) });
      }
    }
    return res;
  }

  // Polling: webhook qurulmayıbsa və ya itibsə. Yalnız oxuma; yeni hadisələr eyni ingest-dən keçir.
  async function pollDms() {
    const { own_id, items } = await ig().recentConversations(15);
    const t = now();
    const events = [];
    for (const c of items) {
      for (const m of (c.messages && c.messages.data) || []) {
        if (!m || !m.id || typeof m.message !== "string" || !m.from || String(m.from.id) === own_id) continue;
        if (t - Date.parse(m.created_time || 0) > 24 * 3600000) continue;
        events.push({ type: "dm", id: String(m.id), from_id: String(m.from.id), username: m.from.username || "", text: m.message, ts: Date.parse(m.created_time) || 0 });
      }
    }
    return await ingest(events);
  }

  async function pollComments(mediaCount = 5) {
    const media = await ig().recentMedia(mediaCount);
    const t = now();
    const events = [];
    for (const m of media) {
      if (!m.comments_count) continue;
      for (const c of await ig().mediaComments(m.id, 15)) {
        if (t - Date.parse(c.timestamp || 0) > COMMENT_MAX_AGE_MS) continue;
        events.push({ type: "comment", id: String(c.id), media_id: String(m.id), from_id: "", username: c.username || "", text: c.text || "", parent_id: "", ts: Date.parse(c.timestamp) || 0 });
      }
    }
    return await ingest(events);
  }

  // "Müştəri tap" (Instagram daxilində real mənbə): son paylaşımların şərhlərindən alış niyyəti olanlar
  async function handleWebhook(body) {
    return await ingest(parseWebhook(body));
  }

  // Manual: lead üçün ilk mesaj qaralaması (yalnız icazəli mexanizm; yoxsa manual_action_required)
  async function draftFirstContact(ref) {
    const lead = await sales.get(ref);
    if (!lead) return { ok: false, text: "Lead tapılmadı." };
    const pol = sales.sendPolicy(lead);
    if (!pol.ok) return { ok: false, manual: true, text: "🖐 manual action required: " + pol.reason };
    const d = await draftFn({ env, text: (lead.log[lead.log.length - 1] || {}).text || "", analysis: { kind: lead.asked_price ? "price" : "buy_intent", needs_owner: !!lead.asked_price } });
    const p = await propose("instagram.dm.send", { lead_id: lead.id, text: d.text });
    if (!p.approval_id) return { ok: false, manual: p.manual, text: (p.manual ? "🖐 manual action required: " : "Qaralama hazırlanmadı: ") + p.error };
    await notify(presentLead(lead) + "\n\nİlk mesaj qaralaması (" + (pol.mode === "reply" ? "cavab" : "şərhə private reply") + "):\n«" + d.text + "»\n\nGöndərilsin?", p.approval_id);
    return { ok: true, approval_id: p.approval_id };
  }

  return { ingest, handleWebhook, pollDms, pollComments, draftFirstContact, notify };
}
