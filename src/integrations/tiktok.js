// TikTok skeleti: hesab/məzmun oxuma interfeysi və gələcək publish üçün yer (söndürülüb).
// Secret adı: TIKTOK_ACCESS_TOKEN (yalnız Cloudflare Secret). Endpoint-lər yoxlanmayıb: canlı çağırış söndürülüb.

import { IntegrationAdapter, PAGE_INPUT, EMPTY_INPUT } from "./Integration.js";

export const TIKTOK_OPERATIONS = {
  "account.get": { kind: "read", description: "Hesab məlumatı", input: EMPTY_INPUT },
  "videos.list": { kind: "read", description: "Videoların siyahısı", input: PAGE_INPUT },
  "video.publish": { kind: "write", description: "Video paylaşımı (söndürülüb)", input: { type: "object", properties: { title: { type: "string", maxLength: 150 } }, additionalProperties: false } },
};

export class TikTokAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "tiktok", label: "TikTok (yalnız oxuma)", operations: TIKTOK_OPERATIONS, endpoints: {}, ...opts });
  }
  get mockHandlers() {
    return {
      "account.get": () => ({ id: "mock_tt_1", display_name: "mock_tiktok", video_count: 1 }),
      "videos.list": (i) => ({ items: [{ id: "mock_video_1", title: "mock video", view_count: 0 }].slice(0, i.limit || 20), next: null }),
    };
  }
}
