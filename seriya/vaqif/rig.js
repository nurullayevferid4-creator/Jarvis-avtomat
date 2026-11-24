// Vaqif seriyası — personaj rig-ləri (SVG). Hər funksiya <g> qaytarır, koordinat sahəsi 400x640.
// Parametrlər: expr (ifadə), mouth (X,A..H ağız forması), blink (0..1), look [x,y], armL/armR (dərəcə), bob (px)
const PAL = {
  skin:'#E9B48C', skinD:'#C98E66', hair:'#2A1C13', cap:'#2E9E5B', capD:'#1F7442', sweater:'#F2B632', sweaterD:'#D69A1E',
  jeans:'#2D4370', jeansD:'#22345A', shoe:'#5A3A22', shirt:'#FFFFFF', note:'#FFF6DC', line:'#2A1C13',
  rSkin:'#D9A07A', rSkinD:'#B97F5B', rHair:'#151018', hood:'#20202C', hoodD:'#15151E', sneaker:'#F4F4F4', glass:'#0E1A2B',
  wool:'#F7F5F0', woolD:'#D9D4C7', sheepFace:'#3A3433', collar:'#D8353A', bell:'#F5C542'
};

function mouthShape(m, expr, cx, cy, s=1){
  const L=PAL.line, T='#FFFFFF', TG='#E46D6D', IN='#5A1E1E';
  const smile = (expr==='happy'||expr==='laugh'||expr==='smug') ? 1 : (expr==='worried'?-1:0);
  const k=(x,y)=>`${cx+x*s} ${cy+y*s}`;
  switch(m){
    case 'X': // dinclik
      if(expr==='smug') return `<path d="M${k(-14,2)} Q${k(4,8)} ${k(18,-6)}" stroke="${L}" stroke-width="${4.5*s}" fill="none" stroke-linecap="round"/>`;
      return `<path d="M${k(-15,-2*smile)} Q${k(0,10*smile+2)} ${k(15,-2*smile)}" stroke="${L}" stroke-width="${4.5*s}" fill="none" stroke-linecap="round"/>`;
    case 'A': return `<path d="M${k(-14,0)} Q${k(0,2+3*smile)} ${k(14,0)}" stroke="${L}" stroke-width="${6*s}" fill="none" stroke-linecap="round"/>`;
    case 'B': return `<ellipse cx="${cx}" cy="${cy+2*s}" rx="${15*s}" ry="${6*s}" fill="${IN}"/><rect x="${cx-12*s}" y="${cy-3*s}" width="${24*s}" height="${5*s}" rx="${2*s}" fill="${T}"/>`;
    case 'C': return `<ellipse cx="${cx}" cy="${cy+3*s}" rx="${15*s}" ry="${10*s}" fill="${IN}"/><ellipse cx="${cx}" cy="${cy+9*s}" rx="${9*s}" ry="${4*s}" fill="${TG}"/><rect x="${cx-12*s}" y="${cy-6*s}" width="${24*s}" height="${5*s}" rx="${2*s}" fill="${T}"/>`;
    case 'D': return `<path d="M${k(-19,-4)} Q${k(0,-8)} ${k(19,-4)} Q${k(17,20)} ${k(0,22)} Q${k(-17,20)} ${k(-19,-4)} Z" fill="${IN}"/><ellipse cx="${cx}" cy="${cy+14*s}" rx="${11*s}" ry="${5*s}" fill="${TG}"/><rect x="${cx-15*s}" y="${cy-6*s}" width="${30*s}" height="${6*s}" rx="${3*s}" fill="${T}"/>`;
    case 'E': return `<ellipse cx="${cx}" cy="${cy+3*s}" rx="${10*s}" ry="${12*s}" fill="${IN}" stroke="${L}" stroke-width="${2*s}"/>`;
    case 'F': return `<ellipse cx="${cx}" cy="${cy+2*s}" rx="${6*s}" ry="${7*s}" fill="${IN}" stroke="${L}" stroke-width="${3*s}"/>`;
    case 'G': return `<path d="M${k(-14,4)} Q${k(0,10)} ${k(14,4)}" stroke="${L}" stroke-width="${4*s}" fill="none" stroke-linecap="round"/><rect x="${cx-11*s}" y="${cy-3*s}" width="${22*s}" height="${7*s}" rx="${2*s}" fill="${T}"/>`;
    case 'H': return `<ellipse cx="${cx}" cy="${cy+3*s}" rx="${14*s}" ry="${9*s}" fill="${IN}"/><ellipse cx="${cx}" cy="${cy-1*s}" rx="${7*s}" ry="${4*s}" fill="${TG}"/>`;
  }
  return '';
}

