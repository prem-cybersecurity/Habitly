(function(){
  'use strict';

  const gate = document.getElementById('auth-gate');
  if (!gate) return;

  const iframe = gate.querySelector('iframe');
  const app = document.getElementById('app');
  const sb = window.habitlySupabase;
  let iframeReady = false;
  let pendingRoute = null;

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

  function sendAuthRoute(route) {
    pendingRoute = route;
    if (!iframeReady || !iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({
        source: 'habitly-gate',
        type: 'AUTH_ROUTE',
        route
      }, '*');
      pendingRoute = null;
    } catch (_) {}
  }

  function goLogin() {
    setGate(true);
    if (location.hash !== '#/login') {
      history.replaceState(null, '', '#/login');
    }
    sendAuthRoute('login');
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

  // The iframe can finish loading after goLogin() runs. Replay the
  // requested route as soon as its auth UI is actually ready.
  if (iframe) {
    iframe.addEventListener('load', () => {
      iframeReady = true;
      if (pendingRoute) sendAuthRoute(pendingRoute);
    });
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
      // This is the single parent-level auth listener. The main app consumes
      // this event instead of registering another Supabase listener.
      window.dispatchEvent(new CustomEvent('habitly-auth-state', { detail: { event, session } }));
      if (session?.user) {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') goDashboard();
      } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
        goLogin();
      }
      // TOKEN_REFRESHED, USER_UPDATED and PASSWORD_RECOVERY never force a
      // dashboard navigation here.
    });
  }

  window.addEventListener('message', function(event) {
    if (!iframe || event.source !== iframe.contentWindow) return;

    const data = event.data || {};
    if (data.source !== 'habitly-auth') return;

    if (data.type === 'AUTH_READY') {
      iframeReady = true;
      if (pendingRoute) sendAuthRoute(pendingRoute);
      return;
    }

  });
})();
