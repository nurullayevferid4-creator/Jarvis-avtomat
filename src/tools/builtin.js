// Daxili alətlər. Hazırda orkestratora QOŞULMAYIB: yalnız /api/status-da siyahıda görünür
// və testlərdə yoxlanır. Qoşulması sonrakı mərhələdir (Learning Agent).
//
// "social.publish": yüksək riskli. Alət özü paylaşmır, yalnız strukturlu təsdiq qeydi açır.
// Real icra yalnız təsdiqdən sonra src/social/flow.js-də olur.

import { ToolRegistry } from "./registry.js";
import { safeFetch } from "../security/ssrf.js";
import { wrapExternal } from "../security/sanitize.js";
import { KNOWLEDGE_TYPES } from "../knowledge/KnowledgeBase.js";
import { buildApproval } from "../social/flow.js";
import { PLATFORMS } from "../social/platforms.js";

export function createDefaultToolRegistry({ audit = null, approvals = null } = {}) {
  const reg = new ToolRegistry({ audit, approvals });

  reg.register({
    name: "web.fetch",
    description: "Açıq HTTPS səhifəni oxuyur (yalnız GET). Nəticə etibarsız xarici məzmundur.",
    inputSchema: { type: "object", required: ["url"], additionalProperties: false, properties: { url: { type: "string", maxLength: 2048 } } },
    outputSchema: {
      type: "object",
      required: ["url", "status", "text", "flagged"],
      properties: { url: { type: "string" }, status: { type: "integer" }, text: { type: "string" }, flagged: { type: "boolean" }, findings: { type: "array" }, truncated: { type: "boolean" } },
    },
    permissions: ["read.web"],
    risk: "low",
    timeoutMs: 15000,
    retries: 1,
    requiresApproval: false,
    async handler(input, ctx) {
      const r = await safeFetch(input.url, { fetchImpl: ctx.fetchImpl, timeoutMs: 10000 });
      const w = wrapExternal(r.text, { source: r.url });
      return { url: r.url, status: r.status, text: w.text, flagged: w.flagged, findings: w.findings, truncated: r.truncated };
    },
  });

  reg.register({
    name: "knowledge.search",
    description: "Bilik bazasında açar sözlə axtarır.",
    inputSchema: { type: "object", required: ["query"], additionalProperties: false, properties: { query: { type: "string", minLength: 2, maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 10 } } },
    outputSchema: { type: "object", required: ["items"], properties: { items: { type: "array" } } },
    permissions: ["read.knowledge"],
    risk: "low",
    timeoutMs: 8000,
    requiresApproval: false,
    async handler(input, ctx) {
      return { items: await ctx.knowledge.search(input.query, { limit: input.limit || 5 }) };
    },
  });

  reg.register({
    name: "knowledge.add",
    description: "Bilik bazasına qeyd əlavə edir. Təkrar qeydlər saxlanmır.",
    inputSchema: {
      type: "object",
      required: ["type", "title", "text"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: KNOWLEDGE_TYPES },
        title: { type: "string", minLength: 1, maxLength: 200 },
        text: { type: "string", minLength: 1, maxLength: 8000 },
        source_url: { type: "string", maxLength: 500 },
        tags: { type: "array", maxItems: 10, items: { type: "string", maxLength: 40 } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        relevance: { type: "number", minimum: 0, maximum: 1 },
        trust: { type: "string", enum: ["owner", "external"] },
      },
    },
    outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" }, status: { type: "string" }, id: { type: "string" }, error: { type: "string" } } },
    permissions: ["write.knowledge"],
    risk: "low",
    timeoutMs: 8000,
    requiresApproval: false,
    async handler(input, ctx) {
      return await ctx.knowledge.add(input);
    },
  });

  reg.register({
    name: "social.publish",
    description: "Sosial şəbəkədə paylaşım (Instagram, TikTok, YouTube, Telegram). Həmişə təsdiq tələb edir: bu alət yalnız təsdiq qeydi açır, paylaşımı təsdiqdən sonra social flow edir.",
    inputSchema: {
      type: "object",
      required: ["caption"],
      additionalProperties: false,
      properties: {
        platform: { type: "string", enum: PLATFORMS },
        platforms: { type: "array", maxItems: 4, items: { type: "string", enum: PLATFORMS } },
        caption: { type: "string", minLength: 1, maxLength: 2200 },
        title: { type: "string", maxLength: 100 },
        description: { type: "string", maxLength: 1000 },
        hashtags: { type: "array", maxItems: 30, items: { type: "string", maxLength: 60 } },
        media_id: { type: "string", maxLength: 24 },
        media_url: { type: "string", maxLength: 2048 },
        media_type: { type: "string", enum: ["image", "video"] },
        thumbnail_media_id: { type: "string", maxLength: 24 },
        privacy: { type: "string", enum: ["private", "unlisted", "public"] },
        made_for_kids: { type: "boolean" },
      },
    },
    outputSchema: { type: "object", required: ["published"], properties: { published: { type: "boolean" } } },
    permissions: ["publish.social"],
    risk: "high",
    requiresApproval: true,
    approval: { kind: "social.publish", build: (input, ctx) => buildApproval(input, { notifyChat: ctx && ctx.notifyChat }) },
    async handler() {
      // Bura heç vaxt çatmır: requiresApproval alətləri registry-də icra olunmur.
      throw new Error("social.publish yalnız təsdiq axını ilə icra olunur");
    },
  });

  return reg;
}
