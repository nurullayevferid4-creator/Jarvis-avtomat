// Telegram bot idarəetməsi: JARVIS-i yalnız icazə verilmiş şəxsi söhbətlərdən idarə etmək olar.
//
// Təhlükəsizlik:
//  - Webhook yalnız doğru X-Telegram-Bot-Api-Secret-Token başlığı ilə qəbul olunur (verifyWebhook).
//  - Göndərən TELEGRAM_ALLOWED_CHAT_IDS siyahısında olmalıdır və söhbət "private" olmalıdır.
//    Siyahı boşdursa HEÇ KİM idarə edə bilməz. Tanımayanlara cavab verilmir (bot istismarının qarşısı).
//  - update_id təkrarı (Telegram təkrar göndərə bilər) bir dəfə işlənir.
//  - Paylaşım yalnız "Bəli" düyməsi/cavabından sonra başlayır. Əvvəl yalnız qaralama + təsdiq qeydi yaranır.
//  - Telegram-dan gələn mətn etibarsız məlumatdır: planner onu <external_content> içində Claude-a verir.

import { safeEqual } from "../guards/login.js";
import { NO } from "../approval/gate.js";
import { cleanText } from "../security/sanitize.js";
import { PLATFORM_INFO } from "../social/platforms.js";
import { SocialError, toSocialError } from "../social/errors.js";
import { draftCopy } from "../social/planner.js";
import { beginOAuth, OAUTH_PLATFORMS } from "../social/oauth.js";
import { MEDIA_TYPES } from "../social/media.js";
import { formatResult } from "../social/flow.js";
import { publicError } from "../errors.js";
import { cleanEnvValue } from "../security/envvalue.js";
import { checkAudioFile, parseVoiceCommand, MAX_AUDIO_BYTES } from "../voice/command.js";

const ID_RE = /^\d{13}-[0-9a-f]{6}$/;
const PLATFORM_WORDS = {
  instagram: /instagram|instaqram|insta\b|\big\b|reels?/i,
  tiktok: /tik[\s-]?tok|\btt\b/i,
  youtube: /youtube|yutub|youtub|\byt\b|ytb/i,
  telegram: /telegram|kanal/i,
};
const POST_WORDS = /paylaş|post et|yayımla|yayimla|yerləşdir|yerlesdir|publish|share|\bpost\b|yüklə/i;
const EXT_TYPE = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", mp4: "video/mp4", mov: "video/quicktime" };
// Mətn «Bəli» artıq paylaşımı İCRA ETMİR: təsdiq yalnız konkret qeydə bağlı düymə ilə verilir (başqa mövzuda yazılmış
// «hə» görünməyən qaralamanı təsdiqləməsin). Mətnlə «Xeyr» təhlükəsiz tərəfdir və rədd edir.
// Mətn «Bəli» yazılarsa son 15 dəqiqədəki TƏK qaralama xülasəsi və düymələr yenidən göndərilir.
const TEXT_YES = new Set(["bəli", "beli", "hə", "he", "yes", "təsdiq edirəm", "paylaş"]);
const TEXT_APPROVAL_WINDOW_MS = 15 * 60 * 1000;
const TERMINAL_JOB = new Set(["done", "failed", "unknown", "partial"]);

export function verifyWebhook(req, env) {
  const want = cleanEnvValue(env.TELEGRAM_WEBHOOK_SECRET);
  if (!want) return false; // secret yoxdursa webhook qəbul edilmir
  return safeEqual(req.headers.get("x-telegram-bot-api-secret-token") || "", want);
}

export function allowedIds(env) {
  return new Set(cleanEnvValue(env.TELEGRAM_ALLOWED_CHAT_IDS).split(",").map((x) => x.trim()).filter((x) => /^\d{1,15}$/.test(x)));
}

export function parseIntent(text) {
  const platforms = Object.keys(PLATFORM_WORDS).filter((p) => PLATFORM_WORDS[p].test(text));
  const wantsPost = POST_WORDS.test(text);
  let privacy = "private";
  if (/\bpublic\b|hamıya açıq|hamiya aciq|açıq paylaş/i.test(text)) privacy = "public";
  else if (/unlisted|siyahıda yox|linklə/i.test(text)) privacy = "unlisted";
  return { platforms, wantsPost, privacy };
}

