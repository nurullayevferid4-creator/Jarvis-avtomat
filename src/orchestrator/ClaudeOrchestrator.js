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

export class ClaudeOrchestrator {
  constructor({ env, registry, limits, store }) {
    this.env = env;
    this.registry = registry;
    this.limits = limits;
    this.store = store;
    this.lead = registry.get("claude");
    if (!this.lead || typeof this.lead.complete !== "function") throw new Error("Reyestrdə 'claude' adapteri yoxdur");
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
          t.result = out.text;
          t.web = out.web;
          t.status = "done";
          done[t.id] = out.text;
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
    const payload = helperDone.map((t) => "[" + t.id + "] Task: " + t.instruction + "\nResult: " + t.result).join("\n\n");
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
        t.result = out.text;
        done[t.id] = out.text;
        t.web = out.web;
      } catch (e) { /* ilk cavab qalır */ }
      t.note = "Yoxlama qeydi: " + String(i.problem).slice(0, 160);
    }
  }

  static publicTasks(tasks) {
    return tasks.map((t) => ({ id: t.id, owner: t.owner, instruction: t.instruction, status: t.status, error: t.error || null, note: t.note || null }));
  }

  async handle(text) {
    const budget = new CallBudget(this.limits.maxModelCalls);
    const ctx = { budget, timeoutMs: this.limits.callTimeoutMs };
    const state = await this.store.load();
    const norm = normalize(text);

    const gate = resolvePending(state, norm);
    if (gate.handled) {
      if (gate.save) await this.store.save(state);
      return gate.response;
    }

    const hist = state.history.slice(-8);
    const leadRaw = await this.lead.complete(buildLeadSystem(this.registry.helpers(), this.limits), [...hist, { role: "user", content: text }], 1200, ctx);
    let plan;
    try { plan = parseJson(leadRaw); } catch (e) { plan = { mode: "chat", reply: leadRaw.slice(0, 600) }; }

    const remember = async (spoken) => {
      state.history.push({ role: "user", content: text }, { role: "assistant", content: spoken });
      state.history = state.history.slice(-12);
      await this.store.save(state);
    };

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

    const results = tasks.map((t) => "[" + t.id + " / " + t.owner + " / " + t.status + "]\n" + (t.status === "done" ? t.result : "XƏTA: " + t.error)).join("\n\n");
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
    if (notes.length) {
      spoken += " " + notes.join(" ");
      screen += "\n\n" + notes.join("\n");
    }

    if (status === "pending_approval") {
      spoken += " «" + plan.external_action + "» üçün təsdiq lazımdır. İcra edim? Hə və ya yox de.";
      state.pending = { goal: text, external: plan.external_action, draft: screen.slice(0, 4000) };
    }
    await remember(spoken);
    await this.store.saveJob({ ts: new Date().toISOString(), request: text, status, spoken, tasks: ClaudeOrchestrator.publicTasks(tasks) });
    return { status, spoken, screen, tasks: ClaudeOrchestrator.publicTasks(tasks) };
  }
}
