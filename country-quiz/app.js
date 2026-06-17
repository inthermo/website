'use strict';
/* Around the World — geography quiz. Vanilla JS, no deps.
   Two datasets (World countries, US states) share one quiz engine via DATA. */

const W = 1000, H = 500;                         // map viewBox base
const ROUND = 15;                                // questions per session
const CONT_COLORS = {                            // continent accent colors (region picker)
  'North America':'#4ad6c0', 'South America':'#43c06a', Africa:'#f0a93b',
  Europe:'#7c9cff', Asia:'#ff7a9c', Oceania:'#b78cff'
};

let WORLD = {items:[], geo:{}, basemap:''};
let US    = {items:[], geo:{}, basemap:''};
let DATA  = WORLD;                               // active dataset for the current game
const el = id => document.getElementById(id);

/* ---------- geo projection + path building ---------- */
const proj = (lon,lat) => [ (lon+180)/360*W, (90-lat)/180*H ];
function ringPath(ring){
  let d='';
  for(let i=0;i<ring.length;i++){
    const [lon,lat]=ring[i]; const [x,y]=proj(lon,lat);
    d += (i?'L':'M') + x.toFixed(1)+','+y.toFixed(1);
  }
  return d+'Z';
}
function geomPath(g){
  let d='';
  if(g.type==='Polygon') g.coordinates.forEach(r=>d+=ringPath(r));
  else if(g.type==='MultiPolygon') g.coordinates.forEach(p=>p.forEach(r=>d+=ringPath(r)));
  return d;
}
function geomBBox(g){
  let a=[Infinity,Infinity,-Infinity,-Infinity];
  const each=r=>r.forEach(([lon,lat])=>{const[x,y]=proj(lon,lat);
    a[0]=Math.min(a[0],x);a[1]=Math.min(a[1],y);a[2]=Math.max(a[2],x);a[3]=Math.max(a[3],y);});
  if(g.type==='Polygon') g.coordinates.forEach(each);
  else if(g.type==='MultiPolygon') g.coordinates.forEach(p=>p.forEach(each));
  return a;
}

/* ---------- normalize / fuzzy match for free text ---------- */
const norm = s => (s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'')
  .toLowerCase().replace(/[^a-z0-9]/g,'');
function lev(a,b){
  const m=a.length,n=b.length; if(!m)return n; if(!n)return m;
  let prev=Array.from({length:n+1},(_,i)=>i),cur=new Array(n+1);
  for(let i=1;i<=m;i++){cur[0]=i;
    for(let j=1;j<=n;j++){const c=a[i-1]===b[j-1]?0:1;
      cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+c);}
    [prev,cur]=[cur,prev];}
  return prev[n];
}
function freeMatch(input, c){
  const t=norm(input); if(!t) return false;
  const keys=[c.name,c.official,...(c.alt||[])].map(norm).filter(Boolean);
  for(const k of keys){
    if(t===k) return true;
    const tol = k.length>8?2:(k.length>5?1:0);
    if(tol && lev(t,k)<=tol) return true;
  }
  return false;
}

/* ---------- map rendering ---------- */
function fmtPaths(isoList, geo){
  let s='';
  isoList.forEach(iso=>{ const f=geo[iso]; if(f) s+=`<path class="country" data-c="${iso}" d="${f.d}"></path>`; });
  return s;
}
// Frame tightly on the target shape: pad for neighbour context, but enforce a
// minimum span so tiny countries/states are clearly visible.
function viewBoxTarget(c){
  const f=DATA.geo[c.cca3];
  const [lat,lon]=c.latlng, [mx,my]=proj(lon,lat);
  let cx,cy,w,h;
  if(f){
    const bb=f.bb, bw=bb[2]-bb[0], bh=bb[3]-bb[1];
    if(bw>260){ cx=mx; cy=my; w=260; h=130; }          // huge/antimeridian spread (US/Russia/AK): frame on centroid
    else { cx=(bb[0]+bb[2])/2; cy=(bb[1]+bb[3])/2;
           w=Math.max(bw*2.2,84); h=Math.max(bh*2.2,42); }
  } else { cx=mx; cy=my; w=84; h=42; }                 // marker-only territory
  if(w/h<2) w=h*2; else h=w/2;                          // match the ~2:1 svg box
  return [cx-w/2, cy-h/2, w, h].map(v=>v.toFixed(0)).join(' ');
}

