import worker from "./worker.js";
import vm from "node:vm";
import assert from "node:assert/strict";

const calls = [];
let gptFail = false;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push(u);
  const body = init && typeof init.body === "string" ? JSON.parse(init.body) : null;
  const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  if (u.includes("api.anthropic.com")) {
    const last = body.messages[body.messages.length - 1].content;
    if (body.system.startsWith("You are JARVIS, personal")) {
      if (last.includes("araşdır")) {
        return ok({ content: [{ type: "text", text: JSON.stringify({ mode: "task", subtasks: [
          { id: "t1", owner: "gpt", instruction: "Bazarı araşdır", depends: [] },
          { id: "t2", owner: "claude", instruction: "Xülasə yaz", depends: ["t1"] } ], external_action: "Instagramda paylaşmaq" }) }] });
      }
      return ok({ content: [{ type: "text", text: JSON.stringify({ mode: "chat", reply: "Salam Fərid." }) }] });
    }
    if (body.system.includes("strict fact checker")) return ok({ content: [{ type: "text", text: '{"issues":[]}' }] });
    if (body.system.startsWith("You are JARVIS speaking")) return ok({ content: [{ type: "text", text: JSON.stringify({ spoken: "İş hazırdır.", screen: "Tam nəticə." }) }] });
    return ok({ content: [{ type: "text", text: "Claude cavabı: " + last.slice(0, 80) }] });
  }
  if (u.endsWith("/v1/responses")) {
    if (gptFail) return new Response("boom", { status: 500 });
    return ok({ output_text: "GPT nəticəsi" });
  }
  if (u.endsWith("/v1/chat/completions")) {
    if (gptFail) return new Response("boom", { status: 500 });
    return ok({ choices: [{ message: { content: '{"issues":[]}' } }] });
  }
  if (u.endsWith("/v1/audio/transcriptions")) return ok({ text: "Bazarı araşdır" });
  if (u.endsWith("/v1/audio/speech")) return new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 });
  return new Response("unexpected " + u, { status: 500 });
};

const env = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", PASSCODE: "pw" };
const req = (path, opt = {}) => worker.fetch(new Request("https://x.dev" + path, opt), env);
const talk = (text, pass = "pw") => req("/api/talk", { method: "POST", headers: { "x-passcode": pass, "content-type": "application/json" }, body: JSON.stringify({ text }) });

// 1 page + client script parses
let r = await req("/");
const html = await r.text();
assert.equal(r.status, 200);
assert.ok(html.includes("JARVIS"));
const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)[1];
new vm.Script(script);
console.log("1 page + client script parse OK");

// 2 auth
assert.equal((await talk("salam", "bad")).status, 401);
assert.equal((await req("/api/jobs")).status, 401);
assert.equal((await worker.fetch(new Request("https://x.dev/api/jobs"), { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })).status, 500);
console.log("2 auth OK");

// 3 chat
let d = await (await talk("Salam JARVIS")).json();
assert.equal(d.status, "chat");
assert.equal(d.spoken, "Salam Fərid.");
assert.ok(d.audio && d.audio.length > 0);
console.log("3 chat OK");

// 4 task split + dependency + approval gate
calls.length = 0;
d = await (await talk("Bazarı araşdır və Instagramda paylaş")).json();
assert.equal(d.status, "pending_approval");
assert.equal(d.tasks.length, 2);
assert.ok(d.tasks.every((t) => t.status === "done"));
assert.ok(d.spoken.includes("təsdiq"));
assert.ok(calls.some((c) => c.endsWith("/v1/responses")), "gpt used");
assert.ok(calls.some((c) => c.includes("anthropic")), "claude used");
console.log("4 task split + approval gate OK");

// 5 yes -> blocked honestly (no integration), never claims published
d = await (await talk("Hə")).json();
assert.equal(d.status, "blocked");
assert.ok(d.spoken.includes("inteqrasiya"));
console.log("5 approval yes -> blocked honest OK");

// 6 jobs list
let j = await (await req("/api/jobs", { headers: { "x-passcode": "pw" } })).json();
assert.equal(j.jobs.length, 1);
console.log("6 jobs OK");

// 7 audio path
const fd = new FormData();
fd.append("audio", new Blob([new Uint8Array(3000)], { type: "audio/mp4" }), "voice");
d = await (await req("/api/talk", { method: "POST", headers: { "x-passcode": "pw" }, body: fd })).json();
assert.equal(d.transcript, "Bazarı araşdır");
assert.equal(d.status, "pending_approval");
console.log("7 audio -> stt -> plan OK");

// 8 GPT failure is reported, not hidden
gptFail = true;
d = await (await talk("Bazarı araşdır yenə")).json();
assert.ok(["partial", "blocked"].includes(d.status), "status was " + d.status);
assert.ok(d.tasks.some((t) => t.status === "error" && t.error));
console.log("8 failure reported honestly OK (" + d.status + ")");

// 9 empty input
gptFail = false;
assert.equal((await talk("   ")).status, 400);
console.log("9 empty input OK");
console.log("ALL PASSED");
