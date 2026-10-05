// Telegram webhook qəbulu: POST /telegram/webhook
//
// Autentifikasiya parolla DEYİL (Telegram parol göndərə bilmir), webhook secret ilə:
//  - Telegram setWebhook-da secret_token verilir və hər sorğuda "X-Telegram-Bot-Api-Secret-Token" başlığında göndərir (rəsmi sənəd).
//  - TELEGRAM_WEBHOOK_SECRET təyin olunmayıbsa webhook BAĞLIDIR (fail-closed, 503).
//  - Başlıq səhvdirsə 401, mətn emal olunmur.
//  - Çat id-si TELEGRAM_ALLOWED_CHAT_IDS siyahısında olmalıdır. Naməlum çat: heç nə emal olunmur, cavab göndərilmir, yalnız audit
//    (məzmunsuz) yazılır və Telegram-a 200 qaytarılır (təkrar göndərməsin, çatın varlığı bilinməsin).
//  - Eyni update_id ikinci dəfə emal olunmur.
//  - Telegram vasitəsilə TƏSDİQ VERİLMƏZ: alət çağırışlarının təsdiqi yalnız parol qorumalı /api/approvals (UI) üzərindəndir.
//  - Səs mesajı: fayl yükləmə ünvanı rəsmi sənədlə yoxlanmayıb, ona görə səs mesajı emal olunmur, istifadəçiyə bu bildirilir.

import { safeEqual } from "../guards/login.js";
import { json } from "../util.js";

const MAX_BODY_BYTES = 20000;
const SECRET_RE = /^[A-Za-z0-9_-]{16,256}$/;
const VOICE_NOTICE = "Səs mesajı hələlik emal olunmur (fayl yükləmə endpoint-i rəsmi sənədlə yoxlanmayıb). Mətn yaz.";

// handleText(text) -> { spoken, screen, status, approvals? } (index.js orkestratoru qurur; bu fayl orkestratoru import etmir)
export async function handleTelegramWebhook(req, env, rt, { handleText, waitUntil } = {}) {
  if (req.method !== "POST") return new Response("Not found", { status: 404 });
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!SECRET_RE.test(String(secret || ""))) return json({ error: "webhook bağlıdır (TELEGRAM_WEBHOOK_SECRET təyin edilməyib)" }, 503);
  if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), secret)) return json({ error: "unauthorized" }, 401);

  const len = parseInt(req.headers.get("content-length") || "0", 10);
  if (len > MAX_BODY_BYTES) return json({ ok: true });
  let update;
  try { update = await req.json(); } catch (e) { return json({ ok: true }); }

  const tg = rt.integrations.get("telegram");
  if (tg.status().configured !== true) {
    await rt.audit.log("telegram.rejected", { reason: "not_configured" });
    return json({ ok: true });
  }
  const norm = tg.parseUpdate(update);
  if (!norm.ok) {
    await rt.audit.log("telegram.rejected", { reason: norm.reason });
    return json({ ok: true });
  }

  // Təkrar update-in qarşısı (Telegram təkrar göndərə bilər)
  const st = rt.foundation.storage.scope("integrations");
  if (norm.updateId !== null) {
    const last = await st.get("telegram-last-update").catch(() => null);
    if (last && Number.isInteger(last.id) && norm.updateId <= last.id) return json({ ok: true });
    await st.put("telegram-last-update", { id: norm.updateId }).catch(() => {});
  }

  const work = (async () => {
    try {
      if (norm.kind === "voice") {
        await rt.audit.log("telegram.update", { kind: "voice" });
        await tg.replyToOwner(norm.chatId, VOICE_NOTICE);
        return;
      }
      if (norm.kind !== "text" || !norm.text) return;
      await rt.audit.log("telegram.update", { kind: "text", chars: norm.text.length });
      const r = await handleText(norm.text);
      let reply = String(r.spoken || "") + (r.screen && r.screen !== r.spoken ? "\n\n" + r.screen : "");
      if (r.approvals && r.approvals.length) reply += "\n\nTəsdiq mərkəzində gözləyir (" + r.approvals.length + "). Təsdiqi yalnız JARVIS səhifəsindən verə bilərsən.";
      await tg.replyToOwner(norm.chatId, reply.slice(0, 4000));
    } catch (e) {
      await rt.audit.log("telegram.error", { code: (e && e.code) || "error" });
      try { await tg.replyToOwner(norm.chatId, "Xəta baş verdi, JARVIS səhifəsində yoxla."); } catch (e2) { /* əhəmiyyətsiz */ }
    }
  })();
  if (typeof waitUntil === "function") waitUntil(work);
  else await work;
  return json({ ok: true });
}
