// ============================================================
// proposals.js — Primary workflow entry point
// RFP → Proposal → Approval → Project
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin, canCreateProposals, canApproveInvoices } from './auth.js';
import { getClientList, getClient } from './clients.js';

// ============================================================
// MAIN RENDER
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading proposals...</div></div>`;
  const [proposals, clients] = await Promise.all([fetchProposals(), getClientList()]);

  // Check if we're coming from clients page with a pre-selected client
  const preselectedClientId = sessionStorage.getItem('proposal_client_id') || '';
  if (preselectedClientId) sessionStorage.removeItem('proposal_client_id');

  const statusGroups = {
    draft: proposals.filter(p => p.status === 'draft'),
    sent: proposals.filter(p => p.status === 'sent'),
    changes_requested: proposals.filter(p => p.status === 'changes_requested'),
    approved: proposals.filter(p => p.status === 'approved'),
    invoice: proposals.filter(p => p.status === 'invoice'),
    deposit_pending: proposals.filter(p => p.status === 'deposit_pending'),
    paid: proposals.filter(p => p.status === 'paid'),
    cancelled: proposals.filter(p => p.status === 'cancelled'),
  };

  const activeProposals = proposals.filter(p => !['paid','cancelled'].includes(p.status));
  const archivedProposals = proposals.filter(p => ['paid','cancelled'].includes(p.status));

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Proposals & Invoices</div>
        <div class="section-sub">${activeProposals.length} active · ${archivedProposals.length} archived</div>
      </div>
      <button class="btn-add" onclick="window.Proposals.openWizard()">+ New Proposal</button>
    </div>

    <!-- Status summary bar -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
      ${[
        { key: 'draft', label: 'Draft', color: 'tag-gray' },
        { key: 'sent', label: 'Sent', color: 'tag-blue' },
        { key: 'changes_requested', label: 'Changes Requested', color: 'tag-yellow' },
        { key: 'approved', label: 'Approved', color: 'tag-green' },
        { key: 'invoice', label: 'Invoiced', color: 'tag-blue' },
        { key: 'deposit_pending', label: 'Deposit Pending', color: 'tag-yellow' },
        { key: 'paid', label: 'Paid', color: 'tag-green' },
        { key: 'cancelled', label: 'Cancelled', color: 'tag-red' },
      ].filter(s => statusGroups[s.key]?.length > 0).map(s => `
        <div style="display:flex;align-items:center;gap:6px;background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:8px 12px;box-shadow:var(--shadow-sm)">
          <span class="tag ${s.color}" style="margin:0">${s.label}</span>
          <span style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700;color:var(--color-accent)">${statusGroups[s.key].length}</span>
        </div>`).join('')}
    </div>

    ${!proposals.length ? `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">No proposals yet</div>
        <p class="empty-sub">Click <strong>+ New Proposal</strong> to start your first client engagement.</p>
      </div>` : ''}

    <!-- Active proposals -->
    ${activeProposals.length ? `
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Active</div>
      <div class="card-grid" style="margin-bottom:24px">
        ${activeProposals.map(p => proposalCard(p)).join('')}
      </div>` : ''}

    <!-- Archived proposals -->
    ${archivedProposals.length ? `
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Archived</div>
      <div class="card-grid">
        ${archivedProposals.map(p => proposalCard(p)).join('')}
      </div>` : ''}

    <!-- Wizard Sheet -->
    <div class="sheet-overlay" id="prop-wizard-overlay">
      <div class="sheet" style="max-width:740px">
        <div class="sheet-header">
          <div class="sheet-title" id="prop-wiz-title">New Proposal</div>
          <button class="modal-close" onclick="window.Proposals.closeWizard()">✕</button>
        </div>
        <div class="wizard-progress" id="prop-wiz-prog"></div>
        <div id="prop-wiz-body"></div>
        <div class="wizard-nav" id="prop-wiz-nav"></div>
      </div>
    </div>`;

  // Auto-open wizard if coming from clients page
  if (preselectedClientId) {
    _wizAnswers.client_id = preselectedClientId;
    openWizard();
  }
}

