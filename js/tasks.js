// ============================================================
// tasks.js — Full Task Management
// List / Board · Comments · Files · Dependencies · Global + Per-Project
// ============================================================

import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from './supabase.js';
import { getProfile, isAdmin } from './auth.js';

// ============================================================
// CONSTANTS
// ============================================================

const STATUSES = [
  { key: 'todo',        label: 'To Do',       color: '#6b7280' },
  { key: 'in_progress', label: 'In Progress',  color: '#2563eb' },
  { key: 'review',      label: 'Review',       color: '#9333ea' },
  { key: 'done',        label: 'Done',         color: '#166534' },
];

const PRIORITIES = [
  { key: 'low',    label: 'Low',    color: '#6b7280' },
  { key: 'medium', label: 'Medium', color: '#2563eb' },
  { key: 'high',   label: 'High',   color: '#d97706' },
  { key: 'urgent', label: 'Urgent', color: '#dc2626' },
];

let _view = 'list'; // 'list' | 'board'
let _filterProject = '';
let _filterStatus = '';
let _filterAssignee = '';
let _allTasks = [];
let _allProjects = [];
let _allUsers = [];
let _currentTask = null;

// ============================================================
// MAIN RENDER
// ============================================================

export async function render(container) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><div>Loading tasks...</div></div>`;
  [_allTasks, _allProjects, _allUsers] = await Promise.all([
    fetchTasks(), fetchProjects(), fetchUsers(),
  ]);
  renderTasks(container);
}

function renderTasks(container) {
  const profile = getProfile();
  const myTasks = _allTasks.filter(t => t.assigned_to === profile?.id && t.status !== 'done');
  const overdue = _allTasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done');
  const filtered = getFiltered();

  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Tasks</div>
        <div class="section-sub">${_allTasks.length} total · ${myTasks.length} assigned to me · ${overdue.length} overdue</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="seg-btn ${_view==='list'?'active':''}" onclick="window.Tasks.setView('list')">☰ List</button>
        <button class="seg-btn ${_view==='board'?'active':''}" onclick="window.Tasks.setView('board')">⊞ Board</button>
        <button class="btn-add" onclick="window.Tasks.openAdd()">+ New Task</button>
      </div>
    </div>

    <!-- Stats bar -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${overdue.length ? `<div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:8px;padding:7px 12px;display:flex;align-items:center;gap:7px">
        <span style="font-size:12px;font-weight:600;color:#dc2626">⚠ ${overdue.length} Overdue</span>
      </div>` : ''}
      ${STATUSES.map(s => {
        const count = _allTasks.filter(t => t.status === s.key).length;
        return count ? `<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:7px 12px;display:flex;align-items:center;gap:7px;box-shadow:var(--shadow-sm)">
          <div style="width:8px;height:8px;border-radius:50%;background:${s.color}"></div>
          <span style="font-size:12px;font-weight:500">${s.label}</span>
          <span style="font-family:'Barlow',sans-serif;font-size:15px;font-weight:700;color:var(--color-accent)">${count}</span>
        </div>` : '';
      }).join('')}
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
      <select class="form-select" style="font-size:12px;padding:6px 10px;max-width:200px"
        onchange="window.Tasks.setFilter('project',this.value)">
        <option value="">All Projects</option>
        ${_allProjects.map(p => `<option value="${p.id}" ${_filterProject===p.id?'selected':''}>${escH(p.name)}</option>`).join('')}
        <option value="none">No Project (Lead Tasks)</option>
      </select>
      <select class="form-select" style="font-size:12px;padding:6px 10px"
        onchange="window.Tasks.setFilter('status',this.value)">
        <option value="">All Statuses</option>
        ${STATUSES.map(s => `<option value="${s.key}" ${_filterStatus===s.key?'selected':''}>${s.label}</option>`).join('')}
      </select>
      <select class="form-select" style="font-size:12px;padding:6px 10px"
        onchange="window.Tasks.setFilter('assignee',this.value)">
        <option value="">All Assignees</option>
        <option value="${profile?.id}" ${_filterAssignee===profile?.id?'selected':''}>My Tasks</option>
        ${_allUsers.map(u => `<option value="${u.id}" ${_filterAssignee===u.id?'selected':''}>${u.first_name} ${u.last_name}</option>`).join('')}
      </select>
      ${_filterProject||_filterStatus||_filterAssignee ? `
        <button class="btn" style="font-size:12px;padding:6px 10px" onclick="window.Tasks.clearFilters()">✕ Clear</button>` : ''}
      <span style="font-size:12px;color:var(--color-muted);margin-left:4px">${filtered.length} task${filtered.length!==1?'s':''}</span>
    </div>

    <!-- CONTENT -->
    <div id="tasks-content">
      ${_view === 'list' ? renderListView(filtered) : renderBoardView(filtered)}
    </div>

    <!-- TASK DETAIL SHEET -->
    <div class="sheet-overlay" id="task-sheet">
      <div class="sheet" style="max-width:680px">
        <div class="sheet-header">
          <div class="sheet-title" id="task-sheet-title">Task</div>
          <button class="modal-close" onclick="window.Tasks.closeSheet()">✕</button>
        </div>
        <div id="task-sheet-body"></div>
      </div>
    </div>

    <!-- ADD TASK MODAL -->
    <div class="modal-overlay" id="task-add-modal">
      <div class="modal" style="max-width:560px">
        <div class="modal-header">
          <div class="modal-title">New Task</div>
          <button class="modal-close" onclick="document.getElementById('task-add-modal').classList.remove('open')">✕</button>
        </div>
        <div id="task-add-body"></div>
      </div>
    </div>`;
}

