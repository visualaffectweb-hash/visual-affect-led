// ============================================================
// engine.js — LED Calculation Engine
// Standalone module — imported by projects.js, proposals.js,
// inventory.js, and any future module needing LED math.
//
// Public API:
//   runEngine(inputs)              → full wall output
//   calcGrid(wFt, hFt, mode)       → panel grid
//   estimatePanels(wFt, hFt, mode) → quick panel count
//   estimatePower(grid, watts, qty) → power + circuits
//   estimateWeight(grid, lbs, qty)  → total weight
//   flybarCols(cols)               → flybar column positions
//   buildBOM(engineOutput, items)  → inventory-matched BOM
//   generateLineItems(bom)         → proposal line items
// ============================================================

// ── CONSTANTS ────────────────────────────────────────────────
const FT2MM = 304.8;
const mm2ft = m => m / 304.8;
const ETH_SIZES   = [1.5, 4, 30, 50, 100, 200, 300]; // ethercon lengths in ft
const POWER_SIZES = [25, 50, 75];                     // edison lengths in ft

// ── MATH HELPERS ─────────────────────────────────────────────
const gcd = (a, b) => { a=Math.abs(a); b=Math.abs(b); while(b) [a,b]=[b,a%b]; return a||1; };
export const simp    = (w, h) => { const g=gcd(w,h); return {w:Math.round(w/g), h:Math.round(h/g)}; };
export const nearAsp = (w, h) => {
  const r=w/h, S=[{n:'16:9',r:16/9},{n:'4:3',r:4/3},{n:'3:2',r:3/2},{n:'21:9',r:21/9},{n:'5:4',r:5/4},{n:'1:1',r:1}];
  let B=S[0],e=1e9; for(const s of S){const d=Math.abs(r-s.r); if(d<e){e=d;B=s;}} return B.n;
};

const slk       = (ft, pct) => ft * (1 + (pct||0) / 100);
const pickEth   = ft => ETH_SIZES.find(l => l >= ft) || ETH_SIZES[ETH_SIZES.length-1];
const pickPower = ft => POWER_SIZES.find(l => l >= ft) || POWER_SIZES[POWER_SIZES.length-1];
const ethLabel   = ft => `${pickEth(ft)}ft ethercon`;
const powerLabel = ft => `${pickPower(ft)}ft edison`;
const vJumper    = i  => i%2===0 ? '4ft white to white' : '4ft blue to blue';

// ── GRID CALCULATION ─────────────────────────────────────────

/**
 * Calculate panel grid for a wall size and mode.
 * mode: 'mixed' | '1000' | '500'
 */
export function calcGrid(wFt, hFt, mode='mixed') {
  const w=wFt*FT2MM, h=hFt*FT2MM, cols=Math.max(1,Math.round(w/500));
  if (mode==='1000') {
    const rows=Math.max(1,Math.round(h/1000));
    return {cols,rows1000:rows,rows500:0,p1000:cols*rows,p500:0,total:cols*rows,widthMm:cols*500,heightMm:rows*1000};
  }
  if (mode==='500') {
    const rows=Math.max(1,Math.round(h/500));
    return {cols,rows1000:0,rows500:rows,p1000:0,p500:cols*rows,total:cols*rows,widthMm:cols*500,heightMm:rows*500};
  }
  // Mixed — find best combo of 1000mm and 500mm rows
  const base=Math.max(0,Math.floor(h/1000));
  const opts=[{r1k:base,r500:0},{r1k:base,r500:1},{r1k:base+1,r500:0}].filter(o=>o.r1k+o.r500>0);
  let best=opts[0], minD=1e12;
  for (const o of opts) { const D=Math.abs(o.r1k*1000+o.r500*500-h); if(D<minD){minD=D;best=o;} }
  return {cols,rows1000:best.r1k,rows500:best.r500,p1000:cols*best.r1k,p500:cols*best.r500,
          total:cols*(best.r1k+best.r500),widthMm:cols*500,heightMm:best.r1k*1000+best.r500*500};
}

/** Quick panel count without full engine run. */
export function estimatePanels(wFt, hFt, mode='mixed') {
  const g=calcGrid(wFt,hFt,mode);
  return {total:g.total, p1000:g.p1000, p500:g.p500, grid:g};
}

