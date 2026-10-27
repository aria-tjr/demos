/* Vantaro Quant - demo panel. Todo es simulado en el navegador. */
(function(){
"use strict";
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const fmt=(n,d=2)=>Number(n).toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=n=>(n<0?'-':'')+'$'+fmt(Math.abs(n));
const sgn=n=>(n>0?'+':'')+fmt(n);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pad=n=>String(n).padStart(2,'0');
const tstr=ms=>{const d=new Date(ms);return pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1)+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());};
const nowStr=()=>{const d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());};
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2600);}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

/* ---------- RNG y datos ficticios ---------- */
function rng(seed){let a=seed>>>0;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gauss(r){let u=0,v=0;while(!u)u=r();while(!v)v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
const SYM={ 'SIM-100':{p0:4850,vol:.0028,dec:2}, 'XSIM/USD':{p0:1.0842,vol:.0012,dec:5}, 'SIMCOIN-PERP':{p0:61250,vol:.0045,dec:1} };
function makeGen(seed,symbol,tfMin,startPrice,startTime){
  const r=rng(seed), cfg=SYM[symbol]; let price=startPrice||cfg.p0, drift=0, regimeLeft=0, volMul=1;
  let t=startTime||Date.UTC(2026,8,1,0,0);
  const scale=Math.sqrt(tfMin/15);
  return {
    next(){
      if(regimeLeft<=0){drift=(r()-.5)*cfg.vol*0.55;volMul=.6+r()*1.1;regimeLeft=20+Math.floor(r()*70);}
      regimeLeft--;
      const o=price, sig=cfg.vol*volMul*scale;
      const steps=6; let p=o,h=o,l=o;
      for(let k=0;k<steps;k++){p*=1+drift*scale/steps+sig*gauss(r)/Math.sqrt(steps);h=Math.max(h,p);l=Math.min(l,p);}
      h*=1+Math.abs(gauss(r))*sig*.25; l*=1-Math.abs(gauss(r))*sig*.25;
      const c={t,o,h,l,c:p,v:Math.round(800+r()*2400*volMul)}; price=p; t+=tfMin*60000; return c;
    },
    rand:r
  };
}
function genSeries(seed,symbol,tf,n){const g=makeGen(seed,symbol,tf);const a=[];for(let i=0;i<n;i++)a.push(g.next());return a;}

/* ---------- Indicadores ---------- */
function ema(v,n){const k=2/(n+1),o=new Array(v.length);let p=v[0];for(let i=0;i<v.length;i++){p=i?v[i]*k+p*(1-k):v[0];o[i]=i>=n-1?p:null;}return o;}
function rsi(v,n){const o=new Array(v.length).fill(null);let g=0,l=0;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1],up=Math.max(d,0),dn=Math.max(-d,0);if(i<=n){g+=up;l+=dn;if(i===n){g/=n;l/=n;o[i]=l===0?100:100-100/(1+g/l);}}else{g=(g*(n-1)+up)/n;l=(l*(n-1)+dn)/n;o[i]=l===0?100:100-100/(1+g/l);}}return o;}
function indicators(c,st){const cl=c.map(x=>x.c);return {fast:ema(cl,st.fast),slow:ema(cl,st.slow),rsi:rsi(cl,st.rsiLen)};}
function signalAt(i,ind,st){
  if(i<1)return 0; const {fast,slow,rsi:R}=ind; let s=0;
  const cross=(fast[i]!=null&&slow[i]!=null&&fast[i-1]!=null&&slow[i-1]!=null)?(fast[i]>slow[i]&&fast[i-1]<=slow[i-1]?1:(fast[i]<slow[i]&&fast[i-1]>=slow[i-1]?-1:0)):0;
  if(st.type==='ema')s=cross;
  else if(st.type==='rsi'){if(R[i]!=null&&R[i-1]!=null){if(R[i-1]<st.low&&R[i]>=st.low)s=1;else if(R[i-1]>st.high&&R[i]<=st.high)s=-1;}}
  else{if(cross===1&&R[i]>50)s=1;else if(cross===-1&&R[i]<50)s=-1;}
  if(st.dir==='long'&&s<0)return 0; if(st.dir==='short'&&s>0)return 0; return s;
}

/* ---------- Estado ---------- */
const DEF={strat:{type:'ema',fast:9,slow:21,rsiLen:14,low:30,high:70,dir:'both',sym:'SIM-100',tf:15,dedup:true},
  risk:{risk:1,sl:1.5,tp:3,dd:12,lev:3,trail:false,trailPct:1.2,h1:0,h2:24,weekend:false},seed:2187,bars:600};
let CFG;
try{CFG=Object.assign(JSON.parse(JSON.stringify(DEF)),JSON.parse(localStorage.getItem('vq-cfg')||'{}'));}catch(e){CFG=JSON.parse(JSON.stringify(DEF));}
const save=()=>{try{localStorage.setItem('vq-cfg',JSON.stringify(CFG));}catch(e){}};
const FEE=0.04/100, SLIP=0.01/100;
function allowedTime(t,rk){const d=new Date(t),h=d.getUTCHours(),wd=d.getUTCDay();if(!rk.weekend&&(wd===0||wd===6))return false;return h>=rk.h1&&h<rk.h2;}

/* ---------- Motor de posiciones (compartido por backtest y paper) ---------- */
function openPos(side,px,eq,rk,t,i){
  const slD=px*rk.sl/100; let qty=(eq*rk.risk/100)/slD; const maxQty=eq*rk.lev/px; qty=Math.min(qty,maxQty);
  return {side,entry:px,qty,sl:side>0?px-slD:px+slD,tp:side>0?px*(1+rk.tp/100):px*(1-rk.tp/100),t,i,riskUsd:qty*slD,best:px};
}
function checkExit(p,c,rk){ // devuelve {px,why} o null; SL primero (conservador)
  if(p.side>0){
    if(c.o<=p.sl)return{px:c.o,why:p.trailed?'Trailing':'SL'}; if(c.l<=p.sl)return{px:p.sl,why:p.trailed?'Trailing':'SL'};
    if(c.o>=p.tp)return{px:c.o,why:'TP'}; if(c.h>=p.tp)return{px:p.tp,why:'TP'};
    if(rk.trail){const ns=c.h*(1-rk.trailPct/100);if(ns>p.sl){p.sl=ns;p.trailed=true;}}
  }else{
    if(c.o>=p.sl)return{px:c.o,why:p.trailed?'Trailing':'SL'}; if(c.h>=p.sl)return{px:p.sl,why:p.trailed?'Trailing':'SL'};
    if(c.o<=p.tp)return{px:c.o,why:'TP'}; if(c.l<=p.tp)return{px:p.tp,why:'TP'};
    if(rk.trail){const ns=c.l*(1+rk.trailPct/100);if(ns<p.sl){p.sl=ns;p.trailed=true;}}
  }
  return null;
}
function pnlOf(p,px){return (px-p.entry)*p.qty*p.side-(p.entry+px)*p.qty*FEE;}

