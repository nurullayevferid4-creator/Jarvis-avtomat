// Marketinq mühərriki: model (deps.llm) və ya şablon. Nəticə HƏMİŞƏ qaralamadır: heç nə dərc olunmur.
//
// Axın: model çağırışı (varsa) -> sxem yoxlaması (validate.js) -> təmizləmə (stripUnsafe) -> uzunluq limitləri ->
//       qadağan mövzu və təsdiqsiz iddia yoxlaması -> uyğun deyilsə ŞABLONA keçid (source:"template", səbəb göstərilir).
// Model nəticəsi heç vaxt etibar edilmir: sahibin verdiyi məlumatda olmayan qiymət, endirim, nəticə iddiası rədd edilir.

import { validate } from "../validate.js";
import { wrapExternal, UNTRUSTED_RULE } from "../security/sanitize.js";
import { getBrand, forbiddenFor, requestsDigitalCard, missingFacts } from "./brands.js";
import { LIMITS, PLATFORMS, stripUnsafe, unsupportedClaims, containsForbidden, normalizeHashtags, supportedTextOf, collectStrings } from "./safety.js";
import { templatePlan, templateHooks, templateCaptions, templateHashtags, templateCalendar } from "./templates.js";

const str = (max, min = 1) => ({ type: "string", minLength: min, maxLength: max });

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["target_audience", "hook", "script", "shot_list", "caption", "cta", "hashtags", "ab_ideas", "youtube_title"],
  properties: {
    target_audience: { type: "object", required: ["primary", "segments"], additionalProperties: false, properties: { primary: str(200), segments: { type: "array", maxItems: 8, items: str(120) } } },
    hook: str(200),
    script: { type: "array", maxItems: 10, items: { type: "object", required: ["timing", "visual", "voiceover"], additionalProperties: false, properties: { timing: str(30), visual: str(300), voiceover: str(300) } } },
    shot_list: { type: "array", maxItems: 12, items: { type: "object", required: ["shot", "description", "duration_sec"], additionalProperties: false, properties: { shot: { type: "integer", minimum: 1, maximum: 50 }, description: str(300), duration_sec: { type: "number", minimum: 0.5, maximum: 60 } } } },
    caption: str(LIMITS.instagram.caption),
    cta: str(300),
    hashtags: { type: "array", maxItems: 60, items: str(60) },
    ab_ideas: { type: "array", maxItems: 6, items: { type: "object", required: ["variable", "variant_a", "variant_b", "measure"], additionalProperties: false, properties: { variable: str(80), variant_a: str(300), variant_b: str(300), measure: str(200) } } },
    youtube_title: str(LIMITS.youtube.title),
  },
};
export const HOOKS_SCHEMA = { type: "object", additionalProperties: false, required: ["hooks"], properties: { hooks: { type: "array", maxItems: 10, items: str(200) } } };
export const CAPTIONS_SCHEMA = {
  type: "object",
  required: ["captions"],
  properties: { captions: { type: "array", maxItems: 5, items: { type: "object", required: ["text"], properties: { text: str(LIMITS.youtube.description), cta: { type: "string", maxLength: 300 }, title: { type: "string", maxLength: 300 } } } } },
};
export const HASHTAGS_SCHEMA = { type: "object", additionalProperties: false, required: ["hashtags"], properties: { hashtags: { type: "array", maxItems: 60, items: str(60) } } };
export const CALENDAR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: { items: { type: "array", maxItems: 60, items: { type: "object", required: ["day", "platform", "format", "idea", "hook"], additionalProperties: false, properties: { day: { type: "integer", minimum: 1, maximum: 30 }, platform: { type: "string", enum: PLATFORMS }, format: str(30), idea: str(300), hook: str(200) } } } },
};

const NOTICE_TEMPLATE = "Şablon qaralamadır: AI ilə yazılmayıb və sizin real məlumatlarınıza görə fərdiləşdirilməyib. Dərc etməzdən əvvəl mətni yoxlayın və öz məlumatlarınızla tamamlayın.";
const NOTICE_AI = "AI qaralamasıdır. Dərc olunmayıb. Faktları (qiymət, endirim, nəticə) və linki dərc etməzdən əvvəl özünüz yoxlayın.";

