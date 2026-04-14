// ============================================================
// inventory.js — Equipment Catalog & Availability
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin } from './auth.js';

// ============================================================
// CONSTANTS
// ============================================================

const CATEGORIES = [
  'LED Panels', 'Processors', 'Data Cabling', 'Power Cabling',
  'Rigging Hardware', 'Ground Support', 'Cases',
  'Soft Goods', 'Staging', 'Expendables', 'Other',
];

const OWNERSHIP = ['owned', 'passthrough'];
const CONDITIONS = ['excellent', 'good', 'fair', 'needs repair', 'retired'];

// ============================================================
// MAIN RENDER
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading inventory...</div></div>`;
  const items = await fetchItems();
  renderInventory(container, items);
}

function renderInventory(container, items) {
  // Group by category
  const byCategory = {};
  CATEGORIES.forEach(c => byCategory[c] = []);
  items.forEach(item => {
    const cat = item.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  });

  const totalOwned = items.filter(i => i.ownership_type === 'owned').length;
  const totalPassthrough = items.filter(i => i.ownership_type === 'passthrough').length;
  const totalValue = items
    .filter(i => i.ownership_type === 'owned' && i.cost)
    .reduce((a, i) => a + (i.cost * i.qty_total), 0);

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Inventory</div>
        <div class="section-sub">${items.length} items · ${totalOwned} owned · ${totalPassthrough} passthrough${totalValue ? ` · $${totalValue.toLocaleString()} asset value` : ''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="inv-search" placeholder="🔍 Search inventory..."
          style="width:220px;padding:8px 12px;font-size:13px"
          oninput="window.Inventory.search(this.value)">
        <button class="btn-add" onclick="window.Inventory.openAdd()">+ Add Item</button>
      </div>
    </div>

    <!-- Category filter tabs -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
      <button class="seg-btn active" data-cat="all" onclick="window.Inventory.filterCat('all',this)">
        All (${items.length})
      </button>
      ${CATEGORIES.filter(c => byCategory[c]?.length).map(c => `
        <button class="seg-btn" data-cat="${c}" onclick="window.Inventory.filterCat('${c}',this)">
          ${c} (${byCategory[c].length})
        </button>`).join('')}
    </div>

    <!-- Inventory table -->
    <div class="card" style="padding:0;overflow:hidden">
      <div class="table-wrap" id="inv-table-wrap">
        <table class="data-table" id="inv-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Type</th>
              <th>Qty</th>
              <th>Available</th>
              <th>Condition</th>
              <th>Day Rate</th>
              <th>Week Rate</th>
              <th>Project Rate</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="inv-tbody">
            ${items.map(item => itemRow(item)).join('')}
          </tbody>
        </table>
      </div>
    </div>

    ${!items.length ? `
      <div class="empty-state" style="margin-top:24px">
        <div class="empty-icon">📦</div>
        <div class="empty-title">No inventory yet</div>
        <p class="empty-sub">Add your first piece of equipment to get started.</p>
      </div>` : ''}

    <!-- ADD / EDIT MODAL -->
    <div class="modal-overlay" id="inv-modal">
      <div class="modal" style="max-width:640px">
        <div class="modal-header">
          <div class="modal-title" id="inv-modal-title">Add Item</div>
          <button class="modal-close" onclick="window.Inventory.closeModal()">✕</button>
        </div>
        <div id="inv-modal-body"></div>
      </div>
    </div>

    <!-- AVAILABILITY MODAL -->
    <div class="modal-overlay" id="avail-modal">
      <div class="modal" style="max-width:600px">
        <div class="modal-header">
          <div class="modal-title" id="avail-modal-title">Availability</div>
          <button class="modal-close" onclick="document.getElementById('avail-modal').classList.remove('open')">✕</button>
        </div>
        <div id="avail-modal-body"></div>
      </div>
    </div>`;
}

