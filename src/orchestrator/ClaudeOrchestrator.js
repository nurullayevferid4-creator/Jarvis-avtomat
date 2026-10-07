// ClaudeOrchestrator: JARVIS-in beyni.
//
// Axın:  İstifadəçi -> Claude (anlayır, planlayır)
//                   -> lazım olsa köməkçi modelə (məs. OpenAI) alt tapşırıq
//                   -> Claude köməkçinin nəticəsini yoxlayır
//                   -> Claude yekun cavabı hazırlayır -> İstifadəçi
//
// Qaydalar:
//  - Claude lider modeldir, köməkçi onun yerini tutmur.
//  - Köməkçi yalnız Claude-un verdiyi alt tapşırığı edir.
//  - Yoxlamanı yalnız Claude edir (köməkçinin nəticəsini). Köməkçi Claude-u yoxlamır.
//  - Limitlər: alt tapşırıq sayı, ümumi model çağırışı, hər çağırışın vaxtı.
//  - API cavab verməsə, bunu açıq yazır, saxta uğur bildirmir.
//  - Real xarici əməliyyat YOXDUR (bax src/approval/gate.js).

import { normalize, parseJson } from "../util.js";
import { resolvePending } from "../approval/gate.js";
import { CallBudget } from "../guards/budget.js";
import { buildLeadSystem, FINAL_SYSTEM, FACT_CHECK_SYSTEM } from "../prompts.js";
import { wrapExternal } from "../security/sanitize.js";
import { publicError } from "../errors.js";
import { OWNER_PERMISSIONS } from "../policy.js";

// Köməkçi modelin (məs. veb axtarışlı OpenAI) cavabı xarici məzmun sayılır:
// başqa modelə verilərkən <external_content> qutusuna qoyulur, əmr kimi qəbul edilmir.
const HELPER_MAX_CHARS = 20000;

export class ClaudeOrchestrator {
  // approvals (istəyə bağlı): təsdiq mərkəzi. Verilməsə köhnə davranış dəyişmir.
  // tools (istəyə bağlı): ToolRegistry. Verilsə Claude "tools" rejimində alət çağırışı planlaya bilər.
  constructor({ env, registry, limits, store, approvals = null, tools = null }) {
    this.tools = tools;
    this.env = env;
    this.registry = registry;
    this.limits = limits;
    this.store = store;
    this.approvals = approvals;
    this.lead = registry.get("claude");
    if (!this.lead || typeof this.lead.complete !== "function") throw new Error("Reyestrdə 'claude' adapteri yoxdur");
  }

  // Lider modelin öz mətni olduğu kimi qalır, köməkçinin mətni qutuya salınır.
  _guard(t, text) {
    if (t.owner === "claude") return { text, flagged: false };
    const w = wrapExternal(text, { source: "helper:" + t.owner, maxLen: HELPER_MAX_CHARS });
    return { text: w.text, flagged: w.flagged };
  }

  async runSubtask(t, done, extra, ctx) {
    const adapter = this.registry.get(t.owner) || this.lead;
    const dep = (t.depends || []).filter((d) => done[d]).map((d) => "Result of " + d + ":\n" + done[d]).join("\n\n");
    const prompt = (dep ? dep + "\n\n" : "") + "Task: " + t.instruction + (extra ? "\n\n" + extra : "");
    return await adapter.run({ id: t.id, instruction: t.instruction, prompt, webSearch: true }, ctx);
  }

  async runPlan(subtasks, ctx) {
    const tasks = subtasks.map((t) => ({ ...t, status: "pending" }));
    const done = {};
    for (let guard = 0; guard < this.limits.maxRounds && tasks.some((t) => t.status === "pending"); guard++) {
      tasks.forEach((t) => {
        if (t.status === "pending" && (t.depends || []).some((d) => { const x = tasks.find((k) => k.id === d); return x && x.status === "error"; })) {
          t.status = "error";
          t.error = "əvvəlki addım alınmadı";
        }
      });
      const ready = tasks.filter((t) => t.status === "pending" && (t.depends || []).every((d) => { const x = tasks.find((k) => k.id === d); return !x || x.status === "done"; }));
      if (!ready.length) break;
      await Promise.all(ready.map(async (t) => {
        try {
          const out = await this.runSubtask(t, done, "", ctx);
          const g = this._guard(t, out.text);
          t.result = out.text;
          t.web = out.web;
          t.flagged = g.flagged;
          t.status = "done";
          done[t.id] = g.text;
        } catch (e) {
          t.status = "error";
          t.error = String((e && e.message) || e).slice(0, 200);
        }
      }));
    }
    tasks.forEach((t) => { if (t.status === "pending") { t.status = "error"; t.error = "əvvəlki addım alınmadı"; } });
    return { tasks, done };
  }

