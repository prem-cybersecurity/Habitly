(function(){
  const SESSION_KEY='habitly.auth.session';
  const gate=document.getElementById('auth-gate');
  if(!gate)return;
  const iframe=gate.querySelector('iframe');
  const app=document.getElementById('app');

  function hasSession(){
    try{
      const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
      return !!(s&&s.loggedIn&&s.email);
    }catch{return false;}
  }
  function setGate(open){
    gate.classList.toggle('is-hidden',!open);
    document.body.classList.toggle('auth-gate-active',open);
    if(app)app.setAttribute('aria-hidden',open?'true':'false');
  }
  function goDashboard(){
    setGate(false);
    if(location.hash!=='#/dashboard') location.hash='/dashboard';
  }

  // Make Login the visible starting page for an unauthenticated browser session.
  if(!hasSession()){
    if(location.hash!=='#/login') history.replaceState(null,'','#/login');
    setGate(true);
  }else{
    if(location.hash==='#/login'||!location.hash) history.replaceState(null,'','#/dashboard');
    setGate(false);
  }

  window.addEventListener('message',function(event){
    const iframe=document.querySelector('#auth-gate iframe');
    if(event.source!==iframe.contentWindow)return;
    const data=event.data||{};
    if(data.source!=='habitly-auth')return;
    if(data.type==='AUTH_SUCCESS') goDashboard();
  });

  window.addEventListener('storage',function(event){
    if(event.key!==SESSION_KEY)return;
    if(hasSession())goDashboard();
    else setGate(true);
  });
})();
