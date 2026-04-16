// projects.js — Project management, LED engine, diagrams
// See full implementation in the build
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { runEngine, calcGrid, flybarCols, nearAsp, simp } from './engine.js';
import { getProfile, isAdmin } from './auth.js';

// ── RENDER ─────────────────────────────────────────────────
export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading projects...</div></div>`;
  const projects = await fetchProjects();
  const admin = isAdmin();
  container.innerHTML = `
    <div class="section-header">
      <div><div class="section-title">Projects</div>
           <div class="section-sub">${admin ? 'All users — ' : ''}${projects.length} project${projects.length !== 1 ? 's' : ''}</div></div>
      <button class="btn-add" onclick="window.Projects.openWizard()">+ New Project</button>
    </div>
    ${!projects.length ? `<div class="empty-state"><div class="empty-icon">📐</div><div class="empty-title">No projects yet</div><p class="empty-sub">Click <strong>+ New Project</strong> to start planning.</p></div>` : ''}
    <div class="card-grid">${projects.map(p => projectCard(p, admin)).join('')}</div>
    <div class="sheet-overlay" id="wizard-overlay">
      <div class="sheet">
        <div class="sheet-header"><div class="sheet-title">New Project</div><button class="modal-close" onclick="window.Projects.closeWizard()">✕</button></div>
        <div class="wizard-progress" id="wiz-prog"></div>
        <div id="wiz-body"></div>
        <div class="wizard-nav" id="wiz-nav"></div>
      </div>
    </div>`;
}

function projectCard(p, showOwner) {
  const sc = { planning:'tag-yellow', confirmed:'tag-blue', active:'tag-green', completed:'tag-gray', cancelled:'tag-red' };
  const wc = p.walls?.length || 0;
  return `<div class="project-card">
    <div class="tag ${sc[p.status]||'tag-gray'}" style="margin-bottom:9px">${p.status||'planning'}</div>
    ${showOwner&&p.profiles?`<div class="text-small text-muted" style="margin-bottom:4px">👤 ${escH(p.profiles.first_name)} ${escH(p.profiles.last_name)}</div>`:''}
    <div style="font-family:'Barlow',sans-serif;font-size:17px;font-weight:700;margin-bottom:4px">${escH(p.name)}</div>
    <div class="text-small text-muted" style="line-height:1.7">
      ${p.created_at?new Date(p.created_at).toLocaleDateString():''}
      ${p.address?`<br>📍 ${escH(p.address)}`:''}
      ${p.event_start_date?`<br>📅 ${fmtDate(p.event_start_date)}`:''}
      ${wc>0?`<br>🖥 ${wc} wall${wc!==1?'s':''}`:''}
      ${(p.contacts?.company_name||p.contacts?.company_name)?`<br>👥 ${escH(p.contacts?.company_name||p.contacts?.company_name)}`:''}
    </div>
    <div style="display:flex;gap:7px;margin-top:12px;padding-top:11px;border-top:1px solid var(--color-border-light);flex-wrap:wrap">
      <button class="btn btn-primary" style="font-size:12px;padding:6px 13px" onclick="window.Projects.openProject('${p.id}')">Open</button>
      <button class="btn btn-blue" style="font-size:12px;padding:6px 13px" onclick="window.Projects.exportPDF('${p.id}')">⬇ PDF</button>
      <button class="btn btn-danger" style="font-size:12px;padding:6px 13px" onclick="window.Projects.deleteProject('${p.id}')">Delete</button>
    </div>
  </div>`;
}

// ── DATA ───────────────────────────────────────────────────
async function fetchProjects() {
  const profile = getProfile(); const admin = isAdmin();
  let q = supabase.from('projects').select('*,contacts(company_name),profiles!projects_owner_id_fkey(first_name,last_name),walls(id,name,width_ft,height_ft,calculated_output)').order('created_at',{ascending:false});
  if (!admin) {
    const {data:asgn} = await supabase.from('project_assignments').select('project_id').eq('user_id',profile.id);
    const ids = (asgn||[]).map(a=>a.project_id);
    if (ids.length) q = q.or(`owner_id.eq.${profile.id},id.in.(${ids.join(',')})`);
    else q = q.eq('owner_id',profile.id);
  }
  const {data,error} = await q;
  if (error) { console.error('[Projects]',error); return []; }
  return data||[];
}

async function fetchPanels() {
  const {data} = await supabase.from('inventory_items').select('*').eq('is_panel',true).order('name');
  return data||[];
}
async function fetchClients() {
  const {data} = await supabase.from('contacts').select('id,company_name,contact_name').order('company_name');
  return data||[];
}
async function fetchUsers() {
  const {data} = await supabase.from('profiles').select('id,first_name,last_name,role').order('first_name');
  return data||[];
}

// ── WIZARD ─────────────────────────────────────────────────
const STEPS = [
  {id:'name',      q:"What would you like to name this project?",             hint:'e.g. "Main Stage", "Conference Room"', type:'text', ph:'Project name...'},
  {id:'address',   q:"What is the venue or project address?",                 hint:'Full address or venue name',           type:'text', ph:'Venue or address...'},
  {id:'client',    q:"Is this for an existing client?",                       hint:'Select or skip',                       type:'client'},
  {id:'dates',     q:"What are the event dates?",                             hint:'Start and end date',                   type:'dates'},
  {id:'support',   q:"How will the first wall be mounted?",                   type:'opts', opts:['Flown (rigged)','Ground support']},
  {id:'dims',      q:"What are the wall dimensions?",                         hint:'Width and height in feet',             type:'dims'},
  {id:'panel',     q:"Which panel from your inventory?",                      hint:'Add panels in Inventory first',        type:'panel'},
  {id:'panelMode', q:"Which panel orientation?",                              type:'opts', opts:['Mixed (1000mm + 500mm tall)','1000mm tall only','500mm square only']},
  {id:'qty',       q:"How many identical walls?",                             hint:'Enter 1 for a single wall',            type:'num', ph:'1', min:1},
  {id:'laptops',   q:"How many playback laptops?",                            type:'num', ph:'0', min:0},
  {id:'cameras',   q:"How many camera inputs?",                               type:'num', ph:'0', min:0},
  {id:'procDist',  q:"Processor to wall distance? (feet)",                   hint:'For home-run cable calculation',        type:'num', ph:'30', min:0},
  {id:'powerDist', q:"Nearest power source distance? (feet)",                type:'num', ph:'25', min:0},
];

let wStep=0, wAns={}, wPanels=[], wClients=[];

async function openWizard() {
  wStep=0; wAns={};
  wPanels = await fetchPanels();
  wClients = await fetchClients();
  if (!wPanels.length) { alert('No LED panels in Inventory. Add at least one panel first.'); return; }
  _renderStep();
  document.getElementById('wizard-overlay').classList.add('open');
}

function closeWizard() { document.getElementById('wizard-overlay').classList.remove('open'); }

function _renderStep() {
  const st=STEPS[wStep], total=STEPS.length;
  document.getElementById('wiz-prog').innerHTML = STEPS.map((_,i)=>`<div class="wizard-dot ${i<wStep?'done':i===wStep?'active':''}"></div>`).join('');
  let inp='';
  if (st.type==='text') inp=`<input class="form-input" id="wi" type="text" placeholder="${st.ph||''}" value="${escH(wAns[st.id]||'')}" style="margin-top:10px;width:100%">`;
  else if (st.type==='num') inp=`<input class="form-input" id="wi" type="number" placeholder="${st.ph||''}" min="${st.min||0}" value="${wAns[st.id]||''}" style="margin-top:10px;width:100%">`;
  else if (st.type==='opts') { const sel=wAns[st.id]||''; inp=`<div class="option-grid">${st.opts.map(o=>`<button class="option-btn ${sel===o?'selected':''}" onclick="window.Projects._wSel(this,'${st.id}','${o}')">${o}</button>`).join('')}</div>`; }
  else if (st.type==='dims') inp=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px"><div><label class="form-label">Width (ft)</label><input class="form-input" id="wW" type="number" placeholder="20" min="1" step="0.5" value="${wAns.widthFt||''}"></div><div><label class="form-label">Height (ft)</label><input class="form-input" id="wH" type="number" placeholder="12" min="1" step="0.5" value="${wAns.heightFt||''}"></div></div>`;
  else if (st.type==='panel') { const sel=wAns[st.id]||''; inp=`<div class="option-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${wPanels.map(p=>`<button class="option-btn ${sel==p.id?'selected':''}" data-panel-id="${p.id}" onclick="window.Projects._wSelPanel(this)"><strong>${escH(p.name)}</strong><div class="option-sub">${escH(p.manufacturer||'')} · ${p.panel_data?.pitch||'?'}mm<br>${p.panel_data?.size==='1000'?'1000×500mm':'500×500mm'} · ${p.qty_available} in stock</div></button>`).join('')}</div>`; }
  else if (st.type==='client') { const sel=wAns[st.id]||''; inp=`<div class="option-grid" style="margin-top:10px"><button class="option-btn ${(!sel||sel==='__skip__')?'selected':''}" data-client-id="__skip__" onclick="window.Projects._wSelClient(this)">Skip for now</button>${wClients.map(c=>`<button class="option-btn ${sel==c.id?'selected':''}" data-client-id="${c.id}" onclick="window.Projects._wSelClient(this)"><strong>${escH(c.company_name)}</strong><div class="option-sub">${escH(c.contact_name||'')}</div></button>`).join('')}</div>`; }
  else if (st.type==='dates') inp=`<div style="display:flex;flex-direction:column;gap:14px;margin-top:10px">
    <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Load In</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label class="form-label">Date</label><input class="form-input" id="wLoadInDate" type="date" value="${wAns.loadInDate||''}"></div>
        <div><label class="form-label">Start Time</label><input class="form-input" id="wLoadInTime" type="time" value="${wAns.loadInTime||''}"></div>
      </div>
    </div>
    <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Show Days</div>
      <div id="show-days-list" style="display:flex;flex-direction:column;gap:8px">
        ${(wAns.showDays||[{date:'',startTime:'',endTime:''}]).map((sd,i)=>`
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end">
            <div><label class="form-label">Date</label><input class="form-input show-day-date" type="date" data-idx="${i}" value="${sd.date||''}"></div>
            <div><label class="form-label">Doors / Start</label><input class="form-input show-day-start" type="time" data-idx="${i}" value="${sd.startTime||''}"></div>
            <div><label class="form-label">Show End</label><input class="form-input show-day-end" type="time" data-idx="${i}" value="${sd.endTime||''}"></div>
            <div><button class="btn btn-danger" style="padding:8px 10px;font-size:12px;margin-top:18px" onclick="window.Projects._removeShowDay(${i})">✕</button></div>
          </div>`).join('')}
      </div>
      <button class="btn" style="margin-top:10px;font-size:12px" onclick="window.Projects._addShowDay()">+ Add Show Day</button>
    </div>
    <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Load Out</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label class="form-label">Date</label><input class="form-input" id="wLoadOutDate" type="date" value="${wAns.loadOutDate||''}"></div>
        <div><label class="form-label">Start Time</label><input class="form-input" id="wLoadOutTime" type="time" value="${wAns.loadOutTime||''}"></div>
      </div>
    </div>
  </div>`;
  document.getElementById('wiz-body').innerHTML=`<div style="display:flex;flex-direction:column;gap:14px"><div class="question-bubble"><div class="question-label">Question ${wStep+1} of ${total}</div>${st.q}${st.hint?`<div class="question-hint">${st.hint}</div>`:''}</div><div>${inp}</div></div>`;
  let nav=wStep>0?`<button class="btn-wizard-back" onclick="window.Projects._wBack()">← Back</button>`:'';
  nav+=wStep<total-1?`<button class="btn-wizard-next" onclick="window.Projects._wNext()">Continue →</button>`:`<button class="btn-wizard-finish" onclick="window.Projects._wFinish()">✓ Create Project</button>`;
  document.getElementById('wiz-nav').innerHTML=nav;
  setTimeout(()=>document.getElementById('wi')?.focus(),80);
}

