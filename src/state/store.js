// Söhbət yaddaşı, iş tarixçəsi və ümumi sənəd anbarı.
// KV (JARVIS_KV) varsa orada, yoxdursa yaddaşda saxlanılır (Worker yenidən başlayanda silinir).
// KV açar adları ("state", "job:...") köhnə versiya ilə eynidir ki, mövcud məlumat itməsin.
// Yeni sənədlər "<növ>:<id>" açarı ilə saxlanılır (approval, audit, knowledge).

const mem = { state: null, jobs: [], docs: {} };

// Yalnız bu növlərə icazə var. Açar adı kənardan gələn mətnlə düzəldilmir.
export const DOC_KINDS = new Set(["approval", "audit", "knowledge"]);
const ID_RE = /^\d{13}-[0-9a-f]{6}$/;
const MEM_DOC_LIMIT = 500;
const LIST_MAX = 40; // KV oxumaları Cloudflare-də alt sorğu sayılır (pulsuz planda 50 limit)

export function isValidId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

// Yeni sənəd identifikatoru. Ən yeni sənəd KV siyahısında ən əvvəl gəlir.
export function makeId(now = Date.now()) {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return String(9999999999999 - now).padStart(13, "0") + "-" + rand;
}

function need(kind, id) {
  if (!DOC_KINDS.has(kind)) throw new Error("naməlum sənəd növü");
  if (id !== undefined && !isValidId(id)) throw new Error("sənəd id-si düzgün deyil");
}

export function createStore(env) {
  return {
    async load() {
      if (env.JARVIS_KV) {
        const s = await env.JARVIS_KV.get("state", "json");
        return s || { history: [], pending: null };
      }
      if (!mem.state) mem.state = { history: [], pending: null };
      return mem.state;
    },

    async save(s) {
      if (env.JARVIS_KV) await env.JARVIS_KV.put("state", JSON.stringify(s));
      else mem.state = s;
    },

    async saveJob(job) {
      if (env.JARVIS_KV) {
        const key = "job:" + String(9999999999999 - Date.now());
        await env.JARVIS_KV.put(key, JSON.stringify(job), { expirationTtl: 60 * 60 * 24 * 30 });
      } else {
        mem.jobs.unshift(job);
        mem.jobs = mem.jobs.slice(0, 20);
      }
    },

    async listJobs() {
      if (!env.JARVIS_KV) return mem.jobs;
      const l = await env.JARVIS_KV.list({ prefix: "job:", limit: 20 });
      const out = [];
      for (const k of l.keys) {
        const j = await env.JARVIS_KV.get(k.name, "json");
        if (j) out.push(j);
      }
      return out;
    },

    // Ümumi sənədlər
    async putDoc(kind, id, doc, ttlSeconds) {
      need(kind, id);
      if (env.JARVIS_KV) {
        const opts = ttlSeconds ? { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) } : undefined;
        await env.JARVIS_KV.put(kind + ":" + id, JSON.stringify(doc), opts);
        return;
      }
      if (!mem.docs[kind]) mem.docs[kind] = new Map();
      const m = mem.docs[kind];
      m.set(id, doc);
      if (m.size > MEM_DOC_LIMIT) {
        const oldest = [...m.keys()].sort().pop(); // ən böyük id = ən köhnə sənəd
        m.delete(oldest);
      }
    },

    async getDoc(kind, id) {
      need(kind, id);
      if (env.JARVIS_KV) return await env.JARVIS_KV.get(kind + ":" + id, "json");
      const m = mem.docs[kind];
      return (m && m.get(id)) || null;
    },

    // Ən yenidən köhnəyə doğru
    async listDocs(kind, limit = 30) {
      need(kind);
      const n = Math.min(LIST_MAX, Math.max(1, limit | 0));
      if (!env.JARVIS_KV) {
        const m = mem.docs[kind];
        if (!m) return [];
        return [...m.keys()].sort().slice(0, n).map((k) => m.get(k));
      }
      const l = await env.JARVIS_KV.list({ prefix: kind + ":", limit: n });
      const out = [];
      for (const k of l.keys) {
        const d = await env.JARVIS_KV.get(k.name, "json");
        if (d) out.push(d);
      }
      return out;
    },
  };
}

export function _resetMemoryForTests() {
  mem.state = null;
  mem.jobs = [];
  mem.docs = {};
}
