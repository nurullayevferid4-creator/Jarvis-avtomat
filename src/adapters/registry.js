// Adapter reyestri: hansı AI modellərinin sistemdə olduğunu burada göstərilir.
//
// Gələcəkdə Kimi və ya Gemini əlavə etmək üçün:
//   1) src/adapters/KimiAdapter.js yaz (BaseAdapter-dən törət, run() yaz)
//   2) bu faylda import et və aşağıdakı reg.set(...) siyahısına bir sətir əlavə et
//   3) lazım olan açarı Cloudflare Secrets-ə yaz
// ClaudeOrchestrator və başqa heç bir fayl dəyişmir.
// Hazırda Kimi köməkçi (icraçı) kimi əlavə EDİLMƏYİB.
// Kimi yalnız AUDİTOR kimi var: src/adapters/KimiAuditorAdapter.js. O, bu reyestrə qoşula bilməz
// (auditOnly=true), çünki helpers() siyahısındakı hər adapter lider modelin planında icraçı olur.

import { ClaudeAdapter } from "./ClaudeAdapter.js";
import { OpenAIAdapter } from "./OpenAIAdapter.js";

export class AdapterRegistry {
  constructor() {
    this.map = new Map();
  }
  set(adapter) {
    // Yalnız oxuyan/təhlil edən auditor icraçı köməkçi ola bilməz: cavabı heç vaxt icra yoluna düşməsin.
    if (adapter && adapter.auditOnly === true) throw new Error("auditor adapteri köməkçi reyestrinə qoşula bilməz: " + adapter.id);
    this.map.set(adapter.id, adapter);
    return this;
  }
  get(id) {
    return this.map.get(id);
  }
  has(id) {
    return this.map.has(id);
  }
  // Lider (claude) xaric bütün köməkçilər
  helpers() {
    return [...this.map.values()].filter((a) => a.id !== "claude");
  }
}

// extra: əlavə adapterlər (testlərdə və gələcək modellər üçün)
export function createRegistry(env, extra = []) {
  const reg = new AdapterRegistry();
  reg.set(new ClaudeAdapter(env));
  reg.set(new OpenAIAdapter(env));
  // reg.set(new KimiAdapter(env));   // <- Kimi KÖMƏKÇİ olacaqsa belə əlavə olunar. Auditor bura QOŞULMUR.
  for (const a of extra) reg.set(a);
  return reg;
}
