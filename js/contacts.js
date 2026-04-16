// ============================================================
// contacts.js — Unified Contact Management (replaces clients)
// Clients · Vendors · Venues · Crew · Other
// Full CRM: notes, files, tasks, activity, COI tracking
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin } from './auth.js';

// ============================================================
// CONSTANTS
// ============================================================

const CONTACT_TYPES = ['client', 'vendor', 'venue', 'crew', 'other'];
const TYPE_LABELS = { client:'Client', vendor:'Vendor', venue:'Venue', crew:'Crew', other:'Other' };
const TYPE_COLORS = { client:'tag-blue', vendor:'tag-yellow', venue:'tag-green', crew:'tag-purple', other:'tag-gray' };

// ============================================================
// MAIN RENDER
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading contacts...</div></div>`;
  const contacts = await fetchContacts();
  renderContacts(container, contacts);
}

function renderContacts(container, contacts) {
  // Type filter counts
  const typeCounts = {};
  CONTACT_TYPES.forEach(t => typeCounts[t] = 0);
  contacts.forEach(c => (c.types||['client']).forEach(t => { if (typeCounts[t] !== undefined) typeCounts[t]++; }));

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Contacts</div>
        <div class="section-sub">${contacts.length} contact${contacts.length!==1?'s':''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="contact-search" placeholder="🔍 Search contacts..."
          style="width:220px;font-size:13px"
          oninput="window.Contacts.search(this.value)">
        <button class="btn-add" onclick="window.Contacts.openAdd()">+ New Contact</button>
      </div>
    </div>

    <!-- Type filter tabs -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
      <button class="seg-btn active" data-filter="all" onclick="window.Contacts.filterType('all',this)">
        All (${contacts.length})
      </button>
      ${CONTACT_TYPES.filter(t => typeCounts[t] > 0).map(t => `
        <button class="seg-btn" data-filter="${t}" onclick="window.Contacts.filterType('${t}',this)">
          ${TYPE_LABELS[t]} (${typeCounts[t]})
        </button>`).join('')}
    </div>

    <!-- Contact cards grid -->
    <div class="card-grid" id="contacts-grid">
      ${!contacts.length
        ? `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">👥</div><div class="empty-title">No contacts yet</div><p class="empty-sub">Add your first contact to get started.</p></div>`
        : contacts.map(c => contactCard(c)).join('')}
    </div>

    <!-- ADD / EDIT MODAL -->
    <div class="modal-overlay" id="contact-modal">
      <div class="modal" style="max-width:620px">
        <div class="modal-header">
          <div class="modal-title" id="contact-modal-title">New Contact</div>
          <button class="modal-close" onclick="window.Contacts.closeModal()">✕</button>
        </div>
        <div id="contact-modal-body"></div>
      </div>
    </div>`;
}

function contactCard(c) {
  const types = c.types || ['client'];
  const coiExpired = c.coi_expiry && new Date(c.coi_expiry) < new Date();
  const coiExpiringSoon = c.coi_expiry && !coiExpired && new Date(c.coi_expiry) < new Date(Date.now() + 30*24*60*60*1000);

  return `<div class="project-card" data-types="${types.join(',')}" data-name="${escH((c.company_name||'').toLowerCase())} ${escH((c.contact_name||'').toLowerCase())}">
    <!-- Type badges -->
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
      ${types.map(t => `<span class="tag ${TYPE_COLORS[t]||'tag-gray'}" style="font-size:10px">${TYPE_LABELS[t]||t}</span>`).join('')}
    </div>

    <div style="font-family:'Barlow',sans-serif;font-size:17px;font-weight:700;margin-bottom:2px">${escH(c.company_name)}</div>
    ${c.contact_name ? `<div style="font-size:13px;color:var(--color-muted);margin-bottom:6px">${escH(c.contact_name)}${c.contact_title?` · ${escH(c.contact_title)}`:''}</div>` : ''}

    <div class="text-small text-muted" style="line-height:1.8">
      ${c.email ? `✉ <a href="mailto:${escH(c.email)}" style="color:var(--color-accent-2)" onclick="event.stopPropagation()">${escH(c.email)}</a><br>` : ''}
      ${c.phone ? `📞 ${escH(c.phone)}<br>` : ''}
      ${c.city || c.state ? `📍 ${[c.city,c.state].filter(Boolean).join(', ')}<br>` : ''}
    </div>

    ${c.coi_on_file ? `
      <div style="margin-top:8px">
        <span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;
          background:${coiExpired?'#fef2f2':coiExpiringSoon?'#fffbeb':'#f0fdf4'};
          color:${coiExpired?'#dc2626':coiExpiringSoon?'#d97706':'#166534'}">
          ${coiExpired?'⚠ COI Expired':coiExpiringSoon?'⚠ COI Expiring Soon':'✓ COI on File'}
          ${c.coi_expiry?` · ${fmtDate(c.coi_expiry)}`:''}
        </span>
      </div>` : ''}

    <div style="display:flex;gap:6px;margin-top:12px;padding-top:11px;border-top:1px solid var(--color-border-light);flex-wrap:wrap">
      <button class="btn btn-primary" style="font-size:12px;padding:6px 13px" onclick="window.Contacts.openContact('${c.id}')">Open</button>
      <button class="btn" style="font-size:12px;padding:6px 13px" onclick="window.Contacts.openEdit('${c.id}')">Edit</button>
      <button class="btn btn-danger" style="font-size:12px;padding:6px 13px" onclick="window.Contacts.deleteContact('${c.id}')">Delete</button>
    </div>
  </div>`;
}

// ============================================================
// FILTER / SEARCH
// ============================================================

function filterType(type, btn) {
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === type));
  document.querySelectorAll('#contacts-grid .project-card').forEach(card => {
    const types = card.dataset.types?.split(',') || [];
    card.style.display = (type === 'all' || types.includes(type)) ? '' : 'none';
  });
}

function search(query) {
  const q = query.toLowerCase().trim();
  const activeType = document.querySelector('[data-filter].active')?.dataset.filter || 'all';
  document.querySelectorAll('#contacts-grid .project-card').forEach(card => {
    const nameMatch = card.dataset.name?.includes(q);
    const types = card.dataset.types?.split(',') || [];
    const typeMatch = activeType === 'all' || types.includes(activeType);
    card.style.display = nameMatch && typeMatch ? '' : 'none';
  });
}

// ============================================================
// DATA
// ============================================================

async function fetchContacts() {
  const { data, error } = await supabase.from('contacts').select('*').order('company_name');
  if (error) { console.error('[Contacts]', error); return []; }
  return data || [];
}

async function fetchContact(id) {
  const { data } = await supabase.from('contacts').select('*').eq('id', id).single();
  return data;
}

// ============================================================
// ADD / EDIT FORM
// ============================================================

function contactForm(c) {
  const v = (f, def='') => escH(String(c?.[f] ?? def));
  const types = c?.types || ['client'];

  return `
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Contact Type</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${CONTACT_TYPES.map(t => `
        <label style="display:flex;align-items:center;gap:6px;background:#f9fafb;border:1.5px solid ${types.includes(t)?'var(--color-accent-2)':'var(--color-border-light)'};border-radius:6px;padding:7px 12px;cursor:pointer;font-size:13px;font-weight:500;transition:all .1s">
          <input type="checkbox" name="contact-type" value="${t}" ${types.includes(t)?'checked':''}
            onchange="window.Contacts._updateTypeBorder(this)">
          ${TYPE_LABELS[t]}
        </label>`).join('')}
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Basic Info</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:16px">
      <div class="form-field" style="grid-column:1/-1">
        <label class="form-label">Company / Organization Name *</label>
        <input class="form-input" id="cf-company" value="${v('company_name')}" placeholder="Acme Events">
      </div>
      <div class="form-field">
        <label class="form-label">Contact Name</label>
        <input class="form-input" id="cf-contact" value="${v('contact_name')}" placeholder="Jane Smith">
      </div>
      <div class="form-field">
        <label class="form-label">Title</label>
        <input class="form-input" id="cf-title" value="${v('contact_title')}" placeholder="Event Director">
      </div>
      <div class="form-field">
        <label class="form-label">Email</label>
        <input class="form-input" id="cf-email" type="email" value="${v('email')}" placeholder="jane@acme.com">
      </div>
      <div class="form-field">
        <label class="form-label">Phone</label>
        <input class="form-input" id="cf-phone" type="tel" value="${v('phone')}" placeholder="(555) 000-0000">
      </div>
      <div class="form-field" style="grid-column:1/-1">
        <label class="form-label">Address</label>
        <input class="form-input" id="cf-address" value="${v('address')}" placeholder="123 Main St">
      </div>
      <div class="form-field">
        <label class="form-label">City</label>
        <input class="form-input" id="cf-city" value="${v('city')}" placeholder="Baltimore">
      </div>
      <div class="form-field">
        <label class="form-label">State</label>
        <input class="form-input" id="cf-state" value="${v('state')}" placeholder="MD">
      </div>
      <div class="form-field">
        <label class="form-label">ZIP</label>
        <input class="form-input" id="cf-zip" value="${v('zip')}" placeholder="21201">
      </div>
      <div class="form-field">
        <label class="form-label">Website</label>
        <input class="form-input" id="cf-web" value="${v('website')}" placeholder="https://...">
      </div>
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">COI (Certificate of Insurance)</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:16px">
      <div class="form-field" style="display:flex;align-items:center;gap:10px;padding-top:6px">
        <input type="checkbox" id="cf-coi" ${c?.coi_on_file?'checked':''} style="width:16px;height:16px">
        <label for="cf-coi" style="font-size:13px;font-weight:500;cursor:pointer">COI on file</label>
      </div>
      <div class="form-field">
        <label class="form-label">COI Expiry Date</label>
        <input class="form-input" id="cf-coi-expiry" type="date" value="${v('coi_expiry')}">
      </div>
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Notes</div>
    <div class="form-field" style="margin-bottom:16px">
      <textarea class="form-input form-textarea" id="cf-notes" rows="3"
        placeholder="Any notes about this contact...">${escH(c?.notes||'')}</textarea>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="window.Contacts.closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="window.Contacts.saveContact('${c?.id||''}')">
        ${c ? 'Save Changes' : 'Add Contact'}
      </button>
    </div>
    <div id="contact-form-msg" class="mok" style="margin-top:8px"></div>`;
}

function _updateTypeBorder(checkbox) {
  const label = checkbox.closest('label');
  if (label) label.style.borderColor = checkbox.checked ? 'var(--color-accent-2)' : 'var(--color-border-light)';
}

function openAdd() {
  document.getElementById('contact-modal-title').textContent = 'New Contact';
  document.getElementById('contact-modal-body').innerHTML = contactForm(null);
  document.getElementById('contact-modal').classList.add('open');
  setTimeout(() => document.getElementById('cf-company')?.focus(), 80);
}

async function openEdit(id) {
  const contact = await fetchContact(id);
  if (!contact) return;
  document.getElementById('contact-modal-title').textContent = 'Edit Contact';
  document.getElementById('contact-modal-body').innerHTML = contactForm(contact);
  document.getElementById('contact-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('contact-modal').classList.remove('open');
}

async function saveContact(existingId) {
  const company = _v('cf-company');
  if (!company) { _msg('contact-form-msg', 'Company name is required.', true); return; }

  // Collect selected types
  const types = [...document.querySelectorAll('input[name="contact-type"]:checked')].map(cb => cb.value);
  if (!types.length) types.push('other');

  const data = {
    company_name: company,
    contact_name: _v('cf-contact'),
    contact_title: _v('cf-title'),
    email: _v('cf-email'),
    phone: _v('cf-phone'),
    address: _v('cf-address'),
    city: _v('cf-city'),
    state: _v('cf-state'),
    zip: _v('cf-zip'),
    website: _v('cf-web'),
    types,
    coi_on_file: document.getElementById('cf-coi')?.checked || false,
    coi_expiry: _v('cf-coi-expiry') || null,
    notes: _v('cf-notes'),
  };

  let error;
  if (existingId) {
    ({ error } = await dbUpdate('contacts', existingId, data));
  } else {
    data.created_by = getProfile().id;
    ({ error } = await dbInsert('contacts', data));
  }

  if (error) { _msg('contact-form-msg', 'Failed to save.', true); console.error(error); return; }
  await logActivity('contact', existingId||'new', existingId?'updated':'created', { name: company });
  closeModal();
  showToast(existingId ? 'Contact updated!' : 'Contact added!', 'success');
  window.navigateTo('contacts');
}

async function deleteContact(id) {
  if (!confirm('Delete this contact? This will not delete linked proposals or projects.')) return;
  await dbDelete('contacts', id);
  showToast('Contact deleted.', 'success');
  window.navigateTo('contacts');
}

// ============================================================
// CONTACT DETAIL VIEW — full CRM
// ============================================================

let _currentContact = null;

async function openContact(id) {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading...</div></div>`;
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));

  const contact = await fetchContact(id);
  if (!contact) { mc.innerHTML = `<div class="empty-state"><div class="empty-title">Contact not found</div></div>`; return; }
  _currentContact = contact;
  _renderContactView(mc);
}