/* ---------- Backtest ---------- */
let BT=null;
function runBacktest(){
  const st=CFG.strat,rk=CFG.risk; const c=genSeries(CFG.seed,st.sym,st.tf,CFG.bars); const ind=indicators(c,st);
  let eq=10000,peak=eq,maxDD=0,pos=null,pend=0,halted=false,haltAt=null; const trades=[],curve=[],dds=[],sigs=[];
  const close=(px,why,i)=>{const pl=pnlOf(pos,px);eq+=pl;trades.push({n:trades.length+1,side:pos.side,ti:pos.t,pi:pos.entry,to:c[i].t,po:px,why,qty:pos.qty,pl,R:pl/pos.riskUsd,i0:pos.i,i1:i});pos=null;};
  for(let i=0;i<c.length;i++){
    const k=c[i];
    if(pend&&!halted){
      if(pos&&pos.side!==pend)close(k.o*(1-SLIP*pos.side),'Señal contraria',i);
      if(!pos&&allowedTime(k.t,rk)){const px=k.o*(1+SLIP*pend);pos=openPos(pend,px,eq,rk,k.t,i);}
      pend=0;
    }
    if(pos){const x=checkExit(pos,k,rk);if(x)close(x.px,x.why,i);}
    const s=signalAt(i,ind,st); if(s){sigs.push({i,s,t:k.t,px:k.c});pend=s;}
    const mtm=eq+(pos?pnlOf(pos,k.c):0); peak=Math.max(peak,mtm); const dd=(peak-mtm)/peak*100; maxDD=Math.max(maxDD,dd);
    if(!halted&&dd>=rk.dd){halted=true;haltAt=i;if(pos)close(k.c,'Límite DD',i);pend=0;}
    curve.push(eq+(pos?pnlOf(pos,k.c):0)); dds.push(dd);
  }
  if(pos)close(c[c.length-1].c,'Fin de datos',c.length-1);
  const wins=trades.filter(t=>t.pl>0),gw=wins.reduce((a,t)=>a+t.pl,0),gl=-trades.filter(t=>t.pl<=0).reduce((a,t)=>a+t.pl,0);
  BT={c,ind,trades,curve,dds,sigs,halted,haltAt,stats:{net:(eq-10000)/100,trades:trades.length,win:trades.length?wins.length/trades.length*100:0,pf:gl?gw/gl:(gw?Infinity:0),dd:maxDD,avgR:trades.length?trades.reduce((a,t)=>a+t.R,0)/trades.length:0,eq}};
  renderBacktest();
}