/* ---------- state ---------- */
let S = null; // current game state

function buildPool(opts){
  if(opts.section==='us') return US.items.slice();
  if(opts.continents) return WORLD.items.filter(c=>opts.continents.includes(c.continent));
  return WORLD.items.slice();
}
function sample(arr,n,exclude){
  const used=new Set(exclude?[exclude]:[]);
  const pool=arr.filter(x=>!used.has(x)), out=[];
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  for(const x of pool){ if(out.length>=n) break; out.push(x);} return out;
}

function startGame(opts){
  DATA = opts.section==='us' ? US : WORLD;
  const pool=buildPool(opts);
  const total=Math.min(ROUND, pool.length);
  const order=sample(pool, total);
  S={opts,mode:opts.mode,pool,order,idx:0,total,score:0,correct:0,streak:0,bestStreak:0,times:[],t0:0,answered:false};
  show('quiz'); el('hud').classList.remove('hidden');
  el('hud-total').textContent=total;
  nextQuestion();
}

function scopeKey(){
  const o=S.opts;
  if(o.section==='us') return 'us:'+o.mode+':all';
  if(o.continents) return 'world:'+o.mode+':'+[...o.continents].sort().join('+');
  return 'world:'+o.mode+':all';
}

function nextQuestion(){
  if(S.idx>=S.total) return finish();
  S.answered=false;
  const c=S.order[S.idx];
  S.current=c;
  el('hud-q').textContent=S.idx+1;
  el('reveal').classList.add('hidden');
  el('prompt').classList.remove('hidden');
  // map: full basemap for context, zoomed tight on the target shape (user can pinch/drag from here)
  const svg=el('quiz-map');
  setBaseView(viewBoxTarget(c));
  let inner = `<g>${DATA.basemap}</g>`;
  if(DATA.geo[c.cca3]){
    inner += `<path class="country target" d="${DATA.geo[c.cca3].d}"></path>`;
  } else {
    const [lat,lon]=c.latlng, [mx,my]=proj(lon,lat);
    inner += `<circle class="marker" cx="${mx}" cy="${my}" r="3"></circle>`;
    inner += `<circle class="marker-ring" cx="${mx}" cy="${my}" r="3"></circle>`;
  }
  svg.innerHTML=inner;

  // question UI
  if(S.mode==='mc'){
    el('free-form').classList.add('hidden');
    const opts=el('options'); opts.classList.remove('hidden');
    const distractPool = S.opts.continents ? S.pool : DATA.items.filter(x=>x.continent===c.continent);
    let distract=sample(distractPool,4,c);
    while(distract.length<4){ const extra=sample(DATA.items,4,c).find(x=>x!==c&&!distract.includes(x)); if(!extra)break; distract.push(extra);}
    const choices=[c,...distract];
    for(let i=choices.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[choices[i],choices[j]]=[choices[j],choices[i]];}
    opts.innerHTML='';
    choices.forEach(ch=>{
      const b=document.createElement('button'); b.className='opt'; b.textContent=ch.name;
      b.onclick=()=>answer(ch===c, b, choices, c); opts.appendChild(b);
    });
  } else {
    el('options').classList.add('hidden');
    el('free-form').classList.remove('hidden');
    const inp=el('free-input'); inp.value=''; inp.disabled=false; setTimeout(()=>inp.focus(),50);
    el('free-skip').disabled=false;
  }
  S.t0=performance.now();
  startTimer();
}

let timerRAF=null;
function startTimer(){
  cancelAnimationFrame(timerRAF);
  const tick=()=>{ if(S.answered)return; el('hud-time').textContent=((performance.now()-S.t0)/1000).toFixed(1);
    timerRAF=requestAnimationFrame(tick);}; tick();
}

