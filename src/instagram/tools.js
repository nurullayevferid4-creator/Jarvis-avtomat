// Instagram satış alətləri. HƏR İKİSİ təsdiq tələb edir: alət özü göndərmir, yalnız təsdiq qeydi açır;
// real göndərmə təsdiqdən sonra ActionRunner tərəfindən approval.execute ilə (bir dəfə) icra olunur.
//  - instagram.dm.send       : lead-ə DM (yalnız platformanın icazə verdiyi mexanizm: 24 saat cavab pəncərəsi və ya şərhə private reply)
//  - instagram.comment.reply : ictimai şərhə cavab
// Mexanizm yoxdursa qaralama yaranmır: "manual_action_required" qaytarılır (bypass YOXDUR).

import { AppError } from "../errors.js";

const LEAD_ID = { type: "string", pattern: "^L[0-9]{4,6}$" };

export class ManualActionRequired extends Error {
  constructor(reason) {
    super("manual_action_required: " + reason);
    this.name = "ManualActionRequired";
    this.reason = reason;
  }
}

export function registerInstagramSalesTools(registry, { hub, sales, audit = null }) {
  const ig = () => hub.adapter("instagram");
  const log = async (event, data) => { if (audit) await audit.log(event, data); };
  const who = (l) => (l.username ? "@" + l.username : "IGSID " + l.igsid);

  registry.register({
    name: "instagram.dm.send",
    description: "Instagram: lead-ə DM cavabı. Həmişə təsdiq tələb edir; alət yalnız təsdiq qeydi açır. Platforma 24 saat pəncərəsi və ya şərhə bir dəfəlik private reply xaricində DM-ə icazə vermir (onda manual_action_required).",
    inputSchema: { type: "object", required: ["lead_id", "text"], additionalProperties: false, properties: { lead_id: LEAD_ID, text: { type: "string", minLength: 2, maxLength: 1000 }, label: { type: "string", maxLength: 60 }, mode: { type: "string", enum: ["reply", "private_reply"] }, target: { type: "string", pattern: "^[0-9]{5,30}$" } } },
    outputSchema: { type: "object", required: ["sent", "message_id", "mode"], properties: { sent: { type: "boolean" }, message_id: { type: "string" }, mode: { type: "string" } } },
    permissions: ["send.message"],
    risk: "high",
    requiresApproval: true,
    timeoutMs: 25000,
    approval: {
      kind: "instagram.dm.send",
      async build(input) {
        const lead = await sales.get(input.lead_id);
        const pol = sales.sendPolicy(lead);
        if (!pol.ok) throw new ManualActionRequired(pol.reason);
        const inp = { lead_id: lead.id, label: who(lead), text: input.text.trim(), mode: pol.mode, target: pol.mode === "reply" ? pol.recipient_id : pol.comment_id };
        const payload = { input: inp };
        return { content: describeDm(payload), payload };
      },
      describe(payload) { return describeDm(payload); }, // build ilə eyni mətn (ActionRunner xülasə=icra yoxlaması)
      async execute(input) {
        const lead = await sales.get(input.lead_id);
        const pol = sales.sendPolicy(lead);
        if (!pol.ok || pol.mode !== input.mode) throw new AppError("VALIDATION_ERROR", "Göndərmə pəncərəsi bağlanıb (" + (pol.reason || pol.mode) + "): manual_action_required", { source: "instagram.dm" });
        if (!(await sales.reserveDaily())) throw new AppError("RATE_LIMIT", "Gündəlik DM limiti dolub", { source: "instagram.dm" });
        let r;
        try {
          r = input.mode === "reply" ? await ig().sendDm({ recipientId: input.target, text: input.text }) : await ig().sendDm({ commentId: input.target, text: input.text });
        } catch (e) {
          await sales.releaseDaily();
          await log("instagram.dm.failed", { lead_id: lead.id, mode: input.mode, code: e && e.code });
          throw e;
        }
        await sales.recordOutbound(lead.id, { kind: "dm", text: input.text, private_reply: input.mode === "private_reply" });
        await log("instagram.dm.sent", { lead_id: lead.id, mode: input.mode, message_id: r.message_id });
        return { sent: true, message_id: r.message_id, mode: input.mode };
      },
    },
    async handler() { throw new Error("instagram.dm.send yalnız təsdiq axını ilə icra olunur"); },
  });

  function describeDm(payload) {
    const i = payload.input;
    return "Instagram DM → " + (i.label ? i.label + " (" + i.lead_id + ")" : i.lead_id) + " [" + (i.mode === "reply" ? "cavab, 24 saat pəncərəsi" : "şərhə private reply") + "]:\n«" + i.text + "»";
  }

  registry.register({
    name: "instagram.comment.reply",
    description: "Instagram: ictimai şərhə cavab. Həmişə təsdiq tələb edir; alət yalnız təsdiq qeydi açır.",
    inputSchema: { type: "object", required: ["comment_id", "text"], additionalProperties: false, properties: { comment_id: { type: "string", pattern: "^[0-9]{5,30}$" }, text: { type: "string", minLength: 2, maxLength: 1000 }, author: { type: "string", maxLength: 40 }, original: { type: "string", maxLength: 200 } } },
    outputSchema: { type: "object", required: ["sent", "reply_id"], properties: { sent: { type: "boolean" }, reply_id: { type: "string" } } },
    permissions: ["send.message"],
    risk: "high",
    requiresApproval: true,
    timeoutMs: 20000,
    approval: {
      kind: "instagram.comment.reply",
      describe(payload) {
        const i = payload.input;
        return "Instagram şərhə cavab" + (i.author ? " (@" + i.author + ")" : "") + (i.original ? "\nŞərh: «" + i.original + "»" : "") + "\nCavab (İCTİMAİ): «" + i.text + "»";
      },
      async execute(input) {
        let r;
        try {
          r = await ig().replyToComment(input.comment_id, input.text);
        } catch (e) {
          await log("instagram.comment_reply.failed", { comment_id: input.comment_id, code: e && e.code });
          throw e;
        }
        await log("instagram.comment_reply.sent", { comment_id: input.comment_id, reply_id: r.reply_id });
        return { sent: true, reply_id: r.reply_id };
      },
    },
    async handler() { throw new Error("instagram.comment.reply yalnız təsdiq axını ilə icra olunur"); },
  });
}
