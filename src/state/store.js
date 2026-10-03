// Söhbət yaddaşı və iş tarixçəsi.
// KV (JARVIS_KV) varsa orada, yoxdursa yaddaşda saxlanılır (Worker yenidən başlayanda silinir).
// KV açar adları ("state", "job:...") köhnə versiya ilə eynidir ki, mövcud məlumat itməsin.

const mem = { state: null, jobs: [] };

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
  };
}

export function _resetMemoryForTests() {
  mem.state = null;
  mem.jobs = [];
}
