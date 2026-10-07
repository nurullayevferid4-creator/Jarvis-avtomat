// JARVIS idarəetmə səhifəsi (tək fayl, framework yoxdur, innerHTML istifadə olunmur).
// CSP nonce ilə işləyir: renderPage(nonce) hər sorğuda yeni nonce qoyur.
// Qayda: səhifə yalnız serverin qaytardığı real vəziyyəti göstərir. Qoşulmamış funksiya "hazır" kimi göstərilmir.
// Sirlər səhifəyə gəlmir: /api/status yalnız "təyin olunub/olunmayıb" qaytarır.

export const PAGE = `<!doctype html>
<html lang="az"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="JARVIS">
<meta name="theme-color" content="#0f1216">
<title>JARVIS</title>
<style nonce="__NONCE__">
:root{color-scheme:dark;--bg:#0f1216;--card:#181c22;--line:#2a3038;--fg:#ecebe6;--mut:#9aa0a6;--acc:#f0a24a;--ok:#5fc48a;--bad:#e0705f}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:16px;padding-top:calc(16px + env(safe-area-inset-top));padding-bottom:calc(24px + env(safe-area-inset-bottom));line-height:1.45}
main{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
h1{margin:0;font-size:22px;letter-spacing:6px;color:var(--acc)}
.row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;min-width:0}
.gap>*+*{margin-top:8px}
.mic{width:120px;height:120px;border-radius:50%;border:0;background:var(--acc);color:#14161a;font:700 17px system-ui;align-self:center;cursor:pointer}
.mic.rec{background:var(--bad);color:#fff}
.mic:disabled{opacity:.5}
input,select{width:100%;font:inherit;padding:12px;border-radius:10px;border:1px solid var(--line);background:#10141a;color:var(--fg);min-width:0}
input[type=checkbox]{width:auto}
button.s{font:inherit;font-weight:700;padding:10px 16px;border-radius:10px;border:0;background:var(--line);color:var(--fg);cursor:pointer}
button.p{background:var(--acc);color:#14161a}
button.d{background:var(--bad);color:#fff}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:700;background:var(--line)}
.ok{background:var(--ok);color:#10141a}.bad{background:var(--bad);color:#10141a}.warn{background:var(--acc);color:#10141a}
.who{font-size:12px;font-weight:700;letter-spacing:1px;color:var(--acc)}
.lbl{font-size:13px;color:var(--mut)}
.txt{white-space:pre-wrap;word-break:break-word}
.t{border-top:1px solid var(--line);padding-top:8px;margin-top:8px;font-size:14px}
details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 14px}
summary{cursor:pointer;font-weight:700;color:var(--acc);padding:4px 0}
.sub{margin-top:10px}
.kv{display:flex;justify-content:space-between;gap:10px;font-size:14px;border-top:1px solid var(--line);padding:4px 0}
button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--acc);outline-offset:2px}
</style></head><body><main>
<div class="row"><h1>JARVIS</h1><span id="state" class="lbl">hazır</span></div>

<div class="card gap">
<div class="lbl">Parol (yalnız bu səhifədə saxlanır, serverə yalnız başlıqla gedir)</div>
<input id="pass" type="password" placeholder="Parol" autocomplete="off">
<div class="row"><label class="lbl"><input id="rem" type="checkbox"> bu cihazda yadda saxla</label><button id="login" class="s" type="button">Daxil ol / yoxla</button></div>
<div id="loginmsg" class="lbl"></div>
</div>

<button id="mic" class="mic" type="button">Danış</button>
<div class="lbl" id="micnote"></div>
<div class="row"><input id="txt" type="text" placeholder="Və ya əmri yaz"><button id="send" class="s p" type="button">Göndər</button></div>
<div class="lbl" id="att"></div>
<div id="out"></div>

<details id="d-appr"><summary>Təsdiqlər</summary><div class="sub gap"><div class="row"><span class="lbl">Gözləyən və son qərarlar</span><button id="r-appr" class="s" type="button">Yenilə</button></div><div id="appr"></div></div></details>
<details id="d-media"><summary>Media və video işləri</summary><div class="sub gap">
<div class="lbl">JPEG, PNG, MP4, MOV, PDF. Fayl real növünə görə yoxlanılır.</div>
<input id="file" type="file" accept="image/jpeg,image/png,video/mp4,video/quicktime,application/pdf">
<div class="row"><button id="upload" class="s p" type="button">Yüklə</button><button id="r-media" class="s" type="button">Yenilə</button></div>
<div id="media"></div>
<div class="lbl">Video işləri</div><div id="mjobs"></div>
</div></details>
<details id="d-jobs"><summary>Son əmr işləri</summary><div class="sub gap"><button id="r-jobs" class="s" type="button">Yenilə</button><div id="jl"></div></div></details>
<details id="d-acc"><summary>Qoşulu hesablar</summary><div class="sub gap">
<div class="row"><span class="lbl">Platforma vəziyyəti</span><span><button id="spv" class="s" type="button">Canlı yoxla</button> <button id="spr" class="s" type="button">Yenilə</button></span></div>
<div id="sp"></div><button id="tgsetup" class="s" type="button">Telegram webhook-u qur</button></div></details>
<details id="d-audit"><summary>Audit jurnalı</summary><div class="sub gap"><button id="r-audit" class="s" type="button">Yenilə</button><div id="audit"></div></div></details>
<details id="d-status"><summary>Sistem vəziyyəti</summary><div class="sub gap"><button id="r-status" class="s" type="button">Yenilə</button><div id="status"></div></div></details>
<details id="d-err"><summary>Xətalar (bu sessiya)</summary><div class="sub gap"><div id="errs" class="lbl">Xəta yoxdur.</div></div></details>
</main>
<script nonce="__NONCE__">
var $=function(i){return document.getElementById(i)};
var busy=false,rec=null,stream=null,chunks=[],timer=null,attached=[];
var player=new Audio();
var SILENT="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
var LABEL={achieved:"Tamamlandı",partial:"Qismən",blocked:"Bloklandı",pending_approval:"Təsdiq gözləyir",clarification:"Sual",chat:"Söhbət",pending:"Gözləyir",approved:"Təsdiqləndi",rejected:"Rədd edildi",expired:"Vaxtı bitib",done:"Bitdi",failed:"Uğursuz",running:"İşləyir",queued:"Növbədə",unknown:"Naməlum",success:"Bitdi",queued:"Növbədə"};
var errLog=[];
function store(){return $("rem").checked?localStorage:sessionStorage}
try{var sp=localStorage.getItem("jv_pass");if(sp){$("pass").value=sp;$("rem").checked=true}else{$("pass").value=sessionStorage.getItem("jv_pass")||""}}catch(e){}
function savePass(){try{localStorage.removeItem("jv_pass");sessionStorage.removeItem("jv_pass");store().setItem("jv_pass",$("pass").value)}catch(e){}}
$("pass").addEventListener("change",savePass);$("rem").addEventListener("change",savePass);
// Parol UTF-8 -> Base64 olaraq başlığa qoyulur: başlıq yalnız ASCII ola bilər, parolda ə, ı, ş, ğ kimi hərflər ola bilər.
function authHeaders(){
var b=new TextEncoder().encode($("pass").value),s="";
for(var i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);
return {"x-passcode-b64":btoa(s)};
}
function unlock(){try{player.src=SILENT;var p=player.play();if(p&&p.catch)p.catch(function(){})}catch(e){}}
function setState(s){$("state").textContent=s}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function pill(text,cls){return el("span","pill"+(cls?" "+cls:""),text)}
function clear(n){n.textContent=""}
function note(box,msg){clear(box);box.appendChild(el("div","lbl",msg))}
function logErr(where,msg,code){
errLog.unshift({t:new Date().toISOString().slice(11,19),where:where,msg:String(msg).slice(0,200),code:code||""});errLog=errLog.slice(0,30);
var b=$("errs");clear(b);errLog.forEach(function(e){b.appendChild(el("div","t",e.t+" · "+e.where+(e.code?" ["+e.code+"]":"")+" · "+e.msg))});
}
// Vahid API çağırışı: { ok, status, data }. Xəta mətni istifadəçiyə və xəta panelinə düşür.
function api(path,opt,where){
opt=opt||{};var h=authHeaders();
if(opt.headers)for(var k in opt.headers)h[k]=opt.headers[k];
opt.headers=h;
return fetch(path,opt).then(function(r){return r.json().catch(function(){return {}}).then(function(d){
if(!r.ok&&r.status!==202){logErr(where||path,d.message||d.error||("HTTP "+r.status),d.error||d.code||r.status)}
return {ok:r.ok||r.status===202,status:r.status,data:d};
})}).catch(function(e){logErr(where||path,"Bağlantı xətası: "+e.message,"NETWORK");return {ok:false,status:0,data:{error:"NETWORK",message:"Bağlantı xətası"}}});
}
function errText(r){var d=r.data||{};return d.message||d.error||("HTTP "+r.status)}

// ---- Giriş ----
$("login").addEventListener("click",function(){
savePass();
api("/api/status",{},"giriş").then(function(r){
if(r.status===401)$("loginmsg").textContent="Parol səhvdir.";
else if(r.status===429)$("loginmsg").textContent="Çox səhv cəhd. Bir az gözlə.";
else if(r.ok)$("loginmsg").textContent="Giriş uğurludur.";
else $("loginmsg").textContent="Giriş yoxlanmadı: "+errText(r);
if(r.ok)loadStatus();
});
});

// ---- Cavab ----
function render(d){
var out=$("out");clear(out);
var c=el("div","card gap");
if(d.transcript){c.appendChild(el("div","lbl",d.wake?"Sən dedin (Jarvis aktivləşdi)":"Sən dedin"));c.appendChild(el("div","txt",d.transcript))}
if(d.error){c.appendChild(el("div","txt",d.error+(d.code?" ("+d.code+")":"")));out.appendChild(c);return}
var h=el("div","row");h.appendChild(el("div","who","JARVIS"));h.appendChild(pill(LABEL[d.status]||d.status));c.appendChild(h);
c.appendChild(el("div","txt",d.screen||d.spoken));
if(d.tts_error)c.appendChild(el("div","lbl","Səs alınmadı: "+d.tts_error));
if(d.approval_id)c.appendChild(el("div","lbl","Təsdiq qeydi açıldı. Aşağıda «Təsdiqlər» bölməsindən qərar ver. Səslə təsdiq verilmir."));
(d.tools||[]).forEach(function(t){var b=el("div","t");b.appendChild(el("div","who","ALƏT · "+t.tool+" · "+(t.status||"")));if(t.error)b.appendChild(el("div","txt","Xəta: "+t.error));c.appendChild(b)});
(d.tasks||[]).forEach(function(t){var b=el("div","t");b.appendChild(el("div","who",String(t.owner||"claude").toUpperCase()+" · "+t.status));b.appendChild(el("div","txt",t.instruction));if(t.error)b.appendChild(el("div","txt","Xəta: "+t.error));if(t.note)b.appendChild(el("div","lbl",t.note));c.appendChild(b)});
out.appendChild(c);
if(d.approval_id||d.status==="pending_approval"){$("d-appr").open=true;loadApprovals()}
}
function call(body,isJson){
busy=true;$("mic").disabled=true;var t0=Date.now();
timer=setInterval(function(){setState("işləyirəm "+Math.round((Date.now()-t0)/1000)+" san")},500);
api("/api/talk",{method:"POST",body:body,headers:isJson?{"content-type":"application/json"}:{}},"əmr").then(function(r){
render(r.data);
if(r.data&&r.data.audio){player.src="data:audio/mpeg;base64,"+r.data.audio;var p=player.play();if(p&&p.catch)p.catch(function(){setState("səs üçün ekrana toxun")})}
}).then(function(){clearInterval(timer);busy=false;$("mic").disabled=false;setState("hazır")});
}
function showAtt(){$("att").textContent=attached.length?("Əmrə əlavə olunan media: "+attached.map(function(a){return a.slice(0,8)}).join(", ")+" (id-lər Claude-a bildirilir)"):""}
function startRec(){
unlock();
if(!navigator.mediaDevices||!window.MediaRecorder){setState("bu brauzer səs yazmanı dəstəkləmir");return}
navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){
stream=s;
var mime=MediaRecorder.isTypeSupported("audio/mp4")?"audio/mp4":(MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":"");
rec=mime?new MediaRecorder(s,{mimeType:mime}):new MediaRecorder(s);
chunks=[];
rec.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data)};
rec.onstop=function(){
stream.getTracks().forEach(function(t){t.stop()});
var blob=new Blob(chunks,{type:rec.mimeType||"audio/webm"});
if(blob.size<1500){setState("çox qısa idi");return}
var fd=new FormData();fd.append("audio",blob,"voice");if(attached.length)fd.append("attachments",attached.join(","));
call(fd,false);
};
rec.start();$("mic").classList.add("rec");$("mic").textContent="Dayandır";setState("dinləyirəm");
}).catch(function(){setState("mikrofon icazəsi verilmədi")});
}
$("mic").addEventListener("click",function(){
if(busy)return;
if(rec&&rec.state==="recording"){rec.stop();$("mic").classList.remove("rec");$("mic").textContent="Danış";return}
startRec();
});
$("micnote").textContent="Səs əmri: «Jarvis, ...» ilə başla. Riskli əməliyyatlar səslə yox, yalnız Təsdiqlər bölməsində təsdiqlənir.";
function sendText(){
var v=$("txt").value.trim();if(!v||busy)return;unlock();$("txt").value="";
call(JSON.stringify({text:v,attachments:attached}),true);
}
$("send").addEventListener("click",sendText);
$("txt").addEventListener("keydown",function(e){if(e.key==="Enter")sendText()});

// ---- Təsdiqlər ----
function decide(a,decision){
if(decision==="approve"&&!window.confirm("Bu əməliyyat real icra oluna bilər:\\n\\n"+String(a.content||a.action).slice(0,600)+"\\n\\nTəsdiq edirsən?"))return;
api("/api/approvals/"+a.id,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision:decision})},"təsdiq").then(function(r){
var d=r.data||{};
if(!r.ok)setState("xəta: "+errText(r));
else if(decision!=="approve")setState("rədd edildi");
else setState(d.status?("nəticə: "+(LABEL[d.status]||d.status)):"təsdiq verildi");
loadApprovals();
});
}
function loadApprovals(){
var box=$("appr");
api("/api/approvals","","təsdiqlər").then(function(r){
clear(box);
if(!r.ok){note(box,errText(r));return}
var list=r.data.approvals||[];
if(!list.length){note(box,"Qeyd yoxdur.");return}
list.slice(0,20).forEach(function(a){
var c=el("div","card gap");c.style.marginTop="8px";
var h=el("div","row");h.appendChild(el("div","who",String(a.action).toUpperCase()));
var p=el("span");p.appendChild(pill(a.risk||"","warn"));p.appendChild(document.createTextNode(" "));p.appendChild(pill(LABEL[a.status]||a.status,a.status==="approved"?"ok":a.status==="pending"?"warn":""));h.appendChild(p);c.appendChild(h);
c.appendChild(el("div","txt",a.content));
c.appendChild(el("div","lbl",(a.ts||"").slice(0,16).replace("T"," ")+" · bitir: "+(a.expires_at||"").slice(0,16).replace("T"," ")));
if(a.execution&&a.execution.status)c.appendChild(el("div","lbl","İcra: "+a.execution.status+(a.execution.error?" · "+(a.execution.error.message||a.execution.error):"")));
if(a.status==="pending"){
var r2=el("div","row");
var ok=el("button","s p","Təsdiq");ok.type="button";ok.addEventListener("click",function(){decide(a,"approve")});
var no=el("button","s d","Rədd");no.type="button";no.addEventListener("click",function(){decide(a,"reject")});
r2.appendChild(ok);r2.appendChild(no);c.appendChild(r2);
}
box.appendChild(c);
});
});
}
$("r-appr").addEventListener("click",loadApprovals);
$("d-appr").addEventListener("toggle",function(){if($("d-appr").open)loadApprovals()});

// ---- Media ----
function fmtSize(n){return n>1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB"}
$("upload").addEventListener("click",function(){
var f=$("file").files[0];if(!f){setState("fayl seçilməyib");return}
setState("yüklənir...");
api("/api/media",{method:"POST",headers:{"content-type":f.type||"application/octet-stream","x-filename":f.name.replace(/[^\\x20-\\x7e]/g,"_").slice(0,100)},body:f},"yükləmə").then(function(r){
if(!r.ok){setState("yükləmə alınmadı: "+errText(r));return}
setState("yükləndi");$("file").value="";loadMedia();
});
});
function loadMedia(){
var box=$("media");
api("/api/media","","media").then(function(r){
clear(box);
if(!r.ok){note(box,errText(r));return}
var items=r.data.items||[];
if(!items.length){note(box,"Media yoxdur.");return}
items.slice(0,15).forEach(function(m){
var c=el("div","card gap");c.style.marginTop="8px";
var h=el("div","row");h.appendChild(el("div","who",String(m.kind).toUpperCase()+" · "+fmtSize(m.size)));h.appendChild(el("span","lbl",m.id.slice(0,8)));c.appendChild(h);
if(m.filename)c.appendChild(el("div","lbl",m.filename));
var an=m.analysis||{};var bits=[];
if(an.width&&an.height)bits.push(an.width+"×"+an.height);
if(an.duration_s)bits.push(Math.round(an.duration_s)+" san");
if(an.video_codec)bits.push(an.video_codec);
if(bits.length)c.appendChild(el("div","lbl",bits.join(" · ")));
var r2=el("div","row");
var use=el("button","s","Əmrə əlavə et");use.type="button";use.addEventListener("click",function(){if(attached.indexOf(m.id)<0&&attached.length<5)attached.push(m.id);showAtt()});
r2.appendChild(use);
if(m.kind==="video"){
var sel=el("select");["instagram","tiktok","youtube","telegram"].forEach(function(p){var o=el("option",null,p);o.value=p;sel.appendChild(o)});
var go=el("button","s p","Video işi başlat");go.type="button";go.addEventListener("click",function(){
api("/api/media/jobs",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media_id:m.id,platform:sel.value})},"video işi").then(function(x){setState(x.ok?"video işi yaradıldı":"xəta: "+errText(x));loadMJobs()});
});
r2.appendChild(sel);r2.appendChild(go);
}
c.appendChild(r2);box.appendChild(c);
});
});
}
function loadMJobs(){
var box=$("mjobs");
api("/api/media/jobs","","video işləri").then(function(r){
clear(box);
if(!r.ok){note(box,errText(r));return}
var jobs=r.data.jobs||[];
if(!jobs.length){note(box,"Video işi yoxdur.");return}
jobs.forEach(function(j){
var c=el("div","card gap");c.style.marginTop="8px";
var h=el("div","row");h.appendChild(el("div","lbl",(j.created_at?new Date(j.created_at).toISOString().slice(0,16).replace("T"," "):"")+" · "+(j.input&&j.input.platform||"")));var st=String(j.status||"").toLowerCase();h.appendChild(pill(LABEL[st]||j.status,st==="success"?"ok":st==="failed"?"bad":"warn"));c.appendChild(h);
if(j.plan&&j.plan.summary)c.appendChild(el("div","txt",j.plan.summary));
if(j.error)c.appendChild(el("div","txt","Xəta: "+(j.error.message||j.error)));
if(st==="success"&&j.result)c.appendChild(el("div","lbl","Nəticə media: "+String(j.result.media_id||"").slice(0,8)+(j.result.verified===false?" · yoxlama uğursuz":"")));
if(st!=="success"&&st!=="failed"){var adv=el("button","s","İrəlilət");adv.type="button";adv.addEventListener("click",function(){api("/api/media/jobs/"+j.id+"/advance",{method:"POST"},"video işi").then(function(){loadMJobs()})});c.appendChild(adv)}
if(st==="failed"){var rt=el("button","s","Yenidən cəhd");rt.type="button";rt.addEventListener("click",function(){api("/api/media/jobs/"+j.id+"/retry",{method:"POST"},"video işi").then(function(){loadMJobs()})});c.appendChild(rt)}
box.appendChild(c);
});
});
}
$("r-media").addEventListener("click",function(){loadMedia();loadMJobs()});
$("d-media").addEventListener("toggle",function(){if($("d-media").open){loadMedia();loadMJobs()}});

// ---- Əmr işləri ----
function loadJobs(){
var jl=$("jl");
api("/api/jobs","","işlər").then(function(r){
clear(jl);
if(!r.ok){note(jl,errText(r));return}
var jobs=r.data.jobs||[];
if(!jobs.length){note(jl,"Hələ iş yoxdur.");return}
jobs.forEach(function(j){var c=el("div","card");c.style.marginTop="8px";var h=el("div","row");h.appendChild(el("div","lbl",String(j.ts||"").slice(0,16).replace("T"," ")));h.appendChild(pill(LABEL[j.status]||j.status));c.appendChild(h);c.appendChild(el("div","txt",j.request));jl.appendChild(c)});
});
}
$("r-jobs").addEventListener("click",loadJobs);
$("d-jobs").addEventListener("toggle",function(){if($("d-jobs").open)loadJobs()});

// ---- Audit ----
function loadAudit(){
var box=$("audit");
api("/api/audit?limit=40","","audit").then(function(r){
clear(box);
if(!r.ok){note(box,errText(r));return}
var ev=r.data.events||[];
if(!ev.length){note(box,"Hadisə yoxdur.");return}
ev.forEach(function(e){var t=el("div","t");t.appendChild(el("div","who",String(e.ts||"").slice(5,19).replace("T"," ")+" · "+e.event));var s=JSON.stringify(e.data||{});if(s!=="{}")t.appendChild(el("div","lbl",s.slice(0,200)));box.appendChild(t)});
});
}
$("r-audit").addEventListener("click",loadAudit);
$("d-audit").addEventListener("toggle",function(){if($("d-audit").open)loadAudit()});

// ---- Sistem vəziyyəti ----
function kv(box,k,v,cls){var r=el("div","kv");r.appendChild(el("span",null,k));r.appendChild(pill(v,cls));box.appendChild(r)}
function yn(v){return v?["təyin olunub","ok"]:["TƏYİN OLUNMAYIB","bad"]}
function loadStatus(){
var box=$("status");
api("/api/status","","status").then(function(r){
clear(box);
if(!r.ok){note(box,errText(r));return}
var d=r.data;
kv(box,"Versiya",String(d.version||"?"));
kv(box,"Yaddaş",d.storage==="kv"?"KV (davamlı)":"MEMORY (davamlı deyil)",d.storage==="kv"?"ok":"warn");
kv(box,"Koordinator",String(d.coordinator||"?"),String(d.coordinator).indexOf("durable")===0?"ok":"warn");
Object.keys(d.secrets||{}).forEach(function(k){var x=yn(d.secrets[k]);kv(box,k,x[0],x[1])});
var so=d.social||{};
kv(box,"Media anbarı (R2)",so.media_store?"qoşulub":"QOŞULMAYIB",so.media_store?"ok":"bad");
kv(box,"İmzalı media ünvanı",so.media_signing_key&&so.public_base_url?"hazırdır":"MEDIA_SIGNING_KEY/PUBLIC_BASE_URL yoxdur",so.media_signing_key&&so.public_base_url?"ok":"warn");
kv(box,"Token şifrələməsi",so.token_encryption?"aktiv":"TOKEN_ENC_KEY yoxdur",so.token_encryption?"ok":"bad");
["telegram","instagram","tiktok","youtube"].forEach(function(p){var o=so[p]||{},ks=Object.keys(o),all=ks.length>0&&ks.every(function(k){return o[k]});kv(box,p+" sirləri",all?"hamısı təyin olunub":"çatışmayan var",all?"ok":"warn")});
if(d.shopify)kv(box,"Shopify",d.shopify.configured?"təyin olunub":"QOŞULMAYIB",d.shopify.configured?"ok":"warn");
if(d.providers&&d.providers.length){d.providers.forEach(function(p){kv(box,"Provider: "+p.id+" ("+p.role+")",p.configured?"açar var":"açar yoxdur",p.configured?"ok":"warn")})}
if(d.features){Object.keys(d.features).forEach(function(k){kv(box,"Bayraq: "+k,d.features[k]?"açıq":"söndürülüb",d.features[k]?"ok":"warn")})}
var tl=d.tools||[];
box.appendChild(el("div","lbl","Alətlər ("+tl.length+"): "+tl.map(function(t){return t.name+(t.executable?"":" (icra yoxdur)")}).join(", ")));
box.appendChild(el("div","lbl","«təyin olunub» yalnız sirrin mövcudluğunu göstərir. Düzgünlüyü real çağırışla yoxlanır (bax docs/SMOKE.md)."));
});
}
$("r-status").addEventListener("click",loadStatus);
$("d-status").addEventListener("toggle",function(){if($("d-status").open)loadStatus()});

// ---- Hesablar ----
var SOC={CONNECTED:"QOŞULUB",NOT_CONNECTED:"QOŞULMAYIB",TOKEN_EXPIRED:"TOKEN BİTİB",API_ERROR:"API XƏTASI"};
var SCLS={CONNECTED:"ok",NOT_CONNECTED:"",TOKEN_EXPIRED:"bad",API_ERROR:"bad"};
function connect(k){
api("/api/social/"+k+"/connect",{method:"POST"},"qoşulma").then(function(r){
if(r.data&&r.data.url){window.open(r.data.url,"_blank","noopener")}else setState(errText(r));
});
}
function loadSocial(verify){
var box=$("sp");
api("/api/social/status"+(verify?"?verify=1":""),"","hesablar").then(function(r){
clear(box);
if(!r.ok){note(box,errText(r));return}
var d=r.data;
Object.keys(d.platforms||{}).forEach(function(k){
var s=d.platforms[k],c=el("div","card gap");c.style.marginTop="8px";
var h=el("div","row");h.appendChild(el("div","who",(s.label||k).toUpperCase()));
var pills=el("span");pills.appendChild(pill(SOC[s.state]||s.state,SCLS[s.state]));
if(s.pending_approvals){pills.appendChild(document.createTextNode(" "));pills.appendChild(pill("TƏSDİQ GÖZLƏYİR","warn"))}
h.appendChild(pills);c.appendChild(h);
var info=[];
if(s.account&&(s.account.username||s.account.title||s.account.nickname))info.push("hesab: "+(s.account.username||s.account.title||s.account.nickname));
if(s.expires_in_days!==undefined&&s.expires_in_days!==null)info.push("token: "+s.expires_in_days+" gün");
if(s.reason)info.push(s.reason);
if(s.warning)info.push(s.warning);
if(s.secrets_missing&&s.secrets_missing.length)info.push("çatışmayan sirlər: "+s.secrets_missing.join(", "));
if(info.length)c.appendChild(el("div","lbl",info.join(" · ")));
if(s.state!=="CONNECTED"&&k!=="telegram"&&!(s.secrets_missing&&s.secrets_missing.length)){var b=el("button","s","Qoş");b.type="button";b.addEventListener("click",function(){connect(k)});c.appendChild(b)}
box.appendChild(c);
});
});
}
$("spr").addEventListener("click",function(){loadSocial(false)});
$("spv").addEventListener("click",function(){loadSocial(true)});
$("d-acc").addEventListener("toggle",function(){if($("d-acc").open)loadSocial(false)});
$("tgsetup").addEventListener("click",function(){
api("/api/telegram/setup",{method:"POST"},"telegram webhook").then(function(r){setState(r.ok?"Telegram webhook quruldu":"xəta: "+errText(r))});
});
</script></body></html>`;

export function renderPage(nonce) {
  return PAGE.replace(/__NONCE__/g, nonce);
}

// CSP: yalnız nonce-li skript/stil, yalnız eyni mənbəyə sorğu, səs üçün data:/blob:. Çərçivə, base, form qadağandır.
export function pageCsp(nonce) {
  return "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; connect-src 'self'; media-src data: blob:; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
}
