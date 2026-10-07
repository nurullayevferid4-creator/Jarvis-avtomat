// Lead anbarı: sənədlər "lead" növündə, yüngül indeks isə "leadidx" xam açarında saxlanır.
//
// İndeks nə üçündür: (1) təkrar yoxlaması bütün lead-lərə qarşı bir oxuma ilə, (2) status/ad üzrə siyahı,
// (3) günlük outreach və araşdırma sayğacları, (4) Manager hesabatı üçün funnel. KV siyahısı 40 qeydlə
// məhdud olduğu üçün (store.js) bu olmadan "bütün lead-lər" üzərində iş mümkün deyil.
//
// Yazma ardıcıllığı: bütün oxu-dəyiş-yaz əməliyyatları tx() daxilində gedir. Proses daxilində növbə,
// çoxlu Worker nüsxəsi arasında isə koordinator kilidi (varsa) işlədilir. Koordinator əlçatmazdırsa
// əməliyyat icra olunmur (fail closed): xəta yuxarı atılır.

import { makeId, isValidId } from "../state/store.js";
import { AppError } from "../errors.js";
import { leadKeys } from "./model.js";
import { MAX_LEADS_TOTAL, DEFAULT_TZ_OFFSET_MIN, dayKey } from "./limits.js";

const INDEX_KEY = "leadidx";
const HISTORY_MAX = 30;
const LOG_KEEP_MS = 3 * 86400000;

function emptyIndex() {
  return { v: 1, entries: [], outreach_log: [], research_log: [] };
}

function lastOutreachTs(doc) {
  let last = 0;
  for (const o of doc.outreach || []) if (o.state !== "cancelled") last = Math.max(last, Date.parse(o.ts) || 0);
  return last;
}

function toEntry(doc) {
  const k = leadKeys(doc);
  return {
    id: doc.id,
    st: doc.status,
    nm: String(doc.business_name || "").slice(0, 60),
    wk: k.wk,
    ik: k.ik,
    tk: k.tk,
    nk: k.nk,
    sc: typeof doc.score === "number" ? doc.score : null,
    ca: doc.created_at,
    ua: doc.updated_at,
    lo: lastOutreachTs(doc) || 0,
  };
}

class Tx {
  constructor(repo) {
    this.repo = repo;
    this.now = repo.now;
    this.index = null;
    this.dirty = false;
  }

  async load() {
    if (this.index) return;
    const raw = await this.repo.store.getRaw(INDEX_KEY);
    this.index = raw && Array.isArray(raw.entries) ? { ...emptyIndex(), ...raw } : emptyIndex();
  }

  async flush() {
    if (!this.dirty) return;
    const cut = this.now() - LOG_KEEP_MS;
    this.index.outreach_log = this.index.outreach_log.filter((x) => x.ts >= cut);
    this.index.research_log = this.index.research_log.filter((x) => x.ts >= cut);
    await this.repo.store.putRaw(INDEX_KEY, this.index);
    this.dirty = false;
  }

  async entries() {
    await this.load();
    return this.index.entries;
  }

  async getLead(id) {
    if (!isValidId(id)) return null;
    const d = await this.repo.store.getDoc("lead", id);
    return d ? structuredClone(d) : null; // yaddaş anbarı eyni obyekti qaytarır: kopya olmasa xəta zamanı yarımçıq dəyişiklik qalar
  }

  // Yeni lead. Qaytarır sənədi. Limit dolubsa VALIDATION_ERROR.
  // trail: [{status, reason}] mərhələ izi; sonuncu status lead-in statusu olur.
  async insertLead(fields, trail = [{ status: "new", reason: "yaradıldı" }]) {
    await this.load();
    if (this.index.entries.length >= MAX_LEADS_TOTAL) throw new AppError("VALIDATION_ERROR", "Lead anbarı doludur (" + MAX_LEADS_TOTAL + "). Köhnə lead-ləri təmizləmək üçün sahibə müraciət edin.");
    const t = this.now();
    const iso = new Date(t).toISOString();
    const status = trail[trail.length - 1].status;
    const history = trail.map((x) => ({ ts: iso, status: x.status, reason: String(x.reason || "").slice(0, 160) }));
    const doc = { ...fields, id: makeId(t), status, score: fields.score === undefined ? null : fields.score, created_at: iso, updated_at: iso, history, outreach: [] };
    await this.repo.store.putDoc("lead", doc.id, doc);
    this.index.entries.unshift(toEntry(doc));
    this.dirty = true;
    return doc;
  }