// Plan üçün qısa çıxış limitləri: model daha az token yazır (PLAN_SCHEMA xarici forması dəyişmir, yalnız POST.plan kəsir)
export const PLAN_LIMITS = { segments: 4, script: 5, shots: 6, ab_ideas: 2, hashtags: 12, caption: 600 };
const KIND_RULES = {
  captions: "JSON shape (no other keys): {\"captions\":[N items {\"text\":str at most 600 chars,\"cta\":str at most 120 chars,\"title\":str at most 90 chars (required for youtube, omit otherwise)}]}. N = request.count. Each text is 2-4 short sentences, no hashtags.",
  plan: "JSON shape (no other keys): {\"target_audience\":{\"primary\":str,\"segments\":[str, at most " + PLAN_LIMITS.segments + "]},\"hook\":str,\"script\":[2-" + PLAN_LIMITS.script + " items {\"timing\":str,\"visual\":str,\"voiceover\":str}],\"shot_list\":[2-" + PLAN_LIMITS.shots + " items {\"shot\":int,\"description\":str,\"duration_sec\":number}],\"caption\":str at most " + PLAN_LIMITS.caption + " chars,\"cta\":str,\"hashtags\":[at most " + PLAN_LIMITS.hashtags + "],\"ab_ideas\":[1-" + PLAN_LIMITS.ab_ideas + " items {\"variable\":str,\"variant_a\":str,\"variant_b\":str,\"measure\":str}],\"youtube_title\":str at most 100 chars}. Every text field is one short sentence.",
};

export function systemPrompt(kind, brand, allowCard) {
  return [
    "You are a careful Azerbaijani-language marketing copywriter. Return ONLY a JSON object that matches the given schema. Task: " + kind + ".",
    "Be concise: short sentences, no explanations, no extra keys.",
    KIND_RULES[kind] || "",
    "Write in Azerbaijani. Use only the verified facts in the brand block and the owner_input. Never invent prices, discounts, stock, results, awards, statistics or customer claims.",
    "Links: only the URLs listed in brand.allowed_links; never any other URL.",
    allowCard || !brand.forbidden_label ? "" : "Do NOT mention or bundle: " + brand.forbidden_label + ".",
    "Nothing is published; you only write drafts.",
    UNTRUSTED_RULE,
  ].filter(Boolean).join("\n");
}

function wrapField(v, label) {
  if (v === undefined || v === null || v === "") return undefined;
  return wrapExternal(String(v), { source: "owner_input." + label, maxLen: 1000 }).text;
}

export function userPrompt(kind, brand, input, extra = {}) {
  const facts = {};
  for (const [k, v] of Object.entries(input.facts || {})) facts[k] = wrapField(v, "facts." + k);
  return JSON.stringify({
    task: kind,
    language: "az",
    brand: { name: brand.name, summary: brand.summary, verified_facts: brand.verified_facts, allowed_links: allowedLinks(brand, input.facts) },
    owner_input: { goal: wrapField(input.goal, "goal"), topic: wrapField(input.topic, "topic"), offer: wrapField(input.offer, "offer"), notes: wrapField(input.notes, "notes"), audience: wrapField(input.audience, "audience"), themes: (input.themes || []).map((t, i) => wrapField(t, "themes." + i)), facts },
    ...extra,
  });
}

export function allowedLinks(brand, facts) {
  const links = [...brand.allowed_links];
  if (brand.id === "fn_parfum" && facts && typeof facts.link === "string" && /^https:\/\//.test(facts.link)) links.push(facts.link);
  return links;
}

// Obyektdəki bütün sətirləri təmizləyir (yeni obyekt qaytarır)
function mapStrings(v, fn) {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)]));
  return v;
}

function contextFor(brand, input) {
  const allowCard = requestsDigitalCard(input);
  const forbidden = forbiddenFor(brand, input);
  const supported = supportedTextOf(input) + (input.facts && input.facts.discount ? " endirim" : "");
  return { brand, links: allowedLinks(brand, input.facts), forbidden, supported, allowCard };
}

// Mətn problemləri: qadağan mövzu, təsdiqsiz iddia
function textProblems(text, ctx) {
  const p = [];
  if (containsForbidden(text, ctx.forbidden)) p.push("forbidden_topic");
  if (unsupportedClaims(text, ctx.supported).length) p.push("unsupported_claim");
  return p;
}

function allProblems(obj, ctx) {
  return [...new Set(collectStrings(obj).flatMap((s) => textProblems(s, ctx)))];
}

