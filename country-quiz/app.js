'use strict';
/* Around the World — country quiz. Vanilla JS, no deps. */

const W = 1000, H = 500;                         // map viewBox base
const ROUND = 15;                                // questions per session
const CONT_COLORS = {                            // continent accent colors
  'North America':'#4ad6c0', 'South America':'#43c06a', Africa:'#f0a93b',
  Europe:'#7c9cff', Asia:'#ff7a9c', Oceania:'#b78cff'
};

let COUNTRIES = [], BYISO = {}, GEO = null;
const $ = s => document.querySelector(s);
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
function fmtPaths(isoList){
  // returns SVG path markup for given isos that have geometry
  let s='';
  isoList.forEach(iso=>{ const f=GEO[iso]; if(f) s+=`<path class="country" data-c="${iso}" d="${f.d}"></path>`; });
  return s;
}
function bboxOf(isoList){
  let a=[Infinity,Infinity,-Infinity,-Infinity], any=false;
  isoList.forEach(iso=>{
    const f=GEO[iso];
    if(f){any=true; a[0]=Math.min(a[0],f.bb[0]);a[1]=Math.min(a[1],f.bb[1]);
      a[2]=Math.max(a[2],f.bb[2]);a[3]=Math.max(a[3],f.bb[3]);}
    else{ const c=BYISO[iso]; if(c){const[lat,lon]=c.latlng;const[x,y]=proj(lon,lat);
      any=true; a[0]=Math.min(a[0],x);a[1]=Math.min(a[1],y);a[2]=Math.max(a[2],x);a[3]=Math.max(a[3],y);}}
  });
  return any?a:[0,0,W,H];
}
function viewBoxFor(isoList, pad=0.18){
  let [x0,y0,x1,y1]=bboxOf(isoList);
  let w=Math.max(x1-x0,12), h=Math.max(y1-y0,12);
  x0-=w*pad; y0-=h*pad; w*=(1+2*pad); h*=(1+2*pad);
  // keep ~2:1 aspect to match svg box
  const target=2; if(w/h<target){const nw=h*target; x0-=(nw-w)/2; w=nw;} else {const nh=w/target; y0-=(nh-h)/2; h=nh;}
  return `${x0.toFixed(0)} ${y0.toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}`;
}

// Frame tightly on the target country: pad for neighbour context, but enforce a
// minimum span so tiny countries (e.g. Bahamas) are clearly visible.
function viewBoxTarget(c){
  const f=GEO[c.cca3];
  const [lat,lon]=c.latlng, [mx,my]=proj(lon,lat);
  let cx,cy,w,h;
  if(f){
    const bb=f.bb, bw=bb[2]-bb[0], bh=bb[3]-bb[1];
    if(bw>260){ cx=mx; cy=my; w=260; h=130; }          // huge/antimeridian spread (US/Russia/Fiji): frame on centroid
    else { cx=(bb[0]+bb[2])/2; cy=(bb[1]+bb[3])/2;
           w=Math.max(bw*2.2,84); h=Math.max(bh*2.2,42); }
  } else { cx=mx; cy=my; w=84; h=42; }                 // marker-only territory
  if(w/h<2) w=h*2; else h=w/2;                          // match the ~2:1 svg box
  return [cx-w/2, cy-h/2, w, h].map(v=>v.toFixed(0)).join(' ');
}

let BASEMAP='';   // cached gray world basemap (all geometry), built at boot

/* ---------- state ---------- */
let S = null; // current game state

function buildPool(level, continents){
  let pool;
  if(level<=2) pool = COUNTRIES.filter(c=>continents.includes(c.continent));
  else pool = COUNTRIES.slice();
  return pool;
}
function sample(arr,n,exclude){
  const out=[], used=new Set(exclude?[exclude]:[]);
  const pool=arr.filter(x=>!used.has(x));
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  for(const x of pool){ if(out.length>=n) break; out.push(x);} return out;
}

function startGame(level, continents){
  const pool=buildPool(level,continents);
  const total=Math.min(ROUND, pool.length);
  const order=sample(pool, total);
  S={level,continents,mode:(level%2===0)?'free':'mc',scope:(level<=2?continents:null),
     pool,order,idx:0,total,score:0,correct:0,streak:0,bestStreak:0,times:[],t0:0,answered:false};
  show('quiz'); el('hud').classList.remove('hidden');
  el('hud-total').textContent=total;
  nextQuestion();
}

function scopeKey(){ return S.level<=2 ? [...S.continents].sort().join('+') : 'all'; }