// ── LIST VIEW ────────────────────────────────────────────────

function renderListView(tasks) {
  if (!tasks.length) return `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No tasks match your filters</div></div>`;

  // Group by project
  const byProject = new Map();
  tasks.forEach(t => {
    const key = t.project_id || 'none';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(t);
  });

  let html = '';
  for (const [projId, projTasks] of byProject.entries()) {
    const proj = _allProjects.find(p => p.id === projId);
    const projName = proj?.name || (projId === 'none' ? 'General / Lead Tasks' : 'Unknown Project');

    html += `
      <div style="margin-bottom:20px">
        <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;color:var(--color-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;display:flex;align-items:center;gap:8px">
          ${projId !== 'none' ? '📐' : '📋'} ${escH(projName)}
          <span style="font-size:11px;font-weight:400;color:var(--color-muted)">${projTasks.length} task${projTasks.length!==1?'s':''}</span>
        </div>
        <div class="card" style="padding:0;overflow:hidden">
          ${projTasks.map(t => taskListRow(t)).join('')}
        </div>
      </div>`;
  }
  return html;
}

function taskListRow(t) {
  const pc = PRIORITIES.find(p => p.key === t.priority);
  const sc = STATUSES.find(s => s.key === t.status);
  const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done';
  const assignee = _allUsers.find(u => u.id === t.assigned_to);

  return `<div style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid #f3f4f6;cursor:pointer;transition:background .1s"
    onclick="window.Tasks.openTask('${t.id}')"
    onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">

    <!-- Checkbox -->
    <div onclick="event.stopPropagation();window.Tasks.toggleDone('${t.id}','${t.status}')"
      style="width:18px;height:18px;border-radius:4px;border:2px solid ${t.status==='done'?'#166534':'#d1d5db'};
             background:${t.status==='done'?'#166534':'transparent'};flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:pointer">
      ${t.status==='done'?'<span style="color:#fff;font-size:10px">✓</span>':''}
    </div>

    <!-- Priority dot -->
    <div style="width:8px;height:8px;border-radius:50%;background:${pc?.color||'#6b7280'};flex-shrink:0"></div>

    <!-- Title + meta -->
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:${t.status==='done'?'400':'600'};
                  text-decoration:${t.status==='done'?'line-through':'none'};
                  color:${t.status==='done'?'var(--color-muted)':'var(--color-text)'};
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${escH(t.title)}
      </div>
      ${t.description && !t.description.startsWith('lead:') ? `
        <div style="font-size:11px;color:var(--color-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">
          ${escH(t.description.substring(0,80))}${t.description.length>80?'...':''}
        </div>` : ''}
    </div>

    <!-- Assignee -->
    <div style="font-size:11px;color:var(--color-muted);flex-shrink:0;min-width:80px;text-align:right">
      ${assignee ? `${assignee.first_name} ${assignee.last_name[0]}.` : '—'}
    </div>

    <!-- Due date -->
    <div style="font-size:11px;flex-shrink:0;min-width:70px;text-align:right;color:${isOverdue?'#dc2626':'var(--color-muted)'}">
      ${t.due_date ? (isOverdue?'⚠ ':'')+fmtDate(t.due_date) : '—'}
    </div>

    <!-- Status badge -->
    <span style="font-size:10px;font-weight:600;color:${sc?.color||'#6b7280'};text-transform:uppercase;flex-shrink:0;min-width:72px;text-align:right">
      ${sc?.label||t.status}
    </span>
  </div>`;
}

