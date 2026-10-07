// Adapter reyestri: hansı AI modellərinin sistemdə olduğunu burada göstərilir.
//
// Gələcəkdə Kimi və ya Gemini əlavə etmək üçün:
//   1) src/adapters/KimiAdapter.js yaz (BaseAdapter-dən törət, run() yaz)
//   2) bu faylda import et və aşağıdakı reg.set(...) siyahısına bir sətir əlavə et
//   3) lazım olan açarı Cloudflare Secrets-ə yaz
// ClaudeOrchestrator və başqa heç bir fayl dəyişmir.
// Kimi KIMI_API_KEY olanda "kimi" köməkçisi kimi qoşulur (src/adapters/KimiAdapter.js).

import { ClaudeAdapter } from "./ClaudeAdapter.js";
import { OpenAIAdapter } from "./OpenAIAdapter.js";
import { KimiAdapter } from "./KimiAdapter.js";
import { cleanEnvValue } from "../security/envvalue.js";

export class AdapterRegistry {
  constructor() {
    this.map = new Map();
  }
  set(adapter) {
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
  // Kimi: yalnız açar təyin olunubsa köməkçi kimi (ikinci rəy). Lider yenə Claude-dur.
  if (cleanEnvValue(env && env.KIMI_API_KEY)) reg.set(new KimiAdapter(env));
  for (const a of extra) reg.set(a);
  return reg;
}