function proposalCard(p) {
  const statusColors = {
    draft: 'tag-gray', sent: 'tag-blue', changes_requested: 'tag-yellow',
    approved: 'tag-green', invoice: 'tag-blue', deposit_pending: 'tag-yellow',
    paid: 'tag-green', cancelled: 'tag-red'
  };
  const statusLabels = {
    draft: 'Draft', sent: 'Sent to Client', changes_requested: 'Changes Requested',
    approved: 'Approved', invoice: 'Invoice', deposit_pending: 'Deposit Pending',
    paid: 'Paid', cancelled: 'Cancelled'
  };
  return `
    <div class="pcard">
      <div class="tag ${statusColors[p.status]||'tag-gray'}" style="margin-bottom:9px">${statusLabels[p.status]||p.status}</div>
      ${isAdmin() && p.profiles ? `<div class="text-small text-muted" style="margin-bottom:4px">👤 ${escH(p.profiles.first_name)} ${escH(p.profiles.last_name)}</div>` : ''}
      <div style="font-family:'Barlow',sans-serif;font-size:17px;font-weight:700;margin-bottom:4px">${escH(p.title)}</div>
      <div class="text-small text-muted" style="line-height:1.7">
        ${p.clients?.company_name ? `👥 ${escH(p.clients.company_name)}<br>` : ''}
        ${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}
        ${p.total ? `<br><strong style="font-size:14px;color:var(--color-accent)">$${Number(p.total).toLocaleString('en-US',{minimumFractionDigits:2})}</strong>` : ''}
        ${p.deposit_amount && p.status !== 'paid' ? `<br><span style="color:var(--color-muted)">Deposit: $${Number(p.deposit_amount).toLocaleString('en-US',{minimumFractionDigits:2})}</span>` : ''}
      </div>
      <div style="display:flex;gap:7px;margin-top:12px;padding-top:11px;border-top:1px solid var(--color-border-light);flex-wrap:wrap">
        <button class="btn btn-primary" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.openProposal('${p.id}')">Open</button>
        <button class="btn btn-blue" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.exportPDF('${p.id}')">⬇ PDF</button>
        ${p.status === 'draft' ? `<button class="btn" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.sendProposal('${p.id}')">Send to Client</button>` : ''}
        ${p.status === 'approved' || p.status === 'sent' ? `<button class="btn btn-green" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.convertToInvoice('${p.id}')">→ Invoice</button>` : ''}
        ${p.status === 'invoice' || p.status === 'deposit_pending' ? `<button class="btn btn-green" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.markPaid('${p.id}')">Mark Paid</button>` : ''}
        ${p.status === 'approved' ? `<button class="btn btn-green" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.convertToProject('${p.id}')">→ Create Project</button>` : ''}
        <button class="btn btn-danger" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.deleteProposal('${p.id}')">Delete</button>
      </div>
    </div>`;
}

// ============================================================
// DATA
// ============================================================

async function fetchProposals() {
  const profile = getProfile();
  const admin = isAdmin();
  let q = supabase.from('proposals')
    .select('*,clients(company_name),profiles!proposals_owner_id_fkey(first_name,last_name)')
    .order('created_at', { ascending: false });
  if (!admin) q = q.eq('owner_id', profile.id);
  const { data, error } = await q;
  if (error) { console.error('[Proposals]', error); return []; }
  return data || [];
}

async function fetchProposal(id) {
  const { data } = await supabase.from('proposals')
    .select('*,clients(*),profiles!proposals_owner_id_fkey(first_name,last_name)')
    .eq('id', id).single();
  return data;
}

// ============================================================
// WIZARD — 10-step scoping flow
// ============================================================

const STEPS = [
  { id: 'client',       q: 'Who is this proposal for?',                          hint: 'Select an existing client or create a new one',     type: 'client' },
  { id: 'title',        q: 'Give this proposal a title.',                         hint: 'e.g. "Main Stage LED Wall — ACME Conference 2025"',  type: 'text',   ph: 'Proposal title...' },
  { id: 'jobsite',      q: 'What is the jobsite address?',                        hint: 'We\'ll calculate distance from your warehouse',      type: 'jobsite' },
  { id: 'schedule',     q: 'What are the event dates and schedule?',              hint: 'Load in, show days, load out',                      type: 'schedule' },
  { id: 'walls',        q: 'How many LED walls does this job require?',           hint: 'You can configure each wall separately',            type: 'walls' },
  { id: 'environment',  q: 'Will this wall be indoors or outdoors?',              type: 'opts',    opts: ['Indoor', 'Outdoor'] },
  { id: 'support',      q: 'How will the wall be supported?',                     type: 'support' },
  { id: 'rigging',      q: 'Who is responsible for rigging equipment?',           type: 'opts',    opts: ['Visual Affect supplies all rigging', 'Client / Venue responsible for rigging', 'Split — discuss per item'] },
  { id: 'services',     q: 'What additional services are needed?',                hint: 'Select all that apply',                             type: 'services' },
  { id: 'review',       q: 'Review and build your proposal.',                     hint: 'Line items are auto-generated — you can edit before saving', type: 'review' },
];

let _wizStep = 0;
let _wizAnswers = {};
let _wizClients = [];
let _wizLineItems = [];
let _wizDistanceInfo = null;

async function openWizard() {
  if (!canCreateProposals()) { showToast('You need Manager or Admin role to create proposals.', 'error'); return; }
  _wizStep = 0;
  if (!_wizAnswers.client_id) _wizAnswers = {};
  _wizLineItems = [];
  _wizDistanceInfo = null;
  _wizClients = await getClientList();
  _renderWizStep();
  document.getElementById('prop-wizard-overlay').classList.add('open');
}

function closeWizard() {
  document.getElementById('prop-wizard-overlay').classList.remove('open');
}

function _renderWizStep() {
  const st = STEPS[_wizStep], total = STEPS.length;
  document.getElementById('prop-wiz-prog').innerHTML =
    STEPS.map((_, i) => `<div class="wizard-dot ${i < _wizStep ? 'done' : i === _wizStep ? 'active' : ''}"></div>`).join('');

  let inp = '';

  if (st.type === 'text') {
    inp = `<input class="form-input" id="wi" type="text" placeholder="${st.ph||''}" value="${escH(_wizAnswers[st.id]||'')}" style="margin-top:10px;width:100%">`;
  } else if (st.type === 'opts') {
    const sel = _wizAnswers[st.id] || '';
    inp = `<div class="option-grid" style="margin-top:10px">${st.opts.map(o =>
      `<button class="option-btn ${sel===o?'selected':''}" onclick="window.Proposals._wSel(this,'${st.id}','${o}')">${o}</button>`
    ).join('')}</div>`;
  } else if (st.type === 'client') {
    const sel = _wizAnswers.client_id || '';
    inp = `
      <div class="option-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-top:10px">
        ${_wizClients.map(c => `
          <button class="option-btn ${sel===c.id?'selected':''}" data-client-id="${c.id}" onclick="window.Proposals._wSelClient(this)">
            <strong>${escH(c.company_name)}</strong>
            <div class="option-sub">${escH(c.contact_name||'')}${c.email?` · ${escH(c.email)}`:''}</div>
          </button>`).join('')}
        <button class="option-btn ${sel==='new'?'selected':''}" data-client-id="new" onclick="window.Proposals._wSelClient(this)">
          <strong>+ New Client</strong>
          <div class="option-sub">Create a new client record</div>
        </button>
      </div>
      ${sel === 'new' ? `
        <div style="margin-top:14px;padding:14px;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px">
          <div class="form-grid form-grid-2" style="gap:10px">
            <div class="form-field"><label class="form-label">Company Name *</label><input class="form-input" id="nc-company" placeholder="Acme Events"></div>
            <div class="form-field"><label class="form-label">Contact Name</label><input class="form-input" id="nc-contact" placeholder="Jane Smith"></div>
            <div class="form-field"><label class="form-label">Email</label><input class="form-input" id="nc-email" type="email" placeholder="jane@acme.com"></div>
            <div class="form-field"><label class="form-label">Phone</label><input class="form-input" id="nc-phone" type="tel" placeholder="(555) 000-0000"></div>
          </div>
        </div>` : ''}`;
  } else if (st.type === 'jobsite') {
    inp = `
      <div style="margin-top:10px">
        <div class="form-field" style="margin-bottom:10px">
          <label class="form-label">Street Address</label>
          <input class="form-input" id="js-addr" placeholder="123 Convention Center Dr" value="${escH(_wizAnswers.jobsite_address||'')}">
        </div>
        <div class="form-grid form-grid-3" style="gap:10px;margin-bottom:12px">
          <div class="form-field"><label class="form-label">City</label><input class="form-input" id="js-city" placeholder="Baltimore" value="${escH(_wizAnswers.jobsite_city||'')}"></div>
          <div class="form-field"><label class="form-label">State</label><input class="form-input" id="js-state" placeholder="MD" value="${escH(_wizAnswers.jobsite_state||'')}"></div>
          <div class="form-field"><label class="form-label">ZIP</label><input class="form-input" id="js-zip" placeholder="21201" value="${escH(_wizAnswers.jobsite_zip||'')}"></div>
        </div>
        ${_wizDistanceInfo ? `
          <div class="alert alert-ok" style="margin-bottom:10px">
            📍 Distance from warehouse: <strong>${_wizDistanceInfo.miles} miles</strong> · approx. <strong>${_wizDistanceInfo.driveTime}</strong>
            ${_wizDistanceInfo.travelDayFlag ? `<br>⚠ <strong>Over 60 miles</strong> — consider adding a travel day and lodging.` : ''}
          </div>` : ''}
        <button class="btn" style="font-size:12px" onclick="window.Proposals._calcDistance()">📍 Calculate Distance from Warehouse</button>
      </div>`;
  } else if (st.type === 'schedule') {
    const s = _wizAnswers.schedule || {};
    const li = s.loadIn || {}, lo = s.loadOut || {};
    const days = s.showDays || [{ date: '', startTime: '', endTime: '' }];
    inp = `
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:12px">
        <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">🚛 Load In</div>
          <div class="form-grid form-grid-2" style="gap:10px">
            <div class="form-field"><label class="form-label">Date</label><input class="form-input" id="s-lidate" type="date" value="${escH(li.date||'')}"></div>
            <div class="form-field"><label class="form-label">Start Time</label><input class="form-input" id="s-litime" type="time" value="${escH(li.time||'')}"></div>
          </div>
        </div>
        <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">🎬 Show Days</div>
          <div id="wiz-show-days">${days.map((sd,i) => _showDayRow(sd,i)).join('')}</div>
          <button class="btn" style="margin-top:8px;font-size:12px" onclick="window.Proposals._addShowDay()">+ Add Show Day</button>
        </div>
        <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">🚛 Load Out</div>
          <div class="form-grid form-grid-2" style="gap:10px">
            <div class="form-field"><label class="form-label">Date</label><input class="form-input" id="s-lodate" type="date" value="${escH(lo.date||'')}"></div>
            <div class="form-field"><label class="form-label">Start Time</label><input class="form-input" id="s-lotime" type="time" value="${escH(lo.time||'')}"></div>
          </div>
        </div>
      </div>`;
  } else if (st.type === 'walls') {
    const walls = _wizAnswers.wall_specs || [{ width: '', height: '', qty: 1, panel_id: '' }];
    inp = `
      <div id="wiz-walls" style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
        ${walls.map((w, i) => _wallRow(w, i)).join('')}
      </div>
      <button class="btn" style="margin-top:10px;font-size:12px" onclick="window.Proposals._addWall()">+ Add Another Wall</button>`;
  } else if (st.type === 'support') {
    const env = _wizAnswers.environment || 'Indoor';
    const sel = _wizAnswers.support_method || '';
    const isIndoor = env === 'Indoor';
    const opts = isIndoor
      ? ['Fly to ceiling rigging points', 'Ground support — pipe & base riser', 'Ground support — truss structure (case by case)']
      : ['Mobile stage fly', 'Array towers', 'Ground support on riser', 'Custom truss build'];
    inp = `
      <div class="option-grid" style="margin-top:10px">
        ${opts.map(o => `<button class="option-btn ${sel===o?'selected':''}" onclick="window.Proposals._wSel(this,'support_method','${o}')">${o}</button>`).join('')}
      </div>
      ${sel && isIndoor && sel.includes('riser') ? `
        <div style="margin-top:14px;padding:14px;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px">
          <label class="form-label">How high off the ground does the bottom of the wall need to be? (inches)</label>
          <input class="form-input" id="riser-height" type="number" placeholder="e.g. 24" style="margin-top:8px;max-width:200px" value="${escH(String(_wizAnswers.riser_height_inches||''))}">
        </div>` : ''}`;
  } else if (st.type === 'services') {
    const sel = _wizAnswers.additional_services || [];
    const services = [
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
    inp = `
      <div class="option-grid" style="margin-top:10px">
        ${services.map(s => `
          <button class="option-btn ${sel.includes(s)?'selected':''}" onclick="window.Proposals._toggleService(this,'${s}')">
            ${s}
          </button>`).join('')}
      </div>
      ${sel.includes('Travel day(s)') || sel.includes('Lodging') || sel.includes('Per diem') ? `
        <div style="margin-top:14px;padding:14px;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px">
          <div class="form-grid form-grid-3" style="gap:10px">
            ${sel.includes('Travel day(s)') ? `<div class="form-field"><label class="form-label">Travel Days</label><input class="form-input" id="svc-travel" type="number" value="${_wizAnswers.travel_days||1}" min="1"></div>` : ''}
            ${sel.includes('Lodging') ? `<div class="form-field"><label class="form-label">Lodging Nights</label><input class="form-input" id="svc-lodging" type="number" value="${_wizAnswers.lodging_nights||1}" min="1"></div>` : ''}
            ${sel.includes('Per diem') ? `<div class="form-field"><label class="form-label">Per Diem Days</label><input class="form-input" id="svc-perdiem" type="number" value="${_wizAnswers.per_diem_days||1}" min="1"></div>` : ''}
          </div>
        </div>` : ''}`;
  } else if (st.type === 'review') {
    inp = _buildReviewStep();
  }

  document.getElementById('prop-wiz-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="question-bubble">
        <div class="question-label">Step ${_wizStep + 1} of ${total}</div>
        ${st.q}
        ${st.hint ? `<div class="question-hint">${st.hint}</div>` : ''}
      </div>
      <div>${inp}</div>
    </div>`;

  let nav = _wizStep > 0 ? `<button class="btn-wizard-back" onclick="window.Proposals._wBack()">← Back</button>` : '';
  nav += _wizStep < total - 1
    ? `<button class="btn-wizard-next" onclick="window.Proposals._wNext()">Continue →</button>`
    : `<button class="btn-wizard-finish" onclick="window.Proposals._wFinish()">✓ Create Proposal</button>`;
  document.getElementById('prop-wiz-nav').innerHTML = nav;

  setTimeout(() => document.getElementById('wi')?.focus(), 80);
}

