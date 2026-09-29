// JARVIS Voice Hub: single-file Cloudflare Worker.
// Secrets: ANTHROPIC_API_KEY, OPENAI_API_KEY, PASSCODE. Optional: KV binding JARVIS_KV,
// variables CLAUDE_MODEL, OPENAI_MODEL, TTS_VOICE.

const mem = { state: null, jobs: [] };

const LEAD_SYSTEM = `You are JARVIS, personal AI operator of Farid, an entrepreneur in Baku. You lead a team of two models: "claude" (deep reasoning, planning, long writing, Azerbaijani copywriting, code) and "gpt" (live web search, fresh facts, research, data extraction).
Decide how to handle the user's latest message. Reply with ONLY a JSON object, no other text:
{"mode":"chat"|"task","reply":"...","clarification":null|"...","subtasks":[{"id":"t1","owner":"claude"|"gpt","instruction":"...","depends":[]}],"external_action":null|"..."}
Rules:
- Small talk, simple questions, opinions: mode "chat", put a short spoken Azerbaijani answer in "reply", no subtasks.
- Real work: mode "task", 1 to 4 subtasks. Independent subtasks run in parallel. Use "depends" for ids that must finish first. Every instruction is self-contained and states the output language (Azerbaijani unless told otherwise).
- Anything needing current facts, prices, news or sources goes to "gpt". Never let a model invent links, numbers or sources.
- external_action: set it (one short Azerbaijani sentence) only when the request would publish something, change prices or stock, spend money, send messages to other people or delete something. Otherwise null. Subtasks then only prepare drafts. You cannot perform external actions yourself.
- If the request is too ambiguous to act on, set "clarification" to one short Azerbaijani question and return no subtasks.
- Never claim that anything was done. Only plan.`;

const WORKER_SYSTEM = "You are a precise assistant on a team. Answer in Azerbaijani unless the task says otherwise. Never invent facts, links, numbers or sources; say clearly when you are unsure.";

const FINAL_SYSTEM = `You are JARVIS speaking to Farid in Azerbaijani. Be direct, no filler openers. Use only the task results given; never add facts, links or numbers that are not in them. The overall status is decided by the system, so state it truthfully. Reply with ONLY a JSON object: {"spoken":"at most 3 short sentences for voice, plain text, no markdown","screen":"the full answer for the screen, plain text, short paragraphs"}`;

const YES = new Set(["hə", "he", "həə", "hə tamam", "tamam", "olar", "bəli", "yaxşı", "davam et", "hə davam et", "ok", "okay", "yes"]);
const NO = new Set(["yox", "xeyr", "ləğv et", "lazım deyil", "dayan", "yox lazım deyil"]);

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function normalize(s) {
  return String(s || "").toLocaleLowerCase("az").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}

function parseJson(text) {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no json");
  return JSON.parse(text.slice(a, b + 1));
}

function b64(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function claude(env, system, messages, maxTokens = 1500) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, system, messages }),
  });
  if (!r.ok) throw new Error("Claude " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  return (d.content || []).map((b) => b.text || "").join("");
}

async function gpt(env, instruction, search = true) {
  const model = env.OPENAI_MODEL || "gpt-4o";
  const headers = { "content-type": "application/json", authorization: "Bearer " + env.OPENAI_API_KEY };
  if (search) {
    try {
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: WORKER_SYSTEM + "\n\n" + instruction, tools: [{ type: "web_search_preview" }] }),
      });
      if (r.ok) {
        const d = await r.json();
        let t = d.output_text;
        if (!t) {
          t = (d.output || []).filter((o) => o.type === "message").map((o) => (o.content || []).map((c) => c.text || "").join("")).join("\n");
        }
        if (t) return { text: t, web: true };
      }
    } catch (e) { /* fall through to plain chat */ }
  }
  const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: [{ role: "system", content: WORKER_SYSTEM }, { role: "user", content: instruction }] }),
  });
  if (!r2.ok) throw new Error("OpenAI " + r2.status + ": " + (await r2.text()).slice(0, 200));
  const d2 = await r2.json();
  return { text: (d2.choices && d2.choices[0] && d2.choices[0].message.content) || "", web: false };
}

async function stt(env, file) {
  const type = file.type || "";
  const name = type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "audio.mp4" : type.includes("ogg") ? "audio.ogg" : type.includes("wav") ? "audio.wav" : "audio.webm";
  const fd = new FormData();
  fd.append("file", file, name);
  fd.append("model", "whisper-1");
  fd.append("language", "az");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + env.OPENAI_API_KEY }, body: fd });
  if (!r.ok) throw new Error("Səs tanıma xətası " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json();
  return (d.text || "").trim();
}

