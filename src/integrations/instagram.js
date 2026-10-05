// Instagram (Instagram API with Instagram Login) adapteri: YALNIZ OXUMA (hesab, media, insights).
// Secret adı: IG_FNPARFUM_TOKEN (yalnız Cloudflare Secret). Paylaşım, şərh cavabı, DM yazma əməliyyatları interfeysdir:
// endpoint-ləri yoxlanmayıb, ona görə heç bir alət kimi qeydə alınmır və icra olunmur.
//
// Rəsmi sənəd yoxlaması (2026-10-05, developers.facebook.com, WebFetch xülasəsi; canlı hesabla sınanmayıb):
//  - Host: graph.instagram.com, versiya seqmenti /v25.0/ (sənəd nümunələri). Token: access_token SORĞU parametri (Bearer başlığı sənəddə göstərilməyib).
//  - GET /me?fields=user_id,username,... (get-started səhifəsi)           -> account.get
//  - GET /<IG_ID>/media (yalnız id qaytarır, sahələr açıq istənməlidir)     -> media.list  (/me/media sənəddə göstərilməyib: istifadə olunmur)
//  - GET /<IG_ID>/insights?metric&period&metric_type, GET /<MEDIA_ID>/insights?metric -> insights.get
//    İcazələr: instagram_business_basic, insights üçün instagram_business_manage_insights (Advanced Access məsələsi sənəddə birmənalı deyil).
//  - Token: 60 gün; yeniləmə GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=... (token ≥24 saat köhnə, bitməyib; yeni token
//    cavabda gəlir). Yeni token Worker-dən Secret-ə YAZILA bilməz və sızmamalıdır, ona görə bu əməliyyat kodlaşdırılmayıb: istifadəçi əl ilə yeniləyir (docs/WIRING.md).
//  YAZMA (rəsmi sənəd, developers.facebook.com content-publishing / messaging-api / comment-moderation, 2026-10-05, WebFetch xülasəsi; canlı sınanmayıb):
//  - Başlıq: Authorization: Bearer <token>, Content-Type: application/json; parametrlər JSON gövdədədir (paylaşım və mesaj nümunələrində).
//  - POST /<IG_ID>/media {image_url, caption?} -> {id: <container>}; image_url ictimai serverdə olmalıdır, YALNIZ JPEG. İcazə: instagram_business_content_publish.
//  - GET /<container>?fields=status_code -> EXPIRED|ERROR|FINISHED|IN_PROGRESS|PUBLISHED. POST /<IG_ID>/media_publish {creation_id} -> {id: <media>}.
//    Konteyner 24 saata bitir. Limit: 24 saatlıq sürüşkən pəncərədə 100 API paylaşımı (burada gündə ≤ 5).
//  - POST /<IG_ID>/messages {recipient:{id:<IGSID>}, message:{text}}; mətn UTF-8 ≤ 1000 bayt; İcazə: instagram_business_manage_messages.
//    "Only after an Instagram user has sent your app user's Instagram professional account a message can your app send a message" + 24 saatlıq cavab pəncərəsi:
//    yəni soyuq/kütləvi mesaj platformada da mümkün deyil. IGSID webhook bildirişindən alınır (bu repoda Instagram webhook yoxdur: IGSID əl ilə verilir).
//  - POST /<IG_COMMENT_ID>/replies, "message" parametri; İcazə: instagram_business_manage_comments. YOXLANMAYIB: bu endpoint-də parametrin JSON gövdədə getməsi
//    (sənəd nümunəsi qısadır); digər yazma endpoint-lərinə uyğun JSON istifadə olunur.
// YOXLANMAYIB: /me cavabında hansı sahənin (id və ya user_id) <IG_ID> olduğu; "limit"-in maksimumu. Canlı test bunları göstərəcək.

import { IntegrationAdapter, PAGE_INPUT, EMPTY_INPUT, idSchema, pick } from "./Integration.js";
import { IntegrationError } from "./errors.js";
import { assertSafeUrl } from "../security/ssrf.js";