// Mövzu mətni: komanda sözlərini və platforma adlarını çıxarır
export function topicOf(text) {
  let t = String(text || "");
  for (const re of Object.values(PLATFORM_WORDS)) t = t.replace(new RegExp(re.source, "gi"), " ");
  t = t.replace(/jarvis[,:]?/gi, " ").replace(new RegExp(POST_WORDS.source, "gi"), " ");
  t = t.replace(/(^|\s)(bu|bunu|videonu|video|şəkli|şəkil|və|da|də|kanalına|public|unlisted|mövzu)(?=[\s:,.]|$)/gi, " ");
  t = t.replace(/(^|\s)[-–]\w{0,3}(?=\s|$)/g, " ").replace(/[,;:.!?]+/g, " ").replace(/\s+/g, " ").trim();
  return t.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 ? t : "";
}

function mediaFromMessage(m) {
  if (!m) return null;
  if (m.video) return { file_id: m.video.file_id, size: m.video.file_size, mime: m.video.mime_type || "video/mp4", type: "video" };
  if (m.animation) return { file_id: m.animation.file_id, size: m.animation.file_size, mime: m.animation.mime_type || "video/mp4", type: "video" };
  if (Array.isArray(m.photo) && m.photo.length) {
    const p = m.photo[m.photo.length - 1];
    return { file_id: p.file_id, size: p.file_size, mime: "image/jpeg", type: "image" };
  }
  if (m.document && /^(image|video)\//.test(m.document.mime_type || "")) {
    return { file_id: m.document.file_id, size: m.document.file_size, mime: m.document.mime_type, type: m.document.mime_type.startsWith("image/") ? "image" : "video" };
  }
  return null;
}

