import { test } from "node:test";
import assert from "node:assert/strict";
import { json, installSocialFetch, bodyParams, bodyJson, world, seedToken, MP4, JPG } from "./social-helpers.mjs";
import { normalizePublishRequest, composeCaption, normalizeHashtags } from "../src/social/request.js";
import { describeToken } from "../src/social/tokens.js";
import { SocialError } from "../src/social/errors.js";

const HOUR = 3600000;
const DAY = 24 * HOUR;

// ---------- sorğu normallaşdırma ----------
test("request: privacy standart private, hashtag təmizlənir, naməlum platforma rədd olunur", () => {
  const r = normalizePublishRequest({ platforms: ["instagram"], caption: "Salam", media_url: "https://cdn.example.com/a.jpg", media_type: "image", hashtags: ["#ətir", "ətir", "yeni kolleksiya", "ok_1"] });
  assert.equal(r.privacy, "private");
  assert.deepEqual(r.hashtags, ["ətir", "ok_1"]);
  assert.throws(() => normalizePublishRequest({ platform: "myspace", caption: "x" }), (e) => e instanceof SocialError && e.code === "invalid_request");
  assert.throws(() => normalizePublishRequest({ platform: "instagram", caption: "  " }), /caption/);
});

test("request: SSRF, media_id formatı və media növü yoxlanır", () => {
  const base = { platform: "instagram", caption: "x", media_type: "image" };
  for (const bad of ["http://cdn.example.com/a.jpg", "https://127.0.0.1/a.jpg", "https://localhost/a.jpg", "https://169.254.169.254/x", "https://user:pw@cdn.example.com/a"]) {
    assert.throws(() => normalizePublishRequest({ ...base, media_url: bad }), /media_url/, bad);
  }
  assert.throws(() => normalizePublishRequest({ ...base, media_id: "../../etc/passwd" }), /media_id/);
  assert.throws(() => normalizePublishRequest({ ...base, media_id: "a".repeat(24), media_url: "https://cdn.example.com/a.jpg" }), /birlikdə/);
  assert.throws(() => normalizePublishRequest({ platform: "tiktok", caption: "x", media_id: "a".repeat(24), media_type: "image" }), /image dəstəklənmir/);
  assert.throws(() => normalizePublishRequest({ platform: "youtube", caption: "x" }), /media lazımdır/);
  // strict:false → çatışmazlıq issue kimi qaytarılır
  const soft = normalizePublishRequest({ platform: "instagram", caption: "x" }, { strict: false });
  assert.ok(soft.issues.length >= 1);
});

test("request: caption + hashtag platformanın limitini aşmır", () => {
  const long = "a".repeat(2190);
  const c = composeCaption("instagram", long, ["uzunhashtag1", "uzunhashtag2"]);
  assert.ok(c.length <= 2200);
  assert.ok(c.startsWith("a".repeat(2190)));
  assert.deepEqual(normalizeHashtags(["#a", "#a", "", null, "b c"]), ["a"]);
});

// ---------- token anbarı ----------
test("token anbarı: TOKEN_ENC_KEY ilə şifrələnir, açar olmadan oxunmur, status token mətni vermir", async () => {
  const w = world({ TOKEN_ENC_KEY: "enc-key-test" });
  await seedToken(w, "instagram", { access_token: "SECRET_ACCESS_VALUE", expires_at: w.now() + 10 * DAY, user_id: "1" });
  const raw = JSON.stringify(await w.store.getRaw("secret:instagram"));
  assert.ok(!raw.includes("SECRET_ACCESS_VALUE"), "KV-də açıq token qalıb");
  assert.equal((await w.hub.vault.get("instagram")).access_token, "SECRET_ACCESS_VALUE");
  const s = await w.hub.adapter("instagram").status();
  assert.equal(s.state, "CONNECTED");
  assert.ok(!JSON.stringify(s).includes("SECRET_ACCESS_VALUE"));
  const d = describeToken(await w.hub.vault.get("instagram"), w.now());
  assert.equal(d.expires_in_days, 10);
  // açar dəyişərsə oxunmur
  const w2 = world({ TOKEN_ENC_KEY: "other-key" });
  await w2.store.putRaw("secret:instagram", await w.store.getRaw("secret:instagram"));
  assert.equal(await w2.hub.vault.get("instagram"), null);
});

