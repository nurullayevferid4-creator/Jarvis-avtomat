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
//  - Token: 60 gün; yeniləmə GET graph.instagram.com/refresh_access_token (bu mərhələdə kodlaşdırılmayıb, bax docs/WIRING.md).
// YOXLANMAYIB: /me cavabında hansı sahənin (id və ya user_id) <IG_ID> olduğu; "limit"-in maksimumu. Canlı test bunları göstərəcək.

import { IntegrationAdapter, PAGE_INPUT, EMPTY_INPUT, idSchema, pick } from "./Integration.js";
import { IntegrationError } from "./errors.js";

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
  // Aşağıdakılar yalnız interfeysdir (endpoint yoxlanmayıb): alət kimi qeydə alınmır, icra olunmur.
  "media.publish": { kind: "write", description: "Paylaşım (hazırlanmayıb)", input: { type: "object", properties: { caption: { type: "string", maxLength: 2200 } }, additionalProperties: false } },
  "comments.reply": { kind: "write", description: "Şərhə cavab (hazırlanmayıb)", input: { type: "object", properties: { comment_id: idSchema, text: { type: "string", maxLength: 1000 } }, additionalProperties: false } },
  "messages.send": { kind: "write", description: "DM göndərmə (hazırlanmayıb)", input: { type: "object", properties: { recipient_id: idSchema, text: { type: "string", maxLength: 1000 } }, additionalProperties: false } },
};

function u(path, params, token) {
  const x = new URL(IG_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") x.searchParams.set(k, String(v));
  x.searchParams.set("access_token", token);
  return x.toString();
}

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
};

export class InstagramAdapter extends IntegrationAdapter {
  constructor(opts = {}) {
    super({ id: "instagram", label: "Instagram (yalnız oxuma)", operations: INSTAGRAM_OPERATIONS, endpoints: ENDPOINTS, allowedHosts: ["graph.instagram.com"], ...opts });
  }
  _precheck(op, input, ctx) {
    if (op === "insights.get") {
      if (!input.metrics.every((m) => METRIC_RE.test(m))) throw new IntegrationError("invalid_input", "metrik adı düzgün deyil", ctx);
      if (input.media_id !== undefined && !IG_ID_RE.test(input.media_id)) throw new IntegrationError("invalid_input", "media_id yalnız rəqəmlərdən ibarət olmalıdır", ctx);
    }
    if (op === "media.list" && input.after !== undefined && !CURSOR_RE.test(input.after)) throw new IntegrationError("invalid_input", "after düzgün deyil", ctx);
  }
  // Mock: aşkar saxta, sabit (deterministik) məlumat.
  get mockHandlers() {
    return {
      "account.get": () => ({ id: "mock_account_1", username: "mock_account", account_type: "BUSINESS", media_count: 2 }),
      "media.list": (i) => ({ items: [{ id: "mock_media_1", caption: "mock paylaşım 1", media_type: "IMAGE" }, { id: "mock_media_2", caption: "mock paylaşım 2", media_type: "VIDEO" }].slice(0, i.limit || 25), next: null }),
      "insights.get": (i) => ({ metrics: i.metrics.map((m) => ({ name: m, period: i.period || "day", total_value: { value: 0 } })) }),
    };
  }
}
