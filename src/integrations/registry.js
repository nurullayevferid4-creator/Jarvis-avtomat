// Integration Registry: gələcək orkestrator bağlantısı buradan keçəcək.
//
//   JARVIS -> (gələcək orkestrator bağlantısı) -> IntegrationRegistry
//                                                   ├── InstagramAdapter
//                                                   ├── TikTokAdapter
//                                                   ├── YouTubeAdapter
//                                                   ├── TelegramAdapter
//                                                   └── ShopifyAdapter
//
// Bu fayl mövcud orkestratora/alət reyestrinə QOŞULMAYIB.

import { InstagramAdapter } from "./instagram.js";
import { TikTokAdapter } from "./tiktok.js";
import { YouTubeAdapter } from "./youtube.js";
import { TelegramAdapter } from "./telegram.js";
import { ShopifyAdapter } from "./shopify.js";
import { IntegrationError } from "./errors.js";

export const ADAPTER_CLASSES = Object.freeze({ instagram: InstagramAdapter, tiktok: TikTokAdapter, youtube: YouTubeAdapter, telegram: TelegramAdapter, shopify: ShopifyAdapter });

export class IntegrationRegistry {
  constructor() {
    this.map = new Map();
  }
  set(adapter) {
    if (!adapter || typeof adapter.id !== "string" || typeof adapter.run !== "function" || typeof adapter.status !== "function") throw new Error("adapter müqaviləyə uyğun deyil (id, run, status)");
    this.map.set(adapter.id, adapter);
    return this;
  }
  get(id) { return this.map.get(id); }
  has(id) { return this.map.has(id); }
  list() { return [...this.map.keys()]; }
  // Yalnız adlar və true/false (dəyər yox): /api/status kimi yerlərdə göstərilə bilər.
  statuses() { return [...this.map.values()].map((a) => a.status()); }
  // Heç bir adapter çağırışı etmədən əməliyyatı yönləndirir.
  async run(id, op, input) {
    const a = this.map.get(id);
    if (!a) throw new IntegrationError("unknown_operation", "naməlum inteqrasiya", { integration: String(id).slice(0, 30), op: String(op).slice(0, 40) });
    return a.run(op, input);
  }
}

// opts.mock: yalnız testlər/demo üçün (env ilə açılmır). opts.request: şəbəkə funksiyasını əvəz etmək üçün (testlər).
export function createIntegrationRegistry(env = {}, { mock = false, request } = {}) {
  const reg = new IntegrationRegistry();
  for (const Cls of Object.values(ADAPTER_CLASSES)) reg.set(new Cls({ env, mock, ...(request ? { request } : {}) }));
  return reg;
}