  // Mövcud lead-i yazır (indeks də yenilənir). statusReason verilsə tarixçəyə sətir əlavə olunur.
  async putLead(doc, { statusReason } = {}) {
    await this.load();
    const t = this.now();
    doc.updated_at = new Date(t).toISOString();
    if (statusReason !== undefined) {
      doc.history = [...(doc.history || []), { ts: doc.updated_at, status: doc.status, reason: String(statusReason).slice(0, 160) }].slice(-HISTORY_MAX);
    }
    await this.repo.store.putDoc("lead", doc.id, doc);
    const i = this.index.entries.findIndex((e) => e.id === doc.id);
    const entry = toEntry(doc);
    if (i >= 0) this.index.entries[i] = entry;
    else this.index.entries.unshift(entry);
    this.dirty = true;
    return doc;
  }

  async logOutreach(leadId, draftId) {
    await this.load();
    this.index.outreach_log.push({ ts: this.now(), id: leadId, d: draftId });
    this.dirty = true;
  }

  async logResearchSaved(n = 1) {
    await this.load();
    for (let i = 0; i < n; i++) this.index.research_log.push({ ts: this.now() });
    this.dirty = true;
  }

  async outreachToday() {
    await this.load();
    const k = dayKey(this.now(), this.repo.tzOffsetMin);
    return this.index.outreach_log.filter((x) => dayKey(x.ts, this.repo.tzOffsetMin) === k).length;
  }

  async researchSavedToday() {
    await this.load();
    const k = dayKey(this.now(), this.repo.tzOffsetMin);
    return this.index.research_log.filter((x) => dayKey(x.ts, this.repo.tzOffsetMin) === k).length;
  }
}

export function createLeadRepo({ store, now = () => Date.now(), coord = null, tzOffsetMin = DEFAULT_TZ_OFFSET_MIN, lockWaitMs = 5000 } = {}) {
  if (!store) throw new Error("lead anbarı üçün store lazımdır");
  const repo = { store, now, tzOffsetMin };
  let chain = Promise.resolve();

  // Bütün yazı əməliyyatları buradan keçir
  repo.tx = function tx(fn) {
    const run = async () => {
      const t = new Tx(repo);
      const exec = async () => {
        const out = await fn(t);
        await t.flush();
        return out;
      };
      if (coord && typeof coord.withLock === "function") return await coord.withLock("leads.write", exec, { ttlMs: 20000, waitMs: lockWaitMs });
      return await exec();
    };
    const p = chain.then(run);
    chain = p.catch(() => {});
    return p;
  };

  repo.getLead = async (id) => {
    if (!isValidId(id)) return null;
    const d = await store.getDoc("lead", id);
    return d ? structuredClone(d) : null;
  };

  repo.entries = async () => {
    const raw = await store.getRaw(INDEX_KEY);
    return raw && Array.isArray(raw.entries) ? raw.entries : [];
  };

  // status / ad parçası üzrə, ən yenidən köhnəyə. limit ≤ 40 (KV oxuma limiti).
  repo.list = async ({ status, query, limit = 20 } = {}) => {
    const n = Math.min(40, Math.max(1, limit | 0));
    const q = String(query || "").toLocaleLowerCase("az").trim();
    const ents = (await repo.entries()).filter((e) => (!status || e.st === status) && (!q || String(e.nm).toLocaleLowerCase("az").includes(q)));
    const out = [];
    for (const e of ents.slice(0, n)) {
      const d = await store.getDoc("lead", e.id);
      if (d) out.push(structuredClone(d));
    }
    return { items: out, total_matching: ents.length };
  };

  // Manager və funnel üçün: yalnız indeks sahələri (şəxsi məzmunsuz)
  repo.summaryRows = async () => (await repo.entries()).map((e) => ({ id: e.id, status: e.st, score: e.sc, created_at: e.ca, updated_at: e.ua, last_outreach_ts: e.lo || null }));

  return repo;
}
