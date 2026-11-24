const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const [,,mode,out]=process.argv;const TL=JSON.parse(fs.readFileSync('timeline.json'));
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
await p.goto('file://'+process.cwd()+'/page.html');await p.waitForTimeout(500);
if(mode==='preview'){for(const t of [3,12,21,29,35,42,52]){await p.evaluate(t=>render(t),t);await p.screenshot({path:`${out}/p_${t}.png`});}}
else{const fps=30,n=Math.ceil(TL.total*fps);fs.mkdirSync(out,{recursive:true});
for(let i=0;i<n;i++){await p.evaluate(t=>render(t),i/fps);await p.screenshot({path:`${out}/f${String(i).padStart(5,'0')}.jpg`,type:'jpeg',quality:92});}}
await b.close();})();
