// ============================================================
// logistics.js — Project Logistics Module
// Venue, Schedule, Scope, Crew, Trucking, Rentals, Files, Tasks
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile } from './auth.js';

// ============================================================
// RENDER — standalone Logistics section (sidebar nav)
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading...</div></div>`;
  const { data: projects } = await supabase
    .from('projects')
    .select('id,name,address,status,event_start_date')
    .order('event_start_date', { ascending: true, nullsFirst: false });

  container.innerHTML = `
    <div class="section-header">
      <div><div class="section-title">Logistics</div>
           <div class="section-sub">Select a project to manage its logistics</div></div>
    </div>
    ${!projects?.length
      ? `<div class="empty-state"><div class="empty-icon">🗓</div><div class="empty-title">No projects yet</div></div>`
      : `<div class="card-grid">${projects.map(p => `
          <div class="project-card">
            <div class="tag tag-${p.status==='active'?'green':p.status==='confirmed'?'blue':'yellow'}" style="margin-bottom:8px">${p.status}</div>
            <div style="font-family:'Barlow',sans-serif;font-size:17px;font-weight:700;margin-bottom:4px">${escH(p.name)}</div>
            <div class="text-small text-muted">${p.address?`📍 ${escH(p.address)}<br>`:''}${p.event_start_date?`📅 ${fmtDate(p.event_start_date)}`:'No dates set'}</div>
            <div style="margin-top:12px">
              <button class="btn btn-primary" style="font-size:12px;padding:6px 14px"
                onclick="window.Logistics.openProjectLogistics('${p.id}','${escH(p.name)}')">Open Logistics →</button>
            </div>
          </div>`).join('')}</div>`}`;
}

// ============================================================
// PROJECT LOGISTICS VIEW
// ============================================================

let CL = null;
let CP_ID = null;
let CP_NAME = null;

export async function openProjectLogistics(projectId, projectName) {
  CP_ID = projectId;
  CP_NAME = projectName || 'Project';
  const mc = document.getElementById('main-content');
  mc.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading logistics...</div></div>`;

  const { data: project } = await supabase.from('projects').select('*,clients(*)').eq('id', projectId).single();
  CP_NAME = project?.name || CP_NAME;

  let { data: logistics } = await supabase.from('logistics').select('*').eq('project_id', projectId).single();
  if (!logistics) {
    const { data: newLog } = await supabase.from('logistics').insert({ project_id: projectId }).select().single();
    logistics = newLog;
  }
  CL = logistics;
  _renderView(mc, project);
}