// ── BOARD VIEW ───────────────────────────────────────────────

function renderBoardView(tasks) {
  return `<div style="display:flex;gap:12px;overflow-x:auto;padding-bottom:16px">
    ${STATUSES.map(s => {
      const col = tasks.filter(t => t.status === s.key);
      return `<div style="min-width:240px;flex-shrink:0;background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:12px;padding:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:8px;height:8px;border-radius:50%;background:${s.color}"></div>
            <span style="font-family:'Barlow',sans-serif;font-size:12px;font-weight:700">${s.label}</span>
          </div>
          <span style="font-size:12px;color:var(--color-muted);font-weight:600">${col.length}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${col.map(t => taskBoardCard(t)).join('')}
          ${!col.length ? `<div style="text-align:center;padding:16px;color:var(--color-muted);font-size:12px">No tasks</div>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function taskBoardCard(t) {
  const pc = PRIORITIES.find(p => p.key === t.priority);
  const assignee = _allUsers.find(u => u.id === t.assigned_to);
  const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done';
  const proj = _allProjects.find(p => p.id === t.project_id);

  return `<div style="background:#fff;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px;cursor:pointer;box-shadow:var(--shadow-sm);transition:box-shadow .12s"
    onclick="window.Tasks.openTask('${t.id}')"
    onmouseover="this.style.boxShadow='var(--shadow-md)'" onmouseout="this.style.boxShadow='var(--shadow-sm)'">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
      <div style="font-weight:600;font-size:12px;line-height:1.4">${escH(t.title)}</div>
      <div style="width:8px;height:8px;border-radius:50%;background:${pc?.color||'#6b7280'};flex-shrink:0;margin-top:3px"></div>
    </div>
    ${proj ? `<div style="font-size:10px;color:var(--color-muted);margin-bottom:5px">📐 ${escH(proj.name)}</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
      <span style="font-size:10px;color:var(--color-muted)">${assignee?`${assignee.first_name} ${assignee.last_name[0]}.`:'Unassigned'}</span>
      ${t.due_date ? `<span style="font-size:10px;color:${isOverdue?'#dc2626':'var(--color-muted)'}">${isOverdue?'⚠ ':''}${fmtDate(t.due_date)}</span>` : ''}
    </div>
  </div>`;
}

// ============================================================
// DATA
// ============================================================

async function fetchTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) { console.error('[Tasks]', error); return []; }
  return data || [];
}

async function fetchProjects() {
  const { data } = await supabase.from('projects').select('id,name').order('name');
  return data || [];
}

