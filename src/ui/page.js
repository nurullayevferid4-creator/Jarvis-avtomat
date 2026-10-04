export const PAGE = `<!doctype html>
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
// Parol UTF-8 -> Base64 olaraq başlığa qoyulur: başlıq yalnız ASCII ola bilər, parolda ə, ı, ş, ğ kimi hərflər ola bilər.
function authHeaders(){
var b=new TextEncoder().encode($("pass").value),s="";
for(var i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);
return {"x-passcode-b64":btoa(s)};
}
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
(d.tasks||[]).forEach(function(t){var b=el("div","t");b.appendChild(el("div","who",String(t.owner||"claude").toUpperCase()+" · "+t.status));b.appendChild(el("div","txt",t.instruction));if(t.error)b.appendChild(el("div","txt","Xəta: "+t.error));if(t.note)b.appendChild(el("div","lbl",t.note));c.appendChild(b)});
out.appendChild(c);
}
function call(fd,isJson){
busy=true;$("mic").disabled=true;var t0=Date.now();
timer=setInterval(function(){setState("işləyirəm "+Math.round((Date.now()-t0)/1000)+" san")},500);
var opt={method:"POST",headers:authHeaders(),body:fd};
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
fetch("/api/jobs",{headers:authHeaders()}).then(function(r){return r.json()}).then(function(d){
var jl=$("jl");jl.textContent="";
if(d.error){jl.appendChild(el("div","lbl",d.error));return}
if(!d.jobs.length){jl.appendChild(el("div","lbl","Hələ iş yoxdur."));return}
d.jobs.forEach(function(j){var c=el("div","card");c.style.marginBottom="8px";var h=el("div","row");h.appendChild(el("div","lbl",j.ts.slice(0,16).replace("T"," ")));h.appendChild(el("span","pill",LABEL[j.status]||j.status));c.appendChild(h);c.appendChild(el("div","txt",j.request));jl.appendChild(c)});
});
});
</script></body></html>`;