async function tts(env, text) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + env.OPENAI_API_KEY },
    body: JSON.stringify({ model: "tts-1", voice: env.TTS_VOICE || "onyx", input: text.slice(0, 900), response_format: "mp3" }),
  });
  if (!r.ok) throw new Error("Səsləndirmə xətası " + r.status);
  return b64(await r.arrayBuffer());
}

async function loadState(env) {
  if (env.JARVIS_KV) {
    const s = await env.JARVIS_KV.get("state", "json");
    return s || { history: [], pending: null };
  }
  if (!mem.state) mem.state = { history: [], pending: null };
  return mem.state;
}

async function saveState(env, s) {
  if (env.JARVIS_KV) await env.JARVIS_KV.put("state", JSON.stringify(s));
  else mem.state = s;
}

async function saveJob(env, job) {
  if (env.JARVIS_KV) {
    const key = "job:" + String(9999999999999 - Date.now());
    await env.JARVIS_KV.put(key, JSON.stringify(job), { expirationTtl: 60 * 60 * 24 * 30 });
  } else {
    mem.jobs.unshift(job);
    mem.jobs = mem.jobs.slice(0, 20);
  }
}

async function listJobs(env) {
  if (!env.JARVIS_KV) return mem.jobs;
  const l = await env.JARVIS_KV.list({ prefix: "job:", limit: 20 });
  const out = [];
  for (const k of l.keys) {
    const j = await env.JARVIS_KV.get(k.name, "json");
    if (j) out.push(j);
  }
  return out;
}

async function runSubtask(env, t, done, extra) {
  const ctx = (t.depends || []).filter((d) => done[d]).map((d) => "Result of " + d + ":\n" + done[d]).join("\n\n");
  const prompt = (ctx ? ctx + "\n\n" : "") + "Task: " + t.instruction + (extra ? "\n\n" + extra : "");
  if (t.owner === "gpt") return await gpt(env, prompt, true);
  return { text: await claude(env, WORKER_SYSTEM, [{ role: "user", content: prompt }], 1800), web: null };
}

