// ============================================================
// supabase.js — Database client + offline queue
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// These values are set in your Netlify environment variables
// For local dev, replace these temporarily with your actual values
const SUPABASE_URL = window.ENV?.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = window.ENV?.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// ============================================================
// OFFLINE QUEUE
// Stores failed writes when offline, replays when back online
// ============================================================

const QUEUE_KEY = 'va_offline_queue';

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
  } catch {
    return [];
  }
}

export function addToQueue(operation) {
  const queue = getQueue();
  queue.push({
    ...operation,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  console.log('[Offline Queue] Added operation:', operation.type, operation.table);
}

export function removeFromQueue(id) {
  const queue = getQueue().filter(op => op.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}

// Replay queued operations when back online
export async function replayQueue() {
  const queue = getQueue();
  if (!queue.length) return;

  console.log(`[Offline Queue] Replaying ${queue.length} queued operations...`);

  for (const op of queue) {
    try {
      let result;
      if (op.type === 'insert') {
        result = await supabase.from(op.table).insert(op.data);
      } else if (op.type === 'update') {
        result = await supabase.from(op.table).update(op.data).eq('id', op.id);
      } else if (op.type === 'delete') {
        result = await supabase.from(op.table).delete().eq('id', op.id);
      }

      if (result?.error) {
        console.error('[Offline Queue] Failed to replay:', op, result.error);
      } else {
        removeFromQueue(op.id);
        console.log('[Offline Queue] Replayed successfully:', op.type, op.table);
      }
    } catch (err) {
      console.error('[Offline Queue] Error replaying operation:', err);
    }
  }
}

// ============================================================
// ONLINE/OFFLINE DETECTION
// ============================================================

let isOnline = navigator.onLine;

export function getOnlineStatus() {
  return isOnline;
}

window.addEventListener('online', async () => {
  isOnline = true;
  console.log('[Network] Back online — replaying queue...');
  document.dispatchEvent(new CustomEvent('va:online'));
  await replayQueue();
});

window.addEventListener('offline', () => {
  isOnline = false;
  console.log('[Network] Gone offline — writes will be queued.');
  document.dispatchEvent(new CustomEvent('va:offline'));
});

// ============================================================
// SAFE DB OPERATIONS
// Falls back to offline queue if network unavailable
// ============================================================

export async function dbInsert(table, data) {
  if (!isOnline) {
    addToQueue({ type: 'insert', table, data });
    return { data, error: null, offline: true };
  }
  const result = await supabase.from(table).insert(data).select().single();
  if (result.error) console.error(`[DB] Insert error on ${table}:`, result.error);
  return result;
}

export async function dbUpdate(table, id, data) {
  if (!isOnline) {
    addToQueue({ type: 'update', table, id, data });
    return { data, error: null, offline: true };
  }
  const result = await supabase.from(table).update(data).eq('id', id).select().single();
  if (result.error) console.error(`[DB] Update error on ${table}:`, result.error);
  return result;
}

export async function dbDelete(table, id) {
  if (!isOnline) {
    addToQueue({ type: 'delete', table, id });
    return { error: null, offline: true };
  }
  const result = await supabase.from(table).delete().eq('id', id);
  if (result.error) console.error(`[DB] Delete error on ${table}:`, result.error);
  return result;
}

export async function dbSelect(table, query = {}) {
  const { filters = [], order = null, limit = null, single = false } = query;
  let q = supabase.from(table).select('*');
  for (const [col, val] of filters) q = q.eq(col, val);
  if (order) q = q.order(order.col, { ascending: order.asc ?? true });
  if (limit) q = q.limit(limit);
  if (single) q = q.single();
  const result = await q;
  if (result.error) console.error(`[DB] Select error on ${table}:`, result.error);
  return result;
}

// ============================================================
// ACTIVITY LOG HELPER
// ============================================================

export async function logActivity(entityType, entityId, action, metadata = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('activity_log').insert({
    entity_type: entityType,
    entity_id: entityId,
    action,
    performed_by: user.id,
    metadata,
  });
}
