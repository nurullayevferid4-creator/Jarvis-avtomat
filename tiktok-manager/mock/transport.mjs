// MOCK TikTok transport — YALNIZ test və TIKTOK_MOCK=1 üçün. Real API deyil, real nəticə deyil.
// Rəsmi sənəddəki endpoint-ləri və xəta kodlarını təqlid edir; reyestrdə olmayan yola 404 qaytarır
// ki, testlər "uydurma endpoint çağırılmır" qaydasını yoxlaya bilsin.
import { readFileSync } from "node:fs";

const FIX = new URL("./fixtures/", import.meta.url);
const load = (n) => JSON.parse(readFileSync(new URL(n, FIX), "utf8"));

export function createMockTikTok({ audited = false, user, videos, privacyOptions, failInit } = {}) {
  const state = {
    calls: [],
    user: user || load("user.json"),
    videos: videos || load("videos.json"),
    uploads: {},
    published: [],
    tokenIssued: 0,
  };
  const ok = (data, status = 200) => new Response(JSON.stringify({ data, error: { code: "ok", message: "", log_id: "mock" } }), { status, headers: { "content-type": "application/json" } });
  const err = (status, code, message) => new Response(JSON.stringify({ data: {}, error: { code, message, log_id: "mock" } }), { status, headers: { "content-type": "application/json" } });

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || "GET").toUpperCase();
    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || "";
    state.calls.push({ method, host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: !!auth });

    if (u.host === "upload.mock.tiktokapis.com" && method === "PUT") {
      const id = u.pathname.split("/").pop();
      const range = (init.headers && init.headers["content-range"]) || "";
      const m = range.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (!m || !state.uploads[id]) return new Response("", { status: 400 });
      state.uploads[id].received += Number(m[2]) - Number(m[1]) + 1;
      return new Response("", { status: state.uploads[id].received >= Number(m[3]) ? 201 : 206 });
    }
    if (u.host !== "open.tiktokapis.com") return new Response("not found", { status: 404 });

    const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
    const authed = /^Bearer mock_access_/.test(auth);
    const route = method + " " + u.pathname;

    switch (route) {
      case "POST /v2/oauth/token/": {
        const p = new URLSearchParams(init.body);
        if (!p.get("client_key") || !p.get("client_secret")) return new Response(JSON.stringify({ error: "invalid_client", error_description: "missing client" }), { status: 400 });
        if (p.get("grant_type") === "authorization_code" && p.get("code") !== "mock_code_ok") return new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad code" }), { status: 400 });
        state.tokenIssued++;
        return new Response(JSON.stringify({ access_token: "mock_access_" + state.tokenIssued + "_abcdefgh", refresh_token: "mock_refresh_" + state.tokenIssued + "_abcdefgh", open_id: state.user.open_id, scope: "user.info.basic,user.info.profile,user.info.stats,video.list,video.publish,video.upload", expires_in: 86400, refresh_expires_in: 31536000, token_type: "Bearer" }), { status: 200 });
      }
      case "POST /v2/oauth/revoke/": return new Response("", { status: 200 });
    }
    if (!authed) return err(401, "access_token_invalid", "The access token is invalid or not found in the request.");

    switch (route) {
      case "GET /v2/user/info/": {
        const fields = (u.searchParams.get("fields") || "").split(",").filter(Boolean);
        const out = {};
        for (const f of fields) if (f in state.user) out[f] = state.user[f];
        return ok({ user: out });
      }
      case "POST /v2/video/list/": {
        const max = Math.min(20, body.max_count || 10);
        const sorted = [...state.videos].sort((a, b) => b.create_time - a.create_time);
        const before = body.cursor ? sorted.filter((v) => v.create_time * 1000 < body.cursor) : sorted;
        const page = before.slice(0, max);
        const last = page[page.length - 1];
        return ok({ videos: page, cursor: last ? last.create_time * 1000 : 0, has_more: before.length > max });
      }
      case "POST /v2/video/query/": {
        const ids = (body.filters && body.filters.video_ids) || [];
        if (ids.length > 20) return err(400, "invalid_params", "too many ids");
        return ok({ videos: state.videos.filter((v) => ids.includes(v.id)) });
      }
      case "POST /v2/post/publish/creator_info/query/":
        return ok({ creator_username: state.user.username, creator_nickname: state.user.display_name, creator_avatar_url: "", privacy_level_options: privacyOptions || ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"], comment_disabled: false, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 600 });
      case "POST /v2/post/publish/video/init/":
      case "POST /v2/post/publish/inbox/video/init/": {
        if (failInit) return err(failInit.status, failInit.code, failInit.message || "mock failure");
        const direct = u.pathname === "/v2/post/publish/video/init/";
        if (direct && !audited && body.post_info.privacy_level !== "SELF_ONLY") return err(403, "unaudited_client_can_only_post_to_private_accounts", "Please review our integration guidelines");
        if (!body.source_info || body.source_info.source !== "FILE_UPLOAD") return err(400, "invalid_param", "source");
        const id = "v_pub_mock_" + (Object.keys(state.uploads).length + 1);
        state.uploads[id] = { size: body.source_info.video_size, received: 0, direct, post_info: body.post_info || null };
        return ok({ publish_id: id, upload_url: "https://upload.mock.tiktokapis.com/video/" + id });
      }
      case "POST /v2/post/publish/status/fetch/": {
        const up = state.uploads[body.publish_id];
        if (!up) return err(400, "invalid_publish_id", "unknown");
        if (up.received < up.size) return ok({ status: "PROCESSING_UPLOAD", uploaded_bytes: up.received });
        if (!up.direct) return ok({ status: "SEND_TO_USER_INBOX" });
        state.published.push(body.publish_id);
        return ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: up.post_info.privacy_level === "SELF_ONLY" ? [] : ["7999000000000000001"] });
      }
    }
    return err(404, "not_found", "Mock: endpoint not in official API surface");
  }
  return { fetch, state };
}