function eyes(expr, blink, look, lx, rx, y, opt={}){
  const L=PAL.line, sk=opt.skin||PAL.skin;
  if(expr==='laugh') return `<path d="M${lx-14} ${y+4} Q${lx} ${y-12} ${lx+14} ${y+4}" stroke="${L}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M${rx-14} ${y+4} Q${rx} ${y-12} ${rx+14} ${y+4}" stroke="${L}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  const big = expr==='surprised'?1.25:1, ry=17*big, rxx=15*big;
  let lid = blink; if(expr==='smug') lid=Math.max(lid,0.45); if(expr==='thinking') lid=Math.max(lid,0.15);
  const px=look[0]*6, py=look[1]*6;
  const one=(cx)=>`<ellipse cx="${cx}" cy="${y}" rx="${rxx}" ry="${ry}" fill="#fff" stroke="${L}" stroke-width="2.5"/>`+
    `<circle cx="${cx+px}" cy="${y+py+2}" r="${8.5*big}" fill="#2a1a10"/><circle cx="${cx+px+3}" cy="${y+py-1}" r="2.8" fill="#fff"/>`+
    (lid>0?(()=>{const ly=y-ry+2*ry*lid, hw=rxx*Math.sqrt(Math.max(0,1-Math.pow((ly-y)/ry,2)))+1.5;
      return `<path d="M${cx-rxx-3} ${y-ry-3} L${cx+rxx+3} ${y-ry-3} L${cx+rxx+3} ${ly} Q${cx} ${ly+4} ${cx-rxx-3} ${ly} Z" fill="${sk}"/>`+
             `<path d="M${cx-hw} ${ly} Q${cx} ${ly+4} ${cx+hw} ${ly}" stroke="${L}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`})():'');
  return one(lx)+one(rx);
}

function brows(expr, lx, rx, y, col, thick=9){
  const cfg={neutral:[0,0,0],happy:[-6,-4,4],laugh:[-8,-6,6],surprised:[-16,0,0],thinking:[-12,6,-10],smug:[2,-6,8],worried:[-6,14,-14],angry:[4,-16,16]}[expr]||[0,0,0];
  const [dy, rotIn, rotOut]=cfg;
  const b=(cx,side)=>{const r=side<0?rotIn*-1:rotIn; const yy=y+dy+(expr==='thinking'&&side>0?-10:0);
    return `<path d="M${cx-17} ${yy+3} Q${cx} ${yy-7} ${cx+17} ${yy+3}" stroke="${col}" stroke-width="${thick}" fill="none" stroke-linecap="round" transform="rotate(${side<0?-r:r} ${cx} ${yy})"/>`};
  return b(lx,-1)+b(rx,1);
}

function arm(sx,sy,deg,len,sleeve,sleeveD,skin,hand=''){
  return `<g transform="rotate(${deg} ${sx} ${sy})"><path d="M${sx-17} ${sy-6} Q${sx} ${sy-16} ${sx+17} ${sy-6} L${sx+14} ${sy+len} L${sx-14} ${sy+len} Z" fill="${sleeve}" stroke="${sleeveD}" stroke-width="3"/>`+
    `<circle cx="${sx}" cy="${sy+len+12}" r="16" fill="${skin}" stroke="${PAL.skinD}" stroke-width="2.5"/>${hand?`<g transform="translate(${sx} ${sy+len+12})">${hand}</g>`:''}</g>`;
}

