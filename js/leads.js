// ============================================================
// leads.js — CRM Lead Pipeline
// Capture → Qualify → Convert to Proposal
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin } from './auth.js';

// ============================================================
// MAIN RENDER
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading leads...</div></div>`;
  const leads = await _fetchLeads();
  _renderPipeline(container, leads);
}

const STATUSES = [
  { key:'new',         label:'New',          color:'#6b7280' },
  { key:'assigned',    label:'Assigned',     color:'#2563eb' },
  { key:'contacted',   label:'Contacted',    color:'#9333ea' },
  { key:'qualified',   label:'Qualified',    color:'#d97706' },
  { key:'unqualified', label:'Unqualified',  color:'#dc2626' },
  { key:'converted',   label:'Converted',    color:'#166534' },
  { key:'lost',        label:'Lost',         color:'#991b1b' },
];

let _currentView = 'kanban';
let _allLeads = [];
let _currentLead = null;

function _renderPipeline(container, leads) {
  const byStatus = {};
  STATUSES.forEach(s => byStatus[s.key] = []);
  leads.forEach(l => { if (byStatus[l.status] !== undefined) byStatus[l.status].push(l); });
  const active = leads.filter(l => !['converted','lost','unqualified'].includes(l.status));

  container.innerHTML = `
    <div class="section-header">
      <div><div class="section-title">Leads</div>
           <div class="section-sub">${leads.length} total · ${active.length} active</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="window.Leads.toggleView()" id="view-toggle-btn">📋 List View</button>
        <button class="btn-add" onclick="window.Leads.openAdd()">+ New Lead</button>
      </div>
    </div>

    <!-- Status pills -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
      ${STATUSES.filter(s=>byStatus[s.key].length).map(s=>`
        <div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:7px 12px;box-shadow:var(--shadow-sm);display:flex;align-items:center;gap:7px;cursor:pointer"
          onclick="window.Leads.filterStatus('${s.key}')">
          <div style="width:8px;height:8px;border-radius:50%;background:${s.color}"></div>
          <span style="font-size:12px;font-weight:500">${s.label}</span>
          <span style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;color:var(--color-accent)">${byStatus[s.key].length}</span>
        </div>`).join('')}
    </div>

    <!-- KANBAN -->
    <div id="leads-kanban" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:16px">
      ${STATUSES.filter(s=>!['converted','lost'].includes(s.key)).map(s=>`
        <div style="min-width:230px;flex-shrink:0;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:12px;padding:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:8px;height:8px;border-radius:50%;background:${s.color}"></div>
              <span style="font-family:'Barlow',sans-serif;font-size:12px;font-weight:700">${s.label}</span>
            </div>
            <span style="font-size:12px;color:var(--color-muted);font-weight:600">${byStatus[s.key].length}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${byStatus[s.key].map(l=>_leadCard(l)).join('')}
            ${!byStatus[s.key].length?`<div style="text-align:center;padding:16px;color:var(--color-muted);font-size:12px">No leads</div>`:''}
          </div>
        </div>`).join('')}
    </div>

    <!-- LIST -->
    <div id="leads-list" style="display:none">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Company</th><th>Event</th><th>Date</th><th>Source</th><th>Status</th><th>Assigned</th><th></th></tr></thead>
          <tbody id="leads-tbody">
            ${leads.map(l=>`<tr data-status="${l.status}">
              <td><strong>${escH(l.first_name)} ${escH(l.last_name)}</strong><div class="text-small text-muted">${escH(l.email||'')}</div></td>
              <td>${escH(l.company||'—')}</td>
              <td>${escH(l.event_type||'—')}${l.venue_city?`<div class="text-small text-muted">📍 ${escH(l.venue_city)}${l.venue_state?', '+escH(l.venue_state):''}</div>`:''}</td>
              <td class="text-small">${l.event_date?new Date(l.event_date+'T00:00:00').toLocaleDateString():'—'}</td>
              <td><span class="tag tag-gray" style="font-size:10px">${(l.source||'').replace(/_/g,' ')}</span></td>
              <td><span class="tag ${_stag(l.status)}">${l.status}</span></td>
              <td class="text-small">${l.profiles?`${l.profiles.first_name} ${l.profiles.last_name}`:'—'}</td>
              <td><button class="btn" style="font-size:11px;padding:4px 10px" onclick="window.Leads.openLead('${l.id}')">Open</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ADD/EDIT MODAL -->
    <div class="modal-overlay" id="lead-modal">
      <div class="modal" style="max-width:620px">
        <div class="modal-header">
          <div class="modal-title" id="lead-modal-title">New Lead</div>
          <button class="modal-close" onclick="window.Leads.closeModal()">✕</button>
        </div>
        <div id="lead-modal-body"></div>
      </div>
    </div>`;
}

function _leadCard(l) {
  return `<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px;cursor:pointer;box-shadow:var(--shadow-sm);transition:box-shadow .12s"
    onclick="window.Leads.openLead('${l.id}')"
    onmouseover="this.style.boxShadow='var(--shadow-md)'"
    onmouseout="this.style.boxShadow='var(--shadow-sm)'">
    <div style="font-weight:600;font-size:13px;margin-bottom:3px">${escH(l.first_name)} ${escH(l.last_name)}</div>
    ${l.company?`<div style="font-size:11px;color:var(--color-muted)">🏢 ${escH(l.company)}</div>`:''}
    ${l.event_type?`<div style="font-size:11px;color:var(--color-muted)">🎬 ${escH(l.event_type)}</div>`:''}
    ${l.event_date?`<div style="font-size:11px;color:var(--color-muted)">📅 ${new Date(l.event_date+'T00:00:00').toLocaleDateString()}</div>`:''}
    ${l.venue_city?`<div style="font-size:11px;color:var(--color-muted)">📍 ${escH(l.venue_city)}${l.venue_state?', '+escH(l.venue_state):''}</div>`:''}
    ${l.budget_range?`<div style="font-size:11px;color:var(--color-muted)">💰 ${escH(l.budget_range)}</div>`:''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
      <span style="font-size:10px;color:var(--color-muted)">${(l.source||'').replace(/_/g,' ')}</span>
      ${l.profiles?`<span style="font-size:10px;background:var(--color-accent-light);color:var(--color-accent-2);padding:2px 7px;border-radius:4px">${l.profiles.first_name} ${l.profiles.last_name[0]}.</span>`:''}
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
    row.style.display = row.dataset.status===status?'':'none';
  });
}

// ── DATA ────────────────────────────────────────────────────

async function _fetchLeads() {
  const { data, error } = await supabase.from('leads')
    .select('*,profiles!leads_assigned_to_fkey(first_name,last_name)')
    .order('created_at', { ascending: false });
  if (error) { console.error('[Leads]', error); return []; }
  _allLeads = data || [];
  return _allLeads;
}

// ── ADD / EDIT ───────────────────────────────────────────────

async function openAdd() {
  const users = await _fetchUsers();
  document.getElementById('lead-modal-title').textContent = 'New Lead';
  document.getElementById('lead-modal-body').innerHTML = _leadForm(null, users);
  document.getElementById('lead-modal').classList.add('open');
  setTimeout(()=>document.getElementById('lf-fn')?.focus(), 80);
}

async function openEdit(id) {
  const [{ data: lead }, users] = await Promise.all([
    supabase.from('leads').select('*').eq('id',id).single(),
    _fetchUsers(),
  ]);
  document.getElementById('lead-modal-title').textContent = 'Edit Lead';
  document.getElementById('lead-modal-body').innerHTML = _leadForm(lead, users);
  document.getElementById('lead-modal').classList.add('open');
}

function closeModal() { document.getElementById('lead-modal').classList.remove('open'); }

function _leadForm(lead, users) {
  const v=(f,def='')=>escH(lead?.[f]||def);
  return `
    <div style="font-family:'Barlow',sans-serif;font-size:12px;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px">Contact</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
      <div class="form-field"><label class="form-label">First Name *</label><input class="form-input" id="lf-fn" value="${v('first_name')}" placeholder="Jane"></div>
      <div class="form-field"><label class="form-label">Last Name *</label><input class="form-input" id="lf-ln" value="${v('last_name')}" placeholder="Smith"></div>
      <div class="form-field"><label class="form-label">Email</label><input class="form-input" id="lf-em" type="email" value="${v('email')}" placeholder="jane@company.com"></div>
      <div class="form-field"><label class="form-label">Phone</label><input class="form-input" id="lf-ph" type="tel" value="${v('phone')}" placeholder="(555) 000-0000"></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Company</label><input class="form-input" id="lf-co" value="${v('company')}" placeholder="Acme Events"></div>
    </div>
    <div style="font-family:'Barlow',sans-serif;font-size:12px;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px">Event Details</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
      <div class="form-field"><label class="form-label">Event Type</label><input class="form-input" id="lf-et" value="${v('event_type')}" placeholder="Corporate Conference, Concert..."></div>
      <div class="form-field"><label class="form-label">Event Date</label><input class="form-input" id="lf-ed" type="date" value="${v('event_date')}"></div>
      <div class="form-field"><label class="form-label">Venue Name</label><input class="form-input" id="lf-vn" value="${v('venue_name')}" placeholder="Baltimore Convention Center"></div>
      <div class="form-field"><label class="form-label">Venue City</label><input class="form-input" id="lf-vc" value="${v('venue_city')}" placeholder="Baltimore"></div>
      <div class="form-field"><label class="form-label">Venue State</label><input class="form-input" id="lf-vs" value="${v('venue_state')}" placeholder="MD"></div>
      <div class="form-field"><label class="form-label">Environment</label>
        <select class="form-select" id="lf-env">
          <option value="indoor" ${(v('environment','indoor'))==='indoor'?'selected':''}>Indoor</option>
          <option value="outdoor" ${v('environment')==='outdoor'?'selected':''}>Outdoor</option>
          <option value="unknown" ${v('environment')==='unknown'?'selected':''}>Unknown</option>
        </select></div>
      <div class="form-field"><label class="form-label">Approx. Width (ft)</label><input class="form-input" id="lf-ww" type="number" value="${v('wall_width_ft')}" placeholder="20" step="0.5"></div>
      <div class="form-field"><label class="form-label">Approx. Height (ft)</label><input class="form-input" id="lf-wh" type="number" value="${v('wall_height_ft')}" placeholder="12" step="0.5"></div>
      <div class="form-field"><label class="form-label">Budget Range</label>
        <select class="form-select" id="lf-br">
          ${['','Under $5k','$5k–$10k','$10k–$25k','$25k–$50k','$50k–$100k','$100k+','Unknown'].map(b=>`<option value="${b}" ${v('budget_range')===b?'selected':''}>${b||'— Not specified —'}</option>`).join('')}
        </select></div>
    </div>
    <div style="font-family:'Barlow',sans-serif;font-size:12px;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px">Pipeline</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:16px">
      <div class="form-field"><label class="form-label">Source</label>
        <select class="form-select" id="lf-src">
          ${[['website','Website Form'],['referral','Referral'],['social','Social Media'],['cold_outreach','Cold Outreach'],['repeat_client','Repeat Client'],['other','Other']].map(([val,lbl])=>`<option value="${val}" ${v('source','website')===val?'selected':''}>${lbl}</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Status</label>
        <select class="form-select" id="lf-st">
          ${STATUSES.map(s=>`<option value="${s.key}" ${v('status','new')===s.key?'selected':''}>${s.label}</option>`).join('')}
        </select></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Assigned To</label>
        <select class="form-select" id="lf-asgn">
          <option value="">— Unassigned —</option>
          ${users.map(u=>`<option value="${u.id}" ${v('assigned_to')===u.id?'selected':''}>${u.first_name} ${u.last_name} (${u.role})</option>`).join('')}
        </select></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label>
        <textarea class="form-input form-textarea" id="lf-notes" placeholder="Any additional context...">${escH(lead?.notes||'')}</textarea></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="window.Leads.closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="window.Leads.saveLead('${lead?.id||''}')">
        ${lead?'Save Changes':'Add Lead'}</button>
    </div>
    <div id="lead-form-msg" class="mok" style="margin-top:8px"></div>`;
}

async function saveLead(existingId) {
  const fn=_v('lf-fn'), ln=_v('lf-ln');
  if (!fn||!ln) { _msg('lead-form-msg','First and last name required.',true); return; }
  const data = {
    first_name:fn, last_name:ln, email:_v('lf-em'), phone:_v('lf-ph'), company:_v('lf-co'),
    event_type:_v('lf-et'), event_date:_v('lf-ed')||null,
    venue_name:_v('lf-vn'), venue_city:_v('lf-vc'), venue_state:_v('lf-vs'),
    environment:document.getElementById('lf-env')?.value||'indoor',
    wall_width_ft:parseFloat(_v('lf-ww'))||null, wall_height_ft:parseFloat(_v('lf-wh'))||null,
    budget_range:document.getElementById('lf-br')?.value||'',
    source:document.getElementById('lf-src')?.value||'website',
    status:document.getElementById('lf-st')?.value||'new',
    assigned_to:document.getElementById('lf-asgn')?.value||null,
    notes:_v('lf-notes'),
  };
  let error;
  if (existingId) { ({error}=await dbUpdate('leads',existingId,data)); }
  else { data.created_by=getProfile().id; ({error}=await dbInsert('leads',data)); }
  if (error) { _msg('lead-form-msg','Failed to save.',true); return; }
  await logActivity('lead',existingId||'new',existingId?'updated':'created',{name:`${fn} ${ln}`});
  closeModal(); showToast(existingId?'Lead updated!':'Lead added!','success');
  window.navigateTo('leads');
}

async function deleteLead(id) {
  if (!confirm('Delete this lead?')) return;
  await dbDelete('leads',id);
  showToast('Lead deleted.','success');
  window.navigateTo('leads');
}

// ── LEAD DETAIL ──────────────────────────────────────────────

async function openLead(id) {
  const mc=document.getElementById('main-content');
  mc.innerHTML=`<div class="loading-state"><div class="spinner"></div><div>Loading...</div></div>`;
  document.querySelectorAll('.sb-item').forEach(i=>i.classList.remove('active'));
  const {data:lead}=await supabase.from('leads').select('*,profiles!leads_assigned_to_fkey(first_name,last_name)').eq('id',id).single();
  if (!lead) { mc.innerHTML=`<div class="empty-state"><div class="empty-title">Lead not found</div></div>`; return; }
  _currentLead=lead; _renderLeadView(mc);
}

function _renderLeadView(mc) {
  const l=_currentLead;
  mc.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <button class="btn" onclick="window.navigateTo('leads')" style="font-size:12px;padding:5px 11px">← Leads</button>
          <span class="tag ${_stag(l.status)}" id="lead-status-badge">${l.status}</span>
        </div>
        <div style="font-family:'Barlow',sans-serif;font-size:24px;font-weight:800">${escH(l.first_name)} ${escH(l.last_name)}</div>
        <div class="text-small text-muted" style="margin-top:3px">
          ${l.company?`🏢 ${escH(l.company)} · `:''}${l.email?`✉ ${escH(l.email)} · `:''}${l.phone?`📞 ${escH(l.phone)}`:''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="form-select" style="font-size:12px;padding:6px 10px" onchange="window.Leads.updateStatus('${l.id}',this.value)">
          ${STATUSES.map(s=>`<option value="${s.key}" ${l.status===s.key?'selected':''}>${s.label}</option>`).join('')}
        </select>
        <button class="btn" onclick="window.Leads.openEdit('${l.id}')">Edit</button>
        ${l.status==='qualified'?`<button class="btn btn-primary" onclick="window.Leads.convertToProposal('${l.id}')">→ Create Proposal</button>`:''}
        <button class="btn btn-danger" onclick="window.Leads.deleteLead('${l.id}')">Delete</button>
      </div>
    </div>

    <div class="summary-grid" style="margin-bottom:20px">
      <div class="summary-card"><div class="summary-card-label">Event Type</div><div style="font-size:14px;font-weight:600;margin-top:4px">${escH(l.event_type||'Not set')}</div></div>
      <div class="summary-card"><div class="summary-card-label">Event Date</div><div style="font-size:14px;font-weight:600;margin-top:4px">${l.event_date?new Date(l.event_date+'T00:00:00').toLocaleDateString():'Not set'}</div></div>
      <div class="summary-card"><div class="summary-card-label">Venue</div><div style="font-size:14px;font-weight:600;margin-top:4px">${escH(l.venue_name||'Not set')}</div><div class="summary-card-sub">${[l.venue_city,l.venue_state].filter(Boolean).join(', ')}</div></div>
      <div class="summary-card"><div class="summary-card-label">Wall Size</div><div style="font-size:14px;font-weight:600;margin-top:4px">${l.wall_width_ft&&l.wall_height_ft?`${l.wall_width_ft}′×${l.wall_height_ft}′`:'Unknown'}</div><div class="summary-card-sub">${escH(l.environment||'')}</div></div>
      <div class="summary-card"><div class="summary-card-label">Budget</div><div style="font-size:14px;font-weight:600;margin-top:4px">${escH(l.budget_range||'Not specified')}</div></div>
      <div class="summary-card"><div class="summary-card-label">Source</div><div style="font-size:14px;font-weight:600;margin-top:4px">${(l.source||'').replace(/_/g,' ')}</div></div>
      <div class="summary-card"><div class="summary-card-label">Assigned To</div><div style="font-size:14px;font-weight:600;margin-top:4px">${l.profiles?`${l.profiles.first_name} ${l.profiles.last_name}`:'Unassigned'}</div></div>
    </div>

    ${l.notes?`<div class="card" style="margin-bottom:16px"><div class="form-label" style="margin-bottom:6px">Notes</div><div style="font-size:13px;line-height:1.7">${escH(l.notes)}</div></div>`:''}

    <div class="tab-bar">
      <button class="tab-btn active" id="lt-act" onclick="window.Leads.showLTab('act')">Activity</button>
      <button class="tab-btn" id="lt-tasks" onclick="window.Leads.showLTab('tasks')">Follow-up Tasks</button>
    </div>

    <div class="tab-panel active" id="lp-act">
      <div class="card" style="margin-bottom:14px">
        <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Log Activity</div>
        <div class="form-field" style="margin-bottom:10px">
          <select class="form-select" id="act-type" style="max-width:200px;margin-bottom:8px">
            <option value="note">📝 Note</option>
            <option value="call">📞 Call</option>
            <option value="email">✉ Email</option>
            <option value="meeting">🤝 Meeting</option>
          </select>
          <textarea class="form-input form-textarea" id="act-body" placeholder="What happened? What was discussed?" rows="3"></textarea>
        </div>
        <button class="btn btn-primary" onclick="window.Leads.logAct()">Log Activity</button>
      </div>
      <div id="activity-tl"></div>
    </div>

    <div class="tab-panel" id="lp-tasks">
      <div style="margin-bottom:12px"><button class="btn-add" onclick="window.Leads.addTask()">+ Add Follow-up Task</button></div>
      <div id="lead-tasks-wrap"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div>
    </div>`;

  _loadAct();
}

function showLTab(name) {
  ['act','tasks'].forEach(t=>{
    document.getElementById('lt-'+t)?.classList.toggle('active',t===name);
    document.getElementById('lp-'+t)?.classList.toggle('active',t===name);
  });
  if (name==='tasks') _loadLeadTasks();
}

// ── ACTIVITY ────────────────────────────────────────────────

async function _loadAct() {
  const el=document.getElementById('activity-tl'); if (!el) return;
  const {data:acts}=await supabase.from('lead_activity')
    .select('*,profiles!lead_activity_performed_by_fkey(first_name,last_name)')
    .eq('lead_id',_currentLead.id).order('created_at',{ascending:false});
  const icons={note:'📝',call:'📞',email:'✉',meeting:'🤝',task:'✅'};
  el.innerHTML=!acts?.length
    ?`<div class="empty-state" style="padding:30px"><div class="empty-title">No activity yet</div><p class="empty-sub">Log calls, emails, meetings and notes above.</p></div>`
    :`<div style="display:flex;flex-direction:column;gap:8px">${acts.map(a=>`
        <div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px 14px;display:flex;gap:12px">
          <div style="font-size:20px;flex-shrink:0">${icons[a.type]||'📝'}</div>
          <div style="flex:1">
            <div style="font-size:13px;line-height:1.6">${escH(a.body)}</div>
            <div class="text-small text-muted" style="margin-top:4px">
              ${a.profiles?`${a.profiles.first_name} ${a.profiles.last_name} · `:''}
              ${new Date(a.created_at).toLocaleString()}
            </div>
          </div>
        </div>`).join('')}</div>`;
}

async function logAct() {
  const type=document.getElementById('act-type')?.value||'note';
  const body=document.getElementById('act-body')?.value.trim();
  if (!body) { showToast('Please enter activity details.','error'); return; }
  const {error}=await supabase.from('lead_activity').insert({lead_id:_currentLead.id,type,body,performed_by:getProfile().id});
  if (error) { showToast('Failed to log.','error'); return; }
  document.getElementById('act-body').value='';
  showToast('Logged!','success'); _loadAct();
}

// ── FOLLOW-UP TASKS ─────────────────────────────────────────

async function _loadLeadTasks() {
  const el=document.getElementById('lead-tasks-wrap'); if (!el) return;
  const {data:tasks}=await supabase.from('tasks')
    .select('*').ilike('description',`%lead:${_currentLead.id}%`).order('due_date',{ascending:true,nullsFirst:false});
  const pc={low:'#6b7280',medium:'#2563eb',high:'#d97706',urgent:'#dc2626'};
  el.innerHTML=!tasks?.length
    ?`<div class="empty-state" style="padding:30px"><div class="empty-title">No follow-up tasks</div></div>`
    :`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th>Due</th><th></th></tr></thead>
        <tbody>${tasks.map(t=>`<tr>
          <td><strong>${escH(t.title)}</strong></td>
          <td><span style="color:${pc[t.priority]||'#6b7280'};font-weight:600;font-size:11px;text-transform:uppercase">${t.priority}</span></td>
          <td><span class="tag ${t.status==='done'?'tag-green':t.status==='in_progress'?'tag-blue':'tag-gray'}">${t.status.replace('_',' ')}</span></td>
          <td class="text-small">${t.due_date?new Date(t.due_date+'T00:00:00').toLocaleDateString():'—'}</td>
          <td>${t.status!=='done'?`<button class="btn btn-green" style="font-size:11px;padding:4px 9px" onclick="window.Leads.markDone('${t.id}')">✓</button>`:''}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
}

async function addTask() {
  const m=document.createElement('div'); m.className='modal-overlay open';
  m.innerHTML=`<div class="modal" style="max-width:440px">
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
  const title=document.getElementById('ft-title')?.value.trim();
  if (!title) { showToast('Title required.','error'); return; }
  await supabase.from('tasks').insert({title,description:`lead:${_currentLead.id}`,due_date:document.getElementById('ft-due')?.value||null,priority:document.getElementById('ft-pri')?.value||'medium',status:'todo',assigned_to:getProfile().id,created_by:getProfile().id});
  btn.closest('.modal-overlay').remove(); showToast('Task added!','success'); _loadLeadTasks();
}

async function markDone(taskId) {
  await supabase.from('tasks').update({status:'done',completed_at:new Date().toISOString()}).eq('id',taskId);
  showToast('Done!','success'); _loadLeadTasks();
}

// ── STATUS + CONVERT ─────────────────────────────────────────

async function updateStatus(id, status) {
  await supabase.from('leads').update({status}).eq('id',id);
  if (_currentLead?.id===id) _currentLead.status=status;
  const badge=document.getElementById('lead-status-badge');
  if (badge) { badge.className=`tag ${_stag(status)}`; badge.textContent=status; }
  await logActivity('lead',id,'status_changed',{status});
  showToast(`Status: ${status}`,'success');
  // Show convert button if now qualified
  if (status==='qualified') {
    const btns=document.getElementById('lead-status-badge')?.closest('div')?.nextElementSibling;
    if (btns&&!document.querySelector('[onclick*="convertToProposal"]')) {
      const btn=document.createElement('button');
      btn.className='btn btn-primary'; btn.textContent='→ Create Proposal';
      btn.setAttribute('onclick',`window.Leads.convertToProposal('${id}')`);
      btns.insertBefore(btn,btns.lastElementChild);
    }
  }
}

async function convertToProposal(leadId) {
  const lead=_currentLead||_allLeads.find(l=>l.id===leadId);
  if (!lead) return;
  if (!confirm(`Convert this lead to a proposal?`)) return;

  // Create or reuse client
  let clientId=lead.client_id;
  if (!clientId) {
    const {data:nc}=await supabase.from('clients').insert({
      company_name:lead.company||`${lead.first_name} ${lead.last_name}`,
      contact_name:`${lead.first_name} ${lead.last_name}`,
      email:lead.email||'', phone:lead.phone||'', created_by:getProfile().id,
    }).select().single();
    clientId=nc?.id;
    if (clientId) await supabase.from('leads').update({client_id:clientId}).eq('id',leadId);
  }

  // Store pre-fill data for proposal wizard
  sessionStorage.setItem('proposal_from_lead',JSON.stringify({
    client_id:clientId,
    title:`${lead.company||lead.first_name+' '+lead.last_name} — ${lead.event_type||'LED Wall'} Proposal`,
    jobsite_city:lead.venue_city||'', jobsite_state:lead.venue_state||'',
    venue_name:lead.venue_name||'', event_date:lead.event_date||'',
    wall_width:lead.wall_width_ft||'', wall_height:lead.wall_height_ft||'',
    environment:lead.environment||'indoor', lead_id:leadId,
  }));

  await supabase.from('leads').update({status:'converted'}).eq('id',leadId);
  await logActivity('lead',leadId,'converted_to_proposal',{client_id:clientId});
  showToast('Lead converted! Opening proposals...','success');
  setTimeout(()=>window.navigateTo('proposals'),600);
}

// ============================================================
// HELPERS
// ============================================================

async function _fetchUsers() {
  const {data}=await supabase.from('profiles').select('id,first_name,last_name,role').order('first_name');
  return data||[];
}

const _v=id=>document.getElementById(id)?.value?.trim()||'';
function _msg(id,msg,err=false){const el=document.getElementById(id);if(!el)return;el.textContent=msg;el.style.color=err?'var(--color-danger)':'var(--color-ok)';}
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showToast(msg,type='success'){window.showToast?.(msg,type);}

// ============================================================
// GLOBAL EXPOSURE
// ============================================================

window.Leads={
  openAdd,openEdit,openLead,closeModal,saveLead,deleteLead,
  toggleView,filterStatus,showLTab,
  logAct,addTask,_doAddTask,markDone,
  updateStatus,convertToProposal,
};
