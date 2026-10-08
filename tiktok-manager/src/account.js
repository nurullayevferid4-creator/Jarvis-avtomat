// Universal hesab analizatoru. Hər yeni hesab qoşulanda ilk işləyən addımdır.
// Qayda: API-dən gəlməyən və sahibin təsdiqləmədiyi heç bir fakt "bilinir" kimi yazılmır → "NAMƏLUM".
import { analyzeVideos, followerGrowth } from "./analytics.js";

export const UNKNOWN = "NAMƏLUM";

// Biznes faktları API-də yoxdur: sahib doldurur (business.json). Boş sahə = uydurma qadağandır.
export const BUSINESS_TEMPLATE = Object.freeze({
  business: null, niche: null, products: [], services: [], audience: null, language: null, market: null,
  goal: null, price: null, delivery: null, payment: null, warranty: null, contact: null, website: null,
  proof: [], // yalnız real sübut: [{ text, source, verified: true }]
});

export function detectLanguage(texts) {
  const s = texts.join(" ");
  if (s.replace(/\s/g, "").length < 20) return { value: UNKNOWN, basis: "mətn azdır" };
  const counts = {
    az: (s.match(/[əƏ]/g) || []).length * 3 + (s.match(/[ğışöüçĞIŞÖÜÇ]/g) || []).length,
    tr: (s.match(/\b(ve|bir|için|çok|değil|ile)\b/gi) || []).length * 3,
    ru: (s.match(/[а-яА-ЯёЁ]/g) || []).length,
    en: (s.match(/\b(the|and|you|your|how|this|with|for)\b/gi) || []).length * 3,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 3) return { value: UNKNOWN, basis: "aydın siqnal yoxdur" };
  return { value: best[0], basis: "caption/bio mətnindən heuristik (təsdiq lazımdır)" };
}

function topKeywords(videos, n = 10) {
  const stop = new Set("və ilə bu bir üçün da də ki the and you for with this that your how what from are is it to of in on a an на и в не что это".split(" "));
  const freq = {};
  for (const v of videos) {
    for (const w of String(v.title || v.video_description || "").toLowerCase().replace(/#[^\s#]+/g, " ").match(/[\p{L}]{4,}/gu) || []) {
      if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w, c]) => ({ word: w, count: c }));
}

export async function analyzeAccount({ client, workspace, maxVideos = 100, now = () => new Date().toISOString() }) {
  const { user, fields_requested } = await client.userInfo();
  const accountId = user.open_id || client.tokenRecord().open_id;
  if (!accountId) throw new Error("open_id alınmadı: hesab identifikasiya olunmadı");
  const switched = workspace.setActive(accountId);

  let videos = [];
  let videoError = null;
  try { videos = await client.listAllVideos(maxVideos); } catch (e) { videoError = { code: e.code, message: e.message }; }

  const snapshots = workspace.readJson(accountId, "snapshots.json", []);
  if (user.follower_count != null) {
    snapshots.push({ at: now(), follower_count: user.follower_count, following_count: user.following_count ?? null, likes_count: user.likes_count ?? null, video_count: user.video_count ?? null });
    workspace.writeJson(accountId, "snapshots.json", snapshots);
  }
  workspace.writeJson(accountId, "videos.json", { fetched_at: now(), videos });

  let business = workspace.readJson(accountId, "business.json", null);
  if (!business) { business = { ...BUSINESS_TEMPLATE }; workspace.writeJson(accountId, "business.json", business); }

  const perf = analyzeVideos(videos);
  const growth = followerGrowth(snapshots);
  const lang = business.language ? { value: business.language, basis: "sahib təsdiqləyib" } : detectLanguage([user.bio_description || "", ...videos.map((v) => v.video_description || v.title || "")]);

  const profile = {
    account_id: accountId, analyzed_at: now(), switched_account: switched,
    api: { fields_requested, video_error: videoError },
    identity: {
      username: user.username || UNKNOWN, display_name: user.display_name || UNKNOWN,
      bio: user.bio_description ?? UNKNOWN, verified: user.is_verified ?? UNKNOWN, profile_link: user.profile_deep_link || UNKNOWN,
    },
    stats: {
      followers: user.follower_count ?? UNKNOWN, following: user.following_count ?? UNKNOWN,
      total_likes: user.likes_count ?? UNKNOWN, video_count: user.video_count ?? UNKNOWN,
    },
    growth,
    business: Object.fromEntries(Object.entries(BUSINESS_TEMPLATE).map(([k]) => [k, isEmpty(business[k]) ? UNKNOWN : business[k]])),
    language: lang,
    content_signals: { top_keywords: topKeywords(videos), note: "Niche/mövzu hipotezidir: caption sözlərindən çıxarılıb, sahib təsdiqləməlidir." },
    performance: perf,
    missing_business_facts: Object.keys(BUSINESS_TEMPLATE).filter((k) => isEmpty(business[k]) && k !== "proof"),
  };
  workspace.writeJson(accountId, "account.json", profile);
  workspace.publishProfile(accountId, profileMarkdown(profile));
  return profile;
}