function _wSel(btn,id,val) { btn.closest('.option-grid').querySelectorAll('.option-btn').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); wAns[id]=val; }
function _wSelPanel(btn) { const id=btn.dataset.panelId; btn.closest('.option-grid').querySelectorAll('.option-btn').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); wAns['panel']=id; }
function _wSelClient(btn) { const id=btn.dataset.clientId; btn.closest('.option-grid').querySelectorAll('.option-btn').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); wAns['client']=id==='__skip__'?'':id; }

function _wGetCur() {
  const st=STEPS[wStep];
  if (['opts','panel','client'].includes(st.type)) return wAns[st.id]!==undefined?'ok':null;
  if (st.type==='dims') { const w=document.getElementById('wW')?.value?.trim(),h=document.getElementById('wH')?.value?.trim(); if (!w||!h) return null; wAns.widthFt=parseFloat(w); wAns.heightFt=parseFloat(h); return 'ok'; }
  if (st.type==='dates') {
    wAns.loadInDate=document.getElementById('wLoadInDate')?.value||'';
    wAns.loadInTime=document.getElementById('wLoadInTime')?.value||'';
    wAns.loadOutDate=document.getElementById('wLoadOutDate')?.value||'';
    wAns.loadOutTime=document.getElementById('wLoadOutTime')?.value||'';
    // collect show days
    const dates=[...document.querySelectorAll('.show-day-date')].map(el=>el.value||'');
    const starts=[...document.querySelectorAll('.show-day-start')].map(el=>el.value||'');
    const ends=[...document.querySelectorAll('.show-day-end')].map(el=>el.value||'');
    wAns.showDays=dates.map((d,i)=>({date:d,startTime:starts[i]||'',endTime:ends[i]||''}));
    // set eventStart/eventEnd for DB compatibility
    wAns.eventStart=wAns.loadInDate||wAns.showDays[0]?.date||'';
    wAns.eventEnd=wAns.loadOutDate||wAns.showDays[wAns.showDays.length-1]?.date||'';
    return 'ok';
  }
  const el=document.getElementById('wi'); return el?el.value.trim():null;
}

function _wNext() {
  const v=_wGetCur(); if (!v&&v!==0) { alert('Please answer to continue.'); return; }
  const st=STEPS[wStep]; if (!['opts','panel','client','dims','dates'].includes(st.type)) wAns[st.id]=v;
  wStep++; _renderStep();
}
function _wBack() { if (wStep>0) { wStep--; _renderStep(); } }

async function _wFinish() {
  const v=_wGetCur(); const st=STEPS[wStep];
  if (!['opts','panel','client','dims','dates'].includes(st.type)) wAns[st.id]=v;
  const profile=getProfile();
  const panel=wPanels.find(p=>p.id==wAns.panel)||wPanels[0];
  if (!panel) { alert('Panel not found.'); return; }
  const inputs={
    widthFt:parseFloat(wAns.widthFt)||20, heightFt:parseFloat(wAns.heightFt)||12,
    panelMode:wAns.panelMode?.includes('1000mm tall')?'1000':wAns.panelMode?.includes('500mm')?'500':'mixed',
    support:wAns.support?.includes('Ground')?'ground':'flown',
    pitch:panel.panel_data?.pitch||3.9, qty:parseInt(wAns.qty)||1,
    laptops:parseInt(wAns.laptops)||0, cameras:parseInt(wAns.cameras)||0,
    procDist:parseFloat(wAns.procDist)||30, powerDist:parseFloat(wAns.powerDist)||25,
    inv1000:panel.panel_data?.size==='1000'?(panel.qty_available||60):0,
    inv500:panel.panel_data?.size==='500'?(panel.qty_available||60):0,
    panel_id:panel.id, panel_name:panel.name, panel_mfr:panel.manufacturer||'', panel_power:panel.panel_data?.power||0,
  };
  const calc=runEngine(inputs);
  const {data:proj,error} = await dbInsert('projects',{
    name:wAns.name||'Untitled', address:wAns.address||'',
    client_id:wAns.client||null, owner_id:profile.id, status:'planning',
    event_start_date:wAns.eventStart||null, event_end_date:wAns.eventEnd||null, notes:JSON.stringify({loadIn:{date:wAns.loadInDate||'',time:wAns.loadInTime||''},showDays:wAns.showDays||[],loadOut:{date:wAns.loadOutDate||'',time:wAns.loadOutTime||''}}),
  });
  if (error) { alert('Failed to save. Try again.'); return; }
  await dbInsert('walls',{project_id:proj.id,name:'Wall 1',order_index:0,width_ft:inputs.widthFt,height_ft:inputs.heightFt,panel_id:panel.id,mount_type:inputs.support,panel_mode:inputs.panelMode,qty:inputs.qty,calculated_output:calc,location_label:'Main'});
  await logActivity('project',proj.id,'created',{name:proj.name});
  closeWizard(); showToast('Project created!','success');
  openProject(proj.id);
}

// ── PROJECT DETAIL ──────────────────────────────────────────
let CP=null, CW=[], CWI=0, CDM='data';

async function openProject(id) {
  document.querySelectorAll('.sb-item').forEach(i=>i.classList.remove('active'));
  const mc=document.getElementById('main-content');
  mc.innerHTML=`<div class="loading-state"><div class="spinner"></div><div>Loading...</div></div>`;
  const {data:p,error} = await supabase.from('projects').select('*,contacts(*),profiles!projects_owner_id_fkey(first_name,last_name),walls(*)').eq('id',id).single();
  if (error||!p) { mc.innerHTML=`<div class="empty-state"><div class="empty-title">Project not found</div></div>`; return; }
  CP=p; CW=(p.walls||[]).sort((a,b)=>a.order_index-b.order_index); CWI=0;
  _renderProjView(mc);
}