/* ---------- Gráfico de velas (canvas) ---------- */
function CandleChart(canvas,tip,opts){
  const ctx=canvas.getContext('2d'); const self={data:[],ind:null,marks:[],lines:[],view:{end:null,count:opts.count||140},halt:null};
  let W=0,H=0,dpr=1,hover=-1,drag=null;
  function size(){const r=canvas.getBoundingClientRect();dpr=window.devicePixelRatio||1;W=r.width;H=r.height;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
  self.draw=function(){
    if(!W)size(); const d=self.data; ctx.clearRect(0,0,W,H); if(!d.length)return;
    const n=d.length, cnt=clamp(self.view.count,20,n); let end=self.view.end==null?n:clamp(self.view.end,cnt,n); self._end=end; const st=end-cnt;
    const padR=64, rsiH=opts.rsi?70:0, gap=opts.rsi?14:0, top=12, bot=22, priceH=H-top-bot-rsiH-gap;
    const cw=(W-padR-8)/cnt; let lo=Infinity,hi=-Infinity;
    for(let i=st;i<end;i++){lo=Math.min(lo,d[i].l);hi=Math.max(hi,d[i].h);}
    self.lines.forEach(L=>{if(L.y){lo=Math.min(lo,L.y);hi=Math.max(hi,L.y);}});
    const m=(hi-lo)*.08; lo-=m; hi+=m; const Y=p=>top+(hi-p)/(hi-lo)*priceH, X=i=>4+(i-st+.5)*cw;
    ctx.font='11px JetBrains Mono, monospace'; ctx.textBaseline='middle';
    for(let g=0;g<=5;g++){const p=lo+(hi-lo)*g/5,y=Y(p);ctx.strokeStyle='#18232f';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W-padR,y);ctx.stroke();ctx.fillStyle='#5f7187';ctx.fillText(p.toFixed(opts.dec()),W-padR+6,y);}
    const step=Math.max(1,Math.round(90/cw)); ctx.fillStyle='#5f7187'; ctx.textAlign='center';
    for(let i=st;i<end;i+=step){const dd=new Date(d[i].t);ctx.fillText(pad(dd.getUTCDate())+'/'+pad(dd.getUTCMonth()+1)+' '+pad(dd.getUTCHours())+':'+pad(dd.getUTCMinutes()),X(i),H-10);}
    ctx.textAlign='left';
    if(self.halt!=null&&self.halt<end){const x=Math.max(4,X(Math.max(self.halt,st))-cw/2);ctx.fillStyle='rgba(244,63,94,.07)';ctx.fillRect(x,top,W-padR-x,priceH);ctx.fillStyle='#fb7185';ctx.fillText('Bot detenido: límite de drawdown',x+8,top+12);}
    const bw=Math.max(1,cw*.62);
    for(let i=st;i<end;i++){const k=d[i],up=k.c>=k.o,x=X(i);ctx.strokeStyle=ctx.fillStyle=up?'#22c55e':'#f43f5e';ctx.beginPath();ctx.moveTo(x,Y(k.h));ctx.lineTo(x,Y(k.l));ctx.stroke();const y1=Y(Math.max(k.o,k.c)),y2=Y(Math.min(k.o,k.c));ctx.fillRect(x-bw/2,y1,bw,Math.max(1,y2-y1));}
    if(self.ind){[[self.ind.fast,'#60a5fa'],[self.ind.slow,'#f59e0b']].forEach(([a,col])=>{ctx.strokeStyle=col;ctx.lineWidth=1.6;ctx.beginPath();let s=false;for(let i=st;i<end;i++){if(a[i]==null)continue;const x=X(i),y=Y(a[i]);s?ctx.lineTo(x,y):ctx.moveTo(x,y);s=true;}ctx.stroke();});ctx.lineWidth=1;}
    self.marks.forEach(mk=>{if(mk.i<st||mk.i>=end)return;const x=X(mk.i),y=Y(mk.p);ctx.fillStyle=mk.col;ctx.beginPath();if(mk.kind==='up'){ctx.moveTo(x,y+4);ctx.lineTo(x-6,y+14);ctx.lineTo(x+6,y+14);}else if(mk.kind==='down'){ctx.moveTo(x,y-4);ctx.lineTo(x-6,y-14);ctx.lineTo(x+6,y-14);}else{ctx.arc(x,y,3.5,0,7);}ctx.fill();});
    self.lines.forEach(L=>{const y=Y(L.y);ctx.setLineDash(L.dash?[5,4]:[]);ctx.strokeStyle=L.col;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W-padR,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=L.col;ctx.fillRect(W-padR,y-9,padR,18);ctx.fillStyle='#0b1016';ctx.fillText(L.y.toFixed(opts.dec()),W-padR+6,y);if(L.label){ctx.fillStyle=L.col;ctx.fillText(L.label,8,y-9);}});
    const last=d[end-1]; if(end===n){const y=Y(last.c);ctx.setLineDash([2,3]);ctx.strokeStyle='#2dd4bf';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W-padR,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#2dd4bf';ctx.fillRect(W-padR,y-9,padR,18);ctx.fillStyle='#04221f';ctx.fillText(last.c.toFixed(opts.dec()),W-padR+6,y);}
    if(opts.rsi&&self.ind){const y0=top+priceH+gap,RY=v=>y0+(100-v)/100*rsiH;ctx.fillStyle='#0d141c';ctx.fillRect(0,y0,W-padR,rsiH);
      [CFG.strat.low,CFG.strat.high].forEach(v=>{ctx.strokeStyle='#2a3a4d';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(0,RY(v));ctx.lineTo(W-padR,RY(v));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#5f7187';ctx.fillText(String(v),W-padR+6,RY(v));});
      ctx.strokeStyle='#a78bfa';ctx.lineWidth=1.4;ctx.beginPath();let s=false;for(let i=st;i<end;i++){const v=self.ind.rsi[i];if(v==null)continue;s?ctx.lineTo(X(i),RY(v)):ctx.moveTo(X(i),RY(v));s=true;}ctx.stroke();ctx.lineWidth=1;ctx.fillStyle='#8a9bb0';ctx.fillText('RSI '+CFG.strat.rsiLen,6,y0+10);}
    if(hover>=st&&hover<end){const x=X(hover);ctx.strokeStyle='rgba(255,255,255,.18)';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,H-bot);ctx.stroke();
      const k=d[hover],dec=opts.dec();let h='<b>'+tstr(k.t)+' UTC</b><br>A '+k.o.toFixed(dec)+'  M '+k.h.toFixed(dec)+'<br>m '+k.l.toFixed(dec)+'  C '+k.c.toFixed(dec);
      if(self.ind){const f=self.ind.fast[hover],s2=self.ind.slow[hover],r=self.ind.rsi[hover];h+='<br><span style="color:#60a5fa">EMA '+CFG.strat.fast+' '+(f==null?'-':f.toFixed(dec))+'</span>  <span style="color:#f59e0b">EMA '+CFG.strat.slow+' '+(s2==null?'-':s2.toFixed(dec))+'</span><br><span style="color:#a78bfa">RSI '+(r==null?'-':r.toFixed(1))+'</span>';}
      const mk=self.marks.filter(q=>q.i===hover&&q.txt).map(q=>q.txt);if(mk.length)h+='<br>'+mk.join('<br>');
      tip.innerHTML=h;tip.style.display='block';const tw=tip.offsetWidth;tip.style.left=(x+14+tw>W-padR?x-14-tw:x+14)+'px';tip.style.top='12px';}else tip.style.display='none';
    self._geo={st,end,cw};
  };
  canvas.addEventListener('mousemove',e=>{const r=canvas.getBoundingClientRect(),x=e.clientX-r.left;
    if(drag){const g=self._geo;const shift=Math.round((drag.x-x)/g.cw);self.view.end=clamp(drag.end+shift,self.view.count,self.data.length);if(self.view.end>=self.data.length)self.view.end=null;}
    const g=self._geo;if(g)hover=g.st+Math.floor((x-4)/g.cw);self.draw();});
  canvas.addEventListener('mouseleave',()=>{hover=-1;drag=null;self.draw();});
  canvas.addEventListener('mousedown',e=>{drag={x:e.clientX-canvas.getBoundingClientRect().left,end:self._end};});
  window.addEventListener('mouseup',()=>{drag=null;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();self.view.count=clamp(Math.round(self.view.count*(e.deltaY>0?1.15:.87)),20,Math.max(20,self.data.length));self.draw();},{passive:false});
  let tx=null;canvas.addEventListener('touchstart',e=>{tx={x:e.touches[0].clientX,end:self._end};},{passive:true});
  canvas.addEventListener('touchmove',e=>{if(!tx||!self._geo)return;const shift=Math.round((tx.x-e.touches[0].clientX)/self._geo.cw);self.view.end=clamp(tx.end+shift,self.view.count,self.data.length);if(self.view.end>=self.data.length)self.view.end=null;self.draw();},{passive:true});
  new ResizeObserver(()=>{size();self.draw();}).observe(canvas.parentElement);
  return self;
}
const decOf=()=>SYM[CFG.strat.sym].dec;
const btChart=CandleChart($('#btChart'),$('#btTip'),{rsi:true,dec:decOf,count:160});
const liveChart=CandleChart($('#liveChart'),$('#liveTip'),{rsi:true,dec:decOf,count:110});

function drawEquity(){
  const cv=$('#eqChart'),ctx=cv.getContext('2d'),r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;cv.width=r.width*dpr;cv.height=r.height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
  const W=r.width,H=r.height;ctx.clearRect(0,0,W,H);if(!BT)return;const a=BT.curve,dd=BT.dds,padR=64,eqH=H*.68;
  let lo=Math.min(...a),hi=Math.max(...a);const m=(hi-lo)*.1||10;lo-=m;hi+=m;const X=i=>4+i/(a.length-1)*(W-padR-8),Y=v=>8+(hi-v)/(hi-lo)*(eqH-12);
  ctx.font='11px JetBrains Mono, monospace';ctx.textBaseline='middle';
  [lo+m,10000,hi-m].forEach(v=>{ctx.strokeStyle=v===10000?'#2a3a4d':'#18232f';ctx.setLineDash(v===10000?[4,4]:[]);ctx.beginPath();ctx.moveTo(0,Y(v));ctx.lineTo(W-padR,Y(v));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#5f7187';ctx.fillText('$'+fmt(v,0),W-padR+6,Y(v));});
  const grad=ctx.createLinearGradient(0,0,0,eqH);grad.addColorStop(0,'rgba(45,212,191,.28)');grad.addColorStop(1,'rgba(45,212,191,0)');
  ctx.beginPath();a.forEach((v,i)=>i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v)));ctx.lineTo(X(a.length-1),eqH);ctx.lineTo(X(0),eqH);ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();a.forEach((v,i)=>i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v)));ctx.strokeStyle='#2dd4bf';ctx.lineWidth=1.8;ctx.stroke();ctx.lineWidth=1;
  const y0=eqH+8,dh=H-y0-4,mx=Math.max(CFG.risk.dd,...dd);ctx.fillStyle='rgba(244,63,94,.55)';
  dd.forEach((v,i)=>{const h=v/mx*dh;ctx.fillRect(X(i),y0,Math.max(1,(W-padR)/a.length),h);});
  const ly=y0+CFG.risk.dd/mx*dh;ctx.strokeStyle='#fb7185';ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(0,ly);ctx.lineTo(W-padR,ly);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#fb7185';ctx.fillText('Límite DD '+CFG.risk.dd+'%',8,ly-8);ctx.fillStyle='#5f7187';ctx.fillText('Drawdown',8,y0+8);
}

