// Claude adapteri: əsas (lider) model.
// Anthropic Messages API: POST https://api.anthropic.com/v1/messages
// Başlıqlar: x-api-key, anthropic-version, content-type. Gövdə: model, max_tokens, system, messages.

import { BaseAdapter } from "./BaseAdapter.js";
import { DEFAULTS } from "../config.js";
import { WORKER_SYSTEM } from "../prompts.js";
import { httpRequest } from "../guards/http.js";

export class ClaudeAdapter extends BaseAdapter {
  constructor(env) {
    super({ id: "claude", description: "lead model: planning, reasoning, long writing, Azerbaijani copywriting, code" });
    this.env = env;
  }

  // Aşağı səviyyəli çağırış: orkestrator planlama, yoxlama və yekun cavab üçün istifadə edir.
  async complete(system, messages, maxTokens, ctx) {
    ctx.budget.spend();
    const r = await httpRequest(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: this.env.CLAUDE_MODEL || DEFAULTS.claudeModel, max_tokens: maxTokens, system, messages }),
      },
      ctx.timeoutMs,
    );
    if (!r.ok) throw new Error("Claude " + r.status + ": " + r.data);
    return (r.data.content || []).map((b) => b.text || "").join("");
  }

  // Alt tapşırığı Claude özü yerinə yetirir.
  async run(task, ctx) {
    const text = await this.complete(WORKER_SYSTEM, [{ role: "user", content: task.prompt }], 1800, ctx);
    return { text, web: null };
  }
}
