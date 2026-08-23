// Habitly configuration.
// The publishable key is safe for browser use; NEVER put a Supabase secret/service-role key here.
window.HABITLY_CONFIG = {
  supabaseUrl: 'https://fgnwvfsaaknghcpprwpa.supabase.co',
  supabaseAnonKey: 'sb_publishable_xgDqvKH2fs231k_HAbxLxA_rAm65Xmw',
  // This identifies the intended admin account. The database admin role is still required.
  adminEmail: 'prem.cybersecurity@gmail.com',
  // Google OAuth Web Client ID used only when the user explicitly connects Google Drive.
  // This is safe to expose in frontend code; never put a Google client secret here.
  googleDriveClientId: '223799808047-ing6k17igskjv3n1f01mt5jmf77unu6k.apps.googleusercontent.com'
};

window.habitlySupabase = null;
if (window.HABITLY_CONFIG.supabaseUrl && window.HABITLY_CONFIG.supabaseAnonKey && window.supabase) {
  window.habitlySupabase = window.supabase.createClient(
    window.HABITLY_CONFIG.supabaseUrl,
    window.HABITLY_CONFIG.supabaseAnonKey
  );
}

// Shared client name used by the authentication UI.
// Keep a single Supabase client for the whole Habitly application.
window.habitlyAuth = window.habitlySupabase;