function renderBacktest(){
  const s=BT.stats,k=$('#btKpis');
  const pf=s.pf===Infinity?'∞':fmt(s.pf);
  k.innerHTML=[
    ['Resultado neto',(s.net>=0?'+':'')+fmt(s.net)+'%',s.net>=0?'pos':'neg','sobre $10.000 ficticios'],
    ['Operaciones',s.trades,'',BT.sigs.length+' señales'],
    ['Acierto',fmt(s.win,1)+'%','',''],
    ['Profit factor',pf,'',''],
    ['Drawdown máx.',fmt(s.dd,2)+'%',s.dd>=CFG.risk.dd?'neg':'','límite '+CFG.risk.dd+'%'],
    ['R medio',(s.avgR>=0?'+':'')+fmt(s.avgR),s.avgR>=0?'pos':'neg',BT.halted?'bot detenido por DD':'riesgo '+CFG.risk.risk+'% por op.']
  ].map(([l,v,c,sub])=>`<div class="kpi"><div class="kpi-l">${l}</div><div class="kpi-v mono ${c}">${v}</div><div class="kpi-s">${sub}</div></div>`).join('');
  const marks=[],dec=decOf();
  BT.trades.forEach(t=>{marks.push({i:t.i0,p:t.side>0?BT.c[t.i0].l:BT.c[t.i0].h,kind:t.side>0?'up':'down',col:t.side>0?'#22c55e':'#f43f5e',txt:'#'+t.n+' '+(t.side>0?'Compra':'Venta')+' '+t.pi.toFixed(dec)});
    marks.push({i:t.i1,p:t.po,kind:'dot',col:t.pl>=0?'#2dd4bf':'#fb7185',txt:'#'+t.n+' Cierre '+t.why+' '+sgn(t.pl)+' $'});});
  Object.assign(btChart,{data:BT.c,ind:BT.ind,marks,lines:[],halt:BT.halted?BT.haltAt:null});btChart.view.end=null;btChart.draw();
  $('#btLegend').innerHTML=legendHtml()+'<span><i style="background:#22c55e;height:8px;width:8px;border-radius:2px"></i>Entrada larga</span><span><i style="background:#f43f5e;height:8px;width:8px;border-radius:2px"></i>Entrada corta</span><span><i style="background:#2dd4bf;height:8px;width:8px;border-radius:50%"></i>Cierre</span>';
  drawEquity();
  $('#btTable tbody').innerHTML=BT.trades.length?BT.trades.slice().reverse().map(t=>`<tr><td>${t.n}</td><td><span class="tag ${t.side>0?'long':'short'}">${t.side>0?'Largo':'Corto'}</span></td><td>${tstr(t.ti)}</td><td class="r mono">${t.pi.toFixed(dec)}</td><td>${tstr(t.to)}</td><td class="r mono">${t.po.toFixed(dec)}</td><td>${t.why}</td><td class="r mono">${fmt(t.qty,t.qty<10?4:2)}</td><td class="r mono ${t.pl>=0?'pos':'neg'}">${sgn(t.pl)}</td><td class="r mono ${t.R>=0?'pos':'neg'}">${sgn(t.R)}</td></tr>`).join(''):'<tr><td colspan="10" class="empty">Sin operaciones con esta configuración. Pruebe otra semilla o parámetros.</td></tr>';
  const sp=BT.sigs.slice(-8).reverse();
  $('#sigPreview').innerHTML=sp.length?sp.map(s=>`<li><span class="t">${tstr(s.t).slice(6)}</span><span class="tag ${s.s>0?'long':'short'}">${s.s>0?'COMPRA':'VENTA'}</span><span class="mono">${s.px.toFixed(dec)}</span><span class="muted tiny">vela ${tstr(s.t)} UTC</span></li>`).join(''):'<li class="empty">Ninguna señal en los datos actuales.</li>';
}
function legendHtml(){return `<span><i style="background:#60a5fa"></i>EMA ${CFG.strat.fast}</span><span><i style="background:#f59e0b"></i>EMA ${CFG.strat.slow}</span><span><i style="background:#a78bfa"></i>RSI ${CFG.strat.rsiLen}</span>`;}

/* ---------- Conectores simulados ---------- */
const ACC=[
  {id:'MT5-A',name:'MetaTrader 5',sub:'Cuenta demo 5012 · bróker ficticio',ic:'#i-mt5',plat:'MT5',sym:{'SIM-100':'SIM100.demo','XSIM/USD':'XSIMUSD.demo','SIMCOIN-PERP':'SIMCOIN.demo'},order:'Mercado',fill:'IOC',lat:[40,120],eq0:10000},
  {id:'BNB-F',name:'Binance Futures',sub:'Testnet simulada · subcuenta 1',ic:'#i-exchange',plat:'Binance',sym:{'SIM-100':'SIM100USDT','XSIM/USD':'XSIMUSDT','SIMCOIN-PERP':'SIMCOINUSDT'},order:'MARKET',fill:'-',lat:[60,180],eq0:10000},
  {id:'BGX-F',name:'BingX Futures',sub:'Entorno simulado · perpetuos',ic:'#i-layers',plat:'BingX',sym:{'SIM-100':'SIM100-USDT','XSIM/USD':'XSIM-USDT','SIMCOIN-PERP':'SIMCOIN-USDT'},order:'MARKET',fill:'-',lat:[80,220],eq0:10000}
];
ACC.forEach(a=>Object.assign(a,{enabled:true,status:'off',lat0:0,pos:null,eq:a.eq0,realized:0,fails:0,retry:0,seen:new Set(),orders:0,flaky:false,peak:a.eq0,halted:false}));
const STATUS={off:['Desconectado',''],connecting:['Conectando...','warn'],on:['Conectado','on'],sync:['Sincronizando posiciones','warn'],err:['Error de conexión','err'],paused:['Pausado','']};
function setStatus(a,s){a.status=s;renderConn();renderAccounts();}
function connect(a,isRetry){
  if(!a.enabled)return; setStatus(a,'connecting'); log('system',a.id,isRetry?'Reintento de conexión #'+a.retry+' (simulado)':'Conectando a '+a.name+' (simulado)');
  setTimeout(()=>{ if(!a.enabled)return; if(a.flaky&&Math.random()<.5){fail(a,'Tiempo de espera agotado');return;}
    setStatus(a,'sync'); log('system',a.id,'Leyendo posiciones reales del bróker antes de operar (simulado)');
    setTimeout(()=>{ if(!a.enabled)return; a.retry=0; a.lat0=Math.round(a.lat[0]+Math.random()*(a.lat[1]-a.lat[0])); setStatus(a,'on'); log('system',a.id,'Conectado. Posiciones sincronizadas: '+(a.pos?'1 abierta':'ninguna')+'. Latencia '+a.lat0+' ms');},600);
  },700+Math.random()*500);
}
function fail(a,why){a.fails++;a.retry++;setStatus(a,'err');log('error',a.id,why+'. Las demás cuentas siguen operando.');alertEv('error',a,{why});
  const wait=Math.min(16,2**(a.retry-1))*1000; log('system',a.id,'Reconexión automática en '+wait/1000+' s (backoff exponencial)');
  clearTimeout(a._rt);a._rt=setTimeout(()=>connect(a,true),wait);}
function renderConn(){
  $('#connGrid').innerHTML=ACC.map(a=>{const[s,c]=STATUS[a.enabled?a.status:'paused'];return `<div class="conn ${a.status==='err'?'err':(c==='warn'?'warn':'')}" data-id="${a.id}">
    <div class="conn-top"><div class="conn-ic"><svg><use href="${a.ic}"/></svg></div><div><div class="conn-name">${a.name}</div><div class="conn-sub">${a.sub}</div></div><span class="sim">SIMULADO</span></div>
    <div class="row gap" style="justify-content:space-between"><span class="status"><span class="dot ${c}"></span>${s}</span><label class="switch" title="Activar / desactivar cuenta"><input type="checkbox" data-act="toggle" ${a.enabled?'checked':''}><span></span></label></div>
    <div class="conn-stats"><div><span>Latencia</span><b>${a.status==='on'?a.lat0+' ms':'-'}</b></div><div><span>Órdenes</span><b>${a.orders}</b></div><div><span>Fallos</span><b>${a.fails}</b></div></div>
    <div class="conn-actions"><button class="btn ghost" data-act="connect" ${a.status==='on'||!a.enabled?'disabled':''}><svg class="ic"><use href="#i-plug"/></svg>Conectar</button><button class="btn danger" data-act="drop" ${a.status!=='on'?'disabled':''}><svg class="ic"><use href="#i-bolt"/></svg>Simular caída</button>
    <label class="check tiny" style="margin-left:auto"><input type="checkbox" data-act="flaky" ${a.flaky?'checked':''}> Red inestable</label></div></div>`;}).join('');
  $('#mapTable tbody').innerHTML=ACC.map(a=>`<tr><td>${a.id}</td><td>${a.plat}</td><td class="mono">${CFG.strat.sym}</td><td class="mono">${a.sym[CFG.strat.sym]}</td><td>${a.order}</td><td>${a.fill}</td><td class="r mono">${a.lat[0]}-${a.lat[1]} ms</td></tr>`).join('');
  const on=ACC.filter(a=>a.status==='on'&&a.enabled).length;$('#kConn').textContent=on+' / '+ACC.length;
}
$('#connGrid').addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b||b.tagName==='INPUT')return;const a=ACC.find(x=>x.id===b.closest('.conn').dataset.id);
  if(b.dataset.act==='connect')connect(a);if(b.dataset.act==='drop')fail(a,'Conexión perdida (caída simulada)');});
