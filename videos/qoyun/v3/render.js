const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const [,,mode,out,list]=process.argv;const TL=JSON.parse(fs.readFileSync('timeline.json'));
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
p.on('pageerror',e=>console.log('ERR',e.message));p.on('console',m=>{if(m.type()==='error')console.log('CERR',m.text())});
await p.goto('file://'+process.cwd()+'/page.html');await p.waitForTimeout(500);
fs.writeFileSync('events.json',JSON.stringify(await p.evaluate(()=>window.EVENTS)));
fs.mkdirSync(out,{recursive:true});
if(mode==='preview'){const ts=list.split(',').map(Number);for(const [i,t] of ts.entries()){await p.evaluate(t=>render(t),t);await p.screenshot({path:`${out}/p_${String(i).padStart(2,'0')}.png`});}}
else{const fps=30,n=Math.ceil(TL.total*fps);for(let i=0;i<n;i++){await p.evaluate(t=>render(t),i/fps);await p.screenshot({path:`${out}/f${String(i).padStart(5,'0')}.jpg`,type:'jpeg',quality:90});}}
await b.close();})();
