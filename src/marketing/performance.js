// Performans təhlili: YALNIZ çağıranın verdiyi göstəricilər üzərində deterministik hesablama.
// Heç bir xarici etalon (benchmark), "sənaye ortalaması" və ya uydurma rəqəm yoxdur.
// Verilməyən göstərici 0 sayılmır: "yoxdur" kimi qalır (null).

const METRICS = ["views", "reach", "likes", "comments", "shares", "saves", "clicks", "followers_gained"];
const INTERACTIONS = ["likes", "comments", "shares", "saves"];

const r2 = (n) => Math.round(n * 100) / 100;
const sum = (a) => a.reduce((x, y) => x + y, 0);

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : r2((s[m - 1] + s[m]) / 2);
}

function interactionsOf(it) {
  const given = INTERACTIONS.filter((k) => typeof it[k] === "number");
  return given.length ? sum(given.map((k) => it[k])) : null;
}

function erOf(it) {
  const inter = interactionsOf(it);
  if (inter === null || typeof it.views !== "number" || it.views <= 0) return null;
  return r2((inter / it.views) * 100);
}

export function analyzePerformance(items = [], { platform } = {}) {
  const rows = (Array.isArray(items) ? items : []).filter((it) => it && typeof it === "object" && (!platform || it.platform === platform));
  const hasData = rows.filter((it) => METRICS.some((k) => typeof it[k] === "number"));
  if (!hasData.length) {
    return { status: "insufficient_data", sample_size: 0, reason: "Göstərici verilməyib: təhlil üçün ən azı bir paylaşımın rəqəmləri lazımdır (views, likes, comments və s.). Heç bir rəqəm uydurulmur.", no_external_benchmarks: true };
  }

  const per_item = hasData.map((it, i) => ({ id: it.id || "item_" + (i + 1), platform: it.platform || null, date: it.date || null, views: typeof it.views === "number" ? it.views : null, interactions: interactionsOf(it), engagement_rate_pct: erOf(it) }));

  const totals = {};
  for (const k of METRICS) {
    const vals = hasData.filter((it) => typeof it[k] === "number").map((it) => it[k]);
    totals[k] = vals.length ? { total: sum(vals), items_with_metric: vals.length, average: r2(sum(vals) / vals.length), median: median(vals) } : null;
  }

  // Ümumi ER yalnız həm baxışı, həm qarşılıqlı əlaqəsi olan paylaşımlarda
  const both = per_item.filter((x) => x.engagement_rate_pct !== null);
  const aggViews = sum(both.map((x) => x.views));
  const aggInter = sum(both.map((x) => x.interactions));
  const aggregate_er = both.length && aggViews > 0 ? r2((aggInter / aggViews) * 100) : null;

  const ranked = [...both].sort((a, b) => b.engagement_rate_pct - a.engagement_rate_pct);
  const best = ranked.length >= 2 ? ranked[0] : null;
  const worst = ranked.length >= 2 ? ranked[ranked.length - 1] : null;

  const byPlatform = {};
  for (const x of both) {
    if (!x.platform) continue;
    (byPlatform[x.platform] = byPlatform[x.platform] || []).push(x);
  }
  const platforms = Object.entries(byPlatform).map(([p, xs]) => ({ platform: p, items: xs.length, average_er_pct: r2(sum(xs.map((x) => x.engagement_rate_pct)) / xs.length) }));

  // Tendensiya: tarixli ən azı 4 paylaşım
  let trend = { status: "insufficient_data", reason: "Tendensiya üçün ER hesablanan və tarixli ən azı 4 paylaşım lazımdır." };
  const dated = both.filter((x) => x.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (dated.length >= 4) {
    const half = Math.floor(dated.length / 2);
    const a = sum(dated.slice(0, half).map((x) => x.engagement_rate_pct)) / half;
    const b = sum(dated.slice(dated.length - half).map((x) => x.engagement_rate_pct)) / half;
    const change = a > 0 ? (b - a) / a : null;
    trend = { status: "ok", first_half_avg_er_pct: r2(a), last_half_avg_er_pct: r2(b), direction: change === null ? "undetermined" : change > 0.1 ? "up" : change < -0.1 ? "down" : "flat" };
  }

  const n = hasData.length;
  const status = n < 3 ? "limited" : "ok";
  const insights = [];
  if (aggregate_er !== null) insights.push("Ümumi qarşılıqlı əlaqə dərəcəsi (ER): " + aggregate_er + "% (" + both.length + " paylaşım üzrə, yalnız verilmiş rəqəmlərdən).");
  if (best && worst && best.id !== worst.id) {
    insights.push("Ən yüksək ER: " + best.id + " (" + best.engagement_rate_pct + "%). Ən aşağı: " + worst.id + " (" + worst.engagement_rate_pct + "%).");
  }
  if (platforms.length > 1) {
    const top = [...platforms].sort((a, b) => b.average_er_pct - a.average_er_pct)[0];
    insights.push("Verilmiş nümunədə ən yüksək orta ER: " + top.platform + " (" + top.average_er_pct + "%).");
  }
  if (!both.length) insights.push("ER hesablanmadı: baxış (views) və ən azı bir qarşılıqlı əlaqə göstəricisi birlikdə verilməyib.");
  if (trend.status === "ok") insights.push("Tendensiya (ER, ilk yarı ilə son yarı): " + trend.direction + ".");

  const warnings = [];
  if (status === "limited") warnings.push("Nümunə kiçikdir (" + n + " paylaşım): nəticə etibarlı sayılmamalıdır.");
  if (n < 10) warnings.push("Kiçik nümunə: təsadüfi dalğalanma ilə real fərqi ayırmaq mümkün deyil.");
  const missingViews = hasData.filter((it) => typeof it.views !== "number").length;
  if (missingViews) warnings.push(missingViews + " paylaşımda views verilməyib: onlar üçün ER hesablanmayıb (0 sayılmayıb).");

  const recommendations = [];
  if (status === "ok" && best && worst && best.engagement_rate_pct > worst.engagement_rate_pct) recommendations.push("Ən yüksək ER-li paylaşımı (" + best.id + ") hook, format və vaxt baxımından təhlil edib A/B ilə təkrar sınayın.");
  if (status !== "ok") recommendations.push("Daha çox paylaşımın rəqəmini toplayın (ən azı 3, tercihən 10+) və yenidən təhlil edin.");

  return { status, sample_size: n, per_item, totals, aggregate_er_pct: aggregate_er, best, worst, by_platform: platforms, trend, insights, warnings, recommendations, no_external_benchmarks: true };
}