/** Estimate power draw and circuits for a wall. */
export function estimatePower(grid, panelWatts=150, qty=1) {
  const totalW = grid.total * qty * panelWatts;
  const circuits = Math.ceil(totalW / 1920) + 1; // 20A@120V derated 80%, +1 spare
  return {totalWatts:totalW, circuits, amps:Math.round(totalW/120*10)/10};
}

/** Estimate total wall weight. */
export function estimateWeight(grid, weightPerPanel=10, qty=1) {
  return {totalLbs: grid.total * qty * weightPerPanel};
}

// ── FLYBAR POSITIONS ─────────────────────────────────────────

export function flybarCols(cols) {
  const res=[];
  if(cols<=0) return res;
  if(cols%2===1){
    const c=Math.floor(cols/2); res.push(c);
    for(let d=2;(c-d)>=0||(c+d)<cols;d+=2){if(c-d>=0)res.push(c-d);if(c+d<cols)res.push(c+d);}
  } else {
    const l=cols/2-1,r=cols/2; res.push(l,r);
    for(let d=2;(l-d)>=0||(r+d)<cols;d+=2){if(l-d>=0)res.push(l-d);if(r+d<cols)res.push(r+d);}
  }
  return res.sort((a,b)=>a-b);
}

// ── DATA CHAIN ROUTING ───────────────────────────────────────

function pxPN(row,g,pitch){return Math.round(500/pitch)*(row<g.rows1000?Math.round(1000/pitch):Math.round(500/pitch));}

function hChains(g,cap,pitch,pxCap){
  const R=g.rows1000+g.rows500,C=g.cols,rpc=Math.max(1,Math.floor(cap/C)),chains=[];
  for(let r0=0;r0<R;){
    let take=Math.min(rpc,R-r0);
    while(take>0){let px=0,ok=true;for(let rr=r0;rr<r0+take&&ok;rr++)for(let c=0;c<C;c++){px+=pxPN(rr,g,pitch);if(px>pxCap){ok=false;break;}}if(ok)break;take--;}
    const nodes=[];
    for(let rr=r0;rr<r0+take;rr++){const ltr=(rr-r0)%2===0;if(ltr)for(let c=0;c<C;c++)nodes.push({col:c,row:rr});else for(let c=C-1;c>=0;c--)nodes.push({col:c,row:rr});}
    chains.push(nodes);r0+=take;
  }
  return chains;
}

function vChains(g,cap,pitch,pxCap){
  const R=g.rows1000+g.rows500,C=g.cols,cpc=Math.max(1,Math.floor(cap/R)),chains=[];
  for(let c0=0;c0<C;){
    let take=Math.min(cpc,C-c0);
    while(take>0){let px=0,ok=true;for(let cc=c0;cc<c0+take&&ok;cc++)for(let r=0;r<R;r++){px+=pxPN(r,g,pitch);if(px>pxCap){ok=false;break;}}if(ok)break;take--;}
    const nodes=[];
    for(let cc=c0;cc<c0+take;cc++){const td=(cc-c0)%2===0;if(td)for(let r=0;r<R;r++)nodes.push({col:cc,row:r});else for(let r=R-1;r>=0;r--)nodes.push({col:cc,row:r});}
    chains.push(nodes);c0+=take;
  }
  return chains;
}

function snakeC(g,pitch,pxCap,cap){
  if(g.total>cap)return null;let px=0;const R=g.rows1000+g.rows500,nodes=[];
  for(let r=0;r<R;r++){const ltr=r%2===0;const cols=ltr?[...Array(g.cols).keys()]:[...Array(g.cols).keys()].reverse();for(const c of cols){px+=pxPN(r,g,pitch);if(px>pxCap)return null;nodes.push({col:c,row:r});}}
  return nodes;
}

function bestDC(g,qty,pitch,pxCap,cap){
  const ec=(g.rows1000===0&&g.rows500>0)?40:cap;
  const sn=snakeC(g,pitch,pxCap,ec);if(sn)return{mode:'single',chains:[sn]};
  const H=hChains(g,ec,pitch,pxCap),V=vChains(g,ec,pitch,pxCap);
  const sc=(ch,q)=>({procs:Math.max(Math.ceil(g.total*q/80),Math.ceil(ch.length*q/4)),ports:ch.length*q});
  const sH=sc(H,qty),sV=sc(V,qty);
  if(qty===1){if(g.total<=80&&H.length<=4)return{mode:'horizontal',chains:H};if(sH.procs<sV.procs)return{mode:'horizontal',chains:H};if(sV.procs<sH.procs)return{mode:'vertical',chains:V};return sH.ports<=sV.ports?{mode:'horizontal',chains:H}:{mode:'vertical',chains:V};}
  if(g.total*qty<=80&&V.length*qty<=4)return{mode:'vertical',chains:V};
  if(sV.procs<sH.procs)return{mode:'vertical',chains:V};if(sH.procs<sV.procs)return{mode:'horizontal',chains:H};
  return sV.ports<sH.ports?{mode:'vertical',chains:V}:{mode:'horizontal',chains:H};
}

