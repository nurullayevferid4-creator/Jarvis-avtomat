// YouTube skeleti: kanal/video oxuma interfeysi. Yükləmə/idarəetmə (upload, update, delete) söndürülüb.
// OAuth: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN (hamısı yalnız Cloudflare Secret).
// Bu mərhələdə token mübadiləsi KODLAŞDIRILMAYIB: refresh token yalnız mövcudluğu ilə yoxlanır, heç yerdə saxlanmır/göstərilmir.
// Endpoint-lər və scope-lar rəsmi sənədlə yoxlanmayıb: canlı çağırış söndürülüb.

import { IntegrationAdapter, PAGE_INPUT, EMPTY_INPUT, idSchema } from "./Integration.js";

export const YOUTUBE_OPERATIONS = {
  "channel.get": { kind: "read", description: "Kanal məlumatı", input: EMPTY_INPUT },
  "videos.list": { kind: "read", description: "Kanalın videoları", input: PAGE_INPUT },
  "video.get": { kind: "read", description: "Bir video", input: { type: "object", properties: { video_id: idSchema }, required: ["video_id"], additionalProperties: false } },
  "video.upload": { kind: "write", description: "Video yükləmə (söndürülüb)", input: { type: "object", properties: { title: { type: "string", maxLength: 100 } }, additionalProperties: false } },
  "video.update": { kind: "write", description: "Video redaktəsi (söndürülüb)", input: { type: "object", properties: { video_id: idSchema, title: { type: "string", maxLength: 100 } }, additionalProperties: false } },
  "video.delete": { kind: "write", description: "Video silmə (söndürülüb)", input: { type: "object", properties: { video_id: idSchema }, additionalProperties: false } },
};

export class YouTubeAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "youtube", label: "YouTube (yalnız oxuma)", operations: YOUTUBE_OPERATIONS, endpoints: {}, ...opts });
  }
  get mockHandlers() {
    return {
      "channel.get": () => ({ id: "mock_channel_1", title: "mock kanal", video_count: 1 }),
      "videos.list": (i) => ({ items: [{ id: "mock_yt_1", title: "mock video" }].slice(0, i.limit || 25), next: null }),
      "video.get": (i) => ({ id: i.video_id, title: "mock video" }),
    };
  }
}
