// Kimi (Moonshot, OpenAI-uyğun chat/completions): ikinci rəy və müqayisə üçün köməkçi.
// Lider (Claude) yalnız lazım olanda "kimi"yə alt tapşırıq verir; Kimi-nin cavabı xarici məzmun kimi qutuya salınır
// və Claude tərəfindən yoxlanır (ClaudeOrchestrator.review). Canlı veb axtarışı YOXDUR (webSearch:false).
// Yalnız KIMI_API_KEY təyin olunanda reyestrə əlavə olunur. Real açarla sınaq: NOT TESTED — REAL CREDENTIAL REQUIRED.

import { BaseAdapter } from "./BaseAdapter.js";
import { httpRequest } from "../guards/http.js";
import { providerHttpError } from "../providers/http.js";
import { cleanEnvValue } from "../security/envvalue.js";
import { WORKER_SYSTEM } from "../prompts.js";

export class KimiAdapter extends BaseAdapter {
  constructor(env) {
    super({ id: "kimi", description: "second opinion: independent analysis, comparison of options, critique of a plan or text (no live web search)", webSearch: false });
    this.env = env;
  }

  base() {
    const b = cleanEnvValue(this.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1").replace(/\/+$/, "");
    return /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(b) ? b : "https://api.moonshot.ai/v1";
  }

  async run(task, ctx) {
    ctx.budget.spend();
    const r = await httpRequest(
      this.base() + "/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + cleanEnvValue(this.env.KIMI_API_KEY) },
        body: JSON.stringify({ model: this.env.KIMI_MODEL || "kimi-k2-0905-preview", max_tokens: 1500, messages: [{ role: "system", content: WORKER_SYSTEM }, { role: "user", content: task.prompt }] }),
      },
      ctx.timeoutMs,
    );
    if (!r.ok) throw providerHttpError("Kimi", r.status, r.data);
    const c = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message;
    return { text: (c && c.content) || "", web: null };
  }
}