async function fetchUsers() {
  const { data } = await supabase.from('profiles').select('id,first_name,last_name,role').order('first_name');
  return data || [];
}

async function fetchTask(id) {
  const { data } = await supabase.from('tasks').select('*').eq('id', id).single();
  return data;
}

async function fetchComments(taskId) {
  const { data } = await supabase.from('task_comments')
    .select('*,profiles!task_comments_author_id_fkey(first_name,last_name)')
    .eq('task_id', taskId).order('created_at');
  return data || [];
}

async function fetchTaskFiles(taskId) {
  const { data } = await supabase.from('task_files')
    .select('*,profiles!task_files_uploaded_by_fkey(first_name,last_name)')
    .eq('task_id', taskId).order('created_at', { ascending: false });
  return data || [];
}

// ============================================================
// FILTERS
// ============================================================

function getFiltered() {
  return _allTasks.filter(t => {
    if (_filterProject === 'none' && t.project_id) return false;
    if (_filterProject && _filterProject !== 'none' && t.project_id !== _filterProject) return false;
    if (_filterStatus && t.status !== _filterStatus) return false;
    if (_filterAssignee && t.assigned_to !== _filterAssignee) return false;
    // Hide internal lead tasks from main view
    if (t.description?.startsWith('lead:') && !_filterProject) return false;
    return true;
  });
}

function setFilter(type, value) {
  if (type === 'project') _filterProject = value;
  if (type === 'status') _filterStatus = value;
  if (type === 'assignee') _filterAssignee = value;
  const el = document.getElementById('tasks-content');
  if (el) el.innerHTML = _view === 'list' ? renderListView(getFiltered()) : renderBoardView(getFiltered());
}

function clearFilters() {
  _filterProject = ''; _filterStatus = ''; _filterAssignee = '';
  window.navigateTo('tasks');
}

function setView(v) {
  _view = v;
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.textContent.trim().includes(v === 'list' ? '☰' : '⊞')));
  const el = document.getElementById('tasks-content');
  if (el) el.innerHTML = _view === 'list' ? renderListView(getFiltered()) : renderBoardView(getFiltered());
}

// ============================================================
// ADD TASK
// ============================================================

