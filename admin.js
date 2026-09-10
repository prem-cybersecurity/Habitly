'use strict';
const sb = window.habitlySupabase;
const loginCard = document.getElementById('loginCard');
const dashboardCard = document.getElementById('dashboardCard');
const loginError = document.getElementById('loginError');
const dashboardError = document.getElementById('dashboardError');
const tbody = document.getElementById('visitorTableBody');
const empty = document.getElementById('emptyVisitors');

function configured(){ return !!sb; }
function fmt(iso){ if(!iso) return '—'; const d=new Date(iso); return Number.isNaN(d.getTime())?'—':d.toLocaleString([], {dateStyle:'medium', timeStyle:'short'}); }
async function isAdmin(){
  if(!sb) return false;
  const { data: { user } } = await sb.auth.getUser();
  const configuredEmail = (window.HABITLY_CONFIG?.adminEmail || '').trim().toLowerCase();
  if(!user || !configuredEmail || (user.email || '').toLowerCase() !== configuredEmail) return false;
  const { data, error } = await sb.rpc('is_admin');
  return !error && data === true;
}
async function loadVisitors(){
  dashboardError.textContent='';
  const { data, error } = await sb.from('visitors').select('name,email,first_seen_at,last_seen_at,visit_count').order('last_seen_at',{ascending:false});
  if(error){ dashboardError.textContent=error.message; return; }
  const rows=Array.isArray(data)?data:[];
  tbody.innerHTML='';
  document.getElementById('visitorCount').textContent=rows.length;
  document.getElementById('lastJoined').textContent=rows[0]?.last_seen_at ? new Date(rows[0].last_seen_at).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}) : '—';
  empty.style.display=rows.length?'none':'block';
  rows.forEach(v=>{
    const tr=document.createElement('tr');
    [v.name,v.email,fmt(v.first_seen_at),fmt(v.last_seen_at),v.visit_count||1].forEach(value=>{const td=document.createElement('td');td.textContent=String(value??'—');tr.appendChild(td);});
    tbody.appendChild(tr);
  });
}
async function showDashboard(){ loginCard.classList.add('hidden'); dashboardCard.classList.remove('hidden'); await loadVisitors(); }

document.getElementById('loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); loginError.textContent='';
  if(!configured()){loginError.textContent='Supabase is not configured. Check config.js.';return;}
  const email=document.getElementById('adminEmail').value.trim();
  const password=document.getElementById('adminPassword').value;
  const {error}=await sb.auth.signInWithPassword({email,password});
  if(error){loginError.textContent=error.message;return;}
  if(!(await isAdmin())){await sb.auth.signOut();loginError.textContent='This account is not authorized as a Habitly admin.';return;}
  await showDashboard();
});

document.getElementById('logoutBtn').addEventListener('click',async()=>{await sb.auth.signOut();dashboardCard.classList.add('hidden');loginCard.classList.remove('hidden');loginError.textContent='';});

(async()=>{
  if(!configured()){loginError.textContent='Admin mode is waiting for Supabase configuration.';return;}
  const {data:{session}}=await sb.auth.getSession();
  if(session && await isAdmin()) await showDashboard();
})();