// ── POWER CHAIN ROUTING ──────────────────────────────────────

function pwrChains(g,tMax,sMax){
  const out=[],R=g.rows1000+g.rows500,C=g.cols;
  if(g.total<10){const nodes=[];for(let r=0;r<R;r++){const ltr=r%2===0;if(ltr)for(let c=0;c<C;c++)nodes.push({col:c,row:r});else for(let c=C-1;c>=0;c--)nodes.push({col:c,row:r});}out.push(nodes);return out;}
  if(C===1){const buf=[];let u=0;for(let r=0;r<R;r++){buf.push({col:0,row:r});u+=r<g.rows1000?1:.5;if(u+((r+1<R)?(r+1<g.rows1000?1:.5):0)>tMax){out.push(buf.slice());buf.length=0;u=0;}}if(buf.length)out.push(buf.slice());return out;}
  for(let r=0;r<g.rows1000;r++){const row=[];for(let c=0;c<C;c++)row.push({col:c,row:r});for(let i=0;i<row.length;i+=tMax)out.push(row.slice(i,i+tMax));}
  for(let r=0;r<g.rows500;r++){const rr=g.rows1000+r,row=[];for(let c=0;c<C;c++)row.push({col:c,row:rr});for(let i=0;i<row.length;i+=sMax)out.push(row.slice(i,i+sMax));}
  return out;
}

// ── PORT ASSIGNMENT ──────────────────────────────────────────

function asgPorts(chains,qty){
  const out=Array.from({length:qty},()=>[]);const all=[];
  for(let w=0;w<qty;w++)for(const ch of chains)all.push({w,nodes:ch});
  let proc=1,port=1,po=0,pa=0;
  for(const ch of all){const n=ch.nodes.length;if(po>=4||pa+n>80){proc++;port=1;po=0;pa=0;}out[ch.w].push({nodes:ch.nodes,port,proc});port++;po++;pa+=n;}
  return out;
}

// ── CASE PLANNING ────────────────────────────────────────────

function planCases(req,perC,inv,mnS=2,mxS=6){
  if(req<=0)return null;const mxC=Math.floor(inv/perC),base=Math.ceil(req/perC);
  if(!mxC||mxC*perC<req)return{cases:base,filled:base*perC,spares:0};
  let b2=null,bD=1e9;
  for(let k=base;k<=mxC;k++){const sp=k*perC-req,ok=sp>=mnS&&sp<=mxS,d=Math.abs(sp-mnS);if(!b2||(ok&&d<bD)){b2={cases:k,filled:k*perC,spares:sp};bD=d;}}
  return b2||{cases:base,filled:base*perC,spares:base*perC-req};
}

// ── MAIN ENGINE ──────────────────────────────────────────────

/**
 * Run the full LED calculation engine.
 *
 * Required inputs: widthFt, heightFt, panelMode, support, pitch, qty
 * Optional: laptops, cameras, procDist, powerDist, inv1000, inv500,
 *           panel_id, panel_name, panel_power, pxPerPortTarget,
 *           dataMaxChain, pwrTallMax, pwrShortMax, procDrop, slackPct,
 *           panelsPerCase1000, panelsPerCase500, minSparePanels,
 *           maxSparePanels, spareCablesPct, dataCablesPerTrunk,
 *           powerCablesPerTrunk
 */