test("status: secret yoxdursa NOT_CONNECTED, token bitibsə TOKEN_EXPIRED", async () => {
  const w = world({ TIKTOK_CLIENT_KEY: "" });
  assert.equal((await w.hub.adapter("tiktok").status()).state, "NOT_CONNECTED");
  assert.equal((await w.hub.adapter("youtube").status()).state, "NOT_CONNECTED"); // secret var, token yoxdur
  await seedToken(w, "instagram", { access_token: "x", expires_at: w.now() - 1000, user_id: "1" });
  assert.equal((await w.hub.adapter("instagram").status()).state, "TOKEN_EXPIRED");
});

// ---------- Instagram ----------
function igRoutes(extra = []) {
  return [
    ...extra,
    [/api\.instagram\.com\/oauth\/access_token/, () => json({ data: [{ access_token: "SHORT_T", user_id: "178", permissions: ["instagram_business_basic", "instagram_business_content_publish"] }] })],
    [/graph\.instagram\.com\/access_token\?/, () => json({ access_token: "LONG_T", token_type: "bearer", expires_in: 5184000 })],
    [/graph\.instagram\.com\/refresh_access_token/, () => json({ access_token: "REFRESHED_T", token_type: "bearer", expires_in: 5184000 })],
    [/graph\.instagram\.com\/v25\.0\/me\?/, () => json({ user_id: "178", username: "farid_test", account_type: "BUSINESS" })],
  ];
}