function _renderContactView(mc) {
  const c = _currentContact;
  const types = c.types || ['client'];
  const coiExpired = c.coi_expiry && new Date(c.coi_expiry) < new Date();
  const coiExpiringSoon = c.coi_expiry && !coiExpired && new Date(c.coi_expiry) < new Date(Date.now() + 30*24*60*60*1000);

  mc.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <button class="btn" onclick="window.navigateTo('contacts')" style="font-size:12px;padding:5px 11px">← Contacts</button>
          ${types.map(t => `<span class="tag ${TYPE_COLORS[t]||'tag-gray'}">${TYPE_LABELS[t]||t}</span>`).join('')}
        </div>
        <div style="font-family:'Barlow',sans-serif;font-size:24px;font-weight:800">${escH(c.company_name)}</div>
        ${c.contact_name ? `<div style="font-size:14px;color:var(--color-muted);margin-top:2px">${escH(c.contact_name)}${c.contact_title?` · ${escH(c.contact_title)}`:''}</div>` : ''}
        <div class="text-small text-muted" style="margin-top:4px">
          ${c.email?`✉ ${escH(c.email)} · `:''}${c.phone?`📞 ${escH(c.phone)}`:''}
          ${c.city||c.state?`<br>📍 ${[c.address,c.city,c.state,c.zip].filter(Boolean).join(', ')}`:''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="window.Contacts.openEdit('${c.id}')">Edit</button>
        <button class="btn btn-primary" onclick="window.Contacts.openNewProposal('${c.id}')">+ New Proposal</button>
      </div>
    </div>

    <!-- COI alert if needed -->
    ${coiExpired ? `<div class="alert alert-warn" style="margin-bottom:16px">⚠ COI expired on ${fmtDate(c.coi_expiry)}. Request an updated certificate before proceeding with new work.</div>` : ''}
    ${coiExpiringSoon ? `<div class="alert alert-warn" style="margin-bottom:16px">⚠ COI expires ${fmtDate(c.coi_expiry)} — expiring within 30 days.</div>` : ''}

    <!-- Summary cards -->
    <div class="summary-grid" style="margin-bottom:20px" id="contact-summary"></div>

    <!-- COI card -->
    <div class="card" style="margin-bottom:16px;padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700">Certificate of Insurance</div>
        <button class="btn" style="font-size:11px;padding:4px 9px" onclick="window.Contacts.editCOI('${c.id}')">Update COI</button>
      </div>
      <div style="margin-top:8px;font-size:13px">
        ${c.coi_on_file
          ? `<span style="color:${coiExpired?'#dc2626':coiExpiringSoon?'#d97706':'#166534'};font-weight:600">
              ${coiExpired?'⚠ Expired':'✓ On file'}
            </span>
            ${c.coi_expiry?` · Expires ${fmtDate(c.coi_expiry)}`:'— no expiry date set'}`
          : `<span style="color:var(--color-muted)">No COI on file</span>`}
      </div>
    </div>

    <!-- Tabs -->
    <div class="tab-bar">
      <button class="tab-btn active" id="ct-activity" onclick="window.Contacts.showTab('activity')">Activity</button>
      <button class="tab-btn" id="ct-proposals" onclick="window.Contacts.showTab('proposals')">Proposals</button>
      <button class="tab-btn" id="ct-projects" onclick="window.Contacts.showTab('projects')">Projects</button>
      <button class="tab-btn" id="ct-tasks" onclick="window.Contacts.showTab('tasks')">Tasks</button>
      <button class="tab-btn" id="ct-files" onclick="window.Contacts.showTab('files')">Files</button>
    </div>

    <div class="tab-panel active" id="cp-activity">${_activityShell()}</div>
    <div class="tab-panel" id="cp-proposals"><div id="cp-proposals-body"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div></div>
    <div class="tab-panel" id="cp-projects"><div id="cp-projects-body"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div></div>
    <div class="tab-panel" id="cp-tasks">${_tasksShell()}</div>
    <div class="tab-panel" id="cp-files">${_filesShell()}</div>

    <!-- COI edit modal -->
    <div class="modal-overlay" id="coi-modal">
      <div class="modal" style="max-width:420px">
        <div class="modal-header"><div class="modal-title">Update COI</div>
          <button class="modal-close" onclick="document.getElementById('coi-modal').classList.remove('open')">✕</button></div>
        <div class="form-field" style="margin-bottom:12px;display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="coi-onfile" ${c.coi_on_file?'checked':''} style="width:16px;height:16px">
          <label for="coi-onfile" style="font-size:13px;font-weight:500;cursor:pointer">COI on file</label>
        </div>
        <div class="form-field" style="margin-bottom:16px">
          <label class="form-label">Expiry Date</label>
          <input class="form-input" id="coi-expiry" type="date" value="${c.coi_expiry||''}">
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn" onclick="document.getElementById('coi-modal').classList.remove('open')">Cancel</button>
          <button class="btn btn-primary" onclick="window.Contacts.saveCOI('${c.id}')">Save</button>
        </div>
      </div>
    </div>`;

  // Load summary counts and activity
  _loadSummary();
  _loadActivity();
}

function showTab(name) {
  ['activity','proposals','projects','tasks','files'].forEach(t => {
    document.getElementById('ct-'+t)?.classList.toggle('active', t===name);
    document.getElementById('cp-'+t)?.classList.toggle('active', t===name);
  });
  if (name === 'proposals') _loadProposals();
  if (name === 'projects')  _loadProjects();
  if (name === 'tasks')     _loadTasks();
  if (name === 'files')     _loadFiles();
}

// ── SUMMARY ──────────────────────────────────────────────────

async function _loadSummary() {
  const el = document.getElementById('contact-summary'); if (!el) return;
  const c = _currentContact;

  const [{ data: proposals }, { data: projects }] = await Promise.all([
    supabase.from('proposals').select('id,status,total').or(`client_id.eq.${c.id},contact_id.eq.${c.id}`),
    supabase.from('projects').select('id,status').or(`client_id.eq.${c.id},contact_id.eq.${c.id}`),
  ]);

  const totalRevenue = (proposals||[]).filter(p => p.status === 'paid').reduce((a, p) => a + (p.total||0), 0);
  const activeProjects = (projects||[]).filter(p => p.status === 'active').length;

  el.innerHTML = `
    <div class="summary-card"><div class="summary-card-label">Total Proposals</div><div class="summary-card-value">${proposals?.length||0}</div></div>
    <div class="summary-card"><div class="summary-card-label">Total Projects</div><div class="summary-card-value">${projects?.length||0}</div></div>
    <div class="summary-card"><div class="summary-card-label">Active Projects</div><div class="summary-card-value" style="color:var(--color-ok)">${activeProjects}</div></div>
    <div class="summary-card"><div class="summary-card-label">Total Revenue</div><div class="summary-card-value" style="color:var(--color-ok)">$${totalRevenue.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>`;
}

// ── ACTIVITY ─────────────────────────────────────────────────

function _activityShell() {
  return `
    <div class="card" style="margin-bottom:14px">
      <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Log Activity</div>
      <select class="form-select" id="ca-type" style="max-width:200px;margin-bottom:8px">
        <option value="note">📝 Note</option>
        <option value="call">📞 Call</option>
        <option value="email">✉ Email</option>
        <option value="meeting">🤝 Meeting</option>
      </select>
      <textarea class="form-input form-textarea" id="ca-body" placeholder="What happened? Notes from a call, email summary, meeting notes..." rows="3"></textarea>
      <button class="btn btn-primary" style="margin-top:10px" onclick="window.Contacts.logActivity()">Log</button>
    </div>
    <div id="contact-activity-tl"></div>`;
}

async function _loadActivity() {
  const el = document.getElementById('contact-activity-tl'); if (!el) return;
  const { data: acts } = await supabase.from('contact_activity')
    .select('*,profiles!contact_activity_performed_by_fkey(first_name,last_name)')
    .eq('contact_id', _currentContact.id)
    .order('created_at', { ascending: false });
  const icons = { note:'📝', call:'📞', email:'✉', meeting:'🤝' };
  el.innerHTML = !acts?.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No activity yet</div></div>`
    : `<div style="display:flex;flex-direction:column;gap:8px">${acts.map(a=>`
        <div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px 14px;display:flex;gap:12px">
          <div style="font-size:20px;flex-shrink:0">${icons[a.type]||'📝'}</div>
          <div style="flex:1">
            <div style="font-size:13px;line-height:1.6">${escH(a.body)}</div>
            <div class="text-small text-muted" style="margin-top:4px">${a.profiles?`${a.profiles.first_name} ${a.profiles.last_name} · `:''}${new Date(a.created_at).toLocaleString()}</div>
          </div>
        </div>`).join('')}</div>`;
}

async function logActivity() {
  const type = document.getElementById('ca-type')?.value || 'note';
  const body = document.getElementById('ca-body')?.value.trim();
  if (!body) { showToast('Please enter activity details.', 'error'); return; }
  await supabase.from('contact_activity').insert({ contact_id: _currentContact.id, type, body, performed_by: getProfile().id });
  document.getElementById('ca-body').value = '';
  showToast('Logged!', 'success');
  _loadActivity();
}

// ── PROPOSALS ────────────────────────────────────────────────

async function _loadProposals() {
  const el = document.getElementById('cp-proposals-body'); if (!el) return;
  const c = _currentContact;
  const { data: proposals } = await supabase.from('proposals')
    .select('id,title,status,total,created_at')
    .or(`client_id.eq.${c.id},contact_id.eq.${c.id}`)
    .order('created_at', { ascending: false });

  const sc = { draft:'tag-gray', sent:'tag-blue', approved:'tag-green', invoice:'tag-blue', deposit_pending:'tag-yellow', paid:'tag-green', cancelled:'tag-red', changes_requested:'tag-yellow' };

  el.innerHTML = !proposals?.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No proposals yet</div>
        <button class="btn btn-primary" style="margin-top:12px" onclick="window.Contacts.openNewProposal('${c.id}')">+ New Proposal</button></div>`
    : `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Title</th><th>Status</th><th>Total</th><th>Date</th><th></th></tr></thead>
        <tbody>${proposals.map(p=>`<tr>
          <td><strong>${escH(p.title)}</strong></td>
          <td><span class="tag ${sc[p.status]||'tag-gray'}">${p.status}</span></td>
          <td style="font-weight:600">${p.total?'$'+Number(p.total).toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td>
          <td class="text-small">${new Date(p.created_at).toLocaleDateString()}</td>
          <td><button class="btn" style="font-size:11px;padding:4px 9px"
            onclick="window.navigateTo('proposals');setTimeout(()=>window.Proposals?.openProposal?.('${p.id}'),300)">Open</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
}

// ── PROJECTS ─────────────────────────────────────────────────

async function _loadProjects() {
  const el = document.getElementById('cp-projects-body'); if (!el) return;
  const c = _currentContact;
  const { data: projects } = await supabase.from('projects')
    .select('id,name,status,event_start_date,created_at')
    .or(`client_id.eq.${c.id},contact_id.eq.${c.id}`)
    .order('created_at', { ascending: false });

  const sc = { planning:'tag-yellow', confirmed:'tag-blue', active:'tag-green', completed:'tag-gray', cancelled:'tag-red' };

  el.innerHTML = !projects?.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No projects yet</div></div>`
    : `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Project</th><th>Status</th><th>Event Date</th><th></th></tr></thead>
        <tbody>${projects.map(p=>`<tr>
          <td><strong>${escH(p.name)}</strong></td>
          <td><span class="tag ${sc[p.status]||'tag-gray'}">${p.status}</span></td>
          <td class="text-small">${p.event_start_date?fmtDate(p.event_start_date):'—'}</td>
          <td><button class="btn" style="font-size:11px;padding:4px 9px"
            onclick="window.navigateTo('projects');setTimeout(()=>window.Projects?.openProject?.('${p.id}'),300)">Open</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
}

// ── TASKS ────────────────────────────────────────────────────

function _tasksShell() {
  return `
    <div style="margin-bottom:12px"><button class="btn-add" onclick="window.Contacts.addTask()">+ Add Task</button></div>
    <div id="contact-tasks-wrap"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div>`;
}

async function _loadTasks() {
  const el = document.getElementById('contact-tasks-wrap'); if (!el) return;
  const { data: tasks } = await supabase.from('tasks')
    .select('*').ilike('description', `%contact:${_currentContact.id}%`)
    .order('due_date', { ascending: true, nullsFirst: false });

  const pc = { low:'#6b7280', medium:'#2563eb', high:'#d97706', urgent:'#dc2626' };

  el.innerHTML = !tasks?.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No tasks yet</div></div>`
    : `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th>Due</th><th></th></tr></thead>
        <tbody>${tasks.map(t=>`<tr>
          <td><strong>${escH(t.title)}</strong></td>
          <td><span style="color:${pc[t.priority]||'#6b7280'};font-weight:600;font-size:11px;text-transform:uppercase">${t.priority}</span></td>
          <td><span class="tag ${t.status==='done'?'tag-green':t.status==='in_progress'?'tag-blue':'tag-gray'}">${t.status.replace('_',' ')}</span></td>
          <td class="text-small">${t.due_date?fmtDate(t.due_date):'—'}</td>
          <td>${t.status!=='done'?`<button class="btn btn-green" style="font-size:11px;padding:4px 9px" onclick="window.Contacts._markTaskDone('${t.id}')">✓</button>`:''}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
}

async function addTask() {
  const m = document.createElement('div'); m.className = 'modal-overlay open';
  m.innerHTML = `<div class="modal" style="max-width:480px">
    <div class="modal-header"><div class="modal-title">Add Task</div>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-field" style="margin-bottom:12px"><label class="form-label">Title *</label>
      <input class="form-input" id="ct-title" placeholder="e.g. Send contract, Follow up on payment"></div>
    <div class="form-field" style="margin-bottom:12px"><label class="form-label">Description</label>
      <textarea class="form-input form-textarea" id="ct-desc" rows="2" placeholder="More details..."></textarea></div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
      <div class="form-field"><label class="form-label">Due Date</label><input class="form-input" id="ct-due" type="date"></div>
      <div class="form-field"><label class="form-label">Priority</label>
        <select class="form-select" id="ct-pri">
          <option value="low">Low</option><option value="medium" selected>Medium</option>
          <option value="high">High</option><option value="urgent">Urgent</option>
        </select></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="window.Contacts._saveTask(this)">Add Task</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}

async function _saveTask(btn) {
  const title = document.getElementById('ct-title')?.value.trim();
  if (!title) { showToast('Title required.', 'error'); return; }
  const profile = getProfile();
  await supabase.from('tasks').insert({
    title,
    description: `contact:${_currentContact.id}\n${document.getElementById('ct-desc')?.value.trim()||''}`,
    due_date: document.getElementById('ct-due')?.value || null,
    priority: document.getElementById('ct-pri')?.value || 'medium',
    status: 'todo',
    assigned_to: profile.id,
    created_by: profile.id,
  });
  btn.closest('.modal-overlay').remove();
  showToast('Task added!', 'success');
  _loadTasks();
}

async function _markTaskDone(id) {
  await supabase.from('tasks').update({ status:'done', completed_at:new Date().toISOString() }).eq('id', id);
  showToast('Done!', 'success');
  _loadTasks();
}

// ── FILES ────────────────────────────────────────────────────

function _filesShell() {
  return `
    <div style="margin-bottom:12px;display:flex;gap:8px">
      <select class="form-select" id="file-cat-filter" style="font-size:12px;max-width:180px"
        onchange="window.Contacts._filterFiles(this.value)">
        <option value="">All Categories</option>
        <option value="contract">Contracts</option>
        <option value="coi">COI</option>
        <option value="invoice">Invoices</option>
        <option value="general">General</option>
      </select>
      <button class="btn-add" onclick="document.getElementById('contact-file-input').click()">+ Upload File</button>
      <input type="file" id="contact-file-input" multiple style="display:none"
        onchange="window.Contacts.uploadFiles()">
    </div>
    <div id="contact-files-wrap"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div>`;
}

async function _loadFiles() {
  const el = document.getElementById('contact-files-wrap'); if (!el) return;
  const { data: files } = await supabase.from('contact_files')
    .select('*,profiles!contact_files_uploaded_by_fkey(first_name,last_name)')
    .eq('contact_id', _currentContact.id)
    .order('created_at', { ascending: false });

  const icon = t => t?.includes('image')?'🖼':t?.includes('pdf')?'📄':'📁';
  const catLabels = { contract:'Contract', coi:'COI', invoice:'Invoice', general:'General' };

  el.innerHTML = !files?.length
    ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No files uploaded yet</div><p class="empty-sub">Upload contracts, COIs, invoices, and other documents.</p></div>`
    : `<div style="display:flex;flex-direction:column;gap:8px" id="files-list">
        ${files.map(f=>`<div class="file-row" data-cat="${f.category||'general'}"
          style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px">
          <span style="font-size:22px">${icon(f.file_type)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(f.file_name)}</div>
            <div class="text-small text-muted">${catLabels[f.category]||'General'} · ${f.profiles?f.profiles.first_name+' '+f.profiles.last_name:''} · ${new Date(f.created_at).toLocaleDateString()}</div>
          </div>
          <div style="display:flex;gap:6px">
            <a href="${f.storage_url}" target="_blank" class="btn" style="font-size:11px;padding:4px 9px">⬇</a>
            <button class="btn btn-danger" style="font-size:11px;padding:4px 9px"
              onclick="window.Contacts.deleteFile('${f.id}','${escH(f.storage_path)}')">✕</button>
          </div>
        </div>`).join('')}
      </div>`;
}

function _filterFiles(cat) {
  document.querySelectorAll('.file-row').forEach(row => {
    row.style.display = (!cat || row.dataset.cat === cat) ? '' : 'none';
  });
}

async function uploadFiles() {
  const input = document.getElementById('contact-file-input');
  const files = input?.files; if (!files?.length) return;
  const profile = getProfile();

  // Ask for category
  const cat = prompt('File category: contract, coi, invoice, or general', 'general') || 'general';
  let uploaded = 0;

  for (const file of files) {
    const path = `contacts/${_currentContact.id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from('project-files').upload(path, file, { upsert: false });
    if (upErr) { console.error(upErr); continue; }
    const { data: { publicUrl } } = supabase.storage.from('project-files').getPublicUrl(path);
    await dbInsert('contact_files', {
      contact_id: _currentContact.id, uploaded_by: profile.id,
      file_name: file.name, file_type: file.type, file_size: file.size,
      storage_path: path, storage_url: publicUrl, category: cat,
    });
    uploaded++;
  }

  if (uploaded) { showToast(`${uploaded} file${uploaded!==1?'s':''} uploaded!`, 'success'); _loadFiles(); }
}

async function deleteFile(id, storagePath) {
  if (!confirm('Delete this file?')) return;
  await supabase.storage.from('project-files').remove([storagePath]);
  await dbDelete('contact_files', id);
  showToast('Deleted.', 'success');
  _loadFiles();
}

// ── COI ──────────────────────────────────────────────────────

function editCOI(id) {
  document.getElementById('coi-modal').classList.add('open');
}

async function saveCOI(id) {
  const coi_on_file = document.getElementById('coi-onfile')?.checked || false;
  const coi_expiry = document.getElementById('coi-expiry')?.value || null;
  await supabase.from('contacts').update({ coi_on_file, coi_expiry }).eq('id', id);
  _currentContact.coi_on_file = coi_on_file;
  _currentContact.coi_expiry = coi_expiry;
  document.getElementById('coi-modal').classList.remove('open');
  showToast('COI updated!', 'success');
  _renderContactView(document.getElementById('main-content'));
}

// ── NEW PROPOSAL SHORTCUT ────────────────────────────────────

function openNewProposal(contactId) {
  sessionStorage.setItem('proposal_client_id', contactId);
  window.navigateTo('proposals');
}

// ============================================================
// EXPORTED HELPERS (used by other modules)
// ============================================================

export async function getContactList() {
  const { data } = await supabase.from('contacts').select('id,company_name,contact_name,email,phone,types').order('company_name');
  return data || [];
}

export async function getContact(id) {
  if (!id) return null;
  const { data } = await supabase.from('contacts').select('*').eq('id', id).single();
  return data;
}

// ============================================================
// HELPERS
// ============================================================

const _v = id => document.getElementById(id)?.value?.trim() || '';
function _msg(id,msg,err=false){const el=document.getElementById(id);if(!el)return;el.textContent=msg;el.style.color=err?'var(--color-danger)':'var(--color-ok)';}
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(d){if(!d)return'';return new Date(d+'T00:00:00').toLocaleDateString();}
function showToast(msg,type='success'){window.showToast?.(msg,type);}

// ============================================================
// GLOBAL EXPOSURE
// ============================================================

window.Contacts = {
  openAdd, openEdit, openContact, closeModal, saveContact, deleteContact,
  filterType, search, showTab,
  logActivity, addTask, _saveTask, _markTaskDone,
  uploadFiles, deleteFile, _filterFiles,
  editCOI, saveCOI, openNewProposal,
  _updateTypeBorder,
};