export function runEngine(I) {
  const g    = calcGrid(I.widthFt, I.heightFt, I.panelMode||'mixed');
  const qty  = Math.max(1, I.qty||1);
  const sup  = I.support||'flown';
  const pitch= I.pitch||3.9;
  const pxCap= I.pxPerPortTarget||650000;
  const cap  = I.dataMaxChain||20;
  const tMax = I.pwrTallMax||12;
  const sMax = I.pwrShortMax||24;
  const drop = I.procDrop||6;
  const pct  = I.slackPct||20;

  const best  = bestDC(g,qty,pitch,pxCap,cap);
  const pCh   = pwrChains(g,tMax,sMax);
  const ports = asgPorts(best.chains,qty);

  let warn='';
  if(sup==='flown'){const t=g.rows1000+g.rows500*.5;if(t>(I.maxTallPerFlownColumn||10))warn=`Flown limit exceeded: ${t} tall (max ${I.maxTallPerFlownColumn||10}).`;}

  const pxW=Math.round(g.widthMm/pitch), pxH=Math.round(g.heightMm/pitch);
  const near=nearAsp(pxW,pxH), si=simp(pxW,pxH);

  // ── Counts ───────────────────────────────────────────────
  const counts={}, add=(k,n=1)=>counts[k]=(counts[k]||0)+n;

  if(g.p1000) add('Panels: 1000x500', g.p1000*qty);
  if(g.p500)  add('Panels: 500x500',  g.p500*qty);

  const pd=I.procDist||0;
  if(pd>0) add(ethLabel(slk(Math.hypot(pd,drop),pct)), best.chains.length*qty);

  best.chains.forEach(ch=>{
    for(let i=0;i<ch.length-1;i++){
      const a=ch[i],b=ch[i+1],dc=Math.abs(b.col-a.col),dr=Math.abs(b.row-a.row);
      let ft;
      if(dc===1&&dr===0)ft=mm2ft(500);
      else if(dc===0&&dr===1)ft=mm2ft(Math.min(a.row,b.row)<g.rows1000?1000:500);
      else ft=mm2ft(Math.hypot(dc*500,(Math.min(a.row,b.row)<g.rows1000?1000:500)*dr));
      add(ethLabel(slk(ft,pct)),qty);
    }
  });

  const lap=I.laptops||0, cam=I.cameras||0;
  if(lap>0){add('HDMI 10ft',lap*2);add('HDMI-SDI converter',lap);}
  if((lap+cam)>0&&I.sdiDist>0)counts['SDI cable (per input)']=`${Math.round(I.sdiDist)}ft × ${lap+cam}`;

  const pwD=I.powerDist||0;
  add('32ft edison to powercon', pCh.length*qty);
  add(pwD>0?powerLabel(pwD):'25ft edison', pCh.length*qty);
  pCh.forEach(ch=>{for(let i=0;i<ch.length-1;i++){const a=ch[i],b=ch[i+1];if(a.row===b.row&&Math.abs(a.col-b.col)===1)add('1.5ft powercon jumper',qty);if(a.col===b.col&&Math.abs(a.row-b.row)===1)add(vJumper(i),qty);}});

  if(sup==='ground'){
    const wFt=g.widthMm/304.8,hFt=g.heightMm/304.8,s=Math.ceil(wFt/4)+1,ar=Math.ceil(hFt/4);
    add('Pipe and base (ground support)',s*qty);add('Rigging arm 4x4 grid',s*ar*qty);
    const stk=g.cols*qty;add('Stacking bars',stk);add('Adjustable feet',stk*2);
  } else {
    const fc=flybarCols(g.cols),fly=fc.length*qty;add('Fly bars',fly);add('Megaclaw',fly);
    const L=g.widthMm/304.8,n10=Math.max(1,Math.ceil(L/10));
    for(let i=0;i<n10;i++){add('Truss 10ft',qty);add('Sched 40 pipe 10ft',qty);}
    add('Swivel cheeseborough',Math.ceil(n10*10/3)*qty);
  }

  const totalP=g.total*qty,tCh=best.chains.length*qty;
  const procs=Math.max(Math.ceil(totalP/80),Math.ceil(tCh/4));
  add('Processors NovaPro HD',procs);
  if(Math.ceil(g.total/80)>1)add('Mosaic mode required per wall',qty);
  if(lap>0)add('Playback laptop',lap);

  const circuits=pCh.length*qty+1;

  // ── Packing ──────────────────────────────────────────────
  const packing={};
  const addPk=(k,q,note='')=>{if(!q)return;packing[k]={qty:(packing[k]?.qty||0)+q,note};};
  const pc1=I.panelsPerCase1000||6,pc5=I.panelsPerCase500||6;
  const mnS=I.minSparePanels||2,mxS=I.maxSparePanels||6;
  const spPct=I.spareCablesPct||20,addSp=v=>v+Math.ceil(v*spPct/100);

  const n1=counts['Panels: 1000x500']||0,n5=counts['Panels: 500x500']||0;
  const pl1=planCases(n1,pc1,I.inv1000||0,mnS,mxS);
  const pl5=planCases(n5,pc5,I.inv500||0,mnS,mxS);
  if(n1>0&&pl1){addPk('Panels 1000x500',pl1.filled,`includes ${pl1.spares} spares`);addPk('Cases Panel 1000x500 6ea',pl1.cases);}
  if(n5>0&&pl5){addPk('Panels 500x500',pl5.filled,`includes ${pl5.spares} spares`);addPk('Cases Panel 500x500 6ea',pl5.cases);}

  ['1.5ft ethercon','4ft ethercon','30ft ethercon','50ft ethercon','100ft ethercon','200ft ethercon','300ft ethercon'].forEach(k=>{if(counts[k])addPk(k,addSp(counts[k]));});
  if(counts['HDMI 10ft'])addPk('HDMI 10ft',addSp(counts['HDMI 10ft']));
  if(counts['HDMI-SDI converter'])addPk('HDMI-SDI converter',counts['HDMI-SDI converter']);
  ['32ft edison to powercon','25ft edison','50ft edison','75ft edison','1.5ft powercon jumper','4ft white to white','4ft blue to blue'].forEach(k=>{if(counts[k])addPk(k,addSp(counts[k]));});
  ['Pipe and base (ground support)','Rigging arm 4x4 grid','Stacking bars','Adjustable feet','Fly bars','Megaclaw','Truss 10ft','Sched 40 pipe 10ft','Swivel cheeseborough','Processors NovaPro HD','Playback laptop','Mosaic mode required per wall'].forEach(k=>{if(counts[k])addPk(k,counts[k]);});

  const dQ=['1.5ft ethercon','4ft ethercon','30ft ethercon','50ft ethercon','100ft ethercon','200ft ethercon','300ft ethercon','HDMI 10ft'].reduce((a,k)=>a+(packing[k]?.qty||0),0);
  const pwQ=['32ft edison to powercon','25ft edison','50ft edison','75ft edison','1.5ft powercon jumper','4ft white to white','4ft blue to blue'].reduce((a,k)=>a+(packing[k]?.qty||0),0);
  if(dQ)addPk('Cases Data cable trunks',Math.ceil(dQ/(I.dataCablesPerTrunk||40)));
  if(pwQ)addPk('Cases Power cable trunks',Math.ceil(pwQ/(I.powerCablesPerTrunk||40)));
  addPk('Cases Rigging case',1);

  return {
    grid,pitch,support:sup,qty,
    pxW,pxH,near,si,warn,
    dataChains:best.chains.length,
    powerChainCount:pCh.length,
    circuits,
    ports,powerChains:pCh,
    flybarCols:flybarCols(g.cols),
    counts,packing,
    panel_name:I.panel_name||'',
    panel_power:I.panel_power||0,
  };
}

// ── BILL OF MATERIALS (inventory-aware) ──────────────────────

/**
 * Match engine packing output against inventory items.
 * Returns a BOM with pricing and stock levels.
 */
export function buildBOM(engineOutput, inventoryItems=[]) {
  const bom=[];
  for(const [itemName,packItem] of Object.entries(engineOutput.packing||{})){
    const qty=packItem.qty||0; if(!qty)continue;
    const inv=inventoryItems.find(i=>{
      const n=i.name?.toLowerCase()||'',k=itemName.toLowerCase();
      return n.includes(k.split(' ')[0])||k.includes(n.split(' ')[0]);
    });
    bom.push({
      name:itemName, qty, note:packItem.note||'',
      inventory_id:inv?.id||null,
      unit_price:inv?.rate_project||inv?.rate_day||0,
      cost:inv?.cost||0,
      in_stock:inv?.qty_available??null,
      from_inventory:!!inv,
    });
  }
  return bom;
}

/**
 * Convert a BOM into proposal line items.
 */
export function generateLineItems(bom) {
  return bom.map(item=>({
    name:item.name, qty:item.qty, unit:'ea',
    unit_price:item.unit_price||0,
    category:item.from_inventory?'Equipment':'Other',
    note:item.note,
  }));
}
