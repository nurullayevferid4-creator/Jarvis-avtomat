// Təsdiq sübutu (ApprovalProof): "Fərid bu konkret əməliyyatı təsdiqləyib" faktının kodda təmsili.
//
// Qaydalar:
//  - Sübut yalnız ApprovalExecutor tərəfindən, təsdiqlənmiş (status "approved") tool_call qeydindən qurulur.
//  - Sübut alətin adına, giriş məlumatının heş-inə və təsdiq qeydinin id-sinə bağlıdır: başqa alət və ya dəyişdirilmiş
//    giriş ilə istifadə oluna bilməz.
//  - Sübut tək istifadəliyidir (consume), icra pəncərəsi məhduddur.
//  - Yazma (write) əməliyyatları və təsdiq tələb edən alətlər sübutsuz icra olunmur (adapter və alət qatında ayrıca yoxlanır).
//  - mintProof yalnız src/approval/executor.js tərəfindən import olunmalıdır (testlə yoxlanır).

const minted = new WeakMap(); // proof obyekti -> { used:false }

// Açar sırasına görə sabit JSON: eyni giriş həmişə eyni heş verir.
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

export async function hashInput(input) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(input)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function mintProof({ approvalId, tool, inputHash, expiresAt }) {
  const proof = Object.freeze({ kind: "approval_proof", approvalId: String(approvalId), tool: String(tool), inputHash: String(inputHash), expiresAt: Number(expiresAt) });
  minted.set(proof, { used: false });
  return proof;
}

// Sübutu yoxlayır. Uğurlu olarsa istifadə olunmuş sayılmır (consume ayrıca çağırılır).
export async function checkProof(proof, { tool, input, now = Date.now() } = {}) {
  const st = proof && typeof proof === "object" ? minted.get(proof) : null;
  if (!st) return { ok: false, reason: "no_proof" };
  if (st.used) return { ok: false, reason: "proof_used" };
  if (proof.expiresAt < now) return { ok: false, reason: "proof_expired" };
  if (proof.tool !== tool) return { ok: false, reason: "tool_mismatch" };
  if (proof.inputHash !== (await hashInput(input))) return { ok: false, reason: "input_mismatch" };
  return { ok: true };
}

export function consumeProof(proof) {
  const st = proof && typeof proof === "object" ? minted.get(proof) : null;
  if (!st || st.used) return false;
  st.used = true;
  return true;
}

// Yoxla və dərhal istifadə olunmuş say. Qaytarır: { ok, reason? }
export async function useProof(proof, expect) {
  const c = await checkProof(proof, expect);
  if (!c.ok) return c;
  return consumeProof(proof) ? { ok: true } : { ok: false, reason: "proof_used" };
}
