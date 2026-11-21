// Hesab yaddaşı. Hər qoşulmuş hesab öz qovluğunda saxlanır; aktiv hesabın profili workspace/account-profile.md-dədir.
// Heç bir hesab kodda hardcode edilmir: hesab dəyişəndə yeni qovluq yaranır və profil yenidən qurulur.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const safeId = (id) => {
  const s = String(id || "").trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(s)) throw new Error("Yanlış hesab identifikatoru");
  return s;
};

export class Workspace {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(join(dir, "accounts"), { recursive: true });
  }

  accountDir(id) {
    const d = join(this.dir, "accounts", safeId(id));
    mkdirSync(d, { recursive: true });
    return d;
  }

  readJson(id, name, fallback) {
    const p = join(this.accountDir(id), name);
    if (!existsSync(p)) return fallback;
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
  }

  writeJson(id, name, data) {
    const p = join(this.accountDir(id), name);
    const tmp = p + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, p);
  }

  writeText(id, name, text) { writeFileSync(join(this.accountDir(id), name), text); }
  readText(id, name) { const p = join(this.accountDir(id), name); return existsSync(p) ? readFileSync(p, "utf8") : null; }

  activeAccount() {
    const p = join(this.dir, "active.json");
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, "utf8")).account_id || null; } catch { return null; }
  }

  // Aktiv hesabı dəyişir. Dəyişibsə true qaytarır: çağıran tərəf analizi yenidən işə salmalıdır.
  setActive(id) {
    const prev = this.activeAccount();
    writeFileSync(join(this.dir, "active.json"), JSON.stringify({ account_id: safeId(id), set_at: new Date().toISOString() }, null, 2));
    return prev !== id;
  }

  publishProfile(id, markdown) {
    this.writeText(id, "account-profile.md", markdown);
    writeFileSync(join(this.dir, "account-profile.md"), markdown);
  }

  accounts() {
    const d = join(this.dir, "accounts");
    return existsSync(d) ? readdirSync(d) : [];
  }
}
