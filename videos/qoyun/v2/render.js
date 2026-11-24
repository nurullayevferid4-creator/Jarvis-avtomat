const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const [,,mode,out]=process.argv;const TL=JSON.parse(fs.readFileSync('timeline.json'));
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file://'+process.cwd()+'/page.html');await p.waitForTimeout(500);
fs.writeFileSync('events.json',JSON.stringify(await p.evaluate(()=>window.EVENTS)));
if(mode==='preview'){const S=TL.starts;const ts=[S[0]+5.5,S[1]+3,S[2]+4.5,S[3]+4.5,S[4]+4,S[5]+5.2,S[6]+3,S[7]+5,S[8]+4.5,S[9]+4,S[10]+12];
 for(const [i,t] of ts.entries()){await p.evaluate(t=>render(t),t);await p.screenshot({path:`${out}/p_${String(i).padStart(2,'0')}.png`});}}
else{const fps=30,n=Math.ceil(TL.total*fps);fs.mkdirSync(out,{recursive:true});
for(let i=0;i<n;i++){await p.evaluate(t=>render(t),i/fps);await p.screenshot({path:`${out}/f${String(i).padStart(5,'0')}.jpg`,type:'jpeg',quality:92});}}
await b.close();})();
