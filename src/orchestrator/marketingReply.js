// Yalnız marketing.* alətlərindən ibarət sorğu üçün YEKUN cavab: model çağırışı YOXDUR.
// Alət çıxışları artıq strukturlu və təmizlənmişdir (src/marketing/engine.js), ona görə ikinci (FINAL) model çağırışı
// yalnız formatlama idi və Worker vaxtını yeyirdi. Burada mətn deterministik qurulur, alət nəticəsindən kənar heç nə əlavə olunmur.

const LABELS = {
  "marketing.campaign.plan": "Kampaniya planı",
  "marketing.hooks": "Hook-lar",
  "marketing.captions": "Caption-lar",
  "marketing.hashtags": "Hashteqlər",
  "marketing.calendar": "Kontent təqvimi",
  "marketing.performance.analyze": "Performans təhlili",
  "marketing.segments": "Seqmentlər",
};

export const isMarketingTool = (name) => /^marketing\./.test(String(name || ""));

const s = (v, max = 600) => String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const list = (a) => (Array.isArray(a) ? a : []);

function sourceNote(o) {
  if (o.ai_generated) return "AI qaralaması";
  if (o.source === "template") return "şablon qaralama" + (o.fallback_reason ? " (səbəb: " + s(o.fallback_reason, 80) + ")" : "");
  return o.source ? s(o.source, 40) : "";
}

function planLines(o) {
  const p = o.plan || {};
  const out = [];
  const ta = p.target_audience || {};
  if (ta.primary) out.push("Hədəf: " + s(ta.primary, 200) + (list(ta.segments).length ? " (" + list(ta.segments).map((x) => s(x, 120)).join(", ") + ")" : ""));
  if (p.hook) out.push("Hook: " + s(p.hook, 200));
  if (list(p.script).length) {
    out.push("Ssenari:");
    for (const st of list(p.script)) out.push("- " + s(st.timing, 30) + ": " + s(st.voiceover, 300) + (st.visual ? " [" + s(st.visual, 200) + "]" : ""));
  }
  if (list(p.shot_list).length) out.push("Çəkiliş: " + list(p.shot_list).map((x) => x.shot + ") " + s(x.description, 160) + " (" + x.duration_sec + " san)").join("; "));
  if (p.caption) out.push("Caption: " + s(p.caption, 2200));
  if (p.cta) out.push("CTA: " + s(p.cta, 300));
  if (list(p.hashtags).length) out.push("Hashteqlər: " + list(p.hashtags).join(" "));
  if (p.youtube_title) out.push("YouTube başlığı: " + s(p.youtube_title, 100));
  for (const ab of list(p.ab_ideas)) out.push("A/B (" + s(ab.variable, 80) + "): A) " + s(ab.variant_a, 200) + " | B) " + s(ab.variant_b, 200) + " | ölçü: " + s(ab.measure, 120));
  const pf = Object.keys(o.publishing_plan || {});
  if (pf.length) out.push("Platformalar: " + pf.join(", "));
  return out;
}

function bodyLines(tool, o) {
  switch (tool) {
    case "marketing.campaign.plan": return planLines(o);
    case "marketing.hooks": return list(o.hooks).map((h, i) => i + 1 + ". " + s(h, 200));
    case "marketing.captions": return list(o.captions).map((c, i) => i + 1 + ". " + (c.title ? "[" + s(c.title, 100) + "] " : "") + s(c.text, 2200) + (c.cta ? "\n   CTA: " + s(c.cta, 300) : ""));
    case "marketing.hashtags": return [list(o.hashtags).join(" ")];
    case "marketing.calendar": return list(o.items).map((it) => (it.date || "gün " + it.day) + " · " + s(it.platform, 20) + " · " + s(it.format, 30) + ": " + s(it.idea, 300) + (it.hook ? " (hook: " + s(it.hook, 200) + ")" : ""));
    case "marketing.segments": return list(o.segments).map((x) => "- " + s(x.label, 120) + ": " + s(x.angle, 200));
    case "marketing.performance.analyze": return [s(o.status, 40) + " (nümunə: " + (o.sample_size || 0) + ")" + (o.reason ? ": " + s(o.reason, 300) : "")];
    default: return [s(JSON.stringify(o), 1500)];
  }
}

// results: handleTools-un [{tool, status, approval_id, output, error}] siyahısı.
export function formatMarketingReply(results) {
  const blocks = [];
  const notices = new Set();
  const needs = new Set();
  const names = [];
  let templates = 0;
  for (const r of results) {
    const label = LABELS[r.tool] || r.tool;
    if (r.status !== "done" || !r.output) {
      blocks.push("■ " + label + ": alınmadı (" + s(r.error || r.status, 200) + ")");
      continue;
    }
    const o = r.output;
    names.push(label.toLowerCase());
    if (o.source === "template") templates++;
    if (o.notice) notices.add(s(o.notice, 400));
    for (const n of list(o.needs_owner_input)) needs.add(s(n, 60));
    const src = sourceNote(o);
    blocks.push(["■ " + label + (src ? " (" + src + ")" : ""), ...bodyLines(r.tool, o)].join("\n"));
  }
  const tail = [];
  if (needs.size) tail.push("Sizdən lazım olan məlumat: " + [...needs].join(", ") + ".");
  if (notices.size) tail.push(...notices);
  tail.push("Heç nə dərc olunmayıb: bunlar yalnız qaralamadır.");
  const screen = blocks.join("\n\n") + "\n\n" + tail.join("\n");

  const failed = results.length - names.length;
  const parts = [];
  if (names.length) parts.push("Marketinq qaralamaları hazırdır: " + [...new Set(names)].join(", ") + ".");
  else parts.push("Marketinq alətləri nəticə vermədi, səbəb ekranda.");
  if (names.length && failed) parts.push("Bəzi hissələr alınmadı, səbəb ekranda.");
  if (templates) parts.push(templates === names.length ? "AI nəticəsi alınmadı, şablon qaralama göstərilir." : "Bəziləri şablondur, AI nəticəsi alınmadı.");
  else if (names.length) parts.push("Heç nə dərc olunmayıb, mətn ekranda.");
  return { spoken: parts.slice(0, 3).join(" "), screen };
}
