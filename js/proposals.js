// ============================================================
// proposals.js — Proposal Management v2
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin } from './auth.js';

const GROUP_TYPES = ['Video', 'Audio', 'Lighting', 'Structure', 'Labor', 'Logistics', 'Other'];

const STATUS_LABELS = {
  draft:'Draft', sent:'Sent to Client', changes_requested:'Changes Requested',
  approved:'Approved', invoice:'Invoice', deposit_pending:'Deposit Pending',
  paid:'Paid', cancelled:'Cancelled',
};

const STATUS_COLORS = {
  draft:'tag-gray', sent:'tag-blue', changes_requested:'tag-yellow',
  approved:'tag-green', invoice:'tag-blue', deposit_pending:'tag-yellow',
  paid:'tag-green', cancelled:'tag-red',
};

const CONTRACTING_STAGES = [
  { key:'proposal',         label:'Proposal Sent',       icon:'📄' },
  { key:'verbal',           label:'Verbal Confirmed',     icon:'🤝' },
  { key:'coi_pending',      label:'Awaiting COI',         icon:'📋' },
  { key:'contract_sent',    label:'Contract Sent',        icon:'✉'  },
  { key:'contract_signed',  label:'Contract Signed',      icon:'✍'  },
  { key:'deposit_pending',  label:'Deposit Pending',      icon:'💰' },
  { key:'deposit_received', label:'Deposit Received',     icon:'✅' },
  { key:'active',           label:'Project Active',       icon:'🚀' },
];