$('#connGrid').addEventListener('change',e=>{const i=e.target;const a=ACC.find(x=>x.id===i.closest('.conn').dataset.id);
  if(i.dataset.act==='toggle'){a.enabled=i.checked;clearTimeout(a._rt);if(!a.enabled){a.status='off';log('system',a.id,'Cuenta desactivada por el usuario');renderConn();renderAccounts();}else connect(a);}
  if(i.dataset.act==='flaky'){a.flaky=i.checked;log('system',a.id,'Red inestable '+(a.flaky?'activada':'desactivada')+' (prueba)');}});

/* ---------- Paper trading en vivo ---------- */
const LIVE={c:[],gen:null,timer:null,running:false,speed:1,tick:0,ticksPerBar:8,ind:null,lastSig:null,marks:[],startEq:0};
function initLive(){
  const st=CFG.strat; const hist=genSeries(CFG.seed+7,st.sym,st.tf,160); const last=hist[hist.length-1];
  LIVE.gen=makeGen(CFG.seed+99,st.sym,st.tf,last.c,last.t+st.tf*60000); LIVE.c=hist; LIVE.marks=[]; LIVE.lastSig=null;
  LIVE.forming=null; newBar(); recalcLive(); liveChart.view.end=null;
  $('#liveSym').textContent=st.sym;$('#liveTf').textContent=({5:'M5',15:'M15',60:'H1',240:'H4'})[st.tf];
}
function newBar(){const k=LIVE.gen.next();LIVE.target=k;const o=LIVE.c[LIVE.c.length-1].c;LIVE.forming={t:k.t,o,h:o,l:o,c:o,v:0};LIVE.c.push(LIVE.forming);LIVE.tick=0;}
function recalcLive(){LIVE.ind=indicators(LIVE.c,CFG.strat);liveChart.data=LIVE.c;liveChart.ind=LIVE.ind;liveChart.marks=LIVE.marks;
  const a=ACC.find(x=>x.pos&&x.enabled);liveChart.lines=a?[{y:a.pos.sl,col:'#f43f5e',dash:true,label:'SL '+a.id},{y:a.pos.tp,col:'#22c55e',dash:true,label:'TP '+a.id}]:[];liveChart.draw();}
function step(){
  const f=LIVE.forming,T=LIVE.target,r=LIVE.gen.rand; LIVE.tick++;
  const frac=LIVE.tick/LIVE.ticksPerBar; const px=f.o+(T.c-f.o)*frac+(T.c*0.0006)*(r()-.5)*(1-frac);
  f.c=LIVE.tick>=LIVE.ticksPerBar?T.c:px; f.h=Math.max(f.h,f.c,LIVE.tick>=LIVE.ticksPerBar?T.h:f.c); f.l=Math.min(f.l,f.c,LIVE.tick>=LIVE.ticksPerBar?T.l:f.c); f.v+=Math.round(T.v/LIVE.ticksPerBar);
  // gestión intravela de SL/TP por cuenta
  ACC.forEach(a=>{if(a.pos&&a.status==='on'&&a.enabled){const x=checkExit(a.pos,{o:f.c,h:f.c,l:f.c,c:f.c},CFG.risk);if(x)closeAcc(a,x.px,x.why);}});
  if(LIVE.tick>=LIVE.ticksPerBar){onBarClose(LIVE.c.length-1);newBar();}
  recalcLive(); renderAccounts(); updateKpis();
}
function onBarClose(i){
  LIVE.ind=indicators(LIVE.c,CFG.strat); const k=LIVE.c[i]; const s=signalAt(i,LIVE.ind,CFG.strat);
  ACC.forEach(a=>{if(!a.pos||!a.enabled)return;const eqm=a.eq+pnlOf(a.pos,k.c);a.peak=Math.max(a.peak,eqm);if(!a.halted&&(a.peak-eqm)/a.peak*100>=CFG.risk.dd){closeAcc(a,k.c,'Límite DD');a.halted=true;log('error',a.id,'Drawdown máximo '+CFG.risk.dd+'% alcanzado. Cuenta detenida.');alertEv('dd',a,{});}});
  if(!s)return;
  const sig={id:CFG.strat.sym.replace(/[^A-Z0-9]/gi,'')+'-'+k.t.toString(36).toUpperCase(),side:s,px:k.c,t:k.t,i};
  LIVE.lastSig=sig; LIVE.marks.push({i,p:s>0?k.l:k.h,kind:s>0?'up':'down',col:s>0?'#22c55e':'#f43f5e',txt:'Señal '+(s>0?'COMPRA':'VENTA')+' '+sig.id});
  log('signal','-','Señal '+(s>0?'COMPRA':'VENTA')+' confirmada al cierre de vela '+tstr(k.t)+' UTC a '+k.c.toFixed(decOf()),sig.id); alertEv('signal',null,{sig});
  route(sig,false);
}
function route(sig,resend){
  ACC.forEach(a=>{
    const oid=sig.id+'-'+a.id;
    if(!a.enabled){log('system',a.id,'Cuenta desactivada: señal no enviada',oid);return;}
    if(a.halted){log('system',a.id,'Cuenta detenida por drawdown: señal ignorada',oid);return;}
    if(CFG.strat.dedup&&a.seen.has(oid)){log('system',a.id,'Duplicado ignorado: la orden de esta vela ya existe',oid);return;}
    if(a.status!=='on'){log('error',a.id,'Orden no enviada: conector '+STATUS[a.status][0].toLowerCase()+'. Se reevaluará en la próxima vela',oid);return;}
    if(!allowedTime(sig.t+CFG.strat.tf*60000,CFG.risk)){log('system',a.id,'Fuera del horario de operación: sin orden',oid);return;}
    a.seen.add(oid);
    const lat=Math.round(a.lat[0]+Math.random()*(a.lat[1]-a.lat[0]));
    setTimeout(()=>{
      if(a.status!=='on'){log('error',a.id,'Orden rechazada: conexión perdida durante el envío',oid);a.seen.delete(oid);return;}
      if(a.flaky&&Math.random()<.35){fail(a,'Timeout al enviar la orden');a.seen.delete(oid);return;}
      const live=LIVE.forming?LIVE.forming.c:sig.px; const px=live*(1+SLIP*sig.side);
      if(a.pos&&a.pos.side===sig.side){log('system',a.id,'Ya hay posición en la misma dirección: sin orden',oid);return;}
      if(a.pos)closeAcc(a,live*(1-SLIP*a.pos.side),'Señal contraria');
      a.pos=openPos(sig.side,px,a.eq,CFG.risk,Date.now(),LIVE.c.length-1); a.orders++;
      const qd=a.pos.qty<10?4:2;
      log('order',a.id,(sig.side>0?'COMPRA':'VENTA')+' '+fmt(a.pos.qty,qd)+' '+a.sym[CFG.strat.sym]+' a '+px.toFixed(decOf())+' ('+a.order+(a.fill!=='-'?' / '+a.fill:'')+', '+lat+' ms). SL '+a.pos.sl.toFixed(decOf())+' TP '+a.pos.tp.toFixed(decOf()),oid);
      alertEv('entry',a,{px});renderConn();renderAccounts();recalcLive();
    },lat/LIVE.speed);
  });
  if(resend)toast('Señal reenviada: revise el registro para ver cómo se ignoran los duplicados.');
}
function closeAcc(a,px,why){const pl=pnlOf(a.pos,px);a.eq+=pl;a.realized+=pl;log('order',a.id,'Cierre '+(a.pos.side>0?'largo':'corto')+' por '+why+' a '+px.toFixed(decOf())+' · P/L '+sgn(pl)+' $');alertEv('exit',a,{px,why,pl});
  LIVE.marks.push({i:LIVE.c.length-1,p:px,kind:'dot',col:pl>=0?'#2dd4bf':'#fb7185',txt:a.id+' cierre '+why+' '+sgn(pl)+' $'});a.pos=null;}
