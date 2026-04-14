// ============================================================
// leads.js — CRM Lead Pipeline v2
// Kanban/List · Inline editing · Multi-assignee · Project Scope
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin } from './auth.js';

// ============================================================
// CONSTANTS
// ============================================================

const STATUSES = [
  { key:'new',         label:'New',         color:'#6b7280' },
  { key:'assigned',    label:'Assigned',    color:'#2563eb' },
  { key:'contacted',   label:'Contacted',   color:'#9333ea' },
  { key:'qualified',   label:'Qualified',   color:'#d97706' },
  { key:'unqualified', label:'Unqualified', color:'#dc2626' },
  { key:'converted',   label:'Converted',   color:'#166534' },
  { key:'lost',        label:'Lost',        color:'#991b1b' },
];

const SUPPORT_OPTS_INDOOR = [
  'Fly to ceiling rigging points',
  'Ground support — pipe & base riser',
  'Ground support — truss structure (case by case)',
];
const SUPPORT_OPTS_OUTDOOR = [
  'Mobile stage fly',
  'Array towers',
  'Ground support on riser',
  'Custom truss build',
];
const ADDITIONAL_SERVICES = [
  'Playback system / media server',
  'Camera input(s)',
  'Content creation / programming',
  'On-site tech support during show',
  'Content playback operator',
  'Generator (power)',
  'Travel day(s)',
  'Lodging',
  'Per diem',
];

let _allLeads = [];
let _currentLead = null;
let _currentView = 'kanban';
let _allUsers = [];