function _renderProjView(mc) {
  const p=CP, wall=CW[CWI];
  const sc={planning:'tag-yellow',confirmed:'tag-blue',active:'tag-green',completed:'tag-gray',cancelled:'tag-red'};
  mc.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <button class="btn" onclick="window.navigateTo('projects')" style="font-size:12px;padding:5px 11px">← Projects</button>
          <span class="tag ${sc[p.status]||'tag-yellow'}">${p.status}</span>
        </div>
        <div style="font-family:'Barlow',sans-serif;font-size:24px;font-weight:800">${escH(p.name)}</div>
        ${(p.jobsite_address||p.address)?`<div class="text-small text-muted" style="margin-top:3px">📍 ${escH(p.jobsite_address||p.address||'')}</div>`:''}
        <div class="text-small text-muted" style="margin-top:2px">${p.event_start_date?`📅 ${fmtDate(p.event_start_date)}${p.event_end_date?' → '+fmtDate(p.event_end_date):''}`:''} ${(p.contacts?.company_name||p.contacts?.company_name)?`· 👥 ${escH(p.contacts?.company_name||p.contacts?.company_name)}`:''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="form-select" style="font-size:12px;padding:6px 10px" onchange="window.Projects.setStatus('${p.id}',this.value)">
          ${['planning','confirmed','active','completed','cancelled'].map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        ${p.proposal_id?`<button class="btn" onclick="window.navigateTo('proposals');setTimeout(()=>window.Proposals?.openProposal?.('${p.proposal_id}'),300)">View Proposal →</button>`:''}
        <button class="btn btn-primary" onclick="window.Projects.addWall()">+ Add Wall</button>
        <button class="btn btn-blue" onclick="window.Projects.exportPDF('${p.id}')">⬇ PDF</button>
      </div>
    </div>
    ${CW.length>1?`<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">${CW.map((w,i)=>`<button class="seg-btn ${i===CWI?'active':''}" onclick="window.Projects.switchWall(${i})">${escH(w.name)}</button>`).join('')}</div>`:''}
    <div class="tab-bar">
      <button class="tab-btn active" id="tb-sum" onclick="window.Projects.showTab('sum')">Summary</button>
      <button class="tab-btn" id="tb-diag" onclick="window.Projects.showTab('diag')">Diagram</button>
      <button class="tab-btn" id="tb-counts" onclick="window.Projects.showTab('counts')">Counts</button>
      <button class="tab-btn" id="tb-pack" onclick="window.Projects.showTab('pack')">Packing List</button>
      <button class="tab-btn" id="tb-walls" onclick="window.Projects.showTab('walls')">Walls</button>
      <button class="tab-btn" id="tb-team" onclick="window.Projects.showTab('team')">Team</button>
      <button class="tab-btn" id="tb-tasks" onclick="window.Projects.showTab('tasks')">Tasks</button>
      <button class="tab-btn" id="tb-logistics" onclick="window.Projects.showTab('logistics')">Logistics</button>
      <button class="tab-btn" id="tb-history" onclick="window.Projects.showTab('history')">Job History</button>
    </div>
    <div class="tab-panel active" id="tp-sum">${_sumTab(wall)}</div>
    <div class="tab-panel" id="tp-diag">${_diagTab(wall)}</div>
    <div class="tab-panel" id="tp-counts">${_countsTab(wall)}</div>
    <div class="tab-panel" id="tp-pack">${_packTab(wall)}</div>
    <div class="tab-panel" id="tp-walls">${_wallsTab()}</div>
    <div class="tab-panel" id="tp-team"><div style="margin-bottom:12px"><button class="btn-add" onclick="window.Projects.openAssign()">+ Assign Member</button></div><div id="team-list"><div class="loading-state"><div class="spinner"></div></div></div></div>
    <div class="tab-panel" id="tp-tasks"><div id="proj-tasks-wrap"><div class="loading-state"><div class="spinner"></div></div></div></div>
    <div class="tab-panel" id="tp-logistics"><div id="proj-logistics-wrap"><div class="loading-state"><div class="spinner"></div></div></div></div>
    <div class="tab-panel" id="tp-history"><div id="proj-history-wrap"><div class="loading-state" style="padding:30px"><div class="spinner"></div></div></div></div>
    <div class="sheet-overlay" id="aw-overlay"><div class="sheet"><div class="sheet-header"><div class="sheet-title">Add Wall</div><button class="modal-close" onclick="document.getElementById('aw-overlay').classList.remove('open')">✕</button></div><div id="aw-body"></div></div></div>`;
  CDM='data'; if (wall?.calculated_output) setTimeout(()=>_drawDiag(wall.calculated_output,'data'),100);
}

function _sumTab(wall) {
  const p = CP;
  // Show project info even if no wall data yet
  const sch = p.schedule||{};
  const showDays = (sch.showDays||[]).filter(sd=>sd.date);
  const projectInfo = `
    <div class="card" style="margin-bottom:14px;padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700">Project Scope</div>
        ${p.proposal_id?`<button class="btn" style="font-size:11px;padding:4px 9px" onclick="window.navigateTo('proposals');setTimeout(()=>window.Proposals?.openProposal?.('${p.proposal_id}'),300)">View Proposal →</button>`:''}
      </div>
      <div class="form-grid form-grid-2" style="gap:10px">
        ${p.jobsite_address?`<div style="grid-column:1/-1"><div class="form-label">Jobsite</div><div style="font-size:13px;margin-top:3px">${escH(p.jobsite_address)}</div></div>`:''}
        ${p.event_start_date||sch.loadIn?.date?`<div><div class="form-label">Load In</div><div style="font-size:13px;margin-top:3px">${fmtDate(p.event_start_date||sch.loadIn?.date)}${sch.loadIn?.time?' · '+fmtTime(sch.loadIn.time):''}</div></div>`:''}
        ${showDays.length?`<div><div class="form-label">Show Days</div><div style="font-size:13px;margin-top:3px">${showDays.map(sd=>fmtDate(sd.date)+(sd.startTime?' '+fmtTime(sd.startTime):'')).join('<br>')}</div></div>`:''}
        ${p.event_end_date||sch.loadOut?.date?`<div><div class="form-label">Load Out</div><div style="font-size:13px;margin-top:3px">${fmtDate(p.event_end_date||sch.loadOut?.date)}${sch.loadOut?.time?' · '+fmtTime(sch.loadOut.time):''}</div></div>`:''}
        ${p.environment?`<div><div class="form-label">Environment</div><div style="font-size:13px;margin-top:3px">${escH(p.environment)}</div></div>`:''}
        ${p.support_method?`<div><div class="form-label">Support Method</div><div style="font-size:13px;margin-top:3px">${escH(p.support_method)}</div></div>`:''}
        ${p.rigging_responsibility?`<div><div class="form-label">Rigging</div><div style="font-size:13px;margin-top:3px">${escH(p.rigging_responsibility)}</div></div>`:''}
        ${(p.wall_specs||[]).length?`<div style="grid-column:1/-1"><div class="form-label">Wall Specifications</div><div style="font-size:13px;margin-top:3px">${(p.wall_specs||[]).map((w,i)=>`Wall ${i+1}: ${w.width}ft × ${w.height}ft · Qty ${w.qty}`).join('<br>')}</div></div>`:''}
        ${p.scope_notes?`<div style="grid-column:1/-1"><div class="form-label">Scope of Work</div><div style="font-size:13px;margin-top:3px;line-height:1.6;white-space:pre-wrap">${escH(p.scope_notes)}</div></div>`:''}
      </div>
    </div>`;
  // Guide user to next step if walls exist but need engine run
  const hasWalls = CW.length > 0;
  const needsEngine = hasWalls && !wall?.calculated_output;
  if (!wall?.calculated_output) {
    return projectInfo + (needsEngine ? `
      <div class="alert alert-ok" style="margin-top:14px">
        <strong>✓ Wall placeholder created</strong> — Go to the <strong>Walls</strong> tab, click your wall, and select a panel to run the LED engine and generate diagrams, counts, and packing lists.
      </div>` : `
      <div style="margin-top:14px;text-align:center;padding:30px;background:#f9fafb;border:1.5px dashed var(--color-border-light);border-radius:10px">
        <div style="font-size:24px;margin-bottom:8px">🖥</div>
        <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:6px">No walls yet</div>
        <p style="font-size:13px;color:var(--color-muted);margin-bottom:14px">Click <strong>+ Add Wall</strong> to configure panels and run the LED engine.</p>
        <button class="btn btn-primary" onclick="window.Projects.addWall()">+ Add Wall</button>
      </div>`);
  }
  const out=wall.calculated_output, g=out.grid;
  const stat=out.warn?`<div class="alert alert-warn">⚠ ${out.warn}</div>`:`<div class="alert alert-ok">✓ OK — ${g.total*wall.qty} total panels · ${out.dataChains*wall.qty} data ports</div>`;
  return projectInfo + stat + `<div class="summary-grid">${cards}</div>`;
}
function _sumTab_old(wall) { // unused
  const cards=[{l:'Built Size',v:`${(g.widthMm/304.8).toFixed(1)}′×${(g.heightMm/304.8).toFixed(1)}′`,s:'each wall'},{l:'Resolution',v:`${out.pxW}×${out.pxH}`,s:'pixels'},{l:'Aspect',v:out.near,s:`${out.si.w}:${out.si.h}`},{l:'Panels Each',v:g.total,s:`${g.p1000}×1000, ${g.p500}×500`},{l:'Panel',v:escH(out.panel_name||'—'),s:`${out.pitch}mm · ${out.panel_power||'—'}W`},{l:'Data Chains',v:out.dataChains,s:'per wall'},{l:'Power Chains',v:out.powerChainCount,s:'per wall'},{l:'Circuits',v:out.circuits,s:'20A/120V est.'}].map(c=>`<div class="summary-card"><div class="summary-card-label">${c.l}</div><div class="summary-card-value">${c.v}</div><div class="summary-card-sub">${c.s}</div></div>`).join('');
  // return handled above
}

function _diagTab(wall) {
  if (!wall?.calculated_output) return `<div class="empty-state"><div class="empty-title">No diagram data</div></div>`;
  const wOpts=Array.from({length:wall.qty},(_,i)=>`<option value="${i}">Wall ${i+1}</option>`).join('');
  return `<div class="diagram-card"><div class="diagram-controls"><button class="seg-btn active" id="seg-data" onclick="window.Projects.switchDiag('data')">Data Chains</button><button class="seg-btn" id="seg-pow" onclick="window.Projects.switchDiag('power')">Power Chains</button>${wall.qty>1?`<select class="form-select" id="wall-sel" onchange="window.Projects.switchDiag(null)" style="font-size:12px;padding:6px 10px">${wOpts}</select>`:''}<span class="back-view-label">◀ BACK VIEW</span></div><svg id="diag-svg" viewBox="0 0 760 500" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;border-radius:6px;border:1.5px solid var(--color-border-light)"></svg><div class="text-small text-muted" id="diag-leg" style="margin-top:8px;line-height:1.8"></div></div>`;
}

function _countsTab(wall) {
  if (!wall?.calculated_output?.counts) return `<div class="empty-state"><div class="empty-title">No count data</div></div>`;
  const counts=wall.calculated_output.counts;
  const SECS=[['Panels',([k])=>k.startsWith('Panels')],['Data Cabling',([k])=>k.includes('ethercon')||k.startsWith('HDMI')||k.startsWith('SDI')],['Power',([k])=>k.includes('edison')||k.includes('powercon')||k.includes('white')||k.includes('blue')],['Ground Support',([k])=>k.startsWith('Pipe')||k.startsWith('Rigging arm')],['Bars & Rigging',([k])=>k.includes('bars')||k.includes('Megaclaw')||k.includes('feet')],['Truss & Pipe',([k])=>k.startsWith('Truss')||k.startsWith('Sched')||k.includes('cheeseborough')],['System',([k])=>/Processors|laptop|Mosaic/.test(k)]];
  const ents=Object.entries(counts).filter(([,v])=>v&&v!==0);
  let html='';
  SECS.forEach(([title,filter])=>{const rows=ents.filter(filter);if(!rows.length)return;html+=`<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:10px;margin-bottom:10px;overflow:hidden;box-shadow:var(--shadow-sm)"><div style="background:#f9fafb;border-bottom:1px solid var(--color-border-light);padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted)">${title}</div>${rows.map(([k,v])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border-bottom:1px solid #f3f4f6"><div style="font-size:13px">${k}</div><div style="font-family:'Barlow',sans-serif;font-size:18px;font-weight:700;color:var(--color-accent)">${v}</div></div>`).join('')}</div>`;});
  html+=`<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:10px;padding:14px;box-shadow:var(--shadow-sm);display:flex;align-items:center;justify-content:space-between"><div><div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);font-weight:600">20A/120V Circuits (est.)</div><div style="font-size:11px;color:var(--color-muted);margin-top:3px">≤12 per 1000×500 · ≤24 per 500×500 · +1 spare</div></div><div style="font-family:'Barlow',sans-serif;font-size:28px;font-weight:800;color:var(--color-accent-2)">${wall.calculated_output.circuits}</div></div>`;
  return html;
}

// ── PACKING HELPERS ────────────────────────────────────────
let packView = 'wall'; // 'wall' | 'location' | 'project'

function _packTab(wall) {
  if (!CW.some(w=>w.calculated_output?.packing)) return `<div class="empty-state"><div class="empty-title">No packing data</div></div>`;
  return `
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="seg-btn ${packView==='wall'?'active':''}" onclick="window.Projects.setPackView('wall')">By Wall</button>
      <button class="seg-btn ${packView==='location'?'active':''}" onclick="window.Projects.setPackView('location')">By Location</button>
      <button class="seg-btn ${packView==='project'?'active':''}" onclick="window.Projects.setPackView('project')">Full Project</button>
    </div>
    <div id="pack-content">${_renderPackContent()}</div>`;
}

function setPackView(view) {
  packView = view;
  document.querySelectorAll('#tp-pack .seg-btn').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().includes(view==='wall'?'wall':view==='location'?'location':'project')));
  const el = document.getElementById('pack-content');
  if (el) el.innerHTML = _renderPackContent();
}

function _renderPackContent() {
  if (packView === 'wall') return _packByWall();
  if (packView === 'location') return _packByLocation();
  return _packByProject();
}

function _packByWall() {
  return CW.map(w => {
    if (!w.calculated_output?.packing) return '';
    const loc = w.location_label || 'Main';
    return `<div style="margin-bottom:20px">
      <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:8px">
        ${escH(w.name)} <span class="tag tag-blue" style="font-size:10px">${escH(loc)}</span>
        <span style="font-size:12px;font-weight:400;color:var(--color-muted)">${w.width_ft}′×${w.height_ft}′ · qty ${w.qty}</span>
      </div>
      ${_renderPackSections(w.calculated_output.packing)}
    </div>`;
  }).join('');
}

function _packByLocation() {
  // Group walls by location_label
  const locMap = new Map();
  CW.forEach(w => {
    const loc = w.location_label || 'Main';
    if (!locMap.has(loc)) locMap.set(loc, []);
    locMap.get(loc).push(w);
  });
  let html = '';
  for (const [loc, walls] of locMap.entries()) {
    const combined = _combinePacking(walls);
    html += `<div style="margin-bottom:24px">
      <div style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700;margin-bottom:4px;color:var(--color-accent)">📍 ${escH(loc)}</div>
      <div style="font-size:12px;color:var(--color-muted);margin-bottom:10px">${walls.map(w=>escH(w.name)).join(', ')}</div>
      ${_renderPackSections(combined)}
    </div>`;
  }
  return html;
}

function _packByProject() {
  const combined = _combinePacking(CW);
  return `<div style="margin-bottom:8px"><div style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700;margin-bottom:10px;color:var(--color-accent)">📦 Full Project — All Walls Combined</div>${_renderPackSections(combined)}</div>`;
}

function _combinePacking(walls) {
  const combined = {};
  walls.forEach(w => {
    const packing = w.calculated_output?.packing;
    if (!packing) return;
    Object.entries(packing).forEach(([key, item]) => {
      if (!combined[key]) combined[key] = { qty: 0, note: item.note || '' };
      combined[key].qty += item.qty || 0;
    });
  });
  return combined;
}

function _renderPackSections(packing) {
  const catMap = new Map();
  for (const [key, item] of Object.entries(packing)) {
    const c = key.startsWith('Cases')?'Cases':key.startsWith('Panels')?'Panels':key.match(/ethercon|HDMI|SDI/)?'Data Cabling':key.match(/edison|powercon|white|blue/)?'Power':key.match(/Pipe and base|Rigging arm/)?'Ground Support':key.match(/bars|Megaclaw|feet/)?'Rigging':key.match(/Truss|Sched|Swivel/)?'Truss & Pipe':'System';
    if (!catMap.has(c)) catMap.set(c, []); catMap.get(c).push({ key, ...item });
  }
  let html = '';
  for (const [cat, items] of catMap.entries()) {
    html += `<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:10px;margin-bottom:10px;overflow:hidden;box-shadow:var(--shadow-sm)">
      <div style="background:#f9fafb;border-bottom:1px solid var(--color-border-light);padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted)">${cat}</div>
      ${items.map(item => `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border-bottom:1px solid #f3f4f6">
        <div><div style="font-size:13px">${item.key}</div>${item.note ? `<div style="font-size:11px;color:var(--color-muted)">${item.note}</div>` : ''}</div>
        <div style="font-family:'Barlow',sans-serif;font-size:18px;font-weight:700;color:var(--color-accent)">${item.qty}</div>
      </div>`).join('')}
    </div>`;
  }
  return html || '<div style="color:var(--color-muted);font-size:13px;padding:10px">No items.</div>';
}

function _wallsTab() {
  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="btn-add" onclick="window.Projects.addWall()">+ Add Wall</button>
    </div>
    ${!CW.length
      ? `<div class="empty-state" style="padding:40px"><div class="empty-icon">🖥</div><div class="empty-title">No walls yet</div><p class="empty-sub">Add a wall to run the LED engine.</p></div>`
      : `<div style="display:flex;flex-direction:column;gap:10px">
          ${CW.map((w,i) => {
            const hasEngine = !!w.calculated_output;
            return `<div style="background:#fff;border:1.5px solid ${hasEngine?'var(--color-border-light)':'#fbbf24'};border-radius:10px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="flex:1">
                <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:4px">${escH(w.name)}</div>
                <div class="text-small text-muted">
                  ${w.width_ft}′ × ${w.height_ft}′ · Qty ${w.qty} · 
                  <span class="tag ${w.mount_type==='flown'?'tag-blue':'tag-yellow'}" style="font-size:10px">${w.mount_type||'flown'}</span>
                  ${hasEngine ? ` · ${w.calculated_output.grid.total * w.qty} panels · ${w.calculated_output.dataChains * w.qty} data ports` : ''}
                </div>
                ${!hasEngine ? `<div style="font-size:12px;color:#d97706;margin-top:6px;font-weight:600">⚠ Panel not selected — engine not run yet</div>` : ''}
              </div>
              <div style="display:flex;gap:6px">
                ${hasEngine
                  ? `<button class="btn btn-primary" style="font-size:12px;padding:6px 12px" onclick="window.Projects.switchWall(${i});window.Projects.showTab('sum')">View Data</button>`
                  : `<button class="btn btn-primary" style="font-size:12px;padding:6px 12px" onclick="window.Projects.openConfigWall('${w.id}',${w.width_ft},${w.height_ft},${w.qty},'${w.mount_type||'flown'}')">⚡ Configure & Run Engine</button>`}
                <button class="btn btn-danger" style="font-size:12px;padding:6px 10px" onclick="window.Projects.deleteWall('${w.id}')">✕</button>
              </div>
            </div>`;
          }).join('')}
        </div>`}`;
}

// ── TAB / WALL SWITCHING ────────────────────────────────────
function showTab(name) {
  ['sum','diag','counts','pack','walls','team','tasks','logistics','history'].forEach(t=>{document.getElementById('tb-'+t)?.classList.toggle('active',t===name);document.getElementById('tp-'+t)?.classList.toggle('active',t===name);});
  if (name==='diag'){const w=CW[CWI];if(w?.calculated_output)_drawDiag(w.calculated_output,CDM);}
  if (name==='team') _loadTeam();
}

function switchWall(i) { CWI=i; _renderProjView(document.getElementById('main-content')); }

function switchDiag(mode) {
  if (mode) CDM=mode;
  document.getElementById('seg-data')?.classList.toggle('active',CDM==='data');
  document.getElementById('seg-pow')?.classList.toggle('active',CDM==='power');
  const w=CW[CWI]; if (w?.calculated_output) _drawDiag(w.calculated_output,CDM);
}

// ── TEAM ───────────────────────────────────────────────────
async function _loadTeam() {
  const el=document.getElementById('team-list'); if (!el||!CP) return;
  const [{data:asgn},{data:openBookings}] = await Promise.all([
    supabase.from('project_assignments').select('*,profiles(first_name,last_name,role)').eq('project_id',CP.id),
    supabase.from('crew_bookings').select('*').eq('project_id',CP.id).is('crew_member_id',null),
  ]);
  const openPositions=(openBookings||[]).filter(b=>b.notes?.startsWith('[OPEN POSITION]'));
  el.innerHTML=`
    ${openPositions.length?`<div class="card" style="margin-bottom:14px;padding:14px">
      <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;margin-bottom:10px;color:#d97706">⚠ Open Positions — Crew Needed</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${openPositions.map(b=>{
          const parts=(b.notes||'').replace('[OPEN POSITION] ','').split(' — ');
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#fffbeb;border:1.5px solid #fbbf24;border-radius:6px">
            <div>
              <div style="font-weight:600;font-size:13px">${escH(parts[0]||'Position')}</div>
              <div class="text-small text-muted">${b.scheduled_hours||0}h · $${b.rate_used||0}/hr${parts[1]?' · '+escH(parts[1]):''}</div>
            </div>
            <span style="font-size:11px;font-weight:700;color:#d97706">UNFILLED</span>
          </div>`;
        }).join('')}
      </div>
    </div>`:''}
    ${!asgn?.length
      ?`<div class="empty-state" style="padding:30px"><div class="empty-title">No team members assigned</div><p class="empty-sub">Use the button above to assign app users to this project.</p></div>`
      :`<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Role</th><th>Project Role</th><th></th></tr></thead>
          <tbody>${asgn.map(a=>`<tr>
            <td><strong>${a.profiles?.first_name||''} ${a.profiles?.last_name||''}</strong></td>
            <td class="text-small">${a.profiles?.role||''}</td>
            <td class="text-small">${escH(a.role_on_project||'')}</td>
            <td><button class="btn btn-danger" style="font-size:11px;padding:4px 9px" onclick="window.Projects.removeAssign('${a.id}')">Remove</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`}`;
}

async function openAssign() {
  const users=await fetchUsers();
  const {data:ex} = await supabase.from('project_assignments').select('user_id').eq('project_id',CP.id);
  const exIds=(ex||[]).map(e=>e.user_id);
  const avail=users.filter(u=>!exIds.includes(u.id)&&u.id!==CP.owner_id);
  const m=document.createElement('div'); m.className='modal-overlay open';
  m.innerHTML=`<div class="modal"><div class="modal-header"><div class="modal-title">Assign Team Member</div><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div><div class="form-field" style="margin-bottom:12px"><label class="form-label">Team Member</label><select class="form-select" id="au-user">${avail.map(u=>`<option value="${u.id}">${u.first_name} ${u.last_name} (${u.role})</option>`).join('')}</select></div><div class="form-field" style="margin-bottom:16px"><label class="form-label">Role on Project</label><input class="form-input" id="au-role" placeholder="e.g. Lead Tech, A2"></div><div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" onclick="window.Projects._doAssign(this)">Assign</button></div></div>`;
  document.body.appendChild(m);
}

async function _doAssign(btn) {
  const overlay=btn.closest('.modal-overlay');
  const userId=document.getElementById('au-user')?.value;
  const role=document.getElementById('au-role')?.value.trim()||'Crew';
  if (!userId) { alert('Select a team member.'); return; }
  await dbInsert('project_assignments',{project_id:CP.id,user_id:userId,role_on_project:role,assigned_by:getProfile().id});
  overlay.remove(); showToast('Assigned!','success'); _loadTeam();
}

async function removeAssign(id) {
  if (!confirm('Remove?')) return;
  await dbDelete('project_assignments',id); showToast('Removed.','success'); _loadTeam();
}

// ── ADD WALL ────────────────────────────────────────────────
async function openConfigWall(wallId, widthFt, heightFt, qty, mountType) {
  const panels = await fetchPanels();
  document.getElementById('aw-overlay').classList.add('open');
  const hasPanels = panels.length > 0;
  document.getElementById('aw-body').innerHTML=`
    <div style="background:#fffbeb;border:1.5px solid #fbbf24;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px">
      ⚡ Dimensions pre-filled from your proposal. ${hasPanels?'Select your panel to run the LED engine.':'<strong>No panels in inventory yet</strong> — enter pitch manually below, or add panels in the Inventory module first.'}
    </div>
    <div class="form-grid form-grid-2" style="gap:12px;margin-bottom:14px">
      <div class="form-field"><label class="form-label">Wall Name</label><input class="form-input" id="aw-n" value="Main Wall"></div>
      <div class="form-field"><label class="form-label">Location</label><input class="form-input" id="aw-loc" value="Main"></div>
      ${hasPanels
        ? `<div class="form-field"><label class="form-label">Panel</label>
            <select class="form-select" id="aw-p">
              ${panels.map(p=>`<option value="${p.id}" data-pitch="${p.panel_data?.pitch||3.9}" data-size="${p.panel_data?.size||'1000'}" data-power="${p.panel_data?.power||150}">${escH(p.name)}</option>`).join('')}
            </select></div>`
        : `<div class="form-field"><label class="form-label">Pixel Pitch (mm)</label>
            <input class="form-input" id="aw-pitch" type="number" step="0.1" value="3.9" placeholder="e.g. 3.9">
            <div class="text-small text-muted" style="margin-top:3px">Add panels in Inventory to select by name</div></div>`}
      <div class="form-field"><label class="form-label">Width (ft)</label><input class="form-input" id="aw-w" type="number" value="${widthFt}" min="1" step="0.5"></div>
      <div class="form-field"><label class="form-label">Height (ft)</label><input class="form-input" id="aw-h" type="number" value="${heightFt}" min="1" step="0.5"></div>
      <div class="form-field"><label class="form-label">Mount</label>
        <select class="form-select" id="aw-m">
          <option value="flown" ${(mountType||'flown')==='flown'?'selected':''}>Flown</option>
          <option value="ground" ${mountType==='ground'?'selected':''}>Ground</option>
        </select></div>
      <div class="form-field"><label class="form-label">Panel Mode</label>
        <select class="form-select" id="aw-pm"><option value="mixed">Mixed (auto)</option><option value="1000">1000mm tall</option><option value="500">500mm square</option></select></div>
      <div class="form-field"><label class="form-label">Qty (identical walls)</label><input class="form-input" id="aw-q" type="number" value="${qty||1}" min="1"></div>
      <div class="form-field"><label class="form-label">Proc Distance (ft)</label><input class="form-input" id="aw-pd" type="number" value="30" min="0"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button class="btn" onclick="document.getElementById('aw-overlay').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="window.Projects._saveConfigWall('${wallId}')">⚡ Run Engine & Save</button>
    </div>`;
}

async function _saveConfigWall(oldWallId) {
  const ps = document.getElementById('aw-p');
  const po = ps?.options[ps?.selectedIndex];
  // Support both panel-from-inventory and manual pitch entry
  const pitchFromPanel = parseFloat(po?.dataset.pitch);
  const pitch = ps
    ? (pitchFromPanel > 0 ? pitchFromPanel : 3.9)
    : (parseFloat(document.getElementById('aw-pitch')?.value) || 3.9);
  const panelSize = po?.dataset.size || '1000';
  const inputs = {
    widthFt:   parseFloat(document.getElementById('aw-w')?.value)  || 20,
    heightFt:  parseFloat(document.getElementById('aw-h')?.value)  || 12,
    panelMode: document.getElementById('aw-pm')?.value             || 'mixed',
    support:   document.getElementById('aw-m')?.value              || 'flown',
    pitch,
    qty:       parseInt(document.getElementById('aw-q')?.value)    || 1,
    procDist:  parseFloat(document.getElementById('aw-pd')?.value) || 30,
    powerDist: 25, laptops: 0, cameras: 0,
    inv1000:   panelSize === '1000' ? 60 : 0,
    inv500:    panelSize === '500'  ? 60 : 0,
    panel_name:  po?.text || `${pitch}mm panel`,
    panel_power: parseInt(po?.dataset.power) || 150,
  };

  let calc;
  console.log('[Engine inputs]', inputs);
  try {
    calc = runEngine(inputs);
    console.log('[Engine output]', calc?.grid);
  } catch(e) {
    console.error('[Engine error]', e);
    showToast('Engine calculation failed — check wall dimensions.', 'error');
    return;
  }

  if (!calc || !calc.grid) {
    showToast('Engine returned no data — check wall dimensions.', 'error');
    return;
  }

  const { error } = await supabase.from('walls').update({
    name:           document.getElementById('aw-n')?.value.trim() || 'Main Wall',
    location_label: document.getElementById('aw-loc')?.value.trim() || 'Main',
    width_ft:  inputs.widthFt,
    height_ft: inputs.heightFt,
    panel_id:  ps?.value || null,
    mount_type:   inputs.support,
    panel_mode:   inputs.panelMode,
    qty:           inputs.qty,
    calculated_output: calc,
  }).eq('id', oldWallId);

  if (error) { showToast('Failed to save wall.', 'error'); console.error(error); return; }
  document.getElementById('aw-overlay').classList.remove('open');
  showToast('Engine run complete! Diagram and counts are ready.', 'success');
  openProject(CP.id);
}

async function addWall() {
  const panels=await fetchPanels();
  document.getElementById('aw-body').innerHTML=`<div class="form-grid form-grid-2" style="gap:12px;margin-bottom:14px"><div class="form-field"><label class="form-label">Wall Name</label><input class="form-input" id="aw-n" value="Wall ${CW.length+1}"></div><div class="form-field"><label class="form-label">Location Label</label><input class="form-input" id="aw-loc" placeholder="e.g. Stage A, Lobby, Main"></div><div class="form-field"><label class="form-label">Panel</label><select class="form-select" id="aw-p">${panels.map(p=>`<option value="${p.id}" data-pitch="${p.panel_data?.pitch}" data-size="${p.panel_data?.size}" data-power="${p.panel_data?.power}">${escH(p.name)}</option>`).join('')}</select></div><div class="form-field"><label class="form-label">Width (ft)</label><input class="form-input" id="aw-w" type="number" placeholder="20" min="1" step="0.5"></div><div class="form-field"><label class="form-label">Height (ft)</label><input class="form-input" id="aw-h" type="number" placeholder="12" min="1" step="0.5"></div><div class="form-field"><label class="form-label">Mount</label><select class="form-select" id="aw-m"><option value="flown">Flown</option><option value="ground">Ground</option></select></div><div class="form-field"><label class="form-label">Panel Mode</label><select class="form-select" id="aw-pm"><option value="mixed">Mixed</option><option value="1000">1000mm tall</option><option value="500">500mm square</option></select></div><div class="form-field"><label class="form-label">Qty</label><input class="form-input" id="aw-q" type="number" value="1" min="1"></div><div class="form-field"><label class="form-label">Proc Distance (ft)</label><input class="form-input" id="aw-pd" type="number" value="30" min="0"></div></div><div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" onclick="document.getElementById('aw-overlay').classList.remove('open')">Cancel</button><button class="btn btn-primary" onclick="window.Projects._saveWall()">Add Wall</button></div>`;
  document.getElementById('aw-overlay').classList.add('open');
}

async function _saveWall() {
  const ps=document.getElementById('aw-p');
  const po=ps?.options[ps?.selectedIndex];
  const pitchVal = parseFloat(po?.dataset.pitch);
  const pitch = pitchVal > 0 ? pitchVal : 3.9;
  const panelSize = po?.dataset.size||'1000';
  const inputs={
    widthFt:parseFloat(document.getElementById('aw-w')?.value)||20,
    heightFt:parseFloat(document.getElementById('aw-h')?.value)||12,
    panelMode:document.getElementById('aw-pm')?.value||'mixed',
    support:document.getElementById('aw-m')?.value||'flown',
    pitch, qty:parseInt(document.getElementById('aw-q')?.value)||1,
    procDist:parseFloat(document.getElementById('aw-pd')?.value)||30,
    powerDist:25,laptops:0,cameras:0,
    inv1000:panelSize==='1000'?60:0,
    inv500:panelSize==='500'?60:0,
    panel_id:ps?.value,
    panel_name:po?.text||`${pitch}mm panel`,
    panel_power:parseInt(po?.dataset.power)||150,
  };
  let calc;
  try { calc=runEngine(inputs); } catch(e) { showToast('Engine error — check dimensions.','error'); console.error(e); return; }
  if(!calc?.grid){showToast('Engine returned no data.','error');return;}
  const{error}=await dbInsert('walls',{
    project_id:CP.id,
    name:document.getElementById('aw-n')?.value.trim()||`Wall ${CW.length+1}`,
    order_index:CW.length,
    width_ft:inputs.widthFt,height_ft:inputs.heightFt,
    panel_id:ps?.value||null,mount_type:inputs.support,
    panel_mode:inputs.panelMode,qty:inputs.qty,
    calculated_output:calc,
    location_label:document.getElementById('aw-loc')?.value.trim()||'Main',
  });
  if(error){showToast('Failed to save wall.','error');console.error(error);return;}
  document.getElementById('aw-overlay').classList.remove('open');
  showToast('Wall added!','success'); openProject(CP.id);
}

async function deleteWall(id) {
  if (CW.length<=1) { alert('Project must have at least one wall.'); return; }
  if (!confirm('Delete wall?')) return;
  await dbDelete('walls',id); showToast('Deleted.','success'); openProject(CP.id);
}

// ── STATUS ──────────────────────────────────────────────────
async function setStatus(id,status) { await dbUpdate('projects',id,{status}); if(CP)CP.status=status; showToast(`Status: ${status}`,'success'); }

// ── DELETE ──────────────────────────────────────────────────
async function deleteProject(id) {
  if (!confirm('Delete this project? Cannot be undone.')) return;
  await dbDelete('projects',id); await logActivity('project',id,'deleted');
  showToast('Deleted.','success'); window.navigateTo('projects');
}

// ── PROPOSAL SHORTCUT ───────────────────────────────────────
function openCreateProposal(projId) { sessionStorage.setItem('new_proposal_project_id',projId); window.navigateTo('proposals'); }

// ── DIAGRAM ─────────────────────────────────────────────────
const PC=['#2563eb','#dc2626','#16a34a','#9333ea'], POW='#7c3aed';

function _drawDiag(out,mode) {
  const svg=document.getElementById('diag-svg'); if (!svg||!out?.grid) return;
  const g=out.grid, wallIdx=parseInt(document.getElementById('wall-sel')?.value||'0')||0;
  const wallChains=(out.ports||[])[wallIdx]||(out.ports||[])[0]||[];
  const pCh=out.powerChains||[];
  _renderSVG(svg,g,wallChains,pCh,mode,out.support,'#f8f9fa');
  const leg=document.getElementById('diag-leg');
  if (leg&&mode==='data') leg.textContent=wallChains.map((ch,i)=>{const s=ch.nodes[0];return`Chain ${i+1}: P${ch.proc}-${ch.port} → r${s.row+1}/c${s.col+1}`;}).join('   ·   ');
  else if (leg) leg.textContent=`${pCh.length} power chain${pCh.length!==1?'s':''}`;
}

function _renderSVG(svg,g,wallChains,pCh,mode,support,bg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const pad=24,scale=Math.min(760/(g.widthMm+pad*2),500/(g.heightMm+pad*2+40));
  const vW=(g.widthMm+pad*2)*scale,vH=(g.heightMm+pad*2+40)*scale;
  svg.setAttribute('viewBox',`0 0 ${vW} ${vH}`);
  const ns='http://www.w3.org/2000/svg', mk=(t,a)=>{const el=document.createElementNS(ns,t);Object.entries(a).forEach(([k,v])=>el.setAttribute(k,v));return el;};
  const defs=mk('defs',{}),mar=mk('marker',{id:'arr',markerWidth:'8',markerHeight:'8',refX:'6',refY:'3',orient:'auto'});
  mar.appendChild(mk('path',{d:'M0,0 L6,3 L0,6 Z',fill:'#1a3a5c'}));defs.appendChild(mar);svg.appendChild(defs);
  svg.appendChild(mk('rect',{x:'0',y:'0',width:vW,height:vH,rx:'8',fill:bg,stroke:'#d1d5db'}));
  const mm=v=>v*scale,bH=mm(20);
  svg.appendChild(mk('rect',{x:'0',y:'0',width:vW,height:bH,fill:'#1a3a5c'}));
  const bt=mk('text',{x:vW/2,y:bH*.68,'text-anchor':'middle','font-size':'10','font-weight':'700','font-family':'Arial,sans-serif',fill:'#fff','letter-spacing':'3'});bt.textContent='◀  BACK VIEW  ▶';svg.appendChild(bt);
  const tp=bH+mm(pad-10),cW=500,h1=1000,h2=500;
  const dr=(x,y,w,h)=>svg.appendChild(mk('rect',{x:mm(x),y:tp+mm(y),width:mm(w),height:mm(h),fill:'#fff',stroke:'#1a1a1a','stroke-width':'1.5'}));
  let y=0;for(let r=0;r<g.rows1000;r++){for(let c=0;c<g.cols;c++)dr(pad+c*cW,y,cW,h1);y+=h1;}
  for(let r=0;r<g.rows500;r++){for(let c=0;c<g.cols;c++)dr(pad+c*cW,y,cW,h2);y+=h2;}
  if(support==='flown')flybarCols(g.cols).forEach(ci=>svg.appendChild(mk('rect',{x:mm(pad+ci*cW+40),y:tp+mm(-22),width:mm(cW-80),height:mm(110),rx:mm(30),fill:'#1a3a5c',opacity:'0.9'})));
  const ctr=n=>({cx:mm(pad+n.col*cW+cW/2),cy:tp+mm(n.row<g.rows1000?n.row*h1+h1/2:g.rows1000*h1+(n.row-g.rows1000)*h2+h2/2)});
  const chain=(nodes,clr)=>{for(let i=0;i<nodes.length;i++){const P=ctr(nodes[i]),t=mk('text',{x:P.cx,y:P.cy+4,'text-anchor':'middle','font-size':'11',fill:'#111','font-weight':'600'});t.textContent=String(i+1);svg.appendChild(t);if(i<nodes.length-1){const Q=ctr(nodes[i+1]);svg.appendChild(mk('line',{x1:P.cx,y1:P.cy,x2:Q.cx,y2:Q.cy,stroke:clr,'stroke-width':'2.5','marker-end':'url(#arr)'}));}}};
  if(mode==='data')wallChains.forEach(ch=>chain(ch.nodes||ch,PC[((ch.port||1)-1)%4]));
  else pCh.forEach(ch=>chain(ch,POW));
}

// ── PDF ─────────────────────────────────────────────────────
async function exportPDF(id) {
  if (!CP||CP.id!==id) { await openProject(id); await new Promise(r=>setTimeout(r,600)); }
  const {jsPDF}=window.jspdf; if (!jsPDF) { alert('PDF library not loaded.'); return; }
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210,M=14,cw=W-M*2;let y=M;
  const hdr=(t,sz=12)=>{doc.setFontSize(sz);doc.setFont('helvetica','bold');doc.setTextColor(26,58,92);doc.text(t,M,y);y+=sz*.45+3;};
  const rule=()=>{doc.setDrawColor(180,180,180);doc.line(M,y,W-M,y);y+=4;};
  const chk=n=>{if(y+n>288){doc.addPage();y=M;}};
  const kv=(l,v)=>{chk(7);doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(50,50,50);doc.text(String(l),M,y);doc.setFont('helvetica','bold');doc.setTextColor(26,58,92);doc.text(String(v),W-M,y,'right');y+=6;};
  const secH=t=>{chk(8);doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(100,120,140);doc.text(t.toUpperCase(),M,y);y+=5;};
  const svgToImg=(svgEl,w=760,h=560)=>new Promise((res,rej)=>{const str=new XMLSerializer().serializeToString(svgEl);const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');const img=new Image();img.onload=()=>{ctx.fillStyle='#f8f9fa';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);res(canvas.toDataURL('image/png'));};img.onerror=rej;img.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(str)));});

  doc.setFillColor(26,58,92);doc.rect(0,0,W,28,'F');
  doc.setFontSize(16);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);doc.text('LED Planning Tool',M,12);
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(180,200,225);doc.text('Visual Affect — Websites · Workflows · LED Video Walls',M,20);
  doc.setFontSize(8);doc.setTextColor(140,175,210);doc.text(`${new Date().toLocaleDateString()} · ${getProfile()?.first_name||''} ${getProfile()?.last_name||''}`,W-M,20,'right');
  y=34; hdr(CP.name,14);
  if(CP.address){doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(100,100,100);doc.text('Location: '+CP.address,M,y);y+=7;}
  y+=4;

  for (const wall of CW) {
    const out=wall.calculated_output; if (!out) continue; const g=out.grid;
    chk(20);hdr(`Wall: ${wall.name}`,12);rule();
    kv('Built size',`${(g.widthMm/304.8).toFixed(1)}ft × ${(g.heightMm/304.8).toFixed(1)}ft`);
    kv('Resolution',`${out.pxW} × ${out.pxH} px`);kv('Aspect',`${out.near} (${out.si.w}:${out.si.h})`);
    kv('Panels each',`${g.total} (${g.p1000}× 1000×500, ${g.p500}× 500×500)`);
    kv('Panel',`${out.panel_name||'—'} · ${out.pitch}mm`);kv('Data chains',`${out.dataChains} per wall`);kv('Power chains',`${out.powerChains} per wall`);kv('Circuits',out.circuits);
    if(out.warn){y+=2;doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(180,100,0);doc.text('⚠ '+out.warn,M,y);y+=7;}y+=4;

    chk(80);hdr('Data Chain Diagram (Back View)',11);rule();
    const ts=document.createElementNS('http://www.w3.org/2000/svg','svg');ts.setAttribute('xmlns','http://www.w3.org/2000/svg');document.body.appendChild(ts);
    _renderSVG(ts,g,(out.ports||[])[0]||[],out.powerChains||[],'data',wall.mount_type,'#f8f9fa');
    try{const di=await svgToImg(ts);doc.addImage(di,'PNG',M,y,cw,cw*560/760);y+=cw*560/760+5;}catch(e){}
    document.body.removeChild(ts);

    doc.addPage();y=M;hdr('Power Chain Diagram (Back View)',11);rule();
    const ts2=document.createElementNS('http://www.w3.org/2000/svg','svg');ts2.setAttribute('xmlns','http://www.w3.org/2000/svg');document.body.appendChild(ts2);
    _renderSVG(ts2,g,(out.ports||[])[0]||[],out.powerChains||[],'power',wall.mount_type,'#f8f9fa');
    try{const pi=await svgToImg(ts2);doc.addImage(pi,'PNG',M,y,cw,cw*560/760);y+=cw*560/760+5;}catch(e){}
    document.body.removeChild(ts2);

    doc.addPage();y=M;hdr('Material Counts',11);rule();
    const counts=out.counts||{};
    const SECS=[['Panels',([k])=>k.startsWith('Panels')],['Data Cabling',([k])=>k.includes('ethercon')||k.startsWith('HDMI')||k.startsWith('SDI')],['Power',([k])=>k.includes('edison')||k.includes('powercon')||k.includes('white')||k.includes('blue')],['Ground Support',([k])=>k.startsWith('Pipe')||k.startsWith('Rigging arm')],['Bars & Rigging',([k])=>k.includes('bars')||k.includes('Megaclaw')||k.includes('feet')],['Truss & Pipe',([k])=>k.startsWith('Truss')||k.startsWith('Sched')||k.includes('cheeseborough')],['System',([k])=>/Processors|laptop|Mosaic/.test(k)]];
    const ents=Object.entries(counts).filter(([,v])=>v&&v!==0);
    SECS.forEach(([title,filter])=>{const rows=ents.filter(filter);if(!rows.length)return;chk(10+rows.length*7);secH(title);rows.forEach(([k,v])=>kv(k,v));y+=2;});
    chk(10);secH('Power Circuits');kv('20A/120V circuits',out.circuits);y+=4;

    doc.addPage();y=M;hdr('Packing List',11);rule();
    const packing=out.packing||{};
    const catMap=new Map();
    for(const[key,item]of Object.entries(packing)){const c=key.startsWith('Cases')?'Cases':key.startsWith('Panels')?'Panels':key.match(/ethercon|HDMI|SDI/)?'Data Cabling':key.match(/edison|powercon|white|blue/)?'Power':key.match(/Pipe and base|Rigging arm/)?'Ground Support':key.match(/bars|Megaclaw|feet/)?'Rigging':key.match(/Truss|Sched|Swivel/)?'Truss & Pipe':'System';if(!catMap.has(c))catMap.set(c,[]);catMap.get(c).push({key,...item});}
    for(const[cat,items]of catMap.entries()){chk(10+items.length*7);secH(cat);items.forEach(item=>{chk(7);doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(50,50,50);doc.text(item.key+(item.note?' ('+item.note+')':''),M,y);doc.setFont('helvetica','bold');doc.setTextColor(26,58,92);doc.text(String(item.qty),W-M,y,'right');y+=6;});y+=2;}
  }

  const tot=doc.getNumberOfPages();for(let i=1;i<=tot;i++){doc.setPage(i);doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(160,160,160);doc.text('Visual Affect — LED Planning Tool',M,295);doc.text('Page '+i+' of '+tot,W-M,295,'right');}
  doc.save((CP.name||'project').replace(/[^a-z0-9]/gi,'_')+'_led_plan.pdf');
}

// ── JOB HISTORY ─────────────────────────────────────────────

async function _loadJobHistory() {
  const el = document.getElementById('proj-history-wrap'); if (!el || !CP) return;
  el.innerHTML = '<div class="loading-state" style="padding:30px"><div class="spinner"></div></div>';

  const rows = [];

  // Lead
  if (CP.lead_id || CP.proposal_id) {
    // Try to find lead via proposal
    if (CP.proposal_id) {
      const { data: prop } = await supabase.from('proposals').select('lead_id,title,created_at,status').eq('id', CP.proposal_id).single();
      if (prop?.lead_id) {
        const { data: lead } = await supabase.from('leads').select('id,first_name,last_name,status,created_at,notes').eq('id', prop.lead_id).single();
        if (lead) rows.push({ type:'lead', icon:'📋', label:'Lead', data: lead });
      }
      if (prop) rows.push({ type:'proposal', icon:'📄', label:'Proposal', data: prop });
    }
  }

  // This project
  rows.push({ type:'project', icon:'📐', label:'Project', data: CP, current: true });

  // Activity log
  const { data: activity } = await supabase.from('activity_log')
    .select('*,profiles!activity_log_performed_by_fkey(first_name,last_name)')
    .or(`entity_id.eq.${CP.id}${CP.proposal_id?',entity_id.eq.'+CP.proposal_id:''}`)
    .order('created_at', { ascending: false })
    .limit(50);

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">

      <!-- Journey timeline -->
      <div class="card" style="padding:16px">
        <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:14px">Job Journey</div>
        <div style="display:flex;align-items:center;gap:0;flex-wrap:wrap">
          ${rows.map((r, i) => `
            <div style="display:flex;align-items:center;gap:0">
              <div style="background:${r.current?'#eff6ff':'#f9fafb'};border:1.5px solid ${r.current?'#2563eb':'var(--color-border-light)'};border-radius:8px;padding:12px 16px;min-width:160px">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:4px">${r.icon} ${r.label}</div>
                <div style="font-weight:600;font-size:13px;margin-bottom:4px">${escH(r.type==='lead'?r.data.first_name+' '+r.data.last_name:r.data.title||r.data.name||'—')}</div>
                <div style="font-size:11px;color:var(--color-muted)">${new Date(r.data.created_at).toLocaleDateString()}</div>
                ${!r.current && r.type==='proposal' && CP.proposal_id?`<button class="btn" style="margin-top:8px;font-size:11px;padding:3px 8px;width:100%" onclick="window.navigateTo('proposals');setTimeout(()=>window.Proposals?.openProposal?.('${CP.proposal_id}'),300)">View →</button>`:''}
              </div>
              ${i < rows.length-1 ? `<div style="width:28px;height:2px;background:var(--color-border-light);flex-shrink:0"></div>` : ''}
            </div>`).join('')}
        </div>
      </div>

      <!-- Lead details if available -->
      ${rows.find(r=>r.type==='lead') ? (() => {
        const lead = rows.find(r=>r.type==='lead').data;
        return `<div class="card" style="padding:16px">
          <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Original Lead Info</div>
          <div class="form-grid form-grid-2" style="gap:8px">
            <div><div class="form-label">Contact</div><div style="font-size:13px;margin-top:3px">${escH(lead.first_name+' '+lead.last_name)}</div></div>
            <div><div class="form-label">Lead Status</div><div style="font-size:13px;margin-top:3px">${escH(lead.status||'')}</div></div>
            ${lead.notes?`<div style="grid-column:1/-1"><div class="form-label">Initial Notes</div><div style="font-size:13px;margin-top:3px;line-height:1.6">${escH(lead.notes)}</div></div>`:''}
          </div>
        </div>`;
      })() : ''}

      <!-- Activity log -->
      <div class="card" style="padding:16px">
        <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Full Activity Log</div>
        ${!activity?.length
          ? `<div class="empty-state" style="padding:20px"><div class="empty-title">No activity logged yet</div></div>`
          : `<div style="display:flex;flex-direction:column;gap:6px">${activity.map(a=>`
              <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f3f4f6">
                <div style="flex:1">
                  <div style="font-size:13px">
                    <strong>${a.profiles?a.profiles.first_name+' '+a.profiles.last_name:'System'}</strong>
                    <span style="color:var(--color-muted)"> ${escH((a.action||'').replace(/_/g,' '))}</span>
                    <span style="font-size:10px;background:#f1f5f9;padding:1px 6px;border-radius:3px;margin-left:4px">${escH(a.entity_type||'')}</span>
                  </div>
                  ${a.metadata?.status||a.metadata?.stage?`<div class="text-small text-muted">→ ${escH(a.metadata.status||a.metadata.stage)}</div>`:''}
                </div>
                <div class="text-small text-muted" style="flex-shrink:0">${new Date(a.created_at).toLocaleString()}</div>
              </div>`).join('')}
          </div>`}
      </div>
    </div>`;
}

// ── HELPERS ─────────────────────────────────────────────────
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(d){if(!d)return'';return new Date(d+'T00:00:00').toLocaleDateString();}
function showToast(msg,type='success'){window.showToast?.(msg,type);}

// ── GLOBAL EXPOSURE ─────────────────────────────────────────
async function _loadProjTasks() {
  const el = document.getElementById('proj-tasks-wrap'); if (!el) return;
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*,profiles!tasks_assigned_to_fkey(first_name,last_name)')
    .eq('project_id', CP.id)
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error || !tasks?.length) {
    el.innerHTML = `<div class="empty-state" style="padding:40px">
      <div class="empty-icon">✅</div>
      <div class="empty-title">No tasks yet</div>
      <p class="empty-sub">Tasks assigned to this project will appear here.<br>Create them in the <strong>Tasks</strong> section.</p>
    </div>`; return;
  }
  const priorityColor = { low:'#6b7280', medium:'#2563eb', high:'#d97706', urgent:'#dc2626' };
  const statusLabel = { todo:'To Do', in_progress:'In Progress', review:'Review', done:'Done' };
  el.innerHTML = `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Due</th></tr></thead>
    <tbody>${tasks.map(t => `<tr>
      <td><strong>${escH(t.title)}</strong>${t.description?`<div class="text-small text-muted">${escH(t.description.substring(0,60))}${t.description.length>60?'...':''}</div>`:''}</td>
      <td><span style="color:${priorityColor[t.priority]||'#6b7280'};font-weight:600;font-size:12px;text-transform:uppercase">${t.priority||'—'}</span></td>
      <td><span class="tag ${t.status==='done'?'tag-green':t.status==='in_progress'?'tag-blue':'tag-gray'}">${statusLabel[t.status]||t.status}</span></td>
      <td class="text-small">${t.profiles?`${t.profiles.first_name} ${t.profiles.last_name}`:'Unassigned'}</td>
      <td class="text-small">${t.due_date?new Date(t.due_date+'T00:00:00').toLocaleDateString():'—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function _loadProjLogistics() {
  const el = document.getElementById('proj-logistics-wrap');
  if (!el) return;

  // Dynamically import logistics module and render inline
  try {
    const { openProjectLogistics } = await import('./logistics.js');

    // Temporarily redirect main-content to our logistics wrap
    // We render logistics controls inline by calling the module's open function
    // but pointing output to proj-logistics-wrap

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:13px;color:var(--color-muted)">Full logistics for this project</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-blue" onclick="window.Logistics?.exportCallSheet?.()">⬇ Call Sheet PDF</button>
          <button class="btn btn-primary" onclick="window.navigateTo('logistics');setTimeout(()=>window.Logistics?.openProjectLogistics?.('${CP?.id}','${escH(CP?.name||'')}'),200)">
            Open Full Logistics View →
          </button>
        </div>
      </div>
      <div id="inline-logistics-body"><div class="loading-state"><div class="spinner"></div></div></div>`;

    // Load the logistics data and render a summary inline
    await _renderInlineLogistics();
  } catch(e) {
    console.error('[Logistics inline]', e);
    el.innerHTML = `
      <div class="card" style="text-align:center;padding:30px">
        <div style="font-size:36px;margin-bottom:12px">🗓</div>
        <div style="font-family:'Barlow',sans-serif;font-size:17px;font-weight:700;margin-bottom:8px">Project Logistics</div>
        <p style="font-size:13px;color:var(--color-muted);margin-bottom:16px">
          Manage venue details, schedule, crew, trucking, files and more.
        </p>
        <button class="btn btn-primary" onclick="window.navigateTo('logistics');setTimeout(()=>window.Logistics?.openProjectLogistics?.('${CP?.id}','${escH(CP?.name||'')}'),300)">
          Open Logistics →
        </button>
      </div>`;
  }
}

async function _renderInlineLogistics() {
  const el = document.getElementById('inline-logistics-body');
  if (!el || !CP) return;

  const { data: logistics } = await supabase
    .from('logistics')
    .select('*')
    .eq('project_id', CP.id)
    .single();

  if (!logistics) {
    el.innerHTML = `<div class="alert alert-warn">No logistics data yet. Click "Open Full Logistics View" to get started.</div>`;
    return;
  }

  const s = logistics.schedule || {};
  const legs = Array.isArray(logistics.trucking) ? logistics.trucking : [];
  const hasVenue = logistics.venue_name || logistics.venue_address;
  const hasSchedule = s.loadIn?.date || s.showDays?.length || s.loadOut?.date;
  const hasTrucking = legs.length > 0;
  const hasScope = logistics.scope_of_work;

  el.innerHTML = `
    <div class="summary-grid" style="margin-bottom:20px">
      <div class="summary-card">
        <div class="summary-card-label">Venue</div>
        <div style="font-size:14px;font-weight:600;color:var(--color-text);margin-top:4px">${logistics.venue_name ? escH(logistics.venue_name) : '<span style="color:var(--color-muted)">Not set</span>'}</div>
        ${logistics.venue_address ? `<div class="summary-card-sub">${escH(logistics.venue_address)}</div>` : ''}
        ${logistics.venue_contact_name ? `<div class="summary-card-sub">👤 ${escH(logistics.venue_contact_name)}</div>` : ''}
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Load In</div>
        <div style="font-size:14px;font-weight:600;color:var(--color-text);margin-top:4px">${s.loadIn?.date ? fmtDate(s.loadIn.date) : '<span style="color:var(--color-muted)">Not set</span>'}</div>
        ${s.loadIn?.time ? `<div class="summary-card-sub">${fmtTime(s.loadIn.time)}</div>` : ''}
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Show Days</div>
        <div class="summary-card-value">${s.showDays?.filter(sd=>sd.date).length || 0}</div>
        <div class="summary-card-sub">${s.showDays?.filter(sd=>sd.date).map(sd=>fmtDate(sd.date)).join(', ') || 'None set'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Load Out</div>
        <div style="font-size:14px;font-weight:600;color:var(--color-text);margin-top:4px">${s.loadOut?.date ? fmtDate(s.loadOut.date) : '<span style="color:var(--color-muted)">Not set</span>'}</div>
        ${s.loadOut?.time ? `<div class="summary-card-sub">${fmtTime(s.loadOut.time)}</div>` : ''}
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Trucking</div>
        <div class="summary-card-value">${legs.length}</div>
        <div class="summary-card-sub">${legs.length ? legs.map(l=>escH(l.method)).join(', ') : 'None added'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-card-label">Scope of Work</div>
        <div style="font-size:13px;margin-top:4px;color:${logistics.scope_of_work?'var(--color-text)':'var(--color-muted)'}">${logistics.scope_of_work ? logistics.scope_of_work.substring(0,80)+'...' : 'Not written yet'}</div>
      </div>
    </div>

    ${hasVenue || hasSchedule || hasTrucking ? '' : `<div class="alert alert-warn" style="margin-bottom:16px">Logistics not filled in yet. Click "Open Full Logistics View" to add details.</div>`}

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="window.navigateTo('logistics');setTimeout(()=>window.Logistics?.openProjectLogistics?.('${CP?.id}','${escH(CP?.name||'')}'),300)">
        Open Full Logistics View →
      </button>
      ${hasSchedule ? `<button class="btn btn-blue" onclick="window.Logistics?.exportCallSheet?.()">⬇ Call Sheet PDF</button>` : ''}
    </div>`;

  // Make logistics available for PDF export
  try {
    const mod = await import('./logistics.js');
    if (mod.openProjectLogistics) {
      // Pre-load logistics data so PDF export works
      await mod.openProjectLogistics(CP.id, CP.name);
    }
  } catch(e) {}
}

function fmtTime(t){if(!t)return'';const[h,m]=t.split(':');const hr=parseInt(h);return`${hr%12||12}:${m} ${hr<12?'AM':'PM'}`;}

function _addShowDay() {
  if (!wAns.showDays) wAns.showDays=[]; 
  wAns.showDays.push({date:'',startTime:'',endTime:''});
  _renderStep();
}
function _removeShowDay(i) {
  if (!wAns.showDays||wAns.showDays.length<=1) return;
  // save current values before re-render
  const dates=[...document.querySelectorAll('.show-day-date')].map(el=>el.value||'');
  const starts=[...document.querySelectorAll('.show-day-start')].map(el=>el.value||'');
  const ends=[...document.querySelectorAll('.show-day-end')].map(el=>el.value||'');
  wAns.showDays=dates.map((d,idx)=>({date:d,startTime:starts[idx]||'',endTime:ends[idx]||''}));
  wAns.showDays.splice(i,1);
  _renderStep();
}
window.Projects={
  openWizard,closeWizard,openProject,deleteProject,setStatus,exportPDF,openCreateProposal,
  addWall,deleteWall,switchWall,switchDiag,showTab,openAssign,removeAssign,_loadTeam,
  openConfigWall,_saveConfigWall,
  _wSel,_wSelPanel,_wSelClient,_wNext,_wBack,_wFinish,_saveWall,_doAssign,_addShowDay,_removeShowDay,setPackView,_loadProjLogistics,
};