// ---- model nəticəsinin yoxlanması (yalnız təmizlənmiş nəticə və ya problemlər) ----
const POST = {
  plan(res, ctx) {
    const clean = mapStrings(res, (s) => stripUnsafe(s, { allowedLinks: ctx.links }));
    clean.target_audience.segments = clean.target_audience.segments.slice(0, PLAN_LIMITS.segments);
    clean.script = clean.script.slice(0, PLAN_LIMITS.script);
    clean.shot_list = clean.shot_list.slice(0, PLAN_LIMITS.shots);
    clean.ab_ideas = clean.ab_ideas.slice(0, PLAN_LIMITS.ab_ideas);
    const problems = allProblems(clean, ctx);
    if (clean.caption.length > LIMITS.instagram.caption || clean.youtube_title.length > LIMITS.youtube.title) problems.push("too_long");
    if (clean.hook.length < 3 || clean.caption.length < 3) problems.push("empty_after_clean");
    clean.hashtags = normalizeHashtags(clean.hashtags, PLAN_LIMITS.hashtags);
    if (clean.hashtags.length < 1) problems.push("no_hashtags");
    if (clean.script.length < 2 || clean.shot_list.length < 2) problems.push("incomplete");
    return problems.length ? { ok: false, problems } : { ok: true, content: clean };
  },
  hooks(res, ctx, req) {
    const seen = new Set();
    const hooks = [];
    for (const h of res.hooks) {
      const c = stripUnsafe(h, { allowedLinks: ctx.links });
      if (c.length < 3 || seen.has(c) || textProblems(c, ctx).length) continue;
      seen.add(c);
      hooks.push(c);
    }
    return hooks.length ? { ok: true, content: { hooks: hooks.slice(0, req.count) } } : { ok: false, problems: ["no_valid_items"] };
  },
  captions(res, ctx, req) {
    const max = req.platform === "youtube" ? LIMITS.youtube.description : LIMITS[req.platform].caption;
    const out = [];
    for (const c of res.captions) {
      const text = stripUnsafe(c.text, { allowedLinks: ctx.links });
      const cta = stripUnsafe(c.cta || "", { allowedLinks: ctx.links });
      const title = c.title ? stripUnsafe(c.title, { allowedLinks: ctx.links }).slice(0, LIMITS.youtube.title) : "";
      if (text.length < 3 || text.length > max) continue;
      if (req.platform === "youtube" && (!title || title.length > LIMITS.youtube.title)) continue;
      if (textProblems(text + "\n" + cta + "\n" + title, ctx).length) continue;
      out.push(req.platform === "youtube" ? { title, text, cta } : { text, cta });
    }
    return out.length ? { ok: true, content: { captions: out.slice(0, req.count) } } : { ok: false, problems: ["no_valid_items"] };
  },
  hashtags(res, ctx, req) {
    const max = Math.min(req.count, req.platform === "youtube" ? LIMITS.youtube.hashtags : LIMITS[req.platform].hashtags);
    const tags = normalizeHashtags(res.hashtags, 60).filter((t) => !textProblems(t, ctx).length).slice(0, max);
    return tags.length ? { ok: true, content: { hashtags: tags } } : { ok: false, problems: ["no_valid_items"] };
  },
  calendar(res, ctx, req) {
    const items = [];
    for (const it of res.items) {
      if (it.day > req.days || !req.platforms.includes(it.platform)) continue;
      const c = { ...it, format: stripUnsafe(it.format), idea: stripUnsafe(it.idea, { allowedLinks: ctx.links }), hook: stripUnsafe(it.hook, { allowedLinks: ctx.links }) };
      if (c.idea.length < 3 || textProblems(c.idea + "\n" + c.hook, ctx).length) continue;
      items.push(c);
    }
    items.sort((a, b) => a.day - b.day);
    return items.length ? { ok: true, content: { items } } : { ok: false, problems: ["no_valid_items"] };
  },
};

// kind: plan | hooks | captions | hashtags | calendar
// Qaytarır: { source, provider, ai_generated, personalized, fallback_reason?, notice, content }
// Telegram arxa plan işi ~30 s-də kəsilir: model bu müddətdə cavab vermirsə şablon qaralama qaytarılır (səssiz çökmə yox)
export const LLM_DEADLINE_MS = 13000;