function award(correct, elapsed){
  S.times.push(elapsed);
  if(correct){
    const base=S.mode==='free'?150:100;
    const maxT=S.mode==='free'?15000:10000;
    const speed=Math.max(0,Math.round((1-Math.min(elapsed,maxT)/maxT)*100));
    const mult=1+Math.min(S.streak,9)*0.1;          // streak bonus up to +90%
    S.score+=Math.round((base+speed)*mult);
    S.correct++; S.streak++; S.bestStreak=Math.max(S.bestStreak,S.streak);
  } else { S.streak=0; }
  el('hud-score').textContent=S.score;
  el('hud-streak').textContent=S.streak;
}

function answer(correct, btn, choices, c){
  if(S.answered) return; S.answered=true;
  const elapsed=performance.now()-S.t0;
  cancelAnimationFrame(timerRAF);
  award(correct, elapsed);
  if(choices){
    [...el('options').children].forEach((b,i)=>{ b.disabled=true;
      if(choices[i]===c) b.classList.add('correct');
      else if(b===btn) b.classList.add('wrong'); });
  }
  reveal(correct, c);
}

function reveal(correct, c){
  el('options').classList.add('hidden');
  el('free-form').classList.add('hidden');
  el('prompt').classList.add('hidden');
  const facts=[];
  if(c.capital) facts.push(`<b>Capital:</b> ${c.capital}`);
  facts.push(`<b>Region:</b> ${c.subregion}, ${c.continent}`);
  if(c.abbr) facts.push(`<b>Abbreviation:</b> ${c.abbr}`);
  if(c.population) facts.push(`<b>Population:</b> ${c.population.toLocaleString()}`);
  if(c.area) facts.push(`<b>Area:</b> ${Math.round(c.area).toLocaleString()} km²`);
  if(c.languages&&c.languages.length) facts.push(`<b>Languages:</b> ${c.languages.slice(0,3).join(', ')}`);
  if(c.landlocked) facts.push(`<b>Landlocked</b> · ${c.borders.length} neighbours`);
  const r=el('reveal');
  r.className='reveal '+(correct?'good':'miss');
  r.innerHTML=`<div class="verdict ${correct?'good':'miss'}">${correct?'✓ Correct':'✗ '+c.name}</div>
    ${c.flag?`<div class="flag">${c.flag}</div>`:''}
    <div class="cname">${c.name}</div>
    <div class="facts">${facts.join('')}</div>
    <button class="primary next" id="next-btn">${S.idx+1>=S.total?'See results':'Next'} →</button>`;
  r.classList.remove('hidden');
  el('next-btn').onclick=()=>{ S.idx++; nextQuestion(); };
  el('next-btn').focus();
}

/* free-form submit */
el('free-form').addEventListener('submit',e=>{
  e.preventDefault(); if(S.answered)return;
  const c=S.current; const ok=freeMatch(el('free-input').value,c);
  el('free-input').disabled=true; el('free-skip').disabled=true;
  answer(ok,null,null,c);
});
el('free-skip').addEventListener('click',()=>{ if(S.answered)return;
  const c=S.current; el('free-input').disabled=true; el('free-skip').disabled=true; answer(false,null,null,c); });