// Səsli mesaj: voice note (OGG/Opus), audio fayl və ya audio sənəd. Video note (dairəvi video) səs əmri sayılmır.
const AUDIO_EXT = { oga: "audio/ogg", ogg: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", webm: "audio/webm", aac: "audio/aac" };
export function voiceFromMessage(m) {
  if (!m || typeof m !== "object") return null;
  if (m.voice && m.voice.file_id) return { file_id: m.voice.file_id, size: m.voice.file_size || 0, mime: m.voice.mime_type || "audio/ogg", duration: m.voice.duration || 0, kind: "voice" };
  if (m.audio && m.audio.file_id) return { file_id: m.audio.file_id, size: m.audio.file_size || 0, mime: m.audio.mime_type || "audio/mpeg", duration: m.audio.duration || 0, kind: "audio" };
  if (m.document && m.document.file_id && /^audio\//.test(m.document.mime_type || "")) return { file_id: m.document.file_id, size: m.document.file_size || 0, mime: m.document.mime_type, duration: 0, kind: "document" };
  return null;
}

const HELP = [
  "JARVIS Telegram idarəsi.",
  "Paylaşım: video/şəkil göndər və yaz: «Jarvis, bunu Instagram, TikTok və YouTube-da paylaş. Mövzu: ...».",
  "Mən mətni hazırlayıb soruşacağam; «Bəli» deməsən heç nə paylaşılmır.",
  "/status – platformaların vəziyyəti",
  "/pending – təsdiq gözləyənlər",
  "/jobs – son paylaşımlar",
  "/connect instagram|tiktok|youtube – hesab qoşma linki",
  "Səsli mesaj da göndərə bilərsən: mətnə çevirib yazılı əmr kimi icra edirəm (təsdiq yenə yalnız düymə ilə).",
].join("\n");

// runner (istəyə bağlı): strukturlu (sosial olmayan) təsdiq qeydlərini icra edir (Shopify yazma və s.).
// transcribe (istəyə bağlı): (Blob) => mətn. Səsli mesaj mətnə çevrilir və YAZILI mesajla eyni yoldan keçir
// (eyni icazə siyahısı, eyni təsdiq qaydası; səs heç nəyi birbaşa icra etmir).
export function createTelegramHandler({ env, hub, flow, approvals, store, audit = null, runChat = null, runner = null, library = null, transcribe = null, voiceEnabled = true }) {
  const tg = () => hub.adapter("telegram");

  async function say(chatId, text, extra) {
    try {
      await tg().sendMessage(chatId, text, extra);
    } catch (e) {
      /* cavab göndərilməsə də əməliyyat nəticəsi dəyişmir */
    }
  }

  async function log(event, data) {
    if (audit) await audit.log(event, data);
  }

  // Qeyd bu söhbətə məxsusdur: mənşə (origin) və ya köhnə qeydlərdə notify_chat bu çatdır.
  function belongsTo(a, chatId) {
    if (a.origin && a.origin.chat_id) return a.origin.channel === "telegram" && String(a.origin.chat_id) === String(chatId);
    return !!(a.payload && a.payload.notify_chat && String(a.payload.notify_chat) === String(chatId));
  }

  async function pendingFor(chatId) {
    const list = await approvals.list({ status: "pending", limit: 30 });
    return list.filter((a) => a.kind && belongsTo(a, chatId));
  }

  // Qeyd yalnız öz söhbətinə aiddirsə Telegram-dan idarə oluna bilər.
  async function ownRecord(id, chatId) {
    const rec = await approvals.get(id);
    if (!rec || !rec.kind) {
      await say(chatId, "Belə təsdiq qeydi tapılmadı.");
      return null;
    }
    if (!belongsTo(rec, chatId)) {
      await say(chatId, "Bu qeyd bu söhbətə aid deyil.");
      return null;
    }
    return rec;
  }

  const actorOf = (chatId) => ({ channel: "telegram", chat_id: String(chatId), user_id: String(chatId) });

  async function approveAndRun(id, chatId) {
    const own = await ownRecord(id, chatId);
    if (!own) return;
    if (own.kind !== "social.publish") {
      if (!runner) return say(chatId, "Bu əməliyyat növü üçün icra qoşulmayıb.");
      await say(chatId, "Təsdiq alındı. İcra edirəm...");
      const r = await runner.approveAndExecute(id, { actor: actorOf(chatId) });
      if (r.ok) return say(chatId, "✅ Edildi: " + String(own.content).slice(0, 300));
      if (r.status === "unknown") return say(chatId, "⚠️ Nəticə bilinmir: " + (r.note || "xarici sistemdə yoxlayın") + " Təkrar edilmədi.");
      return say(chatId, "❌ İcra olunmadı (" + (r.error && r.error.code) + ").");
    }
    const a = await flow.approveAndStart(id, { actor: actorOf(chatId) });
    if (!a.ok) {
      const m = a.error === "already_decided" ? "Bu qeyd üçün artıq qərar verilib." : a.error === "expired" ? "Qeydin vaxtı bitib. Yenidən hazırlayım." : a.error === "payload_modified" ? "Qeydin məzmunu dəyişdirilib, paylaşım bloklandı." : "Paylaşım başlamadı (" + a.error + ").";
      return say(chatId, m);
    }
    await say(chatId, "Təsdiq alındı. Paylaşıram...");
    const job = await flow.advance(id, { deadlineMs: 20000 });
    if (job && !TERMINAL_JOB.has(job.status)) await say(chatId, "Davam edir (platforma emal edir). Bitəndə nəticəni yazacağam.");
  }

  async function rejectIt(id, chatId) {
    if (!(await ownRecord(id, chatId))) return;
    const r = await approvals.decide(id, { decision: "reject", actor: actorOf(chatId) });
    return say(chatId, r.ok ? "Ləğv etdim. Heç nə paylaşılmadı." : r.error === "already_decided" ? "Bu qeyd üçün artıq qərar verilib." : "Qeyd tapılmadı.");
  }

  async function storeTelegramMedia(m) {
    if (!hub.media.available) throw new SocialError("media_error", "Media anbarı (R2: JARVIS_MEDIA) qoşulmayıb, fayl saxlanıla bilmir");
    if (m.size && m.size > 20 * 1024 * 1024) throw new SocialError("media_error", "Telegram botu 20 MB-dan böyük faylı ala bilmir. Faylı JARVIS səhifəsindən yüklə.");
    const { bytes, path } = await tg().downloadFile(m.file_id);
    const ext = (path.split(".").pop() || "").toLowerCase();
    const ct = EXT_TYPE[ext] || m.mime;
    if (!MEDIA_TYPES[ct]) throw new SocialError("media_error", "Fayl növü dəstəklənmir (" + String(ct).slice(0, 30) + ")");
    if (library) {
      // Doğrulama: başlıq baytları, ölçü, video analizi (uyğunsuz fayl saxlanmır)
      const d = await library.ingest({ body: new Blob([bytes]).stream(), contentType: ct, length: bytes.byteLength, source: "telegram" });
      return { id: d.id, type: d.kind, content_type: d.content_type, size: d.size };
    }
    return await hub.media.put(bytes, ct);
  }

  async function makeDraft(msg, text, chatId) {
    const intent = parseIntent(text);
    if (!intent.platforms.length) return say(chatId, "Hansı platformalarda paylaşım? (Instagram, TikTok, YouTube, Telegram)");
    const topic = topicOf(text);
    if (!topic) return say(chatId, "Mövzunu qısa yaz (məsələn: «Mövzu: yeni ətir kolleksiyası») və ya videonun altına yazıb göndər. Mətni uydurmuram.");

    const mediaMsg = mediaFromMessage(msg) || mediaFromMessage(msg.reply_to_message);
    let media = null;
    if (mediaMsg) {
      try {
        const saved = await storeTelegramMedia(mediaMsg);
        media = { id: saved.id, type: saved.type };
      } catch (e) {
        return say(chatId, "Mediaya baxa bilmədim: " + publicError(e, "media").message);
      }
    }
    const needsMedia = intent.platforms.filter((p) => p !== "telegram");
    if (needsMedia.length && !media) return say(chatId, needsMedia.map((p) => PLATFORM_INFO[p].label).join(", ") + " üçün video/şəkil lazımdır. Faylı göndər və ya ona cavab yaz.");

    const copy = await draftCopy({ env, instruction: topic, platforms: intent.platforms });
    let rec;
    try {
      rec = await flow.createDraft(
        { platforms: intent.platforms, caption: copy.caption, title: copy.title, description: copy.description, hashtags: copy.hashtags, media_id: media ? media.id : undefined, media_type: media ? media.type : undefined, privacy: intent.privacy },
        { source: "telegram:" + chatId, notifyChat: String(chatId), origin: actorOf(chatId) },
      );
    } catch (e) {
      return say(chatId, "Qaralama hazırlanmadı: " + toSocialError(e).message);
    }
    const warn = intent.platforms.includes("tiktok") ? "\nQeyd: TikTok tətbiqi audit olunmayıbsa yalnız «şəxsi» paylaşım mümkündür." : "";
    await say(chatId, "Hazırladım" + (copy.source === "fallback" ? " (Claude cavab vermədi, mətn sənin yazdığın kimidir)" : "") + ":\n\n" + rec.content + warn + "\n\nPaylaşmağa icazə verirsən?", {
      reply_markup: { inline_keyboard: [[{ text: "✅ Bəli, paylaş", callback_data: "ap:" + rec.id + ":y" }, { text: "❌ Xeyr", callback_data: "ap:" + rec.id + ":n" }]] },
    });
    await log("telegram.draft", { approval_id: rec.id, platforms: intent.platforms });
  }

  async function statusText() {
    const panel = await flow.panel({ verify: false });
    const lines = ["Platformalar:"];
    for (const [p, s] of Object.entries(panel.platforms)) {
      const extra = s.expires_in_days !== undefined && s.expires_in_days !== null ? " (token " + s.expires_in_days + " gün)" : "";
      lines.push("• " + PLATFORM_INFO[p].label + ": " + s.state + extra + (s.state !== "CONNECTED" && s.reason ? " – " + s.reason : "") + (s.pending_approvals ? " [təsdiq gözləyir: " + s.pending_approvals + "]" : ""));
    }
    lines.push("Media anbarı (R2): " + (panel.media_store ? "var" : "yoxdur"));
    return lines.join("\n");
  }

  async function onCommand(cmd, arg, chatId) {
    if (cmd === "/start" || cmd === "/help") return say(chatId, HELP);
    if (cmd === "/status") return say(chatId, await statusText());
    if (cmd === "/pending") {
      const list = await pendingFor(chatId);
      if (!list.length) return say(chatId, "Təsdiq gözləyən paylaşım yoxdur.");
      for (const a of list.slice(0, 5)) {
        await say(chatId, a.content + "\n\nPaylaşmağa icazə verirsən?", { reply_markup: { inline_keyboard: [[{ text: "✅ Bəli, paylaş", callback_data: "ap:" + a.id + ":y" }, { text: "❌ Xeyr", callback_data: "ap:" + a.id + ":n" }]] } });
      }
      return;
    }
    if (cmd === "/jobs") {
      const jobs = await flow.listJobs(5);
      if (!jobs.length) return say(chatId, "Hələ paylaşım işi yoxdur.");
      return say(chatId, jobs.map((j) => formatResult(j)).join("\n\n"));
    }
    if (cmd === "/connect") {
      const p = String(arg || "").toLowerCase();
      if (!OAUTH_PLATFORMS.includes(p)) return say(chatId, "İstifadə: /connect instagram | tiktok | youtube");
      try {
        const r = await beginOAuth({ hub, store, env, platform: p });
        return say(chatId, PLATFORM_INFO[p].label + " hesabını qoşmaq üçün bu linki aç (10 dəqiqə etibarlıdır):\n" + r.url);
      } catch (e) {
        return say(chatId, "Qoşma linki hazırlanmadı: " + toSocialError(e).message);
      }
    }
    return say(chatId, "Naməlum əmr. /help");
  }

  // Səsli mesajı mətnə çevirir. Uğursuz olarsa istifadəçiyə aydın səbəb yazılır və null qaytarılır.
  async function voiceToText(v, chatId) {
    const fail = async (why) => {
      await log("telegram.voice_failed", { kind: v.kind, reason: String(why).slice(0, 120) });
      await say(chatId, "🎤 Səsli mesajı mətnə çevirə bilmədim: " + why + "\nYenidən göndər və ya yazı ilə yaz.");
      return null;
    };
    if (!voiceEnabled) return await fail("səs əmrləri söndürülüb (FEATURE_VOICE=0)");
    if (!transcribe) return await fail("səs tanıma xidməti qoşulmayıb");
    if (v.size && v.size > MAX_AUDIO_BYTES) return await fail("səs yazısı çox uzundur (maksimum 8 MB)");
    let raw;
    try {
      const { bytes, path } = await tg().downloadFile(v.file_id);
      const ext = (path.split(".").pop() || "").toLowerCase();
      const mime = String(v.mime || AUDIO_EXT[ext] || "audio/ogg").split(";")[0].toLowerCase();
      const blob = checkAudioFile(new Blob([bytes], { type: mime }));
      raw = await transcribe(blob);
    } catch (e) {
      return await fail(publicError(e, "voice").message.slice(0, 160));
    }
    let cmd;
    try {
      cmd = parseVoiceCommand(raw);
    } catch (e) {
      return await fail(publicError(e, "voice").message.slice(0, 160));
    }
    await log("telegram.voice_transcribed", { kind: v.kind, duration: v.duration || 0, chars: cmd.text.length });
    await say(chatId, "🎤 Eşitdim: «" + cmd.text.slice(0, 500) + "»");
    return cmd.text;
  }

  // Qaytarır: { handled: "duplicate"|"unauthorized"|"ignored"|"ok" }
  async function handleUpdate(update) {
    if (!update || typeof update !== "object") return { handled: "ignored" };
    const cb = update.callback_query;
    const msg = update.message;
    const actor = cb ? cb.from : msg && msg.from;
    const chat = cb ? cb.message && cb.message.chat : msg && msg.chat;
    if (!actor || !chat) return { handled: "ignored" };
    if (chat.type !== "private" || !allowedIds(env).has(String(actor.id)) || String(chat.id) !== String(actor.id)) return { handled: "unauthorized" };
    const chatId = String(chat.id);

    // Təkrar yoxlaması yalnız icazəli göndərən üçün: kənar istifadəçilər KV yazma limitini yeyə bilməsin.
    if (Number.isInteger(update.update_id)) {
      const key = "tgupdate:" + update.update_id;
      if (await store.getRaw(key)) return { handled: "duplicate" };
      await store.putRaw(key, { t: 1 }, 86400);
    }

    if (cb) {
      const m = /^ap:(\d{13}-[0-9a-f]{6}):([yn])$/.exec(String(cb.data || ""));
      try { await tg().answerCallbackQuery(cb.id, m ? "" : "Naməlum düymə"); } catch (e) { /* əhəmiyyətsiz */ }
      if (!m || !ID_RE.test(m[1])) return { handled: "ignored" };
      // eyni düyməyə təkrar basılmasın deyə klaviatura silinir (xəta olsa da əməliyyat dəyişmir)
      if (cb.message && cb.message.message_id) { try { await tg().clearButtons(chatId, cb.message.message_id); } catch (e) { /* əhəmiyyətsiz */ } }
      if (m[2] === "y") await approveAndRun(m[1], chatId);
      else await rejectIt(m[1], chatId);
      return { handled: "ok" };
    }

    let raw = String(msg.text || msg.caption || "");
    const voice = !msg.text ? voiceFromMessage(msg) : null;
    if (voice) {
      // Səs → mətn. Sonra yazılı mesajla TAM eyni yol (komandalar, qaralama, söhbət, təsdiq qaydaları).
      const heard = await voiceToText(voice, chatId);
      if (heard === null) return { handled: "ok" };
      raw = heard;
    }
    const text = cleanText(raw, 2000).text.trim();
    if (text.startsWith("/")) {
      const parts = text.split(/\s+/);
      await onCommand(parts[0].replace(/@\w+$/, "").toLowerCase(), parts[1], chatId);
      return { handled: "ok" };
    }

    const norm = text.toLowerCase().replace(/[.!?\s]+$/g, "").trim();
    const isYes = TEXT_YES.has(norm);
    const isNo = NO.has(norm);
    if (isYes || isNo) {
      const pend = (await pendingFor(chatId)).filter((a) => Date.parse(a.ts) > Date.now() - TEXT_APPROVAL_WINDOW_MS);
      if (pend.length === 1) {
        if (isYes) {
          const a = pend[0];
          await say(chatId, a.content + "\n\nMətnlə təsdiq qəbul edilmir. Paylaşmaq üçün aşağıdakı düyməyə bas:", { reply_markup: { inline_keyboard: [[{ text: "✅ Bəli, paylaş", callback_data: "ap:" + a.id + ":y" }, { text: "❌ Xeyr", callback_data: "ap:" + a.id + ":n" }]] } });
        } else await rejectIt(pend[0].id, chatId);
        return { handled: "ok" };
      }
      if (pend.length > 1) {
        await say(chatId, "Bir neçə gözləyən paylaşım var. /pending yaz və düymədən seç.");
        return { handled: "ok" };
      }
    }

    const intent = parseIntent(text);
    const hasMedia = Boolean(mediaFromMessage(msg) || mediaFromMessage(msg.reply_to_message));
    if (intent.wantsPost && (intent.platforms.length || hasMedia)) {
      await makeDraft(msg, text, chatId);
      return { handled: "ok" };
    }

    if (text && runChat) {
      try {
        const r = await runChat(text, actorOf(chatId));
        await say(chatId, String(r.screen || r.spoken || "Cavab yoxdur").slice(0, 4000));
      } catch (e) {
        await say(chatId, "Xəta baş verdi: " + publicError(e, "chat").message.slice(0, 160));
      }
      return { handled: "ok" };
    }
    await say(chatId, HELP);
    return { handled: "ok" };
  }

  return { handleUpdate };
}