function _showDayRow(sd, i) {
  return `<div class="sd-row" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px">
    <div><label class="form-label">Date</label><input class="form-input sd-date" type="date" value="${escH(sd.date||'')}"></div>
    <div><label class="form-label">Start</label><input class="form-input sd-start" type="time" value="${escH(sd.startTime||'')}"></div>
    <div><label class="form-label">End</label><input class="form-input sd-end" type="time" value="${escH(sd.endTime||'')}"></div>
    <div style="padding-top:18px"><button class="btn btn-danger" style="padding:7px 9px" onclick="window.Proposals._removeShowDay(${i})">✕</button></div>
  </div>`;
}

function _wallRow(w, i) {
  return `<div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px;position:relative">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-weight:600;font-size:13px">Wall ${i + 1}</div>
      ${i > 0 ? `<button class="btn btn-danger" style="font-size:11px;padding:4px 9px" onclick="window.Proposals._removeWall(${i})">Remove</button>` : ''}
    </div>
    <div class="form-grid form-grid-3" style="gap:10px">
      <div class="form-field"><label class="form-label">Width (ft)</label><input class="form-input wall-w" type="number" placeholder="20" min="1" step="0.5" value="${w.width||''}"></div>
      <div class="form-field"><label class="form-label">Height (ft)</label><input class="form-input wall-h" type="number" placeholder="12" min="1" step="0.5" value="${w.height||''}"></div>
      <div class="form-field"><label class="form-label">Qty</label><input class="form-input wall-qty" type="number" placeholder="1" min="1" value="${w.qty||1}"></div>
    </div>
  </div>`;
}

function _buildReviewStep() {
  _wizLineItems = _autoGenerateLineItems();
  const subtotal = _wizLineItems.reduce((a, li) => a + (li.qty * li.unit_price), 0);
  const taxRate = 0;
  const tax = subtotal * taxRate / 100;
  const total = subtotal + tax;

  return `
    <div style="margin-top:10px">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:10px">Auto-Generated Line Items</div>
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:12px">
        <table class="data-table" id="review-items-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Total</th><th></th></tr></thead>
          <tbody id="review-items-body">
            ${_wizLineItems.map((li, i) => _lineItemRow(li, i)).join('')}
          </tbody>
        </table>
        <div style="padding:10px 14px;background:#f9fafb;border-top:1px solid var(--color-border-light)">
          <button class="btn" style="font-size:12px" onclick="window.Proposals._addReviewItem()">+ Add Line Item</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div class="form-field">
          <label class="form-label">Tax Rate (%)</label>
          <input class="form-input" id="review-tax" type="number" value="0" min="0" step="0.1" onchange="window.Proposals._updateTotals()">
        </div>
        <div class="form-field">
          <label class="form-label">Deposit (%)</label>
          <input class="form-input" id="review-deposit" type="number" value="50" min="0" max="100" step="5">
        </div>
        <div class="form-field" style="grid-column:1/-1">
          <label class="form-label">Terms & Notes</label>
          <textarea class="form-input form-textarea" id="review-notes" rows="3" placeholder="Payment terms, cancellation policy, special notes...">${escH(_wizAnswers.scope_notes||'')}</textarea>
        </div>
      </div>
      <div class="totals-box" id="review-totals">
        <div class="total-row"><span>Subtotal</span><span>$${subtotal.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="total-row"><span>Tax (0%)</span><span>$0.00</span></div>
        <div class="total-row grand"><span>TOTAL</span><span>$${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
      </div>
      ${_wizDistanceInfo?.travelDayFlag ? `
        <div class="alert alert-warn" style="margin-top:12px">
          ⚠ This jobsite is ${_wizDistanceInfo.miles} miles away. Consider adding travel day, lodging, and per diem line items.
        </div>` : ''}
      ${_wizAnswers.rigging === 'Client / Venue responsible for rigging' ? `
        <div class="alert alert-ok" style="margin-top:10px">
          📋 A rigging requirements section will be added to the proposal automatically.
        </div>` : ''}
    </div>`;
}

function _lineItemRow(li, i) {
  const total = (li.qty * li.unit_price).toLocaleString('en-US', { minimumFractionDigits: 2 });
  return `<tr>
    <td><input class="form-input" style="padding:5px 8px;font-size:12px" value="${escH(li.name)}"
      onchange="window.Proposals._updateLI(${i},'name',this.value)"></td>
    <td><input class="form-input" style="padding:5px 8px;font-size:12px;width:60px" type="number" value="${li.qty}"
      onchange="window.Proposals._updateLI(${i},'qty',this.value)"></td>
    <td><input class="form-input" style="padding:5px 8px;font-size:12px;width:60px" value="${escH(li.unit||'ea')}"
      onchange="window.Proposals._updateLI(${i},'unit',this.value)"></td>
    <td><input class="form-input" style="padding:5px 8px;font-size:12px;width:80px" type="number" step="0.01" value="${li.unit_price}"
      onchange="window.Proposals._updateLI(${i},'unit_price',this.value)"></td>
    <td style="font-weight:600" id="li-total-${i}">$${total}</td>
    <td><button class="btn btn-danger" style="padding:3px 7px;font-size:11px" onclick="window.Proposals._removeLI(${i})">✕</button></td>
  </tr>`;
}

function _autoGenerateLineItems() {
  const items = [];
  const walls = _wizAnswers.wall_specs || [];
  const support = _wizAnswers.support_method || '';
  const rigging = _wizAnswers.rigging || '';
  const services = _wizAnswers.additional_services || [];
  const schedule = _wizAnswers.schedule || {};
  const showDays = (schedule.showDays || []).filter(sd => sd.date).length || 1;

  // Calculate load in hours (default 8h per day)
  const loadInHours = 8;
  const showHours = showDays * 10;
  const loadOutHours = 6;
  const totalLaborHours = loadInHours + showHours + loadOutHours;

  // Panels (from wall specs)
  walls.forEach((w, i) => {
    if (w.width && w.height) {
      const panelCount = Math.round((w.width * 304.8 / 500) * (w.height * 304.8 / 1000));
      items.push({ name: `LED Panels — Wall ${i + 1} (${w.width}′×${w.height}′)`, qty: panelCount * (parseInt(w.qty) || 1), unit: 'ea', unit_price: 0, category: 'Equipment' });
      items.push({ name: `LED Wall ${i + 1} — Processor (NovaPro HD)`, qty: Math.max(1, Math.ceil(panelCount / 80)), unit: 'ea', unit_price: 0, category: 'Equipment' });
    }
  });

  // Data and power cabling
  items.push({ name: 'Data Cabling Package', qty: 1, unit: 'lot', unit_price: 0, category: 'Cabling' });
  items.push({ name: 'Power Cabling Package', qty: 1, unit: 'lot', unit_price: 0, category: 'Cabling' });

  // Support structure
  if (support.includes('fly') || support.includes('ceiling')) {
    items.push({ name: 'Fly Bars', qty: walls.length * 2, unit: 'ea', unit_price: 0, category: 'Rigging' });
    items.push({ name: 'Megaclaws', qty: walls.length * 2, unit: 'ea', unit_price: 0, category: 'Rigging' });
    if (!rigging.includes('Client')) {
      items.push({ name: 'Chain Motors (1 ton)', qty: walls.length * 2, unit: 'ea', unit_price: 0, category: 'Rigging' });
      items.push({ name: 'Rigging Hardware Package', qty: 1, unit: 'lot', unit_price: 0, category: 'Rigging' });
    }
  } else if (support.includes('riser') || support.includes('pipe')) {
    items.push({ name: 'Ground Support — Pipe & Base System', qty: 1, unit: 'lot', unit_price: 0, category: 'Support Structure' });
    if (_wizAnswers.riser_height_inches) {
      items.push({ name: `Riser (${_wizAnswers.riser_height_inches}" rise)`, qty: walls.length, unit: 'ea', unit_price: 0, category: 'Support Structure' });
    }
  } else if (support.includes('truss')) {
    items.push({ name: 'Truss Structure Package (TBD)', qty: 1, unit: 'lot', unit_price: 0, category: 'Support Structure' });
  }

  // Labor
  items.push({ name: 'Lead LED Tech', qty: totalLaborHours, unit: 'hr', unit_price: 0, category: 'Labor' });
  items.push({ name: 'LED Tech A2', qty: loadInHours + loadOutHours, unit: 'hr', unit_price: 0, category: 'Labor' });

  // Additional services
  if (services.includes('Playback system / media server')) items.push({ name: 'Playback System', qty: 1, unit: 'lot', unit_price: 0, category: 'Equipment' });
  if (services.includes('Camera input(s)')) items.push({ name: 'Camera Input — SDI Package', qty: 1, unit: 'lot', unit_price: 0, category: 'Equipment' });
  if (services.includes('On-site tech support during show')) items.push({ name: 'On-Site Tech Support', qty: showDays, unit: 'day', unit_price: 0, category: 'Labor' });
  if (services.includes('Content playback operator')) items.push({ name: 'Playback Operator', qty: showDays, unit: 'day', unit_price: 0, category: 'Labor' });
  if (services.includes('Generator (power)')) items.push({ name: 'Generator Rental', qty: 1, unit: 'lot', unit_price: 0, category: 'Equipment' });
  if (services.includes('Travel day(s)')) items.push({ name: 'Travel Day(s)', qty: parseInt(_wizAnswers.travel_days) || 1, unit: 'day', unit_price: 0, category: 'Labor' });
  if (services.includes('Lodging')) items.push({ name: 'Lodging', qty: parseInt(_wizAnswers.lodging_nights) || 1, unit: 'night', unit_price: 0, category: 'Expenses' });
  if (services.includes('Per diem')) items.push({ name: 'Per Diem', qty: parseInt(_wizAnswers.per_diem_days) || 1, unit: 'day', unit_price: 0, category: 'Expenses' });

  // Trucking
  items.push({ name: 'Trucking / Transport', qty: 1, unit: 'lot', unit_price: 0, category: 'Logistics' });

  return items;
}

