const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const [,,mode,out,list]=process.argv;const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
p.on('pageerror',e=>console.log('ERR',e.message));await p.goto('file://'+process.cwd()+'/page.html');await p.waitForTimeout(400);
fs.writeFileSync('events.json',JSON.stringify(await p.evaluate(()=>window.EVENTS)));const TOTAL=await p.evaluate(()=>window.TOTAL);fs.mkdirSync(out,{recursive:true});
if(mode==='preview'){for(const [i,t] of list.split(',').map(Number).entries()){await p.evaluate(t=>render(t),t);await p.screenshot({path:`${out}/p_${String(i).padStart(2,'0')}.png`})}}
else{const n=Math.ceil(TOTAL*30);for(let i=0;i<n;i++){await p.evaluate(t=>render(t),i/30);await p.screenshot({path:`${out}/f${String(i).padStart(5,'0')}.jpg`,type:'jpeg',quality:90})}}
await b.close()})();