window.vaqif=function(o={}){
  const {expr='neutral',mouth='X',blink=0,look=[0,0],armL=8,armR=-8,bob=0,prop=true,bust=false}=o; const P=PAL,L=P.line;
  const note=prop?`<g transform="rotate(${-armR-10})"><rect x="-6" y="-38" width="52" height="64" rx="6" fill="${P.note}" stroke="${L}" stroke-width="3"/><path d="M2 -24 H38 M2 -12 H38 M2 0 H30 M2 12 H34" stroke="${P.cap}" stroke-width="3"/><text x="20" y="-28" font-family="Inter" font-weight="900" font-size="11" fill="${P.capD}" text-anchor="middle">₼</text></g>`:'';
  let g='';
  if(!bust){
    g+=`<rect x="158" y="468" width="38" height="140" rx="12" fill="${P.jeans}" stroke="${P.jeansD}" stroke-width="3"/><rect x="204" y="468" width="38" height="140" rx="12" fill="${P.jeans}" stroke="${P.jeansD}" stroke-width="3"/>`;
    g+=`<ellipse cx="172" cy="612" rx="30" ry="13" fill="${P.shoe}"/><ellipse cx="230" cy="612" rx="30" ry="13" fill="${P.shoe}"/>`;
  }
  g+=arm(126,306,armL,118,P.sweater,P.sweaterD,P.skin);
  g+=`<path d="M122 335 Q120 292 162 284 L238 284 Q280 292 278 335 L270 484 Q200 496 130 484 Z" fill="${P.sweater}" stroke="${P.sweaterD}" stroke-width="3.5"/>`;
  g+=`<path d="M130 470 Q200 482 270 470" stroke="${P.sweaterD}" stroke-width="6" fill="none"/>`;
  g+=`<path d="M176 284 L200 326 L224 284 Z" fill="${P.shirt}" stroke="${P.sweaterD}" stroke-width="3"/><path d="M176 284 L190 300 L200 288 L210 300 L224 284" fill="#fff" stroke="#ddd" stroke-width="2"/>`;
  g+=arm(274,306,armR,118,P.sweater,P.sweaterD,P.skin,note);
  // head
  let h=`<rect x="182" y="244" width="36" height="46" rx="10" fill="${P.skinD}"/>`;
  h+=`<ellipse cx="124" cy="186" rx="14" ry="20" fill="${P.skin}" stroke="${P.skinD}" stroke-width="3"/><ellipse cx="276" cy="186" rx="14" ry="20" fill="${P.skin}" stroke="${P.skinD}" stroke-width="3"/>`;
  h+=`<path d="M126 146 Q122 228 160 258 Q200 282 240 258 Q278 228 274 146 Q200 120 126 146 Z" fill="${P.skin}" stroke="${P.skinD}" stroke-width="3.5"/>`;
  h+=`<path d="M130 200 Q142 262 200 270 Q258 262 270 200 Q262 248 200 256 Q138 248 130 200 Z" fill="${P.hair}" opacity=".16"/>`; // qırxılmamış saqqal
  h+=`<path d="M128 178 L128 150 L142 146 L140 186 Z" fill="${P.hair}"/><path d="M272 178 L272 150 L258 146 L260 186 Z" fill="${P.hair}"/>`;
  // pencil behind ear
  h+=`<g transform="translate(288 150) rotate(62)"><rect x="-6" y="-46" width="12" height="70" rx="2" fill="#F5C542" stroke="${L}" stroke-width="2.5"/><rect x="-6" y="-52" width="12" height="10" rx="3" fill="#F28CA8" stroke="${L}" stroke-width="2.5"/><path d="M-6 24 L0 38 L6 24 Z" fill="#F3D9B1" stroke="${L}" stroke-width="2.5"/><path d="M-2 32 L0 38 L2 32Z" fill="${L}"/></g>`;
  // cap (signature)
  h+=`<path d="M116 150 Q118 76 200 70 Q284 76 288 150 Q200 128 116 150 Z" fill="${P.cap}" stroke="${P.capD}" stroke-width="4"/>`;
  h+=`<path d="M120 142 Q200 122 286 142" stroke="${P.capD}" stroke-width="7" fill="none"/>`;
  h+=`<path d="M136 146 Q214 118 312 138 Q326 148 306 156 Q214 140 136 158 Z" fill="${P.capD}" stroke="#16532F" stroke-width="3"/>`;
  h+=`<circle cx="200" cy="74" r="7" fill="${P.capD}"/>`;
  h+=brows(expr,170,230,150,P.hair,10);
  h+=eyes(expr,blink,look,170,230,182);
  if(expr==='happy'||expr==='laugh') h+=`<ellipse cx="148" cy="214" rx="14" ry="8" fill="#F08A7A" opacity=".45"/><ellipse cx="252" cy="214" rx="14" ry="8" fill="#F08A7A" opacity=".45"/>`;
  h+=`<path d="M202 186 Q190 212 196 220 Q204 226 214 216" stroke="${P.skinD}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  h+=`<path d="M174 232 Q188 220 200 229 Q212 220 226 232 Q214 240 200 235 Q186 240 174 232 Z" fill="${P.hair}"/>`; // bığ
  h+=mouthShape(expr==='laugh'&&mouth==='X'?'D':mouth,expr,200,250);
  g+=`<g transform="translate(0 ${bob})">${h}</g>`;
  return `<g>${g}</g>`;
};

window.ramin=function(o={}){
  const {expr='smug',mouth='X',blink=0,look=[0,0],armL=10,armR=-35,bob=0,glasses=true,bust=false}=o; const P=PAL,L=P.line;
  const phone=`<g transform="rotate(${-armR})"><rect x="-16" y="-44" width="34" height="62" rx="7" fill="#111" stroke="#555" stroke-width="3"/><rect x="-12" y="-38" width="26" height="50" rx="4" fill="#6EC6FF"/><circle cx="1" cy="-30" r="3" fill="#fff" opacity=".8"/></g>`;
  let g='';
  if(!bust){
    g+=`<rect x="162" y="474" width="34" height="136" rx="10" fill="#3B3B4A"/><rect x="206" y="474" width="34" height="136" rx="10" fill="#3B3B4A"/>`;
    g+=`<path d="M146 604 Q176 590 204 604 L204 618 L146 618 Z" fill="${P.sneaker}" stroke="#bbb" stroke-width="2"/><path d="M198 604 Q228 590 256 604 L256 618 L198 618 Z" fill="${P.sneaker}" stroke="#bbb" stroke-width="2"/>`;
  }
  g+=arm(132,310,armL,116,P.hood,P.hoodD,P.rSkin);
  g+=`<path d="M128 338 Q126 296 166 288 L234 288 Q274 296 272 338 L266 486 Q200 498 134 486 Z" fill="${P.hood}" stroke="${P.hoodD}" stroke-width="3.5"/>`;
  g+=`<path d="M150 292 Q200 330 250 292" fill="none" stroke="#2C2C3A" stroke-width="12"/><path d="M186 300 L184 352 M214 300 L216 352" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`;
  g+=`<rect x="160" y="400" width="80" height="44" rx="10" fill="none" stroke="#2C2C3A" stroke-width="4"/>`;
  g+=arm(268,310,armR,116,P.hood,P.hoodD,P.rSkin,phone);
  let h=`<rect x="184" y="248" width="32" height="46" rx="10" fill="${P.rSkinD}"/>`;
  h+=`<ellipse cx="130" cy="190" rx="12" ry="18" fill="${P.rSkin}" stroke="${P.rSkinD}" stroke-width="3"/><ellipse cx="270" cy="190" rx="12" ry="18" fill="${P.rSkin}" stroke="${P.rSkinD}" stroke-width="3"/>`;
  h+=`<path d="M132 150 Q128 232 164 262 Q200 284 236 262 Q272 232 268 150 Q200 126 132 150 Z" fill="${P.rSkin}" stroke="${P.rSkinD}" stroke-width="3.5"/>`;
  // quiff hair
  h+=`<path d="M128 170 Q118 108 170 90 Q196 50 252 70 Q300 92 272 172 L268 160 Q238 140 200 144 Q162 140 132 160 Z" fill="${P.rHair}"/>`;
  h+=`<path d="M170 92 Q210 40 262 74" stroke="#3a2f44" stroke-width="6" fill="none"/>`;
  h+=brows(expr,172,228,152,P.rHair,8);
  if(glasses){h+=`<path d="M146 172 H254" stroke="#111" stroke-width="5"/><rect x="146" y="166" width="46" height="32" rx="12" fill="${P.glass}"/><rect x="208" y="166" width="46" height="32" rx="12" fill="${P.glass}"/><path d="M154 172 L166 172" stroke="#6EC6FF" stroke-width="4" stroke-linecap="round"/><path d="M216 172 L228 172" stroke="#6EC6FF" stroke-width="4" stroke-linecap="round"/>`}
  else h+=eyes(expr,blink,look,170,230,184,{skin:P.rSkin});
  h+=`<path d="M202 194 Q194 214 198 220 Q204 224 212 218" stroke="${P.rSkinD}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  h+=mouthShape(expr==='laugh'&&mouth==='X'?'D':mouth,expr,200,244);
  h+=`<path d="M190 266 Q200 272 210 266" stroke="${P.rHair}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  g+=`<g transform="translate(0 ${bob})">${h}</g>`;
  return `<g>${g}</g>`;
};

window.baba=function(o={}){ // Bəbə — maskot qoyun
  const {blink=0,look=[0,0],bob=0,bleat=0}=o; const P=PAL;
  let g='';
  [[150,560],[190,568],[240,568],[280,560]].forEach(([x,y])=>g+=`<rect x="${x-9}" y="${y-60}" width="18" height="70" rx="8" fill="${P.sheepFace}"/>`);
  const puffs=[[200,440,95],[130,450,55],[270,450,55],[160,395,55],[240,395,55],[200,370,50],[150,500,50],[250,500,50],[200,505,60]];
  puffs.forEach(([x,y,r])=>g+=`<circle cx="${x}" cy="${y}" r="${r}" fill="${P.wool}" stroke="${P.woolD}" stroke-width="4"/>`);
  puffs.forEach(([x,y,r])=>g+=`<circle cx="${x}" cy="${y}" r="${r-4}" fill="${P.wool}"/>`);
  let h=`<ellipse cx="200" cy="300" rx="62" ry="72" fill="${P.sheepFace}"/>`;
  h+=`<ellipse cx="128" cy="282" rx="34" ry="16" fill="${P.sheepFace}" transform="rotate(-24 128 282)"/><ellipse cx="272" cy="282" rx="34" ry="16" fill="${P.sheepFace}" transform="rotate(24 272 282)"/>`;
  [[170,232,30],[200,222,32],[230,232,30]].forEach(([x,y,r])=>h+=`<circle cx="${x}" cy="${y}" r="${r}" fill="${P.wool}" stroke="${P.woolD}" stroke-width="3"/>`);
  h+=eyes('neutral',blink,look,176,224,296,{skin:P.sheepFace}).replace(/stroke="#2A1C13"/g,'stroke="#111"');
  h+=bleat>0?`<ellipse cx="200" cy="344" rx="${10+6*bleat}" ry="${6+10*bleat}" fill="#5A1E1E"/>`:`<path d="M188 340 Q200 350 212 340" stroke="#111" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  h+=`<path d="M150 362 Q200 384 250 362" stroke="${P.collar}" stroke-width="12" fill="none" stroke-linecap="round"/><circle cx="200" cy="390" r="15" fill="${P.bell}" stroke="#A97F15" stroke-width="3"/><circle cx="200" cy="396" r="3" fill="#6b4f0c"/>`;
  g+=`<g transform="translate(0 ${bob})">${h}</g>`;
  return `<g>${g}</g>`;
};