function itemRow(item) {
  const availPct = item.qty_total > 0 ? Math.round((item.qty_available / item.qty_total) * 100) : 0;
  const availColor = availPct >= 80 ? '#166534' : availPct >= 40 ? '#d97706' : '#dc2626';
  const condColor = { excellent:'#166534', good:'#2563eb', fair:'#d97706', 'needs repair':'#dc2626', retired:'#6b7280' };
  const isPanel = item.is_panel;

  return `<tr data-cat="${escH(item.category||'Other')}" data-name="${escH(item.name||'').toLowerCase()}">
    <td>
      <div style="font-weight:600;font-size:13px">${escH(item.name)}${isPanel ? ' <span style="font-size:10px;background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:4px;font-weight:700">PANEL</span>' : ''}</div>
      ${item.manufacturer ? `<div class="text-small text-muted">${escH(item.manufacturer)}</div>` : ''}
      ${item.model ? `<div class="text-small text-muted">${escH(item.model)}</div>` : ''}
    </td>
    <td class="text-small">${escH(item.category||'—')}</td>
    <td><span class="tag ${item.ownership_type==='owned'?'tag-blue':'tag-yellow'}" style="font-size:10px">${item.ownership_type||'owned'}</span></td>
    <td style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700">${item.qty_total||0}</td>
    <td>
      <div style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;color:${availColor}">${item.qty_available||0}</div>
      <div style="font-size:10px;color:var(--color-muted)">${availPct}% free</div>
    </td>
    <td>
      ${item.condition ? `<span style="font-size:11px;font-weight:600;color:${condColor[item.condition]||'#6b7280'};text-transform:capitalize">${item.condition}</span>` : '—'}
    </td>
    <td class="text-small">${item.rate_day ? '$'+Number(item.rate_day).toLocaleString() : '—'}</td>
    <td class="text-small">${item.rate_week ? '$'+Number(item.rate_week).toLocaleString() : '—'}</td>
    <td class="text-small">${item.rate_project ? '$'+Number(item.rate_project).toLocaleString() : '—'}</td>
    <td>
      <div style="display:flex;gap:5px">
        ${item.is_panel || item.category === 'Processors' ? `
          <button class="btn" style="font-size:11px;padding:4px 8px" title="Check availability"
            onclick="window.Inventory.showAvailability('${item.id}')">📅</button>` : ''}
        <button class="btn" style="font-size:11px;padding:4px 8px"
          onclick="window.Inventory.openEdit('${item.id}')">Edit</button>
        <button class="btn btn-danger" style="font-size:11px;padding:4px 8px"
          onclick="window.Inventory.deleteItem('${item.id}')">✕</button>
      </div>
    </td>
  </tr>`;
}

// ============================================================
// DATA
// ============================================================

async function fetchItems() {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .order('category')
    .order('name');
  if (error) { console.error('[Inventory]', error); return []; }
  return data || [];
}

async function fetchItem(id) {
  const { data } = await supabase.from('inventory_items').select('*').eq('id', id).single();
  return data;
}

// ============================================================
// FILTER / SEARCH
// ============================================================

function filterCat(cat, btn) {
  document.querySelectorAll('[data-cat]').forEach(b => {
    if (b.tagName === 'BUTTON') b.classList.toggle('active', b.dataset.cat === cat);
  });
  document.querySelectorAll('#inv-tbody tr').forEach(row => {
    row.style.display = (cat === 'all' || row.dataset.cat === cat) ? '' : 'none';
  });
}

function search(query) {
  const q = query.toLowerCase().trim();
  const activeCat = document.querySelector('[data-cat].active')?.dataset.cat || 'all';
  document.querySelectorAll('#inv-tbody tr').forEach(row => {
    const nameMatch = row.dataset.name?.includes(q);
    const catMatch = activeCat === 'all' || row.dataset.cat === activeCat;
    row.style.display = nameMatch && catMatch ? '' : 'none';
  });
}

// ============================================================
// ADD / EDIT FORM
// ============================================================

