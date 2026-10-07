// Marketinq alətləri. Hamısı risk "low", yan təsir YOXDUR: heç nə dərc olunmur, mesaj göndərilmir, məlumat yazılmır.
// Çıxışlar yalnız QARALAMADIR (draft_only:true, published:false).
// Model (deps.llm) yoxdursa və ya xəta verirsə deterministik ŞABLON qaytarılır və source:"template" ilə görünən şəkildə işarələnir.
//
// İcazə adı (DEFAULT_PERMISSIONS-a əlavə olunmalıdır): use.marketing

import { AppError } from "../errors.js";
import { BRAND_IDS, getBrand, requestsDigitalCard, missingFacts } from "./brands.js";
import { PLATFORMS, LIMITS, stripUnsafe } from "./safety.js";
import { produce, frame, buildPublishingPlan, PLAN_SCHEMA, HOOKS_SCHEMA, CAPTIONS_SCHEMA, HASHTAGS_SCHEMA, CALENDAR_SCHEMA, templatePlan, templateHooks, templateCaptions, templateHashtags, templateCalendar } from "./engine.js";
import { analyzePerformance } from "./performance.js";
import { addDays } from "./templates.js";

export const MARKETING_PERMISSIONS = ["use.marketing"];

const factsSchema = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(["product_name", "price", "stock", "discount", "delivery", "link", "offer", "setup_time", "case_study", "notes_profile"].map((k) => [k, { type: "string", maxLength: 200 }])),
};
const common = {
  brand: { type: "string", enum: BRAND_IDS },
  topic: { type: "string", maxLength: 200 },
  goal: { type: "string", maxLength: 300 },
  offer: { type: "string", maxLength: 300 },
  notes: { type: "string", maxLength: 500 },
  audience: { type: "string", maxLength: 150 },
  facts: factsSchema,
  include_digital_card: { type: "boolean" },
};
const platformProp = { type: "string", enum: PLATFORMS };
const frameOut = {
  source: { type: "string" },
  provider: { type: "string" },
  ai_generated: { type: "boolean" },
  personalized: { type: "boolean" },
  notice: { type: "string" },
  draft_only: { type: "boolean" },
  published: { type: "boolean" },
  brand: { type: "string" },
  language: { type: "string" },
  needs_owner_input: { type: "array" },
  fallback_reason: { type: "string" },
};
const outSchema = (required, props) => ({ type: "object", required: ["source", "draft_only", "published", "brand", "needs_owner_input", ...required], properties: { ...frameOut, ...props } });

function todayBaku(now) {
  return new Date(now() + 4 * 3600000).toISOString().slice(0, 10);
}

function validYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function registerMarketingTools(registry, deps = {}) {
  const now = deps.now || (() => Date.now());
  const llm = () => deps.llm || null; // hər çağırışda oxunur: sonradan qoşula bilər
  const brandOf = (input) => {
    const b = getBrand(input.brand);
    if (!b) throw new AppError("VALIDATION_ERROR", "Naməlum brend: " + input.brand);
    return b;
  };
  const base = { permissions: MARKETING_PERMISSIONS, risk: "low", requiresApproval: false, timeoutMs: 30000 };

  // ---- marketing.campaign.plan ----
  registry.register({
    ...base,
    name: "marketing.campaign.plan",
    description: "Kampaniya QARALAMASI: hədəf auditoriya, hook, vaxtlı ssenari, çəkiliş planı, caption, CTA, hashteqlər, platformalara görə nəşr planı (IG/TikTok/YouTube) və A/B ideyaları. Heç nə dərc olunmur.",
    inputSchema: { type: "object", required: ["brand"], additionalProperties: false, properties: { ...common, platforms: { type: "array", maxItems: 3, items: platformProp }, duration_sec: { type: "integer", minimum: 15, maximum: 60 } } },
    outputSchema: outSchema(["plan", "publishing_plan"], { plan: { type: "object" }, publishing_plan: { type: "object" }, limits: { type: "object" } }),
    auditEvent: "marketing.campaign.plan",
    async handler(input) {
      const brand = brandOf(input);
      const platforms = input.platforms && input.platforms.length ? [...new Set(input.platforms)] : PLATFORMS;
      const r = await produce({
        kind: "plan",
        llm: llm(),
        brand,
        input,
        schema: PLAN_SCHEMA,
        req: { public: { platforms, duration_sec: input.duration_sec || 25 } },
        maxTokens: 2500,
        template: () => templatePlan({ brand, input, platforms, includeCardNote: requestsDigitalCard(input) && brand.id === "qr_menu" }),
      });
      const plan = r.content;
      return { ...frame(brand, input, r), plan, publishing_plan: buildPublishingPlan(plan, platforms, brand), limits: LIMITS };
    },
  });

  // ---- marketing.captions ----
  registry.register({
    ...base,
    name: "marketing.captions",
    description: "Platforma üçün caption qaralamaları (IG ≤2200, TikTok ≤2200, YouTube başlıq ≤100). Heç nə dərc olunmur.",
    inputSchema: { type: "object", required: ["brand", "platform"], additionalProperties: false, properties: { ...common, platform: platformProp, count: { type: "integer", minimum: 1, maximum: 5 } } },
    outputSchema: outSchema(["platform", "captions"], { platform: { type: "string" }, captions: { type: "array" } }),
    auditEvent: "marketing.captions",
    async handler(input) {
      const brand = brandOf(input);
      const count = input.count || 3;
      const r = await produce({
        kind: "captions",
        llm: llm(),
        brand,
        input,
        schema: CAPTIONS_SCHEMA,
        req: { platform: input.platform, count, public: { platform: input.platform, count } },
        template: (ctx) => {
          const caps = templateCaptions({ brand, platform: input.platform, count, topic: input.topic || input.goal, offer: input.offer, facts: input.facts });
          const title = templatePlan({ brand, input, platforms: [input.platform] }).youtube_title;
          return { captions: caps.map((c) => (input.platform === "youtube" ? { title, text: c.text, cta: c.cta } : c)) };
        },
      });
      return { ...frame(brand, input, r), platform: input.platform, captions: r.content.captions };
    },
  });

  // ---- marketing.hashtags ----
  registry.register({
    ...base,
    name: "marketing.hashtags",
    description: "Hashteq qaralaması (maks 30; YouTube üçün maks 15), təkrarsız və təmiz formatda.",
    inputSchema: { type: "object", required: ["brand"], additionalProperties: false, properties: { ...common, platform: platformProp, count: { type: "integer", minimum: 1, maximum: 30 } } },
    outputSchema: outSchema(["hashtags"], { hashtags: { type: "array" }, platform: { type: "string" } }),
    auditEvent: "marketing.hashtags",
    async handler(input) {
      const brand = brandOf(input);
      const platform = input.platform || "instagram";
      const count = input.count || 12;
      const r = await produce({
        kind: "hashtags",
        llm: llm(),
        brand,
        input,
        schema: HASHTAGS_SCHEMA,
        req: { platform, count, public: { platform, count } },
        template: () => ({ hashtags: templateHashtags({ brand, topic: input.topic, platform, count }) }),
      });
      return { ...frame(brand, input, r), platform, hashtags: r.content.hashtags };
    },
  });

  // ---- marketing.hooks ----
  registry.register({
    ...base,
    name: "marketing.hooks",
    description: "Videonun ilk saniyələri üçün hook cümlə qaralamaları.",
    inputSchema: { type: "object", required: ["brand"], additionalProperties: false, properties: { ...common, count: { type: "integer", minimum: 1, maximum: 10 } } },
    outputSchema: outSchema(["hooks"], { hooks: { type: "array" } }),
    auditEvent: "marketing.hooks",
    async handler(input) {
      const brand = brandOf(input);
      const count = input.count || 5;
      const r = await produce({
        kind: "hooks",
        llm: llm(),
        brand,
        input,
        schema: HOOKS_SCHEMA,
        req: { count, public: { count } },
        template: () => ({ hooks: templateHooks({ brand, count, topic: input.topic }) }),
      });
      return { ...frame(brand, input, r), hooks: r.content.hooks };
    },
  });

  // ---- marketing.calendar ----
  registry.register({
    ...base,
    name: "marketing.calendar",
    description: "N günlük kontent təqvimi QARALAMASI (platforma, format, ideya, hook). Heç nə planlaşdırılmır və dərc olunmur.",
    inputSchema: { type: "object", required: ["brand", "days"], additionalProperties: false, properties: { ...common, days: { type: "integer", minimum: 1, maximum: 30 }, platforms: { type: "array", maxItems: 3, items: platformProp }, posts_per_week: { type: "integer", minimum: 1, maximum: 7 }, start_date: { type: "string", maxLength: 10 }, themes: { type: "array", maxItems: 7, items: { type: "string", maxLength: 80 } } } },
    outputSchema: outSchema(["days", "start_date", "items"], { days: { type: "integer" }, start_date: { type: "string" }, items: { type: "array" }, rest_days: { type: "integer" } }),
    auditEvent: "marketing.calendar",
    async handler(input) {
      const brand = brandOf(input);
      const platforms = input.platforms && input.platforms.length ? [...new Set(input.platforms)] : ["instagram"];
      const start = input.start_date || todayBaku(now);
      if (!validYmd(start)) throw new AppError("VALIDATION_ERROR", "start_date YYYY-MM-DD formatında olmalıdır");
      const ppw = input.posts_per_week || 4;
      const r = await produce({
        kind: "calendar",
        llm: llm(),
        brand,
        input,
        schema: CALENDAR_SCHEMA,
        req: { days: input.days, platforms, public: { days: input.days, platforms, posts_per_week: ppw } },
        maxTokens: 3000,
        template: () => ({ items: templateCalendar({ brand, days: input.days, platforms, startDate: start, postsPerWeek: ppw, themes: input.themes || [] }) }),
      });
      const items = r.content.items.map((it) => ({ ...it, date: addDays(start, it.day - 1) }));
      return { ...frame(brand, input, r), days: input.days, start_date: start, items, rest_days: input.days - new Set(items.map((x) => x.day)).size };
    },
  });

  // ---- marketing.performance.analyze (modelsiz, deterministik) ----
  registry.register({
    ...base,
    name: "marketing.performance.analyze",
    description: "Çağıranın verdiyi göstəricilər üzərində deterministik performans təhlili. Məlumat yoxdursa 'insufficient_data' qaytarır; rəqəm uydurmur və xarici etalon istifadə etmir.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        platform: platformProp,
        items: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries([["id", { type: "string", maxLength: 60 }], ["platform", platformProp], ["date", { type: "string", maxLength: 10 }], ...["views", "reach", "likes", "comments", "shares", "saves", "clicks", "followers_gained"].map((k) => [k, { type: "integer", minimum: 0 }])]),
          },
        },
      },
    },
    outputSchema: { type: "object", required: ["status", "sample_size", "no_external_benchmarks", "draft_only", "published"], properties: { status: { type: "string" }, sample_size: { type: "integer" }, no_external_benchmarks: { type: "boolean" }, draft_only: { type: "boolean" }, published: { type: "boolean" }, reason: { type: "string" } } },
    auditEvent: "marketing.performance.analyze",
    async handler(input) {
      const res = analyzePerformance((input.items || []).map((x) => ({ ...x, id: x.id ? stripUnsafe(x.id).slice(0, 60) : undefined })), { platform: input.platform });
      return { ...res, source: "deterministic", draft_only: true, published: false };
    },
  });

  // ---- marketing.segments (reyestrdən, modelsiz) ----
  registry.register({
    ...base,
    name: "marketing.segments",
    description: "Brend üçün hədəf seqment FƏRZİYYƏLƏRİ (reyestrdən). Bunlar ölçülmüş məlumat deyil: test üçün başlanğıcdır.",
    inputSchema: { type: "object", required: ["brand"], additionalProperties: false, properties: { brand: common.brand, facts: factsSchema } },
    outputSchema: outSchema(["segments", "validated"], { segments: { type: "array" }, validated: { type: "boolean" } }),
    auditEvent: "marketing.segments",
    async handler(input) {
      const brand = brandOf(input);
      return {
        source: "brand_registry",
        provider: "none",
        ai_generated: false,
        personalized: false,
        notice: "Seqmentlər reyestrdəki fərziyyələrdir, ölçülmüş auditoriya məlumatı deyil. Real nəticə üçün performansı marketing.performance.analyze ilə yoxlayın.",
        draft_only: true,
        published: false,
        brand: brand.id,
        language: "az",
        needs_owner_input: missingFacts(brand, input.facts),
        validated: false,
        segments: brand.segments.map((s) => ({ ...s, hypothesis: true })),
      };
    },
  });

  return {
    toolNames: ["marketing.campaign.plan", "marketing.captions", "marketing.hashtags", "marketing.hooks", "marketing.calendar", "marketing.performance.analyze", "marketing.segments"],
  };
}
