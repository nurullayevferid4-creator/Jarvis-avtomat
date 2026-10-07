// OpenAI adapteri: köməkçi model. Yalnız Claude-un verdiyi alt tapşırığı yerinə yetirir.
//
// 1) Canlı axtarışlı cəhd: POST /v1/responses, tools: [{ type: "web_search" }].
//    OpenAI sənədinə görə yeni inteqrasiyalar üçün "web_search" tövsiyə olunur,
//    köhnə "web_search_preview" hələ də işləyir. Lazım olsa OPENAI_WEB_SEARCH_TOOL
//    dəyişəni ilə köhnəsinə qayıtmaq olar (kodu dəyişmədən).
// 2) Alınmasa: POST /v1/chat/completions (axtarışsız). Bu halda web:false qaytarılır
//    və orkestrator istifadəçiyə "məlumat köhnə ola bilər" qeydi yazır.

import { BaseAdapter } from "./BaseAdapter.js";
import { DEFAULTS } from "../config.js";
import { WORKER_SYSTEM } from "../prompts.js";
import { httpRequest } from "../guards/http.js";
import { BudgetExceededError } from "../guards/budget.js";
import { providerHttpError } from "../providers/http.js";
import { openaiKey } from "../security/envvalue.js";

export class OpenAIAdapter extends BaseAdapter {
  constructor(env) {
    super({ id: "gpt", description: "helper: live web search, fresh facts, research, data extraction", webSearch: true });
    this.env = env;
  }

  async run(task, ctx) {
    const model = this.env.OPENAI_MODEL || DEFAULTS.openaiModel;
    const headers = { "content-type": "application/json", authorization: "Bearer " + openaiKey(this.env) };

    if (task.webSearch !== false) {
      try {
        ctx.budget.spend();
        const tool = this.env.OPENAI_WEB_SEARCH_TOOL || DEFAULTS.openaiWebSearchTool;
        const r = await httpRequest(
          "https://api.openai.com/v1/responses",
          { method: "POST", headers, body: JSON.stringify({ model, input: WORKER_SYSTEM + "\n\n" + task.prompt, tools: [{ type: tool }] }) },
          ctx.timeoutMs,
        );
        if (r.ok) {
          const d = r.data;
          let t = d.output_text;
          if (!t) {
            t = (d.output || []).filter((o) => o.type === "message").map((o) => (o.content || []).map((c) => c.text || "").join("")).join("\n");
          }
          if (t) return { text: t, web: true };
        }
      } catch (e) {
        if (e instanceof BudgetExceededError) throw e;
        /* axtarışlı cəhd alınmadı, aşağıda axtarışsız variant sınanır */
      }
    }

    ctx.budget.spend();
    const r2 = await httpRequest(
      "https://api.openai.com/v1/chat/completions",
      { method: "POST", headers, body: JSON.stringify({ model, messages: [{ role: "system", content: WORKER_SYSTEM }, { role: "user", content: task.prompt }] }) },
      ctx.timeoutMs,
    );
    if (!r2.ok) throw providerHttpError("OpenAI", r2.status, r2.data);
    const c = r2.data.choices && r2.data.choices[0] && r2.data.choices[0].message;
    return { text: (c && c.content) || "", web: false };
  }
}