function _itemForm(item) {
  const v = (f, def='') => escH(String(item?.[f] ?? def));
  const isPanel = item?.is_panel || false;

  return `
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Basic Info</div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:16px">
      <div class="form-field" style="grid-column:1/-1">
        <label class="form-label">Item Name *</label>
        <input class="form-input" id="if-name" placeholder="e.g. ROE BP3 LED Panel" value="${v('name')}">
      </div>
      <div class="form-field">
        <label class="form-label">Category *</label>
        <select class="form-select" id="if-cat" onchange="window.Inventory._onCatChange(this.value)">
          ${CATEGORIES.map(c => `<option value="${c}" ${v('category')===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Ownership Type</label>
        <select class="form-select" id="if-own">
          <option value="owned" ${v('ownership_type','owned')==='owned'?'selected':''}>Owned</option>
          <option value="passthrough" ${v('ownership_type')==='passthrough'?'selected':''}>Vendor Passthrough</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Manufacturer</label>
        <input class="form-input" id="if-mfr" placeholder="e.g. ROE Visual" value="${v('manufacturer')}">
      </div>
      <div class="form-field">
        <label class="form-label">Model / Part #</label>
        <input class="form-input" id="if-model" placeholder="e.g. BP3" value="${v('model')}">
      </div>
      <div class="form-field">
        <label class="form-label">Total Qty Owned</label>
        <input class="form-input" id="if-qty" type="number" min="0" placeholder="0" value="${v('qty_total','0')}">
      </div>
      <div class="form-field">
        <label class="form-label">Qty Available (right now)</label>
        <input class="form-input" id="if-avail" type="number" min="0" placeholder="0" value="${v('qty_available','0')}">
      </div>
      <div class="form-field">
        <label class="form-label">Condition</label>
        <select class="form-select" id="if-cond">
          <option value="">— Not specified —</option>
          ${CONDITIONS.map(c => `<option value="${c}" ${v('condition')===c?'selected':''}>${c.charAt(0).toUpperCase()+c.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Location / Storage</label>
        <input class="form-input" id="if-loc" placeholder="e.g. Warehouse Shelf B3" value="${v('location')}">
      </div>
    </div>

    <!-- LED Panel specific fields -->
    <div id="panel-fields" style="${isPanel || !item ? '' : 'display:none'}">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">LED Panel Specs</div>
      <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:16px">
        <div class="form-field">
          <label class="form-label">Pixel Pitch (mm)</label>
          <input class="form-input" id="if-pitch" type="number" step="0.1" placeholder="3.9"
            value="${item?.panel_data?.pitch||''}">
        </div>
        <div class="form-field">
          <label class="form-label">Panel Size</label>
          <select class="form-select" id="if-psize">
            <option value="1000" ${item?.panel_data?.size==='1000'?'selected':''}>1000×500mm (standard)</option>
            <option value="500" ${item?.panel_data?.size==='500'?'selected':''}>500×500mm (square)</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Power Draw (W per panel)</label>
          <input class="form-input" id="if-power" type="number" placeholder="150"
            value="${item?.panel_data?.power||''}">
        </div>
        <div class="form-field">
          <label class="form-label">Max Brightness (nits)</label>
          <input class="form-input" id="if-nits" type="number" placeholder="1000"
            value="${item?.panel_data?.nits||''}">
        </div>
        <div class="form-field">
          <label class="form-label">Panels per Case</label>
          <input class="form-input" id="if-ppc" type="number" placeholder="6"
            value="${item?.panel_data?.panels_per_case||''}">
        </div>
        <div class="form-field">
          <label class="form-label">Weight per Panel (lbs)</label>
          <input class="form-input" id="if-weight" type="number" step="0.1" placeholder="10"
            value="${item?.panel_data?.weight_lbs||''}">
        </div>
      </div>
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Pricing</div>
    <div class="form-grid form-grid-3" style="gap:10px;margin-bottom:16px">
      <div class="form-field">
        <label class="form-label">Cost (what you paid)</label>
        <input class="form-input" id="if-cost" type="number" step="0.01" placeholder="0.00"
          value="${v('cost')}">
      </div>
      <div class="form-field">
        <label class="form-label">Day Rate</label>
        <input class="form-input" id="if-rday" type="number" step="0.01" placeholder="0.00"
          value="${v('rate_day')}">
      </div>
      <div class="form-field">
        <label class="form-label">Week Rate</label>
        <input class="form-input" id="if-rwk" type="number" step="0.01" placeholder="0.00"
          value="${v('rate_week')}">
      </div>
      <div class="form-field">
        <label class="form-label">Project Rate</label>
        <input class="form-input" id="if-rproj" type="number" step="0.01" placeholder="0.00"
          value="${v('rate_project')}">
      </div>
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--color-muted);margin-bottom:10px">Notes</div>
    <div class="form-field" style="margin-bottom:16px">
      <textarea class="form-input form-textarea" id="if-notes" rows="3"
        placeholder="Serial numbers, storage notes, known issues, anything else...">${escH(item?.notes||'')}</textarea>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="window.Inventory.closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="window.Inventory.saveItem('${item?.id||''}')">
        ${item ? 'Save Changes' : 'Add Item'}
      </button>
    </div>
    <div id="inv-form-msg" class="mok" style="margin-top:8px"></div>`;
}

function _onCatChange(cat) {
  const panelFields = document.getElementById('panel-fields');
  if (panelFields) panelFields.style.display = cat === 'LED Panels' ? '' : 'none';
}

function openAdd() {
  document.getElementById('inv-modal-title').textContent = 'Add Item';
  document.getElementById('inv-modal-body').innerHTML = _itemForm(null);
  document.getElementById('inv-modal').classList.add('open');
  setTimeout(() => document.getElementById('if-name')?.focus(), 80);
}

async function openEdit(id) {
  const item = await fetchItem(id);
  if (!item) return;
  document.getElementById('inv-modal-title').textContent = 'Edit Item';
  document.getElementById('inv-modal-body').innerHTML = _itemForm(item);
  document.getElementById('inv-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('inv-modal').classList.remove('open');
}

async function saveItem(existingId) {
  const name = _v('if-name');
  const cat = document.getElementById('if-cat')?.value;
  if (!name) { _msg('inv-form-msg','Item name is required.',true); return; }

  const isPanel = cat === 'LED Panels';
  const panelData = isPanel ? {
    pitch: parseFloat(_v('if-pitch')) || null,
    size: document.getElementById('if-psize')?.value || '1000',
    power: parseInt(_v('if-power')) || null,
    nits: parseInt(_v('if-nits')) || null,
    panels_per_case: parseInt(_v('if-ppc')) || 6,
    weight_lbs: parseFloat(_v('if-weight')) || null,
  } : null;

  const data = {
    name,
    category: cat || 'Other',
    ownership_type: document.getElementById('if-own')?.value || 'owned',
    manufacturer: _v('if-mfr'),
    model: _v('if-model'),
    qty_total: parseInt(_v('if-qty')) || 0,
    qty_available: parseInt(_v('if-avail')) || 0,
    condition: document.getElementById('if-cond')?.value || null,
    location: _v('if-loc'),
    cost: parseFloat(_v('if-cost')) || null,
    rate_day: parseFloat(_v('if-rday')) || null,
    rate_week: parseFloat(_v('if-rwk')) || null,
    rate_project: parseFloat(_v('if-rproj')) || null,
    notes: _v('if-notes'),
    is_panel: isPanel,
    panel_data: panelData,
  };

  let error;
  if (existingId) {
    ({ error } = await dbUpdate('inventory_items', existingId, data));
  } else {
    data.created_by = getProfile().id;
    ({ error } = await dbInsert('inventory_items', data));
  }

  if (error) { _msg('inv-form-msg','Failed to save. Please try again.',true); console.error(error); return; }
  await logActivity('inventory', existingId||'new', existingId?'updated':'created', { name });
  closeModal();
  showToast(existingId ? 'Item updated!' : 'Item added!', 'success');
  window.navigateTo('inventory');
}

async function deleteItem(id) {
  if (!confirm('Delete this item? This cannot be undone.')) return;
  const { error } = await dbDelete('inventory_items', id);
  if (error) { showToast('Failed to delete.','error'); return; }
  showToast('Item deleted.','success');
  window.navigateTo('inventory');
}

// ============================================================
// AVAILABILITY CHECKER
// ============================================================

async function showAvailability(itemId) {
  const item = await fetchItem(itemId);
  if (!item) return;

  document.getElementById('avail-modal-title').textContent = `Availability — ${item.name}`;
  document.getElementById('avail-modal').classList.add('open');

  const body = document.getElementById('avail-modal-body');
  body.innerHTML = `<div class="loading-state" style="padding:30px"><div class="spinner"></div></div>`;

  // Find all projects that use this panel within the next 6 months
  const today = new Date();
  const sixMonths = new Date(); sixMonths.setMonth(sixMonths.getMonth() + 6);

  const { data: walls } = await supabase
    .from('walls')
    .select('*, projects(id,name,status,event_start_date,event_end_date)')
    .eq('panel_id', itemId)
    .not('projects.event_start_date', 'is', null);

  const reservations = (walls || [])
    .filter(w => w.projects)
    .map(w => ({
      projectId: w.projects.id,
      projectName: w.projects.name,
      status: w.projects.status,
      start: w.projects.event_start_date,
      end: w.projects.event_end_date || w.projects.event_start_date,
      qty: (w.calculated_output?.grid?.total || 0) * (w.qty || 1),
    }))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const statusColors = { planning:'#d97706', confirmed:'#2563eb', active:'#166534', completed:'#6b7280', cancelled:'#dc2626' };

  body.innerHTML = `
    <div style="margin-bottom:16px">
      <div class="summary-grid" style="margin-bottom:16px">
        <div class="summary-card"><div class="summary-card-label">Total Owned</div><div class="summary-card-value">${item.qty_total}</div></div>
        <div class="summary-card"><div class="summary-card-label">Currently Available</div><div class="summary-card-value" style="color:${item.qty_available>0?'#166534':'#dc2626'}">${item.qty_available}</div></div>
        <div class="summary-card"><div class="summary-card-label">Active Reservations</div><div class="summary-card-value">${reservations.filter(r=>!['completed','cancelled'].includes(r.status)).length}</div></div>
      </div>
    </div>

    <div style="font-family:'Barlow',sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Upcoming Reservations</div>
    ${!reservations.length
      ? `<div class="empty-state" style="padding:30px"><div class="empty-title">No reservations found</div><p class="empty-sub">This item is not currently assigned to any projects.</p></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">
          ${reservations.map(r => `
            <div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between">
              <div>
                <div style="font-weight:600;font-size:13px">${escH(r.projectName)}</div>
                <div class="text-small text-muted">${fmtDate(r.start)}${r.end&&r.end!==r.start?' → '+fmtDate(r.end):''}</div>
              </div>
              <div style="display:flex;align-items:center;gap:10px">
                <div style="text-align:right">
                  <div style="font-family:'Barlow',sans-serif;font-size:16px;font-weight:700;color:var(--color-accent)">${r.qty} panels</div>
                  <div class="text-small text-muted">reserved</div>
                </div>
                <span style="font-size:11px;font-weight:600;color:${statusColors[r.status]||'#6b7280'};text-transform:capitalize;background:#f9fafb;padding:3px 8px;border-radius:4px">${r.status}</span>
              </div>
            </div>`).join('')}
        </div>`}

    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border-light)">
      <div style="font-size:12px;color:var(--color-muted)">
        💡 To check availability for a specific date range, look at the reservations above and compare against your total qty of <strong>${item.qty_total}</strong>.
      </div>
    </div>`;
}

// ============================================================
// QUICK RESERVE (called from project/proposal context)
// ============================================================

export async function getPanelList() {
  const { data } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('is_panel', true)
    .order('name');
  return data || [];
}

export async function getItemsByCategory(category) {
  const { data } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('category', category)
    .order('name');
  return data || [];
}

export async function checkAvailability(itemId, startDate, endDate, qtyNeeded) {
  const item = await fetchItem(itemId);
  if (!item) return { available: false, qty: 0 };

  // Find reservations that overlap with the requested dates
  const { data: walls } = await supabase
    .from('walls')
    .select('*, projects(event_start_date, event_end_date, status)')
    .eq('panel_id', itemId);

  const overlapping = (walls || []).filter(w => {
    if (!w.projects || ['completed','cancelled'].includes(w.projects.status)) return false;
    const pStart = new Date(w.projects.event_start_date);
    const pEnd = new Date(w.projects.event_end_date || w.projects.event_start_date);
    const rStart = new Date(startDate);
    const rEnd = new Date(endDate);
    return pStart <= rEnd && pEnd >= rStart;
  });

  const reserved = overlapping.reduce((a, w) => a + ((w.calculated_output?.grid?.total || 0) * (w.qty || 1)), 0);
  const available = Math.max(0, item.qty_total - reserved);

  return {
    available: available >= qtyNeeded,
    qty: available,
    reserved,
    total: item.qty_total,
  };
}

// ============================================================
// HELPERS
// ============================================================

const _v = id => document.getElementById(id)?.value?.trim() || '';
function _msg(id, msg, err=false) { const el=document.getElementById(id); if(!el)return; el.textContent=msg; el.style.color=err?'var(--color-danger)':'var(--color-ok)'; }
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(d) { if(!d)return''; return new Date(d+'T00:00:00').toLocaleDateString(); }
function showToast(msg, type='success') { window.showToast?.(msg, type); }

// ============================================================
// GLOBAL EXPOSURE
// ============================================================

window.Inventory = {
  openAdd, openEdit, closeModal, saveItem, deleteItem,
  filterCat, search, showAvailability, _onCatChange,
};