export async function produce({ kind, llm, brand, input, schema, req = {}, template, maxTokens = 2000, order }) {
  const ctx = contextFor(brand, input);
  let fallback = null;
  if (llm && llm.provider !== "template" && typeof llm.completeJson === "function") {
    let res = null;
    try {
      let timer;
      const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("llm deadline"), { llmDeadline: true })), LLM_DEADLINE_MS); });
      try {
        res = await Promise.race([llm.completeJson({ system: systemPrompt(kind, brand, ctx.allowCard), user: userPrompt(kind, brand, input, { request: req.public || {} }), schema, maxTokens, ...(order ? { order } : {}) }), deadline]);
      } finally { clearTimeout(timer); }
    } catch (e) {
      fallback = e && e.llmDeadline ? "llm_timeout" : "llm_error";
    }
    if (!fallback) {
      const v = validate(schema, res);
      if (!v.ok) fallback = "llm_invalid";
      else {
        const post = POST[kind](res, ctx, req);
        if (post.ok) return { source: llm.provider === "openai" ? "openai" : "claude", provider: llm.provider, ai_generated: true, personalized: true, notice: NOTICE_AI, content: post.content, ctx };
        fallback = "llm_unsafe:" + post.problems.join(",");
      }
    }
  } else {
    fallback = llm ? "llm_template_provider" : "llm_unavailable";
  }
  const content = template(ctx);
  return { source: "template", provider: "template", ai_generated: false, personalized: false, fallback_reason: fallback, notice: NOTICE_TEMPLATE, content, ctx };
}

// ---- ümumi çıxış çərçivəsi ----
export function frame(brand, input, r) {
  const out = { source: r.source, provider: r.provider, ai_generated: r.ai_generated, personalized: r.personalized, notice: r.notice, draft_only: true, published: false, brand: brand.id, language: "az", needs_owner_input: missingFacts(brand, input.facts) };
  if (r.fallback_reason) out.fallback_reason = r.fallback_reason;
  return out;
}

// ---- nəşr planı (platforma qeydləri) ----
function fitHashtags(caption, tags, limit) {
  const t = [...tags];
  while (t.length && (caption + "\n\n" + t.join(" ")).length > limit) t.pop();
  return t;
}

export function buildPublishingPlan(plan, platforms, brand) {
  const out = {};
  const linkNote = brand.page_url ? "Yeganə link: " + brand.page_url : "Bu brend üçün reyestrdə link yoxdur: link yalnız sahibin verdiyi faktlardan götürülür.";
  const drafts = "Dərc olunmayıb: bu yalnız qaralamadır.";
  if (platforms.includes("instagram")) {
    const tags = fitHashtags(plan.caption, plan.hashtags.slice(0, LIMITS.instagram.hashtags), LIMITS.instagram.caption);
    const caption = tags.length ? plan.caption + "\n\n" + tags.join(" ") : plan.caption;
    out.instagram = { format: "reel", caption, caption_chars: caption.length, caption_limit: LIMITS.instagram.caption, hashtags: tags, notes: ["Reel üçün şaquli (9:16) video planlaşdırın.", "Link caption-da klikləmir: bio linkindən istifadə planlayın (platformada yoxlayın).", linkNote, drafts] };
  }
  if (platforms.includes("tiktok")) {
    const tags = fitHashtags(plan.caption, plan.hashtags.slice(0, LIMITS.tiktok.hashtags), LIMITS.tiktok.caption);
    const caption = tags.length ? plan.caption + "\n\n" + tags.join(" ") : plan.caption;
    out.tiktok = { format: "video", caption, caption_chars: caption.length, caption_limit: LIMITS.tiktok.caption, hashtags: tags, notes: ["Şaquli video; ilk saniyələrdə hook.", "Link caption-da klikləmə ola bilməz: bio linkini planlayın (platformada yoxlayın).", linkNote, drafts] };
  }
  if (platforms.includes("youtube")) {
    const description = (plan.caption + "\n\n" + plan.cta).slice(0, LIMITS.youtube.description);
    const tags = plan.hashtags.slice(0, LIMITS.youtube.hashtags);
    out.youtube = { format: "short", title: plan.youtube_title, title_chars: plan.youtube_title.length, title_limit: LIMITS.youtube.title, description, description_chars: description.length, hashtags: tags, notes: ["Başlıq 100 simvolu keçməməlidir.", "Link təsvirdə (description) yerləşdirilir.", linkNote, drafts] };
  }
  return out;
}

export { getBrand, templatePlan, templateHooks, templateCaptions, templateHashtags, templateCalendar, requestsDigitalCard };
