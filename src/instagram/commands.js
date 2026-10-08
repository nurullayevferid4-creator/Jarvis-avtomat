// Telegram əmrləri (deterministik, model çağırışı yox; OpenAI-yə ehtiyac yoxdur):
//   Instagram status | DM-ləri yoxla | Şərhləri yoxla | Müştəri tap | Lead-ləri göstər | Satışları göstər |
//   Bugünkü Instagram hesabatı | lead <id|@user> <MƏRHƏLƏ> | DM hazırla <id|@user> | lead əlavə et @user <qeyd>
// Hamısı oxuma/qaralama; göndərmə yalnız təsdiq qeydi + düymə ilə.

import { toSocialError } from "../social/errors.js";
import { createProviderRouter } from "../providers/router.js";
import { STAGES, presentLead } from "./sales.js";
import { normHandle } from "../leads/model.js";

const fold = (s) => String(s || "").toLocaleLowerCase("az").replace(/ə/g, "e").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/[.!?]+$/g, "").replace(/\s+/g, " ").trim();

export function igIntent(text) {
  const t = fold(text);
  if (/^(instagram|insta|ig) (status|veziyyet|vəziyyət)$/.test(t) || t === "instagram statusu") return { cmd: "status" };
  if (/^(instagram )?(dm|dmler|dm-ler|dm ler|mesajlar)\w* (yoxla|bax)/.test(t) || /^dm-?leri yoxla$/.test(t)) return { cmd: "dms" };
  if (/^(instagram )?(serhler|serhleri) (yoxla|bax)/.test(t) || /^serhleri yoxla$/.test(t)) return { cmd: "comments" };
  if (/^musteri tap\b/.test(t)) return { cmd: "find", arg: String(text).replace(/^[^]*?tap[:\s]*/i, "").trim().slice(0, 100) };
  if (/^lead-?leri (goster|goster)$/.test(t) || /^leadleri goster$/.test(t) || t === "lead-leri goster") return { cmd: "leads" };
  if (/^satislari goster$/.test(t)) return { cmd: "sales" };
  if (/^(bugunku )?instagram hesabat/.test(t) || /^bugunku instagram hesabati/.test(t)) return { cmd: "report" };
  let m = /^lead (l\d{4,6}|@?[a-z0-9._]{2,40}) (new|contacted|interested|qualified|negotiation|won|lost)$/.exec(t);
  if (m) return { cmd: "stage", ref: m[1], stage: m[2].toUpperCase() };
  m = /^dm hazirla (l\d{4,6}|@?[a-z0-9._]{2,40})$/.exec(t);
  if (m) return { cmd: "draftdm", ref: m[1] };
  m = /^lead elave et @?([a-z0-9._]{2,40})\s*(.*)$/.exec(t);
  if (m) return { cmd: "addlead", ref: m[1], note: String(text).replace(/^[^]*?@?\b[a-z0-9._]{2,40}\b\s*/i, "").slice(0, 200) };
  return null;
}

const KIMI_SYSTEM = "You help find QR Menu customers in Azerbaijan. DO NOT name any specific business, person, phone, price or fact. Give exactly 5 Instagram search ideas (hashtags, location tags, account types) to find restaurants, cafes, bars, tea houses and newly opened venues that could need a QR menu, plus one short respectful outreach angle. Azerbaijani, max 900 chars. This is brainstorming, not research results.";

