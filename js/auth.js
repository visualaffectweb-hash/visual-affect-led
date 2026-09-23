// ============================================================
// auth.js — Login, register, session, roles
// ============================================================

import { supabase, logActivity } from './supabase.js';

// ============================================================
// SESSION STATE
// ============================================================

let currentUser = null;    // Supabase auth user
let currentProfile = null; // Our profiles table row

export function getUser() { return currentUser; }
export function getProfile() { return currentProfile; }
export function getRole() { return currentProfile?.role || null; }
export function isAdmin() { return getRole() === 'admin'; }
export function isManager() { return getRole() === 'manager'; }
export function isTechnician() { return getRole() === 'technician'; }
export function canEditInventory() { return ['admin', 'manager'].includes(getRole()); }
export function canCreateProposals() { return ['admin', 'manager'].includes(getRole()); }
export function canApproveInvoices() { return getRole() === 'admin'; }
export function canViewAllProjects() { return getRole() === 'admin'; }
export function canManageUsers() { return getRole() === 'admin'; }

// ============================================================
// INITIALIZE — Call on app load
// ============================================================

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user) {
    currentUser = session.user;
    await loadProfile(session.user.id);
    if (currentProfile?.role === 'deactivated') {
      // Account was deactivated while a session persisted — force sign out
      await supabase.auth.signOut();
      currentUser = null;
      currentProfile = null;
      return false;
    }
    return true; // already logged in
  }

  // Listen for auth state changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      await loadProfile(session.user.id);
      document.dispatchEvent(new CustomEvent('va:signed-in', { detail: { user: currentUser, profile: currentProfile } }));
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
      document.dispatchEvent(new CustomEvent('va:signed-out'));
    }
  });

  return false;
}

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('[Auth] Failed to load profile:', error);
    return;
  }

  currentProfile = data;
  document.dispatchEvent(new CustomEvent('va:profile-loaded', { detail: data }));
}

// ============================================================
// LOGIN
// ============================================================

export async function login(usernameOrEmail, password) {
  // Accept either username (jklass) or full email
  const email = usernameOrEmail.includes('@')
    ? usernameOrEmail
    : await resolveUsernameToEmail(usernameOrEmail);

  if (!email) {
    return { error: { message: 'Username not found.' } };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error('[Auth] Login error:', error);
    return { error };
  }

  currentUser = data.user;
  await loadProfile(data.user.id);
  if (currentProfile?.role === 'deactivated') {
    await supabase.auth.signOut();
    currentUser = null;
    currentProfile = null;
    return { error: { message: 'This account has been deactivated. Contact your administrator.' } };
  }
  await logActivity('auth', data.user.id, 'login');

  return { user: currentUser, profile: currentProfile };
}

// Allow login with username by looking up email from profiles
async function resolveUsernameToEmail(username) {
  // We store username as part of user metadata or derive from profiles
  // For now, try matching against known pattern or stored metadata
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .single();

  if (error || !data) {
    // Fallback: try as email directly
    return null;
  }

  // Get email from auth.users via RPC
  const { data: emailData } = await supabase
    .rpc('get_email_by_profile_id', { profile_id: data.id });

  return emailData || null;
}

// ============================================================
// REGISTER (creates user + profile, role always = technician)
// ============================================================

export async function register({ firstName, lastName, email, phone, password }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        role: 'technician', // always — no self-promotion
      },
    },
  });

  if (error) {
    console.error('[Auth] Register error:', error);
    return { error };
  }

  // Profile is auto-created by the DB trigger
  // Update phone separately since trigger doesn't handle it
  if (data.user) {
    await supabase
      .from('profiles')
      .update({ phone, first_name: firstName, last_name: lastName })
      .eq('id', data.user.id);

    await logActivity('auth', data.user.id, 'register');
  }

  return { user: data.user };
}

// ============================================================
// LOGOUT
// ============================================================

export async function logout() {
  if (currentUser) {
    await logActivity('auth', currentUser.id, 'logout');
  }
  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
}

// ============================================================
// UPDATE PROFILE
// ============================================================

export async function updateProfile(updates) {
  if (!currentUser) return { error: { message: 'Not logged in.' } };

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', currentUser.id)
    .select()
    .single();

  if (error) {
    console.error('[Auth] Profile update error:', error);
    return { error };
  }

  currentProfile = data;
  return { profile: data };
}

// ============================================================
// ADMIN: GET ALL USERS
// ============================================================

export async function getAllUsers() {
  if (!isAdmin()) return { error: { message: 'Admin only.' }, data: [] };

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });

  return { data: data || [], error };
}

// ============================================================
// ADMIN: UPDATE USER ROLE
// ============================================================

export async function setUserRole(userId, role) {
  if (!isAdmin()) return { error: { message: 'Admin only.' } };

  // Prevent removing your own admin
  if (userId === currentUser?.id && role !== 'admin') {
    return { error: { message: 'You cannot remove your own admin role.' } };
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select()
    .single();

  if (!error) await logActivity('admin', userId, 'role_change', { new_role: role });
  return { data, error };
}

// ============================================================
// ADMIN: USER MANAGEMENT
// ============================================================
// NOTE: Creating or deleting Supabase auth users requires the
// service-role key and cannot be done from the browser. Admins
// manage access via deactivateUser/reactivateUser in admin.js,
// which sets the profile role to 'deactivated'. The login flow
// refuses sign-in for deactivated profiles (see login/initAuth).
// To fully delete an auth user, use the Supabase dashboard.
