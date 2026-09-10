/*
 * Habitly runtime configuration.
 *
 * SECURITY RULE:
 * Never ship a fake Supabase client. If real credentials are not supplied,
 * Habitly fails closed and the auth gate stays locked instead of silently
 * authenticating every browser as the same test account.
 *
 * Replace the empty values below with the public Supabase project URL/anon key
 * for the project used by Habitly. The anon key is intended for browser use;
 * NEVER put a Supabase service-role key in this file.
 */
(() => {
  'use strict';

  // Public project configuration recovered from the user's older working build.
  // These are browser-safe publishable values; never use a service-role key here.
  const BUILTIN_CONFIG = {
    supabaseUrl: 'https://fgnwvfsaaknghcpprwpa.supabase.co',
    supabaseAnonKey: 'sb_publishable_xgDqvKH2fs231k_HAbxLxA_rAm65Xmw',
    adminEmail: 'prem.cybersecurity@gmail.com',
    googleDriveClientId: '223799808047-ing6k17igskjv3n1f01mt5jmf77unu6k.apps.googleusercontent.com'
  };

  const supplied = (window.HABITLY_RUNTIME_CONFIG && typeof window.HABITLY_RUNTIME_CONFIG === 'object')
    ? window.HABITLY_RUNTIME_CONFIG
    : {};

  const config = {
    supabaseUrl: String(supplied.supabaseUrl || BUILTIN_CONFIG.supabaseUrl || '').trim(),
    supabaseAnonKey: String(supplied.supabaseAnonKey || BUILTIN_CONFIG.supabaseAnonKey || '').trim(),
    adminEmail: String(supplied.adminEmail || BUILTIN_CONFIG.adminEmail || '').trim(),
    googleDriveClientId: String(supplied.googleDriveClientId || BUILTIN_CONFIG.googleDriveClientId || '').trim()
  };

  window.HABITLY_CONFIG = config;

  const validUrl = /^https:\/\/[^\s/]+\.supabase\.co(?:\/.*)?$/i.test(config.supabaseUrl);
  const hasAnonKey = config.supabaseAnonKey.length > 20;
  const canCreateClient = !!window.supabase?.createClient;

  if (!validUrl || !hasAnonKey || !canCreateClient) {
    console.error(
      '[Habitly] Supabase is not configured. Set HABITLY_RUNTIME_CONFIG.supabaseUrl and supabaseAnonKey before deployment. The app will not create a fake authentication/cloud client.'
    );
    window.habitlySupabase = null;
    window.habitlyAuth = null;
    window.habitlyConfigError = 'Supabase configuration is missing or invalid.';
    return;
  }

  try {
    const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    window.habitlySupabase = client;
    window.habitlyAuth = client;
    window.habitlyConfigError = '';
  } catch (error) {
    console.error('[Habitly] Supabase client initialization failed:', error);
    window.habitlySupabase = null;
    window.habitlyAuth = null;
    window.habitlyConfigError = 'Supabase client initialization failed.';
  }
})();