const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const fmt = (v) => (v == null ? UNKNOWN : Array.isArray(v) ? (v.length ? v.map((x) => (typeof x === "object" ? x.text || JSON.stringify(x) : x)).join(", ") : UNKNOWN) : typeof v === "object" ? JSON.stringify(v) : String(v));

export function profileMarkdown(p) {
  const L = [];
  L.push("# TikTok hesab profili", "", "> Avtomatik yaradılıb: " + p.analyzed_at + ". Mənbə: rəsmi TikTok Display API + sahibin doldurduğu business.json.", "> `NAMƏLUM` = API vermir və sahib doldurmayıb. Sistem bunları uydurmur.", "");
  L.push("## Kimlik", "| Sahə | Dəyər |", "|---|---|");
  for (const [k, v] of Object.entries(p.identity)) L.push("| " + k + " | " + fmt(v).replace(/\|/g, "\\|").replace(/\n/g, " ") + " |");
  L.push("", "## Statistika (API)", "| Sahə | Dəyər |", "|---|---|");
  for (const [k, v] of Object.entries(p.stats)) L.push("| " + k + " | " + fmt(v) + " |");
  L.push("", "## Follower artımı", p.growth.status === "ok" ? "- " + p.growth.from + " → " + p.growth.to + ": " + p.growth.start + " → " + p.growth.end + " (" + (p.growth.delta >= 0 ? "+" : "") + p.growth.delta + ", gündə " + p.growth.per_day + ")" : "- " + p.growth.note);
  L.push("", "## Biznes (sahibdən)", "| Sahə | Dəyər |", "|---|---|");
  for (const [k, v] of Object.entries(p.business)) L.push("| " + k + " | " + fmt(v).replace(/\|/g, "\\|") + " |");
  if (p.missing_business_facts.length) L.push("", "**Doldurulmalı:** `workspace/accounts/" + p.account_id + "/business.json` → " + p.missing_business_facts.join(", "));
  L.push("", "## Dil", "- " + p.language.value + " (" + p.language.basis + ")");
  L.push("", "## Kontent siqnalları (hipotez)", p.content_signals.top_keywords.length ? p.content_signals.top_keywords.map((k) => "- " + k.word + " ×" + k.count).join("\n") : "- kifayət qədər məlumat yoxdur");
  const perf = p.performance;
  L.push("", "## Performans");
  if (!perf.n) L.push("- " + perf.note);
  else {
    L.push("- Analiz olunan video: " + perf.n + " (" + perf.status + ")", "- Median baxış: " + perf.median_views + ", median engagement rate: " + perf.median_engagement_rate);
    L.push("", "### Ən yaxşı videolar", ...perf.top.map((v) => "- " + v.views + " baxış · ER " + v.engagement_rate + " · " + v.duration + "s · hook: \"" + v.hook + "\" (" + v.hook_pattern + ")"));
    L.push("", "### Zəif videolar", ...perf.bottom.map((v) => "- " + v.views + " baxış · ER " + v.engagement_rate + " · " + v.duration + "s · hook: \"" + v.hook + "\""));
    L.push("", "### Niyə işləyib (müşahidə)", ...perf.why_top_worked.map((o) => "- " + o.observation + " [" + o.type + "]"));
    L.push("", "### Qruplar (median baxış)");
    for (const [g, rows] of Object.entries(perf.groups)) L.push("- **" + g + "**: " + rows.slice(0, 6).map((r) => r.key + " = " + r.median_views + " (n=" + r.n + (r.reliable ? "" : ", az") + ")").join("; "));
    L.push("", "> " + perf.caveat);
  }
  L.push("", "## API-nin vermədiyi metriklər", ...Object.entries(p.performance.unavailable || {}).map(([k, v]) => "- " + k + ": " + v));
  if (p.api.video_error) L.push("", "**Video siyahısı alınmadı:** " + p.api.video_error.code + " — " + p.api.video_error.message);
  return L.join("\n") + "\n";
}