function renderAccounts(){
  const dec=decOf(),last=LIVE.forming?LIVE.forming.c:0;
  $('#accTable tbody').innerHTML=ACC.map(a=>{const[s,c]=STATUS[a.enabled?a.status:'paused'];const fl=a.pos?pnlOf(a.pos,last):0;
    return `<tr><td><b>${a.id}</b><div class="tiny muted">${a.plat}</div></td><td><span class="status"><span class="dot ${c}"></span>${a.halted?'Detenida (DD)':s}</span></td>
    <td>${a.pos?`<span class="tag ${a.pos.side>0?'long':'short'}">${a.pos.side>0?'Largo':'Corto'} ${fmt(a.pos.qty,a.pos.qty<10?4:2)}</span>`:'<span class="tag flat">Sin posición</span>'}</td>
    <td class="r mono">${a.pos?a.pos.entry.toFixed(dec):'-'}</td><td class="r mono">${a.pos?a.pos.sl.toFixed(dec)+' / '+a.pos.tp.toFixed(dec):'-'}</td>
    <td class="r mono ${fl>0?'pos':fl<0?'neg':''}">${a.pos?sgn(fl):'-'}</td><td class="r mono">${money(a.eq+fl)}</td></tr>`;}).join('');
}
function updateKpis(){
  const last=LIVE.forming?LIVE.forming.c:0;let eq=0,pnl=0,open=0;
  ACC.forEach(a=>{const fl=a.pos?pnlOf(a.pos,last):0;eq+=a.eq+fl;pnl+=a.realized+fl;if(a.pos)open++;});
  $('#kEquity').textContent=money(eq);const kp=$('#kPnl');kp.textContent=(pnl>=0?'+':'-')+'$'+fmt(Math.abs(pnl));kp.className='kpi-v mono '+(pnl>0?'pos':pnl<0?'neg':'');
  $('#kPos').textContent=open;$('#kPosS').textContent=open?ACC.filter(a=>a.pos).map(a=>a.id).join(', '):'en espera de señal';
}
function setRunning(on){
  LIVE.running=on;clearInterval(LIVE.timer);
  if(on){LIVE.timer=setInterval(step,420/LIVE.speed);ACC.forEach(a=>{if(a.enabled&&(a.status==='off'))connect(a);});log('system','-','Motor iniciado en modo paper trading ('+CFG.strat.sym+', '+$('#liveTf').textContent+')');}
  else log('system','-','Motor pausado por el usuario');
  $('#btnRun').innerHTML=on?'<svg class="ic"><use href="#i-pause"/></svg><span>Pausar</span>':'<svg class="ic"><use href="#i-play"/></svg><span>Iniciar</span>';
  $('#engineDot').className='dot '+(on?'on':'');$('#engineState').textContent=on?'Motor en marcha · paper':'Motor detenido';
}
$('#btnRun').onclick=()=>setRunning(!LIVE.running);
$('#btnResend').onclick=()=>{if(!LIVE.lastSig){toast('Aún no hay señales. Inicie el motor y espere a la primera.');return;}log('system','-','Reenvío manual de la señal '+LIVE.lastSig.id+' (prueba de idempotencia)',LIVE.lastSig.id);route(LIVE.lastSig,true);};
$$('#speedSeg button').forEach(b=>b.onclick=()=>{$$('#speedSeg button').forEach(x=>x.classList.remove('on'));b.classList.add('on');LIVE.speed=+b.dataset.speed;if(LIVE.running){clearInterval(LIVE.timer);LIVE.timer=setInterval(step,420/LIVE.speed);}});

