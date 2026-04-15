// ============================================================
// labor.js — Labor Management
// Crew Roster · Scheduling · Timesheets · Job Costing
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin } from './auth.js';

// ============================================================
// CONSTANTS
// ============================================================

const PHASES = [
  { key: 'prep',     label: 'Prep' },
  { key: 'load_in',  label: 'Load In' },
  { key: 'show',     label: 'Show' },
  { key: 'load_out', label: 'Load Out' },
  { key: 'deprep',   label: 'De-Prep' },
];

const CERTS = [
  'Rigging Certification', 'OSHA 10', 'OSHA 30',
  'Scissor Lift', 'Boom Lift', 'Forklift', 'First Aid / CPR',
];

let _crew = [];
let _projects = [];
let _users = [];
let _activeTab = 'roster';

// ============================================================
// MAIN RENDER
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading labor...</div></div>`;
  [_crew, _projects, _users] = await Promise.all([
    _fetchCrew(), _fetchProjects(), _fetchUsers(),
  ]);
  _renderShell(container);
}

function _renderShell(container) {
  container.innerHTML = `
    <div class="section-header">
      <div><div class="section-title">Labor</div>
           <div class="section-sub">${_crew.length} crew members</div></div>
      <div style="display:flex;gap:8px">
        ${isAdmin() || getProfile()?.role === 'manager' ? `<button class="btn-add" onclick="window.Labor.openAddCrew()">+ Add Crew Member</button>` : ''}
      </div>
    </div>

    <div class="tab-bar">
      <button class="tab-btn ${_activeTab==='roster'?'active':''}" id="lt-roster" onclick="window.Labor.showTab('roster')">👷 Roster</button>
      <button class="tab-btn ${_activeTab==='schedule'?'active':''}" id="lt-schedule" onclick="window.Labor.showTab('schedule')">📅 Schedule</button>
      <button class="tab-btn ${_activeTab==='timesheets'?'active':''}" id="lt-timesheets" onclick="window.Labor.showTab('timesheets')">⏱ Timesheets</button>
      <button class="tab-btn ${_activeTab==='costing'?'active':''}" id="lt-costing" onclick="window.Labor.showTab('costing')">💰 Job Costing</button>
    </div>

    <div id="labor-content"></div>

    <!-- Crew member modal -->
    <div class="modal-overlay" id="crew-modal">
      <div class="modal" style="max-width:620px">
        <div class="modal-header">
          <div class="modal-title" id="crew-modal-title">Add Crew Member</div>
          <button class="modal-close" onclick="document.getElementById('crew-modal').classList.remove('open')">✕</button>
        </div>
        <div id="crew-modal-body"></div>
      </div>
    </div>

    <!-- Timesheet modal -->
    <div class="modal-overlay" id="ts-modal">
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <div class="modal-title" id="ts-modal-title">Log Timesheet</div>
          <button class="modal-close" onclick="document.getElementById('ts-modal').classList.remove('open')">✕</button>
        </div>
        <div id="ts-modal-body"></div>
      </div>
    </div>`;

  _loadTab(_activeTab);
}

function showTab(tab) {
  _activeTab = tab;
  ['roster','schedule','timesheets','costing'].forEach(t => {
    document.getElementById('lt-'+t)?.classList.toggle('active', t === tab);
  });
  _loadTab(tab);
}

async function _loadTab(tab) {
  const el = document.getElementById('labor-content');
  if (!el) return;
  el.innerHTML = `<div class="loading-state" style="padding:40px"><div class="spinner"></div></div>`;
  switch (tab) {
    case 'roster':     el.innerHTML = _rosterTab(); break;
    case 'schedule':   el.innerHTML = await _scheduleTab(); break;
    case 'timesheets': el.innerHTML = await _timesheetsTab(); break;
    case 'costing':    el.innerHTML = await _costingTab(); break;
  }
}

// ============================================================
// ROSTER TAB
// ============================================================

function _rosterTab() {
  if (!_crew.length) return `<div class="empty-state" style="margin-top:24px"><div class="empty-icon">👷</div><div class="empty-title">No crew members yet</div><p class="empty-sub">Add your first crew member to get started.</p></div>`;

  return `<div class="card-grid" style="margin-top:16px">
    ${_crew.map(c => _crewCard(c)).join('')}
  </div>`;
}

function _crewCard(c) {
  const typeColor = c.type === 'w2' ? 'tag-blue' : 'tag-yellow';
  const certs = Array.isArray(c.certifications) ? c.certifications : [];
  const linkedUser = _users.find(u => u.id === c.user_id);
  const expiredCerts = certs.filter(cert => cert.expiry && new Date(cert.expiry) < new Date());

  return `<div class="project-card">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">
      <div>
        <div style="font-family:'Barlow',sans-serif;font-size:17px;font-weight:700">${escH(c.first_name)} ${escH(c.last_name)}</div>
        <div class="text-small text-muted">${escH(c.title||'—')}</div>
      </div>
      <span class="tag ${typeColor}" style="font-size:10px">${c.type?.toUpperCase()||'1099'}</span>
    </div>

    ${linkedUser ? `<div style="font-size:11px;background:#f0f9ff;color:var(--color-accent-2);padding:3px 8px;border-radius:4px;margin-bottom:8px;display:inline-block">🔗 App user: ${linkedUser.first_name} ${linkedUser.last_name}</div>` : ''}

    <div class="text-small text-muted" style="line-height:1.8;margin-bottom:10px">
      ${c.email ? `✉ ${escH(c.email)}<br>` : ''}
      ${c.phone ? `📞 ${escH(c.phone)}<br>` : ''}
      ${c.hourly_rate ? `⏱ $${c.hourly_rate}/hr · ` : ''}${c.day_rate ? `$${c.day_rate}/day` : ''}
      ${c.overtime_rate ? `<br>OT: $${c.overtime_rate}/hr` : ''}
    </div>

    ${certs.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">
      ${certs.map(cert => {
        const expired = cert.expiry && new Date(cert.expiry) < new Date();
        return `<span style="font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600;background:${expired?'#fef2f2':'#f0fdf4'};color:${expired?'#dc2626':'#166534'}">${escH(cert.name||cert)}${expired?' ⚠':''}</span>`;
      }).join('')}
    </div>` : ''}

    ${expiredCerts.length ? `<div class="alert alert-warn" style="font-size:11px;padding:6px 10px;margin-bottom:10px">⚠ ${expiredCerts.length} expired certification${expiredCerts.length!==1?'s':''}</div>` : ''}

    ${c.notes ? `<div class="text-small text-muted" style="margin-bottom:10px;font-style:italic">${escH(c.notes.substring(0,80))}${c.notes.length>80?'...':''}</div>` : ''}

    <div style="display:flex;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--color-border-light)">
      <button class="btn" style="font-size:11px;padding:5px 10px" onclick="window.Labor.openEditCrew('${c.id}')">Edit</button>
      <button class="btn btn-primary" style="font-size:11px;padding:5px 10px" onclick="window.Labor.openLogTimesheet('${c.id}')">+ Timesheet</button>
      ${!c.is_active ? `<span class="tag tag-red" style="font-size:10px;align-self:center">Inactive</span>` : ''}
      <button class="btn btn-danger" style="font-size:11px;padding:5px 10px;margin-left:auto" onclick="window.Labor.deleteCrew('${c.id}')">✕</button>
    </div>
  </div>`;
}

