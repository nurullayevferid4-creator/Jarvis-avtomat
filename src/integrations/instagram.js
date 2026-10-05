// Instagram (Instagram API with Instagram Login) skeleti: YALNIZ OXUMA arxitekturası.
// Secret adı: IG_FNPARFUM_TOKEN (yalnız Cloudflare Secret). Paylaşım, şərh cavabı, DM bu mərhələdə söndürülüb (write əməliyyatları).
// Endpoint-lər rəsmi sənədlə yoxlanmayıb: canlı çağırış söndürülüb (bax Integration.js qayda 4).

import { IntegrationAdapter, PAGE_INPUT, EMPTY_INPUT, idSchema } from "./Integration.js";

const INSIGHTS_INPUT = {
  type: "object",
  properties: {
    metrics: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 40 } },
    period: { type: "string", enum: ["day", "week", "days_28", "lifetime"] },
    media_id: idSchema,
  },
  required: ["metrics"],
  additionalProperties: false,
};

export const INSTAGRAM_OPERATIONS = {
  "account.get": { kind: "read", description: "Hesab/profil məlumatı", input: EMPTY_INPUT },
  "media.list": { kind: "read", description: "Son paylaşımların siyahısı", input: PAGE_INPUT },
  "insights.get": { kind: "read", description: "Əsas statistika (gələcək interfeys)", input: INSIGHTS_INPUT },
  // Aşağıdakılar yalnız interfeysdir. HEÇ VAXT icra olunmur (policy.writesEnabled=false).
  "media.publish": { kind: "write", description: "Paylaşım (söndürülüb)", input: { type: "object", properties: { caption: { type: "string", maxLength: 2200 } }, additionalProperties: false } },
  "comments.reply": { kind: "write", description: "Şərhə cavab (söndürülüb)", input: { type: "object", properties: { comment_id: idSchema, text: { type: "string", maxLength: 1000 } }, additionalProperties: false } },
  "messages.send": { kind: "write", description: "DM göndərmə (söndürülüb)", input: { type: "object", properties: { recipient_id: idSchema, text: { type: "string", maxLength: 1000 } }, additionalProperties: false } },
};

export class InstagramAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "instagram", label: "Instagram (yalnız oxuma)", operations: INSTAGRAM_OPERATIONS, endpoints: {}, ...opts });
  }
  // Mock: aşkar saxta, sabit (deterministik) məlumat.
  get mockHandlers() {
    return {
      "account.get": () => ({ id: "mock_account_1", username: "mock_account", account_type: "BUSINESS", media_count: 2 }),
      "media.list": (i) => ({ items: [{ id: "mock_media_1", caption: "mock paylaşım 1", media_type: "IMAGE" }, { id: "mock_media_2", caption: "mock paylaşım 2", media_type: "VIDEO" }].slice(0, i.limit || 25), next: null }),
      "insights.get": (i) => ({ metrics: Object.fromEntries(i.metrics.map((m) => [m, 0])), period: i.period || "day" }),
    };
  }
}