// ============================================================
// MAIN RENDER — Pipeline View
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading leads...</div></div>`;
  [_allLeads, _allUsers] = await Promise.all([_fetchLeads(), _fetchUsers()]);
  _renderPipeline(container);
}

function _renderPipeline(container) {
  const byStatus = {};
  STATUSES.forEach(s => byStatus[s.key] = []);
  _allLeads.forEach(l => { if (byStatus[l.status] !== undefined) byStatus[l.status].push(l); });
  const active = _allLeads.filter(l => !['converted','lost','unqualified'].includes(l.status));

  container.innerHTML = `
    <div class="section-header">
      <div><div class="section-title">Leads</div>
           <div class="section-sub">${_allLeads.length} total · ${active.length} active pipeline</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="view-toggle-btn" onclick="window.Leads.toggleView()">📋 List View</button>
        <button class="btn-add" onclick="window.Leads.openAdd()">+ New Lead</button>
      </div>
    </div>

    <!-- Status pills -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
      ${STATUSES.filter(s => byStatus[s.key].length).map(s => `
        <div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:7px 12px;box-shadow:var(--shadow-sm);display:flex;align-items:center;gap:7px;cursor:pointer"
          onclick="window.Leads.filterStatus('${s.key}')">
          <div style="width:8px;height:8px;border-radius:50%;background:${s.color}"></div>
          <span style="font-size:12px;font-weight:500">${s.label}</span>
          <span style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;color:var(--color-accent)">${byStatus[s.key].length}</span>
        </div>`).join('')}
    </div>

    <!-- KANBAN -->
    <div id="leads-kanban" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:16px">
      ${STATUSES.filter(s => !['converted','lost'].includes(s.key)).map(s => `
        <div style="min-width:230px;flex-shrink:0;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:12px;padding:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:8px;height:8px;border-radius:50%;background:${s.color}"></div>
              <span style="font-family:'Barlow',sans-serif;font-size:12px;font-weight:700">${s.label}</span>
            </div>
            <span style="font-size:12px;color:var(--color-muted);font-weight:600">${byStatus[s.key].length}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${byStatus[s.key].map(l => _leadCard(l)).join('')}
            ${!byStatus[s.key].length ? `<div style="text-align:center;padding:16px;color:var(--color-muted);font-size:12px">No leads</div>` : ''}
          </div>
        </div>`).join('')}
    </div>

    <!-- LIST -->
    <div id="leads-list" style="display:none">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Company</th><th>Event</th><th>Date</th><th>Source</th><th>Status</th><th>Assigned</th><th></th></tr></thead>
          <tbody id="leads-tbody">
            ${_allLeads.map(l => `<tr data-status="${l.status}">
              <td><strong>${escH(l.first_name)} ${escH(l.last_name)}</strong><div class="text-small text-muted">${escH(l.email||'')}</div></td>
              <td>${escH(l.company||'—')}</td>
              <td>${escH(l.event_type||'—')}${l.venue_city?`<div class="text-small text-muted">📍 ${escH(l.venue_city)}${l.venue_state?', '+escH(l.venue_state):''}</div>`:''}</td>
              <td class="text-small">${l.event_date?fmtDate(l.event_date):'—'}</td>
              <td><span class="tag tag-gray" style="font-size:10px">${(l.source||'').replace(/_/g,' ')}</span></td>
              <td><span class="tag ${_stag(l.status)}">${l.status}</span></td>
              <td class="text-small">${(l.lead_assignments||[]).map(a=>a.profiles?`${a.profiles.first_name} ${a.profiles.last_name[0]}.`:'').join(', ')||'—'}</td>
              <td><button class="btn" style="font-size:11px;padding:4px 10px" onclick="window.Leads.openLead('${l.id}')">Open</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ADD MODAL -->
    <div class="modal-overlay" id="lead-add-modal">
      <div class="modal" style="max-width:580px">
        <div class="modal-header">
          <div class="modal-title">New Lead</div>
          <button class="modal-close" onclick="document.getElementById('lead-add-modal').classList.remove('open')">✕</button>
        </div>
        <div id="lead-add-body"></div>
      </div>
    </div>`;
}

function _leadCard(l) {
  const assignees = (l.lead_assignments||[]).map(a => a.profiles ? `${a.profiles.first_name} ${a.profiles.last_name[0]}.` : '').filter(Boolean);
  return `<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px;cursor:pointer;box-shadow:var(--shadow-sm);transition:box-shadow .12s"
    onclick="window.Leads.openLead('${l.id}')"
    onmouseover="this.style.boxShadow='var(--shadow-md)'"
    onmouseout="this.style.boxShadow='var(--shadow-sm)'">
    <div style="font-weight:600;font-size:13px;margin-bottom:3px">${escH(l.first_name)} ${escH(l.last_name)}</div>
    ${l.company?`<div style="font-size:11px;color:var(--color-muted)">🏢 ${escH(l.company)}</div>`:''}
    ${l.event_type?`<div style="font-size:11px;color:var(--color-muted)">🎬 ${escH(l.event_type)}</div>`:''}
    ${l.event_date?`<div style="font-size:11px;color:var(--color-muted)">📅 ${fmtDate(l.event_date)}</div>`:''}
    ${l.venue_city?`<div style="font-size:11px;color:var(--color-muted)">📍 ${escH(l.venue_city)}${l.venue_state?', '+escH(l.venue_state):''}</div>`:''}
    ${l.budget_range?`<div style="font-size:11px;color:var(--color-muted)">💰 ${escH(l.budget_range)}</div>`:''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
      <span style="font-size:10px;color:var(--color-muted)">${(l.source||'').replace(/_/g,' ')}</span>
      ${assignees.length?`<span style="font-size:10px;background:var(--color-accent-light);color:var(--color-accent-2);padding:2px 7px;border-radius:4px">${assignees.join(', ')}</span>`:''}
    </div>
  </div>`;
}

function _stag(s) {
  return {new:'tag-gray',assigned:'tag-blue',contacted:'tag-purple',qualified:'tag-yellow',unqualified:'tag-red',converted:'tag-green',lost:'tag-red'}[s]||'tag-gray';
}

function toggleView() {
  _currentView = _currentView==='kanban'?'list':'kanban';
  document.getElementById('leads-kanban').style.display = _currentView==='kanban'?'flex':'none';
  document.getElementById('leads-list').style.display = _currentView==='list'?'block':'none';
  document.getElementById('view-toggle-btn').textContent = _currentView==='kanban'?'📋 List View':'📊 Kanban View';
}

function filterStatus(status) {
  if (_currentView==='kanban') toggleView();
  document.querySelectorAll('#leads-tbody tr').forEach(row => {
    row.style.display = !status || row.dataset.status===status ? '' : 'none';
  });
}

// ============================================================
// DATA
// ============================================================

async function _fetchLeads() {
  const { data, error } = await supabase.from('leads')
    .select('*,lead_assignments(id,user_id,profiles(first_name,last_name))')
    .order('created_at', { ascending: false });
  if (!error) return data || [];
  // Fallback without join
  console.warn('[Leads] Join fetch failed, falling back:', error);
  const { data: simple } = await supabase.from('leads')
    .select('*').order('created_at', { ascending: false });
  return (simple || []).map(l => ({ ...l, lead_assignments: [] }));
}

async function _fetchUsers() {
  const { data } = await supabase.from('profiles').select('id,first_name,last_name,role').order('first_name');
  return data || [];
}

async function _fetchLead(id) {
  if (!id) return null;
  // Try with assignments join first
  const { data, error } = await supabase.from('leads')
    .select('*,lead_assignments(id,user_id,profiles(first_name,last_name))')
    .eq('id', id).single();
  if (data) return data;
  // Fallback: fetch without join
  console.warn('[Leads] Join failed, falling back:', error);
  const { data: simple } = await supabase.from('leads')
    .select('*').eq('id', id).single();
  return simple ? { ...simple, lead_assignments: [] } : null;
}

// ============================================================
// ADD LEAD (quick modal — minimal fields)
// ============================================================

function openAdd() {
  document.getElementById('lead-add-body').innerHTML = `
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Contact</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
      <div class="form-field"><label class="form-label">First Name *</label><input class="form-input" id="la-fn" placeholder="Jane"></div>
      <div class="form-field"><label class="form-label">Last Name *</label><input class="form-input" id="la-ln" placeholder="Smith"></div>
      <div class="form-field"><label class="form-label">Email</label><input class="form-input" id="la-em" type="email" placeholder="jane@company.com"></div>
      <div class="form-field"><label class="form-label">Phone</label><input class="form-input" id="la-ph" type="tel" placeholder="(555) 000-0000"></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Company</label><input class="form-input" id="la-co" placeholder="Acme Events"></div>
    </div>
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Event (if known)</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
      <div class="form-field"><label class="form-label">Event Type</label><input class="form-input" id="la-et" placeholder="Conference, Concert..."></div>
      <div class="form-field"><label class="form-label">Event Date</label><input class="form-input" id="la-ed" type="date"></div>
      <div class="form-field"><label class="form-label">Venue City</label><input class="form-input" id="la-vc" placeholder="Baltimore"></div>
      <div class="form-field"><label class="form-label">Venue State</label><input class="form-input" id="la-vs" placeholder="MD"></div>
    </div>
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Pipeline</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:16px">
      <div class="form-field"><label class="form-label">Source</label>
        <select class="form-select" id="la-src">
          ${[['website','Website Form'],['referral','Referral'],['social','Social Media'],['cold_outreach','Cold Outreach'],['repeat_client','Repeat Client'],['other','Other']].map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Budget Range</label>
        <select class="form-select" id="la-br">
          ${['','Under $5k','$5k–$10k','$10k–$25k','$25k–$50k','$50k–$100k','$100k+','Unknown'].map(b=>`<option value="${b}">${b||'— Not specified —'}</option>`).join('')}
        </select></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label>
        <textarea class="form-input form-textarea" id="la-notes" placeholder="Any initial context about this lead..."></textarea></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('lead-add-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="window.Leads.saveLead()">Add Lead</button>
    </div>
    <div id="la-msg" class="mok" style="margin-top:8px"></div>`;
  document.getElementById('lead-add-modal').classList.add('open');
  setTimeout(() => document.getElementById('la-fn')?.focus(), 80);
}

async function saveLead() {
  const fn = _v('la-fn'), ln = _v('la-ln');
  if (!fn || !ln) { _msg('la-msg','First and last name required.',true); return; }
  const data = {
    first_name:fn, last_name:ln, email:_v('la-em'), phone:_v('la-ph'), company:_v('la-co'),
    event_type:_v('la-et'), event_date:_v('la-ed')||null,
    venue_city:_v('la-vc'), venue_state:_v('la-vs'),
    source:document.getElementById('la-src')?.value||'website',
    budget_range:document.getElementById('la-br')?.value||'',
    notes:_v('la-notes'), status:'new', created_by:getProfile().id,
  };
  const { data: lead, error } = await supabase.from('leads').insert(data).select().single();
  if (error) { _msg('la-msg','Failed to save.',true); console.error(error); return; }
  await logActivity('lead', lead.id, 'created', { name:`${fn} ${ln}` });
  document.getElementById('lead-add-modal').classList.remove('open');
  showToast('Lead added!', 'success');
  openLead(lead.id);
}

// ============================================================
// LEAD DETAIL VIEW — 4 tabs, all inline editable
// ============================================================

async function openLead(id) {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading...</div></div>`;
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
  if (!_allUsers.length) _allUsers = await _fetchUsers();
  const lead = await _fetchLead(id);
  if (!lead) { mc.innerHTML = `<div class="empty-state"><div class="empty-title">Lead not found</div></div>`; return; }
  _currentLead = lead;
  _renderLeadDetail(mc);
}

function _renderLeadDetail(mc) {
  const l = _currentLead;
  const assignees = (l.lead_assignments||[]);
  const canManage = isAdmin() || getProfile()?.role === 'manager';

  mc.innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <button class="btn" onclick="window.navigateTo('leads')" style="font-size:12px;padding:5px 11px">← Leads</button>
          <span class="tag ${_stag(l.status)}" id="lead-status-badge">${l.status}</span>
          ${l.status==='qualified'?`<button class="btn btn-primary" onclick="window.Leads.convertToProposal('${l.id}')">→ Create Proposal</button>`:''}
        </div>
        <div style="font-family:'Barlow',sans-serif;font-size:24px;font-weight:800">${escH(l.first_name)} ${escH(l.last_name)}</div>
        <div class="text-small text-muted" style="margin-top:3px">
          ${l.company?`🏢 ${escH(l.company)} · `:''}${l.email?`✉ ${escH(l.email)} · `:''}${l.phone?`📞 ${escH(l.phone)}`:''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="form-select" style="font-size:12px;padding:6px 10px" onchange="window.Leads.updateStatus('${l.id}',this.value)">
          ${STATUSES.map(s=>`<option value="${s.key}" ${l.status===s.key?'selected':''}>${s.label}</option>`).join('')}
        </select>
        <button class="btn btn-danger" onclick="window.Leads.deleteLead('${l.id}')">Delete</button>
      </div>
    </div>

    <!-- Assignees -->
    <div class="card" style="margin-bottom:16px;padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700">Assigned To</div>
        ${canManage?`<button class="btn" style="font-size:11px;padding:4px 10px" onclick="window.Leads.openAssign()">+ Assign</button>`:''}
      </div>
      <div id="assignee-list" style="display:flex;gap:8px;flex-wrap:wrap">
        ${!assignees.length
          ? `<span style="font-size:13px;color:var(--color-muted)">Unassigned</span>`
          : assignees.map(a => `
            <div style="display:flex;align-items:center;gap:6px;background:#f1f5f9;border-radius:6px;padding:5px 10px;font-size:12px;font-weight:500">
              ${a.profiles?`${a.profiles.first_name} ${a.profiles.last_name}`:'—'}
              ${canManage?`<button onclick="window.Leads.removeAssignee('${a.id}')" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:14px;padding:0;line-height:1">×</button>`:''}
            </div>`).join('')}
      </div>
    </div>

    <!-- Tabs -->
    <div class="tab-bar">
      <button class="tab-btn active" id="lt-overview" onclick="window.Leads.showLTab('overview')">Overview</button>
      <button class="tab-btn" id="lt-scope" onclick="window.Leads.showLTab('scope')">Project Scope</button>
      <button class="tab-btn" id="lt-activity" onclick="window.Leads.showLTab('activity')">Activity</button>
      <button class="tab-btn" id="lt-tasks" onclick="window.Leads.showLTab('tasks')">Follow-up Tasks</button>
    </div>

    <div class="tab-panel active" id="lp-overview">${_overviewTab()}</div>
    <div class="tab-panel" id="lp-scope">${_scopeTab()}</div>
    <div class="tab-panel" id="lp-activity">${_activityTabShell()}</div>
    <div class="tab-panel" id="lp-tasks">${_tasksTabShell()}</div>

    <!-- Assign modal -->
    <div class="modal-overlay" id="assign-modal">
      <div class="modal" style="max-width:420px">
        <div class="modal-header"><div class="modal-title">Assign Team Member</div>
          <button class="modal-close" onclick="document.getElementById('assign-modal').classList.remove('open')">✕</button></div>
        <div class="form-field" style="margin-bottom:14px"><label class="form-label">Team Member</label>
          <select class="form-select" id="assign-user-sel">
            <option value="">— Select —</option>
            ${_allUsers.filter(u => !(_currentLead.lead_assignments||[]).find(a=>a.user_id===u.id)).map(u=>`<option value="${u.id}">${u.first_name} ${u.last_name} (${u.role})</option>`).join('')}
          </select></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn" onclick="document.getElementById('assign-modal').classList.remove('open')">Cancel</button>
          <button class="btn btn-primary" onclick="window.Leads.doAssign()">Assign</button>
        </div>
      </div>
    </div>`;

  // Load activity and tasks in background
  _loadActivity();
  _loadLeadTasks();
}

// ── OVERVIEW TAB ─────────────────────────────────────────────

function _overviewTab() {
  const l = _currentLead;
  const fi = (id, label, val, type='text', ph='') =>
    `<div class="form-field"><label class="form-label">${label}</label>
      <input class="form-input" id="ov-${id}" type="${type}" placeholder="${ph}" value="${escH(String(val||''))}"
        onchange="window.Leads.saveField('${id}',this.value)"></div>`;
  const fs = (id, label, opts, val) =>
    `<div class="form-field"><label class="form-label">${label}</label>
      <select class="form-select" id="ov-${id}" onchange="window.Leads.saveField('${id}',this.value)">
        ${opts.map(([v,lbl])=>`<option value="${v}" ${val===v?'selected':''}>${lbl}</option>`).join('')}
      </select></div>`;
  const fta = (id, label, val) =>
    `<div class="form-field" style="grid-column:1/-1"><label class="form-label">${label}</label>
      <textarea class="form-input form-textarea" id="ov-${id}" onchange="window.Leads.saveField('${id}',this.value)">${escH(val||'')}</textarea></div>`;

  return `<div class="card">
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:12px">Contact Information</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:18px">
      ${fi('first_name','First Name',l.first_name)}
      ${fi('last_name','Last Name',l.last_name)}
      ${fi('email','Email',l.email,'email','jane@company.com')}
      ${fi('phone','Phone',l.phone,'tel','(555) 000-0000')}
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Company</label>
        <input class="form-input" id="ov-company" value="${escH(l.company||'')}" placeholder="Acme Events"
          onchange="window.Leads.saveField('company',this.value)"></div>
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:12px">Event Details</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:18px">
      ${fi('event_type','Event Type',l.event_type,'text','Corporate Conference, Concert...')}
      ${fi('event_date','Event Date',l.event_date,'date')}
      ${fi('venue_name','Venue Name',l.venue_name,'text','Baltimore Convention Center')}
      ${fi('venue_city','Venue City',l.venue_city,'text','Baltimore')}
      ${fi('venue_state','Venue State',l.venue_state,'text','MD')}
      ${fs('environment','Environment',[['indoor','Indoor'],['outdoor','Outdoor'],['unknown','Unknown']],l.environment||'indoor')}
      ${fi('wall_width_ft','Approx. Width (ft)',l.wall_width_ft,'number')}
      ${fi('wall_height_ft','Approx. Height (ft)',l.wall_height_ft,'number')}
      ${fs('budget_range','Budget Range',[['','— Not specified —'],['Under $5k','Under $5k'],['$5k–$10k','$5k–$10k'],['$10k–$25k','$10k–$25k'],['$25k–$50k','$25k–$50k'],['$50k–$100k','$50k–$100k'],['$100k+','$100k+'],['Unknown','Unknown']],l.budget_range||'')}
      ${fs('source','Source',[['website','Website Form'],['referral','Referral'],['social','Social Media'],['cold_outreach','Cold Outreach'],['repeat_client','Repeat Client'],['other','Other']],l.source||'website')}
      ${fta('notes','Notes',l.notes)}
    </div>
    <div id="ov-save-msg" class="mok"></div>
  </div>`;
}

// ── SCOPE TAB ────────────────────────────────────────────────

function _scopeTab() {
  const l = _currentLead;
  const schedule = l.schedule || {};
  const wallSpecs = Array.isArray(l.wall_specs) ? l.wall_specs : [];
  const services = Array.isArray(l.additional_services) ? l.additional_services : [];
  const env = l.environment || 'indoor';
  const supportOpts = env === 'outdoor' ? SUPPORT_OPTS_OUTDOOR : SUPPORT_OPTS_INDOOR;

  return `<div style="display:flex;flex-direction:column;gap:14px">

    <!-- Jobsite -->
    <div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Jobsite</div>
      <div class="form-grid form-grid-2" style="gap:10px">
        <div class="form-field" style="grid-column:1/-1"><label class="form-label">Street Address</label>
          <input class="form-input" id="sc-addr" placeholder="123 Convention Center Dr" value="${escH(l.jobsite_address||'')}"
            onchange="window.Leads.saveScopeField('jobsite_address',this.value)"></div>
        <div class="form-field"><label class="form-label">City</label>
          <input class="form-input" id="sc-city" placeholder="Baltimore" value="${escH(l.jobsite_city||l.venue_city||'')}"
            onchange="window.Leads.saveScopeField('jobsite_city',this.value)"></div>
        <div class="form-field"><label class="form-label">State</label>
          <input class="form-input" id="sc-state" placeholder="MD" value="${escH(l.jobsite_state||l.venue_state||'')}"
            onchange="window.Leads.saveScopeField('jobsite_state',this.value)"></div>
        <div class="form-field"><label class="form-label">ZIP</label>
          <input class="form-input" id="sc-zip" placeholder="21201" value="${escH(l.jobsite_zip||'')}"
            onchange="window.Leads.saveScopeField('jobsite_zip',this.value)"></div>
      </div>
    </div>

    <!-- Schedule -->
    <div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Schedule</div>
      <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:8px">🚛 Load In</div>
        <div class="form-grid form-grid-2" style="gap:10px">
          <div class="form-field"><label class="form-label">Date</label><input class="form-input" id="sc-lidate" type="date" value="${escH(schedule.loadIn?.date||'')}" onchange="window.Leads.saveSchedule()"></div>
          <div class="form-field"><label class="form-label">Start Time</label><input class="form-input" id="sc-litime" type="time" value="${escH(schedule.loadIn?.time||'')}" onchange="window.Leads.saveSchedule()"></div>
        </div>
      </div>
      <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:8px">🎬 Show Days</div>
        <div id="sc-showdays">${(schedule.showDays||[{date:'',startTime:'',endTime:''}]).map((sd,i)=>_showDayRow(sd,i)).join('')}</div>
        <button class="btn" style="margin-top:8px;font-size:12px" onclick="window.Leads.addShowDay()">+ Add Show Day</button>
      </div>
      <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:8px">🚛 Load Out</div>
        <div class="form-grid form-grid-2" style="gap:10px">
          <div class="form-field"><label class="form-label">Date</label><input class="form-input" id="sc-lodate" type="date" value="${escH(schedule.loadOut?.date||'')}" onchange="window.Leads.saveSchedule()"></div>
          <div class="form-field"><label class="form-label">Start Time</label><input class="form-input" id="sc-lotime" type="time" value="${escH(schedule.loadOut?.time||'')}" onchange="window.Leads.saveSchedule()"></div>
        </div>
      </div>
    </div>

    <!-- Wall Specs -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700">Wall Specifications</div>
        <button class="btn" style="font-size:12px" onclick="window.Leads.addWallSpec()">+ Add Wall</button>
      </div>
      <div id="sc-walls" style="display:flex;flex-direction:column;gap:10px">
        ${wallSpecs.length
          ? wallSpecs.map((w,i) => _wallSpecRow(w,i)).join('')
          : _wallSpecRow({width:'',height:'',qty:1},0)}
      </div>
    </div>

    <!-- Support Method -->
    <div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Support Method</div>
      <div class="option-grid" style="margin-bottom:${l.support_method?.includes('riser')?'12px':'0'}">
        ${supportOpts.map(o=>`
          <button class="option-btn ${l.support_method===o?'selected':''}"
            onclick="window.Leads.setSupportMethod(this,'${o}')">${o}</button>`).join('')}
      </div>
      ${l.support_method?.includes('riser')?`
        <div class="form-field" style="max-width:240px">
          <label class="form-label">How high off ground does bottom of wall need to be? (inches)</label>
          <input class="form-input" id="sc-riser" type="number" placeholder="e.g. 24"
            value="${escH(String(l.riser_height_inches||''))}"
            onchange="window.Leads.saveScopeField('riser_height_inches',this.value)">
        </div>`:''}
    </div>

    <!-- Rigging Responsibility -->
    <div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Rigging Responsibility</div>
      <div class="option-grid">
        ${['Visual Affect supplies all rigging','Client / Venue responsible for rigging','Split — discuss per item'].map(o=>`
          <button class="option-btn ${l.rigging_responsibility===o?'selected':''}"
            onclick="window.Leads.setRigging(this,'${o}')">${o}</button>`).join('')}
      </div>
    </div>

    <!-- Additional Services -->
    <div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Additional Services</div>
      <div class="option-grid">
        ${ADDITIONAL_SERVICES.map(s=>`
          <button class="option-btn ${services.includes(s)?'selected':''}"
            onclick="window.Leads.toggleService(this,'${s}')">${s}</button>`).join('')}
      </div>
    </div>

    <!-- Scope Notes -->
    <div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Scope Notes</div>
      <textarea class="form-input form-textarea" id="sc-notes" rows="5"
        placeholder="Any additional scope details, special requirements, or open questions..."
        onchange="window.Leads.saveScopeField('scope_notes',this.value)">${escH(l.scope_notes||'')}</textarea>
    </div>

    <div id="scope-save-msg" class="mok"></div>
  </div>`;
}

function _showDayRow(sd, i) {
  return `<div class="sd-row" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px">
    <div><label class="form-label">Date</label><input class="form-input sd-date" type="date" value="${escH(sd.date||'')}" onchange="window.Leads.saveSchedule()"></div>
    <div><label class="form-label">Start</label><input class="form-input sd-start" type="time" value="${escH(sd.startTime||'')}" onchange="window.Leads.saveSchedule()"></div>
    <div><label class="form-label">End</label><input class="form-input sd-end" type="time" value="${escH(sd.endTime||'')}" onchange="window.Leads.saveSchedule()"></div>
    <div style="padding-top:18px"><button class="btn btn-danger" style="padding:7px 9px" onclick="window.Leads.removeShowDay(${i})">✕</button></div>
  </div>`;
}

function _wallSpecRow(w, i) {
  return `<div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span style="font-weight:600;font-size:13px">Wall ${i+1}</span>
      ${i>0?`<button class="btn btn-danger" style="font-size:11px;padding:4px 9px" onclick="window.Leads.removeWallSpec(${i})">Remove</button>`:''}
    </div>
    <div class="form-grid form-grid-3" style="gap:10px">
      <div class="form-field"><label class="form-label">Width (ft)</label><input class="form-input wall-w" type="number" placeholder="20" step="0.5" value="${w.width||''}" onchange="window.Leads.saveWallSpecs()"></div>
      <div class="form-field"><label class="form-label">Height (ft)</label><input class="form-input wall-h" type="number" placeholder="12" step="0.5" value="${w.height||''}" onchange="window.Leads.saveWallSpecs()"></div>
      <div class="form-field"><label class="form-label">Qty</label><input class="form-input wall-qty" type="number" placeholder="1" min="1" value="${w.qty||1}" onchange="window.Leads.saveWallSpecs()"></div>
    </div>
  </div>`;
}

// ── ACTIVITY TAB ─────────────────────────────────────────────

function _activityTabShell() {
  return `
    <div class="card" style="margin-bottom:14px">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Log Activity</div>
      <select class="form-select" id="act-type" style="max-width:200px;margin-bottom:8px">
        <option value="note">📝 Note</option>
        <option value="call">📞 Call</option>
        <option value="email">✉ Email</option>
        <option value="meeting">🤝 Meeting</option>
      </select>
      <textarea class="form-input form-textarea" id="act-body" placeholder="What happened? What was discussed? Next steps?" rows="3"></textarea>
      <button class="btn btn-primary" style="margin-top:10px" onclick="window.Leads.logAct()">Log Activity</button>
    </div>
    <div id="activity-tl"></div>`;
}

async function _loadActivity() {
  const el = document.getElementById('activity-tl'); if (!el) return;
  const { data: acts } = await supabase.from('lead_activity')
    .select('*,profiles!lead_activity_performed_by_fkey(first_name,last_name)')
    .eq('lead_id', _currentLead.id).order('created_at', { ascending: false });
  const icons = { note:'📝', call:'📞', email:'✉', meeting:'🤝', task:'✅' };
  el.innerHTML = !acts?.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No activity yet</div><p class="empty-sub">Log calls, emails, meetings and notes above.</p></div>`
    : `<div style="display:flex;flex-direction:column;gap:8px">${acts.map(a=>`
        <div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px 14px;display:flex;gap:12px">
          <div style="font-size:20px;flex-shrink:0">${icons[a.type]||'📝'}</div>
          <div style="flex:1">
            <div style="font-size:13px;line-height:1.6">${escH(a.body)}</div>
            <div class="text-small text-muted" style="margin-top:4px">
              ${a.profiles?`${a.profiles.first_name} ${a.profiles.last_name} · `:''}${new Date(a.created_at).toLocaleString()}
            </div>
          </div>
        </div>`).join('')}</div>`;
}

async function logAct() {
  const type = document.getElementById('act-type')?.value||'note';
  const body = document.getElementById('act-body')?.value.trim();
  if (!body) { showToast('Please enter activity details.','error'); return; }
  await supabase.from('lead_activity').insert({ lead_id:_currentLead.id, type, body, performed_by:getProfile().id });
  document.getElementById('act-body').value = '';
  showToast('Logged!','success'); _loadActivity();
}

// ── TASKS TAB ─────────────────────────────────────────────────

function _tasksTabShell() {
  return `<div style="margin-bottom:12px"><button class="btn-add" onclick="window.Leads.addTask()">+ Add Follow-up Task</button></div>
    <div id="lead-tasks-wrap"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div>`;
}

async function _loadLeadTasks() {
  const el = document.getElementById('lead-tasks-wrap'); if (!el) return;
  const { data: tasks } = await supabase.from('tasks')
    .select('*').ilike('description', `%lead:${_currentLead.id}%`)
    .order('due_date', { ascending: true, nullsFirst: false });
  const pc = { low:'#6b7280', medium:'#2563eb', high:'#d97706', urgent:'#dc2626' };
  el.innerHTML = !tasks?.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No follow-up tasks</div></div>`
    : `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th>Due</th><th></th></tr></thead>
        <tbody>${tasks.map(t=>`<tr>
          <td><strong>${escH(t.title)}</strong></td>
          <td><span style="color:${pc[t.priority]||'#6b7280'};font-weight:600;font-size:11px;text-transform:uppercase">${t.priority}</span></td>
          <td><span class="tag ${t.status==='done'?'tag-green':t.status==='in_progress'?'tag-blue':'tag-gray'}">${t.status.replace('_',' ')}</span></td>
          <td class="text-small">${t.due_date?fmtDate(t.due_date):'—'}</td>
          <td>${t.status!=='done'?`<button class="btn btn-green" style="font-size:11px;padding:4px 9px" onclick="window.Leads.markDone('${t.id}')">✓</button>`:''}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
}

async function addTask() {
  const m = document.createElement('div'); m.className = 'modal-overlay open';
  m.innerHTML = `<div class="modal" style="max-width:440px">
    <div class="modal-header"><div class="modal-title">Add Follow-up Task</div>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-field" style="margin-bottom:12px"><label class="form-label">Task *</label>
      <input class="form-input" id="ft-title" placeholder="e.g. Call back to discuss pricing"></div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
      <div class="form-field"><label class="form-label">Due Date</label><input class="form-input" id="ft-due" type="date"></div>
      <div class="form-field"><label class="form-label">Priority</label>
        <select class="form-select" id="ft-pri">
          <option value="low">Low</option><option value="medium" selected>Medium</option>
          <option value="high">High</option><option value="urgent">Urgent</option>
        </select></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="window.Leads._doAddTask(this)">Add Task</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}

async function _doAddTask(btn) {
  const title = document.getElementById('ft-title')?.value.trim();
  if (!title) { showToast('Title required.','error'); return; }
  await supabase.from('tasks').insert({
    title, description:`lead:${_currentLead.id}`,
    due_date: document.getElementById('ft-due')?.value||null,
    priority: document.getElementById('ft-pri')?.value||'medium',
    status:'todo', assigned_to:getProfile().id, created_by:getProfile().id,
  });
  btn.closest('.modal-overlay').remove();
  showToast('Task added!','success'); _loadLeadTasks();
}

async function markDone(taskId) {
  await supabase.from('tasks').update({ status:'done', completed_at:new Date().toISOString() }).eq('id', taskId);
  showToast('Done!','success'); _loadLeadTasks();
}

// ── TAB SWITCHING ────────────────────────────────────────────

function showLTab(name) {
  ['overview','scope','activity','tasks'].forEach(t => {
    document.getElementById('lt-'+t)?.classList.toggle('active', t===name);
    document.getElementById('lp-'+t)?.classList.toggle('active', t===name);
  });
}

// ── INLINE FIELD SAVES ────────────────────────────────────────

async function saveField(field, value) {
  const update = { [field]: value || (field.includes('_ft') ? null : value) };
  const { error } = await supabase.from('leads').update(update).eq('id', _currentLead.id);
  if (error) { showToast('Save failed.','error'); return; }
  _currentLead[field] = value;
  _msg('ov-save-msg','✓ Saved'); setTimeout(()=>{ const el=document.getElementById('ov-save-msg'); if(el)el.textContent=''; },2000);
}

async function saveScopeField(field, value) {
  const update = { [field]: value };
  const { error } = await supabase.from('leads').update(update).eq('id', _currentLead.id);
  if (error) { showToast('Save failed.','error'); return; }
  _currentLead[field] = value;
  _msg('scope-save-msg','✓ Saved'); setTimeout(()=>{ const el=document.getElementById('scope-save-msg'); if(el)el.textContent=''; },2000);
}

async function saveSchedule() {
  const rows = document.querySelectorAll('.sd-row');
  const showDays = [...rows].map(r => ({
    date: r.querySelector('.sd-date')?.value||'',
    startTime: r.querySelector('.sd-start')?.value||'',
    endTime: r.querySelector('.sd-end')?.value||'',
  }));
  const schedule = {
    loadIn: { date: _v('sc-lidate'), time: _v('sc-litime') },
    showDays,
    loadOut: { date: _v('sc-lodate'), time: _v('sc-lotime') },
  };
  await supabase.from('leads').update({ schedule }).eq('id', _currentLead.id);
  _currentLead.schedule = schedule;
  _msg('scope-save-msg','✓ Schedule saved'); setTimeout(()=>{ const el=document.getElementById('scope-save-msg'); if(el)el.textContent=''; },2000);
}

function addShowDay() {
  const rows = document.querySelectorAll('.sd-row');
  const days = [...rows].map(r => ({ date:r.querySelector('.sd-date')?.value||'', startTime:r.querySelector('.sd-start')?.value||'', endTime:r.querySelector('.sd-end')?.value||'' }));
  days.push({ date:'', startTime:'', endTime:'' });
  document.getElementById('sc-showdays').innerHTML = days.map((sd,i) => _showDayRow(sd,i)).join('');
}

function removeShowDay(i) {
  const rows = document.querySelectorAll('.sd-row');
  let days = [...rows].map(r => ({ date:r.querySelector('.sd-date')?.value||'', startTime:r.querySelector('.sd-start')?.value||'', endTime:r.querySelector('.sd-end')?.value||'' }));
  if (days.length <= 1) return;
  days.splice(i, 1);
  document.getElementById('sc-showdays').innerHTML = days.map((sd,idx) => _showDayRow(sd,idx)).join('');
  saveSchedule();
}

async function saveWallSpecs() {
  const wallEls = document.querySelectorAll('#sc-walls > div');
  const walls = [...wallEls].map(el => ({
    width: parseFloat(el.querySelector('.wall-w')?.value)||0,
    height: parseFloat(el.querySelector('.wall-h')?.value)||0,
    qty: parseInt(el.querySelector('.wall-qty')?.value)||1,
  })).filter(w => w.width || w.height);
  await supabase.from('leads').update({ wall_specs: walls }).eq('id', _currentLead.id);
  _currentLead.wall_specs = walls;
  _msg('scope-save-msg','✓ Saved'); setTimeout(()=>{ const el=document.getElementById('scope-save-msg'); if(el)el.textContent=''; },2000);
}

function addWallSpec() {
  const wallEls = document.querySelectorAll('#sc-walls > div');
  const walls = [...wallEls].map(el => ({
    width: el.querySelector('.wall-w')?.value||'',
    height: el.querySelector('.wall-h')?.value||'',
    qty: el.querySelector('.wall-qty')?.value||1,
  }));
  walls.push({ width:'', height:'', qty:1 });
  document.getElementById('sc-walls').innerHTML = walls.map((w,i) => _wallSpecRow(w,i)).join('');
}

function removeWallSpec(i) {
  const wallEls = document.querySelectorAll('#sc-walls > div');
  let walls = [...wallEls].map(el => ({
    width: el.querySelector('.wall-w')?.value||'',
    height: el.querySelector('.wall-h')?.value||'',
    qty: el.querySelector('.wall-qty')?.value||1,
  }));
  if (walls.length <= 1) return;
  walls.splice(i, 1);
  document.getElementById('sc-walls').innerHTML = walls.map((w,idx) => _wallSpecRow(w,idx)).join('');
  saveWallSpecs();
}

async function setSupportMethod(btn, method) {
  btn.closest('.option-grid').querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  await supabase.from('leads').update({ support_method: method }).eq('id', _currentLead.id);
  _currentLead.support_method = method;
  // Re-render scope tab to show/hide riser height
  const el = document.getElementById('lp-scope'); if (el) el.innerHTML = _scopeTab();
  _msg('scope-save-msg','✓ Saved');
}

async function setRigging(btn, method) {
  btn.closest('.option-grid').querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  await supabase.from('leads').update({ rigging_responsibility: method }).eq('id', _currentLead.id);
  _currentLead.rigging_responsibility = method;
  _msg('scope-save-msg','✓ Saved');
}

async function toggleService(btn, svc) {
  const services = Array.isArray(_currentLead.additional_services) ? [..._currentLead.additional_services] : [];
  const idx = services.indexOf(svc);
  if (idx >= 0) services.splice(idx, 1); else services.push(svc);
  btn.classList.toggle('selected', services.includes(svc));
  await supabase.from('leads').update({ additional_services: services }).eq('id', _currentLead.id);
  _currentLead.additional_services = services;
  _msg('scope-save-msg','✓ Saved');
}

// ── ASSIGNEES ─────────────────────────────────────────────────

function openAssign() {
  document.getElementById('assign-modal').classList.add('open');
}

async function doAssign() {
  const userId = document.getElementById('assign-user-sel')?.value;
  if (!userId) { showToast('Select a user.','error'); return; }
  const { error } = await supabase.from('lead_assignments').insert({
    lead_id: _currentLead.id, user_id: userId, assigned_by: getProfile().id,
  });
  if (error) { showToast('Failed to assign.','error'); return; }
  document.getElementById('assign-modal').classList.remove('open');
  showToast('Assigned!','success');
  const lead = await _fetchLead(_currentLead.id);
  _currentLead = lead;
  _renderLeadDetail(document.getElementById('main-content'));
}

async function removeAssignee(assignmentId) {
  await supabase.from('lead_assignments').delete().eq('id', assignmentId);
  showToast('Removed.','success');
  const lead = await _fetchLead(_currentLead.id);
  _currentLead = lead;
  _renderLeadDetail(document.getElementById('main-content'));
}

// ── STATUS + DELETE ───────────────────────────────────────────

async function updateStatus(id, status) {
  await supabase.from('leads').update({ status }).eq('id', id);
  if (_currentLead?.id === id) _currentLead.status = status;
  const badge = document.getElementById('lead-status-badge');
  if (badge) { badge.className = `tag ${_stag(status)}`; badge.textContent = status; }

  // Show convert button if qualified
  if (status === 'qualified') {
    const header = badge?.closest('div');
    if (header && !header.querySelector('[onclick*="convertToProposal"]')) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = '→ Create Proposal';
      btn.setAttribute('onclick', `window.Leads.convertToProposal('${id}')`);
      header.appendChild(btn);
    }
  }

  await logActivity('lead', id, 'status_changed', { status });
  showToast(`Status: ${status}`, 'success');
}

async function deleteLead(id) {
  if (!confirm('Delete this lead? This cannot be undone.')) return;
  await dbDelete('leads', id);
  showToast('Lead deleted.','success');
  window.navigateTo('leads');
}

// ── CONVERT TO PROPOSAL ───────────────────────────────────────

async function convertToProposal(leadId) {
  const l = _currentLead || await _fetchLead(leadId);
  if (!l) return;
  if (!confirm(`Convert this lead to a proposal? A client record will be created if one doesn't exist.`)) return;

  // Create or reuse client
  let clientId = l.client_id;
  if (!clientId) {
    const { data: nc } = await supabase.from('clients').insert({
      company_name: l.company || `${l.first_name} ${l.last_name}`,
      contact_name: `${l.first_name} ${l.last_name}`,
      email: l.email||'', phone: l.phone||'', created_by: getProfile().id,
    }).select().single();
    clientId = nc?.id;
    if (clientId) await supabase.from('leads').update({ client_id: clientId }).eq('id', leadId);
  }

  // Store ALL scope data for proposal wizard to pick up
  sessionStorage.setItem('proposal_from_lead', JSON.stringify({
    client_id: clientId,
    title: `${l.company||l.first_name+' '+l.last_name} — ${l.event_type||'LED Wall'} Proposal`,
    jobsite_address: l.jobsite_address||'',
    jobsite_city: l.jobsite_city||l.venue_city||'',
    jobsite_state: l.jobsite_state||l.venue_state||'',
    jobsite_zip: l.jobsite_zip||'',
    schedule: l.schedule||{},
    wall_specs: l.wall_specs||[],
    environment: l.environment||'indoor',
    support_method: l.support_method||'',
    rigging_responsibility: l.rigging_responsibility||'',
    additional_services: l.additional_services||[],
    scope_notes: l.scope_notes||'',
    lead_id: leadId,
  }));

  await supabase.from('leads').update({ status:'converted' }).eq('id', leadId);
  await logActivity('lead', leadId, 'converted_to_proposal', { client_id: clientId });
  showToast('Lead converted! Opening proposal wizard...','success');
  setTimeout(() => window.navigateTo('proposals'), 600);
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

window.Leads = {
  openAdd, saveLead, openLead, deleteLead,
  toggleView, filterStatus, showLTab,
  saveField, saveScopeField, saveSchedule, saveWallSpecs,
  addShowDay, removeShowDay, addWallSpec, removeWallSpec,
  setSupportMethod, setRigging, toggleService,
  openAssign, doAssign, removeAssignee,
  logAct, addTask, _doAddTask, markDone,
  updateStatus, convertToProposal,
};
