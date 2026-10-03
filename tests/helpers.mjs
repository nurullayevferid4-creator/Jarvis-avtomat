// Testlər üçün ümumi köməkçilər. Heç bir real API çağırılmır.
import worker from "../worker.js";

export const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
export const claudeText = (t) => ok({ content: [{ type: "text", text: t }] });

// Saxta fetch qurur. handler(url, body, init) -> Response. Bütün çağırışlar calls massivində qalır.
export function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url: u, body, init });
    return handler(u, body, init);
  };
  return calls;
}

// Səs (TTS/STT) xaric, yalnız model çağırışları
export const modelCalls = (calls) => calls.filter((c) => c.url.includes("api.anthropic.com") || c.url.endsWith("/v1/responses") || c.url.endsWith("/v1/chat/completions"));
export const anthropicCalls = (calls) => calls.filter((c) => c.url.includes("api.anthropic.com"));
export const openaiModelCalls = (calls) => calls.filter((c) => c.url.endsWith("/v1/responses") || c.url.endsWith("/v1/chat/completions"));

// Tipik saxta server: lead planı verilir, qalanı sadə cavablardır.
export function standardHandler({ plan, reviewIssues = [], gptFail = false, claudeFail = false }) {
  return (u, body) => {
    if (u.includes("api.anthropic.com")) {
      if (claudeFail) return new Response("boom", { status: 500 });
      const sys = body.system;
      if (sys.startsWith("You are JARVIS, personal")) return claudeText(JSON.stringify(plan));
      if (sys.includes("strict fact checker")) return claudeText(JSON.stringify({ issues: reviewIssues }));
      if (sys.startsWith("You are JARVIS speaking")) return claudeText(JSON.stringify({ spoken: "Hazırdır.", screen: "Tam nəticə." }));
      return claudeText("Claude nəticəsi: " + body.messages[body.messages.length - 1].content.slice(0, 40));
    }
    if (u.endsWith("/v1/responses")) return gptFail ? new Response("boom", { status: 500 }) : ok({ output_text: "GPT nəticəsi" });
    if (u.endsWith("/v1/chat/completions")) return gptFail ? new Response("boom", { status: 500 }) : ok({ choices: [{ message: { content: "GPT sadə nəticə" } }] });
    if (u.endsWith("/v1/audio/speech")) return new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 });
    return new Response("unexpected " + u, { status: 500 });
  };
}

export const baseEnv = () => ({ ANTHROPIC_API_KEY: "test-a", OPENAI_API_KEY: "test-o", PASSCODE: "pw" });

export function talk(env, text, ip = "9.9.9.9") {
  return worker.fetch(
    new Request("https://x.dev/api/talk", { method: "POST", headers: { "x-passcode": "pw", "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ text }) }),
    env,
  );
}

export { worker };