async function runPlan(env, subtasks) {
  const tasks = subtasks.map((t) => ({ ...t, status: "pending" }));
  const done = {};
  for (let guard = 0; guard < 6 && tasks.some((t) => t.status === "pending"); guard++) {
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
        const out = await runSubtask(env, t, done);
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

async function review(env, tasks) {
  const issues = [];
  for (const owner of ["claude", "gpt"]) {
    const mine = tasks.filter((t) => t.owner === owner && t.status === "done");
    if (!mine.length) continue;
    const payload = mine.map((t) => "[" + t.id + "] Task: " + t.instruction + "\nResult: " + t.result).join("\n\n");
    const prompt = 'Review the results below for factual errors, invented links or numbers, or ignoring the task. Reply with ONLY JSON: {"issues":[{"id":"t1","problem":"..."}]}. Use an empty list if all is fine.\n\n' + payload;
    try {
      const txt = owner === "claude" ? (await gpt(env, prompt, false)).text : await claude(env, "You are a strict fact checker.", [{ role: "user", content: prompt }], 800);
      const j = parseJson(txt);
      (j.issues || []).forEach((i) => issues.push(i));
    } catch (e) { /* review unavailable, results stay unreviewed */ }
  }
  return issues;
}

async function retryFlagged(env, tasks, done, issues) {
  for (const i of issues.slice(0, 3)) {
    const t = tasks.find((k) => k.id === i.id && k.status === "done");
    if (!t) continue;
    try {
      const out = await runSubtask(env, t, done, "A reviewer found this problem in your previous answer, fix it: " + i.problem);
      t.result = out.text;
      done[t.id] = out.text;
      t.web = out.web;
    } catch (e) { /* keep first answer */ }
    t.note = "Yoxlama qeydi: " + String(i.problem).slice(0, 160);
  }
}

function publicTasks(tasks) {
  return tasks.map((t) => ({ id: t.id, owner: t.owner, instruction: t.instruction, status: t.status, error: t.error || null, note: t.note || null }));
}

async function handle(env, text) {
  const state = await loadState(env);
  const norm = normalize(text);
  if (state.pending) {
    if (YES.has(norm)) {
      const p = state.pending;
      state.pending = null;
      await saveState(env, state);
      const spoken = "Təsdiqi aldım, amma «" + p.external + "» üçün inteqrasiya bu versiyada qoşulmayıb. Qaralama hazırdır, özün icra etməlisən.";
      return { status: "blocked", spoken, screen: spoken + "\n\n" + (p.draft || ""), tasks: [] };
    }
    if (NO.has(norm)) {
      state.pending = null;
      await saveState(env, state);
      return { status: "chat", spoken: "Yaxşı, ləğv etdim.", screen: "Gözləyən iş ləğv edildi.", tasks: [] };
    }
    if (norm.includes("harada dayandıq")) {
      const spoken = "Gözləyən iş: " + state.pending.external + ". İcra edim? Hə və ya yox de.";
      return { status: "pending_approval", spoken, screen: spoken, tasks: [] };
    }
    state.pending = null;
  }

  const hist = state.history.slice(-8);
  const leadRaw = await claude(env, LEAD_SYSTEM, [...hist, { role: "user", content: text }], 1200);
  let plan;
  try { plan = parseJson(leadRaw); } catch (e) { plan = { mode: "chat", reply: leadRaw.slice(0, 600) }; }

  const remember = async (spoken) => {
    state.history.push({ role: "user", content: text }, { role: "assistant", content: spoken });
    state.history = state.history.slice(-12);
    await saveState(env, state);
  };

  if (plan.clarification) {
    await remember(plan.clarification);
    return { status: "clarification", spoken: plan.clarification, screen: plan.clarification, tasks: [] };
  }

  const subtasks = (plan.subtasks || []).slice(0, 4).map((t, i) => ({
    id: String(t.id || "t" + (i + 1)),
    owner: t.owner === "gpt" ? "gpt" : "claude",
    instruction: String(t.instruction || ""),
    depends: Array.isArray(t.depends) ? t.depends.map(String) : [],
  })).filter((t) => t.instruction);

  if (plan.mode !== "task" || !subtasks.length) {
    const reply = plan.reply || "Başa düşmədim, bir də de.";
    await remember(reply);
    return { status: "chat", spoken: reply, screen: reply, tasks: [] };
  }

  const { tasks, done } = await runPlan(env, subtasks);
  await retryFlagged(env, tasks, done, await review(env, tasks));

  const ok = tasks.filter((t) => t.status === "done").length;
  let status = ok === 0 ? "blocked" : ok < tasks.length ? "partial" : "achieved";
  if (plan.external_action && status === "achieved") status = "pending_approval";

  const results = tasks.map((t) => "[" + t.id + " / " + t.owner + " / " + t.status + "]\n" + (t.status === "done" ? t.result : "XƏTA: " + t.error)).join("\n\n");
  let spoken;
  let screen;
  try {
    const fin = parseJson(await claude(env, FINAL_SYSTEM, [{ role: "user", content: "User said: " + text + "\nOverall status: " + status + (plan.external_action ? "\nPending external action needing approval: " + plan.external_action : "") + "\n\nTask results:\n" + results }], 1800));
    spoken = String(fin.spoken || "");
    screen = String(fin.screen || "");
  } catch (e) { /* fall back to raw results */ }
  if (!spoken) spoken = ok ? "İş hazırdır, nəticəni ekranda gör." : "İş alınmadı, səbəbi ekranda yazılıb.";
  if (!screen) screen = results;

  if (tasks.some((t) => t.owner === "gpt" && t.status === "done" && t.web === false)) {
    const note = "Canlı axtarış işləmədi, məlumat köhnə ola bilər.";
    spoken += " " + note;
    screen += "\n\n" + note;
  }
  if (status === "pending_approval") {
    spoken += " «" + plan.external_action + "» üçün təsdiq lazımdır. İcra edim? Hə və ya yox de.";
    state.pending = { goal: text, external: plan.external_action, draft: screen.slice(0, 4000) };
  }
  await remember(spoken);
  await saveJob(env, { ts: new Date().toISOString(), request: text, status, spoken, tasks: publicTasks(tasks) });
  return { status, spoken, screen, tasks: publicTasks(tasks) };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    if (!env.PASSCODE) return json({ error: "PASSCODE təyin edilməyib. Worker-in Secrets bölməsinə PASSCODE əlavə et." }, 500);
    if (req.headers.get("x-passcode") !== env.PASSCODE) return json({ error: "Parol səhvdir." }, 401);
    if (!env.ANTHROPIC_API_KEY || !env.OPENAI_API_KEY) return json({ error: "ANTHROPIC_API_KEY və ya OPENAI_API_KEY təyin edilməyib." }, 500);

    if (req.method === "GET" && url.pathname === "/api/jobs") return json({ jobs: await listJobs(env) });

    if (req.method === "POST" && url.pathname === "/api/talk") {
      let text = "";
      try {
        const ct = req.headers.get("content-type") || "";
        if (ct.includes("multipart/form-data")) {
          const fd = await req.formData();
          const f = fd.get("audio");
          if (f && typeof f !== "string" && f.size > 0) text = await stt(env, f);
          else text = String(fd.get("text") || "");
        } else {
          const b = await req.json();
          text = String(b.text || "");
        }
      } catch (e) {
        return json({ error: String((e && e.message) || e).slice(0, 300) }, 502);
      }
      text = text.trim();
      if (!text) return json({ error: "Səs və ya mətn boşdur." }, 400);
      let result;
      try {
        result = await handle(env, text);
      } catch (e) {
        const msg = String((e && e.message) || e).slice(0, 300);
        result = { status: "blocked", spoken: "Xəta baş verdi. Təfərrüat ekranda yazılıb.", screen: msg, tasks: [] };
      }
      let audio = null;
      try { audio = await tts(env, result.spoken); } catch (e) { result.tts_error = String((e && e.message) || e).slice(0, 200); }
      return json({ transcript: text, ...result, audio });
    }
    return new Response("Not found", { status: 404 });
  },
};

const PAGE = `<!doctype html>
<html lang="az"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="JARVIS">
<meta name="theme-color" content="#0f1216">
<title>JARVIS</title>
<style>
:root{color-scheme:dark;--bg:#0f1216;--card:#181c22;--line:#2a3038;--fg:#ecebe6;--mut:#9aa0a6;--acc:#f0a24a;--ok:#5fc48a;--bad:#e0705f}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,sans-serif;padding:16px;padding-top:calc(16px + env(safe-area-inset-top));padding-bottom:calc(24px + env(safe-area-inset-bottom));line-height:1.45}
main{max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:16px}
h1{margin:0;font-size:22px;letter-spacing:6px;color:var(--acc)}
.row{display:flex;gap:10px;align-items:center;justify-content:space-between}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;min-width:0}
.mic{width:132px;height:132px;border-radius:50%;border:0;background:var(--acc);color:#14161a;font:700 18px system-ui;align-self:center;cursor:pointer}
.mic.rec{background:var(--bad);color:#fff}
.mic:disabled{opacity:.5}
input{width:100%;font:inherit;padding:12px;border-radius:10px;border:1px solid var(--line);background:#10141a;color:var(--fg);min-width:0}
button.s{font:inherit;font-weight:700;padding:12px 18px;border-radius:10px;border:0;background:var(--line);color:var(--fg);cursor:pointer}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:700;background:var(--line)}
.who{font-size:12px;font-weight:700;letter-spacing:1px;color:var(--acc)}
.lbl{font-size:13px;color:var(--mut)}
.txt{white-space:pre-wrap;word-break:break-word}
.t{border-top:1px solid var(--line);padding-top:8px;margin-top:8px;font-size:14px}
button:focus-visible,input:focus-visible{outline:3px solid var(--acc);outline-offset:2px}
</style></head><body><main>
<div class="row"><h1>JARVIS</h1><span id="state" class="lbl">hazır</span></div>
<div class="card"><div class="lbl">Parol</div><input id="pass" type="password" placeholder="Parol" autocomplete="off"></div>
<button id="mic" class="mic" type="button">Danış</button>
<div class="row"><input id="txt" type="text" placeholder="Və ya yaz"><button id="send" class="s" type="button">Göndər</button></div>
<div id="out"></div>
<div class="row"><span class="lbl">Son işlər</span><button id="jobs" class="s" type="button">Göstər</button></div>
<div id="jl"></div>
</main>
<script>
var $=function(i){return document.getElementById(i)};
var busy=false,rec=null,stream=null,chunks=[],timer=null;
var player=new Audio();
var SILENT="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
var LABEL={achieved:"Tamamlandı",partial:"Qismən",blocked:"Bloklandı",pending_approval:"Təsdiq gözləyir",clarification:"Sual",chat:"Söhbət"};
try{$("pass").value=localStorage.getItem("jv_pass")||""}catch(e){}
$("pass").addEventListener("change",function(){try{localStorage.setItem("jv_pass",$("pass").value)}catch(e){}});
function unlock(){try{player.src=SILENT;var p=player.play();if(p&&p.catch)p.catch(function(){})}catch(e){}}
function setState(s){$("state").textContent=s}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function render(d){
var out=$("out");out.textContent="";
var c=el("div","card");
if(d.transcript){c.appendChild(el("div","lbl","Sən dedin"));c.appendChild(el("div","txt",d.transcript))}
if(d.error){c.appendChild(el("div","txt",d.error));out.appendChild(c);return}
var h=el("div","row");h.style.marginTop="12px";h.appendChild(el("div","who","JARVIS"));h.appendChild(el("span","pill",LABEL[d.status]||d.status));c.appendChild(h);
c.appendChild(el("div","txt",d.screen||d.spoken));
if(d.tts_error)c.appendChild(el("div","lbl","Səs alınmadı: "+d.tts_error));
(d.tasks||[]).forEach(function(t){var b=el("div","t");b.appendChild(el("div","who",(t.owner==="gpt"?"GPT":"CLAUDE")+" · "+t.status));b.appendChild(el("div","txt",t.instruction));if(t.error)b.appendChild(el("div","txt","Xəta: "+t.error));if(t.note)b.appendChild(el("div","lbl",t.note));c.appendChild(b)});
out.appendChild(c);
}
function call(fd,isJson){
busy=true;$("mic").disabled=true;var t0=Date.now();
timer=setInterval(function(){setState("işləyirəm "+Math.round((Date.now()-t0)/1000)+" san")},500);
var opt={method:"POST",headers:{"x-passcode":$("pass").value},body:fd};
if(isJson){opt.headers["content-type"]="application/json"}
fetch("/api/talk",opt).then(function(r){return r.json()}).then(function(d){
render(d);
if(d.audio){player.src="data:audio/mpeg;base64,"+d.audio;var p=player.play();if(p&&p.catch)p.catch(function(){setState("səs üçün ekrana toxun")})}
}).catch(function(e){render({error:"Bağlantı xətası: "+e.message})}).then(function(){clearInterval(timer);busy=false;$("mic").disabled=false;setState("hazır")});
}
function startRec(){
unlock();
navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){
stream=s;
var mime=window.MediaRecorder&&MediaRecorder.isTypeSupported("audio/mp4")?"audio/mp4":(window.MediaRecorder&&MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":"");
rec=mime?new MediaRecorder(s,{mimeType:mime}):new MediaRecorder(s);
chunks=[];
rec.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data)};
rec.onstop=function(){
stream.getTracks().forEach(function(t){t.stop()});
var blob=new Blob(chunks,{type:rec.mimeType||"audio/webm"});
if(blob.size<1500){setState("çox qısa idi");return}
var fd=new FormData();fd.append("audio",blob,"voice");call(fd,false);
};
rec.start();$("mic").classList.add("rec");$("mic").textContent="Dayandır";setState("dinləyirəm");
}).catch(function(){setState("mikrofon icazəsi verilmədi")});
}
$("mic").addEventListener("click",function(){
if(busy)return;
if(rec&&rec.state==="recording"){rec.stop();$("mic").classList.remove("rec");$("mic").textContent="Danış";return}
startRec();
});
function sendText(){
var v=$("txt").value.trim();if(!v||busy)return;unlock();$("txt").value="";
call(JSON.stringify({text:v}),true);
}
$("send").addEventListener("click",sendText);
$("txt").addEventListener("keydown",function(e){if(e.key==="Enter")sendText()});
$("jobs").addEventListener("click",function(){
fetch("/api/jobs",{headers:{"x-passcode":$("pass").value}}).then(function(r){return r.json()}).then(function(d){
var jl=$("jl");jl.textContent="";
if(d.error){jl.appendChild(el("div","lbl",d.error));return}
if(!d.jobs.length){jl.appendChild(el("div","lbl","Hələ iş yoxdur."));return}
d.jobs.forEach(function(j){var c=el("div","card");c.style.marginBottom="8px";var h=el("div","row");h.appendChild(el("div","lbl",j.ts.slice(0,16).replace("T"," ")));h.appendChild(el("span","pill",LABEL[j.status]||j.status));c.appendChild(h);c.appendChild(el("div","txt",j.request));jl.appendChild(c)});
});
});
</script></body></html>`;
