(function(){
  'use strict';

  const gate = document.getElementById('auth-gate');
  if (!gate) return;

  const iframe = gate.querySelector('iframe');
  const app = document.getElementById('app');
  const sb = window.habitlySupabase;

  function setGate(open) {
    gate.classList.toggle('is-hidden', !open);
    document.body.classList.toggle('auth-gate-active', open);
    if (app) app.setAttribute('aria-hidden', open ? 'true' : 'false');
  }

  function goDashboard() {
    setGate(false);
    if (location.hash !== '#/dashboard') {
      location.hash = '/dashboard';
    }
  }

  function goLogin() {
    setGate(true);
    if (location.hash !== '#/login') {
      history.replaceState(null, '', '#/login');
    }
  }

  async function syncAuthState() {
    if (!sb) {
      console.error('Habitly Supabase client was not initialized.');
      goLogin();
      return;
    }

    const { data, error } = await sb.auth.getSession();

    if (error) {
      console.error('Could not read Habitly authentication session:', error);
      goLogin();
      return;
    }

    if (data.session?.user) {
      if (location.hash === '#/login' || !location.hash) {
        history.replaceState(null, '', '#/dashboard');
      }
      setGate(false);
    } else {
      goLogin();
    }
  }

  // Supabase is now the source of truth. The old
  // habitly.auth.session localStorage demo session is no longer used.
  try {
    localStorage.removeItem('habitly.auth.session');
  } catch (_) {}

  // Make Login the visible starting page until Supabase confirms a session.
  setGate(true);
  syncAuthState();

  if (sb) {
    sb.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        goDashboard();
      } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        goLogin();
      }
    });
  }

  window.addEventListener('message', function(event) {
    if (!iframe || event.source !== iframe.contentWindow) return;

    const data = event.data || {};
    if (data.source !== 'habitly-auth') return;

    if (data.type === 'AUTH_SUCCESS') {
      goDashboard();
    }
  });
})();