// ── WIZARD NAVIGATION ────────────────────────────────────────

function _wSel(btn, id, val) {
  btn.closest('.option-grid').querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _wizAnswers[id] = val;
  // Re-render if support method changes to show/hide riser height
  if (id === 'support_method') _renderWizStep();
}

function _wSelClient(btn) {
  btn.closest('.option-grid').querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  _wizAnswers.client_id = btn.dataset.clientId;
  if (btn.dataset.clientId === 'new') _renderWizStep(); // re-render to show new client form
}

function _toggleService(btn, svc) {
  const services = _wizAnswers.additional_services || [];
  const idx = services.indexOf(svc);
  if (idx >= 0) services.splice(idx, 1);
  else services.push(svc);
  _wizAnswers.additional_services = services;
  btn.classList.toggle('selected', services.includes(svc));
  _renderWizStep();
}

function _addShowDay() {
  const s = _collectSchedule(); s.showDays.push({ date: '', startTime: '', endTime: '' });
  document.getElementById('wiz-show-days').innerHTML = s.showDays.map((sd, i) => _showDayRow(sd, i)).join('');
}

function _removeShowDay(i) {
  const s = _collectSchedule(); if (s.showDays.length <= 1) return;
  s.showDays.splice(i, 1);
  document.getElementById('wiz-show-days').innerHTML = s.showDays.map((sd, idx) => _showDayRow(sd, idx)).join('');
}

function _collectSchedule() {
  const rows = document.querySelectorAll('.sd-row');
  const showDays = [...rows].map(r => ({
    date: r.querySelector('.sd-date')?.value || '',
    startTime: r.querySelector('.sd-start')?.value || '',
    endTime: r.querySelector('.sd-end')?.value || '',
  }));
  return {
    loadIn: { date: _v('s-lidate'), time: _v('s-litime') },
    showDays,
    loadOut: { date: _v('s-lodate'), time: _v('s-lotime') },
  };
}

function _addWall() {
  const walls = _collectWalls();
  walls.push({ width: '', height: '', qty: 1 });
  document.getElementById('wiz-walls').innerHTML = walls.map((w, i) => _wallRow(w, i)).join('');
}

function _removeWall(i) {
  const walls = _collectWalls(); if (walls.length <= 1) return;
  walls.splice(i, 1);
  document.getElementById('wiz-walls').innerHTML = walls.map((w, idx) => _wallRow(w, idx)).join('');
}

function _collectWalls() {
  return [...(document.querySelectorAll('#wiz-walls > div') || [])].map(el => ({
    width: el.querySelector('.wall-w')?.value || '',
    height: el.querySelector('.wall-h')?.value || '',
    qty: parseInt(el.querySelector('.wall-qty')?.value) || 1,
  }));
}

function _updateLI(i, field, val) {
  if (!_wizLineItems[i]) return;
  _wizLineItems[i][field] = field === 'qty' ? parseInt(val) || 0 : field === 'unit_price' ? parseFloat(val) || 0 : val;
  const total = (_wizLineItems[i].qty * _wizLineItems[i].unit_price).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const el = document.getElementById(`li-total-${i}`);
  if (el) el.textContent = '$' + total;
  _updateTotals();
}

function _removeLI(i) {
  _wizLineItems.splice(i, 1);
  const tbody = document.getElementById('review-items-body');
  if (tbody) tbody.innerHTML = _wizLineItems.map((li, idx) => _lineItemRow(li, idx)).join('');
  _updateTotals();
}

function _addReviewItem() {
  _wizLineItems.push({ name: 'New Item', qty: 1, unit: 'ea', unit_price: 0, category: 'Other' });
  const tbody = document.getElementById('review-items-body');
  if (tbody) tbody.innerHTML = _wizLineItems.map((li, i) => _lineItemRow(li, i)).join('');
  _updateTotals();
}

function _updateTotals() {
  const taxRate = parseFloat(document.getElementById('review-tax')?.value) || 0;
  const subtotal = _wizLineItems.reduce((a, li) => a + (li.qty * li.unit_price), 0);
  const tax = subtotal * taxRate / 100;
  const total = subtotal + tax;
  const el = document.getElementById('review-totals');
  if (el) el.innerHTML = `
    <div class="total-row"><span>Subtotal</span><span>$${subtotal.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    <div class="total-row"><span>Tax (${taxRate}%)</span><span>$${tax.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    <div class="total-row grand"><span>TOTAL</span><span>$${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>`;
}

async function _calcDistance() {
  const addr = [_v('js-addr'), _v('js-city'), _v('js-state'), _v('js-zip')].filter(Boolean).join(', ');
  if (!addr.trim()) { showToast('Enter an address first.', 'error'); return; }

  // Get warehouse address from settings
  const { data: settings } = await supabase.from('settings').select('warehouse_address,warehouse_city,warehouse_state').eq('id', 1).single();
  const warehouse = [settings?.warehouse_address, settings?.warehouse_city, settings?.warehouse_state].filter(Boolean).join(', ');

  if (!warehouse.trim()) {
    showToast('Warehouse address not set. Go to Admin → Settings to add it.', 'error');
    _wizDistanceInfo = { miles: '?', driveTime: 'unknown', travelDayFlag: false };
    _renderWizStep();
    return;
  }

  // Use a simple distance estimation via geocoding
  // For now we show a manual entry fallback
  showToast('Enter distance manually below — Google Maps integration coming soon.', 'info');
  const miles = parseFloat(prompt(`Enter approximate distance from warehouse to "${addr}" in miles:`));
  if (isNaN(miles)) return;
  const hours = Math.round(miles / 55 * 10) / 10;
  _wizDistanceInfo = {
    miles,
    driveTime: `~${hours}h drive`,
    travelDayFlag: miles > 60,
  };
  _wizAnswers.distance_miles = miles;
  _renderWizStep();
}

function _wGetCurrent() {
  const st = STEPS[_wizStep];
  if (st.type === 'opts') return _wizAnswers[st.id] || null;
  if (st.type === 'client') {
    if (_wizAnswers.client_id === 'new') {
      // Validate new client form
      const company = document.getElementById('nc-company')?.value.trim();
      if (!company) { showToast('Company name required.', 'error'); return null; }
      _wizAnswers._newClient = {
        company_name: company,
        contact_name: document.getElementById('nc-contact')?.value.trim() || '',
        email: document.getElementById('nc-email')?.value.trim() || '',
        phone: document.getElementById('nc-phone')?.value.trim() || '',
      };
      return 'ok';
    }
    return _wizAnswers.client_id || null;
  }
  if (st.type === 'text') {
    const el = document.getElementById('wi'); return el?.value.trim() || null;
  }
  if (st.type === 'jobsite') {
    _wizAnswers.jobsite_address = _v('js-addr');
    _wizAnswers.jobsite_city = _v('js-city');
    _wizAnswers.jobsite_state = _v('js-state');
    _wizAnswers.jobsite_zip = _v('js-zip');
    if (!_wizAnswers.jobsite_city) { showToast('City is required.', 'error'); return null; }
    return 'ok';
  }
  if (st.type === 'schedule') {
    _wizAnswers.schedule = _collectSchedule();
    return 'ok';
  }
  if (st.type === 'walls') {
    _wizAnswers.wall_specs = _collectWalls();
    const valid = _wizAnswers.wall_specs.some(w => w.width && w.height);
    if (!valid) { showToast('At least one wall needs dimensions.', 'error'); return null; }
    return 'ok';
  }
  if (st.type === 'support') {
    if (!_wizAnswers.support_method) { showToast('Please select a support method.', 'error'); return null; }
    if (_wizAnswers.support_method.includes('riser')) {
      _wizAnswers.riser_height_inches = parseInt(document.getElementById('riser-height')?.value) || 0;
    }
    return 'ok';
  }
  if (st.type === 'services') {
    if (document.getElementById('svc-travel')) _wizAnswers.travel_days = parseInt(document.getElementById('svc-travel')?.value) || 1;
    if (document.getElementById('svc-lodging')) _wizAnswers.lodging_nights = parseInt(document.getElementById('svc-lodging')?.value) || 1;
    if (document.getElementById('svc-perdiem')) _wizAnswers.per_diem_days = parseInt(document.getElementById('svc-perdiem')?.value) || 1;
    return 'ok';
  }
  if (st.type === 'review') return 'ok';
  return null;
}