  // Yalnız köməkçi modellərin nəticələrini Claude yoxlayır.
  async review(tasks, ctx) {
    const helperDone = tasks.filter((t) => t.owner !== "claude" && t.status === "done");
    if (!helperDone.length) return { issues: [], unreviewed: false };
    const payload = helperDone.map((t) => "[" + t.id + "] Task: " + t.instruction + "\nResult: " + this._guard(t, t.result).text).join("\n\n");
    const prompt = 'Review the results below for factual errors, invented links or numbers, or ignoring the task. Reply with ONLY JSON: {"issues":[{"id":"t1","problem":"..."}]}. Use an empty list if all is fine.\n\n' + payload;
    try {
      const txt = await this.lead.complete(FACT_CHECK_SYSTEM, [{ role: "user", content: prompt }], 800, ctx);
      const j = parseJson(txt);
      return { issues: Array.isArray(j.issues) ? j.issues : [], unreviewed: false };
    } catch (e) {
      return { issues: [], unreviewed: true }; // yoxlama alınmadı, bu açıq bildiriləcək
    }
  }

  async retryFlagged(tasks, done, issues, ctx) {
    for (const i of issues.slice(0, this.limits.maxRetries)) {
      const t = tasks.find((k) => k.id === i.id && k.status === "done" && k.owner !== "claude");
      if (!t) continue;
      try {
        const out = await this.runSubtask(t, done, "A reviewer found this problem in your previous answer, fix it: " + i.problem, ctx);
        const g = this._guard(t, out.text);
        t.result = out.text;
        done[t.id] = g.text;
        t.flagged = t.flagged || g.flagged;
        t.web = out.web;
      } catch (e) { /* ilk cavab qalır */ }
      t.note = "Yoxlama qeydi: " + String(i.problem).slice(0, 160);
    }
  }

  // Claude-a göstərilən alət siyahısı (handler olmadan)
  toolList() {
    return this.tools.list().map((t) => ({ name: t.name, description: t.description, requiresApproval: t.requiresApproval, inputSchema: t.inputSchema }));
  }

  // Alət çağırışları ardıcıl icra olunur. Təsdiq tələb edən alət yalnız təsdiq qeydi açır.
  async handleTools(text, plan, ctx, origin) {
    const maxCalls = Math.min(4, this.limits.maxSubtasks);
    const results = [];
    for (const call of plan.tool_calls.slice(0, maxCalls)) {
      const name = String((call && call.tool) || "");
      const input = call && call.input && typeof call.input === "object" ? call.input : {};
      let r;
      try {
        r = await this.tools.run(name, input, { approvals: this.approvals, origin, source: "chat", permissions: OWNER_PERMISSIONS, notifyChat: origin && origin.channel === "telegram" && origin.chat_id !== undefined ? String(origin.chat_id) : undefined });
      } catch (e) {
        r = { ok: false, status: "error", error: publicError(e, name).message };
      }
      results.push({ tool: name, status: r.status, approval_id: r.approval_id || null, output: r.ok ? r.output : null, error: r.ok ? null : (r.error || (r.errors && r.errors.join("; ")) || r.status) });
      if (r.status === "not_found") break; // uydurma alət adı: davam etmirik
    }
    const done = results.filter((r) => r.status === "done").length;
    const pending = results.filter((r) => r.status === "pending_approval");
    let status = done === results.length ? "achieved" : pending.length && done + pending.length === results.length ? "pending_approval" : done || pending.length ? "partial" : "blocked";
    const body = results.map((r) => "[" + r.tool + " / " + r.status + "]\n" + (r.status === "done" ? wrapExternal(JSON.stringify(r.output), { source: "tool:" + r.tool, maxLen: 6000 }).text : r.status === "pending_approval" ? "Təsdiq qeydi açıldı (id: " + r.approval_id + "). Hələ icra OLUNMAYIB." : "XƏTA: " + String(r.error).slice(0, 300))).join("\n\n");
    let spoken = "";
    let screen = "";
    try {
      const fin = parseJson(await this.lead.complete(FINAL_SYSTEM, [{ role: "user", content: "User said: " + text + "\nOverall status: " + status + "\n\nTool results (nothing outside these happened):\n" + body }], 1800, ctx));
      spoken = String(fin.spoken || "");
      screen = String(fin.screen || "");
    } catch (e) { /* xam nəticələrə qayıdılır */ }
    if (!spoken) spoken = status === "achieved" ? "Alətlər işlədi, nəticə ekranda." : status === "pending_approval" ? "Təsdiq lazımdır, hələ heç nə icra olunmayıb." : "İş tam alınmadı, təfərrüat ekranda.";
    if (!screen) screen = body;
    if (pending.length) {
      const note = "Təsdiq gözləyir: " + pending.map((p) => p.approval_id).join(", ") + ". Təsdiq panelindən (və ya Telegram düyməsindən) özün qərar ver; səslə «hə» ilə icra olunmur.";
      spoken += " " + note;
      screen += "\n\n" + note;
    }
    const out = { status, spoken, screen, tasks: [], tools: results.map((r) => ({ tool: r.tool, status: r.status, approval_id: r.approval_id, error: r.error && String(r.error).slice(0, 200) })) };
    if (pending.length) out.approval_id = pending[0].approval_id;
    return out;
  }