export const IG_BASE = "https://graph.instagram.com/v25.0";
const IG_ID_RE = /^\d{1,30}$/;
const METRIC_RE = /^[a-z_]{2,40}$/;
const CURSOR_RE = /^[A-Za-z0-9_=+\/.-]{1,200}$/;

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
  "account.get": { kind: "read", description: "Hesab/profil məlumatı (ad, izləyici sayı, media sayı)", input: EMPTY_INPUT },
  "media.list": { kind: "read", description: "Son paylaşımların siyahısı", input: PAGE_INPUT },
  "insights.get": { kind: "read", description: "Statistika (hesab və ya bir media üçün metriklər)", input: INSIGHTS_INPUT },
  // Yazma: yalnız runApproved() ilə (təsdiq + sübut). Hər biri alət reyestrində təsdiq tələb edən alətdir.
  "media.publish": { kind: "write", description: "Tək şəkil paylaşımı (ictimai https JPEG ünvanı). Konteyner yaradır, hazırdırsa dərc edir, deyilsə container.publish lazımdır", input: { type: "object", properties: { image_url: { type: "string", minLength: 12, maxLength: 1000 }, caption: { type: "string", maxLength: 2200 } }, required: ["image_url"], additionalProperties: false } },
  "container.publish": { kind: "write", description: "Hazır konteyneri dərc edir (media.publish 'hələ hazır deyil' dedikdə)", input: { type: "object", properties: { container_id: { type: "string", minLength: 1, maxLength: 30 } }, required: ["container_id"], additionalProperties: false } },
  "comments.reply": { kind: "write", description: "Bir şərhə cavab (tək şərh)", input: { type: "object", properties: { comment_id: idSchema, text: { type: "string", minLength: 1, maxLength: 1000 } }, required: ["comment_id", "text"], additionalProperties: false } },
  "messages.send": { kind: "write", description: "Mesaj yazmış İstifadəçiyə TƏK cavab (IGSID, 24 saat pəncərəsi; soyuq/kütləvi mesaj yoxdur)", input: { type: "object", properties: { recipient_id: idSchema, text: { type: "string", minLength: 1, maxLength: 1000 } }, required: ["recipient_id", "text"], additionalProperties: false } },
};