export function createIgCommands({ env, hub, sales, inbox, flow, approvals, now = () => Date.now() }) {
  const ig = () => hub.adapter("instagram");

  async function status() {
    const base = await ig().cachedStatus();
    const lines = ["Instagram: " + base.state + (base.reason ? " – " + base.reason : "")];
    if (base.state === "CONNECTED") {
      try {
        const s = await ig().salesStatus();
        lines.push("Hesab: @" + ((s.account && s.account.username) || "?") + " (" + ((s.account && s.account.account_type) || "?") + ")");
        lines.push("Token: " + (s.expires_in_days === null ? "?" : s.expires_in_days + " gün") + (s.expires_in_days !== null && s.expires_in_days < 10 ? " ⚠️ yaxında bitir" : ""));
        lines.push("İcazələr: paylaşım " + (s.publish_scope ? "✅" : "❌") + ", DM " + (s.messaging_scope ? "✅" : "❌") + ", şərh " + (s.comments_scope ? "✅" : "❌"));
        if (!s.messaging_scope || !s.comments_scope) lines.push("→ DM/şərh üçün hesabı yenidən qoş: /connect instagram");
      } catch (e) {
        lines.push("Canlı yoxlama alınmadı: " + toSocialError(e).message.slice(0, 160));
      }
    } else if (base.state === "NOT_CONNECTED" || base.state === "TOKEN_EXPIRED") lines.push("→ /connect instagram");
    lines.push("Webhook: " + (env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN && env.INSTAGRAM_APP_SECRET ? "konfiqurasiya var (Meta panelində abunəlik ayrıca yoxlanmalıdır)" : "INSTAGRAM_WEBHOOK_VERIFY_TOKEN / INSTAGRAM_APP_SECRET yoxdur: yalnız əl ilə yoxlama işləyir"));
    const s = await sales.summary();
    lines.push("Lead-lər: " + s.total + " · bu gün DM göndərilib: " + s.dm_sent_today);
    return lines.join("\n");
  }

  const fmtRes = (r, what) => what + ": " + r.dms + " DM, " + r.comments + " şərh işlənildi" + (r.dup ? ", " + r.dup + " köhnə" : "") + (r.errors ? ", ⚠️ " + r.errors + " xəta" : "") + (r.dms + r.comments ? ". Bildirişlər yuxarıdadır." : ".");

  async function leads() {
    const l = await sales.list({ limit: 10 });
    return l.length ? "Lead-lər (bal üzrə):\n" + l.map(presentLead).join("\n") : "Hələ lead yoxdur. DM və şərhlər gəldikcə avtomatik yaranır.";
  }

  async function salesView() {
    const s = await sales.summary();
    return "Satış axını (cəmi " + s.total + "):\n" + Object.entries(s.by_stage).map(([k, v]) => "• " + k + ": " + v).join("\n") + "\nMərhələ dəyiş: «lead L0001 QUALIFIED»";
  }

  async function report() {
    const s = await sales.summary();
    const pending = (await approvals.list({ status: "pending", limit: 30 })).filter((a) => a.kind && a.kind.startsWith("instagram."));
    const jobs = (await flow.listJobs(20)).filter((j) => j.targets && j.targets.instagram && new Date(j.created_at + 4 * 3600000).toISOString().slice(0, 10) === new Date(now() + 4 * 3600000).toISOString().slice(0, 10));
    const lines = ["📊 Bugünkü Instagram hesabatı", "• Gələn DM: " + s.dm_received_today + " · şərh: " + s.comments_today + " · yeni lead: " + s.new_leads_today, "• Göndərilmiş DM: " + s.dm_sent_today, "• Təsdiq gözləyən (DM/şərh): " + pending.length];
    lines.push("• Paylaşımlar: " + (jobs.length ? jobs.map((j) => j.targets.instagram.step === "done" ? "✅ " + (j.targets.instagram.post_id || "") : j.targets.instagram.step === "unknown" ? "⚠️ nəticə bilinmir" : "❌ " + j.targets.instagram.step).join(", ") : "yoxdur"));
    const stages = Object.entries(s.by_stage).filter(([, v]) => v).map(([k, v]) => k + " " + v).join(", ");
    lines.push("• Satış: " + (stages || "lead yoxdur"));
    return lines.join("\n");
  }

  async function find(arg) {
    const parts = [];
    try {
      const r = await inbox.pollComments(5);
      parts.push("Instagram şərhlərindən (real mənbə): " + (r.comments ? r.comments + " yeni şərh işlənildi" : "yeni şərh yoxdur") + ".");
    } catch (e) {
      parts.push("Şərh skanı alınmadı: " + toSocialError(e).message.slice(0, 120));
    }
    parts.push(await leads());
    if (env.KIMI_API_KEY) {
      try {
        const r = await createProviderRouter(env, { maxCalls: 1 }).complete({ system: KIMI_SYSTEM, user: "Segment: " + (arg || "restoran, kafe, bar, çayxana, yeni açılan məkan; Bakı"), maxTokens: 500, order: ["kimi"] });
        parts.push("💡 Kimi ideyaları (canlı axtarış DEYİL, yoxlanmamış beyin fırtınası):\n" + String(r.text).slice(0, 900));
      } catch (e) {
        parts.push("Kimi alınmadı (" + ((e && e.code) || "xəta") + "). Bu hissə atlandı.");
      }
    } else parts.push("Kimi qoşulmayıb (KIMI_API_KEY yoxdur): xarici axtarış ideyaları atlandı. Tapdığın biznesi əlavə et: «lead əlavə et @username Bakı kafe».");
    parts.push("Qeyd: Instagram ictimai biznes siyahısını API ilə vermir; uydurma lead yaradılmır.");
    return parts.join("\n\n");
  }

  // Qaytarır: cavab mətni
  async function run(intent) {
    try {
      switch (intent.cmd) {
        case "status": return await status();
        case "dms": return fmtRes(await inbox.pollDms(), "DM yoxlaması");
        case "comments": return fmtRes(await inbox.pollComments(5), "Şərh yoxlaması");
        case "find": return await find(intent.arg);
        case "leads": return await leads();
        case "sales": return await salesView();
        case "report": return await report();
        case "stage": {
          const l = await sales.setStage(intent.ref, intent.stage, { by: "owner" });
          return "✅ " + presentLead(l);
        }
        case "draftdm": {
          const r = await inbox.draftFirstContact(intent.ref);
          return r.ok ? "Qaralama hazırdır, təsdiq düyməsi yuxarıdadır." : r.text;
        }
        case "addlead": {
          const u = normHandle(intent.ref);
          if (!u) return "İstifadəçi adı düzgün deyil.";
          const { lead, created } = await sales.upsert({ username: u, source: "manual", reason: intent.note || "Əl ilə əlavə (sahib)" });
          return (created ? "Əlavə olundu: " : "Artıq var (təkrar yaradılmadı): ") + presentLead(lead);
        }
        default: return null;
      }
    } catch (e) {
      return "Alınmadı: " + String((e && e.message) || "xəta").slice(0, 200);
    }
  }

  return { run };
}
export { STAGES };