function openAdd(preProjectId) {
  const body = document.getElementById('task-add-body');
  body.innerHTML = `
    <div class="form-field" style="margin-bottom:12px">
      <label class="form-label">Title *</label>
      <input class="form-input" id="ta-title" placeholder="What needs to be done?">
    </div>
    <div class="form-field" style="margin-bottom:12px">
      <label class="form-label">Description</label>
      <textarea class="form-input form-textarea" id="ta-desc" placeholder="More details..." rows="3"></textarea>
    </div>
    <div class="form-grid form-grid-2" style="gap:10px;margin-bottom:12px">
      <div class="form-field"><label class="form-label">Project</label>
        <select class="form-select" id="ta-proj">
          <option value="">— No project —</option>
          ${_allProjects.map(p => `<option value="${p.id}" ${preProjectId===p.id?'selected':''}>${escH(p.name)}</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Assigned To</label>
        <select class="form-select" id="ta-asgn">
          <option value="">— Unassigned —</option>
          ${_allUsers.map(u => `<option value="${u.id}" ${u.id===getProfile()?.id?'selected':''}>${u.first_name} ${u.last_name}</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Priority</label>
        <select class="form-select" id="ta-pri">
          ${PRIORITIES.map(p => `<option value="${p.key}" ${p.key==='medium'?'selected':''}>${p.label}</option>`).join('')}
        </select></div>
      <div class="form-field"><label class="form-label">Due Date</label>
        <input class="form-input" id="ta-due" type="date"></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('task-add-modal').classList.remove('open')">Cancel</button>
      <button class="btn btn-primary" onclick="window.Tasks.saveNewTask()">Add Task</button>
    </div>
    <div id="ta-msg" class="mok" style="margin-top:8px"></div>`;
  document.getElementById('task-add-modal').classList.add('open');
  setTimeout(() => document.getElementById('ta-title')?.focus(), 80);
}

async function saveNewTask() {
  const title = _v('ta-title');
  if (!title) { _msg('ta-msg', 'Title is required.', true); return; }
  const profile = getProfile();
  const { data: task, error } = await supabase.from('tasks').insert({
    title,
    description: _v('ta-desc'),
    project_id: document.getElementById('ta-proj')?.value || null,
    assigned_to: document.getElementById('ta-asgn')?.value || null,
    priority: document.getElementById('ta-pri')?.value || 'medium',
    due_date: _v('ta-due') || null,
    status: 'todo',
    created_by: profile.id,
  }).select().single();
  if (error) { _msg('ta-msg', 'Failed to save.', true); return; }
  document.getElementById('task-add-modal').classList.remove('open');
  showToast('Task created!', 'success');
  // Refresh
  _allTasks = await fetchTasks();
  const container = document.getElementById('main-content');
  if (container) renderTasks(container);
}

// ============================================================
// TASK DETAIL SHEET
// ============================================================

async function openTask(id) {
  document.getElementById('task-sheet').classList.add('open');
  document.getElementById('task-sheet-body').innerHTML = `<div class="loading-state" style="padding:40px"><div class="spinner"></div></div>`;

  const [task, comments, files] = await Promise.all([
    fetchTask(id),
    fetchComments(id),
    fetchTaskFiles(id),
  ]);

  if (!task) { document.getElementById('task-sheet-body').innerHTML = `<div class="empty-state"><div class="empty-title">Task not found</div></div>`; return; }
  _currentTask = task;
  document.getElementById('task-sheet-title').textContent = task.title;
  renderTaskSheet(task, comments, files);
}

function renderTaskSheet(task, comments, files) {
  const pc = PRIORITIES.find(p => p.key === task.priority);
  const sc = STATUSES.find(s => s.key === task.status);
  const assignee = _allUsers.find(u => u.id === task.assigned_to);
  const creator = _allUsers.find(u => u.id === task.created_by);
  const proj = _allProjects.find(p => p.id === task.project_id);
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';

  document.getElementById('task-sheet-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;padding-bottom:40px">

      <!-- Status + Priority bar -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="form-select" style="font-size:12px;padding:6px 10px"
          onchange="window.Tasks.updateField('${task.id}','status',this.value)">
          ${STATUSES.map(s => `<option value="${s.key}" ${task.status===s.key?'selected':''}>${s.label}</option>`).join('')}
        </select>
        <select class="form-select" style="font-size:12px;padding:6px 10px"
          onchange="window.Tasks.updateField('${task.id}','priority',this.value)">
          ${PRIORITIES.map(p => `<option value="${p.key}" ${task.priority===p.key?'selected':''}>${p.label} Priority</option>`).join('')}
        </select>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-danger" style="font-size:12px;padding:6px 12px"
            onclick="window.Tasks.deleteTask('${task.id}')">Delete</button>
        </div>
      </div>

      <!-- Title (editable) -->
      <div class="form-field">
        <label class="form-label">Title</label>
        <input class="form-input" id="ts-title" value="${escH(task.title)}"
          onblur="window.Tasks.updateField('${task.id}','title',this.value)"
          style="font-size:15px;font-weight:600">
      </div>

      <!-- Description (editable) -->
      <div class="form-field">
        <label class="form-label">Description</label>
        <textarea class="form-input form-textarea" id="ts-desc" rows="4"
          onblur="window.Tasks.updateField('${task.id}','description',this.value)"
          placeholder="Add more details...">${escH(task.description && !task.description.startsWith('lead:')?task.description:'')}</textarea>
      </div>

      <!-- Meta grid -->
      <div class="form-grid form-grid-2" style="gap:10px">
        <div class="form-field"><label class="form-label">Assigned To</label>
          <select class="form-select" id="ts-asgn"
            onchange="window.Tasks.updateField('${task.id}','assigned_to',this.value||null)">
            <option value="">— Unassigned —</option>
            ${_allUsers.map(u => `<option value="${u.id}" ${task.assigned_to===u.id?'selected':''}>${u.first_name} ${u.last_name}</option>`).join('')}
          </select></div>
        <div class="form-field"><label class="form-label">Project</label>
          <select class="form-select"
            onchange="window.Tasks.updateField('${task.id}','project_id',this.value||null)">
            <option value="">— No project —</option>
            ${_allProjects.map(p => `<option value="${p.id}" ${task.project_id===p.id?'selected':''}>${escH(p.name)}</option>`).join('')}
          </select></div>
        <div class="form-field"><label class="form-label">Due Date</label>
          <input class="form-input" type="date" value="${task.due_date||''}"
            style="${isOverdue?'border-color:#dc2626;color:#dc2626':''}"
            onchange="window.Tasks.updateField('${task.id}','due_date',this.value||null)"></div>
        <div class="form-field"><label class="form-label">Created By</label>
          <div style="padding:9px 12px;font-size:13px;color:var(--color-muted)">
            ${creator?`${creator.first_name} ${creator.last_name}`:'—'}
            <div style="font-size:11px">${task.created_at?new Date(task.created_at).toLocaleDateString():''}</div>
          </div></div>
      </div>

      ${proj ? `<div style="background:#f0f9ff;border:1.5px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:13px">
        📐 <strong>${escH(proj.name)}</strong>
        <button onclick="window.Tasks.closeSheet();setTimeout(()=>window.Projects?.openProject?.('${proj.id}'),200)" class="btn" style="font-size:11px;padding:3px 8px;margin-left:8px">View Project →</button>
      </div>` : ''}

      <!-- TABS -->
      <div class="tab-bar">
        <button class="tab-btn active" id="tt-comments" onclick="window.Tasks.showTTab('comments')">
          Comments (${comments.length})
        </button>
        <button class="tab-btn" id="tt-files" onclick="window.Tasks.showTTab('files')">
          Files (${files.length})
        </button>
        <button class="tab-btn" id="tt-deps" onclick="window.Tasks.showTTab('deps')">
          Dependencies
        </button>
      </div>

      <!-- COMMENTS -->
      <div class="tab-panel active" id="tp-comments">
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
          ${!comments.length ? `<div style="text-align:center;padding:16px;color:var(--color-muted);font-size:13px">No comments yet. Be the first to comment.</div>` :
            comments.map(c => `
              <div style="background:#f9fafb;border:1.5px solid var(--color-border-light);border-radius:8px;padding:12px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                  <span style="font-weight:600;font-size:12px">${c.profiles?`${c.profiles.first_name} ${c.profiles.last_name}`:'—'}</span>
                  <span class="text-small text-muted">${new Date(c.created_at).toLocaleString()}</span>
                </div>
                <div style="font-size:13px;line-height:1.6;white-space:pre-wrap">${escH(c.body)}</div>
              </div>`).join('')}
        </div>
        <div class="form-field" style="margin-bottom:8px">
          <textarea class="form-input form-textarea" id="new-comment" rows="3" placeholder="Add a comment..."></textarea>
        </div>
        <button class="btn btn-primary" onclick="window.Tasks.addComment('${task.id}')">Post Comment</button>
      </div>

      <!-- FILES -->
      <div class="tab-panel" id="tp-files">
        <div style="margin-bottom:12px">
          <input type="file" id="task-file-input" multiple style="display:none"
            onchange="window.Tasks.uploadTaskFiles('${task.id}')">
          <button class="btn-add" onclick="document.getElementById('task-file-input').click()">+ Attach File</button>
        </div>
        ${!files.length ? `<div style="text-align:center;padding:16px;color:var(--color-muted);font-size:13px">No files attached yet.</div>` :
          files.map(f => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
              <span style="font-size:20px">${f.file_type?.includes('image')?'🖼':f.file_type?.includes('pdf')?'📄':'📁'}</span>
              <div style="flex:1;min-width:0">
                <div style="font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(f.file_name)}</div>
                <div class="text-small text-muted">${f.profiles?`${f.profiles.first_name} ${f.profiles.last_name}`:'—'} · ${new Date(f.created_at).toLocaleDateString()}</div>
              </div>
              <a href="${f.storage_url}" target="_blank" class="btn" style="font-size:11px;padding:4px 9px">⬇</a>
            </div>`).join('')}
      </div>

      <!-- DEPENDENCIES -->
      <div class="tab-panel" id="tp-deps">
        <div id="deps-content"><div class="loading-state" style="padding:20px"><div class="spinner"></div></div></div>
      </div>

    </div>`;
}

function showTTab(name) {
  ['comments','files','deps'].forEach(t => {
    document.getElementById('tt-'+t)?.classList.toggle('active', t===name);
    document.getElementById('tp-'+t)?.classList.toggle('active', t===name);
  });
  if (name === 'deps') loadDeps();
}

function closeSheet() {
  document.getElementById('task-sheet').classList.remove('open');
}

// ── COMMENTS ─────────────────────────────────────────────────

async function addComment(taskId) {
  const body = document.getElementById('new-comment')?.value.trim();
  if (!body) return;
  const profile = getProfile();
  const { error } = await supabase.from('task_comments').insert({
    task_id: taskId, body, author_id: profile.id,
  });
  if (error) { showToast('Failed to post comment.','error'); return; }
  document.getElementById('new-comment').value = '';
  showToast('Comment posted!','success');
  // Reload sheet
  const [task, comments, files] = await Promise.all([fetchTask(taskId), fetchComments(taskId), fetchTaskFiles(taskId)]);
  _currentTask = task;
  document.getElementById('task-sheet-title').textContent = task.title;
  renderTaskSheet(task, comments, files);
  showTTab('comments');
}

// ── FILES ────────────────────────────────────────────────────

async function uploadTaskFiles(taskId) {
  const input = document.getElementById('task-file-input');
  const files = input?.files; if (!files?.length) return;
  const profile = getProfile();
  let uploaded = 0;
  for (const file of files) {
    const path = `tasks/${taskId}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from('project-files').upload(path, file, { upsert: false });
    if (upErr) { console.error(upErr); continue; }
    const { data: { publicUrl } } = supabase.storage.from('project-files').getPublicUrl(path);
    await supabase.from('task_files').insert({
      task_id: taskId, uploaded_by: profile.id,
      file_name: file.name, file_type: file.type, file_size: file.size,
      storage_path: path, storage_url: publicUrl,
    });
    uploaded++;
  }
  if (uploaded) {
    showToast(`${uploaded} file${uploaded!==1?'s':''} attached!`,'success');
    const [task, comments, files] = await Promise.all([fetchTask(taskId), fetchComments(taskId), fetchTaskFiles(taskId)]);
    renderTaskSheet(task, comments, files);
    showTTab('files');
  }
}

// ── DEPENDENCIES ─────────────────────────────────────────────

async function loadDeps() {
  const el = document.getElementById('deps-content'); if (!el || !_currentTask) return;
  const taskId = _currentTask.id;

  // Get blocked_by tasks
  const { data: deps } = await supabase.from('tasks')
    .select('id,title,status,priority')
    .contains('blocks', [taskId]);

  const { data: blocking } = await supabase.from('tasks')
    .select('id,title,status,priority')
    .filter('id', 'in', `(${JSON.stringify(_currentTask.blocks||[]).replace('[','(').replace(']',')')})`);

  const available = _allTasks.filter(t => t.id !== taskId && !(_currentTask.blocks||[]).includes(t.id));

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;margin-bottom:8px">This task is blocked by:</div>
      ${!deps?.length ? `<div style="font-size:13px;color:var(--color-muted)">Nothing blocking this task.</div>` :
        deps.map(d => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f3f4f6">
          <div style="width:8px;height:8px;border-radius:50%;background:${PRIORITIES.find(p=>p.key===d.priority)?.color||'#6b7280'}"></div>
          <span style="font-size:13px;${d.status==='done'?'text-decoration:line-through;color:var(--color-muted)':''}">${escH(d.title)}</span>
          <span class="tag ${d.status==='done'?'tag-green':'tag-gray'}" style="font-size:10px;margin-left:auto">${d.status}</span>
        </div>`).join('')}
    </div>
    <div style="margin-bottom:16px">
      <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;margin-bottom:8px">This task blocks:</div>
      ${!_currentTask.blocks?.length ? `<div style="font-size:13px;color:var(--color-muted)">Not blocking any tasks.</div>` :
        (blocking||[]).map(b => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f3f4f6">
          <span style="font-size:13px">${escH(b.title)}</span>
          <button onclick="window.Tasks.removeDep('${taskId}','${b.id}')" class="btn btn-danger" style="font-size:10px;padding:2px 7px;margin-left:auto">Remove</button>
        </div>`).join('')}
    </div>
    <div>
      <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:700;margin-bottom:8px">Add dependency (this task blocks):</div>
      <div style="display:flex;gap:8px">
        <select class="form-select" id="dep-sel" style="font-size:12px">
          <option value="">— Select task —</option>
          ${available.map(t => `<option value="${t.id}">${escH(t.title)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" style="font-size:12px;white-space:nowrap" onclick="window.Tasks.addDep('${taskId}')">Add</button>
      </div>
    </div>`;
}

async function addDep(taskId) {
  const depId = document.getElementById('dep-sel')?.value; if (!depId) return;
  const blocks = [...(_currentTask.blocks||[]), depId];
  await supabase.from('tasks').update({ blocks }).eq('id', taskId);
  _currentTask.blocks = blocks;
  showToast('Dependency added!','success'); loadDeps();
}

async function removeDep(taskId, depId) {
  const blocks = (_currentTask.blocks||[]).filter(id => id !== depId);
  await supabase.from('tasks').update({ blocks }).eq('id', taskId);
  _currentTask.blocks = blocks;
  showToast('Dependency removed.','success'); loadDeps();
}

// ── TASK MUTATIONS ───────────────────────────────────────────

async function updateField(id, field, value) {
  await supabase.from('tasks').update({ [field]: value }).eq('id', id);
  if (_currentTask?.id === id) _currentTask[field] = value;
  // Refresh task list in background
  _allTasks = await fetchTasks();
  const el = document.getElementById('tasks-content');
  if (el) el.innerHTML = _view === 'list' ? renderListView(getFiltered()) : renderBoardView(getFiltered());
  showToast('Saved.','success');
}

async function toggleDone(id, currentStatus) {
  const newStatus = currentStatus === 'done' ? 'todo' : 'done';
  await supabase.from('tasks').update({
    status: newStatus,
    completed_at: newStatus === 'done' ? new Date().toISOString() : null,
  }).eq('id', id);
  _allTasks = await fetchTasks();
  const el = document.getElementById('tasks-content');
  if (el) el.innerHTML = _view === 'list' ? renderListView(getFiltered()) : renderBoardView(getFiltered());
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  await dbDelete('tasks', id);
  closeSheet();
  showToast('Task deleted.','success');
  _allTasks = await fetchTasks();
  const container = document.getElementById('main-content');
  if (container) renderTasks(container);
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

window.Tasks = {
  openAdd, saveNewTask, openTask, closeSheet,
  setView, setFilter, clearFilters,
  showTTab, addComment, uploadTaskFiles,
  addDep, removeDep, loadDeps,
  updateField, toggleDone, deleteTask,
};