// ============================================================
// MAIN RENDER
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading proposals...</div></div>`;
  const proposals = await _fetchProposals();
  _renderList(container, proposals);

  const leadDataRaw = sessionStorage.getItem('proposal_from_lead');
  const clientId    = sessionStorage.getItem('proposal_client_id');
  sessionStorage.removeItem('proposal_from_lead');
  sessionStorage.removeItem('proposal_client_id');

  if (leadDataRaw) {
    try { const d = JSON.parse(leadDataRaw); _prefillFromLead(d); openWizard(); }
    catch(e) { console.error(e); }
  } else if (clientId) {
    _wizardAnswers = { contact_id: clientId };
    openWizard();
  }
}

function _renderList(container, proposals) {
  const active   = proposals.filter(p => !['paid','cancelled'].includes(p.status));
  const archived = proposals.filter(p =>  ['paid','cancelled'].includes(p.status));
  const needsAction = proposals.filter(p =>
    ['verbal','coi_pending','contract_sent','deposit_pending'].includes(p.contracting_stage));

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Proposals</div>
        <div class="section-sub">${active.length} active · ${archived.length} archived${needsAction.length?` · <span style="color:#d97706;font-weight:600">⚠ ${needsAction.length} need action</span>`:''}</div>
      </div>
      <button class="btn-add" onclick="window.Proposals.openWizard()">+ New Proposal</button>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
      ${Object.entries(STATUS_LABELS).map(([key,label]) => {
        const count = proposals.filter(p => p.status === key).length;
        return count ? `<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:7px 12px;box-shadow:var(--shadow-sm);display:flex;align-items:center;gap:7px">
          <span class="tag ${STATUS_COLORS[key]}" style="margin:0;font-size:10px">${label}</span>
          <span style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;color:var(--color-accent)">${count}</span>
        </div>` : '';
      }).join('')}
    </div>

    ${!proposals.length ? `<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-title">No proposals yet</div></div>` : ''}
    ${active.length ? `<div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Active</div><div class="card-grid" style="margin-bottom:24px">${active.map(p => _proposalCard(p)).join('')}</div>` : ''}
    ${archived.length ? `<div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Archived</div><div class="card-grid">${archived.map(p => _proposalCard(p)).join('')}</div>` : ''}

    <div class="sheet-overlay" id="prop-wizard-overlay">
      <div class="sheet" style="max-width:760px">
        <div class="sheet-header">
          <div class="sheet-title">New Proposal</div>
          <button class="modal-close" onclick="window.Proposals.closeWizard()">✕</button>
        </div>
        <div class="wizard-progress" id="prop-wiz-prog"></div>
        <div id="prop-wiz-body"></div>
        <div class="wizard-nav" id="prop-wiz-nav"></div>
      </div>
    </div>`;
}

function _proposalCard(p) {
  const stage = CONTRACTING_STAGES.find(s => s.key === p.contracting_stage);
  const needsAction = ['verbal','coi_pending','contract_sent','deposit_pending'].includes(p.contracting_stage);
  const contact = p.contacts || p.clients;
  return `<div class="pcard" style="border-color:${needsAction?'#fbbf24':'var(--color-border-light)'}">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">
      <span class="tag ${STATUS_COLORS[p.status]||'tag-gray'}">${STATUS_LABELS[p.status]||p.status}</span>
      ${stage&&stage.key!=='proposal'?`<span style="font-size:10px;background:#f0fdf4;color:#166534;padding:2px 7px;border-radius:4px;font-weight:600">${stage.icon} ${stage.label}</span>`:''}
    </div>
    <div style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700;margin-bottom:4px">${escH(p.title)}</div>
    <div class="text-small text-muted" style="line-height:1.7">
      ${contact?.company_name?`👥 ${escH(contact.company_name)}<br>`:''}
      ${new Date(p.created_at).toLocaleDateString()}
      ${p.total?`<br><strong style="font-size:14px;color:var(--color-accent)">$${Number(p.total).toLocaleString('en-US',{minimumFractionDigits:2})}</strong>`:''}
    </div>
    ${needsAction?`<div class="alert alert-warn" style="margin-top:8px;padding:6px 10px;font-size:11px">⚠ Action needed: ${stage?.label}</div>`:''}
    <div style="display:flex;gap:6px;margin-top:12px;padding-top:11px;border-top:1px solid var(--color-border-light);flex-wrap:wrap">
      <button class="btn btn-primary" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.openProposal('${p.id}')">Open</button>
      <button class="btn btn-blue" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.exportPDF('${p.id}')">⬇ PDF</button>
      <button class="btn btn-danger" style="font-size:12px;padding:6px 13px" onclick="window.Proposals.deleteProposal('${p.id}')">Delete</button>
    </div>
  </div>`;
}

// ============================================================
// DATA
// ============================================================

async function _fetchProposals() {
  const { data, error } = await supabase.from('proposals')
    .select('*,contacts(company_name),clients(company_name),profiles!proposals_owner_id_fkey(first_name,last_name)')
    .order('created_at', { ascending: false });
  if (error) { console.error('[Proposals]', error); return []; }
  return data || [];
}

async function _fetchProposal(id) {
  const { data } = await supabase.from('proposals')
    .select('*,contacts(*),clients(*)')
    .eq('id', id).single();
  return data;
}

async function _fetchInventory() {
  const { data } = await supabase.from('inventory_items').select('*').order('category').order('name');
  return data || [];
}

async function _fetchPackages() {
  const { data } = await supabase.from('equipment_packages').select('*').order('name');
  return data || [];
}

async function _fetchContacts() {
  const { data } = await supabase.from('contacts').select('id,company_name,contact_name,email').order('company_name');
  return data || [];
}

async function _fetchPayments(proposalId) {
  const { data } = await supabase.from('proposal_payments').select('*').eq('proposal_id', proposalId).order('created_at');
  return data || [];
}

// ============================================================
// WIZARD
// ============================================================

const WIZARD_STEPS = [
  { id:'contact',   q:'Who is this proposal for?',             type:'contact'   },
  { id:'title',     q:'Give this proposal a title.',           type:'text',     ph:'e.g. Main Stage LED Wall — ACME Conference 2025' },
  { id:'jobsite',   q:'What is the jobsite?',                  type:'jobsite'   },
  { id:'schedule',  q:'What are the event dates and times?',   type:'schedule'  },
  { id:'scope',     q:'What is the scope of work?',            type:'scope'     },
  { id:'lineitems', q:'Build your proposal line items.',       type:'lineitems' },
  { id:'labor',     q:'What labor positions are needed?',      type:'labor'     },
  { id:'terms',     q:'Set payment terms.',                    type:'terms'     },
];

let _wizStep = 0;
let _wizardAnswers = {};
let _wizContacts = [];
let _wizInventory = [];
let _wizPackages = [];
let _wizGroups = [];
let _wizLaborPositions = [];

async function openWizard() {
  _wizStep = 0;
  if (!Object.keys(_wizardAnswers).length) _wizardAnswers = {};
  _wizGroups = _wizardAnswers._groups || [];
  _wizLaborPositions = _wizardAnswers._labor || [];
  [_wizContacts, _wizInventory, _wizPackages] = await Promise.all([
    _fetchContacts(), _fetchInventory(), _fetchPackages(),
  ]);
  _renderWizStep();
  document.getElementById('prop-wizard-overlay').classList.add('open');
}

function closeWizard() {
  document.getElementById('prop-wizard-overlay').classList.remove('open');
}

function _prefillFromLead(data) {
  _wizardAnswers = {
    contact_id: data.client_id || '',
    title: data.title || '',
    jobsite_city: data.jobsite_city || '',
    jobsite_state: data.jobsite_state || '',
    jobsite_address: data.jobsite_address || '',
    schedule: data.schedule || {},
    wall_specs: data.wall_specs || [],
    environment: data.environment || 'indoor',
    support_method: data.support_method || '',
    rigging_responsibility: data.rigging_responsibility || '',
    additional_services: data.additional_services || [],
    scope_notes: data.scope_notes || '',
    _lead_id: data.lead_id || '',
  };
  _wizGroups = [];
  _wizLaborPositions = [];
}

function _renderWizStep() {
  const st = WIZARD_STEPS[_wizStep], total = WIZARD_STEPS.length;
  document.getElementById('prop-wiz-prog').innerHTML =
    WIZARD_STEPS.map((_,i) => `<div class="wizard-dot ${i<_wizStep?'done':i===_wizStep?'active':''}"></div>`).join('');

  let inp = '';

  if (st.type === 'text') {
    inp = `<input class="form-input" id="wi" placeholder="${st.ph||''}" value="${escH(_wizardAnswers[st.id]||'')}" style="margin-top:10px;width:100%">`;

  } else if (st.type === 'contact') {
    const sel = _wizardAnswers.contact_id || '';
    const selContact = _wizContacts.find(c => c.id === sel);
    inp = `<div style="margin-top:10px">
      <div style="position:relative;margin-bottom:10px">
        <input class="form-input" id="contact-search" placeholder="Search contacts..."
          value="${selContact ? escH(selContact.company_name) : ''}"
          oninput="window.Proposals._filterContacts(this.value)">
      </div>
      <div id="contact-results" style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto">
        ${_wizContacts.map(c => `<button class="option-btn ${sel===c.id?'selected':''}" data-contact-id="${c.id}"
          onclick="window.Proposals._selContact(this)" style="text-align:left;padding:10px 14px">
          <strong>${escH(c.company_name)}</strong>
          <div class="option-sub">${escH(c.contact_name||'')}${c.email?` · ${escH(c.email)}`:''}</div>
        </button>`).join('')}
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--color-border-light)">
        <button class="option-btn ${sel==='new'?'selected':''}" data-contact-id="new"
          onclick="window.Proposals._selContact(this)" style="text-align:left;padding:10px 14px;width:100%">
          <strong>+ Create New Contact</strong>
        </button>
      </div>
      ${sel==='new'?`<div style="margin-top:10px;padding:14px;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px">
        <div class="form-grid form-grid-2" style="gap:10px">
          <div class="form-field"><label class="form-label">Company *</label><input class="form-input" id="nc-company" placeholder="Acme Events"></div>
          <div class="form-field"><label class="form-label">Contact Name</label><input class="form-input" id="nc-contact"></div>
          <div class="form-field"><label class="form-label">Email</label><input class="form-input" id="nc-email" type="email"></div>
          <div class="form-field"><label class="form-label">Phone</label><input class="form-input" id="nc-phone" type="tel"></div>
        </div>
      </div>`:''}
    </div>`;

  } else if (st.type === 'jobsite') {
    inp = `<div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
      <div class="form-field"><label class="form-label">Street Address</label><input class="form-input" id="js-addr" value="${escH(_wizardAnswers.jobsite_address||'')}"></div>
      <div class="form-grid form-grid-3" style="gap:10px">
        <div class="form-field"><label class="form-label">City</label><input class="form-input" id="js-city" value="${escH(_wizardAnswers.jobsite_city||'')}"></div>
        <div class="form-field"><label class="form-label">State</label><input class="form-input" id="js-state" value="${escH(_wizardAnswers.jobsite_state||'')}"></div>
        <div class="form-field"><label class="form-label">ZIP</label><input class="form-input" id="js-zip" value="${escH(_wizardAnswers.jobsite_zip||'')}"></div>
      </div>
      <div class="form-grid form-grid-2" style="gap:10px">
        <div class="form-field"><label class="form-label">Environment</label>
          <select class="form-select" id="js-env">
            <option value="indoor" ${(_wizardAnswers.environment||'indoor')==='indoor'?'selected':''}>Indoor</option>
            <option value="outdoor" ${_wizardAnswers.environment==='outdoor'?'selected':''}>Outdoor</option>
          </select></div>
        <div class="form-field"><label class="form-label">Distance from Warehouse (miles)</label>
          <input class="form-input" id="js-miles" type="number" min="0" value="${_wizardAnswers.distance_miles||''}"></div>
      </div>
    </div>`;

  } else if (st.type === 'schedule') {
    const s = _wizardAnswers.schedule || {};
    const li = s.loadIn||{}, lo = s.loadOut||{};
    const days = s.showDays||[{date:'',startTime:'',endTime:''}];
    inp = `<div style="margin-top:10px;display:flex;flex-direction:column;gap:12px">
      <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:8px">🚛 Load In</div>
        <div class="form-grid form-grid-2" style="gap:10px">
          <div class="form-field"><label class="form-label">Date</label><input class="form-input" id="s-lidate" type="date" value="${escH(li.date||'')}"></div>
          <div class="form-field"><label class="form-label">Time</label><input class="form-input" id="s-litime" type="time" value="${escH(li.time||'')}"></div>
        </div>
      </div>
      <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:8px">🎬 Show Days</div>
        <div id="wiz-show-days">${days.map((sd,i)=>_sdRow(sd,i)).join('')}</div>
        <button class="btn" style="margin-top:8px;font-size:12px" onclick="window.Proposals._addSD()">+ Add Show Day</button>
      </div>
      <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:8px">🚛 Load Out</div>
        <div class="form-grid form-grid-2" style="gap:10px">
          <div class="form-field"><label class="form-label">Date</label><input class="form-input" id="s-lodate" type="date" value="${escH(lo.date||'')}"></div>
          <div class="form-field"><label class="form-label">Time</label><input class="form-input" id="s-lotime" type="time" value="${escH(lo.time||'')}"></div>
        </div>
      </div>
    </div>`;

  } else if (st.type === 'scope') {
    inp = `<div style="margin-top:10px;display:flex;flex-direction:column;gap:12px">
      <div class="form-grid form-grid-2" style="gap:12px">
        <div class="form-field"><label class="form-label">Support Method</label>
          <select class="form-select" id="sc-support">
            ${['','Flown','Ground Stacked','Riser Stacked','Custom Rigging'].map(m=>`<option value="${m}" ${_wizardAnswers.support_method===m?'selected':''}>${m||'— Select —'}</option>`).join('')}
          </select></div>
        <div class="form-field"><label class="form-label">Rigging Responsibility</label>
          <select class="form-select" id="sc-rigging">
            ${['','Visual Affect Supplies All Rigging','Client / Venue Responsible','Split — Discuss Per Item'].map(r=>`<option value="${r}" ${_wizardAnswers.rigging_responsibility===r?'selected':''}>${r||'— Select —'}</option>`).join('')}
          </select></div>
      </div>
      <div class="form-field"><label class="form-label">Wall Specifications</label>
        <div id="wiz-walls">${(_wizardAnswers.wall_specs?.length?_wizardAnswers.wall_specs:[{width:'',height:'',qty:1}]).map((w,i)=>_wallRow(w,i)).join('')}</div>
        <button class="btn" style="margin-top:8px;font-size:12px" onclick="window.Proposals._addWall()">+ Add Wall</button>
      </div>
      <div class="form-field"><label class="form-label">Scope Notes</label>
        <textarea class="form-input form-textarea" id="sc-notes" rows="4">${escH(_wizardAnswers.scope_notes||'')}</textarea></div>
    </div>`;

  } else if (st.type === 'lineitems') {
    inp = _lineItemsStep();

  } else if (st.type === 'labor') {
    inp = _laborStep();

  } else if (st.type === 'terms') {
    const sub = _calcSubtotal();
    inp = `<div style="margin-top:10px;display:flex;flex-direction:column;gap:12px">
      <div class="form-grid form-grid-2" style="gap:12px">
        <div class="form-field"><label class="form-label">Tax Rate (%)</label>
          <input class="form-input" id="t-tax" type="number" step="0.1" value="${_wizardAnswers.tax_rate||0}" onchange="window.Proposals._updateTermsTotals()"></div>
        <div class="form-field"><label class="form-label">Deposit (%)</label>
          <input class="form-input" id="t-dep" type="number" step="5" value="${_wizardAnswers.deposit_pct||50}" onchange="window.Proposals._updateTermsTotals()"></div>
        <div class="form-field"><label class="form-label">Deposit Due</label>
          <input class="form-input" id="t-depdue" type="date" value="${_wizardAnswers.deposit_due_date||new Date().toISOString().split('T')[0]}"></div>
        <div class="form-field"><label class="form-label">Final Payment Due</label>
          <input class="form-input" id="t-findue" type="date" value="${_wizardAnswers.final_payment_due_date||''}"></div>
      </div>
      <div class="form-field"><label class="form-label">Terms &amp; Notes</label>
        <textarea class="form-input form-textarea" id="t-notes" rows="4">${escH(_wizardAnswers.terms_notes||'')}</textarea></div>
      <div class="totals-box" id="wiz-totals">${_totalsHTML(sub, _wizardAnswers.tax_rate||0, _wizardAnswers.deposit_pct||50)}</div>
    </div>`;
  }

  document.getElementById('prop-wiz-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="question-bubble">
        <div class="question-label">Step ${_wizStep+1} of ${total}</div>
        ${st.q}
      </div>
      <div>${inp}</div>
    </div>`;

  let nav = _wizStep > 0 ? `<button class="btn-wizard-back" onclick="window.Proposals._wBack()">← Back</button>` : '';
  nav += _wizStep < total-1
    ? `<button class="btn-wizard-next" onclick="window.Proposals._wNext()">Continue →</button>`
    : `<button class="btn-wizard-finish" onclick="window.Proposals._wFinish()">✓ Create Proposal</button>`;
  document.getElementById('prop-wiz-nav').innerHTML = nav;
  setTimeout(() => document.getElementById('wi')?.focus(), 80);
}

function _sdRow(sd, i) {
  return `<div class="sd-row" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px">
    <div><label class="form-label">Date</label><input class="form-input sd-date" type="date" value="${escH(sd.date||'')}"></div>
    <div><label class="form-label">Start</label><input class="form-input sd-start" type="time" value="${escH(sd.startTime||'')}"></div>
    <div><label class="form-label">End</label><input class="form-input sd-end" type="time" value="${escH(sd.endTime||'')}"></div>
    <div style="padding-top:18px"><button class="btn btn-danger" style="padding:7px 9px" onclick="window.Proposals._removeSD(${i})">✕</button></div>
  </div>`;
}

