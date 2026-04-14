// ============================================================
// clients.js — Client management module
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin, canCreateProposals } from './auth.js';

// ============================================================
// MAIN RENDER
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading clients...</div></div>`;
  const clients = await fetchClients();
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Clients</div>
        <div class="section-sub">${clients.length} client${clients.length !== 1 ? 's' : ''}</div>
      </div>
      <button class="btn-add" onclick="window.Clients.openAdd()">+ New Client</button>
    </div>
    ${!clients.length ? `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <div class="empty-title">No clients yet</div>
        <p class="empty-sub">Add your first client to get started.</p>
      </div>` : `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Contact</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Location</th>
            <th>Projects</th>
            <th>Proposals</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${clients.map(c => `
            <tr>
              <td>
                <div style="font-weight:600">${escH(c.company_name)}</div>
              </td>
              <td>${escH(c.contact_name || '—')}</td>
              <td>${c.email ? `<a href="mailto:${escH(c.email)}" style="color:var(--color-accent-2)">${escH(c.email)}</a>` : '—'}</td>
              <td>${c.phone ? `<a href="tel:${escH(c.phone)}" style="color:var(--color-accent-2)">${escH(c.phone)}</a>` : '—'}</td>
              <td class="text-small">${[c.city, c.state].filter(Boolean).join(', ') || '—'}</td>
              <td>
                <span style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700;color:var(--color-accent)">
                  ${c.project_count || 0}
                </span>
              </td>
              <td>
                <span style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700;color:var(--color-accent)">
                  ${c.proposal_count || 0}
                </span>
              </td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn" style="font-size:11px;padding:4px 10px"
                    onclick="window.Clients.openView('${c.id}')">View</button>
                  <button class="btn" style="font-size:11px;padding:4px 10px"
                    onclick="window.Clients.openEdit('${c.id}')">Edit</button>
                  <button class="btn btn-danger" style="font-size:11px;padding:4px 10px"
                    onclick="window.Clients.deleteClient('${c.id}')">✕</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`}

    <!-- Add / Edit Modal -->
    <div class="modal-overlay" id="client-modal">
      <div class="modal" style="max-width:580px">
        <div class="modal-header">
          <div class="modal-title" id="client-modal-title">New Client</div>
          <button class="modal-close" onclick="window.Clients.closeModal()">✕</button>
        </div>
        <div id="client-modal-body"></div>
      </div>
    </div>

    <!-- View / History Modal -->
    <div class="modal-overlay" id="client-view-modal">
      <div class="modal" style="max-width:700px">
        <div class="modal-header">
          <div class="modal-title" id="client-view-title">Client Details</div>
          <button class="modal-close" onclick="document.getElementById('client-view-modal').classList.remove('open')">✕</button>
        </div>
        <div id="client-view-body"></div>
      </div>
    </div>`;
}

// ============================================================
// DATA
// ============================================================

async function fetchClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('company_name');
  if (error) { console.error('[Clients]', error); return []; }

  // Get project and proposal counts for each client
  const clients = data || [];
  const ids = clients.map(c => c.id);
  if (!ids.length) return clients;

  const [{ data: projects }, { data: proposals }] = await Promise.all([
    supabase.from('projects').select('client_id').in('client_id', ids),
    supabase.from('proposals').select('client_id').in('client_id', ids),
  ]);

  const projCount = {};
  const propCount = {};
  (projects || []).forEach(p => { projCount[p.client_id] = (projCount[p.client_id] || 0) + 1; });
  (proposals || []).forEach(p => { propCount[p.client_id] = (propCount[p.client_id] || 0) + 1; });

  return clients.map(c => ({
    ...c,
    project_count: projCount[c.id] || 0,
    proposal_count: propCount[c.id] || 0,
  }));
}

async function fetchClient(id) {
  const { data } = await supabase.from('clients').select('*').eq('id', id).single();
  return data;
}

// ============================================================
// ADD / EDIT FORM
// ============================================================

function clientForm(client) {
  const v = (field, def = '') => escH(client?.[field] || def);
  return `
    <div class="form-grid form-grid-2" style="gap:12px;margin-bottom:16px">
      <div class="form-field" style="grid-column:1/-1">
        <label class="form-label">Company Name *</label>
        <input class="form-input" id="cf-company" placeholder="e.g. Acme Events" value="${v('company_name')}">
      </div>
      <div class="form-field">
        <label class="form-label">Contact Name</label>
        <input class="form-input" id="cf-contact" placeholder="Jane Smith" value="${v('contact_name')}">
      </div>
      <div class="form-field">
        <label class="form-label">Contact Title</label>
        <input class="form-input" id="cf-title" placeholder="Event Director" value="${v('contact_title')}">
      </div>
      <div class="form-field">
        <label class="form-label">Email</label>
        <input class="form-input" id="cf-email" type="email" placeholder="jane@acmeevents.com" value="${v('email')}">
      </div>
      <div class="form-field">
        <label class="form-label">Phone</label>
        <input class="form-input" id="cf-phone" type="tel" placeholder="(555) 000-0000" value="${v('phone')}">
      </div>
      <div class="form-field" style="grid-column:1/-1">
        <label class="form-label">Address</label>
        <input class="form-input" id="cf-address" placeholder="123 Main St" value="${v('address')}">
      </div>
      <div class="form-field">
        <label class="form-label">City</label>
        <input class="form-input" id="cf-city" placeholder="Baltimore" value="${v('city')}">
      </div>
      <div class="form-field">
        <label class="form-label">State</label>
        <input class="form-input" id="cf-state" placeholder="MD" value="${v('state')}">
      </div>
      <div class="form-field">
        <label class="form-label">ZIP</label>
        <input class="form-input" id="cf-zip" placeholder="21201" value="${v('zip')}">
      </div>
      <div class="form-field">
        <label class="form-label">Website</label>
        <input class="form-input" id="cf-web" placeholder="https://..." value="${v('website')}">
      </div>
      <div class="form-field" style="grid-column:1/-1">
        <label class="form-label">Notes</label>
        <textarea class="form-input form-textarea" id="cf-notes" placeholder="Any notes about this client...">${escH(client?.notes || '')}</textarea>
      </div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="window.Clients.closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="window.Clients.saveClient('${client?.id || ''}')">
        ${client ? 'Save Changes' : 'Add Client'}
      </button>
    </div>
    <div id="client-form-msg" class="mok" style="margin-top:8px"></div>`;
}

function openAdd() {
  document.getElementById('client-modal-title').textContent = 'New Client';
  document.getElementById('client-modal-body').innerHTML = clientForm(null);
  document.getElementById('client-modal').classList.add('open');
  setTimeout(() => document.getElementById('cf-company')?.focus(), 80);
}

async function openEdit(id) {
  const client = await fetchClient(id);
  if (!client) return;
  document.getElementById('client-modal-title').textContent = 'Edit Client';
  document.getElementById('client-modal-body').innerHTML = clientForm(client);
  document.getElementById('client-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('client-modal').classList.remove('open');
}

async function saveClient(existingId) {
  const company = document.getElementById('cf-company')?.value.trim();
  if (!company) {
    const msg = document.getElementById('client-form-msg');
    if (msg) { msg.textContent = 'Company name is required.'; msg.style.color = 'var(--color-danger)'; }
    return;
  }

  const data = {
    company_name: company,
    contact_name: document.getElementById('cf-contact')?.value.trim() || '',
    contact_title: document.getElementById('cf-title')?.value.trim() || '',
    email: document.getElementById('cf-email')?.value.trim() || '',
    phone: document.getElementById('cf-phone')?.value.trim() || '',
    address: document.getElementById('cf-address')?.value.trim() || '',
    city: document.getElementById('cf-city')?.value.trim() || '',
    state: document.getElementById('cf-state')?.value.trim() || '',
    zip: document.getElementById('cf-zip')?.value.trim() || '',
    website: document.getElementById('cf-web')?.value.trim() || '',
    notes: document.getElementById('cf-notes')?.value.trim() || '',
  };

  let error;
  if (existingId) {
    ({ error } = await dbUpdate('clients', existingId, data));
  } else {
    data.created_by = getProfile().id;
    ({ error } = await dbInsert('clients', data));
  }

  if (error) {
    const msg = document.getElementById('client-form-msg');
    if (msg) { msg.textContent = 'Failed to save. Please try again.'; msg.style.color = 'var(--color-danger)'; }
    return;
  }

  await logActivity('client', existingId || 'new', existingId ? 'updated' : 'created', { company_name: company });
  closeModal();
  showToast(existingId ? 'Client updated!' : 'Client added!', 'success');
  window.navigateTo('clients');
}

async function deleteClient(id) {
  if (!confirm('Delete this client? This will not delete their projects or proposals.')) return;
  const { error } = await dbDelete('clients', id);
  if (error) { showToast('Failed to delete.', 'error'); return; }
  showToast('Client deleted.', 'success');
  window.navigateTo('clients');
}

// ============================================================
// CLIENT DETAIL VIEW
// ============================================================

async function openView(id) {
  const modal = document.getElementById('client-view-modal');
  const body = document.getElementById('client-view-body');
  const title = document.getElementById('client-view-title');
  body.innerHTML = `<div class="loading-state" style="padding:30px"><div class="spinner"></div></div>`;
  modal.classList.add('open');

  const [client, { data: projects }, { data: proposals }] = await Promise.all([
    fetchClient(id),
    supabase.from('projects').select('id,name,status,event_start_date,created_at').eq('client_id', id).order('created_at', { ascending: false }),
    supabase.from('proposals').select('id,title,status,total,created_at').eq('client_id', id).order('created_at', { ascending: false }),
  ]);

  if (!client) { body.innerHTML = `<div class="empty-state"><div class="empty-title">Client not found</div></div>`; return; }
  title.textContent = client.company_name;

  const statusTag = s => {
    const map = { draft:'tag-gray', sent:'tag-blue', approved:'tag-green', invoice:'tag-blue', paid:'tag-green', cancelled:'tag-red', planning:'tag-yellow', confirmed:'tag-blue', active:'tag-green', completed:'tag-gray' };
    return `<span class="tag ${map[s]||'tag-gray'}">${s}</span>`;
  };

  body.innerHTML = `
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:20px">
      ${client.contact_name ? `<div><div class="form-label">Contact</div><div style="margin-top:4px;font-weight:600">${escH(client.contact_name)}${client.contact_title?` <span class="text-muted text-small">— ${escH(client.contact_title)}</span>`:''}</div></div>` : ''}
      ${client.email ? `<div><div class="form-label">Email</div><div style="margin-top:4px"><a href="mailto:${escH(client.email)}" style="color:var(--color-accent-2)">${escH(client.email)}</a></div></div>` : ''}
      ${client.phone ? `<div><div class="form-label">Phone</div><div style="margin-top:4px"><a href="tel:${escH(client.phone)}" style="color:var(--color-accent-2)">${escH(client.phone)}</a></div></div>` : ''}
      ${client.city || client.state ? `<div><div class="form-label">Location</div><div style="margin-top:4px">${[client.address, client.city, client.state, client.zip].filter(Boolean).join(', ')}</div></div>` : ''}
      ${client.website ? `<div><div class="form-label">Website</div><div style="margin-top:4px"><a href="${escH(client.website)}" target="_blank" style="color:var(--color-accent-2)">${escH(client.website)}</a></div></div>` : ''}
    </div>
    ${client.notes ? `<div class="alert alert-ok" style="margin-bottom:16px"><strong>Notes:</strong> ${escH(client.notes)}</div>` : ''}

    <div class="tab-bar" style="margin-bottom:16px">
      <button class="tab-btn active" id="cvt-proposals" onclick="cvTab('proposals')">
        Proposals (${proposals?.length || 0})
      </button>
      <button class="tab-btn" id="cvt-projects" onclick="cvTab('projects')">
        Projects (${projects?.length || 0})
      </button>
    </div>

    <div class="tab-panel active" id="cvp-proposals">
      ${!proposals?.length
        ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No proposals yet</div></div>`
        : `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Title</th><th>Status</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>${proposals.map(p => `<tr>
              <td><strong>${escH(p.title)}</strong></td>
              <td>${statusTag(p.status)}</td>
              <td style="font-weight:600">${p.total ? '$' + Number(p.total).toFixed(2) : '—'}</td>
              <td class="text-small">${new Date(p.created_at).toLocaleDateString()}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
    </div>

    <div class="tab-panel" id="cvp-projects">
      ${!projects?.length
        ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No projects yet</div></div>`
        : `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Project</th><th>Status</th><th>Event Date</th></tr></thead>
            <tbody>${projects.map(p => `<tr>
              <td><strong>${escH(p.name)}</strong></td>
              <td>${statusTag(p.status)}</td>
              <td class="text-small">${p.event_start_date ? new Date(p.event_start_date + 'T00:00:00').toLocaleDateString() : '—'}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
    </div>

    <div style="display:flex;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--color-border-light)">
      <button class="btn btn-primary" onclick="document.getElementById('client-view-modal').classList.remove('open');window.Clients.openEdit('${client.id}')">Edit Client</button>
      <button class="btn btn-blue" onclick="sessionStorage.setItem('proposal_client_id','${client.id}');window.navigateTo('proposals')">+ New Proposal</button>
    </div>`;

  // Tab switcher scoped to this modal
  window.cvTab = name => {
    ['proposals','projects'].forEach(t => {
      document.getElementById('cvt-'+t)?.classList.toggle('active', t===name);
      document.getElementById('cvp-'+t)?.classList.toggle('active', t===name);
    });
  };
}

// ============================================================
// EXPORTED HELPERS (used by other modules)
// ============================================================

export async function getClientList() {
  const { data } = await supabase.from('clients').select('id,company_name,contact_name,email,phone').order('company_name');
  return data || [];
}

export async function getClient(id) {
  if (!id) return null;
  const { data } = await supabase.from('clients').select('*').eq('id', id).single();
  return data;
}

// ============================================================
// HELPERS
// ============================================================

function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showToast(msg, type='success') { window.showToast?.(msg, type); }

// ============================================================
// GLOBAL EXPOSURE
// ============================================================

window.Clients = {
  openAdd, openEdit, openView, closeModal, saveClient, deleteClient,
};