  static publicTasks(tasks) {
    return tasks.map((t) => ({ id: t.id, owner: t.owner, instruction: t.instruction, status: t.status, error: t.error || null, note: t.note || null }));
  }

  // origin: sorğunun mənşəyi ({channel:"ui"} və ya {channel:"telegram", chat_id}). Təsdiq qeydləri buna bağlanır.
  async handle(text, { origin = null, attachments = [] } = {}) {
    const budget = new CallBudget(this.limits.maxModelCalls);
    const ctx = { budget, timeoutMs: this.limits.callTimeoutMs };
    const state = await this.store.load();
    const norm = normalize(text);

    const pendingBefore = state.pending;
    const gate = resolvePending(state, norm);
    if (gate.handled) {
      if (gate.save) await this.store.save(state);
      // Söhbətdə "hə/yox" deyiləndə təsdiq mərkəzindəki qeyd də bağlanır
      if (this.approvals && pendingBefore && pendingBefore.approval_id && gate.decision) {
        try { await this.approvals.decide(pendingBefore.approval_id, { decision: gate.decision === "approved" ? "approve" : "reject", actor: origin }); } catch (e) { /* əsas axın pozulmasın */ }
      }
      return gate.response;
    }

    const hist = state.history.slice(-8);
    // Əlavə olunan media: id-lər sistemdən gəlir (etibarlı), fayl adı təmizlənib
    const attach = attachments.length ? "\n\n[Attached media, usable as media_id in tools]\n" + attachments.slice(0, 5).map((a) => "- media_id=" + a.id + " kind=" + a.kind + (a.analysis && a.analysis.duration_s ? " " + a.analysis.width + "x" + a.analysis.height + " " + a.analysis.duration_s + "s" : a.analysis && a.analysis.width ? " " + a.analysis.width + "x" + a.analysis.height : "")).join("\n") : "";
    const leadRaw = await this.lead.complete(buildLeadSystem(this.registry.helpers(), this.limits, this.tools ? this.toolList() : null), [...hist, { role: "user", content: text + attach }], 1200, ctx);
    let plan;
    try { plan = parseJson(leadRaw); } catch (e) { plan = { mode: "chat", reply: leadRaw.slice(0, 600) }; }

    const remember = async (spoken) => {
      state.history.push({ role: "user", content: text }, { role: "assistant", content: spoken });
      state.history = state.history.slice(-12);
      await this.store.save(state);
    };

    if (this.tools && plan.mode === "tools" && Array.isArray(plan.tool_calls) && plan.tool_calls.length) {
      const r = await this.handleTools(text, plan, ctx, origin);
      await remember(r.spoken);
      await this.store.saveJob({ ts: new Date().toISOString(), request: text, status: r.status, spoken: r.spoken, tools: r.tools.map((t) => ({ tool: t.tool, status: t.status })) });
      return r;
    }

    if (plan.clarification) {
      await remember(plan.clarification);
      return { status: "clarification", spoken: plan.clarification, screen: plan.clarification, tasks: [] };
    }

    const seen = new Set();
    const subtasks = (Array.isArray(plan.subtasks) ? plan.subtasks : []).slice(0, this.limits.maxSubtasks).map((t, i) => {
      let id = String((t && t.id) || "t" + (i + 1));
      if (seen.has(id)) id = "t" + (i + 1);
      seen.add(id);
      return {
        id,
        owner: t && this.registry.has(t.owner) ? t.owner : "claude",
        instruction: String((t && t.instruction) || ""),
        depends: Array.isArray(t && t.depends) ? t.depends.map(String) : [],
      };
    }).filter((t) => t.instruction);

    if (plan.mode !== "task" || !subtasks.length) {
      const reply = plan.reply || "Başa düşmədim, bir də de.";
      await remember(reply);
      return { status: "chat", spoken: reply, screen: reply, tasks: [] };
    }

    const { tasks, done } = await this.runPlan(subtasks, ctx);
    const rv = await this.review(tasks, ctx);
    await this.retryFlagged(tasks, done, rv.issues, ctx);

    const ok = tasks.filter((t) => t.status === "done").length;
    let status = ok === 0 ? "blocked" : ok < tasks.length ? "partial" : "achieved";
    if (plan.external_action && status === "achieved") status = "pending_approval";

    const results = tasks.map((t) => "[" + t.id + " / " + t.owner + " / " + t.status + "]\n" + (t.status === "done" ? this._guard(t, t.result).text : "XƏTA: " + t.error)).join("\n\n");
    let spoken;
    let screen;
    try {
      const fin = parseJson(await this.lead.complete(FINAL_SYSTEM, [{ role: "user", content: "User said: " + text + "\nOverall status: " + status + (plan.external_action ? "\nPending external action needing approval: " + plan.external_action : "") + "\n\nTask results:\n" + results }], 1800, ctx));
      spoken = String(fin.spoken || "");
      screen = String(fin.screen || "");
    } catch (e) { /* yekun cavab alınmadı: xam nəticələrə qayıdılır */ }
    if (!spoken) {
      spoken = status === "achieved" || status === "pending_approval"
        ? "İş hazırdır, nəticəni ekranda gör."
        : ok ? "İş qismən hazırdır, alınmayan addımlar ekranda yazılıb." : "İş alınmadı, səbəbi ekranda yazılıb.";
    }
    if (!screen) screen = results;

    const notes = [];
    if (tasks.some((t) => t.owner !== "claude" && t.status === "done" && t.web === false)) notes.push("Canlı axtarış işləmədi, məlumat köhnə ola bilər.");
    if (rv.unreviewed) notes.push("Köməkçi modelin nəticələri yoxlanmadı (yoxlama alınmadı).");
    if (budget.exceeded) notes.push("Model çağırış limiti dolduğu üçün iş tam başa çatmaya bilər.");
    if (tasks.some((t) => t.flagged)) notes.push("Xarici məzmunda şübhəli təlimat izləri tapıldı. O, əmr kimi qəbul edilmədi, yalnız məlumat kimi istifadə olundu.");
    if (notes.length) {
      spoken += " " + notes.join(" ");
      screen += "\n\n" + notes.join("\n");
    }

    let approvalId = null;
    if (status === "pending_approval") {
      spoken += " «" + plan.external_action + "» üçün təsdiq lazımdır. İcra edim? Hə və ya yox de.";
      if (this.approvals) {
        try {
          const ap = await this.approvals.create({ action: plan.external_action, content: screen.slice(0, 4000), risk: "medium", source: "orchestrator", origin });
          approvalId = ap.id;
        } catch (e) { /* qeyd açılmasa da söhbətdəki təsdiq qapısı işləyir */ }
      }
      state.pending = { goal: text, external: plan.external_action, draft: screen.slice(0, 4000), approval_id: approvalId };
    }
    await remember(spoken);
    await this.store.saveJob({ ts: new Date().toISOString(), request: text, status, spoken, tasks: ClaudeOrchestrator.publicTasks(tasks) });
    const result = { status, spoken, screen, tasks: ClaudeOrchestrator.publicTasks(tasks) };
    if (approvalId) result.approval_id = approvalId;
    return result;
  }
}
