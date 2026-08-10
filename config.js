// Habitly configuration.
// The publishable key is safe for browser use; NEVER put a Supabase secret/service-role key here.
window.HABITLY_CONFIG = {
  supabaseUrl: 'https://fgnwvfsaaknghcpprwpa.supabase.co',
  supabaseAnonKey: 'sb_publishable_xgDqvKH2fs231k_HAbxLxA_rAm65Xmw',
  // This identifies the intended admin account. The database admin role is still required.
  adminEmail: 'prem.cybersecurity@gmail.com'
};

window.habitlySupabase = null;
if (window.HABITLY_CONFIG.supabaseUrl && window.HABITLY_CONFIG.supabaseAnonKey && window.supabase) {
  window.habitlySupabase = window.supabase.createClient(
    window.HABITLY_CONFIG.supabaseUrl,
    window.HABITLY_CONFIG.supabaseAnonKey
  );
}