async function _wNext() {
  const v = _wGetCurrent(); if (!v) return;
  const st = STEPS[_wizStep];
  if (st.type === 'text') _wizAnswers[st.id] = v;
  _wizStep++; _renderWizStep();
}

function _wBack() { if (_wizStep > 0) { _wizStep--; _renderWizStep(); } }

async function _wFinish() {
  _wizAnswers.scope_notes = document.getElementById('review-notes')?.value.trim() || '';
  const taxRate = parseFloat(document.getElementById('review-tax')?.value) || 0;
  const depositPct = parseFloat(document.getElementById('review-deposit')?.value) || 50;

  // Create new client if needed
  let clientId = _wizAnswers.client_id;
  if (clientId === 'new' && _wizAnswers._newClient) {
    const { data: newClient } = await dbInsert('clients', {
      ..._wizAnswers._newClient,
      created_by: getProfile().id,
    });
    clientId = newClient?.id || null;
  }

  const subtotal = _wizLineItems.reduce((a, li) => a + (li.qty * li.unit_price), 0);
  const taxAmount = subtotal * taxRate / 100;
  const total = subtotal + taxAmount;
  const depositAmount = total * depositPct / 100;

  // Build rigging requirements text if needed
  let rigReq = '';
  if (_wizAnswers.rigging?.includes('Client')) {
    const walls = _wizAnswers.wall_specs || [];
    const totalLoad = walls.reduce((a, w) => a + (w.width || 0) * (w.height || 0) * 50, 0); // rough estimate
    rigReq = `RIGGING REQUIREMENTS — Client/Venue Responsibility\n\nVisual Affect requires the following to be provided and confirmed by the client/venue prior to load-in:\n\n• Structural rigging points capable of supporting approximately ${Math.round(totalLoad)} lbs total\n• Chain motors — quantity and rating to be confirmed based on final design\n• Safety cables on all points\n• Certified rigger on site for load-in and load-out\n• All rigging hardware inspected and rated for intended load\n\nVisual Affect assumes no liability for rigging provided by others. Written confirmation of rigging capacity required 7 days prior to event.`;
  }

  const jobsiteAddr = [_wizAnswers.jobsite_address, _wizAnswers.jobsite_city, _wizAnswers.jobsite_state, _wizAnswers.jobsite_zip].filter(Boolean).join(', ');

  const proposalData = {
    title: _wizAnswers.title || 'Untitled Proposal',
    client_id: clientId || null,
    owner_id: getProfile().id,
    status: 'draft',
    line_items: _wizLineItems,
    tax_rate: taxRate,
    subtotal,
    tax_amount: taxAmount,
    total,
    deposit_pct: depositPct,
    deposit_amount: depositAmount,
    jobsite_address: jobsiteAddr,
    distance_miles: _wizAnswers.distance_miles || null,
    environment: _wizAnswers.environment || 'Indoor',
    support_method: _wizAnswers.support_method || '',
    rigging_responsibility: _wizAnswers.rigging || '',
    rigging_requirements: rigReq,
    wall_specs: _wizAnswers.wall_specs || [],
    job_type: _buildJobType(),
    schedule: _wizAnswers.schedule || {},
    scope_notes: _wizAnswers.scope_notes,
    travel_day: (_wizAnswers.additional_services || []).includes('Travel day(s)'),
    lodging_nights: _wizAnswers.lodging_nights || 0,
    per_diem_days: _wizAnswers.per_diem_days || 0,
  };

  const { data: proposal, error } = await dbInsert('proposals', proposalData);
  if (error) { showToast('Failed to save proposal. Please try again.', 'error'); console.error(error); return; }

  await logActivity('proposal', proposal.id, 'created', { title: proposal.title });
  closeWizard();
  showToast('Proposal created!', 'success');
  openProposal(proposal.id);
}

function _buildJobType() {
  const env = _wizAnswers.environment || 'Indoor';
  const support = _wizAnswers.support_method || '';
  if (env === 'Outdoor') return 'outdoor';
  if (support.includes('fly') || support.includes('ceiling')) return 'indoor_fly';
  if (support.includes('riser') || support.includes('pipe')) return 'indoor_ground_riser';
  if (support.includes('truss')) return 'indoor_ground_truss';
  return 'indoor_fly';
}

// ============================================================
// PROPOSAL DETAIL VIEW
// ============================================================

let _currentProposal = null;