function u(path, params, token) {
  const x = new URL(IG_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") x.searchParams.set(k, String(v));
  x.searchParams.set("access_token", token);
  return x.toString();
}

const writeHeaders = (env) => ({ authorization: "Bearer " + env.IG_FNPARFUM_TOKEN, "content-type": "application/json" });

function checkErrorBody(d) {
  if (!d || typeof d !== "object" || d.error) throw new Error("bad shape");
  return d;
}

async function igId({ env, call }) {
  const me = checkErrorBody(await call(u("/me", { fields: "user_id" }, env.IG_FNPARFUM_TOKEN)));
  const id = String(me.user_id || me.id || "");
  if (!IG_ID_RE.test(id)) throw new Error("bad id");
  return id;
}

const ENDPOINTS = {
  "account.get": {
    verified: true,
    build: (i, env) => ({ url: u("/me", { fields: "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count" }, env.IG_FNPARFUM_TOKEN) }),
    parse: (d) => pick(checkErrorBody(d), ["id", "user_id", "username", "name", "account_type", "profile_picture_url", "followers_count", "follows_count", "media_count"]),
  },
  "media.list": {
    verified: true,
    async exec({ input, env, call }) {
      const id = await igId({ env, call });
      const d = checkErrorBody(await call(u("/" + id + "/media", { fields: "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count", limit: input.limit || 10, after: input.after }, env.IG_FNPARFUM_TOKEN)));
      if (!Array.isArray(d.data)) throw new Error("bad shape");
      const items = d.data.slice(0, 50).map((m) => pick(m, ["id", "caption", "media_type", "media_url", "permalink", "thumbnail_url", "timestamp", "like_count", "comments_count"], 500));
      const after = d.paging && d.paging.next && d.paging.cursors && d.paging.cursors.after;
      return { items, next: typeof after === "string" ? after.slice(0, 200) : null };
    },
  },
  "insights.get": {
    verified: true,
    async exec({ input, env, call }) {
      const metric = input.metrics.join(",");
      let url;
      if (input.media_id) url = u("/" + input.media_id + "/insights", { metric }, env.IG_FNPARFUM_TOKEN);
      else url = u("/" + (await igId({ env, call })) + "/insights", { metric, period: input.period || "day", metric_type: "total_value" }, env.IG_FNPARFUM_TOKEN);
      const d = checkErrorBody(await call(url));
      if (!Array.isArray(d.data)) throw new Error("bad shape");
      return { metrics: d.data.slice(0, 20).map((m) => ({ ...pick(m, ["name", "period", "title"], 120), total_value: m.total_value && typeof m.total_value === "object" ? { value: m.total_value.value } : undefined, values: Array.isArray(m.values) ? m.values.slice(0, 14).map((v) => pick(v, ["value", "end_time"], 60)) : undefined })) };
    },
  },
  "media.publish": {
    verified: true,
    async exec({ input, env, call, sleep }) {
      const id = await igId({ env, call });
      const h = writeHeaders(env);
      const c = checkErrorBody(await call(IG_BASE + "/" + id + "/media", { method: "POST", headers: h, body: JSON.stringify({ image_url: input.image_url, ...(input.caption ? { caption: input.caption } : {}) }) }));
      const cid = String(c.id || "");
      if (!IG_ID_RE.test(cid)) throw new Error("bad id");
      let status = null;
      for (let i = 0; i < 3; i++) {
        const st = checkErrorBody(await call(IG_BASE + "/" + cid + "?fields=status_code", { headers: h }));
        status = typeof st.status_code === "string" ? st.status_code : null;
        if (status === "FINISHED" || status === "ERROR" || status === "EXPIRED") break;
        if (i < 2) await sleep(1500);
      }
      if (status === "ERROR" || status === "EXPIRED") throw new Error("container " + status);
      if (status !== "FINISHED") return { published: false, container_id: cid, status_code: status || "UNKNOWN" };
      const p = checkErrorBody(await call(IG_BASE + "/" + id + "/media_publish", { method: "POST", headers: h, body: JSON.stringify({ creation_id: cid }) }));
      const mid = String(p.id || "");
      if (!IG_ID_RE.test(mid)) throw new Error("bad id");
      return { published: true, media_id: mid, container_id: cid };
    },
  },
  "container.publish": {
    verified: true,
    async exec({ input, env, call }) {
      const id = await igId({ env, call });
      const h = writeHeaders(env);
      const st = checkErrorBody(await call(IG_BASE + "/" + input.container_id + "?fields=status_code", { headers: h }));
      if (st.status_code !== "FINISHED") return { published: false, container_id: input.container_id, status_code: typeof st.status_code === "string" ? st.status_code : "UNKNOWN" };
      const p = checkErrorBody(await call(IG_BASE + "/" + id + "/media_publish", { method: "POST", headers: h, body: JSON.stringify({ creation_id: input.container_id }) }));
      const mid = String(p.id || "");
      if (!IG_ID_RE.test(mid)) throw new Error("bad id");
      return { published: true, media_id: mid, container_id: input.container_id };
    },
  },
  "comments.reply": {
    verified: true,
    build: (i, env) => ({ url: IG_BASE + "/" + i.comment_id + "/replies", method: "POST", headers: writeHeaders(env), body: JSON.stringify({ message: i.text }) }),
    parse: (d) => ({ replied: true, comment_id: String(checkErrorBody(d).id || "").slice(0, 40) }),
  },
  "messages.send": {
    verified: true,
    async exec({ input, env, call }) {
      const id = await igId({ env, call });
      const d = checkErrorBody(await call(IG_BASE + "/" + id + "/messages", { method: "POST", headers: writeHeaders(env), body: JSON.stringify({ recipient: { id: input.recipient_id }, message: { text: input.text } }) }));
      return { sent: true, message_id: String(d.message_id || d.id || "").slice(0, 80) || null };
    },
  },
};

export class InstagramAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "instagram", label: "Instagram (oxuma + təsdiqli yazma)", operations: INSTAGRAM_OPERATIONS, endpoints: ENDPOINTS, allowedHosts: ["graph.instagram.com"], ...opts });
  }
  _precheck(op, input, ctx) {
    if (op === "insights.get") {
      if (!input.metrics.every((m) => METRIC_RE.test(m))) throw new IntegrationError("invalid_input", "metrik adı düzgün deyil", ctx);
      if (input.media_id !== undefined && !IG_ID_RE.test(input.media_id)) throw new IntegrationError("invalid_input", "media_id yalnız rəqəmlərdən ibarət olmalıdır", ctx);
    }
    if (op === "media.list" && input.after !== undefined && !CURSOR_RE.test(input.after)) throw new IntegrationError("invalid_input", "after düzgün deyil", ctx);
    if (op === "media.publish") {
      try { assertSafeUrl(input.image_url); } catch (e) { throw new IntegrationError("invalid_input", "image_url ictimai https ünvan olmalıdır", ctx); }
    }
    if (op === "container.publish" && !IG_ID_RE.test(input.container_id)) throw new IntegrationError("invalid_input", "container_id yalnız rəqəmlərdən ibarət olmalıdır", ctx);
    if (op === "comments.reply" && !IG_ID_RE.test(input.comment_id)) throw new IntegrationError("invalid_input", "comment_id yalnız rəqəmlərdən ibarət olmalıdır", ctx);
    if (op === "messages.send") {
      if (!IG_ID_RE.test(input.recipient_id)) throw new IntegrationError("invalid_input", "recipient_id (IGSID) yalnız rəqəmlərdən ibarət olmalıdır", ctx);
      if (new TextEncoder().encode(input.text).length > 1000) throw new IntegrationError("invalid_input", "mesaj 1000 baytdan uzundur", ctx);
    }
  }
  // Mock: aşkar saxta, sabit (deterministik) məlumat.
  get mockHandlers() {
    return {
      "account.get": () => ({ id: "mock_account_1", username: "mock_account", account_type: "BUSINESS", media_count: 2 }),
      "media.list": (i) => ({ items: [{ id: "mock_media_1", caption: "mock paylaşım 1", media_type: "IMAGE" }, { id: "mock_media_2", caption: "mock paylaşım 2", media_type: "VIDEO" }].slice(0, i.limit || 25), next: null }),
      "insights.get": (i) => ({ metrics: i.metrics.map((m) => ({ name: m, period: i.period || "day", total_value: { value: 0 } })) }),
      "media.publish": () => ({ published: true, media_id: "mock_media_9", container_id: "mock_container_9" }),
      "container.publish": (i) => ({ published: true, media_id: "mock_media_9", container_id: i.container_id }),
      "comments.reply": (i) => ({ replied: true, comment_id: "mock_reply_for_" + i.comment_id }),
      "messages.send": () => ({ sent: true, message_id: "mock_message_1" }),
    };
  }
}
