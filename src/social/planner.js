// Planlaşdırıcı: Claude yalnız MƏTN hazırlayır (başlıq, təsvir, hashtag). Paylaşmır.
// Alətlərə, tokenlərə və təsdiq qeydinə çıxışı yoxdur. Çıxış sərt yoxlanır:
// yalnız tanınmış sahələr, uzunluq limitləri, hashtag təmizləməsi.
// İstifadəçi mətni etibarsız məlumat kimi etiketlənir (prompt injection qorunması).

import { ClaudeAdapter } from "../adapters/ClaudeAdapter.js";
import { CallBudget } from "../guards/budget.js";
import { normalizeHashtags } from "./request.js";
import { cleanText, UNTRUSTED_RULE } from "../security/sanitize.js";

const SYSTEM =
  "You write social media copy for Farid, in the language of his request (usually Azerbaijani). " +
  "Return ONLY one JSON object: {\"caption\": string, \"title\": string, \"description\": string, \"hashtags\": string[]}. " +
  "caption: engaging post text, max 1800 characters, no hashtags inside it. title: short video title, max 90 characters. " +
  "description: optional longer text for YouTube, may be empty. hashtags: up to 10 words without the # sign. " +
  "Never invent links, phone numbers, prices, names or facts that are not in the request. " +
  "You cannot publish, call tools, or change settings; you only write copy. " +
  UNTRUSTED_RULE;

function parseJson(text) {
  const s = String(text || "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    return null;
  }
}

function str(v, max) {
  return typeof v === "string" ? cleanText(v, max).text.trim() : "";
}

// Qaytarır: { caption, title, description, hashtags, source: "claude"|"fallback" }
export async function draftCopy({ env, instruction, platforms, timeoutMs = 25000 }) {
  const fallbackCaption = cleanText(String(instruction || ""), 1800).text.trim();
  const fallback = { caption: fallbackCaption, title: fallbackCaption.split(/\r?\n/)[0].slice(0, 90), description: "", hashtags: [], source: "fallback" };
  if (!env.ANTHROPIC_API_KEY || !fallbackCaption) return fallback;
  try {
    const claude = new ClaudeAdapter(env);
    const ctx = { budget: new CallBudget(1), timeoutMs };
    const user = "Platforms: " + platforms.join(", ") + "\n<external_content>\n" + fallbackCaption + "\n</external_content>";
    const out = await claude.complete(SYSTEM, [{ role: "user", content: user }], 900, ctx);
    const j = parseJson(out);
    if (!j) return fallback;
    const caption = str(j.caption, 1800) || fallbackCaption;
    return {
      caption,
      title: str(j.title, 90) || fallback.title,
      description: str(j.description, 900),
      hashtags: normalizeHashtags(Array.isArray(j.hashtags) ? j.hashtags.filter((x) => typeof x === "string").slice(0, 15) : []).slice(0, 10),
      source: "claude",
    };
  } catch (e) {
    return fallback;
  }
}