function _wallRow(w, i) {
  return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px">
    <div><label class="form-label">Width (ft)</label><input class="form-input wall-w" type="number" step="0.5" value="${w.width||''}"></div>
    <div><label class="form-label">Height (ft)</label><input class="form-input wall-h" type="number" step="0.5" value="${w.height||''}"></div>
    <div><label class="form-label">Qty</label><input class="form-input wall-qty" type="number" min="1" value="${w.qty||1}"></div>
    ${i>0?`<div style="padding-top:18px"><button class="btn btn-danger" style="padding:7px 9px" onclick="window.Proposals._removeWall(${i})">✕</button></div>`:'<div></div>'}
  </div>`;
}

// ── LINE ITEMS ────────────────────────────────────────────────

function _lineItemsStep() {
  return `<div style="margin-top:10px">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button class="btn btn-primary" onclick="window.Proposals._addGroup()">+ Add Group</button>
      <button class="btn" onclick="window.Proposals._openPackageLibrary()">📦 Package Library</button>
      <button class="btn" onclick="window.Proposals._openInventorySearch()">🔍 Search Inventory</button>
    </div>
    <div id="wiz-groups">${!_wizGroups.length
      ? `<div style="text-align:center;padding:30px;color:var(--color-muted);font-size:13px;background:#f9fafb;border:1.5px dashed var(--color-border-light);border-radius:8px">Click <strong>+ Add Group</strong> to start building your proposal.</div>`
      : _wizGroups.map((g,gi)=>_groupBlock(g,gi)).join('')}</div>
    <div class="modal-overlay" id="inv-search-modal">
      <div class="modal" style="max-width:600px">
        <div class="modal-header"><div class="modal-title">Add from Inventory</div>
          <button class="modal-close" onclick="document.getElementById('inv-search-modal').classList.remove('open')">✕</button></div>
        <div class="form-field" style="margin-bottom:10px">
          <input class="form-input" id="inv-search-input" placeholder="Search inventory..." oninput="window.Proposals._filterInvSearch(this.value)"></div>
        <div style="font-size:12px;color:var(--color-muted);margin-bottom:8px">Add to group:
          <select class="form-select" id="inv-target-group" style="font-size:12px;padding:4px 8px;max-width:200px">
            ${_wizGroups.map((g,i)=>`<option value="${i}">${escH(g.name)}</option>`).join('')}
          </select></div>
        <div id="inv-search-results" style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
          ${_wizInventory.map(item=>`<div class="inv-search-item" data-name="${escH(item.name.toLowerCase())}"
            style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px">
            <div><div style="font-weight:600;font-size:13px">${escH(item.name)}</div>
            <div class="text-small text-muted">${escH(item.category||'')} · ${item.rate_project?'$'+item.rate_project+'/project':item.rate_day?'$'+item.rate_day+'/day':'No price'}</div></div>
            <button class="btn btn-primary" style="font-size:11px;padding:5px 10px"
              onclick="window.Proposals._addInvItem('${item.id}','${escH(item.name)}',${item.rate_project||item.rate_day||0})">+ Add</button>
          </div>`).join('')}
        </div>
      </div>
    </div>
    <div class="modal-overlay" id="pkg-library-modal">
      <div class="modal" style="max-width:520px">
        <div class="modal-header"><div class="modal-title">Package Library</div>
          <button class="modal-close" onclick="document.getElementById('pkg-library-modal').classList.remove('open')">✕</button></div>
        ${!_wizPackages.length
          ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No saved packages yet</div></div>`
          : `<div style="display:flex;flex-direction:column;gap:8px">${_wizPackages.map(pkg=>`
              <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px">
                <div><div style="font-weight:600;font-size:13px">${escH(pkg.name)}</div>
                <div class="text-small text-muted">${escH(pkg.group_type||'')} · ${(pkg.items||[]).length} items</div></div>
                <button class="btn btn-primary" style="font-size:11px;padding:5px 10px"
                  onclick="window.Proposals._addPackageToProposal('${pkg.id}')">Add</button>
              </div>`).join('')}</div>`}
      </div>
    </div>
  </div>`;
}

function _groupBlock(group, gi) {
  const sub = _groupSubtotal(group);
  return `<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:10px;margin-bottom:12px;overflow:hidden">
    <div style="background:#f9fafb;padding:12px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--color-border-light)">
      <select class="form-select" style="font-size:12px;padding:5px 8px;max-width:120px" onchange="window.Proposals._updateGroupType(${gi},this.value)">
        ${GROUP_TYPES.map(t=>`<option value="${t}" ${group.type===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <input class="form-input" style="font-size:13px;font-weight:600;flex:1" value="${escH(group.name)}" onchange="window.Proposals._updateGroupName(${gi},this.value)">
      <button class="btn" style="font-size:11px;padding:4px 9px" onclick="window.Proposals._addPackageToGroup(${gi})">+ Package</button>
      <button class="btn" style="font-size:11px;padding:4px 9px" onclick="window.Proposals._addLineToGroup(${gi})">+ Item</button>
      <button class="btn btn-danger" style="font-size:11px;padding:4px 9px" onclick="window.Proposals._removeGroup(${gi})">✕</button>
    </div>
    <div style="padding:10px 14px">
      ${!(group.packages?.length||group.items?.length)?`<div style="text-align:center;padding:12px;color:var(--color-muted);font-size:12px">Use <strong>+ Package</strong> or <strong>+ Item</strong> to add content.</div>`:''}
      ${(group.packages||[]).map((pkg,pi)=>`
        <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;margin-bottom:8px;overflow:hidden">
          <div style="padding:8px 12px;display:flex;align-items:center;gap:8px;background:#f1f5f9;border-bottom:1px solid var(--color-border-light)">
            <span>📦</span>
            <input class="form-input" style="font-size:12px;font-weight:600;flex:1;padding:4px 8px" value="${escH(pkg.name)}" onchange="window.Proposals._updatePkgName(${gi},${pi},this.value)">
            <button class="btn" style="font-size:11px;padding:3px 8px" onclick="window.Proposals._addLineToPkg(${gi},${pi})">+ Item</button>
            <button class="btn" style="font-size:11px;padding:3px 8px" onclick="window.Proposals._savePkgAsTemplate(${gi},${pi})">💾</button>
            <button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="window.Proposals._removePkg(${gi},${pi})">✕</button>
          </div>
          ${(pkg.items||[]).map((item,ii)=>`<div style="display:grid;grid-template-columns:1fr 60px 70px 70px 80px auto;gap:6px;align-items:center;padding:5px 12px;border-bottom:1px solid #f3f4f6">
            <input class="form-input" style="padding:3px 6px;font-size:12px" value="${escH(item.name||'')}" onchange="window.Proposals._updatePkgItem(${gi},${pi},${ii},'name',this.value)">
            <input class="form-input" style="padding:3px 6px;font-size:12px;text-align:center" type="number" min="1" value="${item.qty||1}" onchange="window.Proposals._updatePkgItem(${gi},${pi},${ii},'qty',this.value)">
            <input class="form-input" style="padding:3px 6px;font-size:12px" value="${escH(item.unit||'ea')}" onchange="window.Proposals._updatePkgItem(${gi},${pi},${ii},'unit',this.value)">
            <input class="form-input" style="padding:3px 6px;font-size:12px;text-align:right" type="number" step="0.01" value="${item.unit_price||0}" onchange="window.Proposals._updatePkgItem(${gi},${pi},${ii},'unit_price',this.value)">
            <div style="font-size:12px;font-weight:600;text-align:right">$${((item.qty||1)*(item.unit_price||0)).toFixed(2)}</div>
            <button class="btn btn-danger" style="padding:2px 6px;font-size:11px" onclick="window.Proposals._removePkgItem(${gi},${pi},${ii})">✕</button>
          </div>`).join('')}
        </div>`).join('')}
      ${(group.items||[]).map((item,ii)=>`<div style="display:grid;grid-template-columns:1fr 60px 70px 70px 80px auto;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6">
        <input class="form-input" style="padding:3px 6px;font-size:12px" value="${escH(item.name||'')}" onchange="window.Proposals._updateGroupItem(${gi},${ii},'name',this.value)">
        <input class="form-input" style="padding:3px 6px;font-size:12px;text-align:center" type="number" min="1" value="${item.qty||1}" onchange="window.Proposals._updateGroupItem(${gi},${ii},'qty',this.value)">
        <input class="form-input" style="padding:3px 6px;font-size:12px" value="${escH(item.unit||'ea')}" onchange="window.Proposals._updateGroupItem(${gi},${ii},'unit',this.value)">
        <input class="form-input" style="padding:3px 6px;font-size:12px;text-align:right" type="number" step="0.01" value="${item.unit_price||0}" onchange="window.Proposals._updateGroupItem(${gi},${ii},'unit_price',this.value)">
        <div style="font-size:12px;font-weight:600;text-align:right">$${((item.qty||1)*(item.unit_price||0)).toFixed(2)}</div>
        <button class="btn btn-danger" style="padding:2px 6px;font-size:11px" onclick="window.Proposals._removeGroupItem(${gi},${ii})">✕</button>
      </div>`).join('')}
    </div>
    <div style="padding:8px 14px;background:#f9fafb;border-top:1px solid var(--color-border-light);display:flex;justify-content:flex-end">
      <span style="font-size:12px;color:var(--color-muted)">Group subtotal: </span>
      <span style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;color:var(--color-accent);margin-left:8px">$${sub.toLocaleString('en-US',{minimumFractionDigits:2})}</span>
    </div>
  </div>`;
}

// ── LABOR STEP ────────────────────────────────────────────────

function _laborStep() {
  return `<div style="margin-top:10px">
    <div style="margin-bottom:14px"><button class="btn btn-primary" onclick="window.Proposals._addLaborPosition()">+ Add Position</button></div>
    <div id="wiz-labor">${!_wizLaborPositions.length
      ? `<div style="text-align:center;padding:30px;color:var(--color-muted);font-size:13px;background:#f9fafb;border:1.5px dashed var(--color-border-light);border-radius:8px">Add crew positions needed for this job.</div>`
      : _wizLaborPositions.map((pos,i)=>_laborRow(pos,i)).join('')}</div>
  </div>`;
}

function _laborRow(pos, i) {
  return `<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px;margin-bottom:8px">
    <div style="display:grid;grid-template-columns:1fr 90px 70px 70px auto;gap:10px;align-items:end">
      <div class="form-field"><label class="form-label">Role / Position</label>
        <input class="form-input" value="${escH(pos.role||'')}" placeholder="Lead LED Tech, A2, Driver"
          onchange="window.Proposals._updateLabor(${i},'role',this.value)"></div>
      <div class="form-field"><label class="form-label">$/hr</label>
        <input class="form-input" type="number" step="0.01" value="${pos.rate||0}" onchange="window.Proposals._updateLabor(${i},'rate',this.value)"></div>
      <div class="form-field"><label class="form-label">Hours</label>
        <input class="form-input" type="number" step="0.5" value="${pos.hours||0}" onchange="window.Proposals._updateLabor(${i},'hours',this.value)"></div>
      <div class="form-field"><label class="form-label">Qty</label>
        <input class="form-input" type="number" min="1" value="${pos.qty||1}" onchange="window.Proposals._updateLabor(${i},'qty',this.value)"></div>
      <div style="padding-top:18px"><button class="btn btn-danger" style="padding:7px 10px" onclick="window.Proposals._removeLabor(${i})">✕</button></div>
    </div>
    <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between">
      <input class="form-input" style="flex:1;font-size:12px;padding:5px 9px;margin-right:12px" value="${escH(pos.notes||'')}"
        placeholder="Notes..." onchange="window.Proposals._updateLabor(${i},'notes',this.value)">
      <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;color:var(--color-accent);white-space:nowrap">
        $${((pos.rate||0)*(pos.hours||0)*(pos.qty||1)).toLocaleString('en-US',{minimumFractionDigits:2})}
      </div>
    </div>
  </div>`;
}

// ── GROUP/PACKAGE MUTATIONS ───────────────────────────────────

function _addGroup() { _wizGroups.push({id:Date.now(),name:'New Group',type:'Video',packages:[],items:[]}); _refreshGroupsUI(); }
function _removeGroup(gi) { _wizGroups.splice(gi,1); _refreshGroupsUI(); }
function _updateGroupName(gi,name) { _wizGroups[gi].name=name; }
function _updateGroupType(gi,type) { _wizGroups[gi].type=type; }
function _addPackageToGroup(gi) { if(!_wizGroups[gi].packages)_wizGroups[gi].packages=[]; _wizGroups[gi].packages.push({id:Date.now(),name:'New Package',items:[]}); _refreshGroupsUI(); }
function _removePkg(gi,pi) { _wizGroups[gi].packages.splice(pi,1); _refreshGroupsUI(); }
function _updatePkgName(gi,pi,name) { _wizGroups[gi].packages[pi].name=name; }
function _addLineToPkg(gi,pi) { _wizGroups[gi].packages[pi].items.push({name:'',qty:1,unit:'ea',unit_price:0}); _refreshGroupsUI(); }
function _removePkgItem(gi,pi,ii) { _wizGroups[gi].packages[pi].items.splice(ii,1); _refreshGroupsUI(); }
function _updatePkgItem(gi,pi,ii,field,val) { const item=_wizGroups[gi]?.packages?.[pi]?.items?.[ii]; if(!item)return; item[field]=['qty','unit_price'].includes(field)?parseFloat(val)||0:val; _refreshGroupsUI(); }
function _addLineToGroup(gi) { if(!_wizGroups[gi].items)_wizGroups[gi].items=[]; _wizGroups[gi].items.push({name:'',qty:1,unit:'ea',unit_price:0}); _refreshGroupsUI(); }
function _removeGroupItem(gi,ii) { _wizGroups[gi].items.splice(ii,1); _refreshGroupsUI(); }
function _updateGroupItem(gi,ii,field,val) { const item=_wizGroups[gi]?.items?.[ii]; if(!item)return; item[field]=['qty','unit_price'].includes(field)?parseFloat(val)||0:val; _refreshGroupsUI(); }

function _refreshGroupsUI() {
  const el=document.getElementById('wiz-groups'); if(!el)return;
  el.innerHTML=!_wizGroups.length
    ?`<div style="text-align:center;padding:30px;color:var(--color-muted);font-size:13px;background:#f9fafb;border:1.5px dashed var(--color-border-light);border-radius:8px">Click <strong>+ Add Group</strong> to start.</div>`
    :_wizGroups.map((g,gi)=>_groupBlock(g,gi)).join('');
}

function _groupSubtotal(group) {
  let t=0;
  (group.packages||[]).forEach(pkg=>(pkg.items||[]).forEach(item=>t+=(item.qty||1)*(item.unit_price||0)));
  (group.items||[]).forEach(item=>t+=(item.qty||1)*(item.unit_price||0));
  return t;
}

function _openInventorySearch() { document.getElementById('inv-search-modal').classList.add('open'); }
function _openPackageLibrary() { document.getElementById('pkg-library-modal').classList.add('open'); }

function _filterContacts(q) {
  const query=q.toLowerCase();
  document.querySelectorAll('#contact-results .option-btn').forEach(btn=>{
    btn.style.display=!query||btn.textContent.toLowerCase().includes(query)?'':'none';
  });
}

function _filterInvSearch(q) {
  const query=q.toLowerCase();
  document.querySelectorAll('.inv-search-item').forEach(el=>{
    el.style.display=!query||el.dataset.name.includes(query)?'':'none';
  });
}

function _selContact(btn) {
  btn.closest('div').querySelectorAll('.option-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  _wizardAnswers.contact_id=btn.dataset.contactId;
  if(btn.dataset.contactId==='new')_renderWizStep();
}

async function _addPackageToProposal(pkgId) {
  const pkg=_wizPackages.find(p=>p.id===pkgId); if(!pkg)return;
  _wizGroups.push({id:Date.now(),name:pkg.name,type:pkg.group_type||'Video',packages:[{id:Date.now(),name:pkg.name,items:[...(pkg.items||[])]}],items:[]});
  document.getElementById('pkg-library-modal').classList.remove('open');
  _refreshGroupsUI();
  showToast(`Package "${pkg.name}" added!`,'success');
}

function _addInvItem(invId,name,price) {
  const gi=parseInt(document.getElementById('inv-target-group')?.value);
  const idx=isNaN(gi)?0:gi;
  if(!_wizGroups[idx])return;
  if(!_wizGroups[idx].items)_wizGroups[idx].items=[];
  _wizGroups[idx].items.push({name,qty:1,unit:'ea',unit_price:price,inventory_id:invId});
  document.getElementById('inv-search-modal').classList.remove('open');
  _refreshGroupsUI();
  showToast(`"${name}" added!`,'success');
}

async function _savePkgAsTemplate(gi,pi) {
  const pkg=_wizGroups[gi]?.packages?.[pi]; if(!pkg)return;
  const name=prompt('Save as template with name:',pkg.name); if(!name)return;
  await dbInsert('equipment_packages',{name,group_type:_wizGroups[gi].type||'Video',items:pkg.items,created_by:getProfile().id});
  showToast('Package saved!','success');
  _wizPackages=await _fetchPackages();
}

// ── LABOR MUTATIONS ───────────────────────────────────────────

function _addLaborPosition() { _wizLaborPositions.push({role:'',rate:0,hours:8,qty:1,notes:''}); _refreshLaborUI(); }
function _removeLabor(i) { _wizLaborPositions.splice(i,1); _refreshLaborUI(); }
function _updateLabor(i,field,val) { if(!_wizLaborPositions[i])return; _wizLaborPositions[i][field]=['rate','hours','qty'].includes(field)?parseFloat(val)||0:val; _refreshLaborUI(); }
function _refreshLaborUI() { const el=document.getElementById('wiz-labor'); if(!el)return; el.innerHTML=!_wizLaborPositions.length?`<div style="text-align:center;padding:30px;color:var(--color-muted);font-size:13px;background:#f9fafb;border:1.5px dashed var(--color-border-light);border-radius:8px">Add crew positions.</div>`:_wizLaborPositions.map((pos,i)=>_laborRow(pos,i)).join(''); }

// ── SCHEDULE / WALL HELPERS ───────────────────────────────────

function _addSD() { const rows=document.querySelectorAll('.sd-row'); const days=[...rows].map(r=>({date:r.querySelector('.sd-date')?.value||'',startTime:r.querySelector('.sd-start')?.value||'',endTime:r.querySelector('.sd-end')?.value||''})); days.push({date:'',startTime:'',endTime:''}); document.getElementById('wiz-show-days').innerHTML=days.map((sd,i)=>_sdRow(sd,i)).join(''); }
function _removeSD(i) { const rows=document.querySelectorAll('.sd-row'); let days=[...rows].map(r=>({date:r.querySelector('.sd-date')?.value||'',startTime:r.querySelector('.sd-start')?.value||'',endTime:r.querySelector('.sd-end')?.value||''})); if(days.length<=1)return; days.splice(i,1); document.getElementById('wiz-show-days').innerHTML=days.map((sd,idx)=>_sdRow(sd,idx)).join(''); }
function _addWall() { const els=document.querySelectorAll('#wiz-walls > div'); const walls=[...els].map(el=>({width:el.querySelector('.wall-w')?.value||'',height:el.querySelector('.wall-h')?.value||'',qty:el.querySelector('.wall-qty')?.value||1})); walls.push({width:'',height:'',qty:1}); document.getElementById('wiz-walls').innerHTML=walls.map((w,i)=>_wallRow(w,i)).join(''); }
function _removeWall(i) { const els=document.querySelectorAll('#wiz-walls > div'); let walls=[...els].map(el=>({width:el.querySelector('.wall-w')?.value||'',height:el.querySelector('.wall-h')?.value||'',qty:el.querySelector('.wall-qty')?.value||1})); if(walls.length<=1)return; walls.splice(i,1); document.getElementById('wiz-walls').innerHTML=walls.map((w,idx)=>_wallRow(w,idx)).join(''); }

// ── TOTALS ────────────────────────────────────────────────────

function _calcSubtotal() {
  let t=_wizGroups.reduce((a,g)=>a+_groupSubtotal(g),0);
  t+=_wizLaborPositions.reduce((a,p)=>a+(p.rate||0)*(p.hours||0)*(p.qty||1),0);
  return t;
}

function _totalsHTML(subtotal,taxRate,depositPct) {
  const tax=subtotal*taxRate/100, total=subtotal+tax, deposit=total*depositPct/100;
  return `<div class="total-row"><span>Subtotal</span><span>$${subtotal.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    <div class="total-row"><span>Tax (${taxRate}%)</span><span>$${tax.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    <div class="total-row grand"><span>TOTAL</span><span>$${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    <div class="total-row" style="font-size:12px;color:var(--color-muted)"><span>Deposit (${depositPct}%)</span><span>$${deposit.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>`;
}

function _updateTermsTotals() {
  const tax=parseFloat(document.getElementById('t-tax')?.value)||0;
  const dep=parseFloat(document.getElementById('t-dep')?.value)||50;
  const el=document.getElementById('wiz-totals');
  if(el)el.innerHTML=_totalsHTML(_calcSubtotal(),tax,dep);
}

// ── WIZARD NAV ────────────────────────────────────────────────

function _collectCurrentStep() {
  const st=WIZARD_STEPS[_wizStep];
  if(st.type==='text'){const v=document.getElementById('wi')?.value.trim();if(!v){showToast('Please fill in this field.','error');return false;}_wizardAnswers[st.id]=v;}
  else if(st.type==='contact'){if(!_wizardAnswers.contact_id){showToast('Please select a contact.','error');return false;}if(_wizardAnswers.contact_id==='new'){const company=document.getElementById('nc-company')?.value.trim();if(!company){showToast('Company name required.','error');return false;}_wizardAnswers._newContact={company_name:company,contact_name:document.getElementById('nc-contact')?.value.trim()||'',email:document.getElementById('nc-email')?.value.trim()||'',phone:document.getElementById('nc-phone')?.value.trim()||''};}}
  else if(st.type==='jobsite'){_wizardAnswers.jobsite_address=_v('js-addr');_wizardAnswers.jobsite_city=_v('js-city');_wizardAnswers.jobsite_state=_v('js-state');_wizardAnswers.jobsite_zip=_v('js-zip');_wizardAnswers.environment=document.getElementById('js-env')?.value||'indoor';_wizardAnswers.distance_miles=parseFloat(_v('js-miles'))||null;}
  else if(st.type==='schedule'){const rows=document.querySelectorAll('.sd-row');const showDays=[...rows].map(r=>({date:r.querySelector('.sd-date')?.value||'',startTime:r.querySelector('.sd-start')?.value||'',endTime:r.querySelector('.sd-end')?.value||''}));_wizardAnswers.schedule={loadIn:{date:_v('s-lidate'),time:_v('s-litime')},showDays,loadOut:{date:_v('s-lodate'),time:_v('s-lotime')}};}
  else if(st.type==='scope'){_wizardAnswers.support_method=document.getElementById('sc-support')?.value||'';_wizardAnswers.rigging_responsibility=document.getElementById('sc-rigging')?.value||'';_wizardAnswers.scope_notes=_v('sc-notes');const wallEls=document.querySelectorAll('#wiz-walls > div');_wizardAnswers.wall_specs=[...wallEls].map(el=>({width:parseFloat(el.querySelector('.wall-w')?.value)||0,height:parseFloat(el.querySelector('.wall-h')?.value)||0,qty:parseInt(el.querySelector('.wall-qty')?.value)||1})).filter(w=>w.width||w.height);}
  else if(st.type==='lineitems'){_wizardAnswers._groups=_wizGroups;}
  else if(st.type==='labor'){_wizardAnswers._labor=_wizLaborPositions;}
  else if(st.type==='terms'){_wizardAnswers.tax_rate=parseFloat(document.getElementById('t-tax')?.value)||0;_wizardAnswers.deposit_pct=parseFloat(document.getElementById('t-dep')?.value)||50;_wizardAnswers.deposit_due_date=_v('t-depdue')||null;_wizardAnswers.final_payment_due_date=_v('t-findue')||null;_wizardAnswers.terms_notes=_v('t-notes');}
  return true;
}

function _wNext() { if(_collectCurrentStep()){_wizStep++;_renderWizStep();} }
function _wBack() { if(_wizStep>0){_wizStep--;_renderWizStep();} }

async function _wFinish() {
  if(!_collectCurrentStep())return;
  let contactId=_wizardAnswers.contact_id;
  if(contactId==='new'&&_wizardAnswers._newContact){
    const{data:nc}=await supabase.from('contacts').insert({..._wizardAnswers._newContact,types:['client'],created_by:getProfile().id}).select().single();
    contactId=nc?.id||null;
  }
  const subtotal=_calcSubtotal();
  const taxAmount=subtotal*(_wizardAnswers.tax_rate||0)/100;
  const total=subtotal+taxAmount;
  const depositAmount=total*(_wizardAnswers.deposit_pct||50)/100;
  const lineItems=[];
  _wizGroups.forEach(g=>{
    (g.packages||[]).forEach(pkg=>(pkg.items||[]).forEach(item=>lineItems.push({...item,group:g.name,package:pkg.name})));
    (g.items||[]).forEach(item=>lineItems.push({...item,group:g.name}));
  });
  _wizLaborPositions.forEach(pos=>lineItems.push({name:pos.role,qty:pos.hours*(pos.qty||1),unit:'hr',unit_price:pos.rate,group:'Labor',is_labor_position:true,labor_qty:pos.qty,labor_hours:pos.hours,labor_notes:pos.notes}));
  const proposalData={
    title:_wizardAnswers.title||'Untitled Proposal',
    contact_id:contactId||null,client_id:contactId||null,
    owner_id:getProfile().id,status:'draft',
    lead_id:_wizardAnswers._lead_id||null,
    proposal_groups:_wizGroups,line_items:lineItems,
    labor_positions:_wizLaborPositions,
    tax_rate:_wizardAnswers.tax_rate||0,tax_amount:taxAmount,
    subtotal,total,deposit_pct:_wizardAnswers.deposit_pct||50,
    deposit_amount:depositAmount,
    deposit_due_date:_wizardAnswers.deposit_due_date||null,
    final_payment_due_date:_wizardAnswers.final_payment_due_date||null,
    jobsite_address:[_wizardAnswers.jobsite_address,_wizardAnswers.jobsite_city,_wizardAnswers.jobsite_state,_wizardAnswers.jobsite_zip].filter(Boolean).join(', '),
    distance_miles:_wizardAnswers.distance_miles||null,
    environment:_wizardAnswers.environment||'indoor',
    support_method:_wizardAnswers.support_method||'',
    rigging_responsibility:_wizardAnswers.rigging_responsibility||'',
    wall_specs:_wizardAnswers.wall_specs||[],
    schedule:_wizardAnswers.schedule||{},
    scope_notes:_wizardAnswers.scope_notes||'',
    terms_notes:_wizardAnswers.terms_notes||'',
    contracting_stage:'proposal',
  };
  const{data:proposal,error}=await supabase.from('proposals').insert(proposalData).select().single();
  if(error){showToast('Failed to save proposal.','error');console.error(error);return;}
  await logActivity('proposal',proposal.id,'created',{title:proposal.title});
  closeWizard();
  showToast('Proposal created!','success');
  openProposal(proposal.id);
}

// ============================================================
// PROPOSAL DETAIL
// ============================================================

let _currentProposal=null;

async function openProposal(id) {
  const mc=document.getElementById('main-content');
  mc.innerHTML=`<div class="loading-state"><div class="spinner"></div><div>Loading...</div></div>`;
  document.querySelectorAll('.sb-item').forEach(i=>i.classList.remove('active'));
  const proposal=await _fetchProposal(id);
  if(!proposal){mc.innerHTML=`<div class="empty-state"><div class="empty-title">Proposal not found</div></div>`;return;}
  _currentProposal=proposal;
  _renderProposalDetail(mc);
}

function _renderProposalDetail(mc) {
  const p=_currentProposal;
  const contact=p.contacts||p.clients;
  const stage=CONTRACTING_STAGES.find(s=>s.key===p.contracting_stage);
  mc.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap">
          <button class="btn" onclick="window.navigateTo('proposals')" style="font-size:12px;padding:5px 11px">← Proposals</button>
          <span class="tag ${STATUS_COLORS[p.status]||'tag-gray'}">${STATUS_LABELS[p.status]||p.status}</span>
          ${stage?`<span style="font-size:11px;background:#f0fdf4;color:#166534;padding:3px 8px;border-radius:4px;font-weight:600">${stage.icon} ${stage.label}</span>`:''}
        </div>
        <div style="font-family:'Barlow',sans-serif;font-size:24px;font-weight:800">${escH(p.title)}</div>
        <div class="text-small text-muted" style="margin-top:3px">
          ${contact?.company_name?`👥 ${escH(contact.company_name)} · `:''}${new Date(p.created_at).toLocaleDateString()}
          ${p.jobsite_address?` · 📍 ${escH(p.jobsite_address)}`:''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="form-select" style="font-size:12px;padding:6px 10px" onchange="window.Proposals.updateStatus('${p.id}',this.value)">
          ${Object.entries(STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${p.status===k?'selected':''}>${v}</option>`).join('')}
        </select>
        <button class="btn" onclick="window.Proposals.copyApprovalLink('${p.id}')">🔗 Link</button>
        <button class="btn btn-blue" onclick="window.Proposals.exportPDF('${p.id}')">⬇ PDF</button>
        ${!p.project_id
          ?`<button class="btn btn-primary" onclick="window.Proposals.convertToProject('${p.id}')">→ Create Project</button>`
          :`<button class="btn btn-blue" onclick="window.navigateTo('projects');setTimeout(()=>window.Projects?.openProject?.('${p.project_id}'),300)">View Project →</button>`}
      </div>
    </div>

    <!-- Contracting stages -->
    <div class="card" style="margin-bottom:16px;padding:16px">
      <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;margin-bottom:12px">Contracting Progress</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${CONTRACTING_STAGES.map((s,i)=>{
          const idx=CONTRACTING_STAGES.findIndex(x=>x.key===p.contracting_stage);
          const done=i<idx, current=i===idx;
          return `<button onclick="window.Proposals.setContractingStage('${p.id}','${s.key}')"
            style="padding:6px 10px;border-radius:6px;border:1.5px solid ${current?'#2563eb':done?'#166534':'var(--color-border-light)'};background:${current?'#dbeafe':done?'#dcfce7':'#f9fafb'};cursor:pointer;font-size:11px;font-weight:${current?'700':'500'};color:${current?'#1d4ed8':done?'#166534':'var(--color-muted)'}">
            ${s.icon} ${s.label}
          </button>`;
        }).join('')}
      </div>
    </div>

    <!-- Summary cards -->
    <div class="summary-grid" style="margin-bottom:20px">
      <div class="summary-card"><div class="summary-card-label">Total</div><div class="summary-card-value">$${Number(p.total||0).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div class="summary-card"><div class="summary-card-label">Deposit (${p.deposit_pct||50}%)</div>
        <div class="summary-card-value">$${Number(p.deposit_amount||0).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
        <div class="summary-card-sub">${p.deposit_due_date?`Due ${fmtDate(p.deposit_due_date)}`:'Due immediately'}${p.deposit_paid_at?` · ✓ Paid`:''}</div></div>
      <div class="summary-card"><div class="summary-card-label">Final Payment</div>
        <div class="summary-card-value">$${Number((p.total||0)-(p.deposit_amount||0)).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
        <div class="summary-card-sub">${p.final_payment_due_date?`Due ${fmtDate(p.final_payment_due_date)}`:'10 days before load-in'}${p.final_payment_paid_at?` · ✓ Paid`:''}</div></div>
      <div class="summary-card"><div class="summary-card-label">Environment</div><div class="summary-card-value" style="font-size:15px">${escH(p.environment||'Indoor')}</div><div class="summary-card-sub">${escH(p.support_method||'')}</div></div>
    </div>

    <!-- Tabs -->
    <div class="tab-bar">
      <button class="tab-btn active" id="pt-items" onclick="window.Proposals.showPTab('items')">Line Items</button>
      <button class="tab-btn" id="pt-labor" onclick="window.Proposals.showPTab('labor')">Labor</button>
      <button class="tab-btn" id="pt-details" onclick="window.Proposals.showPTab('details')">Job Details</button>
      <button class="tab-btn" id="pt-payments" onclick="window.Proposals.showPTab('payments')">Payments</button>
      <button class="tab-btn" id="pt-tasks" onclick="window.Proposals.showPTab('tasks')">Tasks</button>
      <button class="tab-btn" id="pt-activity" onclick="window.Proposals.showPTab('activity')">Activity</button>
    </div>
    <div class="tab-panel active" id="pp-items">${_itemsTab(p)}</div>
    <div class="tab-panel" id="pp-labor">${_laborTab(p)}</div>
    <div class="tab-panel" id="pp-details">${_detailsTab(p)}</div>
    <div class="tab-panel" id="pp-payments"><div id="payments-body"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div></div>
    <div class="tab-panel" id="pp-tasks">${_propTasksShell()}</div>
    <div class="tab-panel" id="pp-activity"><div id="activity-body"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div></div>`;
}

// ── LINE ITEMS TAB ────────────────────────────────────────────

function _itemsTab(p) {
  const groups=Array.isArray(p.proposal_groups)?p.proposal_groups:[];
  const subtotal=Number(p.subtotal||0),taxAmount=Number(p.tax_amount||0),total=Number(p.total||0),deposit=Number(p.deposit_amount||0);
  return `<div style="margin-bottom:14px">
    ${groups.map(g=>`<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:10px;margin-bottom:12px;overflow:hidden">
      <div style="background:#f9fafb;padding:10px 14px;border-bottom:1px solid var(--color-border-light);display:flex;align-items:center;justify-content:space-between">
        <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700">${escH(g.name)}</div>
        <span class="tag tag-gray" style="font-size:10px">${escH(g.type||'')}</span>
      </div>
      ${(g.packages||[]).map(pkg=>`<div>
        <div style="padding:8px 14px;background:#f8fafc;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:600;color:var(--color-muted)">📦 ${escH(pkg.name)}</div>
        <table style="width:100%;border-collapse:collapse"><tbody>
          ${(pkg.items||[]).map(item=>`<tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:7px 14px;font-size:13px">${escH(item.name)}</td>
            <td style="padding:7px 6px;text-align:center;font-size:13px">${item.qty}</td>
            <td style="padding:7px 6px;font-size:13px">${escH(item.unit||'ea')}</td>
            <td style="padding:7px 6px;text-align:right;font-size:13px">$${Number(item.unit_price||0).toFixed(2)}</td>
            <td style="padding:7px 14px;text-align:right;font-weight:600;font-size:13px">$${((item.qty||1)*(item.unit_price||0)).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>`).join('')}
      ${(g.items||[]).length?`<table style="width:100%;border-collapse:collapse"><tbody>
        ${(g.items||[]).map(item=>`<tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:7px 14px;font-size:13px">${escH(item.name)}</td>
          <td style="padding:7px 6px;text-align:center;font-size:13px">${item.qty}</td>
          <td style="padding:7px 6px;font-size:13px">${escH(item.unit||'ea')}</td>
          <td style="padding:7px 6px;text-align:right;font-size:13px">$${Number(item.unit_price||0).toFixed(2)}</td>
          <td style="padding:7px 14px;text-align:right;font-weight:600;font-size:13px">$${((item.qty||1)*(item.unit_price||0)).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
        </tr>`).join('')}
      </tbody></table>`:''}
      <div style="padding:8px 14px;background:#f9fafb;border-top:1px solid var(--color-border-light);text-align:right;font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;color:var(--color-accent)">
        $${_groupSubtotal(g).toLocaleString('en-US',{minimumFractionDigits:2})}
      </div>
    </div>`).join('')}
    ${!groups.length?`<div class="empty-state" style="padding:40px"><div class="empty-title">No line items yet</div></div>`:''}
    <div class="totals-box" style="max-width:380px;margin-left:auto">
      <div class="total-row"><span>Subtotal</span><span>$${subtotal.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
      <div class="total-row"><span>Tax (${p.tax_rate||0}%)</span><span>$${taxAmount.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
      <div class="total-row grand"><span>TOTAL</span><span>$${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
      <div class="total-row" style="font-size:12px;color:var(--color-muted)"><span>Deposit (${p.deposit_pct||50}%)</span><span>$${deposit.toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
    </div>
    ${p.terms_notes?`<div style="margin-top:14px"><div class="form-label" style="margin-bottom:6px">Terms</div><div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:14px;font-size:13px;line-height:1.7;white-space:pre-wrap">${escH(p.terms_notes)}</div></div>`:''}
  </div>`;
}

// ── LABOR TAB ─────────────────────────────────────────────────

function _laborTab(p) {
  const positions=Array.isArray(p.labor_positions)?p.labor_positions:[];
  const total=positions.reduce((a,pos)=>a+(pos.rate||0)*(pos.hours||0)*(pos.qty||1),0);
  return `<div>
    ${!positions.length?`<div class="empty-state" style="padding:40px"><div class="empty-title">No labor positions</div></div>`:`
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Position</th><th>Qty</th><th>Hours</th><th>Rate</th><th>Total</th><th>Notes</th></tr></thead>
      <tbody>${positions.map(pos=>`<tr>
        <td><strong>${escH(pos.role||'—')}</strong></td>
        <td>${pos.qty||1}</td><td>${pos.hours||0}</td>
        <td>$${Number(pos.rate||0).toFixed(2)}/hr</td>
        <td style="font-weight:600;color:var(--color-accent)">$${((pos.rate||0)*(pos.hours||0)*(pos.qty||1)).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
        <td class="text-small text-muted">${escH(pos.notes||'')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div style="text-align:right;margin-top:10px;font-family:'Barlow',sans-serif;font-size:16px;font-weight:700;color:var(--color-accent)">
      Labor Total: $${total.toLocaleString('en-US',{minimumFractionDigits:2})}
    </div>`}
    <div style="margin-top:12px;font-size:12px;color:var(--color-muted);padding:10px;background:#f0f9ff;border-radius:6px">
      💡 These positions appear in the Labor module as bookable slots when this proposal converts to a project.
    </div>
  </div>`;
}

// ── JOB DETAILS TAB ───────────────────────────────────────────

function _detailsTab(p) {
  const s=p.schedule||{};
  return `<div style="display:flex;flex-direction:column;gap:14px">
    <div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Job Specifications</div>
      <div class="form-grid form-grid-2" style="gap:10px">
        <div><div class="form-label">Jobsite</div><div style="margin-top:4px;font-size:13px">${escH(p.jobsite_address||'Not set')}</div></div>
        <div><div class="form-label">Environment</div><div style="margin-top:4px;font-size:13px">${escH(p.environment||'Indoor')}</div></div>
        <div><div class="form-label">Support Method</div><div style="margin-top:4px;font-size:13px">${escH(p.support_method||'Not set')}</div></div>
        <div><div class="form-label">Rigging</div><div style="margin-top:4px;font-size:13px">${escH(p.rigging_responsibility||'Not set')}</div></div>
        ${p.distance_miles?`<div><div class="form-label">Distance</div><div style="margin-top:4px;font-size:13px">${p.distance_miles} miles</div></div>`:''}
      </div>
    </div>
    ${(p.wall_specs||[]).length?`<div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Wall Specifications</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Wall</th><th>Width</th><th>Height</th><th>Qty</th></tr></thead>
        <tbody>${(p.wall_specs||[]).map((w,i)=>`<tr><td>Wall ${i+1}</td><td>${w.width}ft</td><td>${w.height}ft</td><td>${w.qty}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`:''}
    ${s.loadIn?.date||s.showDays?.length?`<div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Schedule</div>
      ${s.loadIn?.date?`<div style="margin-bottom:6px"><strong>Load In:</strong> ${fmtDate(s.loadIn.date)}${s.loadIn.time?' at '+fmtTime(s.loadIn.time):''}</div>`:''}
      ${(s.showDays||[]).filter(sd=>sd.date).map((sd,i)=>`<div style="margin-bottom:6px"><strong>Show Day ${i+1}:</strong> ${fmtDate(sd.date)}${sd.startTime?' · '+fmtTime(sd.startTime):''}${sd.endTime?' — '+fmtTime(sd.endTime):''}</div>`).join('')}
      ${s.loadOut?.date?`<div><strong>Load Out:</strong> ${fmtDate(s.loadOut.date)}${s.loadOut.time?' at '+fmtTime(s.loadOut.time):''}</div>`:''}
    </div>`:''}
    ${p.scope_notes?`<div class="card">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:10px">Scope of Work</div>
      <div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${escH(p.scope_notes)}</div>
    </div>`:''}
  </div>`;
}

// ── PAYMENTS TAB ──────────────────────────────────────────────

async function _loadPayments() {
  const el=document.getElementById('payments-body'); if(!el)return;
  const payments=await _fetchPayments(_currentProposal.id);
  const p=_currentProposal;
  const totalPaid=payments.reduce((a,pmt)=>a+Number(pmt.amount||0),0);
  const balance=Number(p.total||0)-totalPaid;
  el.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700">Payment Log</div>
      <button class="btn-add" onclick="window.Proposals.openLogPayment()">+ Log Payment</button>
    </div>
    <div class="summary-grid" style="margin-bottom:16px">
      <div class="summary-card"><div class="summary-card-label">Total Due</div><div class="summary-card-value">$${Number(p.total||0).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div class="summary-card"><div class="summary-card-label">Total Paid</div><div class="summary-card-value" style="color:var(--color-ok)">$${totalPaid.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
      <div class="summary-card"><div class="summary-card-label">Balance</div><div class="summary-card-value" style="color:${balance>0?'#dc2626':'#166534'}">$${balance.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    </div>
    <div class="card" style="margin-bottom:14px;padding:14px">
      <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;margin-bottom:10px">Payment Schedule</div>
      <div style="padding:10px 0;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between">
        <div><div style="font-weight:600;font-size:13px">Deposit (${p.deposit_pct||50}%)</div>
          <div class="text-small text-muted">${p.deposit_due_date?`Due ${fmtDate(p.deposit_due_date)}`:'Due immediately'}</div></div>
        <div style="text-align:right">
          <div style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700">$${Number(p.deposit_amount||0).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
          ${p.deposit_paid_at?`<div style="font-size:11px;color:#166534;font-weight:600">✓ Paid ${fmtDate(p.deposit_paid_at)}</div>`:`<button class="btn btn-green" style="font-size:11px;padding:4px 9px" onclick="window.Proposals.markDepositPaid('${p.id}')">Mark Paid</button>`}
        </div>
      </div>
      <div style="padding:10px 0;display:flex;align-items:center;justify-content:space-between">
        <div><div style="font-weight:600;font-size:13px">Final Payment</div>
          <div class="text-small text-muted">${p.final_payment_due_date?`Due ${fmtDate(p.final_payment_due_date)}`:'10 days before load-in'}</div></div>
        <div style="text-align:right">
          <div style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700">$${Number((p.total||0)-(p.deposit_amount||0)).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
          ${p.final_payment_paid_at?`<div style="font-size:11px;color:#166534;font-weight:600">✓ Paid</div>`:`<button class="btn btn-green" style="font-size:11px;padding:4px 9px" onclick="window.Proposals.markFinalPaid('${p.id}')">Mark Paid</button>`}
        </div>
      </div>
    </div>
    ${!payments.length?`<div class="empty-state" style="padding:30px"><div class="empty-title">No payments logged yet</div></div>`:`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Type</th><th>Amount</th><th>Date</th><th>Notes</th></tr></thead>
      <tbody>${payments.map(pmt=>`<tr>
        <td><span class="tag tag-blue" style="font-size:10px">${pmt.type}</span></td>
        <td style="font-weight:600;color:var(--color-ok)">$${Number(pmt.amount).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
        <td class="text-small">${pmt.paid_at?fmtDate(pmt.paid_at):'—'}</td>
        <td class="text-small">${escH(pmt.notes||'')}</td>
      </tr>`).join('')}</tbody>
    </table></div>`}
    <div class="modal-overlay" id="log-payment-modal">
      <div class="modal" style="max-width:420px">
        <div class="modal-header"><div class="modal-title">Log Payment</div>
          <button class="modal-close" onclick="document.getElementById('log-payment-modal').classList.remove('open')">✕</button></div>
        <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
          <div class="form-field"><label class="form-label">Type</label>
            <select class="form-select" id="pay-type"><option value="deposit">Deposit</option><option value="final">Final</option><option value="partial">Partial</option><option value="other">Other</option></select></div>
          <div class="form-field"><label class="form-label">Amount</label>
            <input class="form-input" id="pay-amount" type="number" step="0.01" placeholder="0.00"></div>
          <div class="form-field"><label class="form-label">Date Received</label>
            <input class="form-input" id="pay-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
          <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label>
            <input class="form-input" id="pay-notes" placeholder="Check #, wire ref..."></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn" onclick="document.getElementById('log-payment-modal').classList.remove('open')">Cancel</button>
          <button class="btn btn-primary" onclick="window.Proposals.savePayment('${p.id}')">Log Payment</button>
        </div>
      </div>
    </div>`;
}

// ── TASKS TAB ─────────────────────────────────────────────────

function _propTasksShell() {
  return `<div style="margin-bottom:12px"><button class="btn-add" onclick="window.Proposals.addPropTask()">+ Add Task</button></div>
    <div id="prop-tasks-wrap"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div>`;
}

async function _loadPropTasks() {
  const el=document.getElementById('prop-tasks-wrap'); if(!el)return;
  const{data:tasks}=await supabase.from('tasks')
    .select('*,profiles!tasks_assigned_to_fkey(first_name,last_name)')
    .ilike('description',`%proposal:${_currentProposal.id}%`)
    .order('due_date',{ascending:true,nullsFirst:false});
  const pc={low:'#6b7280',medium:'#2563eb',high:'#d97706',urgent:'#dc2626'};
  el.innerHTML=!tasks?.length
    ?`<div class="empty-state" style="padding:30px"><div class="empty-title">No tasks yet</div></div>`
    :`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Due</th></tr></thead>
      <tbody>${tasks.map(t=>`<tr>
        <td><strong>${escH(t.title)}</strong></td>
        <td><span style="color:${pc[t.priority]||'#6b7280'};font-weight:600;font-size:11px;text-transform:uppercase">${t.priority}</span></td>
        <td><span class="tag ${t.status==='done'?'tag-green':t.status==='in_progress'?'tag-blue':'tag-gray'}">${t.status.replace('_',' ')}</span></td>
        <td class="text-small">${t.profiles?`${t.profiles.first_name} ${t.profiles.last_name}`:'—'}</td>
        <td class="text-small">${t.due_date?fmtDate(t.due_date):'—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

async function addPropTask() {
  const title=prompt('Task title:'); if(!title)return;
  await supabase.from('tasks').insert({title,description:`proposal:${_currentProposal.id}`,status:'todo',priority:'medium',assigned_to:getProfile().id,created_by:getProfile().id});
  showToast('Task added!','success'); _loadPropTasks();
}

// ── ACTIVITY TAB ──────────────────────────────────────────────

async function _loadPropActivity() {
  const el=document.getElementById('activity-body'); if(!el)return;
  const{data:acts}=await supabase.from('activity_log')
    .select('*,profiles!activity_log_performed_by_fkey(first_name,last_name)')
    .eq('entity_id',_currentProposal.id).order('created_at',{ascending:false});
  el.innerHTML=!acts?.length
    ?`<div class="empty-state" style="padding:30px"><div class="empty-title">No activity yet</div></div>`
    :`<div style="display:flex;flex-direction:column;gap:8px">${acts.map(a=>`<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px 14px">
      <div style="font-size:13px"><strong>${a.profiles?a.profiles.first_name+' '+a.profiles.last_name:'System'}</strong> ${escH(a.action.replace(/_/g,' '))}</div>
      <div class="text-small text-muted">${new Date(a.created_at).toLocaleString()}</div>
    </div>`).join('')}</div>`;
}

// ── TAB SWITCHING ─────────────────────────────────────────────

function showPTab(name) {
  ['items','labor','details','payments','tasks','activity'].forEach(t=>{
    document.getElementById('pt-'+t)?.classList.toggle('active',t===name);
    document.getElementById('pp-'+t)?.classList.toggle('active',t===name);
  });
  if(name==='payments')_loadPayments();
  if(name==='tasks')_loadPropTasks();
  if(name==='activity')_loadPropActivity();
}

// ── STATUS / CONTRACTING ──────────────────────────────────────

async function updateStatus(id,status) {
  await supabase.from('proposals').update({status}).eq('id',id);
  if(_currentProposal?.id===id)_currentProposal.status=status;
  await logActivity('proposal',id,'status_changed',{status});
  showToast(`Status: ${STATUS_LABELS[status]||status}`,'success');
  _renderProposalDetail(document.getElementById('main-content'));
}

async function setContractingStage(id,stage) {
  await supabase.from('proposals').update({contracting_stage:stage}).eq('id',id);
  if(_currentProposal?.id===id)_currentProposal.contracting_stage=stage;
  showToast(`Stage: ${CONTRACTING_STAGES.find(s=>s.key===stage)?.label||stage}`,'success');
  _renderProposalDetail(document.getElementById('main-content'));
}

async function markDepositPaid(id) {
  if(!confirm('Mark deposit as paid?'))return;
  const now=new Date().toISOString();
  await supabase.from('proposals').update({deposit_paid_at:now,contracting_stage:'deposit_received'}).eq('id',id);
  if(_currentProposal?.id===id){_currentProposal.deposit_paid_at=now;_currentProposal.contracting_stage='deposit_received';}
  showToast('Deposit marked as paid!','success');
  _renderProposalDetail(document.getElementById('main-content'));
}

async function markFinalPaid(id) {
  if(!confirm('Mark final payment as paid?'))return;
  const now=new Date().toISOString();
  await supabase.from('proposals').update({final_payment_paid_at:now,status:'paid'}).eq('id',id);
  if(_currentProposal?.id===id){_currentProposal.final_payment_paid_at=now;_currentProposal.status='paid';}
  showToast('Final payment paid!','success');
  _renderProposalDetail(document.getElementById('main-content'));
}

function openLogPayment() { document.getElementById('log-payment-modal')?.classList.add('open'); }

async function savePayment(proposalId) {
  const amount=parseFloat(document.getElementById('pay-amount')?.value)||0;
  if(!amount){showToast('Amount required.','error');return;}
  await dbInsert('proposal_payments',{proposal_id:proposalId,type:document.getElementById('pay-type')?.value||'deposit',amount,paid_at:document.getElementById('pay-date')?.value||null,notes:document.getElementById('pay-notes')?.value||'',recorded_by:getProfile().id});
  document.getElementById('log-payment-modal').classList.remove('open');
  showToast('Payment logged!','success'); _loadPayments();
}

// ── APPROVAL LINK ─────────────────────────────────────────────

async function copyApprovalLink(proposalId) {
  const p=_currentProposal?.id===proposalId?_currentProposal:await _fetchProposal(proposalId); if(!p)return;
  if(!p.approval_token){const token=crypto.randomUUID();await supabase.from('proposals').update({approval_token:token}).eq('id',proposalId);p.approval_token=token;}
  const url=`${window.location.origin}/client.html?token=${p.approval_token}`;
  try{await navigator.clipboard.writeText(url);showToast('Approval link copied!','success');}
  catch(e){prompt('Copy this link:',url);}
}

// ── PDF EXPORT ────────────────────────────────────────────────

async function exportPDF(id) {
  const p=_currentProposal?.id===id?_currentProposal:await _fetchProposal(id); if(!p)return;
  if(!window.jspdf){await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
  const{jsPDF}=window.jspdf; if(!jsPDF){alert('PDF library not loaded.');return;}
  const doc=new jsPDF({orientation:'p',unit:'mm',format:'letter'});
  const{width}=doc.internal.pageSize; let y=20; const lm=18,rm=width-18;
  doc.setFillColor(13,27,62);doc.rect(0,0,width,40,'F');
  doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text('VISUAL AFFECT',lm,20);
  doc.setFontSize(10);doc.setFont('helvetica','normal');doc.text('LED Video Walls',lm,28);
  doc.setFont('helvetica','bold');doc.setFontSize(14);doc.text('PROPOSAL',rm,20,'right');
  y=55;
  const contact=p.contacts||p.clients;
  doc.setTextColor(0,0,0);doc.setFontSize(16);doc.setFont('helvetica','bold');doc.text(p.title||'Proposal',lm,y);y+=8;
  doc.setFontSize(10);doc.setFont('helvetica','normal');doc.setTextColor(100,100,100);
  if(contact?.company_name){doc.text(`Client: ${contact.company_name}`,lm,y);y+=6;}
  doc.text(`Date: ${new Date(p.created_at).toLocaleDateString()}`,lm,y);y+=6;
  if(p.jobsite_address){doc.text(`Jobsite: ${p.jobsite_address}`,lm,y);y+=6;}
  y+=4;
  const groups=Array.isArray(p.proposal_groups)?p.proposal_groups:[];
  groups.forEach(g=>{
    if(y>240){doc.addPage();y=20;}
    doc.setFillColor(241,245,249);doc.rect(lm,y,rm-lm,8,'F');
    doc.setTextColor(0,0,0);doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text(g.name,lm+2,y+5.5);y+=12;
    (g.packages||[]).forEach(pkg=>{
      doc.setFont('helvetica','italic');doc.setFontSize(9);doc.setTextColor(80,80,80);doc.text(`Package: ${pkg.name}`,lm+4,y);y+=5;
      (pkg.items||[]).forEach(item=>{if(y>255){doc.addPage();y=20;}doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(0,0,0);doc.text(`${item.qty||1}x ${item.name}`,lm+6,y);doc.text(`$${((item.qty||1)*(item.unit_price||0)).toLocaleString('en-US',{minimumFractionDigits:2})}`,rm,y,'right');y+=5.5;});
    });
    (g.items||[]).forEach(item=>{if(y>255){doc.addPage();y=20;}doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(0,0,0);doc.text(`${item.qty||1}x ${item.name}`,lm+4,y);doc.text(`$${((item.qty||1)*(item.unit_price||0)).toLocaleString('en-US',{minimumFractionDigits:2})}`,rm,y,'right');y+=5.5;});
    y+=3;
  });
  if(y>220){doc.addPage();y=20;}
  y+=4;doc.setDrawColor(200,200,200);doc.line(lm,y,rm,y);y+=6;
  [{l:'Subtotal',v:`$${Number(p.subtotal||0).toLocaleString('en-US',{minimumFractionDigits:2})}`},
   {l:`Tax (${p.tax_rate||0}%)`,v:`$${Number(p.tax_amount||0).toLocaleString('en-US',{minimumFractionDigits:2})}`},
   {l:'TOTAL',v:`$${Number(p.total||0).toLocaleString('en-US',{minimumFractionDigits:2})}`,bold:true},
   {l:`Deposit (${p.deposit_pct||50}%)`,v:`$${Number(p.deposit_amount||0).toLocaleString('en-US',{minimumFractionDigits:2})}`}
  ].forEach(row=>{doc.setFont('helvetica',row.bold?'bold':'normal');doc.setFontSize(row.bold?12:10);doc.setTextColor(row.bold?13:80,row.bold?27:80,row.bold?62:80);doc.text(row.l,rm-60,y);doc.text(row.v,rm,y,'right');y+=6;});
  if(p.terms_notes){y+=6;doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(0,0,0);doc.text('Terms & Notes',lm,y);y+=5;doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(80,80,80);const lines=doc.splitTextToSize(p.terms_notes,rm-lm);lines.forEach(line=>{if(y>265){doc.addPage();y=20;}doc.text(line,lm,y);y+=4.5;});}
  doc.save(`${(p.title||'proposal').replace(/[^a-z0-9]/gi,'_')}.pdf`);
  showToast('PDF downloaded!','success');
}

// ── CONVERT TO PROJECT ────────────────────────────────────────

async function convertToProject(proposalId) {
  const p=_currentProposal?.id===proposalId?_currentProposal:await _fetchProposal(proposalId); if(!p)return;
  if(!confirm('Convert this proposal to an active project?'))return;
  const s=p.schedule||{};
  const{data:project,error}=await supabase.from('projects').insert({
    name:p.title,client_id:p.client_id||null,contact_id:p.contact_id||null,
    proposal_id:proposalId,status:'planning',
    event_start_date:s.loadIn?.date||null,event_end_date:s.loadOut?.date||null,
    environment:p.environment||'indoor',support_method:p.support_method||'',
    scope_notes:p.scope_notes||'',jobsite_address:p.jobsite_address||'',
    wall_specs:p.wall_specs||[],schedule:p.schedule||{},created_by:getProfile().id,
  }).select().single();
  if(error){showToast('Failed to create project.','error');console.error(error);return;}
  await supabase.from('proposals').update({project_id:project.id,contracting_stage:'active',status:'approved'}).eq('id',proposalId);
  if(_currentProposal?.id===proposalId){_currentProposal.project_id=project.id;}
  await logActivity('proposal',proposalId,'converted_to_project',{project_id:project.id});
  showToast('Project created!','success');
  window.navigateTo('projects');
  setTimeout(()=>window.Projects?.openProject?.(project.id),400);
}

async function deleteProposal(id) {
  if(!confirm('Delete this proposal?'))return;
  await dbDelete('proposals',id);
  showToast('Deleted.','success');
  window.navigateTo('proposals');
}

// ============================================================
// HELPERS
// ============================================================

const _v=id=>document.getElementById(id)?.value?.trim()||'';
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(d){if(!d)return'';return new Date(d+'T00:00:00').toLocaleDateString();}
function fmtTime(t){if(!t)return'';const[h,m]=t.split(':');const hr=parseInt(h);return `${hr%12||12}:${m} ${hr>=12?'PM':'AM'}`;}
function showToast(msg,type='success'){window.showToast?.(msg,type);}

// ============================================================
// GLOBAL EXPOSURE
// ============================================================

window.Proposals={
  openWizard,closeWizard,_wNext,_wBack,_wFinish,
  _selContact,_filterContacts,_filterInvSearch,
  _addGroup,_removeGroup,_updateGroupName,_updateGroupType,
  _addPackageToGroup,_removePkg,_updatePkgName,
  _addLineToPkg,_removePkgItem,_updatePkgItem,
  _addLineToGroup,_removeGroupItem,_updateGroupItem,
  _openInventorySearch,_openPackageLibrary,
  _addInvItem,_addPackageToProposal,_savePkgAsTemplate,
  _addLaborPosition,_removeLabor,_updateLabor,
  _addSD,_removeSD,_addWall,_removeWall,
  _updateTermsTotals,
  openProposal,showPTab,
  updateStatus,setContractingStage,
  markDepositPaid,markFinalPaid,
  openLogPayment,savePayment,
  copyApprovalLink,exportPDF,
  convertToProject,deleteProposal,
  addPropTask,
};