function _renderView(mc, project) {
  const p = project;
  mc.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn" onclick="window.navigateTo('logistics')" style="font-size:12px;padding:5px 11px">← Logistics</button>
      <div>
        <div style="font-family:'Barlow',sans-serif;font-size:22px;font-weight:800">${escH(CP_NAME)}</div>
        <div class="text-small text-muted">${p?.address?`📍 ${escH(p.address)} `:''} ${p?.event_start_date?`📅 ${fmtDate(p.event_start_date)}`:''}</div>
      </div>
      <div style="margin-left:auto">
        <button class="btn btn-blue" onclick="window.Logistics.exportCallSheet()">⬇ Call Sheet PDF</button>
      </div>
    </div>
    <div class="tab-bar">
      <button class="tab-btn active" id="ltb-venue"    onclick="window.Logistics.showLTab('venue')">Venue</button>
      <button class="tab-btn"        id="ltb-schedule" onclick="window.Logistics.showLTab('schedule')">Schedule</button>
      <button class="tab-btn"        id="ltb-scope"    onclick="window.Logistics.showLTab('scope')">Scope of Work</button>
      <button class="tab-btn"        id="ltb-crew"     onclick="window.Logistics.showLTab('crew')">Crew</button>
      <button class="tab-btn"        id="ltb-trucking" onclick="window.Logistics.showLTab('trucking')">Trucking</button>
      <button class="tab-btn"        id="ltb-rentals"  onclick="window.Logistics.showLTab('rentals')">Outside Rentals</button>
      <button class="tab-btn"        id="ltb-files"    onclick="window.Logistics.showLTab('files')">Files</button>
      <button class="tab-btn"        id="ltb-tasks"    onclick="window.Logistics.showLTab('tasks')">Tasks</button>
    </div>
    <div class="tab-panel active" id="ltp-venue">${_venueTab()}</div>
    <div class="tab-panel" id="ltp-schedule">${_scheduleTab()}</div>
    <div class="tab-panel" id="ltp-scope">${_scopeTab()}</div>
    <div class="tab-panel" id="ltp-crew"><div id="crew-wrap"><div class="loading-state"><div class="spinner"></div></div></div></div>
    <div class="tab-panel" id="ltp-trucking">${_truckingTab()}</div>
    <div class="tab-panel" id="ltp-rentals"><div id="rentals-wrap"><div class="loading-state"><div class="spinner"></div></div></div></div>
    <div class="tab-panel" id="ltp-files"><div id="files-wrap"><div class="loading-state"><div class="spinner"></div></div></div></div>
    <div class="tab-panel" id="ltp-tasks"><div id="ltasks-wrap"><div class="loading-state"><div class="spinner"></div></div></div></div>`;
}

function showLTab(name) {
  ['venue','schedule','scope','crew','trucking','rentals','files','tasks'].forEach(t => {
    document.getElementById('ltb-'+t)?.classList.toggle('active', t===name);
    document.getElementById('ltp-'+t)?.classList.toggle('active', t===name);
  });
  if (name==='crew') _loadCrew();
  if (name==='rentals') _loadRentals();
  if (name==='files') _loadFiles();
  if (name==='tasks') _loadTasks();
}

// ── VENUE ───────────────────────────────────────────────────
function _venueTab() {
  const l = CL||{};
  return `<div class="card" style="margin-bottom:14px">
    <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:16px">Venue & Jobsite</div>
    <div class="form-grid form-grid-2" style="gap:12px;margin-bottom:12px">
      <div class="form-field"><label class="form-label">Venue Name</label><input class="form-input" id="v-vname" placeholder="e.g. Baltimore Convention Center" value="${escH(l.venue_name||'')}"></div>
      <div class="form-field"><label class="form-label">Venue Address</label><input class="form-input" id="v-vaddr" value="${escH(l.venue_address||'')}"></div>
      <div class="form-field"><label class="form-label">Venue Contact Name</label><input class="form-input" id="v-vcname" value="${escH(l.venue_contact_name||'')}"></div>
      <div class="form-field"><label class="form-label">Venue Contact Phone</label><input class="form-input" id="v-vcphone" value="${escH(l.venue_contact_phone||'')}"></div>
      <div class="form-field"><label class="form-label">Venue Contact Email</label><input class="form-input" id="v-vcemail" value="${escH(l.venue_contact_email||'')}"></div>
      <div class="form-field"><label class="form-label">Floor Type</label><input class="form-input" id="v-floor" placeholder="e.g. Concrete, Carpet, Wood" value="${escH(l.floor_type||'')}"></div>
    </div>
    <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;margin:14px 0 10px">Room Dimensions</div>
    <div class="form-grid form-grid-3" style="gap:12px;margin-bottom:12px">
      <div class="form-field"><label class="form-label">Length (ft)</label><input class="form-input" id="v-rlen" type="number" value="${l.room_length_ft||''}"></div>
      <div class="form-field"><label class="form-label">Width (ft)</label><input class="form-input" id="v-rwid" type="number" value="${l.room_width_ft||''}"></div>
      <div class="form-field"><label class="form-label">Ceiling Height (ft)</label><input class="form-input" id="v-rceil" type="number" value="${l.ceiling_height_ft||''}"></div>
    </div>
    <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;margin:14px 0 10px">Site Notes</div>
    <div class="form-grid form-grid-2" style="gap:12px;margin-bottom:16px">
      <div class="form-field"><label class="form-label">Load-In Access</label><textarea class="form-input form-textarea" id="v-loadaccess" placeholder="Dock number, door codes, elevator...">${escH(l.load_in_access||'')}</textarea></div>
      <div class="form-field"><label class="form-label">Parking</label><textarea class="form-input form-textarea" id="v-parking" placeholder="Lot info, permits...">${escH(l.parking_notes||'')}</textarea></div>
      <div class="form-field"><label class="form-label">Power Location</label><textarea class="form-input form-textarea" id="v-power" placeholder="Panel location, circuits, distance...">${escH(l.power_notes||'')}</textarea></div>
      <div class="form-field"><label class="form-label">Rigging Points</label><textarea class="form-input form-textarea" id="v-rigging" placeholder="Point locations, weight limits...">${escH(l.rigging_notes||'')}</textarea></div>
    </div>
    <button class="btn btn-primary" onclick="window.Logistics.saveVenue()">Save Venue Info</button>
    <div id="venue-msg" class="mok" style="margin-top:8px"></div>
  </div>`;
}

async function saveVenue() {
  const u = {
    venue_name: _v('v-vname'), venue_address: _v('v-vaddr'),
    venue_contact_name: _v('v-vcname'), venue_contact_phone: _v('v-vcphone'), venue_contact_email: _v('v-vcemail'),
    floor_type: _v('v-floor'),
    room_length_ft: parseFloat(_v('v-rlen'))||null, room_width_ft: parseFloat(_v('v-rwid'))||null, ceiling_height_ft: parseFloat(_v('v-rceil'))||null,
    load_in_access: _v('v-loadaccess'), parking_notes: _v('v-parking'), power_notes: _v('v-power'), rigging_notes: _v('v-rigging'),
  };
  const { error } = await supabase.from('logistics').update(u).eq('id', CL.id);
  if (error) { _msg('venue-msg','Save failed.',true); return; }
  Object.assign(CL, u); _msg('venue-msg','✓ Saved.');
}

// ── SCHEDULE ────────────────────────────────────────────────
function _scheduleTab() {
  const s = CL?.schedule||{};
  const li = s.loadIn||{}, lo = s.loadOut||{};
  const days = s.showDays||[{date:'',startTime:'',endTime:'',notes:''}];
  return `<div class="card" style="margin-bottom:14px">
    <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:16px">Event Schedule</div>
    <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:16px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">🚛 Load In</div>
      <div class="form-grid form-grid-2" style="gap:10px">
        <div class="form-field"><label class="form-label">Date</label><input class="form-input" id="s-lidate" type="date" value="${escH(li.date||'')}"></div>
        <div class="form-field"><label class="form-label">Start Time</label><input class="form-input" id="s-litime" type="time" value="${escH(li.time||'')}"></div>
        <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label><textarea class="form-input form-textarea" id="s-linotes">${escH(li.notes||'')}</textarea></div>
      </div>
    </div>
    <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:16px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">🎬 Show Days</div>
      <div id="show-days-con">${days.map((sd,i)=>_showDayRow(sd,i)).join('')}</div>
      <button class="btn" style="margin-top:10px;font-size:12px" onclick="window.Logistics.addShowDay()">+ Add Show Day</button>
    </div>
    <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">🚛 Load Out</div>
      <div class="form-grid form-grid-2" style="gap:10px">
        <div class="form-field"><label class="form-label">Date</label><input class="form-input" id="s-lodate" type="date" value="${escH(lo.date||'')}"></div>
        <div class="form-field"><label class="form-label">Start Time</label><input class="form-input" id="s-lotime" type="time" value="${escH(lo.time||'')}"></div>
        <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label><textarea class="form-input form-textarea" id="s-lonotes">${escH(lo.notes||'')}</textarea></div>
      </div>
    </div>
    <button class="btn btn-primary" onclick="window.Logistics.saveSchedule()">Save Schedule</button>
    <div id="schedule-msg" class="mok" style="margin-top:8px"></div>
  </div>`;
}

function _showDayRow(sd, i) {
  return `<div class="sd-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--color-border-light)">
    <div><label class="form-label">Date</label><input class="form-input sd-date" type="date" value="${escH(sd.date||'')}"></div>
    <div><label class="form-label">Doors/Start</label><input class="form-input sd-start" type="time" value="${escH(sd.startTime||'')}"></div>
    <div><label class="form-label">Show End</label><input class="form-input sd-end" type="time" value="${escH(sd.endTime||'')}"></div>
    <div><label class="form-label">Notes</label><input class="form-input sd-notes" type="text" placeholder="e.g. 2 shows" value="${escH(sd.notes||'')}"></div>
    <div style="padding-top:18px"><button class="btn btn-danger" style="padding:8px 10px" onclick="window.Logistics.removeShowDay(${i})">✕</button></div>
  </div>`;
}

function _collectSchedule() {
  const rows = document.querySelectorAll('.sd-row');
  const showDays = [...rows].map(r => ({
    date: r.querySelector('.sd-date')?.value||'',
    startTime: r.querySelector('.sd-start')?.value||'',
    endTime: r.querySelector('.sd-end')?.value||'',
    notes: r.querySelector('.sd-notes')?.value||'',
  }));
  return {
    loadIn: { date: _v('s-lidate'), time: _v('s-litime'), notes: _v('s-linotes') },
    showDays,
    loadOut: { date: _v('s-lodate'), time: _v('s-lotime'), notes: _v('s-lonotes') },
  };
}

function addShowDay() {
  const s = _collectSchedule(); s.showDays.push({date:'',startTime:'',endTime:'',notes:''});
  document.getElementById('show-days-con').innerHTML = s.showDays.map((sd,i)=>_showDayRow(sd,i)).join('');
}

function removeShowDay(i) {
  const s = _collectSchedule(); if (s.showDays.length<=1) return;
  s.showDays.splice(i,1);
  document.getElementById('show-days-con').innerHTML = s.showDays.map((sd,idx)=>_showDayRow(sd,idx)).join('');
}

async function saveSchedule() {
  const schedule = _collectSchedule();
  const { error } = await supabase.from('logistics').update({ schedule }).eq('id', CL.id);
  if (error) { _msg('schedule-msg','Save failed.',true); return; }
  CL.schedule = schedule; _msg('schedule-msg','✓ Schedule saved.');
}

// ── SCOPE ───────────────────────────────────────────────────
function _scopeTab() {
  return `<div class="card">
    <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:12px">Scope of Work</div>
    <textarea class="form-input form-textarea" id="scope-text" rows="16"
      style="font-family:'Inter',sans-serif;font-size:13px;line-height:1.7"
      placeholder="Describe the full scope of work for this project...">${escH(CL?.scope_of_work||'')}</textarea>
    <div style="display:flex;gap:10px;margin-top:12px;align-items:center">
      <button class="btn btn-primary" onclick="window.Logistics.saveScope()">Save Scope</button>
    </div>
    <div id="scope-msg" class="mok" style="margin-top:8px"></div>
  </div>`;
}

async function saveScope() {
  const scope = document.getElementById('scope-text')?.value||'';
  const { error } = await supabase.from('logistics').update({ scope_of_work: scope }).eq('id', CL.id);
  if (error) { _msg('scope-msg','Save failed.',true); return; }
  CL.scope_of_work = scope; _msg('scope-msg','✓ Saved.');
}

// ── CREW ────────────────────────────────────────────────────
async function _loadCrew() {
  const el = document.getElementById('crew-wrap'); if (!el) return;
  const { data: asgn } = await supabase.from('project_assignments')
    .select('*,profiles(first_name,last_name,role)').eq('project_id', CP_ID);
  const schedule = CL?.schedule||{};
  const phases = [
    { key:'load_in', label:'🚛 Load In', date: schedule.loadIn?.date },
    ...(schedule.showDays||[]).map((sd,i)=>({ key:`show_${i}`, label:`🎬 Show Day ${i+1}`, date: sd.date })),
    { key:'load_out', label:'🚛 Load Out', date: schedule.loadOut?.date },
  ];
  const crewSched = CL?.crew_schedule||{};
  el.innerHTML = `<div class="card">
    <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:14px">Crew Schedule</div>
    ${!asgn?.length ? `<div class="alert alert-warn">No team members assigned. Assign crew in the Project view first.</div>` : ''}
    <div style="overflow-x:auto"><table class="data-table">
      <thead><tr>
        <th>Crew Member</th><th>Role</th>
        ${phases.map(ph=>`<th style="white-space:nowrap;min-width:90px">${ph.label}${ph.date?`<div style="font-size:9px;color:var(--color-muted);font-weight:400">${fmtDate(ph.date)}</div>`:''}</th>`).join('')}
      </tr></thead>
      <tbody>${(asgn||[]).map(a=>`<tr>
        <td><strong>${a.profiles?.first_name} ${a.profiles?.last_name}</strong></td>
        <td><span class="badge badge-${a.profiles?.role}">${a.profiles?.role}</span></td>
        ${phases.map(ph=>{
          const key=`${a.user_id}_${ph.key}`;
          const val=crewSched[key]||{assigned:false,hours:''};
          return `<td style="text-align:center">
            <input type="checkbox" data-key="${key}" ${val.assigned?'checked':''}
              onchange="window.Logistics.toggleCrew('${key}',this.checked)">
            ${val.assigned?`<br><input type="number" placeholder="hrs" value="${escH(String(val.hours||''))}"
              style="width:50px;padding:2px 4px;font-size:11px;border:1px solid var(--color-border-light);border-radius:4px;text-align:center;margin-top:4px"
              onchange="window.Logistics.setCrewHours('${key}',this.value)">`:''}</td>`;
        }).join('')}
      </tr>`).join('')}
      </tbody>
    </table></div>
    <div id="crew-msg" class="mok" style="margin-top:8px"></div>
  </div>`;
}

async function toggleCrew(key, assigned) {
  const cs = CL.crew_schedule||{};
  cs[key] = { ...(cs[key]||{}), assigned };
  await supabase.from('logistics').update({ crew_schedule: cs }).eq('id', CL.id);
  CL.crew_schedule = cs; _loadCrew();
}

async function setCrewHours(key, hours) {
  const cs = CL.crew_schedule||{};
  cs[key] = { ...(cs[key]||{}), hours };
  await supabase.from('logistics').update({ crew_schedule: cs }).eq('id', CL.id);
  CL.crew_schedule = cs;
}

// ── TRUCKING ────────────────────────────────────────────────
const TRUCK_METHODS = [
  'Visual Affect Vehicle (own)',
  'Rented Box Truck','Rented Cargo Van','Rented Trailer (we pull)',
  'Hired Trucking Company','Client / Venue Handles','Multiple Legs',
];

function _truckingTab() {
  const legs = Array.isArray(CL?.trucking) ? CL.trucking : [];
  return `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700">Trucking & Transport</div>
      <div style="display:flex;gap:8px">
        <button class="btn-add" onclick="window.Logistics.addTruckLeg()">+ Add Leg</button>
        <button class="btn btn-primary" onclick="window.Logistics.saveTrucking()">Save</button>
      </div>
    </div>
    <div id="truck-legs">
      ${!legs.length
        ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No trucking legs</div><p class="empty-sub">Click + Add Leg to add transport info.</p></div>`
        : legs.map((l,i)=>_truckLeg(l,i)).join('')}
    </div>
    <div id="truck-msg" class="mok" style="margin-top:8px"></div>
  </div>`;
}

function _truckLeg(leg, i) {
  return `<div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:16px;margin-bottom:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-weight:600;font-size:13px">Leg ${i+1}</div>
      <button class="btn btn-danger" style="font-size:11px;padding:5px 10px" onclick="window.Logistics.removeTruckLeg(${i})">Remove</button>
    </div>
    <div class="form-grid form-grid-2" style="gap:10px">
      <div class="form-field"><label class="form-label">Transport Method</label>
        <select class="form-select tl-method">${TRUCK_METHODS.map(m=>`<option value="${m}" ${leg.method===m?'selected':''}>${m}</option>`).join('')}</select></div>
      <div class="form-field"><label class="form-label">Vehicle / Company Name</label>
        <input class="form-input tl-name" placeholder="e.g. Penske, Ford F-250, ABC Trucking" value="${escH(leg.name||'')}"></div>
      <div class="form-field"><label class="form-label">Pickup Location</label>
        <input class="form-input tl-pfrom" placeholder="e.g. Warehouse" value="${escH(leg.pickupLocation||'')}"></div>
      <div class="form-field"><label class="form-label">Pickup Date / Time</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <input class="form-input tl-pdate" type="date" value="${escH(leg.pickupDate||'')}">
          <input class="form-input tl-ptime" type="time" value="${escH(leg.pickupTime||'')}"></div></div>
      <div class="form-field"><label class="form-label">Delivery Location</label>
        <input class="form-input tl-dto" placeholder="e.g. Convention Center Dock 3" value="${escH(leg.deliveryLocation||'')}"></div>
      <div class="form-field"><label class="form-label">Delivery Date / Time</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <input class="form-input tl-ddate" type="date" value="${escH(leg.deliveryDate||'')}">
          <input class="form-input tl-dtime" type="time" value="${escH(leg.deliveryTime||'')}"></div></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label>
        <textarea class="form-input form-textarea" style="min-height:60px" placeholder="Contact, confirmation #, special instructions...">${escH(leg.notes||'')}</textarea></div>
    </div>
  </div>`;
}

function _collectLegs() {
  return [...(document.getElementById('truck-legs')?.querySelectorAll('[style*="padding:16px"]')||[])].map(el=>({
    method: el.querySelector('.tl-method')?.value||'',
    name: el.querySelector('.tl-name')?.value.trim()||'',
    pickupLocation: el.querySelector('.tl-pfrom')?.value.trim()||'',
    pickupDate: el.querySelector('.tl-pdate')?.value||'',
    pickupTime: el.querySelector('.tl-ptime')?.value||'',
    deliveryLocation: el.querySelector('.tl-dto')?.value.trim()||'',
    deliveryDate: el.querySelector('.tl-ddate')?.value||'',
    deliveryTime: el.querySelector('.tl-dtime')?.value||'',
    notes: el.querySelector('textarea')?.value.trim()||'',
  })).filter(l=>l.method);
}

function addTruckLeg() {
  const legs = _collectLegs();
  legs.push({ method:TRUCK_METHODS[0], name:'', pickupLocation:'', pickupDate:'', pickupTime:'', deliveryLocation:'', deliveryDate:'', deliveryTime:'', notes:'' });
  document.getElementById('truck-legs').innerHTML = legs.map((l,i)=>_truckLeg(l,i)).join('');
}

function removeTruckLeg(i) {
  const legs = _collectLegs(); legs.splice(i,1);
  const el = document.getElementById('truck-legs');
  el.innerHTML = !legs.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No trucking legs</div></div>`
    : legs.map((l,idx)=>_truckLeg(l,idx)).join('');
}

async function saveTrucking() {
  const legs = _collectLegs();
  const { error } = await supabase.from('logistics').update({ trucking: legs }).eq('id', CL.id);
  if (error) { _msg('truck-msg','Save failed.',true); return; }
  CL.trucking = legs; _msg('truck-msg','✓ Trucking saved.');
}

// ── OUTSIDE RENTALS ─────────────────────────────────────────
async function _loadRentals() {
  const el = document.getElementById('rentals-wrap'); if (!el) return;
  const [{ data: rentals }, { data: vendors }] = await Promise.all([
    supabase.from('project_rentals').select('*,vendors(name,specialty)').eq('project_id', CP_ID).order('created_at'),
    supabase.from('vendors').select('id,name,specialty').order('name'),
  ]);
  el.innerHTML = `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700">Outside Rentals</div>
      <button class="btn-add" onclick="document.getElementById('rental-modal').classList.add('open')">+ Add Rental</button>
    </div>
    ${!rentals?.length
      ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No outside rentals yet</div></div>`
      : `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Vendor</th><th>Item</th><th>Qty</th><th>Cost</th><th>Dates</th><th>Notes</th><th></th></tr></thead>
          <tbody>${rentals.map(r=>`<tr>
            <td><strong>${escH(r.vendors?.name||'—')}</strong><div class="text-small text-muted">${escH(r.vendors?.specialty||'')}</div></td>
            <td>${escH(r.item_description)}</td><td>${r.qty}</td>
            <td>${r.cost?'$'+Number(r.cost).toFixed(2):'—'}</td>
            <td class="text-small">${r.rental_start?fmtDate(r.rental_start):''}${r.rental_end?' → '+fmtDate(r.rental_end):''}</td>
            <td class="text-small text-muted">${escH(r.notes||'')}</td>
            <td><button class="btn btn-danger" style="font-size:11px;padding:4px 9px" onclick="window.Logistics.deleteRental('${r.id}')">✕</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`}

    <div class="modal-overlay" id="rental-modal">
      <div class="modal" style="max-width:520px">
        <div class="modal-header"><div class="modal-title">Add Outside Rental</div>
          <button class="modal-close" onclick="document.getElementById('rental-modal').classList.remove('open')">✕</button></div>
        <div class="form-grid form-grid-2" style="gap:12px;margin-bottom:14px">
          <div class="form-field" style="grid-column:1/-1"><label class="form-label">Vendor *</label>
            <select class="form-select" id="r-vendor">
              <option value="">Select vendor...</option>
              ${(vendors||[]).map(v=>`<option value="${v.id}">${escH(v.name)}${v.specialty?' — '+escH(v.specialty):''}</option>`).join('')}
            </select>
            ${!vendors?.length?`<div class="text-small text-muted" style="margin-top:4px">No vendors yet. Add vendors in Admin → Vendors.</div>`:''}</div>
          <div class="form-field" style="grid-column:1/-1"><label class="form-label">Item Description *</label>
            <input class="form-input" id="r-item" placeholder="e.g. 20ft Truss, Generator, Scissor Lift"></div>
          <div class="form-field"><label class="form-label">Quantity</label><input class="form-input" id="r-qty" type="number" value="1" min="1"></div>
          <div class="form-field"><label class="form-label">Cost</label><input class="form-input" id="r-cost" type="number" placeholder="0.00" min="0" step="0.01"></div>
          <div class="form-field"><label class="form-label">Rental Start</label><input class="form-input" id="r-start" type="date"></div>
          <div class="form-field"><label class="form-label">Rental End</label><input class="form-input" id="r-end" type="date"></div>
          <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label>
            <textarea class="form-input form-textarea" id="r-notes" placeholder="Delivery info, contact, confirmation #..."></textarea></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn" onclick="document.getElementById('rental-modal').classList.remove('open')">Cancel</button>
          <button class="btn btn-primary" onclick="window.Logistics.saveRental()">Add Rental</button>
        </div>
        <div id="rental-msg" class="merr" style="margin-top:8px"></div>
      </div>
    </div>
  </div>`;
}

async function saveRental() {
  const item = document.getElementById('r-item')?.value.trim();
  if (!item) { _msg('rental-msg','Item description required.',true); return; }
  const { error } = await dbInsert('project_rentals', {
    project_id: CP_ID,
    vendor_id: document.getElementById('r-vendor')?.value||null,
    item_description: item,
    qty: parseInt(document.getElementById('r-qty')?.value)||1,
    cost: parseFloat(document.getElementById('r-cost')?.value)||0,
    rental_start: document.getElementById('r-start')?.value||null,
    rental_end: document.getElementById('r-end')?.value||null,
    notes: document.getElementById('r-notes')?.value.trim()||'',
    created_by: getProfile().id,
  });
  if (error) { _msg('rental-msg','Failed to save.',true); return; }
  document.getElementById('rental-modal')?.classList.remove('open');
  showToast('Rental added!','success'); _loadRentals();
}

async function deleteRental(id) {
  if (!confirm('Remove this rental?')) return;
  await dbDelete('project_rentals', id);
  showToast('Removed.','success'); _loadRentals();
}

// ── FILES ───────────────────────────────────────────────────
async function _loadFiles() {
  const el = document.getElementById('files-wrap'); if (!el) return;
  const { data: files } = await supabase.from('project_files')
    .select('*,profiles(first_name,last_name)').eq('project_id', CP_ID)
    .order('folder_path').order('created_at', { ascending: false });

  const folderMap = new Map();
  (files||[]).forEach(f => {
    const folder = f.folder_path||'/';
    if (!folderMap.has(folder)) folderMap.set(folder,[]);
    folderMap.get(folder).push(f);
  });

  const icon = t => t?.includes('image')?'🖼':t?.includes('pdf')?'📄':t?.includes('video')?'🎬':'📁';

  el.innerHTML = `<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700">Project Files</div>
      <button class="btn-add" onclick="document.getElementById('file-modal').classList.add('open')">+ Upload File</button>
    </div>
    ${!files?.length
      ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No files uploaded yet</div><p class="empty-sub">Upload venue layouts, stage plots, rider docs, contracts, and more.</p></div>`
      : [...folderMap.entries()].map(([folder,ff])=>`
          <div style="margin-bottom:16px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--color-border-light)">
              📂 ${folder==='/'?'General':escH(folder)}</div>
            ${ff.map(f=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
              <span style="font-size:20px">${icon(f.file_type)}</span>
              <div style="flex:1;min-width:0">
                <div style="font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(f.file_name)}</div>
                <div class="text-small text-muted">${f.profiles?.first_name||''} ${f.profiles?.last_name||''} · ${new Date(f.created_at).toLocaleDateString()} · ${fmtBytes(f.file_size)}</div>
              </div>
              <div style="display:flex;gap:6px">
                <a href="${f.storage_url}" target="_blank" class="btn" style="font-size:11px;padding:4px 9px">⬇</a>
                <button class="btn btn-danger" style="font-size:11px;padding:4px 9px" onclick="window.Logistics.deleteFile('${f.id}','${escH(f.storage_path)}')">✕</button>
              </div>
            </div>`).join('')}
          </div>`).join('')}

    <div class="modal-overlay" id="file-modal">
      <div class="modal" style="max-width:440px">
        <div class="modal-header"><div class="modal-title">Upload File</div>
          <button class="modal-close" onclick="document.getElementById('file-modal').classList.remove('open')">✕</button></div>
        <div class="form-field" style="margin-bottom:12px"><label class="form-label">Folder (optional)</label>
          <input class="form-input" id="f-folder" placeholder="e.g. Venue Docs, Stage Plots" list="fdl">
          <datalist id="fdl"><option value="Venue Docs"><option value="Stage Plots"><option value="Contracts"><option value="Riders"><option value="Photos"><option value="CAD Files"></datalist></div>
        <div class="form-field" style="margin-bottom:16px"><label class="form-label">Files *</label>
          <input type="file" id="f-file" multiple style="font-size:13px;padding:8px 0"></div>
        <div id="f-progress" style="font-size:12px;color:var(--color-muted);margin-bottom:8px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn" onclick="document.getElementById('file-modal').classList.remove('open')">Cancel</button>
          <button class="btn btn-primary" onclick="window.Logistics.uploadFiles()">Upload</button>
        </div>
      </div>
    </div>
  </div>`;
}

async function uploadFiles() {
  const fileInput = document.getElementById('f-file');
  const folder = document.getElementById('f-folder')?.value.trim()||'/';
  const files = fileInput?.files; if (!files?.length) { alert('Select at least one file.'); return; }
  const profile = getProfile(); let uploaded = 0;
  const progress = document.getElementById('f-progress');
  for (const file of files) {
    if (progress) progress.textContent = `Uploading ${file.name}...`;
    const path = `${CP_ID}/${folder}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from('project-files').upload(path, file, { upsert: false });
    if (upErr) { console.error(upErr); continue; }
    const { data: { publicUrl } } = supabase.storage.from('project-files').getPublicUrl(path);
    await dbInsert('project_files', { project_id:CP_ID, uploaded_by:profile.id, folder_path:folder||'/', file_name:file.name, file_type:file.type, file_size:file.size, storage_path:path, storage_url:publicUrl });
    uploaded++;
  }
  document.getElementById('file-modal')?.classList.remove('open');
  showToast(`${uploaded} file${uploaded!==1?'s':''} uploaded!`,'success'); _loadFiles();
}

async function deleteFile(id, storagePath) {
  if (!confirm('Delete this file?')) return;
  await supabase.storage.from('project-files').remove([storagePath]);
  await dbDelete('project_files', id);
  showToast('File deleted.','success'); _loadFiles();
}

// ── TASKS ───────────────────────────────────────────────────
async function _loadTasks() {
  const el = document.getElementById('ltasks-wrap'); if (!el) return;
  const { data: tasks } = await supabase.from('tasks')
    .select('*,profiles!tasks_assigned_to_fkey(first_name,last_name)')
    .eq('project_id', CP_ID)
    .order('due_date', { ascending: true, nullsFirst: false });
  const pc = { low:'#6b7280', medium:'#2563eb', high:'#d97706', urgent:'#dc2626' };
  const sl = { todo:'To Do', in_progress:'In Progress', review:'Review', done:'Done' };
  el.innerHTML = !tasks?.length
    ? `<div class="empty-state" style="padding:40px"><div class="empty-icon">✅</div><div class="empty-title">No tasks for this project</div><p class="empty-sub">Create tasks in the <strong>Tasks</strong> section and assign them to this project.</p></div>`
    : `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th>Assigned To</th><th>Due Date</th></tr></thead>
        <tbody>${tasks.map(t=>`<tr>
          <td><strong>${escH(t.title)}</strong>${t.description?`<div class="text-small text-muted">${escH(t.description.substring(0,60))}${t.description.length>60?'...':''}</div>`:''}</td>
          <td><span style="color:${pc[t.priority]||'#6b7280'};font-weight:600;font-size:11px;text-transform:uppercase">${t.priority||'—'}</span></td>
          <td><span class="tag ${t.status==='done'?'tag-green':t.status==='in_progress'?'tag-blue':'tag-gray'}">${sl[t.status]||t.status}</span></td>
          <td class="text-small">${t.profiles?`${t.profiles.first_name} ${t.profiles.last_name}`:'Unassigned'}</td>
          <td class="text-small">${t.due_date?fmtDate(t.due_date):'—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
}

// ── CALL SHEET PDF ──────────────────────────────────────────
async function exportCallSheet() {
  const { jsPDF } = window.jspdf; if (!jsPDF) { alert('PDF library not loaded.'); return; }
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const W=210, M=14, cw=W-M*2; let y=M;
  const chk = n => { if (y+n>285) { doc.addPage(); y=M; } };
  const hdr = (t,sz=12) => { doc.setFontSize(sz); doc.setFont('helvetica','bold'); doc.setTextColor(26,58,92); doc.text(t,M,y); y+=sz*.45+3; };
  const rule = () => { doc.setDrawColor(180,180,180); doc.line(M,y,W-M,y); y+=4; };
  const kv = (l,v) => { chk(7); doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(50,50,50); doc.text(String(l),M,y); doc.setFont('helvetica','bold'); doc.setTextColor(26,58,92); doc.text(String(v),W-M,y,'right'); y+=6; };
  const body = t => { if (!t) return; chk(8); doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(60,60,60); const lines=doc.splitTextToSize(t,cw); doc.text(lines,M,y); y+=lines.length*5+2; };

  doc.setFillColor(26,58,92); doc.rect(0,0,W,28,'F');
  doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255); doc.text('CALL SHEET',M,13);
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(180,200,225); doc.text('Visual Affect — LED Planning Tool',M,21);
  doc.setFontSize(8); doc.setTextColor(140,175,210); doc.text(new Date().toLocaleDateString(),W-M,21,'right');
  y=34; hdr(CP_NAME,15); y+=2;

  if (CL?.venue_name) {
    chk(30); hdr('Venue',12); rule();
    kv('Venue', CL.venue_name);
    if (CL.venue_address) kv('Address', CL.venue_address);
    if (CL.venue_contact_name) kv('Contact', `${CL.venue_contact_name}${CL.venue_contact_phone?' · '+CL.venue_contact_phone:''}`);
    if (CL.ceiling_height_ft) kv('Room', `${CL.room_length_ft||'?'}ft × ${CL.room_width_ft||'?'}ft · ${CL.ceiling_height_ft}ft ceiling`);
    if (CL.floor_type) kv('Floor', CL.floor_type);
    if (CL.load_in_access) body('Load-In: '+CL.load_in_access);
    if (CL.power_notes) body('Power: '+CL.power_notes);
    if (CL.rigging_notes) body('Rigging: '+CL.rigging_notes);
    y+=4;
  }

  const s = CL?.schedule||{};
  chk(20); hdr('Schedule',12); rule();
  if (s.loadIn?.date) kv('Load In', `${fmtDate(s.loadIn.date)}${s.loadIn.time?' at '+fmtTime(s.loadIn.time):''}`);
  (s.showDays||[]).forEach((sd,i)=>{ if(sd.date) kv(`Show Day ${i+1}`,`${fmtDate(sd.date)}${sd.startTime?' · '+fmtTime(sd.startTime):''}${sd.endTime?' — '+fmtTime(sd.endTime):''}${sd.notes?' · '+sd.notes:''}`); });
  if (s.loadOut?.date) kv('Load Out', `${fmtDate(s.loadOut.date)}${s.loadOut.time?' at '+fmtTime(s.loadOut.time):''}`);
  y+=4;

  const legs = Array.isArray(CL?.trucking)?CL.trucking:[];
  if (legs.length) {
    chk(20); hdr('Trucking',12); rule();
    legs.forEach((leg,i)=>{ chk(14);
      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(26,58,92);
      doc.text(`Leg ${i+1}: ${leg.method}${leg.name?' — '+leg.name:''}`,M,y); y+=5;
      doc.setFont('helvetica','normal'); doc.setTextColor(50,50,50);
      if (leg.pickupLocation) { doc.text(`Pickup: ${leg.pickupLocation}${leg.pickupDate?' · '+fmtDate(leg.pickupDate):''}`,M,y); y+=5; }
      if (leg.deliveryLocation) { doc.text(`Delivery: ${leg.deliveryLocation}${leg.deliveryDate?' · '+fmtDate(leg.deliveryDate):''}`,M,y); y+=5; }
      if (leg.notes) body(leg.notes);
    }); y+=4;
  }

  if (CL?.scope_of_work) { chk(20); hdr('Scope of Work',12); rule(); body(CL.scope_of_work); y+=4; }

  const tot=doc.getNumberOfPages();
  for(let i=1;i<=tot;i++){doc.setPage(i);doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(160,160,160);doc.text('Visual Affect — LED Planning Tool',M,295);doc.text(`Page ${i} of ${tot}`,W-M,295,'right');}
  doc.save((CP_NAME||'project').replace(/[^a-z0-9]/gi,'_')+'_call_sheet.pdf');
}

// ── HELPERS ─────────────────────────────────────────────────
const _v = id => document.getElementById(id)?.value?.trim()||'';
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(d){if(!d)return'';return new Date(d+'T00:00:00').toLocaleDateString();}
function fmtTime(t){if(!t)return'';const[h,m]=t.split(':');const hr=parseInt(h);return`${hr%12||12}:${m} ${hr<12?'AM':'PM'}`;}
function fmtBytes(b){if(!b)return'';if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB';}
function _msg(id,msg,err=false){const el=document.getElementById(id);if(!el)return;el.textContent=msg;el.style.color=err?'var(--color-danger)':'var(--color-ok)';setTimeout(()=>{if(el)el.textContent='';},3000);}
function showToast(msg,type='success'){window.showToast?.(msg,type);}

// ── GLOBAL ──────────────────────────────────────────────────
window.Logistics = {
  openProjectLogistics, showLTab, exportCallSheet,
  saveVenue, saveSchedule, saveScope,
  addShowDay, removeShowDay,
  addTruckLeg, removeTruckLeg, saveTrucking,
  saveRental, deleteRental,
  uploadFiles, deleteFile,
  toggleCrew, setCrewHours,
};