async function openProposal(id) {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading proposal...</div></div>`;
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));

  const proposal = await fetchProposal(id);
  if (!proposal) { mc.innerHTML = `<div class="empty-state"><div class="empty-title">Proposal not found</div></div>`; return; }
  _currentProposal = proposal;
  _renderProposalView(mc);
}

function _renderProposalView(mc) {
  const p = _currentProposal;
  const lineItems = Array.isArray(p.line_items) ? p.line_items : [];
  const subtotal = lineItems.reduce((a, li) => a + ((li.qty || 0) * (li.unit_price || 0)), 0);
  const taxAmount = subtotal * (p.tax_rate || 0) / 100;
  const total = subtotal + taxAmount;
  const depositAmount = total * (p.deposit_pct || 50) / 100;

  const isLocked = ['paid', 'cancelled'].includes(p.status);
  const statusColors = { draft:'tag-gray', sent:'tag-blue', changes_requested:'tag-yellow', approved:'tag-green', invoice:'tag-blue', deposit_pending:'tag-yellow', paid:'tag-green', cancelled:'tag-red' };
  const statusLabels = { draft:'Draft', sent:'Sent to Client', changes_requested:'Changes Requested', approved:'Approved', invoice:'Invoice', deposit_pending:'Deposit Pending', paid:'Paid', cancelled:'Cancelled' };

  mc.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <button class="btn" onclick="window.navigateTo('proposals')" style="font-size:12px;padding:5px 11px">← Proposals</button>
          <span class="tag ${statusColors[p.status]||'tag-gray'}">${statusLabels[p.status]||p.status}</span>
        </div>
        <div style="font-family:'Barlow',sans-serif;font-size:24px;font-weight:800">${escH(p.title)}</div>
        <div class="text-small text-muted" style="margin-top:3px">
          ${p.clients?.company_name ? `👥 ${escH(p.clients.company_name)} · ` : ''}
          ${new Date(p.created_at).toLocaleDateString()}
          ${p.jobsite_address ? ` · 📍 ${escH(p.jobsite_address)}` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${!isLocked ? `
          <select class="form-select" style="font-size:12px;padding:6px 10px" onchange="window.Proposals.updateStatus('${p.id}',this.value)">
            ${['draft','sent','changes_requested','approved','invoice','deposit_pending','paid','cancelled'].map(s =>
              `<option value="${s}" ${p.status===s?'selected':''}>${statusLabels[s]}</option>`).join('')}
          </select>` : ''}
        ${p.status === 'draft' || p.status === 'sent' ? `<button class="btn" onclick="window.Proposals.copyApprovalLink('${p.approval_token}')">🔗 Copy Approval Link</button>` : ''}
        ${p.status === 'approved' ? `<button class="btn btn-green" onclick="window.Proposals.convertToProject('${p.id}')">→ Create Project</button>` : ''}
        <button class="btn btn-blue" onclick="window.Proposals.exportPDF('${p.id}')">⬇ PDF</button>
      </div>
    </div>

    <!-- Summary cards -->
    <div class="summary-grid" style="margin-bottom:20px">
      <div class="summary-card"><div class="summary-card-label">Total</div><div class="summary-card-value">$${total.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div class="summary-card"><div class="summary-card-label">Deposit (${p.deposit_pct||50}%)</div><div class="summary-card-value">$${depositAmount.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div class="summary-card"><div class="summary-card-label">Environment</div><div class="summary-card-value" style="font-size:15px">${escH(p.environment||'Indoor')}</div><div class="summary-card-sub">${escH(p.support_method||'')}</div></div>
      <div class="summary-card"><div class="summary-card-label">Rigging</div><div class="summary-card-value" style="font-size:13px;line-height:1.3">${escH(p.rigging_responsibility||'—')}</div></div>
      ${p.distance_miles ? `<div class="summary-card"><div class="summary-card-label">Distance</div><div class="summary-card-value">${p.distance_miles} mi</div></div>` : ''}
    </div>

    <!-- Proposal body -->
    <div class="tab-bar">
      <button class="tab-btn active" id="pt-items" onclick="window.Proposals.showPTab('items')">Line Items</button>
      <button class="tab-btn" id="pt-details" onclick="window.Proposals.showPTab('details')">Job Details</button>
      ${p.rigging_requirements ? `<button class="tab-btn" id="pt-rigging" onclick="window.Proposals.showPTab('rigging')">Rigging Requirements</button>` : ''}
      <button class="tab-btn" id="pt-activity" onclick="window.Proposals.showPTab('activity')">Activity</button>
    </div>

    <!-- LINE ITEMS TAB -->
    <div class="tab-panel active" id="pp-items">
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:12px">
        <table class="data-table" id="prop-items-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Total</th>${!isLocked?'<th></th>':''}</tr></thead>
          <tbody id="prop-items-body">
            ${lineItems.map((li, i) => _propLineItemRow(li, i, isLocked)).join('')}
          </tbody>
        </table>
        ${!isLocked ? `<div style="padding:10px 14px;background:#f9fafb;border-top:1px solid var(--color-border-light)">
          <button class="btn" style="font-size:12px" onclick="window.Proposals.addPropLineItem()">+ Add Line Item</button>
        </div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:500px;margin-left:auto;margin-bottom:12px">
        ${!isLocked ? `
          <div class="form-field"><label class="form-label">Tax Rate (%)</label>
            <input class="form-input" id="prop-tax" type="number" value="${p.tax_rate||0}" min="0" step="0.1" onchange="window.Proposals.savePropTotals()"></div>
          <div class="form-field"><label class="form-label">Deposit (%)</label>
            <input class="form-input" id="prop-deposit" type="number" value="${p.deposit_pct||50}" min="0" max="100" step="5" onchange="window.Proposals.savePropTotals()"></div>` : ''}
      </div>
      <div class="totals-box" style="max-width:380px;margin-left:auto" id="prop-totals">
        <div class="total-row"><span>Subtotal</span><span>$${subtotal.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="total-row"><span>Tax (${p.tax_rate||0}%)</span><span>$${taxAmount.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="total-row grand"><span>TOTAL</span><span>$${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="total-row" style="margin-top:8px;font-size:12px;color:var(--color-muted)"><span>Deposit (${p.deposit_pct||50}%)</span><span>$${depositAmount.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
      </div>
      ${p.scope_notes ? `<div style="margin-top:14px"><div class="form-label" style="margin-bottom:6px">Terms & Notes</div><div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px;font-size:13px;line-height:1.7;white-space:pre-wrap">${escH(p.scope_notes)}</div></div>` : ''}
    </div>

    <!-- JOB DETAILS TAB -->
    <div class="tab-panel" id="pp-details">
      <div class="card" style="margin-bottom:12px">
        <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:14px">Job Specifications</div>
        <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
          <div><div class="form-label">Jobsite</div><div style="margin-top:4px">${escH(p.jobsite_address||'Not set')}</div></div>
          <div><div class="form-label">Environment</div><div style="margin-top:4px">${escH(p.environment||'Indoor')}</div></div>
          <div><div class="form-label">Support Method</div><div style="margin-top:4px">${escH(p.support_method||'Not set')}</div></div>
          <div><div class="form-label">Rigging Responsibility</div><div style="margin-top:4px">${escH(p.rigging_responsibility||'Not set')}</div></div>
          ${p.distance_miles ? `<div><div class="form-label">Distance from Warehouse</div><div style="margin-top:4px">${p.distance_miles} miles</div></div>` : ''}
        </div>
        ${(p.wall_specs||[]).length ? `
          <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;margin-bottom:10px">Wall Specifications</div>
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Wall</th><th>Width</th><th>Height</th><th>Qty</th></tr></thead>
            <tbody>${(p.wall_specs||[]).map((w,i)=>`<tr>
              <td>Wall ${i+1}</td>
              <td>${w.width}ft</td>
              <td>${w.height}ft</td>
              <td>${w.qty}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : ''}
      </div>
      ${p.schedule?.loadIn?.date || p.schedule?.showDays?.length ? `
        <div class="card">
          <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:14px">Schedule</div>
          ${p.schedule?.loadIn?.date ? `<div style="margin-bottom:8px"><strong>Load In:</strong> ${fmtDate(p.schedule.loadIn.date)}${p.schedule.loadIn.time?' at '+fmtTime(p.schedule.loadIn.time):''}</div>` : ''}
          ${(p.schedule?.showDays||[]).filter(sd=>sd.date).map((sd,i)=>`<div style="margin-bottom:8px"><strong>Show Day ${i+1}:</strong> ${fmtDate(sd.date)}${sd.startTime?' · '+fmtTime(sd.startTime):''}${sd.endTime?' — '+fmtTime(sd.endTime):''}</div>`).join('')}
          ${p.schedule?.loadOut?.date ? `<div><strong>Load Out:</strong> ${fmtDate(p.schedule.loadOut.date)}${p.schedule.loadOut.time?' at '+fmtTime(p.schedule.loadOut.time):''}</div>` : ''}
        </div>` : ''}
    </div>

    <!-- RIGGING REQUIREMENTS TAB -->
    ${p.rigging_requirements ? `
      <div class="tab-panel" id="pp-rigging">
        <div class="card">
          <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;margin-bottom:14px">Rigging Requirements</div>
          ${!isLocked ? `<textarea class="form-input form-textarea" id="prop-rigging-text" rows="12" style="font-size:13px;line-height:1.7;margin-bottom:12px">${escH(p.rigging_requirements)}</textarea>
          <button class="btn btn-primary" onclick="window.Proposals.saveRiggingReq()">Save</button>` :
          `<div style="white-space:pre-wrap;font-size:13px;line-height:1.7;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">${escH(p.rigging_requirements)}</div>`}
        </div>
      </div>` : ''}

    <!-- ACTIVITY TAB -->
    <div class="tab-panel" id="pp-activity">
      <div id="prop-activity-wrap"><div class="loading-state"><div class="spinner"></div></div></div>
    </div>`;
}

function _propLineItemRow(li, i, locked) {
  const total = ((li.qty || 0) * (li.unit_price || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 });
  if (locked) return `<tr>
    <td>${escH(li.name)}</td>
    <td>${li.qty}</td>
    <td>${escH(li.unit||'ea')}</td>
    <td>$${Number(li.unit_price||0).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    <td style="font-weight:600">$${total}</td>
  </tr>`;
  return `<tr>
    <td><input class="form-input" style="padding:5px 8px;font-size:12px" value="${escH(li.name)}"
      onchange="window.Proposals._updatePropLI(${i},'name',this.value)"></td>
    <td><input class="form-input" style="padding:5px 8px;font-size:12px;width:60px" type="number" value="${li.qty}"
      onchange="window.Proposals._updatePropLI(${i},'qty',this.value)"></td>
    <td><input class="form-input" style="padding:5px 8px;font-size:12px;width:60px" value="${escH(li.unit||'ea')}"
      onchange="window.Proposals._updatePropLI(${i},'unit',this.value)"></td>
    <td><input class="form-input" style="padding:5px 8px;font-size:12px;width:80px" type="number" step="0.01" value="${li.unit_price||0}"
      onchange="window.Proposals._updatePropLI(${i},'unit_price',this.value)"></td>
    <td style="font-weight:600" id="pli-total-${i}">$${total}</td>
    <td><button class="btn btn-danger" style="padding:3px 7px;font-size:11px" onclick="window.Proposals.removePropLI(${i})">✕</button></td>
  </tr>`;
}

function showPTab(name) {
  ['items','details','rigging','activity'].forEach(t => {
    document.getElementById('pt-'+t)?.classList.toggle('active', t===name);
    document.getElementById('pp-'+t)?.classList.toggle('active', t===name);
  });
  if (name === 'activity') _loadActivity();
}

async function _loadActivity() {
  const el = document.getElementById('prop-activity-wrap'); if (!el) return;
  const { data: log } = await supabase.from('activity_log')
    .select('*,profiles!activity_log_performed_by_fkey(first_name,last_name)')
    .eq('entity_type', 'proposal').eq('entity_id', _currentProposal.id)
    .order('created_at', { ascending: false });
  el.innerHTML = !log?.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No activity yet</div></div>`
    : `<div style="display:flex;flex-direction:column;gap:8px">${log.map(l=>`
        <div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:12px">
          <div style="flex:1"><strong>${escH(l.action.replace(/_/g,' '))}</strong>
          ${l.profiles?`<span class="text-muted"> · ${l.profiles.first_name} ${l.profiles.last_name}</span>`:''}
          </div>
          <div class="text-small text-muted">${new Date(l.created_at).toLocaleString()}</div>
        </div>`).join('')}</div>`;
}

// ── PROPOSAL MUTATIONS ───────────────────────────────────────

async function _updatePropLI(i, field, val) {
  const items = Array.isArray(_currentProposal.line_items) ? [..._currentProposal.line_items] : [];
  if (!items[i]) return;
  items[i][field] = field === 'qty' ? parseInt(val)||0 : field === 'unit_price' ? parseFloat(val)||0 : val;
  const rowTotal = ((items[i].qty||0) * (items[i].unit_price||0)).toLocaleString('en-US',{minimumFractionDigits:2});
  const el = document.getElementById(`pli-total-${i}`); if (el) el.textContent = '$'+rowTotal;
  _currentProposal.line_items = items;
  await _savePropLineItems(items);
}

async function addPropLineItem() {
  const items = Array.isArray(_currentProposal.line_items) ? [..._currentProposal.line_items] : [];
  items.push({ name: 'New Item', qty: 1, unit: 'ea', unit_price: 0 });
  _currentProposal.line_items = items;
  await _savePropLineItems(items);
  _renderProposalView(document.getElementById('main-content'));
  showPTab('items');
}

async function removePropLI(i) {
  const items = Array.isArray(_currentProposal.line_items) ? [..._currentProposal.line_items] : [];
  items.splice(i, 1);
  _currentProposal.line_items = items;
  await _savePropLineItems(items);
  _renderProposalView(document.getElementById('main-content'));
  showPTab('items');
}

async function _savePropLineItems(items) {
  const subtotal = items.reduce((a, li) => a + ((li.qty||0)*(li.unit_price||0)), 0);
  const taxRate = _currentProposal.tax_rate || 0;
  const taxAmount = subtotal * taxRate / 100;
  const total = subtotal + taxAmount;
  const depositAmount = total * (_currentProposal.deposit_pct||50) / 100;
  await supabase.from('proposals').update({ line_items: items, subtotal, tax_amount: taxAmount, total, deposit_amount: depositAmount }).eq('id', _currentProposal.id);
  _currentProposal.subtotal = subtotal; _currentProposal.tax_amount = taxAmount; _currentProposal.total = total; _currentProposal.deposit_amount = depositAmount;
  _refreshTotalsDisplay(subtotal, taxRate, taxAmount, total, _currentProposal.deposit_pct||50, depositAmount);
}

function _refreshTotalsDisplay(sub, taxRate, tax, total, depositPct, deposit) {
  const el = document.getElementById('prop-totals'); if (!el) return;
  el.innerHTML = `
    <div class="total-row"><span>Subtotal</span><span>$${sub.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    <div class="total-row"><span>Tax (${taxRate}%)</span><span>$${tax.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    <div class="total-row grand"><span>TOTAL</span><span>$${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    <div class="total-row" style="margin-top:8px;font-size:12px;color:var(--color-muted)"><span>Deposit (${depositPct}%)</span><span>$${deposit.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>`;
}

async function savePropTotals() {
  const taxRate = parseFloat(document.getElementById('prop-tax')?.value)||0;
  const depositPct = parseFloat(document.getElementById('prop-deposit')?.value)||50;
  const items = Array.isArray(_currentProposal.line_items)?_currentProposal.line_items:[];
  const subtotal = items.reduce((a,li)=>a+((li.qty||0)*(li.unit_price||0)),0);
  const taxAmount = subtotal*taxRate/100;
  const total = subtotal+taxAmount;
  const depositAmount = total*depositPct/100;
  await supabase.from('proposals').update({tax_rate:taxRate,deposit_pct:depositPct,subtotal,tax_amount:taxAmount,total,deposit_amount:depositAmount}).eq('id',_currentProposal.id);
  Object.assign(_currentProposal,{tax_rate:taxRate,deposit_pct:depositPct,subtotal,tax_amount:taxAmount,total,deposit_amount:depositAmount});
  _refreshTotalsDisplay(subtotal,taxRate,taxAmount,total,depositPct,depositAmount);
  showToast('Saved.','success');
}

async function saveRiggingReq() {
  const text = document.getElementById('prop-rigging-text')?.value||'';
  await supabase.from('proposals').update({rigging_requirements:text}).eq('id',_currentProposal.id);
  _currentProposal.rigging_requirements = text;
  showToast('Rigging requirements saved.','success');
}

async function updateStatus(id, status) {
  await supabase.from('proposals').update({status}).eq('id',id);
  if (_currentProposal?.id === id) _currentProposal.status = status;
  await logActivity('proposal',id,'status_changed',{status});
  showToast(`Status: ${status}`,'success');
}

async function sendProposal(id) {
  await supabase.from('proposals').update({status:'sent',sent_at:new Date().toISOString()}).eq('id',id);
  await logActivity('proposal',id,'sent');
  showToast('Proposal marked as sent!','success');
  window.navigateTo('proposals');
}

async function convertToInvoice(id) {
  if (!confirm('Convert this proposal to an invoice?')) return;
  await supabase.from('proposals').update({status:'invoice',invoiced_at:new Date().toISOString()}).eq('id',id);
  await logActivity('proposal',id,'converted_to_invoice');
  showToast('Converted to invoice!','success');
  window.navigateTo('proposals');
}

async function markPaid(id) {
  if (!confirm('Mark this invoice as paid?')) return;
  await supabase.from('proposals').update({status:'paid',paid_at:new Date().toISOString()}).eq('id',id);
  await logActivity('proposal',id,'marked_paid');
  showToast('Marked as paid!','success');
  window.navigateTo('proposals');
}

async function deleteProposal(id) {
  if (!confirm('Delete this proposal?')) return;
  await dbDelete('proposals',id);
  showToast('Deleted.','success');
  window.navigateTo('proposals');
}

function copyApprovalLink(token) {
  const url = `${window.location.origin}/client.html?token=${token}`;
  navigator.clipboard.writeText(url).then(()=>showToast('Approval link copied!','success')).catch(()=>showToast('URL: '+url,'info'));
}

// ============================================================
// CONVERT APPROVED PROPOSAL → PROJECT
// ============================================================

async function convertToProject(proposalId) {
  const p = await fetchProposal(proposalId);
  if (!p) return;

  if (!confirm(`Convert "${p.title}" to a project? This will create a new project, reserve equipment, and generate a task list.`)) return;

  showToast('Creating project...', 'info');
  const profile = getProfile();

  // 1. Create project
  const { data: project, error: projError } = await dbInsert('projects', {
    name: p.title,
    address: p.jobsite_address || '',
    client_id: p.client_id || null,
    owner_id: profile.id,
    status: 'confirmed',
    event_start_date: p.schedule?.loadIn?.date || p.schedule?.showDays?.[0]?.date || null,
    event_end_date: p.schedule?.loadOut?.date || null,
    notes: p.scope_notes || '',
  });

  if (projError) { showToast('Failed to create project.', 'error'); console.error(projError); return; }

  // 2. Create walls from wall_specs
  for (let i = 0; i < (p.wall_specs||[]).length; i++) {
    const w = p.wall_specs[i];
    if (!w.width || !w.height) continue;
    await dbInsert('walls', {
      project_id: project.id,
      name: `Wall ${i+1}`,
      order_index: i,
      width_ft: parseFloat(w.width) || 20,
      height_ft: parseFloat(w.height) || 12,
      mount_type: p.support_method?.includes('fly')||p.support_method?.includes('ceiling') ? 'flown' : 'ground',
      panel_mode: 'mixed',
      qty: parseInt(w.qty) || 1,
      location_label: 'Main',
    });
  }

  // 3. Create logistics shell
  await supabase.from('logistics').insert({
    project_id: project.id,
    schedule: p.schedule || {},
    scope_of_work: p.scope_notes || '',
  });

  // 4. Generate task list from job type template
  await _generateTaskList(project.id, p.job_type || 'indoor_fly');

  // 5. Mark proposal as having a linked project
  await supabase.from('proposals').update({ status: 'invoice' }).eq('id', proposalId);
  await logActivity('proposal', proposalId, 'converted_to_project', { project_id: project.id });

  showToast('Project created! Task list generated.', 'success');

  // Navigate to the new project
  const { default: { render: renderProjects } } = await import('./projects.js').catch(() => ({}));
  window.navigateTo('projects');
}

async function _generateTaskList(projectId, jobType) {
  // Check for a custom template first
  const { data: templates } = await supabase.from('task_templates')
    .select('*').eq('job_type', jobType).eq('is_default', true).limit(1);

  let tasks = [];
  if (templates?.length) {
    tasks = templates[0].tasks || [];
  } else {
    tasks = _defaultTaskList(jobType);
  }

  if (!tasks.length) return;

  // Create task list
  const { data: taskList } = await supabase.from('task_lists').insert({
    name: `${jobType.replace(/_/g,' ')} — Task List`,
    project_id: projectId,
    owner_id: getProfile().id,
    color: '#2563eb',
  }).select().single();

  if (!taskList) return;

  // Insert tasks
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    await supabase.from('tasks').insert({
      task_list_id: taskList.id,
      project_id: projectId,
      title: t.title,
      description: t.description || '',
      status: 'todo',
      priority: t.priority || 'medium',
      order_index: i,
      created_by: getProfile().id,
    });
  }
}

function _defaultTaskList(jobType) {
  const base = [
    // Pre-show
    { title: 'Confirm logistics with venue', priority: 'high' },
    { title: 'Arrange trucking / transport', priority: 'high' },
    { title: 'Confirm crew schedule', priority: 'high' },
    { title: 'Pull panels from inventory', priority: 'high' },
    { title: 'Pull all data and power cabling', priority: 'medium' },
    { title: 'Equipment prep and testing', priority: 'high' },
    // Load In
    { title: 'Truck loaded and departed warehouse', priority: 'high' },
    { title: 'Arrived on site', priority: 'medium' },
    ...(jobType === 'indoor_fly' || jobType === 'outdoor' ? [
      { title: 'Rigging set — motors/fly bars hung', priority: 'high' },
      { title: 'Panels assembled and flown', priority: 'high' },
    ] : [
      { title: 'Ground support structure built', priority: 'high' },
      { title: 'Panels stacked on structure', priority: 'high' },
    ]),
    { title: 'Data and power cabling complete', priority: 'high' },
    { title: 'Processor programmed', priority: 'high' },
    { title: 'Signal confirmed — show ready sign-off', priority: 'urgent' },
    // Show
    { title: 'Pre-show systems check', priority: 'high' },
    { title: 'Show complete', priority: 'medium' },
    // Load Out
    { title: 'Equipment broken down and packed', priority: 'high' },
    { title: 'Truck loaded', priority: 'high' },
    { title: 'Departed venue', priority: 'medium' },
    { title: 'Arrived at warehouse', priority: 'medium' },
    // Post-show
    { title: 'Equipment de-prepped and checked in', priority: 'high' },
    { title: 'Equipment condition noted', priority: 'medium' },
    { title: 'Final invoice sent to client', priority: 'urgent' },
    { title: 'Client follow-up call / email', priority: 'medium' },
    { title: 'Review and remarket', priority: 'low' },
  ];

  if (jobType === 'outdoor') {
    base.splice(0, 0, { title: 'Weather check — 7 day forecast', priority: 'high' });
    base.splice(1, 0, { title: 'Confirm outdoor power / generator', priority: 'high' });
  }

  return base;
}

// ============================================================
// PDF EXPORT
// ============================================================

async function exportPDF(id) {
  let p = _currentProposal?.id === id ? _currentProposal : await fetchProposal(id);
  if (!p) return;

  const { jsPDF } = window.jspdf; if (!jsPDF) { alert('PDF library not loaded.'); return; }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, M = 16, cw = W - M * 2; let y = M;
  const chk = n => { if (y + n > 285) { doc.addPage(); y = M; } };
  const kv = (l, v) => { chk(7); doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(60,60,60); doc.text(String(l), M, y); doc.setFont('helvetica','bold'); doc.setTextColor(26,58,92); doc.text(String(v), W-M, y,'right'); y+=6; };
  const body = (t, sz=9) => { if (!t) return; chk(8); doc.setFontSize(sz); doc.setFont('helvetica','normal'); doc.setTextColor(60,60,60); const lines=doc.splitTextToSize(t,cw); doc.text(lines,M,y); y+=lines.length*5+2; };
  const hdrSec = t => { chk(12); doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(26,58,92); doc.text(t.toUpperCase(),M,y); y+=5; doc.setDrawColor(200,200,200); doc.line(M,y,W-M,y); y+=4; };

  const isInv = ['invoice','deposit_pending','paid'].includes(p.status);
  const docType = p.status==='paid'?'PAID INVOICE':isInv?'INVOICE':'PROPOSAL';

  // Header
  doc.setFillColor(26,58,92); doc.rect(0,0,W,36,'F');
  doc.setFontSize(22); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255); doc.text('Visual Affect',M,14);
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(170,195,220); doc.text('Websites · Workflows · LED Video Walls',M,22);
  doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255); doc.text(docType,W-M,14,'right');
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(170,195,220); doc.text(`Date: ${new Date(p.created_at).toLocaleDateString()}`,W-M,22,'right');
  y=44;

  // Title
  doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(26,58,92); doc.text(p.title,M,y); y+=8;
  if (p.scope_notes) { body(p.scope_notes); y+=2; }

  // From / To
  doc.setFillColor(249,250,251); doc.rect(M,y,cw/2-4,30,'F'); doc.setDrawColor(209,213,219); doc.rect(M,y,cw/2-4,30,'D');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(107,114,128); doc.text('FROM',M+5,y+7);
  doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(26,58,92); doc.text('Visual Affect',M+5,y+14);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
  doc.text(`${getProfile()?.first_name||''} ${getProfile()?.last_name||''}`,M+5,y+20);
  const bx = M+cw/2+4;
  doc.setFillColor(249,250,251); doc.rect(bx,y,cw/2-4,30,'F'); doc.setDrawColor(209,213,219); doc.rect(bx,y,cw/2-4,30,'D');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(107,114,128); doc.text('TO',bx+5,y+7);
  doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(26,58,92); doc.text(p.clients?.company_name||'—',bx+5,y+14);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
  if (p.clients?.contact_name) doc.text(p.clients.contact_name,bx+5,y+20);
  if (p.clients?.email) doc.text(p.clients.email,bx+5,y+26);
  y+=38;

  // Job details
  if (p.jobsite_address || p.environment || p.support_method) {
    hdrSec('Job Details');
    if (p.jobsite_address) kv('Jobsite', p.jobsite_address);
    if (p.environment) kv('Environment', p.environment);
    if (p.support_method) kv('Support Method', p.support_method);
    if (p.rigging_responsibility) kv('Rigging', p.rigging_responsibility);
    y+=4;
  }

  // Schedule
  const s = p.schedule || {};
  if (s.loadIn?.date || s.showDays?.length) {
    hdrSec('Schedule');
    if (s.loadIn?.date) kv('Load In', `${fmtDate(s.loadIn.date)}${s.loadIn.time?' at '+fmtTime(s.loadIn.time):''}`);
    (s.showDays||[]).filter(sd=>sd.date).forEach((sd,i)=>kv(`Show Day ${i+1}`,`${fmtDate(sd.date)}${sd.startTime?' · '+fmtTime(sd.startTime):''}${sd.endTime?' — '+fmtTime(sd.endTime):''}`));
    if (s.loadOut?.date) kv('Load Out', `${fmtDate(s.loadOut.date)}${s.loadOut.time?' at '+fmtTime(s.loadOut.time):''}`);
    y+=4;
  }

  // Line items
  chk(20); hdrSec('Line Items');
  const items = Array.isArray(p.line_items) ? p.line_items : [];
  const colW = { item:M, qty:M+82, unit:M+102, price:M+122, total:M+152 };
  doc.setFillColor(26,58,92); doc.rect(M,y,cw,8,'F');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
  doc.text('ITEM',colW.item+2,y+5.5); doc.text('QTY',colW.qty+2,y+5.5);
  doc.text('UNIT',colW.unit+2,y+5.5); doc.text('UNIT PRICE',colW.price+2,y+5.5); doc.text('TOTAL',colW.total+2,y+5.5);
  y+=10;
  items.forEach((li,i)=>{
    chk(9); if(i%2===0){doc.setFillColor(249,250,251);doc.rect(M,y-2,cw,9,'F');}
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30);
    const nameLines=doc.splitTextToSize(li.name||'',76); doc.text(nameLines,colW.item+2,y+4);
    doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
    doc.text(String(li.qty||0),colW.qty+2,y+4);
    doc.text(li.unit||'ea',colW.unit+2,y+4);
    doc.text('$'+Number(li.unit_price||0).toFixed(2),colW.price+2,y+4);
    doc.setFont('helvetica','bold'); doc.setTextColor(26,58,92);
    doc.text('$'+((li.qty||0)*(li.unit_price||0)).toFixed(2),colW.total+2,y+4);
    y+=Math.max(9,nameLines.length*5);
  });
  y+=4; doc.setDrawColor(200,200,200); doc.line(M,y,W-M,y); y+=6;

  // Totals
  const sub=items.reduce((a,li)=>a+((li.qty||0)*(li.unit_price||0)),0);
  const tax=sub*(p.tax_rate||0)/100,tot=sub+tax,dep=tot*(p.deposit_pct||50)/100;
  const tx=W-M-55;
  const trow=(l,v,bold=false)=>{chk(7);doc.setFontSize(10);doc.setFont('helvetica',bold?'bold':'normal');doc.setTextColor(bold?26:80,bold?58:80,bold?92:80);doc.text(l,tx,y);doc.setFont('helvetica','bold');doc.text('$'+v.toFixed(2),W-M,y,'right');y+=7;};
  trow('Subtotal',sub); trow(`Tax (${p.tax_rate||0}%)`,tax);
  doc.setFillColor(26,58,92);doc.rect(M,y-1,cw,10,'F');
  doc.setFontSize(12);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);doc.text('TOTAL',tx,y+6);doc.text('$'+tot.toFixed(2),W-M,y+6,'right');y+=14;
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(80,80,80);doc.text(`Deposit (${p.deposit_pct||50}%): $${dep.toFixed(2)}`,W-M,y,'right');y+=8;

  if(p.status==='paid'){chk(10);doc.setFillColor(220,252,231);doc.rect(M,y,cw,10,'F');doc.setFontSize(12);doc.setFont('helvetica','bold');doc.setTextColor(20,83,45);doc.text('✓  PAID',W/2,y+7,'center');y+=14;}

  // Rigging requirements
  if(p.rigging_requirements){chk(20);doc.addPage();y=M;hdrSec('Rigging Requirements — Client/Venue Responsibility');body(p.rigging_requirements);}

  const tot2=doc.getNumberOfPages();
  for(let i=1;i<=tot2;i++){doc.setPage(i);doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(160,160,160);doc.text('Visual Affect — LED Planning Tool',M,295);doc.text(`Page ${i} of ${tot2}`,W-M,295,'right');}
  doc.save((p.title||'proposal').replace(/[^a-z0-9]/gi,'_')+'.pdf');
}

// ============================================================
// HELPERS
// ============================================================

const _v = id => document.getElementById(id)?.value?.trim()||'';
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(d){if(!d)return'';return new Date(d+'T00:00:00').toLocaleDateString();}
function fmtTime(t){if(!t)return'';const[h,m]=t.split(':');const hr=parseInt(h);return`${hr%12||12}:${m} ${hr<12?'AM':'PM'}`;}
function showToast(msg,type='success'){window.showToast?.(msg,type);}

// ============================================================
// GLOBAL EXPOSURE
// ============================================================

window.Proposals = {
  openWizard, closeWizard, openProposal,
  sendProposal, convertToInvoice, markPaid, deleteProposal,
  convertToProject, copyApprovalLink, exportPDF, updateStatus,
  showPTab, addPropLineItem, removePropLI, savePropTotals, saveRiggingReq,
  _wSel, _wSelClient, _toggleService, _wNext, _wBack, _wFinish,
  _addShowDay, _removeShowDay, _addWall, _removeWall,
  _updatePropLI, _updateLI, _removeLI, _addReviewItem, _updateTotals, _calcDistance,
};
