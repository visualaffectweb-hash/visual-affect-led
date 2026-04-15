// ============================================================
// admin.js — Admin Panel
// Settings · Users · Vendors · Task Templates · Audit Log
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin } from './auth.js';

// ============================================================
// MAIN RENDER
// ============================================================

let _adminSection = 'settings';

export async function render(container) {
  if (!isAdmin()) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Admin Only</div><p class="empty-sub">You need administrator access to view this section.</p></div>`;
    return;
  }
  container.innerHTML = _shell();
  await _loadSection('settings');
}

function _shell() {
  return `
    <div style="display:flex;gap:0;min-height:calc(100vh - 120px)">

      <!-- Admin sidebar -->
      <div style="width:200px;flex-shrink:0;background:#fff;border-right:1.5px solid var(--color-border-light);border-radius:10px 0 0 10px;padding:16px 0">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--color-muted);padding:0 16px;margin-bottom:10px">Admin</div>
        ${[
          { id:'settings',   icon:'⚙',  label:'Settings' },
          { id:'users',      icon:'👤', label:'Users' },
          { id:'vendors',    icon:'🏭', label:'Vendors' },
          { id:'templates',  icon:'📋', label:'Task Templates' },
          { id:'audit',      icon:'📜', label:'Audit Log' },
        ].map(s => `
          <div class="admin-nav-item ${_adminSection===s.id?'active':''}" id="an-${s.id}"
            onclick="window.Admin.loadSection('${s.id}')"
            style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:500;transition:background .1s;${_adminSection===s.id?'background:#f0f9ff;color:var(--color-accent-2);border-right:3px solid var(--color-accent-2);':'color:var(--color-text);'}">
            <span>${s.icon}</span> ${s.label}
          </div>`).join('')}
      </div>

      <!-- Admin content area -->
      <div style="flex:1;padding:24px;background:#fff;border-radius:0 10px 10px 0;border:1.5px solid var(--color-border-light);border-left:none;min-width:0" id="admin-content">
        <div class="loading-state"><div class="spinner"></div></div>
      </div>
    </div>`;
}

async function loadSection(section) {
  _adminSection = section;
  // Update nav active state
  document.querySelectorAll('.admin-nav-item').forEach(el => {
    const isActive = el.id === `an-${section}`;
    el.style.background = isActive ? '#f0f9ff' : '';
    el.style.color = isActive ? 'var(--color-accent-2)' : 'var(--color-text)';
    el.style.borderRight = isActive ? '3px solid var(--color-accent-2)' : '';
    el.classList.toggle('active', isActive);
  });
  await _loadSection(section);
}

async function _loadSection(section) {
  const el = document.getElementById('admin-content');
  if (!el) return;
  el.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
  switch (section) {
    case 'settings':  el.innerHTML = await _settingsPage(); break;
    case 'users':     el.innerHTML = await _usersPage(); break;
    case 'vendors':   el.innerHTML = await _vendorsPage(); break;
    case 'templates': el.innerHTML = await _templatesPage(); break;
    case 'audit':     el.innerHTML = await _auditPage(); break;
  }
}

// ============================================================
// SETTINGS
// ============================================================

async function _settingsPage() {
  const { data: settings } = await supabase.from('settings').select('*').eq('id', 1).single();
  const s = settings || {};
  return `
    <div style="max-width:560px">
      <div style="font-family:'Barlow',sans-serif;font-size:20px;font-weight:800;margin-bottom:4px">Settings</div>
      <div class="text-small text-muted" style="margin-bottom:24px">Company-wide configuration</div>

      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:12px">Company Info</div>
      <div class="form-grid form-grid-2" style="gap:12px;margin-bottom:20px">
        <div class="form-field" style="grid-column:1/-1">
          <label class="form-label">Company Name</label>
          <input class="form-input" id="s-company" value="${escH(s.company_name||'Visual Affect')}">
        </div>
        <div class="form-field">
          <label class="form-label">Contact Email</label>
          <input class="form-input" id="s-email" type="email" value="${escH(s.contact_email||'')}">
        </div>
        <div class="form-field">
          <label class="form-label">Contact Phone</label>
          <input class="form-input" id="s-phone" type="tel" value="${escH(s.contact_phone||'')}">
        </div>
        <div class="form-field">
          <label class="form-label">Website</label>
          <input class="form-input" id="s-web" value="${escH(s.website||'')}">
        </div>
      </div>

      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:12px">Warehouse / Origin Address</div>
      <div class="alert alert-ok" style="margin-bottom:12px;font-size:12px">This address is used to calculate distance and travel time to jobsites in proposals.</div>
      <div class="form-grid form-grid-2" style="gap:12px;margin-bottom:20px">
        <div class="form-field" style="grid-column:1/-1">
          <label class="form-label">Street Address</label>
          <input class="form-input" id="s-addr" placeholder="123 Warehouse Rd" value="${escH(s.warehouse_address||'')}">
        </div>
        <div class="form-field">
          <label class="form-label">City</label>
          <input class="form-input" id="s-city" placeholder="Baltimore" value="${escH(s.warehouse_city||'')}">
        </div>
        <div class="form-field">
          <label class="form-label">State</label>
          <input class="form-input" id="s-state" placeholder="MD" value="${escH(s.warehouse_state||'')}">
        </div>
        <div class="form-field">
          <label class="form-label">ZIP</label>
          <input class="form-input" id="s-zip" placeholder="21201" value="${escH(s.warehouse_zip||'')}">
        </div>
      </div>

      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:12px">Proposal Defaults</div>
      <div class="form-grid form-grid-2" style="gap:12px;margin-bottom:24px">
        <div class="form-field">
          <label class="form-label">Default Tax Rate (%)</label>
          <input class="form-input" id="s-tax" type="number" step="0.1" min="0" placeholder="0" value="${s.default_tax_rate||0}">
        </div>
        <div class="form-field">
          <label class="form-label">Default Deposit (%)</label>
          <input class="form-input" id="s-deposit" type="number" step="5" min="0" max="100" placeholder="50" value="${s.default_deposit_pct||50}">
        </div>
        <div class="form-field" style="grid-column:1/-1">
          <label class="form-label">Default Proposal Terms & Notes</label>
          <textarea class="form-input form-textarea" id="s-terms" rows="4" placeholder="Payment terms, cancellation policy...">${escH(s.default_terms||'')}</textarea>
        </div>
      </div>

      <button class="btn btn-primary" onclick="window.Admin.saveSettings()">Save Settings</button>
      <div id="settings-msg" class="mok" style="margin-top:10px"></div>
    </div>`;
}

async function saveSettings() {
  const data = {
    company_name: _v('s-company'),
    contact_email: _v('s-email'),
    contact_phone: _v('s-phone'),
    website: _v('s-web'),
    warehouse_address: _v('s-addr'),
    warehouse_city: _v('s-city'),
    warehouse_state: _v('s-state'),
    warehouse_zip: _v('s-zip'),
    default_tax_rate: parseFloat(_v('s-tax')) || 0,
    default_deposit_pct: parseFloat(_v('s-deposit')) || 50,
    default_terms: _v('s-terms'),
  };

  // Upsert settings row with id=1
  const { error } = await supabase.from('settings').upsert({ id: 1, ...data });
  if (error) { _msg('settings-msg', 'Save failed.', true); console.error(error); return; }
  _msg('settings-msg', '✓ Settings saved.');
  await logActivity('settings', '1', 'updated', {});
}

// ============================================================
// USERS
// ============================================================

async function _usersPage() {
  const { data: users } = await supabase.from('profiles')
    .select('*').order('first_name');

  const roleColor = { admin:'tag-green', manager:'tag-blue', technician:'tag-gray' };

  return `
    <div style="font-family:'Barlow',sans-serif;font-size:20px;font-weight:800;margin-bottom:4px">Users</div>
    <div class="text-small text-muted" style="margin-bottom:20px">${users?.length||0} registered users</div>

    <div class="alert alert-ok" style="margin-bottom:16px;font-size:12px">
      New users self-register and are assigned <strong>Technician</strong> role by default. Upgrade their role here as needed.
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th><th></th></tr></thead>
        <tbody>
          ${(users||[]).map(u => `<tr>
            <td><strong>${escH(u.first_name)} ${escH(u.last_name)}</strong></td>
            <td class="text-small">${escH(u.email||'')}</td>
            <td class="text-small">${escH(u.phone||'—')}</td>
            <td>
              <select class="form-select" style="font-size:11px;padding:4px 8px"
                onchange="window.Admin.changeRole('${u.id}',this.value)">
                <option value="technician" ${u.role==='technician'?'selected':''}>Technician</option>
                <option value="manager" ${u.role==='manager'?'selected':''}>Manager</option>
                <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
              </select>
            </td>
            <td class="text-small">${u.created_at?new Date(u.created_at).toLocaleDateString():'—'}</td>
            <td>
              ${u.id !== getProfile()?.id ? `
                <button class="btn btn-danger" style="font-size:11px;padding:4px 9px"
                  onclick="window.Admin.deactivateUser('${u.id}','${escH(u.first_name+' '+u.last_name)}')">Deactivate</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function changeRole(userId, role) {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
  if (error) { showToast('Failed to update role.','error'); return; }
  await logActivity('user', userId, 'role_changed', { role });
  showToast(`Role updated to ${role}.`, 'success');
}

async function deactivateUser(userId, name) {
  if (!confirm(`Deactivate ${name}? They will not be able to log in.`)) return;
  // In Supabase, deactivation requires admin API — for now just note it
  showToast('Contact Supabase dashboard to fully deactivate auth users.', 'info');
}

// ============================================================
// VENDORS
// ============================================================

async function _vendorsPage() {
  const { data: vendors } = await supabase.from('vendors').select('*').order('name');

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-family:'Barlow',sans-serif;font-size:20px;font-weight:800;margin-bottom:4px">Vendors</div>
        <div class="text-small text-muted">${vendors?.length||0} vendors · Used for outside rentals</div>
      </div>
      <button class="btn-add" onclick="window.Admin.openVendorForm()">+ Add Vendor</button>
    </div>

    ${!vendors?.length ? `<div class="empty-state" style="padding:40px"><div class="empty-icon">🏭</div><div class="empty-title">No vendors yet</div><p class="empty-sub">Add vendors to link them to outside rentals on projects.</p></div>` :
    `<div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Company</th><th>Contact</th><th>Specialty</th><th>Email</th><th>Phone</th><th></th></tr></thead>
        <tbody>
          ${vendors.map(v => `<tr>
            <td><strong>${escH(v.name)}</strong>${v.notes?`<div class="text-small text-muted">${escH(v.notes.substring(0,60))}</div>`:''}</td>
            <td class="text-small">${escH(v.contact_name||'—')}</td>
            <td class="text-small">${escH(v.specialty||'—')}</td>
            <td class="text-small">${v.email?`<a href="mailto:${escH(v.email)}" style="color:var(--color-accent-2)">${escH(v.email)}</a>`:'—'}</td>
            <td class="text-small">${escH(v.phone||'—')}</td>
            <td style="display:flex;gap:6px">
              <button class="btn" style="font-size:11px;padding:4px 9px" onclick="window.Admin.openVendorForm('${v.id}')">Edit</button>
              <button class="btn btn-danger" style="font-size:11px;padding:4px 9px" onclick="window.Admin.deleteVendor('${v.id}')">✕</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`}

    <!-- Vendor modal -->
    <div class="modal-overlay" id="vendor-modal">
      <div class="modal" style="max-width:500px">
        <div class="modal-header">
          <div class="modal-title" id="vendor-modal-title">Add Vendor</div>
          <button class="modal-close" onclick="document.getElementById('vendor-modal').classList.remove('open')">✕</button>
        </div>
        <div id="vendor-modal-body"></div>
      </div>
    </div>`;
}

async function openVendorForm(id) {
  let vendor = null;
  if (id) {
    const { data } = await supabase.from('vendors').select('*').eq('id', id).single();
    vendor = data;
  }
  document.getElementById('vendor-modal-title').textContent = id ? 'Edit Vendor' : 'Add Vendor';
  document.getElementById('vendor-modal-body').innerHTML = `
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:14px">
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Company Name *</label>
        <input class="form-input" id="vf-name" value="${escH(vendor?.name||'')}" placeholder="ABC Lighting"></div>
      <div class="form-field"><label class="form-label">Contact Name</label>
        <input class="form-input" id="vf-contact" value="${escH(vendor?.contact_name||'')}"></div>
      <div class="form-field"><label class="form-label">Specialty / Type</label>
        <input class="form-input" id="vf-spec" value="${escH(vendor?.specialty||'')}" placeholder="Truss, Rigging, Generators..."></div>
      <div class="form-field"><label class="form-label">Email</label>
        <input class="form-input" id="vf-email" type="email" value="${escH(vendor?.email||'')}"></div>
      <div class="form-field"><label class="form-label">Phone</label>
        <input class="form-input" id="vf-phone" type="tel" value="${escH(vendor?.phone||'')}"></div>
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Notes</label>
        <textarea class="form-input form-textarea" id="vf-notes">${escH(vendor?.notes||'')}</textarea></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('vendor-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="window.Admin.saveVendor('${id||''}')">
        ${id?'Save Changes':'Add Vendor'}
      </button>
    </div>
    <div id="vendor-msg" class="mok" style="margin-top:8px"></div>`;
  document.getElementById('vendor-modal').classList.add('open');
  setTimeout(()=>document.getElementById('vf-name')?.focus(), 80);
}

async function saveVendor(existingId) {
  const name = _v('vf-name'); if (!name) { _msg('vendor-msg','Name required.',true); return; }
  const data = { name, contact_name:_v('vf-contact'), specialty:_v('vf-spec'), email:_v('vf-email'), phone:_v('vf-phone'), notes:_v('vf-notes') };
  let error;
  if (existingId) { ({error} = await dbUpdate('vendors', existingId, data)); }
  else { data.created_by = getProfile().id; ({error} = await dbInsert('vendors', data)); }
  if (error) { _msg('vendor-msg','Failed to save.',true); return; }
  document.getElementById('vendor-modal').classList.remove('open');
  showToast(existingId?'Vendor updated!':'Vendor added!','success');
  await _loadSection('vendors');
}

async function deleteVendor(id) {
  if (!confirm('Delete this vendor?')) return;
  await dbDelete('vendors', id);
  showToast('Vendor deleted.','success');
  await _loadSection('vendors');
}

// ============================================================
// TASK TEMPLATES
// ============================================================

const JOB_TYPES = [
  { key:'indoor_fly',           label:'Indoor — Fly (ceiling rigging)' },
  { key:'indoor_ground_riser',  label:'Indoor — Ground Support (riser)' },
  { key:'indoor_ground_truss',  label:'Indoor — Ground Support (truss)' },
  { key:'outdoor',              label:'Outdoor' },
];

async function _templatesPage() {
  const { data: templates } = await supabase.from('task_templates')
    .select('*').order('job_type').order('name');

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <div style="font-family:'Barlow',sans-serif;font-size:20px;font-weight:800;margin-bottom:4px">Task Templates</div>
        <div class="text-small text-muted">Auto-applied when a proposal converts to a project</div>
      </div>
      <button class="btn-add" onclick="window.Admin.openTemplateEditor()">+ New Template</button>
    </div>

    <div class="alert alert-ok" style="margin-bottom:16px;font-size:12px">
      When a proposal converts to a project, the <strong>default template</strong> for that job type is applied automatically.
      Mark one template per job type as default using the ⭐ button.
    </div>

    ${JOB_TYPES.map(jt => {
      const typeTemplates = (templates||[]).filter(t => t.job_type === jt.key);
      return `
        <div style="margin-bottom:20px">
          <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">
            ${jt.label}
          </div>
          ${!typeTemplates.length ? `
            <div style="background:#f9fafb;border:1.5px dashed var(--color-border-light);border-radius:8px;padding:16px;text-align:center;color:var(--color-muted);font-size:13px">
              No templates for this job type.
              <button class="btn" style="font-size:11px;padding:4px 9px;margin-left:8px"
                onclick="window.Admin.openTemplateEditor('','${jt.key}')">Create one</button>
            </div>` :
            typeTemplates.map(t => `
              <div style="background:#fff;border:1.5px solid ${t.is_default?'var(--color-accent-2)':'var(--color-border-light)'};border-radius:8px;padding:14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
                <div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <strong style="font-size:14px">${escH(t.name)}</strong>
                    ${t.is_default?`<span class="tag tag-blue" style="font-size:10px">⭐ Default</span>`:''}
                  </div>
                  <div class="text-small text-muted" style="margin-top:2px">${(t.tasks||[]).length} tasks</div>
                </div>
                <div style="display:flex;gap:6px">
                  ${!t.is_default?`<button class="btn" style="font-size:11px;padding:4px 9px" onclick="window.Admin.setDefaultTemplate('${t.id}','${t.job_type}')">⭐ Set Default</button>`:''}
                  <button class="btn" style="font-size:11px;padding:4px 9px" onclick="window.Admin.openTemplateEditor('${t.id}')">Edit</button>
                  <button class="btn btn-danger" style="font-size:11px;padding:4px 9px" onclick="window.Admin.deleteTemplate('${t.id}')">✕</button>
                </div>
              </div>`).join('')}
        </div>`;
    }).join('')}

    <!-- Template editor modal -->
    <div class="modal-overlay" id="template-modal">
      <div class="modal" style="max-width:680px">
        <div class="modal-header">
          <div class="modal-title" id="template-modal-title">Task Template</div>
          <button class="modal-close" onclick="document.getElementById('template-modal').classList.remove('open')">✕</button>
        </div>
        <div id="template-modal-body"></div>
      </div>
    </div>`;
}

let _templateTasks = [];

async function openTemplateEditor(id, preJobType) {
  let template = null;
  if (id) {
    const { data } = await supabase.from('task_templates').select('*').eq('id', id).single();
    template = data;
  }
  _templateTasks = template?.tasks ? [...template.tasks] : _defaultTemplateTasks(preJobType || template?.job_type || 'indoor_fly');

  document.getElementById('template-modal-title').textContent = id ? 'Edit Template' : 'New Template';
  _renderTemplateEditor(template, preJobType, id);
  document.getElementById('template-modal').classList.add('open');
}

function _renderTemplateEditor(template, preJobType, existingId) {
  document.getElementById('template-modal-body').innerHTML = `
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:16px">
      <div class="form-field" style="grid-column:1/-1"><label class="form-label">Template Name *</label>
        <input class="form-input" id="tf-name" value="${escH(template?.name||'')}" placeholder="e.g. Standard Indoor Fly"></div>
      <div class="form-field"><label class="form-label">Job Type</label>
        <select class="form-select" id="tf-type" onchange="window.Admin._loadDefaultTasks(this.value)">
          ${JOB_TYPES.map(jt=>`<option value="${jt.key}" ${(template?.job_type||preJobType)===jt.key?'selected':''}>${jt.label}</option>`).join('')}
        </select></div>
      <div class="form-field" style="display:flex;align-items:center;gap:8px;padding-top:22px">
        <input type="checkbox" id="tf-default" ${template?.is_default?'checked':''}>
        <label for="tf-default" style="font-size:13px;font-weight:500;cursor:pointer">Set as default for this job type</label>
      </div>
    </div>

    <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:10px">
      Tasks (${_templateTasks.length})
      <button class="btn" style="font-size:11px;padding:4px 9px;margin-left:8px" onclick="window.Admin.addTemplateTask()">+ Add Task</button>
    </div>

    <div id="template-tasks-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;max-height:340px;overflow-y:auto">
      ${_templateTasks.map((t, i) => _templateTaskRow(t, i)).join('')}
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('template-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="window.Admin.saveTemplate('${existingId||''}')">
        ${existingId?'Save Changes':'Create Template'}
      </button>
    </div>
    <div id="template-msg" class="mok" style="margin-top:8px"></div>`;
}

function _templateTaskRow(t, i) {
  const prioColor = { low:'#6b7280', medium:'#2563eb', high:'#d97706', urgent:'#dc2626' };
  return `<div style="display:flex;align-items:center;gap:8px;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:6px;padding:8px 10px">
    <span style="color:var(--color-muted);cursor:grab;font-size:14px">⋮⋮</span>
    <input class="form-input" style="flex:1;padding:5px 8px;font-size:12px" value="${escH(t.title||'')}"
      onchange="window.Admin.updateTemplateTask(${i},'title',this.value)">
    <select class="form-select" style="font-size:11px;padding:4px 8px;width:90px"
      onchange="window.Admin.updateTemplateTask(${i},'priority',this.value)">
      ${['low','medium','high','urgent'].map(p=>`<option value="${p}" ${t.priority===p?'selected':''}>${p}</option>`).join('')}
    </select>
    <select class="form-select" style="font-size:11px;padding:4px 8px;width:110px"
      onchange="window.Admin.updateTemplateTask(${i},'phase',this.value)">
      ${['pre_show','load_in','show','load_out','post_show'].map(ph=>`<option value="${ph}" ${t.phase===ph?'selected':''}>${ph.replace('_',' ')}</option>`).join('')}
    </select>
    <button class="btn btn-danger" style="font-size:11px;padding:4px 7px;flex-shrink:0"
      onclick="window.Admin.removeTemplateTask(${i})">✕</button>
  </div>`;
}

function _defaultTemplateTasks(jobType) {
  const base = [
    { title:'Confirm logistics with venue', priority:'high', phase:'pre_show' },
    { title:'Arrange trucking / transport', priority:'high', phase:'pre_show' },
    { title:'Confirm crew schedule', priority:'high', phase:'pre_show' },
    { title:'Pull panels from inventory', priority:'high', phase:'pre_show' },
    { title:'Pull all data and power cabling', priority:'medium', phase:'pre_show' },
    { title:'Equipment prep and testing', priority:'high', phase:'pre_show' },
    { title:'Truck loaded and departed warehouse', priority:'high', phase:'load_in' },
    { title:'Arrived on site', priority:'medium', phase:'load_in' },
    ...(jobType==='outdoor'||jobType==='indoor_fly'
      ? [{ title:'Rigging set — motors / fly bars hung', priority:'high', phase:'load_in' },
         { title:'Panels assembled and flown', priority:'high', phase:'load_in' }]
      : [{ title:'Ground support structure built', priority:'high', phase:'load_in' },
         { title:'Panels stacked on structure', priority:'high', phase:'load_in' }]),
    { title:'Data and power cabling complete', priority:'high', phase:'load_in' },
    { title:'Processor programmed', priority:'high', phase:'load_in' },
    { title:'Signal confirmed — show ready sign-off', priority:'urgent', phase:'load_in' },
    { title:'Pre-show systems check', priority:'high', phase:'show' },
    { title:'Show complete', priority:'medium', phase:'show' },
    { title:'Equipment broken down and packed', priority:'high', phase:'load_out' },
    { title:'Truck loaded', priority:'high', phase:'load_out' },
    { title:'Departed venue', priority:'medium', phase:'load_out' },
    { title:'Arrived at warehouse', priority:'medium', phase:'load_out' },
    { title:'Equipment de-prepped and checked in', priority:'high', phase:'post_show' },
    { title:'Equipment condition noted', priority:'medium', phase:'post_show' },
    { title:'Final invoice sent to client', priority:'urgent', phase:'post_show' },
    { title:'Client follow-up call / email', priority:'medium', phase:'post_show' },
    { title:'Review and remarket', priority:'low', phase:'post_show' },
  ];
  if (jobType==='outdoor') {
    base.unshift({ title:'Weather check — 7 day forecast', priority:'high', phase:'pre_show' });
    base.splice(1,0,{ title:'Confirm outdoor power / generator', priority:'high', phase:'pre_show' });
  }
  return base;
}

function addTemplateTask() {
  _templateTasks.push({ title:'New task', priority:'medium', phase:'pre_show' });
  const el = document.getElementById('template-tasks-list');
  if (el) el.innerHTML = _templateTasks.map((t,i)=>_templateTaskRow(t,i)).join('');
}

function removeTemplateTask(i) {
  _templateTasks.splice(i, 1);
  const el = document.getElementById('template-tasks-list');
  if (el) el.innerHTML = _templateTasks.map((t,idx)=>_templateTaskRow(t,idx)).join('');
}

function updateTemplateTask(i, field, value) {
  if (_templateTasks[i]) _templateTasks[i][field] = value;
}

function _loadDefaultTasks(jobType) {
  _templateTasks = _defaultTemplateTasks(jobType);
  const el = document.getElementById('template-tasks-list');
  if (el) el.innerHTML = _templateTasks.map((t,i)=>_templateTaskRow(t,i)).join('');
}

async function saveTemplate(existingId) {
  const name = _v('tf-name'); if (!name) { _msg('template-msg','Template name required.',true); return; }
  const jobType = document.getElementById('tf-type')?.value || 'indoor_fly';
  const isDefault = document.getElementById('tf-default')?.checked || false;

  // Collect any unsaved changes from the task rows
  document.querySelectorAll('#template-tasks-list input[type=text], #template-tasks-list input:not([type])').forEach((inp,i) => {
    if (_templateTasks[i]) _templateTasks[i].title = inp.value.trim();
  });

  const data = { name, job_type: jobType, tasks: _templateTasks, is_default: isDefault };

  let error;
  if (existingId) { ({error}=await dbUpdate('task_templates',existingId,data)); }
  else { data.created_by=getProfile().id; ({error}=await dbInsert('task_templates',data)); }
  if (error) { _msg('template-msg','Failed to save.',true); console.error(error); return; }

  // If setting as default, unset other defaults for this job type
  if (isDefault && existingId) {
    await supabase.from('task_templates')
      .update({ is_default: false })
      .eq('job_type', jobType)
      .neq('id', existingId);
  } else if (isDefault) {
    const { data: newT } = await supabase.from('task_templates').select('id').eq('name', name).eq('job_type', jobType).single();
    if (newT) await supabase.from('task_templates').update({ is_default: false }).eq('job_type', jobType).neq('id', newT.id);
  }

  document.getElementById('template-modal').classList.remove('open');
  showToast(existingId?'Template updated!':'Template created!','success');
  await _loadSection('templates');
}

async function setDefaultTemplate(id, jobType) {
  await supabase.from('task_templates').update({ is_default: false }).eq('job_type', jobType);
  await supabase.from('task_templates').update({ is_default: true }).eq('id', id);
  showToast('Default template set!','success');
  await _loadSection('templates');
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await dbDelete('task_templates', id);
  showToast('Deleted.','success');
  await _loadSection('templates');
}

// ============================================================
// AUDIT LOG
// ============================================================

async function _auditPage() {
  const { data: log } = await supabase.from('activity_log')
    .select('*,profiles!activity_log_performed_by_fkey(first_name,last_name)')
    .order('created_at', { ascending: false })
    .limit(200);

  const entityIcon = { project:'📐', proposal:'📄', lead:'📋', client:'👥', inventory:'📦', logistics:'🗓', settings:'⚙', user:'👤' };

  return `
    <div style="font-family:'Barlow',sans-serif;font-size:20px;font-weight:800;margin-bottom:4px">Audit Log</div>
    <div class="text-small text-muted" style="margin-bottom:20px">Last 200 system events</div>

    ${!log?.length ? `<div class="empty-state" style="padding:40px"><div class="empty-title">No activity yet</div></div>` :
    `<div style="display:flex;flex-direction:column;gap:6px">
      ${log.map(l => `
        <div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px">
          <span style="font-size:18px;flex-shrink:0">${entityIcon[l.entity_type]||'📝'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px">
              <strong>${l.profiles?`${l.profiles.first_name} ${l.profiles.last_name}`:'System'}</strong>
              <span style="color:var(--color-muted)"> ${escH(l.action.replace(/_/g,' '))}</span>
              <span style="color:var(--color-muted)"> · ${escH(l.entity_type)}</span>
              ${l.metadata?.name?`<span style="color:var(--color-muted)"> — ${escH(l.metadata.name)}</span>`:''}
            </div>
          </div>
          <div class="text-small text-muted" style="flex-shrink:0">${new Date(l.created_at).toLocaleString()}</div>
        </div>`).join('')}
    </div>`}`;
}

// ============================================================
// HELPERS
// ============================================================

const _v = id => document.getElementById(id)?.value?.trim()||'';
function _msg(id,msg,err=false){const el=document.getElementById(id);if(!el)return;el.textContent=msg;el.style.color=err?'var(--color-danger)':'var(--color-ok)';}
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showToast(msg,type='success'){window.showToast?.(msg,type);}

// ============================================================
// GLOBAL EXPOSURE
// ============================================================

window.Admin = {
  loadSection,
  saveSettings,
  changeRole, deactivateUser,
  openVendorForm, saveVendor, deleteVendor,
  openTemplateEditor, saveTemplate, deleteTemplate,
  setDefaultTemplate, addTemplateTask, removeTemplateTask,
  updateTemplateTask, _loadDefaultTasks,
};