/* ---------- results + high scores ---------- */
function loadHS(){ try{return JSON.parse(localStorage.getItem('cq_hs')||'{}');}catch(e){return{};} }
function saveHS(h){ localStorage.setItem('cq_hs',JSON.stringify(h)); }
function finish(){
  cancelAnimationFrame(timerRAF);
  const key=scopeKey();
  const hs=loadHS(); const prev=hs[key]&&hs[key].score||0;
  const isHigh=S.score>prev;
  if(isHigh){ hs[key]={score:S.score,acc:Math.round(S.correct/S.total*100)}; saveHS(hs); }
  const avg=S.times.length?(S.times.reduce((a,b)=>a+b,0)/S.times.length/1000):0;
  el('results-body').innerHTML=[
    ['Score',S.score],['Accuracy',Math.round(S.correct/S.total*100)+'%'],
    ['Correct',S.correct+'/'+S.total],['Best streak',S.bestStreak],
    ['Avg time',avg.toFixed(1)+'s'],['Session best',Math.max(prev,S.score)]
  ].map(([k,v])=>`<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  el('newhigh').classList.toggle('hidden',!isHigh);
  el('hud').classList.add('hidden');
  show('results');
}

function refreshHomeBests(){
  const hs=loadHS();
  document.querySelectorAll('.level-card').forEach(card=>{
    const sec=card.dataset.section, mode=card.dataset.mode, scope=card.dataset.scope||'all';
    let best=0;
    Object.keys(hs).forEach(k=>{
      const p=k.split(':'); if(p[0]!==sec||p[1]!==mode) return;
      const isAll=p[2]==='all';
      if(scope==='region' ? !isAll : isAll) best=Math.max(best,hs[k].score||0);
    });
    const span=card.querySelector('.lvl-best');
    if(span) span.textContent= best?('Best '+best):'';
  });
}

/* ---------- screens / nav ---------- */
const SCREENS=['home','picker','quiz','results','loading'];
function show(id){ SCREENS.forEach(s=>el(s)&&el(s).classList.toggle('hidden',s!==id)); }

let pickContinents=new Set(), pendingMode='mc';
function openPicker(mode){
  pendingMode=mode; pickContinents=new Set();
  el('picker-title').textContent='Choose one or more regions';
  show('picker'); el('hud').classList.add('hidden');
  const cb=el('continent-buttons'); cb.innerHTML='';
  Object.keys(CONT_COLORS).forEach(name=>{
    const b=document.createElement('button'); b.className='cont-btn'; b.dataset.cont=name;
    b.innerHTML=`<span class="dot" style="background:${CONT_COLORS[name]}"></span>${name}`;
    b.onclick=()=>toggleCont(name,b); cb.appendChild(b);
  });
  el('picker-start').disabled=true;
  renderPickerMap();
}
function toggleCont(name,btn){
  if(pickContinents.has(name)) pickContinents.delete(name); else pickContinents.add(name);
  btn.classList.toggle('on');
  el('picker-start').disabled=pickContinents.size===0;
  renderPickerMap();
}
function renderPickerMap(){
  const svg=el('picker-map'); svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  let s='';
  WORLD.items.forEach(c=>{ const f=WORLD.geo[c.cca3]; if(!f)return;
    const on=pickContinents.has(c.continent);
    s+=`<path class="country pick ${on?'sel':''}" data-cont="${c.continent}" d="${f.d}"></path>`;});
  svg.innerHTML=s;
  svg.querySelectorAll('path').forEach(p=>p.onclick=()=>{
    const name=p.dataset.cont; const btn=[...el('continent-buttons').children].find(b=>b.dataset.cont===name);
    toggleCont(name,btn);
  });
}

/* ---------- wire up ---------- */
document.querySelectorAll('.level-card').forEach(card=>{
  card.onclick=()=>{
    const {section,mode,scope}=card.dataset;
    if(scope==='region') openPicker(mode);
    else startGame({section,mode,continents:null});
  };
});
el('picker-back').onclick=()=>{ show('home'); refreshHomeBests(); };
el('picker-start').onclick=()=>{ if(pickContinents.size) startGame({section:'world',mode:pendingMode,continents:[...pickContinents]}); };
const goHome=()=>{ cancelAnimationFrame(timerRAF); el('hud').classList.add('hidden'); show('home'); refreshHomeBests(); };
el('quit-btn').onclick=goHome;
el('results-home').onclick=goHome;
el('results-again').onclick=()=>{ startGame(S.opts); };
el('title').onclick=goHome;

/* ---------- map zoom + pan (pinch / drag / wheel / buttons) ---------- */
let curVB=null, baseVB=null;
function setVB(x,y,w,h){ curVB={x,y,w,h}; el('quiz-map').setAttribute('viewBox',`${x} ${y} ${w} ${h}`); }
function setBaseView(str){ const [x,y,w,h]=str.split(' ').map(Number); baseVB={x,y,w,h}; setVB(x,y,w,h); }
function zoomAt(f, cx, cy){
  if(!curVB) return;
  const rect=el('quiz-map').getBoundingClientRect();
  const fx=curVB.x+(cx-rect.left)/rect.width*curVB.w;
  const fy=curVB.y+(cy-rect.top)/rect.height*curVB.h;
  let nw=curVB.w*f;
  if(nw<12) f=12/curVB.w; if(nw>2400) f=2400/curVB.w;   // clamp zoom range
  setVB(fx-(fx-curVB.x)*f, fy-(fy-curVB.y)*f, curVB.w*f, curVB.h*f);
}
function panBy(dxC,dyC){
  if(!curVB) return;
  const rect=el('quiz-map').getBoundingClientRect();
  setVB(curVB.x-dxC/rect.width*curVB.w, curVB.y-dyC/rect.height*curVB.h, curVB.w, curVB.h);
}
function zoomCenter(f){ const r=el('quiz-map').getBoundingClientRect(); zoomAt(f, r.left+r.width/2, r.top+r.height/2); }
(function setupZoom(){
  const svg=el('quiz-map');
  const pts=new Map(); let lastDist=0, lastMid=null, panLast=null;
  svg.addEventListener('pointerdown',e=>{ svg.setPointerCapture(e.pointerId);
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===1) panLast={x:e.clientX,y:e.clientY}; });
  svg.addEventListener('pointermove',e=>{
    if(!pts.has(e.pointerId)) return;
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const a=[...pts.values()];
    if(a.length>=2){
      const dist=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
      const mid={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};
      if(lastDist) zoomAt(lastDist/dist, mid.x, mid.y);
      if(lastMid) panBy(mid.x-lastMid.x, mid.y-lastMid.y);
      lastDist=dist; lastMid=mid; panLast=null;
    } else if(a.length===1 && panLast){
      panBy(e.clientX-panLast.x, e.clientY-panLast.y); panLast={x:e.clientX,y:e.clientY};
    }
  });
  const up=e=>{ pts.delete(e.pointerId);
    if(pts.size<2){ lastDist=0; lastMid=null; }
    panLast = pts.size===1 ? {x:[...pts.values()][0].x, y:[...pts.values()][0].y} : null; };
  svg.addEventListener('pointerup',up); svg.addEventListener('pointercancel',up);
  svg.addEventListener('wheel',e=>{ e.preventDefault(); zoomAt(e.deltaY>0?1.12:0.88, e.clientX, e.clientY); },{passive:false});
  el('zoom-in').onclick=()=>zoomCenter(0.7);
  el('zoom-out').onclick=()=>zoomCenter(1.4);
  el('zoom-reset').onclick=()=>{ if(baseVB) setVB(baseVB.x,baseVB.y,baseVB.w,baseVB.h); };
})();

/* ---------- boot ---------- */
const V='5';   // cache-buster; bump on each deploy
async function boot(){
  show('loading');
  const [cs,gj,ss,ug]=await Promise.all([
    fetch('countries.json?v='+V).then(r=>r.json()),
    fetch('geo.json?v='+V).then(r=>r.json()),
    fetch('states.json?v='+V).then(r=>r.json()),
    fetch('usgeo.json?v='+V).then(r=>r.json())
  ]);
  WORLD.geo={};
  gj.features.forEach(f=>{ WORLD.geo[f.properties.cca3]={d:geomPath(f.geometry),bb:geomBBox(f.geometry)}; });
  // only quiz countries that have a real outline — so the target is always a filled shape, never a dot
  WORLD.items=cs.filter(c=>WORLD.geo[c.cca3]);
  WORLD.basemap=fmtPaths(Object.keys(WORLD.geo),WORLD.geo);
  US.items=ss; US.geo={};
  ug.features.forEach(f=>{ US.geo[f.properties.cca3]={d:geomPath(f.geometry),bb:geomBBox(f.geometry)}; });
  US.basemap=fmtPaths(Object.keys(US.geo),US.geo);
  DATA=WORLD;
  refreshHomeBests();
  show('home');
}
boot().catch(e=>{ el('loading').textContent='Failed to load: '+e.message; });