test("Instagram: OAuth ünvanı doğru scope/state ilə, kod mübadiləsi token saxlayır (60 gün)", async () => {
  const w = world();
  const calls = installSocialFetch(igRoutes());
  const ig = w.hub.adapter("instagram");
  const u = new URL(ig.authUrl("st1", "https://jarvis.example.dev/oauth/instagram/callback"));
  assert.equal(u.origin + u.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(u.searchParams.get("scope"), "instagram_business_basic,instagram_business_content_publish");
  assert.equal(u.searchParams.get("state"), "st1");
  assert.ok(!u.search.includes("ig-secret"), "app secret URL-də olmamalıdır");

  const r = await ig.exchangeCode("CODE123#_", "https://jarvis.example.dev/oauth/instagram/callback");
  assert.equal(r.account.username, "farid_test");
  assert.equal(bodyParams(calls[0]).get("code"), "CODE123", "sondakı #_ silinməlidir");
  const rec = await w.hub.vault.get("instagram");
  assert.equal(rec.access_token, "LONG_T");
  assert.equal(describeToken(rec, w.now()).expires_in_days, 60);
  assert.equal((await ig.status({ verify: true })).account.username, "farid_test");
});

test("Instagram: token yeniləmə yalnız ≥24 saat köhnə və vaxtı bitməmiş tokenlə", async () => {
  const w = world();
  const calls = installSocialFetch(igRoutes());
  const ig = w.hub.adapter("instagram");
  await seedToken(w, "instagram", { access_token: "OLD", user_id: "178", obtained_at: w.now() - HOUR, expires_at: w.now() + 5 * DAY });
  await ig.maybeRefresh();
  assert.equal(calls.filter((c) => c.url.includes("refresh_access_token")).length, 0, "24 saatdan tez yenilənməməlidir");
  w.advanceTime(2 * DAY);
  assert.equal(await ig.maybeRefresh(), true);
  assert.equal((await w.hub.vault.get("instagram")).access_token, "REFRESHED_T");
  // vaxtı bitmiş token yenilənmir
  await seedToken(w, "instagram", { access_token: "DEAD", user_id: "178", obtained_at: w.now() - 70 * DAY, expires_at: w.now() - DAY });
  await assert.rejects(() => ig.refresh({ access_token: "DEAD", expires_at: w.now() - DAY }), (e) => e.code === "token_expired");
});

test("Instagram: şəkil paylaşımı: konteyner → status → media_publish → post id + link", async () => {
  const w = world();
  let statusPolls = 0;
  const calls = installSocialFetch(igRoutes([
    [/\/178\/media_publish/, () => json({ id: "POST_999" })],
    [/\/178\/media$/, () => json({ id: "CONT_1" })],
    [/\/CONT_1\?/, () => json({ status_code: ++statusPolls < 2 ? "IN_PROGRESS" : "FINISHED" })],
    [/\/POST_999\?/, () => json({ permalink: "https://www.instagram.com/p/ABC/" })],
  ]));
  await seedToken(w, "instagram", { access_token: "LONG_T", user_id: "178", obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  const ig = w.hub.adapter("instagram");
  const req = normalizePublishRequest({ platform: "instagram", caption: "Yeni ətir", hashtags: ["ətir"], media_url: "https://cdn.example.com/a.jpg", media_type: "image" });
  const t = { step: "new", data: {} };
  assert.equal(await ig.start(req, t), "waiting");
  const create = calls.find((c) => /\/178\/media$/.test(c.url));
  const p = bodyParams(create);
  assert.equal(p.get("image_url"), "https://cdn.example.com/a.jpg");
  assert.equal(p.get("caption"), "Yeni ətir\n\n#ətir");
  assert.equal(p.has("media_type"), false);
  assert.equal(await ig.check(req, t), "waiting");
  assert.equal(await ig.check(req, t), "ready");
  assert.equal(calls.filter((c) => c.url.includes("media_publish")).length, 0, "check mərhələsində paylaşım olmamalıdır");
  assert.equal(await ig.commit(req, t), "done");
  assert.equal(t.post_id, "POST_999");
  assert.equal(t.post_url, "https://www.instagram.com/p/ABC/");
});

test("Instagram: Reel video_url + media_type=REELS; yüklənmiş media imzalı ünvanla verilir", async () => {
  const w = world();
  const calls = installSocialFetch(igRoutes([[/\/178\/media$/, () => json({ id: "CONT_R" })]]));
  await seedToken(w, "instagram", { access_token: "LONG_T", user_id: "178", obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  const m = await w.hub.media.put(MP4, "video/mp4");
  const req = normalizePublishRequest({ platform: "instagram", caption: "Reel", media_id: m.id, media_type: "video" });
  await w.hub.adapter("instagram").start(req, { step: "new", data: {} });
  const p = bodyParams(calls.find((c) => /\/178\/media$/.test(c.url)));
  assert.equal(p.get("media_type"), "REELS");
  const v = new URL(p.get("video_url"));
  assert.equal(v.origin, "https://jarvis.example.dev");
  assert.match(v.pathname, new RegExp("^/media/" + m.id + "\\.mp4$"));
  assert.ok(v.searchParams.get("sig") && v.searchParams.get("exp"));
});

test("Instagram: API xətaları təsnif olunur (190 → token_expired, 4 → rate_limited, 10 → permission_denied) və token sızmır", async () => {
  const w = world();
  await seedToken(w, "instagram", { access_token: "LONG_T_SECRET", user_id: "178", obtained_at: w.now(), expires_at: w.now() + 30 * DAY });
  const ig = w.hub.adapter("instagram");
  const req = normalizePublishRequest({ platform: "instagram", caption: "x", media_url: "https://cdn.example.com/a.jpg", media_type: "image" });
  for (const [code, want] of [[190, "token_expired"], [4, "rate_limited"], [10, "permission_denied"], [100, "invalid_request"]]) {
    installSocialFetch([[/\/178\/media$/, () => json({ error: { message: "msg " + code, type: "OAuthException", code } }, 400)]]);
    await assert.rejects(() => ig.start(req, { step: "new", data: {} }), (e) => {
      assert.equal(e.code, want);
      assert.ok(!JSON.stringify(e.toJSON()).includes("LONG_T_SECRET"));
      return true;
    });
  }
  installSocialFetch([[/\/178\/media$/, () => new Response("<html>oops</html>", { status: 502 })]]);
  await assert.rejects(() => ig.start(req, { step: "new", data: {} }), (e) => e.code === "api_error" && e.retriable === true);
});

test("Instagram: konteyner ERROR statusu xəta verir; token qoşulmayıbsa not_connected", async () => {
  const w = world();
  const ig = w.hub.adapter("instagram");
  const req = normalizePublishRequest({ platform: "instagram", caption: "x", media_url: "https://cdn.example.com/a.jpg", media_type: "image" });
  installSocialFetch([]);
  await assert.rejects(() => ig.start(req, { step: "new", data: {} }), (e) => e.code === "not_connected");
  await seedToken(w, "instagram", { access_token: "T", user_id: "178", obtained_at: w.now(), expires_at: w.now() + DAY * 30 });
  installSocialFetch([[/\/C9\?/, () => json({ status_code: "ERROR" })]]);
  await assert.rejects(() => ig.check(req, { data: { container_id: "C9" } }), (e) => e.code === "api_error" && /ERROR/.test(e.message));
});

// ---------- TikTok ----------
const ok = (data) => json({ data, error: { code: "ok", message: "", log_id: "L" } });

async function tiktokWorld(options = ["SELF_ONLY"]) {
  const w = world();
  await seedToken(w, "tiktok", { access_token: "TT_ACCESS", refresh_token: "TT_REFRESH", obtained_at: w.now(), expires_at: w.now() + HOUR, refresh_expires_at: w.now() + 300 * DAY });
  const m = await w.hub.media.put(MP4, "video/mp4");
  return { w, m, options };
}

test("TikTok: OAuth ünvanı və kod mübadiləsi (form-encoded, refresh token saxlanır)", async () => {
  const w = world();
  const calls = installSocialFetch([[/open\.tiktokapis\.com\/v2\/oauth\/token/, () => json({ access_token: "TA", expires_in: 86400, refresh_token: "TR", refresh_expires_in: 31536000, open_id: "oid", scope: "user.info.basic,video.publish" })]]);
  const tt = w.hub.adapter("tiktok");
  const u = new URL(tt.authUrl("s2", "https://jarvis.example.dev/oauth/tiktok/callback"));
  assert.equal(u.origin + u.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(u.searchParams.get("client_key"), "tt-key");
  assert.match(u.searchParams.get("scope"), /video\.publish/);
  assert.ok(!u.search.includes("tt-secret"));
  await tt.exchangeCode("CODE", "https://jarvis.example.dev/oauth/tiktok/callback");
  const p = bodyParams(calls[0]);
  assert.equal(p.get("grant_type"), "authorization_code");
  assert.equal(calls[0].headers["content-type"], "application/x-www-form-urlencoded");
  const rec = await w.hub.vault.get("tiktok");
  assert.equal(rec.refresh_token, "TR");
  assert.equal(describeToken(rec, w.now()).expires_in_days, 1);
});

test("TikTok: yükləmə axını: creator_info → init(FILE_UPLOAD) → PUT Content-Range → status → PUBLISH_COMPLETE", async () => {
  const { w, m } = await tiktokWorld();
  let polls = 0;
  const calls = installSocialFetch([
    [/creator_info\/query/, () => ok({ creator_username: "u1", privacy_level_options: ["SELF_ONLY"] })],
    [/video\/init/, () => ok({ publish_id: "pub1", upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=1" })],
    [/open-upload\.tiktokapis\.com/, () => new Response(null, { status: 201 })],
    [/status\/fetch/, () => ok(++polls < 2 ? { status: "PROCESSING_UPLOAD" } : { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7000001"] })],
  ]);
  const tt = w.hub.adapter("tiktok");
  const req = normalizePublishRequest({ platform: "tiktok", caption: "TikTok mətni", hashtags: ["a"], media_id: m.id, media_type: "video" });
  const t = { step: "new", data: {} };
  assert.equal(await tt.start(req, t), "waiting");
  const init = bodyJson(calls.find((c) => /video\/init/.test(c.url)));
  assert.equal(init.source_info.source, "FILE_UPLOAD");
  assert.equal(init.source_info.video_size, MP4.byteLength);
  assert.equal(init.source_info.total_chunk_count, 1);
  assert.equal(init.post_info.privacy_level, "SELF_ONLY");
  assert.equal(init.post_info.title, "TikTok mətni\n\n#a");
  const put = calls.find((c) => c.method === "PUT");
  assert.equal(put.headers["content-range"], "bytes 0-" + (MP4.byteLength - 1) + "/" + MP4.byteLength);
  assert.equal(put.headers["content-type"], "video/mp4");
  assert.equal(calls.find((c) => /video\/init/.test(c.url)).headers.authorization, "Bearer TT_ACCESS");
  assert.equal(await tt.check(req, t), "waiting");
  assert.equal(await tt.check(req, t), "done");
  assert.equal(t.post_id, "7000001");
  assert.match(t.note, /SELF_ONLY/);
});

test("TikTok: icazəsiz məxfilik rədd olunur, audit olunmamış tətbiq xətası təsnif olunur, FAILED səbəbi gəlir", async () => {
  const { w, m } = await tiktokWorld();
  const tt = w.hub.adapter("tiktok");
  const pub = normalizePublishRequest({ platform: "tiktok", caption: "x", media_id: m.id, media_type: "video", privacy: "public" });
  installSocialFetch([[/creator_info\/query/, () => ok({ privacy_level_options: ["SELF_ONLY"] })]]);
  await assert.rejects(() => tt.start(pub, { step: "new", data: {} }), (e) => e.code === "invalid_request" && /SELF_ONLY/.test(e.message));

  const priv = normalizePublishRequest({ platform: "tiktok", caption: "x", media_id: m.id, media_type: "video" });
  installSocialFetch([
    [/creator_info\/query/, () => ok({ privacy_level_options: ["SELF_ONLY"] })],
    [/video\/init/, () => json({ data: {}, error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "m", log_id: "L" } }, 403)],
  ]);
  await assert.rejects(() => tt.start(priv, { step: "new", data: {} }), (e) => e.code === "unaudited_client");

  installSocialFetch([[/status\/fetch/, () => ok({ status: "FAILED", fail_reason: "file_format_check_failed" })]]);
  await assert.rejects(() => tt.check(priv, { data: { publish_id: "p" } }), (e) => e.code === "api_error" && /file_format/.test(e.message));
});

test("TikTok: vaxtı bitmiş access token refresh ilə yenilənir; media_id olmadan paylaşım olmur", async () => {
  const w = world();
  await seedToken(w, "tiktok", { access_token: "OLD", refresh_token: "RT", obtained_at: w.now() - 2 * DAY, expires_at: w.now() - HOUR, refresh_expires_at: w.now() + 100 * DAY });
  const calls = installSocialFetch([[/oauth\/token/, () => json({ access_token: "NEW_TT", expires_in: 86400, refresh_token: "RT2", refresh_expires_in: 31536000 })], [/creator_info\/query/, () => ok({ privacy_level_options: ["SELF_ONLY"], creator_username: "u" })]]);
  const acc = await w.hub.adapter("tiktok").verifyAccount();
  assert.equal(acc.username, "u");
  assert.equal(bodyParams(calls[0]).get("grant_type"), "refresh_token");
  assert.equal(calls[1].headers.authorization, "Bearer NEW_TT");
  const req = { platforms: ["tiktok"], caption: "x", hashtags: [], media: { url: "https://cdn.example.com/v.mp4", type: "video" }, privacy: "private" };
  await assert.rejects(() => w.hub.adapter("tiktok").start(req, { data: {} }), (e) => e.code === "media_error");
});

// ---------- YouTube ----------
async function youtubeWorld() {
  const w = world();
  await seedToken(w, "youtube", { access_token: "YT_ACCESS", refresh_token: "YT_REFRESH", obtained_at: w.now(), expires_at: w.now() + HOUR });
  const m = await w.hub.media.put(MP4, "video/mp4");
  return { w, m };
}

test("YouTube: OAuth ünvanı offline+consent, kod mübadiləsi kanal məlumatını saxlayır, refresh token məcburidir", async () => {
  const w = world();
  const calls = installSocialFetch([
    [/oauth2\.googleapis\.com\/token/, () => json({ access_token: "GA", expires_in: 3600, refresh_token: "GR", scope: "x" })],
    [/youtube\/v3\/channels/, () => json({ items: [{ id: "UC1", snippet: { title: "Kanalım" }, statistics: { subscriberCount: "5" } }] })],
  ]);
  const yt = w.hub.adapter("youtube");
  const u = new URL(yt.authUrl("s3", "https://jarvis.example.dev/oauth/youtube/callback"));
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.match(u.searchParams.get("scope"), /youtube\.upload/);
  assert.ok(!u.search.includes("g-secret"));
  const r = await yt.exchangeCode("C", "https://jarvis.example.dev/oauth/youtube/callback");
  assert.equal(r.account.title, "Kanalım");
  assert.equal(calls[1].headers.authorization, "Bearer GA");
  // refresh token gəlməsə qoşulma uğursuz sayılır
  installSocialFetch([[/oauth2\.googleapis\.com\/token/, () => json({ access_token: "GA2", expires_in: 3600 })]]);
  const w2 = world();
  await assert.rejects(() => w2.hub.adapter("youtube").exchangeCode("C", "https://jarvis.example.dev/oauth/youtube/callback"), /refresh token/);
});

test("YouTube: resumable yükləmə (title/description/tags/privacyStatus) + thumbnail + video id", async () => {
  const { w, m } = await youtubeWorld();
  const thumb = await w.hub.media.put(JPG, "image/jpeg");
  const calls = installSocialFetch([
    [/upload\/youtube\/v3\/thumbnails\/set/, () => json({ items: [{}] })],
    [/upload\/youtube\/v3\/videos/, (c) => c.method === "POST"
      ? new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=SESS1" } })
      : json({ id: "VID123", status: { privacyStatus: "private" } })],
  ]);
  const yt = w.hub.adapter("youtube");
  const req = normalizePublishRequest({ platform: "youtube", caption: "Video mətni", title: "Başlıq", description: "Təsvir", hashtags: ["ətir", "yeni"], media_id: m.id, media_type: "video", thumbnail_media_id: thumb.id });
  const t = { step: "new", data: {} };
  assert.equal(await yt.start(req, t), "waiting"); // yükləndi, emal hələ yoxlanmayıb
  const init = calls[0];
  assert.match(init.url, /uploadType=resumable&part=snippet,status/);
  assert.equal(init.headers["x-upload-content-length"], String(MP4.byteLength));
  assert.equal(init.headers["x-upload-content-type"], "video/mp4");
  const meta = bodyJson(init);
  assert.equal(meta.snippet.title, "Başlıq");
  assert.deepEqual(meta.snippet.tags, ["ətir", "yeni"]);
  assert.equal(meta.status.privacyStatus, "private");
  assert.equal(meta.status.selfDeclaredMadeForKids, false);
  const put = calls[1];
  assert.equal(put.method, "PUT");
  assert.match(put.url, /upload_id=SESS1/);
  assert.equal(put.headers["content-range"], "bytes 0-" + (MP4.byteLength - 1) + "/" + MP4.byteLength);
  assert.equal(t.post_id, "VID123");
  assert.equal(t.post_url, "https://www.youtube.com/watch?v=VID123");
  assert.ok(calls.some((c) => /thumbnails\/set\?uploadType=media&videoId=VID123/.test(c.url)));
});

test("YouTube: upload status — uploaded gözləyir, processed bitirir, failed/rejected xətadır", async () => {
  const { w, m } = await youtubeWorld();
  const yt = w.hub.adapter("youtube");
  const req = normalizePublishRequest({ platform: "youtube", caption: "c", title: "t", media_id: m.id, media_type: "video" });
  const t = { step: "started", data: {}, post_id: "VID1" };
  installSocialFetch([[/youtube\/v3\/videos\?part=status/, () => json({ items: [{ status: { uploadStatus: "uploaded", privacyStatus: "private" } }] })]]);
  assert.equal(await yt.check(req, t), "waiting");
  installSocialFetch([[/youtube\/v3\/videos\?part=status/, () => json({ items: [{ status: { uploadStatus: "processed", privacyStatus: "private" } }] })]]);
  assert.equal(await yt.check(req, t), "done");
  assert.equal(t.data.privacy_status, "private");
  installSocialFetch([[/youtube\/v3\/videos\?part=status/, () => json({ items: [{ status: { uploadStatus: "rejected", rejectionReason: "duplicate" } }] })]]);
  await assert.rejects(() => yt.check(req, t), /qəbul etmədi: duplicate/);
});

test("YouTube: public istənib, YouTube private verdi → qeyd; kvota (403) və 401 xətaları təsnif olunur", async () => {
  const { w, m } = await youtubeWorld();
  const yt = w.hub.adapter("youtube");
  installSocialFetch([
    [/upload\/youtube\/v3\/videos/, (c) => c.method === "POST" ? new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=S" } }) : json({ id: "V9", status: { privacyStatus: "private" } })],
  ]);
  const req = normalizePublishRequest({ platform: "youtube", caption: "c", title: "t", media_id: m.id, media_type: "video", privacy: "public" });
  const t = { data: {} };
  await yt.start(req, t);
  assert.match(t.note, /public.*private/s);

  installSocialFetch([[/upload\/youtube\/v3\/videos/, () => json({ error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403)]]);
  await assert.rejects(() => yt.start(req, { data: {} }), (e) => e.code === "rate_limited");
  installSocialFetch([[/upload\/youtube\/v3\/videos/, () => json({ error: { code: 401, message: "x" } }, 401)]]);
  await assert.rejects(() => yt.start(req, { data: {} }), (e) => e.code === "token_expired");
});

test("YouTube: vaxtı bitmiş token refresh_token ilə yenilənir; invalid_grant → token_expired", async () => {
  const w = world();
  await seedToken(w, "youtube", { access_token: "OLD", refresh_token: "RT", obtained_at: w.now() - 2 * HOUR, expires_at: w.now() - HOUR });
  const calls = installSocialFetch([[/oauth2\.googleapis\.com\/token/, () => json({ access_token: "FRESH", expires_in: 3600 })], [/youtube\/v3\/channels/, () => json({ items: [{ id: "UC", snippet: { title: "K" } }] })]]);
  await w.hub.adapter("youtube").verifyAccount();
  assert.equal(bodyParams(calls[0]).get("grant_type"), "refresh_token");
  assert.equal(calls[1].headers.authorization, "Bearer FRESH");
  assert.equal((await w.hub.vault.get("youtube")).refresh_token, "RT", "refresh token itməməlidir");
  w.advanceTime(2 * HOUR);
  installSocialFetch([[/oauth2\.googleapis\.com\/token/, () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)]]);
  const s = await w.hub.adapter("youtube").status({ verify: true });
  assert.equal(s.state, "TOKEN_EXPIRED");
});

// ---------- Telegram ----------
test("Telegram: kanala mətn və media göndərilir, token xətada/ünvanda sızmır, 401/429 təsnif olunur", async () => {
  const w = world();
  const calls = installSocialFetch([[/api\.telegram\.org\/bot123:TESTTOKEN\/sendMessage/, () => json({ ok: true, result: { message_id: 7, chat: { username: "testchannel" } } })]]);
  const tg = w.hub.adapter("telegram");
  const req = normalizePublishRequest({ platform: "telegram", caption: "Salam kanal", hashtags: ["a"] });
  const t = { data: {} };
  await tg.start(req, t);
  const sent = bodyJson(calls[0]);
  assert.equal(sent.chat_id, "@testchannel");
  assert.equal(sent.text, "Salam kanal #a");
  assert.equal(sent.parse_mode, undefined, "parse_mode olmamalıdır");
  assert.equal(t.post_id, "7");
  assert.equal(t.post_url, "https://t.me/testchannel/7");

  installSocialFetch([[/sendMessage/, () => json({ ok: false, error_code: 401, description: "Unauthorized" }, 401)]]);
  await assert.rejects(() => tg.start(req, { data: {} }), (e) => { assert.equal(e.code, "token_expired"); assert.ok(!JSON.stringify(e.toJSON()).includes("TESTTOKEN")); return true; });
  installSocialFetch([[/sendMessage/, () => json({ ok: false, error_code: 429, description: "Too Many Requests: retry after 5" }, 429)]]);
  await assert.rejects(() => tg.start(req, { data: {} }), (e) => e.code === "rate_limited" && e.retriable);
  installSocialFetch([[/sendMessage/, () => json({ ok: false, error_code: 403, description: "Forbidden: bot is not a member of the channel chat" }, 403)]]);
  await assert.rejects(() => tg.start(req, { data: {} }), (e) => e.code === "permission_denied");
});

test("Telegram: şəkil yüklənmiş mediadan multipart ilə göndərilir; URL media birbaşa ötürülür", async () => {
  const w = world();
  const m = await w.hub.media.put(JPG, "image/jpeg");
  const calls = installSocialFetch([[/sendPhoto/, () => json({ ok: true, result: { message_id: 8, chat: {} } })]]);
  const tg = w.hub.adapter("telegram");
  await tg.start(normalizePublishRequest({ platform: "telegram", caption: "Şəkil", media_id: m.id, media_type: "image" }), { data: {} });
  assert.ok(calls[0].body instanceof FormData);
  assert.equal(calls[0].body.get("chat_id"), "@testchannel");
  assert.ok(calls[0].body.get("photo"));
  await tg.start(normalizePublishRequest({ platform: "telegram", caption: "URL", media_url: "https://cdn.example.com/a.jpg", media_type: "image" }), { data: {} });
  assert.equal(bodyJson(calls[1]).photo, "https://cdn.example.com/a.jpg");
});

test("Telegram: status getMe ilə yoxlanır; token yoxdursa NOT_CONNECTED; icazə siyahısı boşdursa xəbərdarlıq", async () => {
  const w = world({ TELEGRAM_ALLOWED_CHAT_IDS: "" });
  installSocialFetch([[/getMe/, () => json({ ok: true, result: { id: 1, username: "jarvis_bot" } })]]);
  const s = await w.hub.adapter("telegram").status({ verify: true });
  assert.equal(s.state, "CONNECTED");
  assert.equal(s.account.username, "jarvis_bot");
  assert.match(s.warning, /boşdur/);
  const w2 = world({ TELEGRAM_BOT_TOKEN: "" });
  assert.equal((await w2.hub.adapter("telegram").status()).state, "NOT_CONNECTED");
  installSocialFetch([[/getMe/, () => json({ ok: false, error_code: 401, description: "Unauthorized" }, 401)]]);
  assert.equal((await w.hub.adapter("telegram").status({ verify: true })).state, "TOKEN_EXPIRED");
});