function nextQuestion(){
  if(S.idx>=S.total) return finish();
  S.answered=false;
  const c=S.order[S.idx];
  S.current=c;
  el('hud-q').textContent=S.idx+1;
  el('reveal').classList.add('hidden');
  // map: full gray world for context, zoomed tight on the target country
  const svg=el('quiz-map');
  svg.setAttribute('viewBox', viewBoxTarget(c));
  let inner = `<g>${BASEMAP}</g>`;
  // target: fill the country's own shape; only tiny territories with no geometry get a marker
  if(GEO[c.cca3]){
    inner += `<path class="country target" d="${GEO[c.cca3].d}"></path>`;
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
    const distractPool = (S.level<=2?S.pool:COUNTRIES.filter(x=>x.continent===c.continent));
    let distract=sample(distractPool,4,c);
    while(distract.length<4){ const extra=sample(COUNTRIES,4,c).find(x=>x!==c&&!distract.includes(x)); if(!extra)break; distract.push(extra);}
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
  const facts=[];
  if(c.capital) facts.push(`<b>Capital:</b> ${c.capital}`);
  facts.push(`<b>Region:</b> ${c.subregion}, ${c.continent}`);
  if(c.population) facts.push(`<b>Population:</b> ${c.population.toLocaleString()}`);
  if(c.area) facts.push(`<b>Area:</b> ${Math.round(c.area).toLocaleString()} km²`);
  if(c.languages&&c.languages.length) facts.push(`<b>Languages:</b> ${c.languages.slice(0,3).join(', ')}`);
  if(c.landlocked) facts.push(`<b>Landlocked</b> · ${c.borders.length} neighbours`);
  const r=el('reveal');
  r.className='reveal '+(correct?'good':'miss');
  r.innerHTML=`<div class="verdict ${correct?'good':'miss'}">${correct?'✓ Correct':'✗ '+c.name}</div>
    <div class="flag">${c.flag||'🏳️'}</div>
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
  const key='L'+S.level+'_'+scopeKey();
  const hs=loadHS(); const prev=hs[key]&&hs[key].score||0;
  const isHigh=S.score>prev;
  if(isHigh){ hs[key]={score:S.score,acc:Math.round(S.correct/S.total*100),date:todayStr()}; saveHS(hs); }
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
function todayStr(){ const d=new Date(); return (d.getMonth()+1)+'/'+d.getDate(); }

function refreshHomeBests(){
  const hs=loadHS();
  document.querySelectorAll('.lvl-best').forEach(span=>{
    const lv=span.dataset.bestfor;
    let best=0,scope='';
    Object.keys(hs).forEach(k=>{ if(k.startsWith('L'+lv+'_')&&hs[k].score>best){best=hs[k].score;scope=k;} });
    span.textContent= best? ('Best '+best) : '';
  });
}

/* ---------- screens / nav ---------- */
const SCREENS=['home','picker','quiz','results','loading'];
function show(id){ SCREENS.forEach(s=>el(s)&&el(s).classList.toggle('hidden',s!==id)); }

let pickContinents=new Set(), pendingLevel=1;
function openPicker(level){
  pendingLevel=level; pickContinents=new Set();
  el('picker-title').textContent='Level '+level+' — choose one or more regions';
  show('picker'); el('hud').classList.add('hidden');
  // continent buttons
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
  COUNTRIES.forEach(c=>{ const f=GEO[c.cca3]; if(!f)return;
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
  card.onclick=()=>{ const lv=+card.dataset.level;
    if(lv<=2) openPicker(lv); else startGame(lv,null); };
});
el('picker-back').onclick=()=>{ show('home'); refreshHomeBests(); };
el('picker-start').onclick=()=>{ if(pickContinents.size) startGame(pendingLevel,[...pickContinents]); };
el('quit-btn').onclick=()=>{ cancelAnimationFrame(timerRAF); el('hud').classList.add('hidden'); show('home'); refreshHomeBests(); };
el('results-home').onclick=()=>{ show('home'); refreshHomeBests(); };
el('results-again').onclick=()=>{ startGame(S.level,S.continents); };
el('title').onclick=()=>{ cancelAnimationFrame(timerRAF); el('hud').classList.add('hidden'); show('home'); refreshHomeBests(); };

/* ---------- boot ---------- */
async function boot(){
  show('loading');
  const [cs,gj]=await Promise.all([
    fetch('countries.json').then(r=>r.json()),
    fetch('geo.json').then(r=>r.json())
  ]);
  COUNTRIES=cs; COUNTRIES.forEach(c=>BYISO[c.cca3]=c);
  GEO={};
  gj.features.forEach(f=>{ GEO[f.properties.cca3]={d:geomPath(f.geometry),bb:geomBBox(f.geometry)}; });
  BASEMAP=fmtPaths(Object.keys(GEO));
  refreshHomeBests();
  show('home');
}
boot().catch(e=>{ el('loading').textContent='Failed to load: '+e.message; });
