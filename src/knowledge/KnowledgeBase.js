// Bilik bazası: JARVIS-in öyrəndiyi faydalı məlumat.
//
// Hər qeyd: növ, başlıq, mətn, mənbə ünvanı, teqlər, etibarlılıq (confidence), uyğunluq (relevance),
// vaxt damğası. Eyni və çox oxşar qeydlər təkrar saxlanmır.
//
// TƏHLÜKƏSİZLİK: trust="external" qeydlərin mətni xarici mənbədəndir (veb, video, sosial şəbəkə).
// Onlar modelə yalnız forPrompt() ilə, <external_content> qutusunda verilməlidir.
//
// MƏHDUDİYYƏT: axtarış yalnız ən son 40 qeyd arasında aparılır (KV oxuma limiti).
// Qeyd sayı artanda D1 (SQL) bazasına keçmək lazım olacaq. Bu, sonrakı mərhələdir.

import { makeId, isValidId } from "../state/store.js";
import { normalize } from "../util.js";
import { wrapExternal } from "../security/sanitize.js";

export const KNOWLEDGE_TYPES = ["source", "document", "transcript", "summary", "fact", "concept", "procedure", "lesson", "decision", "experiment", "proposal"];
const NEAR_DUPLICATE = 0.85;
const SEARCH_WINDOW = 40;
const TTL_SECONDS = 60 * 60 * 24 * 180;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function words(text) {
  return new Set(normalize(text).split(" ").filter((w) => w.length > 2));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function clamp01(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : def;
}

function httpUrlOrNull(u) {
  if (!u) return null;
  try {
    const x = new URL(String(u));
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString().slice(0, 500) : null;
  } catch (e) {
    return null;
  }
}

export class KnowledgeBase {
  constructor(store, audit = null, now = () => Date.now()) {
    this.store = store;
    this.audit = audit;
    this.now = now;
  }

  // item: { type, title, text, source_url?, tags?, confidence?, relevance?, trust? }
  // Qaytarır: { ok:true, status:"added"|"duplicate", id } və ya { ok:false, error }
  async add(item = {}) {
    const type = String(item.type || "");
    if (!KNOWLEDGE_TYPES.includes(type)) return { ok: false, error: "type düzgün deyil" };
    const title = String(item.title || "").trim().slice(0, 200);
    const rawText = String(item.text || "").trim();
    if (!title) return { ok: false, error: "başlıq boşdur" };
    if (!rawText) return { ok: false, error: "mətn boşdur" };
    const trust = item.trust === "external" ? "external" : "owner";
    const wrapped = wrapExternal(rawText, { source: item.source_url || "knowledge", maxLen: 8000 });
    const text = rawText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "").slice(0, 8000);
    const tags = (Array.isArray(item.tags) ? item.tags : []).map((t) => normalize(t).slice(0, 40)).filter(Boolean).slice(0, 10);

    const hash = await sha256Hex(normalize(title + " " + text));
    const wset = words(title + " " + text);
    const recent = await this.store.listDocs("knowledge", SEARCH_WINDOW);
    for (const r of recent) {
      if (r.hash === hash || jaccard(wset, words(r.title + " " + r.text)) >= NEAR_DUPLICATE) {
        return { ok: true, status: "duplicate", id: r.id };
      }
    }

    const t = this.now();
    const id = makeId(t);
    const rec = {
      id,
      ts: new Date(t).toISOString(),
      type,
      title,
      text,
      source_url: httpUrlOrNull(item.source_url),
      tags,
      confidence: clamp01(item.confidence, 0.5),
      relevance: clamp01(item.relevance, 0.5),
      trust,
      flagged: wrapped.flagged,
      findings: wrapped.findings,
      hash,
    };
    await this.store.putDoc("knowledge", id, rec, TTL_SECONDS);
    if (this.audit) await this.audit.log("knowledge.add", { id, type, trust, flagged: rec.flagged });
    return { ok: true, status: "added", id };
  }

  async get(id) {
    if (!isValidId(id)) return null;
    return await this.store.getDoc("knowledge", id);
  }

  // Sadə açar söz axtarışı: başlıq > teq > mətn, sonra relevance və confidence.
  // window (istəyə bağlı): neçə ən son qeydə baxılsın (standart 40). Orkestrator hər sorğuda axtardığı üçün KV alt sorğu limitinə görə kiçik pəncərə verir.
  async search(query, { limit = 5, type, window = SEARCH_WINDOW } = {}) {
    const q = [...words(query)];
    if (!q.length) return [];
    const docs = await this.store.listDocs("knowledge", Math.min(SEARCH_WINDOW, Math.max(1, window | 0)));
    const scored = [];
    for (const d of docs) {
      if (type && d.type !== type) continue;
      const title = normalize(d.title);
      const body = normalize(d.text);
      let score = 0;
      for (const w of q) {
        if (title.includes(w)) score += 3;
        if ((d.tags || []).some((t) => t.includes(w))) score += 2;
        if (body.includes(w)) score += 1;
      }
      if (score > 0) scored.push({ score: score + d.relevance * 0.5 + d.confidence * 0.25, d });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(10, Math.max(1, limit | 0))).map((s) => {
      const pub = { ...s.d };
      delete pub.hash;
      return pub;
    });
  }

  // Modelə vermək üçün mətn. Xarici mənbəli qeydlər etibarsız qutuya salınır.
  forPrompt(items) {
    return items
      .map((r) => {
        const head = "[" + r.type + "] " + r.title + (r.source_url ? " (" + r.source_url + ")" : "");
        const body = r.trust === "external" ? wrapExternal(r.text, { source: r.source_url || "knowledge" }).text : r.text;
        return head + "\n" + body;
      })
      .join("\n\n");
  }
}