/* ---------- Registro ---------- */
const LOG=[];let logFilter='all';
const TYPE={order:'Orden',signal:'Señal',system:'Sistema',error:'Error'};
function log(type,acc,msg,id){LOG.push({time:nowStr(),type,acc,msg,id:id||''});if(LOG.length>800)LOG.shift();renderLog();}
function renderLog(){
  const rows=LOG.filter(l=>logFilter==='all'||l.type===logFilter).slice(-300).reverse();
  $('#logTable tbody').innerHTML=rows.length?rows.map(l=>`<tr><td>${l.time}</td><td><span class="tag ${l.type}">${TYPE[l.type]}</span></td><td>${esc(l.acc)}</td><td style="white-space:normal">${esc(l.msg)}</td><td class="muted">${esc(l.id)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">Sin eventos todavía.</td></tr>';
  $('#miniFeed').innerHTML=LOG.length?LOG.slice(-9).reverse().map(l=>`<li><span class="t">${l.time}</span><span class="tag ${l.type}">${TYPE[l.type]}</span><span>${l.acc!=='-'?'<b>'+esc(l.acc)+'</b> ':''}${esc(l.msg)}</span></li>`).join(''):'<li class="empty">Pulse Iniciar para arrancar el motor de paper trading.</li>';
}
$$('#logFilter button').forEach(b=>b.onclick=()=>{$$('#logFilter button').forEach(x=>x.classList.remove('on'));b.classList.add('on');logFilter=b.dataset.f;renderLog();});
function csv(name,rows){const s=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+s],{type:'text/csv'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('#btnCsvLog').onclick=()=>csv('registro_demo_simulado.csv',[['hora','tipo','cuenta','mensaje','id']].concat(LOG.map(l=>[l.time,TYPE[l.type],l.acc,l.msg,l.id])));
$('#btnCsvBt').onclick=()=>csv('backtest_demo_simulado.csv',[['n','lado','entrada_utc','precio_entrada','salida_utc','precio_salida','motivo','tamano','pl_usd','r']].concat(BT.trades.map(t=>[t.n,t.side>0?'largo':'corto',tstr(t.ti),t.pi,tstr(t.to),t.po,t.why,t.qty.toFixed(6),t.pl.toFixed(2),t.R.toFixed(2)])));

/* ---------- Alertas (solo vista previa) ---------- */
const ALERTS=[];let unseen=0;
function alertEv(ev,a,d){
  const on=$$('.alEv').filter(x=>x.checked).map(x=>x.value);if(!on.includes(ev))return;
  const dec=decOf(),sym=CFG.strat.sym;let title,body;
  if(ev==='entry'){title=(a.pos.side>0?'Compra':'Venta')+' abierta · '+a.id;body=`Cuenta: ${a.id} (${a.plat})\nSímbolo: ${a.sym[sym]}\nLado: ${a.pos.side>0?'LARGO':'CORTO'}  Tamaño: ${fmt(a.pos.qty,a.pos.qty<10?4:2)}\nEntrada: ${d.px.toFixed(dec)}\nSL: ${a.pos.sl.toFixed(dec)}  TP: ${a.pos.tp.toFixed(dec)}`;}
  else if(ev==='exit'){title='Posición cerrada ('+d.why+') · '+a.id;body=`Cuenta: ${a.id}\nSalida: ${d.px.toFixed(dec)}\nResultado: ${sgn(d.pl)} $ (simulado)`;}
  else if(ev==='error'){title='Conector con error · '+a.id;body=`Cuenta: ${a.id} (${a.plat})\nMotivo: ${d.why}\nAcción: reconexión automática. Las demás cuentas siguen operando.`;}
  else if(ev==='dd'){title='Drawdown máximo alcanzado · '+a.id;body=`Cuenta: ${a.id}\nLímite: ${CFG.risk.dd}%\nAcción: posiciones cerradas y cuenta detenida.`;}
  else if(ev==='signal'){title='Señal '+(d.sig.side>0?'COMPRA':'VENTA')+' · '+sym;body=`Vela: ${tstr(d.sig.t)} UTC (cerrada)\nPrecio: ${d.sig.px.toFixed(dec)}\nID: ${d.sig.id}`;}
  else{title='Alerta de prueba';body='Este es un mensaje de prueba generado por la demo.\nNo se ha enviado a ningún destino.';}
  ALERTS.unshift({title,body,ev,acc:a?a.id:'-',time:nowStr()});if(ALERTS.length>60)ALERTS.pop();
  if(!$('#tab-alertas').classList.contains('active')){unseen++;const b=$('#alertBadge');b.textContent=unseen;b.style.display='inline-block';}
  renderAlerts();
}
function renderAlerts(){
  const ch=$('#alChannel').value;$('#alCount').textContent=ALERTS.length+' alertas en vista previa';
  if(!ALERTS.length){$('#alertList').innerHTML='<p class="muted empty">Inicie el motor en el Panel en vivo o genere una alerta de prueba.</p>';return;}
  $('#alertList').innerHTML=ALERTS.map(al=>{
    if(ch==='telegram')return `<div class="msg tg"><div class="mh"><span>Vantaro Quant Bot (vista previa)</span><span>${al.time}</span></div><div class="subj">${esc(al.title)}</div><pre>${esc(al.body)}</pre></div>`;
    if(ch==='email')return `<div class="msg em"><div class="mh"><span>Para: operaciones@vantaro.example (ficticio)</span><span>${al.time}</span></div><div class="subj">[Vantaro Quant] ${esc(al.title)}</div><pre>${esc(al.body)}\n\n-- Mensaje automático de la demo. No enviado.</pre></div>`;
    return `<div class="msg wh"><div class="mh"><span>POST https://hooks.example/vantaro (ficticio)</span><span>${al.time}</span></div><pre>${esc(JSON.stringify({event:al.ev,account:al.acc,title:al.title,detail:al.body.split('\n'),simulated:true},null,2))}</pre></div>`;}).join('');
}
$('#alChannel').onchange=renderAlerts;
$('#btnTestAlert').onclick=()=>{ALERTS.unshift({title:'Alerta de prueba',body:'Este es un mensaje de prueba generado por la demo.\nNo se ha enviado a ningún destino.',ev:'test',acc:'-',time:nowStr()});renderAlerts();toast('Alerta de prueba generada (solo vista previa).');};
$('#btnClearAlerts').onclick=()=>{ALERTS.length=0;renderAlerts();};

/* ---------- Formularios ---------- */
function loadForms(){
  const s=CFG.strat,r=CFG.risk;$('#stType').value=s.type;$('#stFast').value=s.fast;$('#stSlow').value=s.slow;$('#stRsi').value=s.rsiLen;$('#stLow').value=s.low;$('#stHigh').value=s.high;$('#stDir').value=s.dir;$('#stSym').value=s.sym;$('#stTf').value=s.tf;$('#stDedup').checked=s.dedup;
  $('#rkRisk').value=r.risk;$('#rkSl').value=r.sl;$('#rkTp').value=r.tp;$('#rkDd').value=r.dd;$('#rkLev').value=r.lev;$('#rkTrail').checked=r.trail;$('#rkTrailPct').value=r.trailPct;$('#rkH1').value=r.h1;$('#rkH2').value=r.h2;$('#rkWeekend').checked=r.weekend;
  $('#btSeed').value=CFG.seed;$('#btBars').value=CFG.bars;
}
function readStrat(){const s=CFG.strat;const prevSym=s.sym,prevTf=s.tf;s.type=$('#stType').value;s.fast=clamp(+$('#stFast').value||9,2,100);s.slow=clamp(+$('#stSlow').value||21,3,300);if(s.slow<=s.fast){s.slow=s.fast+1;$('#stSlow').value=s.slow;}
  s.rsiLen=clamp(+$('#stRsi').value||14,2,50);s.low=clamp(+$('#stLow').value||30,5,50);s.high=clamp(+$('#stHigh').value||70,50,95);s.dir=$('#stDir').value;s.sym=$('#stSym').value;s.tf=+$('#stTf').value;s.dedup=$('#stDedup').checked;return prevSym!==s.sym||prevTf!==s.tf;}
function readRisk(){const r=CFG.risk;r.risk=+$('#rkRisk').value;r.sl=+$('#rkSl').value;r.tp=+$('#rkTp').value;r.dd=+$('#rkDd').value;r.lev=+$('#rkLev').value;r.trail=$('#rkTrail').checked;r.trailPct=+$('#rkTrailPct').value;r.h1=clamp(+$('#rkH1').value,0,23);r.h2=clamp(+$('#rkH2').value,r.h1+1,24);r.weekend=$('#rkWeekend').checked;}
function renderRiskUi(){
  const r=CFG.risk;$('#oRisk').textContent=r.risk+'%';$('#oSl').textContent=r.sl+'%';$('#oTp').textContent=r.tp+'%';$('#oDd').textContent=r.dd+'%';$('#oLev').textContent=r.lev+'x';$('#oTrail').textContent=r.trailPct+'%';
  $('#trailRow').style.opacity=r.trail?1:.4;
  const eq=+$('#calcEq').value||0,px=+$('#calcPx').value||0,slD=px*r.sl/100;let q=slD?(eq*r.risk/100)/slD:0;const capped=q>eq*r.lev/px;if(px)q=Math.min(q,eq*r.lev/px);
  $('#calcOut').innerHTML=`<div><span>Riesgo en dinero</span><b>${money(eq*r.risk/100)}</b></div><div><span>Tamaño de posición</span><b>${fmt(q,q<10?4:2)}</b></div><div><span>Stop loss (largo)</span><b>${fmt(px-slD,px<10?5:2)}</b></div><div><span>Take profit (largo)</span><b>${fmt(px*(1+r.tp/100),px<10?5:2)}</b></div><div><span>Valor nominal</span><b>${money(q*px)}${capped?' (tope)':''}</b></div><div><span>Relación beneficio / riesgo</span><b>${fmt(r.tp/r.sl)} : 1</b></div>`;
  const ck='<svg class="ic"><use href="#i-shield"/></svg>';
  $('#rulesList').innerHTML=[`Riesgo fijo de ${r.risk}% del capital por operación`,`Stop loss ${r.sl}% y take profit ${r.tp}% en cada orden`,r.trail?`Trailing stop a ${r.trailPct}% del mejor precio`:'Trailing stop desactivado',`Si el drawdown llega al ${r.dd}%, la cuenta cierra posiciones y se detiene`,`Exposición máxima ${r.lev}x el capital`,`Opera de ${pad(r.h1)}:00 a ${pad(r.h2%24)}:00 UTC${r.weekend?', fines de semana incluidos':', sin fines de semana'}`,'Señales solo al cierre de vela, con ID único por vela y cuenta'].map(t=>`<li>${ck}<span>${t}</span></li>`).join('');
}
function renderCode(){
  const s=CFG.strat,k=t=>`<span class="k">${t}</span>`,n=t=>`<span class="n">${t}</span>`,c=t=>`<span class="c"># ${t}</span>`;
  let body;
  if(s.type==='ema')body=`${k('if')} cruza_arriba(ema(${n(s.fast)}), ema(${n(s.slow)})):  señal = COMPRA\n${k('elif')} cruza_abajo(ema(${n(s.fast)}), ema(${n(s.slow)})): señal = VENTA`;
  else if(s.type==='rsi')body=`${k('if')} rsi(${n(s.rsiLen)}) sale de sobreventa (${n(s.low)}):   señal = COMPRA\n${k('elif')} rsi(${n(s.rsiLen)}) sale de sobrecompra (${n(s.high)}): señal = VENTA`;
  else body=`${k('if')} cruza_arriba(ema(${n(s.fast)}), ema(${n(s.slow)})) ${k('and')} rsi(${n(s.rsiLen)}) > ${n(50)}: señal = COMPRA\n${k('elif')} cruza_abajo(ema(${n(s.fast)}), ema(${n(s.slow)})) ${k('and')} rsi(${n(s.rsiLen)}) < ${n(50)}: señal = VENTA`;
  $('#stratCode').innerHTML=`${c('se evalúa solo cuando la vela '+({5:'M5',15:'M15',60:'H1',240:'H4'})[s.tf]+' ha cerrado')}\n${k('def')} al_cerrar_vela(vela):\n    ${body.replace(/\n/g,'\n    ')}\n    ${k('if')} dirección == "${s.dir==='both'?'ambas':s.dir==='long'?'solo largos':'solo cortos'}" ${k('and')} señal_permitida:\n        id = f"{símbolo}-{vela.hora}-{cuenta}"   ${c('idempotente')}\n        ${k('for')} cuenta ${k('in')} cuentas_activas:          ${c('MT5, Binance, BingX')}\n            enviar_orden(cuenta, señal, riesgo=${n(CFG.risk.risk+'%')}, sl=${n(CFG.risk.sl+'%')}, tp=${n(CFG.risk.tp+'%')})`;
}
$('#btnApplyStrat').onclick=()=>{const changed=readStrat();save();renderCode();runBacktest();if(changed){initLive();renderConn();}else recalcLive();$('#liveLegend').innerHTML=legendHtml();$('#stratSaved').textContent='Guardado '+nowStr();log('system','-','Estrategia actualizada: '+$('#stType').selectedOptions[0].text+' ('+CFG.strat.fast+'/'+CFG.strat.slow+', RSI '+CFG.strat.rsiLen+')');toast('Estrategia aplicada. Backtest recalculado.');};
['#stType','#stFast','#stSlow','#stRsi','#stLow','#stHigh','#stDir'].forEach(id=>$(id).addEventListener('input',()=>{readStrat();renderCode();}));
$$('#tab-riesgo input').forEach(i=>i.addEventListener('input',()=>{readRisk();renderRiskUi();}));
$('#btnApplyRisk').onclick=()=>{readRisk();save();runBacktest();renderCode();log('system','-','Parámetros de riesgo actualizados (riesgo '+CFG.risk.risk+'%, SL '+CFG.risk.sl+'%, TP '+CFG.risk.tp+'%, DD '+CFG.risk.dd+'%)');toast('Riesgo aplicado. Backtest recalculado.');};
$('#btnRunBt').onclick=()=>{CFG.seed=+$('#btSeed').value||1;CFG.bars=+$('#btBars').value;save();runBacktest();toast('Backtest ejecutado con semilla '+CFG.seed+'.');};
$('#btnNewData').onclick=()=>{CFG.seed=Math.floor(Math.random()*99999);$('#btSeed').value=CFG.seed;CFG.bars=+$('#btBars').value;save();runBacktest();toast('Nueva serie ficticia generada (semilla '+CFG.seed+').');};

/* ---------- Navegación ---------- */
const TITLES={panel:['Panel en vivo','Paper trading sobre un instrumento ficticio, con señales solo al cierre de vela.'],estrategia:['Estrategia','Defina la lógica de entrada. Los cambios se prueban al instante en el backtest.'],backtest:['Backtest','Pruebe la estrategia y el riesgo sobre datos de precio ficticios y reproducibles.'],riesgo:['Riesgo','Tamaño de posición, stop loss, take profit y límites de pérdida.'],conectores:['Conectores','MT5, Binance Futures y BingX Futures, simulados y aislados entre sí.'],alertas:['Alertas','Vista previa de las notificaciones. No se envía ningún mensaje.'],registro:['Registro','Todo lo que hace el bot queda registrado y se puede exportar.']};
function go(tab){$$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$$('.tab').forEach(t=>t.classList.toggle('active',t.id==='tab-'+tab));$('#pageTitle').textContent=TITLES[tab][0];$('#pageSub').textContent=TITLES[tab][1];
  if(tab==='alertas'){unseen=0;$('#alertBadge').style.display='none';}
  requestAnimationFrame(()=>{if(tab==='backtest'){btChart.draw();drawEquity();}if(tab==='panel')liveChart.draw();});history.replaceState(null,'','#'+tab);}
$$('#nav button').forEach(b=>b.onclick=()=>go(b.dataset.tab));
$$('[data-goto]').forEach(b=>b.onclick=()=>go(b.dataset.goto));
$$('#modeSeg button').forEach(b=>b.onclick=()=>{if(b.dataset.mode==='live'){toast('El modo real está deshabilitado en esta demo. Solo paper trading.');return;}});
window.addEventListener('resize',()=>drawEquity());
setInterval(()=>{const d=new Date();$('#clock').textContent=pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds())+' UTC';},1000);

/* ---------- Inicio ---------- */
loadForms();readRisk();renderRiskUi();renderCode();runBacktest();initLive();renderConn();renderAccounts();updateKpis();renderLog();renderAlerts();
$('#liveLegend').innerHTML=legendHtml()+'<span><i style="background:#2dd4bf"></i>Precio actual</span><span><i style="background:#f43f5e"></i>SL</span><span><i style="background:#22c55e"></i>TP</span>';
log('system','-','Demo cargada. Todos los datos y conexiones son simulados.');
const h=location.hash.slice(1);if(TITLES[h])go(h);
})();