// ============================================================
// SCHEDULE TAB
// ============================================================

async function _scheduleTab() {
  const { data: bookings } = await supabase
    .from('crew_bookings')
    .select('*,crew_members(first_name,last_name),projects(id,name,event_start_date,event_end_date,status)')
    .order('date', { ascending: true });

  // Build week view — current week + 8 weeks ahead
  const today = new Date();
  today.setHours(0,0,0,0);
  const weeks = [];
  for (let w = 0; w < 8; w++) {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + w * 7);
    const days = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + d);
      days.push(day);
    }
    weeks.push(days);
  }

  const bookingsByDate = {};
  (bookings||[]).forEach(b => {
    if (!bookingsByDate[b.date]) bookingsByDate[b.date] = [];
    bookingsByDate[b.date].push(b);
  });

  // Per-project crew view
  const projectBookings = {};
  (bookings||[]).forEach(b => {
    if (!b.projects) return;
    const pid = b.projects.id;
    if (!projectBookings[pid]) projectBookings[pid] = { project: b.projects, crew: [] };
    projectBookings[pid].crew.push(b);
  });

  return `
    <!-- Section toggle -->
    <div style="display:flex;gap:8px;margin-bottom:20px;margin-top:16px">
      <button class="seg-btn active" id="sched-cal-btn" onclick="window.Labor.toggleScheduleView('calendar')">📅 Calendar</button>
      <button class="seg-btn" id="sched-proj-btn" onclick="window.Labor.toggleScheduleView('project')">📐 By Project</button>
      <button class="btn-add" style="margin-left:auto" onclick="window.Labor.openBookingForm()">+ Book Crew</button>
    </div>

    <!-- CALENDAR VIEW -->
    <div id="sched-calendar">
      <div style="overflow-x:auto">
        ${weeks.map((days, wi) => `
          <div style="margin-bottom:20px">
            <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;color:var(--color-muted);margin-bottom:8px">
              Week of ${days[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})}
            </div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
              ${days.map(day => {
                const dateStr = day.toISOString().split('T')[0];
                const dayBookings = bookingsByDate[dateStr] || [];
                const isToday = day.toDateString() === new Date().toDateString();
                const isPast = day < new Date() && !isToday;
                return `<div style="background:${isToday?'#eff6ff':isPast?'#f9fafb':'#fff'};border:1.5px solid ${isToday?'#2563eb':'var(--color-border-light)'};border-radius:8px;padding:8px;min-height:80px">
                  <div style="font-size:11px;font-weight:700;color:${isToday?'#2563eb':isPast?'var(--color-muted)':'var(--color-text)'};margin-bottom:5px">
                    ${day.toLocaleDateString('en-US',{weekday:'short'})} ${day.getDate()}
                  </div>
                  ${dayBookings.map(b => `
                    <div style="background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:600;padding:2px 5px;border-radius:3px;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                      ${escH(b.crew_members?.first_name||'')} ${escH(b.crew_members?.last_name?.[0]||'')}.
                      <span style="opacity:.7">${b.scheduled_hours}h</span>
                    </div>`).join('')}
                </div>`;
              }).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>

    <!-- PROJECT VIEW -->
    <div id="sched-project" style="display:none">
      ${!Object.keys(projectBookings).length
        ? `<div class="empty-state" style="padding:40px"><div class="empty-title">No crew bookings yet</div></div>`
        : Object.values(projectBookings).map(pb => `
          <div class="card" style="margin-bottom:14px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div>
                <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700">${escH(pb.project.name)}</div>
                <div class="text-small text-muted">${pb.project.event_start_date?fmtDate(pb.project.event_start_date):''}</div>
              </div>
              <span class="tag tag-blue" style="font-size:10px">${pb.project.status}</span>
            </div>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Crew Member</th><th>Phase</th><th>Date</th><th>Scheduled Hours</th><th>Rate</th><th>Est. Cost</th><th></th></tr></thead>
              <tbody>${pb.crew.map(b => {
                const member = _crew.find(c => c.id === b.crew_member_id);
                return `<tr>
                  <td><strong>${escH(b.crew_members?.first_name||'')} ${escH(b.crew_members?.last_name||'')}</strong></td>
                  <td><span class="tag tag-gray" style="font-size:10px">${b.phase?.replace('_',' ')}</span></td>
                  <td class="text-small">${b.date?fmtDate(b.date):'—'}</td>
                  <td style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700">${b.scheduled_hours||0}</td>
                  <td class="text-small">$${b.rate_used||0}/hr</td>
                  <td style="font-weight:600;color:var(--color-accent)">$${((b.scheduled_hours||0)*(b.rate_used||0)).toFixed(2)}</td>
                  <td><button class="btn btn-danger" style="font-size:11px;padding:3px 7px" onclick="window.Labor.deleteBooking('${b.id}')">✕</button></td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>
          </div>`).join('')}
    </div>

    <!-- Booking form modal -->
    <div class="modal-overlay" id="booking-modal">
      <div class="modal" style="max-width:500px">
        <div class="modal-header"><div class="modal-title">Book Crew Member</div>
          <button class="modal-close" onclick="document.getElementById('booking-modal').classList.remove('open')">✕</button></div>
        <div id="booking-modal-body"></div>
      </div>
    </div>`;
}

function toggleScheduleView(view) {
  document.getElementById('sched-calendar').style.display = view === 'calendar' ? '' : 'none';
  document.getElementById('sched-project').style.display = view === 'project' ? '' : 'none';
  document.getElementById('sched-cal-btn')?.classList.toggle('active', view === 'calendar');
  document.getElementById('sched-proj-btn')?.classList.toggle('active', view === 'project');
}

async function openBookingForm(preCrewId, preProjectId) {
  document.getElementById('booking-modal-body').innerHTML = `
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Crew Member *</label>
        <select class="form-select" id="bk-crew" onchange="window.Labor._autoFillRate()">
          <option value="">— Select —</option>
          ${_crew.map(c=>`<option value="${c.id}" data-rate="${c.hourly_rate||0}" ${preCrewId===c.id?'selected':''}>${escH(c.first_name+' '+c.last_name)}</option>`).join('')}
        </select></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Project *</label>
        <select class="form-select" id="bk-proj">
          <option value="">— Select —</option>
          ${_projects.map(p=>`<option value="${p.id}" ${preProjectId===p.id?'selected':''}>${escH(p.name)}</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Phase</label>
        <select class="form-select" id="bk-phase">
          ${PHASES.map(ph=>`<option value="${ph.key}">${ph.label}</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Date</label>
        <input class="form-input" id="bk-date" type="date"></div>
      <div class="form-field"><label class="form-label">Scheduled Hours</label>
        <input class="form-input" id="bk-hours" type="number" step="0.5" min="0" placeholder="8"></div>
      <div class="form-field"><label class="form-label">Rate ($/hr)</label>
        <input class="form-input" id="bk-rate" type="number" step="0.01" min="0" placeholder="0.00"></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label>
        <input class="form-input" id="bk-notes" placeholder="Any scheduling notes..."></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('booking-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="window.Labor.saveBooking()">Book</button>
    </div>
    <div id="bk-msg" class="mok" style="margin-top:8px"></div>`;
  document.getElementById('booking-modal').classList.add('open');
}

function _autoFillRate() {
  const sel = document.getElementById('bk-crew');
  const opt = sel?.options[sel.selectedIndex];
  if (opt?.dataset.rate) document.getElementById('bk-rate').value = opt.dataset.rate;
}

async function saveBooking() {
  const crewId = document.getElementById('bk-crew')?.value;
  const projId = document.getElementById('bk-proj')?.value;
  if (!crewId || !projId) { _msg('bk-msg','Crew member and project required.',true); return; }
  const { error } = await dbInsert('crew_bookings', {
    crew_member_id: crewId,
    project_id: projId,
    phase: document.getElementById('bk-phase')?.value || 'load_in',
    date: _v('bk-date') || null,
    scheduled_hours: parseFloat(_v('bk-hours')) || 0,
    rate_used: parseFloat(_v('bk-rate')) || 0,
    notes: _v('bk-notes'),
  });
  if (error) { _msg('bk-msg','Failed to save.',true); return; }
  document.getElementById('booking-modal').classList.remove('open');
  showToast('Crew booked!','success');
  await _loadTab('schedule');
}

async function deleteBooking(id) {
  if (!confirm('Remove this booking?')) return;
  await dbDelete('crew_bookings', id);
  showToast('Booking removed.','success');
  await _loadTab('schedule');
}

// ============================================================
// TIMESHEETS TAB
// ============================================================

async function _timesheetsTab() {
  const profile = getProfile();
  const canManage = isAdmin() || profile?.role === 'manager';

  let query = supabase.from('timesheets')
    .select('*,crew_members(first_name,last_name),projects(name)')
    .order('date', { ascending: false });

  if (!canManage) {
    // Crew see only their own timesheets
    const myCrewId = _crew.find(c => c.user_id === profile?.id)?.id;
    if (myCrewId) query = query.eq('crew_member_id', myCrewId);
  }

  const { data: timesheets } = await query.limit(100);
  const pending = (timesheets||[]).filter(t => t.status === 'pending').length;

  const statusColor = { pending:'tag-yellow', approved:'tag-green', rejected:'tag-red' };

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;margin-top:16px">
      <div>
        ${pending ? `<div class="alert alert-warn" style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px">
          ⏳ ${pending} timesheet${pending!==1?'s':''} pending approval
        </div>` : ''}
      </div>
      <button class="btn-add" onclick="window.Labor.openLogTimesheet()">+ Log Timesheet</button>
    </div>

    ${!timesheets?.length
      ? `<div class="empty-state" style="padding:40px"><div class="empty-icon">⏱</div><div class="empty-title">No timesheets yet</div></div>`
      : `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Crew Member</th><th>Project</th><th>Phase</th><th>Date</th><th>Hours</th><th>Rate</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${timesheets.map(t => `<tr>
              <td><strong>${escH(t.crew_members?.first_name||'—')} ${escH(t.crew_members?.last_name||'')}</strong></td>
              <td class="text-small">${escH(t.projects?.name||'—')}</td>
              <td><span class="tag tag-gray" style="font-size:10px">${(t.phase||'').replace('_',' ')}</span></td>
              <td class="text-small">${t.date?fmtDate(t.date):'—'}</td>
              <td style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700">${t.hours_worked||0}</td>
              <td class="text-small">$${t.rate_used||0}/hr</td>
              <td style="font-weight:600;color:var(--color-accent)">$${Number(t.total_cost||0).toFixed(2)}</td>
              <td><span class="tag ${statusColor[t.status]||'tag-gray'}" style="font-size:10px">${t.status}</span></td>
              <td style="display:flex;gap:5px">
                ${canManage && t.status === 'pending' ? `
                  <button class="btn btn-green" style="font-size:11px;padding:3px 8px" onclick="window.Labor.approveTimesheet('${t.id}')">✓</button>
                  <button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="window.Labor.rejectTimesheet('${t.id}')">✗</button>` : ''}
                ${t.status==='pending'?`<button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="window.Labor.deleteTimesheet('${t.id}')">✕</button>`:''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}`;
}

async function openLogTimesheet(preCrewId) {
  document.getElementById('ts-modal-title').textContent = 'Log Timesheet';
  const profile = getProfile();
  const myCrewId = preCrewId || _crew.find(c => c.user_id === profile?.id)?.id || '';

  document.getElementById('ts-modal-body').innerHTML = `
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Crew Member *</label>
        <select class="form-select" id="ts-crew" onchange="window.Labor._autoFillTsRate()">
          <option value="">— Select —</option>
          ${_crew.map(c=>`<option value="${c.id}" data-rate="${c.hourly_rate||0}" ${myCrewId===c.id?'selected':''}>${escH(c.first_name+' '+c.last_name)}</option>`).join('')}
        </select></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Project *</label>
        <select class="form-select" id="ts-proj">
          <option value="">— Select —</option>
          ${_projects.map(p=>`<option value="${p.id}">${escH(p.name)}</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Phase</label>
        <select class="form-select" id="ts-phase">
          ${PHASES.map(ph=>`<option value="${ph.key}">${ph.label}</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Date *</label>
        <input class="form-input" id="ts-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="form-field"><label class="form-label">Hours Worked *</label>
        <input class="form-input" id="ts-hours" type="number" step="0.5" min="0" placeholder="8"
          onchange="window.Labor._calcTsTotal()"></div>
      <div class="form-field"><label class="form-label">Rate ($/hr)</label>
        <input class="form-input" id="ts-rate" type="number" step="0.01" min="0" placeholder="0.00"
          onchange="window.Labor._calcTsTotal()"></div>
      <div class="form-field" style="grid-column:1/-1">
        <div style="background:#f0f9ff;border:1.5px solid #bfdbfe;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:13px;font-weight:600">Estimated Total</span>
          <span style="font-family:'Barlow',sans-serif;font-size:20px;font-weight:800;color:var(--color-accent)" id="ts-total-display">$0.00</span>
        </div>
      </div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label>
        <textarea class="form-input form-textarea" id="ts-notes" rows="2" placeholder="Overtime reason, special circumstances..."></textarea></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('ts-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="window.Labor.saveTimesheet()">Submit Timesheet</button>
    </div>
    <div id="ts-msg" class="mok" style="margin-top:8px"></div>`;
  document.getElementById('ts-modal').classList.add('open');
  if (myCrewId) _autoFillTsRate();
}

function _autoFillTsRate() {
  const sel = document.getElementById('ts-crew');
  const opt = sel?.options[sel.selectedIndex];
  if (opt?.dataset.rate) { document.getElementById('ts-rate').value = opt.dataset.rate; _calcTsTotal(); }
}

function _calcTsTotal() {
  const h = parseFloat(_v('ts-hours')) || 0;
  const r = parseFloat(_v('ts-rate')) || 0;
  const el = document.getElementById('ts-total-display');
  if (el) el.textContent = '$' + (h * r).toFixed(2);
}

async function saveTimesheet() {
  const crewId = document.getElementById('ts-crew')?.value;
  const projId = document.getElementById('ts-proj')?.value;
  const hours = parseFloat(_v('ts-hours')) || 0;
  if (!crewId || !projId || !hours) { _msg('ts-msg','Crew, project, and hours required.',true); return; }
  const rate = parseFloat(_v('ts-rate')) || 0;
  const { error } = await dbInsert('timesheets', {
    crew_member_id: crewId, project_id: projId,
    phase: document.getElementById('ts-phase')?.value || 'load_in',
    date: _v('ts-date') || null,
    hours_worked: hours, rate_used: rate,
    total_cost: hours * rate,
    status: 'pending',
    notes: _v('ts-notes'),
  });
  if (error) { _msg('ts-msg','Failed to save.',true); return; }
  document.getElementById('ts-modal').classList.remove('open');
  showToast('Timesheet submitted!','success');
  await _loadTab('timesheets');
}

async function approveTimesheet(id) {
  await supabase.from('timesheets').update({ status:'approved', approved_by:getProfile().id }).eq('id', id);
  showToast('Approved!','success'); await _loadTab('timesheets');
}

async function rejectTimesheet(id) {
  await supabase.from('timesheets').update({ status:'rejected' }).eq('id', id);
  showToast('Rejected.','success'); await _loadTab('timesheets');
}

async function deleteTimesheet(id) {
  if (!confirm('Delete this timesheet?')) return;
  await dbDelete('timesheets', id);
  showToast('Deleted.','success'); await _loadTab('timesheets');
}

// ============================================================
// JOB COSTING TAB
// ============================================================

async function _costingTab() {
  const { data: timesheets } = await supabase
    .from('timesheets')
    .select('*,projects(id,name)')
    .eq('status', 'approved');

  const { data: proposals } = await supabase
    .from('proposals')
    .select('id,title,total,project_id,line_items')
    .not('project_id', 'is', null);

  // Group approved timesheets by project
  const actualByProject = {};
  (timesheets||[]).forEach(t => {
    if (!t.project_id) return;
    if (!actualByProject[t.project_id]) actualByProject[t.project_id] = { name: t.projects?.name||'—', cost: 0, hours: 0 };
    actualByProject[t.project_id].cost += t.total_cost || 0;
    actualByProject[t.project_id].hours += t.hours_worked || 0;
  });

  // Match with proposals for proposed labor
  const proposalByProject = {};
  (proposals||[]).forEach(p => {
    if (!p.project_id) return;
    const laborItems = (p.line_items||[]).filter(li =>
      li.name?.toLowerCase().includes('tech') ||
      li.name?.toLowerCase().includes('labor') ||
      li.name?.toLowerCase().includes('operator') ||
      li.name?.toLowerCase().includes('travel day') ||
      li.category === 'Labor'
    );
    const proposedLabor = laborItems.reduce((a, li) => a + ((li.qty||0)*(li.unit_price||0)), 0);
    proposalByProject[p.project_id] = { title: p.title, total: p.total||0, proposedLabor };
  });

  const allProjectIds = new Set([...Object.keys(actualByProject), ...Object.keys(proposalByProject)]);

  if (!allProjectIds.size) {
    return `<div class="empty-state" style="padding:60px;margin-top:16px">
      <div class="empty-icon">💰</div>
      <div class="empty-title">No job costing data yet</div>
      <p class="empty-sub">Job costing appears here once proposals are linked to projects and timesheets are approved.</p>
    </div>`;
  }

  // Summary totals
  const totalProposedLabor = Object.values(proposalByProject).reduce((a, p) => a + p.proposedLabor, 0);
  const totalActualLabor = Object.values(actualByProject).reduce((a, p) => a + p.cost, 0);
  const totalRevenue = Object.values(proposalByProject).reduce((a, p) => a + p.total, 0);

  return `
    <div style="margin-top:16px">
      <!-- Summary cards -->
      <div class="summary-grid" style="margin-bottom:24px">
        <div class="summary-card">
          <div class="summary-card-label">Total Revenue (proposals)</div>
          <div class="summary-card-value" style="color:var(--color-ok)">$${totalRevenue.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">Proposed Labor</div>
          <div class="summary-card-value">$${totalProposedLabor.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">Actual Labor Cost</div>
          <div class="summary-card-value" style="color:${totalActualLabor>totalProposedLabor?'#dc2626':'#166534'}">
            $${totalActualLabor.toLocaleString('en-US',{minimumFractionDigits:2})}
          </div>
        </div>
        <div class="summary-card">
          <div class="summary-card-label">Labor Variance</div>
          <div class="summary-card-value" style="color:${totalActualLabor>totalProposedLabor?'#dc2626':'#166534'}">
            ${totalActualLabor>totalProposedLabor?'▲':'▼'} $${Math.abs(totalProposedLabor-totalActualLabor).toLocaleString('en-US',{minimumFractionDigits:2})}
          </div>
          <div class="summary-card-sub">${totalActualLabor>totalProposedLabor?'over':'under'} budget</div>
        </div>
      </div>

      <!-- Per-project breakdown -->
      <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:12px">Per Project Breakdown</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Total Revenue</th>
              <th>Proposed Labor</th>
              <th>Actual Labor</th>
              <th>Variance</th>
              <th>Labor % of Revenue</th>
              <th>Actual Hours</th>
            </tr>
          </thead>
          <tbody>
            ${[...allProjectIds].map(pid => {
              const actual = actualByProject[pid] || { cost: 0, hours: 0, name: '—' };
              const proposed = proposalByProject[pid] || { title: actual.name, total: 0, proposedLabor: 0 };
              const variance = actual.cost - proposed.proposedLabor;
              const laborPct = proposed.total > 0 ? (actual.cost / proposed.total * 100).toFixed(1) : '—';
              return `<tr>
                <td><strong>${escH(proposed.title||actual.name)}</strong></td>
                <td style="font-weight:600;color:var(--color-ok)">$${Number(proposed.total).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
                <td>$${Number(proposed.proposedLabor).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
                <td style="font-weight:600">$${Number(actual.cost).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
                <td style="font-weight:600;color:${variance>0?'#dc2626':variance<0?'#166534':'#6b7280'}">
                  ${variance>0?'▲':'▼'} $${Math.abs(variance).toLocaleString('en-US',{minimumFractionDigits:2})}
                </td>
                <td>${laborPct !== '—' ? `${laborPct}%` : '—'}</td>
                <td style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700">${actual.hours.toFixed(1)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ============================================================
// CREW CRUD
// ============================================================

async function openAddCrew() {
  document.getElementById('crew-modal-title').textContent = 'Add Crew Member';
  document.getElementById('crew-modal-body').innerHTML = _crewForm(null);
  document.getElementById('crew-modal').classList.add('open');
  setTimeout(() => document.getElementById('cf-fn')?.focus(), 80);
}

async function openEditCrew(id) {
  const { data: member } = await supabase.from('crew_members').select('*').eq('id', id).single();
  if (!member) return;
  document.getElementById('crew-modal-title').textContent = 'Edit Crew Member';
  document.getElementById('crew-modal-body').innerHTML = _crewForm(member);
  document.getElementById('crew-modal').classList.add('open');
}

function _crewForm(c) {
  const v = (f, def='') => escH(String(c?.[f] ?? def));
  const certs = Array.isArray(c?.certifications) ? c.certifications : [];

  return `
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Info</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:16px">
      <div class="form-field"><label class="form-label">First Name *</label><input class="form-input" id="cf-fn" value="${v('first_name')}" placeholder="Jane"></div>
      <div class="form-field"><label class="form-label">Last Name *</label><input class="form-input" id="cf-ln" value="${v('last_name')}" placeholder="Smith"></div>
      <div class="form-field"><label class="form-label">Title / Role</label><input class="form-input" id="cf-title" value="${v('title')}" placeholder="Lead LED Tech"></div>
      <div class="form-field"><label class="form-label">Type</label>
        <select class="form-select" id="cf-type">
          <option value="1099" ${v('type','1099')==='1099'?'selected':''}>1099 Contractor</option>
          <option value="w2" ${v('type')==='w2'?'selected':''}>W2 Employee</option>
        </select></div>
      <div class="form-field"><label class="form-label">Email</label><input class="form-input" id="cf-email" type="email" value="${v('email')}"></div>
      <div class="form-field"><label class="form-label">Phone</label><input class="form-input" id="cf-phone" type="tel" value="${v('phone')}"></div>
      <div class="form-field"><label class="form-label">Link to App User (optional)</label>
        <select class="form-select" id="cf-user">
          <option value="">— Not linked —</option>
          ${_users.map(u=>`<option value="${u.id}" ${v('user_id')===u.id?'selected':''}>${u.first_name} ${u.last_name} (${u.role})</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Active</label>
        <select class="form-select" id="cf-active">
          <option value="true" ${v('is_active','true')!=='false'?'selected':''}>Active</option>
          <option value="false" ${v('is_active')==='false'?'selected':''}>Inactive</option>
        </select></div>
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Rates</div>
    <div class="form-grid form-grid-3" style="gap:10px;margin-bottom:16px">
      <div class="form-field"><label class="form-label">Hourly Rate</label><input class="form-input" id="cf-hourly" type="number" step="0.01" value="${v('hourly_rate')}" placeholder="0.00"></div>
      <div class="form-field"><label class="form-label">Day Rate</label><input class="form-input" id="cf-day" type="number" step="0.01" value="${v('day_rate')}" placeholder="0.00"></div>
      <div class="form-field"><label class="form-label">OT Rate</label><input class="form-input" id="cf-ot" type="number" step="0.01" value="${v('overtime_rate')}" placeholder="0.00"></div>
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Certifications</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      ${CERTS.map(cert => {
        const existing = certs.find(ec => (ec.name||ec) === cert);
        return `<label style="display:flex;align-items:center;gap:6px;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px">
          <input type="checkbox" class="cert-check" data-cert="${cert}" ${existing?'checked':''}>
          ${cert}
          ${existing && existing.expiry ? `<input type="date" class="form-input cert-expiry" data-cert="${cert}" value="${existing.expiry}" style="width:110px;padding:3px 6px;font-size:11px;margin-left:4px">` : ''}
        </label>`;
      }).join('')}
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Notes</div>
    <div class="form-field" style="margin-bottom:16px">
      <textarea class="form-input form-textarea" id="cf-notes" rows="3" placeholder="Any notes about this crew member...">${escH(c?.notes||'')}</textarea>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('crew-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="window.Labor.saveCrew('${c?.id||''}')">
        ${c?'Save Changes':'Add Crew Member'}
      </button>
    </div>
    <div id="cf-msg" class="mok" style="margin-top:8px"></div>`;
}

async function saveCrew(existingId) {
  const fn = _v('cf-fn'), ln = _v('cf-ln');
  if (!fn || !ln) { _msg('cf-msg','First and last name required.',true); return; }

  // Collect certifications
  const certifications = [];
  document.querySelectorAll('.cert-check:checked').forEach(cb => {
    const cert = cb.dataset.cert;
    const expiry = document.querySelector(`.cert-expiry[data-cert="${cert}"]`)?.value || '';
    certifications.push({ name: cert, expiry });
  });

  const data = {
    first_name: fn, last_name: ln,
    title: _v('cf-title'), type: document.getElementById('cf-type')?.value || '1099',
    email: _v('cf-email'), phone: _v('cf-phone'),
    user_id: document.getElementById('cf-user')?.value || null,
    is_active: document.getElementById('cf-active')?.value !== 'false',
    hourly_rate: parseFloat(_v('cf-hourly')) || null,
    day_rate: parseFloat(_v('cf-day')) || null,
    overtime_rate: parseFloat(_v('cf-ot')) || null,
    certifications, notes: _v('cf-notes'),
  };

  let error;
  if (existingId) { ({error} = await dbUpdate('crew_members', existingId, data)); }
  else { ({error} = await dbInsert('crew_members', data)); }
  if (error) { _msg('cf-msg','Failed to save.',true); console.error(error); return; }
  document.getElementById('crew-modal').classList.remove('open');
  showToast(existingId?'Crew member updated!':'Crew member added!','success');
  _crew = await _fetchCrew();
  document.getElementById('labor-content').innerHTML = _rosterTab();
  showTab('roster');
}

async function deleteCrew(id) {
  if (!confirm('Remove this crew member?')) return;
  await dbDelete('crew_members', id);
  showToast('Removed.','success');
  _crew = await _fetchCrew();
  document.getElementById('labor-content').innerHTML = _rosterTab();
}

// ============================================================
// DATA
// ============================================================

async function _fetchCrew() {
  const { data } = await supabase.from('crew_members').select('*').order('last_name');
  return data || [];
}

async function _fetchProjects() {
  const { data } = await supabase.from('projects').select('id,name,event_start_date,event_end_date,status').order('event_start_date',{ascending:false});
  return data || [];
}

async function _fetchUsers() {
  const { data } = await supabase.from('profiles').select('id,first_name,last_name,role').order('first_name');
  return data || [];
}

// ============================================================
// HELPERS
// ============================================================

const _v = id => document.getElementById(id)?.value?.trim()||'';
function _msg(id,msg,err=false){const el=document.getElementById(id);if(!el)return;el.textContent=msg;el.style.color=err?'var(--color-danger)':'var(--color-ok)';}
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(d){if(!d)return'';return new Date(d+'T00:00:00').toLocaleDateString();}
function showToast(msg,type='success'){window.showToast?.(msg,type);}

// ============================================================
// GLOBAL EXPOSURE
// ============================================================

window.Labor = {
  showTab, openAddCrew, openEditCrew, saveCrew, deleteCrew,
  toggleScheduleView, openBookingForm, saveBooking, deleteBooking, _autoFillRate,
  openLogTimesheet, saveTimesheet, approveTimesheet, rejectTimesheet, deleteTimesheet,
  _autoFillTsRate, _calcTsTotal,
};
