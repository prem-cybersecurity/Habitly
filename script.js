'use strict';

/* =========================================================================
   HABITLY — Personal Habit Tracker
   Pure vanilla JS. All data persisted to LocalStorage.
   ========================================================================= */

/* ---------------------------- DATE UTILITIES ---------------------------- */

function pad2(n){ return String(n).padStart(2,'0'); }

function formatLocalDate(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function parseLocalDate(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}
function todayStr(){ return formatLocalDate(new Date()); }
function addDaysStr(dateStr, n){
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate()+n);
  return formatLocalDate(d);
}
function weekdayIndexMonFirst(dateStr){
  // 0 = Monday ... 6 = Sunday
  const jsDay = parseLocalDate(dateStr).getDay(); // 0=Sun..6=Sat
  return (jsDay + 6) % 7;
}
const WEEKDAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatPrettyDate(dateStr){
  const d = parseLocalDate(dateStr);
  const jsDay = d.getDay();
  const dowNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return `${dowNames[jsDay]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function formatShortDate(dateStr){
  const d = parseLocalDate(dateStr);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

/* ------------------------------ LOCALSTORAGE ----------------------------- */

const LS_KEYS = {
  habits: 'habitly_habits',
  records: 'habitly_records',
  goals: 'habitly_goals',
  achievements: 'habitly_achievements',
  notes: 'habitly_notes',
  settings: 'habitly_settings',
  profile: 'habitly_profile',
  seeded: 'habitly_seeded'
};

function lsGet(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(raw === null) return fallback;
    return JSON.parse(raw);
  }catch(e){
    console.error('Failed to read', key, e);
    return fallback;
  }
}
function lsSet(key, value){
  try{
    localStorage.setItem(key, JSON.stringify(value));
  }catch(e){
    console.error('Failed to write', key, e);
    showToast('⚠️ Could not save data (storage full?)');
  }
}

function uid(prefix){
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
}

/* ------------------------------- APP STATE -------------------------------- */

const state = {
  habits: [],
  records: {},
  goals: [],
  achievementsUnlocked: {},
  notes: {},
  settings: { theme: 'dark' },
  currentView: 'dashboard',
  dashboardCategoryFilter: 'all',
  manageCategoryFilter: 'all',
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  selectedDate: todayStr(),
  statsRange: '7',
  editingHabitId: null,
  editingGoalId: null,
  confirmCallback: null,
  profile: null,
  notificationTimer: null
};

function defaultHabits(){
  const t = todayStr();
  return [
    { id: uid('h'), name:'Drink Water', icon:'💧', category:'Health', type:'quantity', target:3, unit:'L', frequency:'daily', days:[], reminder:'', enabled:true, createdAt:t, step:0.25 },
    { id: uid('h'), name:'Eat Meals', icon:'🍛', category:'Health', type:'count', target:3, unit:'meals', items:['Breakfast','Lunch','Dinner'], frequency:'daily', days:[], reminder:'', enabled:true, createdAt:t },
    { id: uid('h'), name:'Drink Milk', icon:'🥛', category:'Health', type:'quantity', target:1, unit:'glass', frequency:'daily', days:[], reminder:'20:00', enabled:true, createdAt:t, step:1 },
    { id: uid('h'), name:'Exercise', icon:'🏃', category:'Fitness', type:'quantity', target:30, unit:'minutes', frequency:'daily', days:[], reminder:'', enabled:true, createdAt:t, step:5 },
    { id: uid('h'), name:'Study', icon:'📚', category:'Study', type:'quantity', target:2, unit:'hours', frequency:'daily', days:[], reminder:'21:30', enabled:true, createdAt:t, step:0.5 },
    { id: uid('h'), name:'Sleep on Time', icon:'🌙', category:'Personal', type:'quantity', target:8, unit:'hours', frequency:'daily', days:[], reminder:'', enabled:true, createdAt:t, step:0.5 }
  ];
}

function loadState(){
  const seeded = lsGet(LS_KEYS.seeded, false);
  if(!seeded){
    state.habits = defaultHabits();
    state.records = {};
    state.goals = [];
    state.achievementsUnlocked = {};
    state.notes = {};
    state.settings = { theme: 'dark' };
    state.profile = null;
    persistAll();
    lsSet(LS_KEYS.profile, null);
    lsSet(LS_KEYS.seeded, true);
  } else {
    state.habits = lsGet(LS_KEYS.habits, []);
    // Keep the starter habit presentation aligned with the current colorful UI.
    state.habits.forEach(h => {
      if(h.name === 'Sleep' && h.category === 'Personal'){ h.name = 'Sleep on Time'; h.icon = '🌙'; }
      if(h.name === 'Drink Water') h.icon = '💧';
      if(h.name === 'Eat Meals') h.icon = '🥗';
      if(h.name === 'Drink Milk') h.icon = '🥛';
      if(h.name === 'Exercise') h.icon = '🏃';
      if(h.name === 'Study') h.icon = '📚';
    });
    state.records = lsGet(LS_KEYS.records, {});
    state.goals = lsGet(LS_KEYS.goals, []);
    state.achievementsUnlocked = lsGet(LS_KEYS.achievements, {});
    state.notes = lsGet(LS_KEYS.notes, {});
    state.settings = lsGet(LS_KEYS.settings, { theme: 'dark' });
    if (!state.settings?.theme) state.settings = { ...state.settings, theme: 'dark' };
    state.profile = lsGet(LS_KEYS.profile, null);
    saveHabits();
  }
}

function persistAll(){
  lsSet(LS_KEYS.habits, state.habits);
  lsSet(LS_KEYS.records, state.records);
  lsSet(LS_KEYS.goals, state.goals);
  lsSet(LS_KEYS.achievements, state.achievementsUnlocked);
  lsSet(LS_KEYS.notes, state.notes);
  lsSet(LS_KEYS.settings, state.settings);
  lsSet(LS_KEYS.profile, state.profile);
}
function saveHabits(){ lsSet(LS_KEYS.habits, state.habits); }
function saveRecords(){ lsSet(LS_KEYS.records, state.records); }
function saveGoals(){ lsSet(LS_KEYS.goals, state.goals); }
function saveAchievements(){ lsSet(LS_KEYS.achievements, state.achievementsUnlocked); }
function saveNotes(){ lsSet(LS_KEYS.notes, state.notes); }
function saveSettings(){ lsSet(LS_KEYS.settings, state.settings); }

/* ---------------------------- HABIT / RECORD LOGIC ---------------------------- */

function isHabitScheduledOnDate(habit, dateStr){
  if(dateStr < habit.createdAt) return false;
  if(habit.frequency === 'daily') return true;
  const idx = weekdayIndexMonFirst(dateStr); // 0=Mon..6=Sun
  const jsDay = (idx + 1) % 7; // convert back to JS 0=Sun..6=Sat to match stored days
  return Array.isArray(habit.days) && habit.days.includes(jsDay);
}

function getRecord(dateStr, habitId){
  return (state.records[dateStr] && state.records[dateStr][habitId]) || null;
}

function ensureRecord(dateStr, habit){
  if(!state.records[dateStr]) state.records[dateStr] = {};
  if(!state.records[dateStr][habit.id]){
    let base;
    if(habit.type === 'boolean') base = { completed:false };
    else if(habit.type === 'quantity') base = { value:0, completed:false };
    else base = { items: (habit.items||[]).map(()=>false), completed:false };
    state.records[dateStr][habit.id] = base;
  }
  return state.records[dateStr][habit.id];
}

function computeCompleted(habit, record){
  if(habit.type === 'boolean') return !!record.completed;
  if(habit.type === 'quantity') return record.value >= habit.target;
  if(habit.type === 'count'){
    const doneCount = (record.items||[]).filter(Boolean).length;
    return doneCount >= habit.target;
  }
  return false;
}

function getScheduledHabitsForDate(dateStr, includeDisabled){
  return state.habits.filter(h => (includeDisabled || h.enabled) && isHabitScheduledOnDate(h, dateStr));
}

function getDayStats(dateStr){
  const habits = getScheduledHabitsForDate(dateStr, false);
  if(habits.length === 0) return { scheduled:0, completed:0, pct:0, status:'none' };
  let completed = 0;
  habits.forEach(h=>{
    const rec = getRecord(dateStr, h.id);
    if(rec && rec.completed) completed++;
  });
  const pct = Math.round((completed/habits.length)*100);
  const status = pct === 100 ? 'full' : (pct === 0 ? 'none' : 'partial');
  return { scheduled: habits.length, completed, pct, status };
}

/* ---------------------------- STREAK CALCULATIONS ---------------------------- */

function calcHabitStreaks(habit){
  const today = todayStr();
  let current = 0;
  let d = new Date();
  while(true){
    const ds = formatLocalDate(d);
    if(ds < habit.createdAt) break;
    if(isHabitScheduledOnDate(habit, ds)){
      const rec = getRecord(ds, habit.id);
      const done = rec && rec.completed;
      if(done){ current++; }
      else if(ds === today){ /* today not done yet - don't break, just skip */ }
      else { break; }
    }
    d.setDate(d.getDate()-1);
    if(formatLocalDate(d) < habit.createdAt) break;
  }

  let best = 0, running = 0;
  const start = parseLocalDate(habit.createdAt);
  const end = new Date();
  for(let dt = new Date(start); dt <= end; dt.setDate(dt.getDate()+1)){
    const ds = formatLocalDate(dt);
    if(isHabitScheduledOnDate(habit, ds)){
      const rec = getRecord(ds, habit.id);
      if(rec && rec.completed){ running++; best = Math.max(best, running); }
      else running = 0;
    }
  }
  best = Math.max(best, current);
  return { current, best };
}

function calcOverallDayStreak(){
  // consecutive "full" days ending today (today exempt if not yet full)
  const today = todayStr();
  let current = 0;
  let d = new Date();
  while(true){
    const ds = formatLocalDate(d);
    const stats = getDayStats(ds);
    if(stats.scheduled === 0){ d.setDate(d.getDate()-1); if(d < earliestHabitDate()) break; continue; }
    if(stats.status === 'full'){ current++; }
    else if(ds === today){ /* skip today if incomplete */ }
    else break;
    d.setDate(d.getDate()-1);
    if(d < earliestHabitDate()) break;
  }

  let best = 0, running = 0;
  const start = earliestHabitDate();
  const end = new Date();
  for(let dt = new Date(start); dt <= end; dt.setDate(dt.getDate()+1)){
    const ds = formatLocalDate(dt);
    const stats = getDayStats(ds);
    if(stats.scheduled === 0) continue;
    if(stats.status === 'full'){ running++; best = Math.max(best, running); }
    else running = 0;
  }
  best = Math.max(best, current);
  return { current, best };
}

function earliestHabitDate(){
  if(state.habits.length === 0) return parseLocalDate(todayStr());
  const dates = state.habits.map(h=>h.createdAt).sort();
  return parseLocalDate(dates[0]);
}

/* ------------------------------ ACHIEVEMENTS ------------------------------ */

const ACHIEVEMENT_DEFS = [
  { id:'first_step', icon:'🏅', title:'First Step', desc:'Complete your first habit.' },
  { id:'streak_7', icon:'🔥', title:'7-Day Streak', desc:'Maintain a habit for 7 days.' },
  { id:'streak_30', icon:'🔥', title:'30-Day Streak', desc:'Maintain a habit for 30 days.' },
  { id:'perfect_week', icon:'💯', title:'Perfect Week', desc:'Complete all active habits for 7 consecutive days.' },
  { id:'completions_100', icon:'🌟', title:'100 Completions', desc:'Complete 100 habit instances.' }
];

function totalCompletionsCount(){
  let count = 0;
  Object.values(state.records).forEach(dayRec=>{
    Object.values(dayRec).forEach(r=>{ if(r && r.completed) count++; });
  });
  return count;
}

function checkAchievements(){
  const unlockedNow = {};
  const totalCompletions = totalCompletionsCount();
  unlockedNow.first_step = totalCompletions >= 1;

  let maxBest = 0;
  state.habits.forEach(h=>{ const s = calcHabitStreaks(h); maxBest = Math.max(maxBest, s.best); });
  unlockedNow.streak_7 = maxBest >= 7;
  unlockedNow.streak_30 = maxBest >= 30;

  const overall = calcOverallDayStreak();
  unlockedNow.perfect_week = overall.best >= 7;
  unlockedNow.completions_100 = totalCompletions >= 100;

  let changed = false;
  ACHIEVEMENT_DEFS.forEach(def=>{
    if(unlockedNow[def.id] && !state.achievementsUnlocked[def.id]){
      state.achievementsUnlocked[def.id] = todayStr();
      changed = true;
      showToast(`🏅 Achievement unlocked: ${def.title}`);
    }
  });
  if(changed) saveAchievements();
}

/* --------------------------------- TOAST --------------------------------- */

let toastTimer = null;
function showToast(msg, duration=2600){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), duration);
}

/* -------------------------------- NAVIGATION ------------------------------- */

function setView(viewName){
  state.currentView = viewName;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b=> b.classList.toggle('active', b.dataset.view === viewName));
  document.querySelectorAll('.bnav-item').forEach(b=> b.classList.toggle('active', b.dataset.view === viewName));
  document.getElementById('mainContent').scrollTo({top:0, behavior:'instant' in window ? 'instant' : 'auto'});
  window.scrollTo(0,0);
  renderCurrentView();
}

function renderCurrentView(){
  switch(state.currentView){
    case 'dashboard': renderDashboard(); break;
    case 'habits': renderHabitsManage(); break;
    case 'history': renderHistory(); break;
    case 'statistics': renderStatistics(); break;
    case 'goals': renderGoals(); break;
    case 'achievements': renderAchievements(); break;
    case 'settings': renderSettings(); break;
  }
}

function refreshAfterMutation(){
  saveRecords();
  checkAchievements();
  renderCurrentView();
}

/* -------------------------------- DASHBOARD -------------------------------- */

function renderDashboard(){
  const now = new Date();
  const hour = now.getHours();
  let greet = 'Good Morning', sub = "Let's make today count.";
  const person = state.profile?.name || 'there';
  if(hour >= 5 && hour < 12){ greet = `Good Morning, ${person}! 👋`; }
  else if(hour >= 12 && hour < 17){ greet = `Good Afternoon, ${person}! ☀️`; }
  else if(hour >= 17 && hour < 21){ greet = `Good Evening, ${person}! 🌇`; }
  else { greet = `Good Night, ${person}! 🌙`; sub = 'Wind down and rest well.'; }
  document.getElementById('greeting').textContent = greet;
  document.getElementById('greetingSub').textContent = sub;
  document.getElementById('todayDate').textContent = formatPrettyDate(todayStr());

  const today = todayStr();
  const stats = getDayStats(today);
  const circumference = 2 * Math.PI * 60;
  const offset = circumference - (stats.pct/100) * circumference;
  document.getElementById('ringFg').style.strokeDasharray = circumference;
  document.getElementById('ringFg').style.strokeDashoffset = offset;
  document.getElementById('progressPct').textContent = `${stats.pct}%`;
  document.getElementById('progressFraction').textContent = `${stats.completed} / ${stats.scheduled} completed`;

  let motivation = '';
  if(stats.scheduled === 0) motivation = 'Add a habit to get started!';
  else if(stats.pct === 100) motivation = '🌟 Perfect day! All habits completed.';
  else if(stats.scheduled - stats.completed === 1) motivation = `💪 ${stats.completed}/${stats.scheduled} habits completed today. One more!`;
  document.getElementById('motivationMsg').textContent = motivation;

  const overall = calcOverallDayStreak();
  document.getElementById('currentStreakVal').textContent = overall.current;
  document.getElementById('bestStreakVal').textContent = overall.best;
  document.getElementById('completedTodayVal').textContent = `${stats.completed}/${stats.scheduled}`;

  // overall completion % across all history
  let totalSched = 0, totalDone = 0;
  const start = earliestHabitDate();
  for(let dt = new Date(start); dt <= now; dt.setDate(dt.getDate()+1)){
    const ds = formatLocalDate(dt);
    const ds_stats = getDayStats(ds);
    totalSched += ds_stats.scheduled;
    totalDone += ds_stats.completed;
  }
  const overallPct = totalSched ? Math.round((totalDone/totalSched)*100) : 0;
  document.getElementById('overallCompletionVal').textContent = `${overallPct}%`;

  renderTodayHabitsList();
  renderReminders();

  const noteInput = document.getElementById('dailyNoteInput');
  noteInput.value = state.notes[today] || '';
}

function renderTodayHabitsList(){
  const container = document.getElementById('todayHabitsList');
  const today = todayStr();
  let habits = getScheduledHabitsForDate(today, false);
  if(state.dashboardCategoryFilter !== 'all'){
    habits = habits.filter(h => h.category === state.dashboardCategoryFilter);
  }
  container.innerHTML = '';

  if(habits.length === 0){
    container.innerHTML = `<div class="empty-state"><span>🌱</span>No habits for today in this category.</div>`;
    return;
  }

  habits.forEach(habit=>{
    const rec = ensureRecord(today, habit);
    const card = document.createElement('div');
    card.className = 'habit-card' + (rec.completed ? ' completed' : '');

    const streaks = calcHabitStreaks(habit);

    const top = document.createElement('div');
    top.className = 'habit-top';
    top.innerHTML = `
      <div class="habit-info">
        <span class="habit-icon">${habit.icon}</span>
        <div>
          <div class="habit-name">${escapeHtml(habit.name)}</div>
          <div class="habit-cat">${habit.category}</div>
        </div>
      </div>
      <div class="habit-streak-badge">${streaks.current > 0 ? `🔥 ${streaks.current}d` : ''}</div>
    `;
    card.appendChild(top);

    const completeBtn = document.createElement('button');
    completeBtn.type = 'button';
    completeBtn.className = `habit-complete ${rec.completed ? 'is-complete' : ''}`;
    completeBtn.setAttribute('aria-label', rec.completed ? `Mark ${escapeHtml(habit.name)} incomplete` : `Complete ${escapeHtml(habit.name)}`);
    completeBtn.innerHTML = rec.completed ? '✓' : '';
    completeBtn.addEventListener('click', ()=> toggleHabitCompleteFromCard(habit.id));
    card.appendChild(completeBtn);

    if(habit.type === 'boolean'){
      const row = document.createElement('div');
      row.className = 'qty-control';
      row.innerHTML = `
        <button type="button" class="bool-toggle ${rec.completed?'checked':''}" data-habit="${habit.id}" aria-label="Mark ${escapeHtml(habit.name)} ${rec.completed?'incomplete':'complete'}">${rec.completed?'✓':''}</button>
        <span class="qty-value">${rec.completed ? 'Completed' : 'Not completed'}</span>
      `;
      row.querySelector('.bool-toggle').addEventListener('click', ()=> toggleBooleanHabit(habit.id));
      card.appendChild(row);
    } else if(habit.type === 'quantity'){
      const pct = Math.min(100, Math.round((rec.value/habit.target)*100)) || 0;
      const row = document.createElement('div');
      row.className = 'qty-control';
      row.innerHTML = `
        <button type="button" class="qty-btn" data-act="dec" aria-label="Decrease ${escapeHtml(habit.name)}">−</button>
        <span class="qty-value">${formatNum(rec.value)} / ${formatNum(habit.target)} ${escapeHtml(habit.unit||'')}</span>
        <button type="button" class="qty-btn" data-act="inc" aria-label="Increase ${escapeHtml(habit.name)}">+</button>
        <div class="progress-bar-track"><div class="progress-bar-fill ${rec.completed?'complete':''}" style="width:${pct}%"></div></div>
      `;
      row.querySelector('[data-act="dec"]').addEventListener('click', ()=> adjustQuantity(habit.id, -habit.step));
      row.querySelector('[data-act="inc"]').addEventListener('click', ()=> adjustQuantity(habit.id, habit.step));
      card.appendChild(row);
    } else if(habit.type === 'count'){
      const doneCount = rec.items.filter(Boolean).length;
      const row = document.createElement('div');
      row.innerHTML = `<div class="count-items"></div><div class="count-fraction" style="margin-top:8px;">${doneCount} / ${habit.target}</div>`;
      const itemsWrap = row.querySelector('.count-items');
      (habit.items||[]).forEach((label, idx)=>{
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'count-item-chip' + (rec.items[idx] ? ' checked' : '');
        chip.textContent = (rec.items[idx] ? '✓ ' : '') + label;
        chip.addEventListener('click', ()=> toggleCountItem(habit.id, idx));
        itemsWrap.appendChild(chip);
      });
      card.appendChild(row);
    }

    container.appendChild(card);
  });
}

function formatNum(n){
  n = Number(n) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
}

function toggleHabitCompleteFromCard(habitId){
  const habit = state.habits.find(h=>h.id===habitId);
  if(!habit) return;
  const today = todayStr();
  const rec = ensureRecord(today, habit);
  if(habit.type === 'boolean'){
    rec.completed = !rec.completed;
  } else if(habit.type === 'quantity'){
    if(rec.completed){
      rec.value = 0;
      rec.completed = false;
    } else {
      rec.value = habit.target;
      rec.completed = true;
    }
  } else if(habit.type === 'count'){
    const done = !!rec.completed;
    rec.items = (habit.items || []).map(()=> !done);
    rec.completed = !done;
  }
  refreshAfterMutation();
}

function toggleBooleanHabit(habitId){
  const habit = state.habits.find(h=>h.id===habitId);
  if(!habit) return;
  const today = todayStr();
  const rec = ensureRecord(today, habit);
  rec.completed = !rec.completed;
  refreshAfterMutation();
}

function adjustQuantity(habitId, delta){
  const habit = state.habits.find(h=>h.id===habitId);
  if(!habit) return;
  const today = todayStr();
  const rec = ensureRecord(today, habit);
  let val = Math.round(((rec.value||0) + delta) * 100) / 100;
  if(val < 0) val = 0;
  rec.value = val;
  rec.completed = computeCompleted(habit, rec);
  refreshAfterMutation();
}

function toggleCountItem(habitId, idx){
  const habit = state.habits.find(h=>h.id===habitId);
  if(!habit) return;
  const today = todayStr();
  const rec = ensureRecord(today, habit);
  rec.items[idx] = !rec.items[idx];
  rec.completed = computeCompleted(habit, rec);
  refreshAfterMutation();
}

function renderReminders(){
  const container = document.getElementById('remindersList');
  const today = todayStr();
  const items = state.habits
    .filter(h => h.enabled && h.reminder && isHabitScheduledOnDate(h, today))
    .filter(h => { const rec = getRecord(today, h.id); return !(rec && rec.completed); })
    .sort((a,b)=> a.reminder.localeCompare(b.reminder));

  if(items.length === 0){
    container.innerHTML = `<div class="empty-state"><span>⏰</span>No pending reminders. Nice work!</div>`;
    return;
  }
  container.innerHTML = items.map(h=>`
    <div class="reminder-item">
      <span class="reminder-time">${formatTime12(h.reminder)}</span>
      <span class="habit-icon">${h.icon}</span>
      <span class="reminder-name">${escapeHtml(h.name)}</span>
    </div>
  `).join('');
}

function formatTime12(t){
  if(!t) return '';
  const [h,m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if(h12 === 0) h12 = 12;
  return `${h12}:${pad2(m)} ${period}`;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/* -------------------------------- HABITS MANAGE -------------------------------- */

function renderHabitsManage(){
  const container = document.getElementById('habitsManageList');
  let habits = state.habits.slice();
  if(state.manageCategoryFilter !== 'all'){
    habits = habits.filter(h => h.category === state.manageCategoryFilter);
  }
  container.innerHTML = '';
  if(habits.length === 0){
    container.innerHTML = `<div class="empty-state"><span>📋</span>No habits yet. Click "+ Add Habit" to create one.</div>`;
    return;
  }
  habits.forEach(habit=>{
    const streaks = calcHabitStreaks(habit);
    const card = document.createElement('div');
    card.className = 'card manage-card' + (habit.enabled ? '' : ' disabled');
    let metaBits = [`${habit.category}`, typeLabel(habit)];
    if(habit.frequency === 'custom' && habit.days && habit.days.length){
      const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      metaBits.push(habit.days.slice().sort().map(d=>names[d]).join(','));
    } else {
      metaBits.push('Daily');
    }
    if(habit.reminder) metaBits.push(`⏰ ${formatTime12(habit.reminder)}`);
    metaBits.push(`🔥${streaks.current} 🏆${streaks.best}`);

    card.innerHTML = `
      <div class="manage-left">
        <span class="habit-icon">${habit.icon}</span>
        <div>
          <div class="habit-name">${escapeHtml(habit.name)}</div>
          <div class="manage-meta">${metaBits.join(' · ')}</div>
        </div>
      </div>
      <div class="manage-actions">
        <label class="switch" title="Enable/disable">
          <input type="checkbox" ${habit.enabled?'checked':''} data-toggle="${habit.id}" />
          <span class="switch-track"></span>
        </label>
        <button class="btn-icon-sm" data-edit="${habit.id}" aria-label="Edit ${escapeHtml(habit.name)}">✎</button>
        <button class="btn-icon-sm" data-delete="${habit.id}" aria-label="Delete ${escapeHtml(habit.name)}">🗑</button>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('[data-toggle]').forEach(el=>{
    el.addEventListener('change', ()=>{
      const habit = state.habits.find(h=>h.id===el.dataset.toggle);
      habit.enabled = el.checked;
      saveHabits();
      renderHabitsManage();
    });
  });
  container.querySelectorAll('[data-edit]').forEach(el=>{
    el.addEventListener('click', ()=> openEditHabitModal(el.dataset.edit));
  });
  container.querySelectorAll('[data-delete]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const habit = state.habits.find(h=>h.id===el.dataset.delete);
      showConfirm('Delete habit?', `"${habit.name}" and its historical records will be removed. This cannot be undone.`, ()=>{
        state.habits = state.habits.filter(h=>h.id!==habit.id);
        saveHabits();
        renderHabitsManage();
        showToast('Habit deleted');
      });
    });
  });
}

function typeLabel(habit){
  if(habit.type === 'boolean') return 'Yes/No';
  if(habit.type === 'quantity') return `${formatNum(habit.target)} ${habit.unit||''}`.trim();
  if(habit.type === 'count') return `${habit.target}/${(habit.items||[]).length} items`;
  return '';
}

/* -------------------------------- HABIT MODAL -------------------------------- */

function openAddHabitModal(){
  state.editingHabitId = null;
  document.getElementById('habitModalTitle').textContent = 'Add Habit';
  document.getElementById('submitHabitBtn').textContent = 'Create Habit';
  const form = document.getElementById('habitForm');
  form.reset();
  document.querySelector('input[name="habitType"][value="boolean"]').checked = true;
  document.querySelector('input[name="habitFrequency"][value="daily"]').checked = true;
  document.getElementById('habitTarget').value = 1;
  document.querySelectorAll('.day-chip').forEach(c=>c.classList.remove('selected'));
  updateHabitFormVisibility();
  document.getElementById('habitModalOverlay').classList.add('open');
  document.getElementById('habitName').focus();
}

function openEditHabitModal(habitId){
  const habit = state.habits.find(h=>h.id===habitId);
  if(!habit) return;
  state.editingHabitId = habitId;
  document.getElementById('habitModalTitle').textContent = 'Edit Habit';
  document.getElementById('submitHabitBtn').textContent = 'Save Changes';
  document.getElementById('habitName').value = habit.name;
  document.getElementById('habitIcon').value = habit.icon;
  document.getElementById('habitCategory').value = habit.category;
  document.querySelector(`input[name="habitType"][value="${habit.type}"]`).checked = true;
  document.getElementById('habitTarget').value = habit.target;
  document.getElementById('habitUnit').value = habit.unit || '';
  document.getElementById('habitCountItems').value = (habit.items||[]).join(', ');
  document.querySelector(`input[name="habitFrequency"][value="${habit.frequency}"]`).checked = true;
  document.querySelectorAll('.day-chip').forEach(c=>{
    c.classList.toggle('selected', (habit.days||[]).includes(Number(c.dataset.day)));
  });
  document.getElementById('habitReminder').value = habit.reminder || '';
  updateHabitFormVisibility();
  document.getElementById('habitModalOverlay').classList.add('open');
}

function closeHabitModal(){
  document.getElementById('habitModalOverlay').classList.remove('open');
}

function updateHabitFormVisibility(){
  const type = document.querySelector('input[name="habitType"]:checked').value;
  const targetUnitRow = document.getElementById('targetUnitRow');
  const unitField = document.getElementById('unitField');
  const countItemsField = document.getElementById('countItemsField');
  const targetLabel = document.getElementById('targetLabel');

  if(type === 'boolean'){
    targetUnitRow.style.display = 'none';
    countItemsField.style.display = 'none';
  } else if(type === 'quantity'){
    targetUnitRow.style.display = 'grid';
    unitField.style.display = 'flex';
    targetLabel.textContent = 'Target';
    countItemsField.style.display = 'none';
  } else if(type === 'count'){
    targetUnitRow.style.display = 'grid';
    unitField.style.display = 'none';
    targetLabel.textContent = 'Target (# to complete)';
    countItemsField.style.display = 'flex';
  }

  const freq = document.querySelector('input[name="habitFrequency"]:checked').value;
  document.getElementById('daysPicker').style.display = freq === 'custom' ? 'flex' : 'none';
}

function handleHabitFormSubmit(e){
  e.preventDefault();
  const name = document.getElementById('habitName').value.trim();
  const icon = document.getElementById('habitIcon').value.trim() || '⭐';
  const category = document.getElementById('habitCategory').value;
  const type = document.querySelector('input[name="habitType"]:checked').value;
  const frequency = document.querySelector('input[name="habitFrequency"]:checked').value;
  const reminder = document.getElementById('habitReminder').value;

  if(!name){ showToast('Please enter a habit name'); return; }

  let target = 1, unit = '', items = [], step = 1;

  if(type === 'quantity'){
    target = parseFloat(document.getElementById('habitTarget').value);
    unit = document.getElementById('habitUnit').value.trim() || 'units';
    if(!target || target <= 0){ showToast('Target must be greater than 0'); return; }
    step = target >= 20 ? 5 : target >= 5 ? 0.5 : 0.25;
  } else if(type === 'count'){
    const raw = document.getElementById('habitCountItems').value.trim();
    items = raw.split(',').map(s=>s.trim()).filter(Boolean);
    if(items.length === 0){ showToast('Add at least one count item'); return; }
    target = parseInt(document.getElementById('habitTarget').value, 10);
    if(!target || target <= 0) target = items.length;
    if(target > items.length) target = items.length;
  } else {
    target = 1;
  }

  let days = [];
  if(frequency === 'custom'){
    days = Array.from(document.querySelectorAll('.day-chip.selected')).map(c=>Number(c.dataset.day));
    if(days.length === 0){ showToast('Select at least one day, or choose Daily'); return; }
  }

  if(state.editingHabitId){
    const habit = state.habits.find(h=>h.id===state.editingHabitId);
    Object.assign(habit, { name, icon, category, type, target, unit, items, frequency, days, reminder, step: habit.step || step });
    if(type === 'quantity') habit.step = step;
    showToast('Habit updated');
  } else {
    state.habits.push({
      id: uid('h'), name, icon, category, type, target, unit, items,
      frequency, days, reminder, enabled:true, createdAt: todayStr(), step
    });
    showToast('Habit created');
  }
  saveHabits();
  closeHabitModal();
  renderCurrentView();
}

/* -------------------------------- HISTORY / CALENDAR -------------------------------- */

function renderHistory(){
  renderCalendar();
  renderDayDetail(state.selectedDate);
  renderHeatmap();
}

function renderCalendar(){
  const y = state.calendarYear, m = state.calendarMonth;
  document.getElementById('calendarMonthLabel').textContent = `${MONTH_NAMES[m]} ${y}`;
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  const firstOfMonth = new Date(y, m, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first offset
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const today = todayStr();

  for(let i=0;i<startOffset;i++){
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }

  for(let day=1; day<=daysInMonth; day++){
    const dateStr = `${y}-${pad2(m+1)}-${pad2(day)}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if(dateStr === today) cell.classList.add('today');
    if(dateStr === state.selectedDate) cell.classList.add('selected');

    if(dateStr > today){
      cell.classList.add('status-future');
      cell.innerHTML = `${day}`;
    } else {
      const stats = getDayStats(dateStr);
      if(stats.scheduled > 0) cell.classList.add(`status-${stats.status}`);
      cell.innerHTML = `${day}${stats.scheduled>0 ? '<span class="dot"></span>' : ''}`;
    }
    cell.addEventListener('click', ()=>{
      state.selectedDate = dateStr;
      renderCalendar();
      renderDayDetail(dateStr);
    });
    grid.appendChild(cell);
  }
}

function changeMonth(delta){
  state.calendarMonth += delta;
  if(state.calendarMonth < 0){ state.calendarMonth = 11; state.calendarYear--; }
  if(state.calendarMonth > 11){ state.calendarMonth = 0; state.calendarYear++; }
  renderCalendar();
}

function renderDayDetail(dateStr){
  document.getElementById('dayDetailTitle').textContent = formatShortDate(dateStr) + (dateStr===todayStr() ? ' (Today)' : '');
  const container = document.getElementById('dayDetailContent');
  const habits = getScheduledHabitsForDate(dateStr, true).filter(h=>h.createdAt<=dateStr);

  if(dateStr > todayStr()){
    container.innerHTML = `<div class="empty-state"><span>🔮</span>This day hasn't happened yet.</div>`;
    return;
  }
  if(habits.length === 0){
    container.innerHTML = `<div class="empty-state"><span>📭</span>No habits tracked this day.</div>`;
    return;
  }

  container.innerHTML = habits.map(h=>{
    const rec = getRecord(dateStr, h.id);
    let valueLabel = '';
    if(h.type === 'boolean') valueLabel = rec && rec.completed ? 'Completed' : 'Not completed';
    else if(h.type === 'quantity') valueLabel = `${formatNum(rec?rec.value:0)} / ${formatNum(h.target)} ${h.unit||''}`;
    else if(h.type === 'count') valueLabel = `${rec ? rec.items.filter(Boolean).length : 0} / ${h.target}`;
    const done = rec && rec.completed;
    return `<div class="day-detail-row">
      <div class="ddr-left"><span>${h.icon}</span><span>${escapeHtml(h.name)}</span></div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span>${valueLabel}</span>
        <span class="day-detail-status">${done ? '✅' : '❌'}</span>
      </div>
    </div>`;
  }).join('');
}

function renderHeatmap(){
  const container = document.getElementById('heatmapGrid');
  container.innerHTML = '';
  const days = 140;
  const cells = [];
  for(let i=days-1;i>=0;i--){
    const ds = addDaysStr(todayStr(), -i);
    const stats = getDayStats(ds);
    let level = 0;
    if(stats.scheduled > 0){
      if(stats.pct === 0) level = 0;
      else if(stats.pct <= 33) level = 1;
      else if(stats.pct <= 66) level = 2;
      else if(stats.pct < 100) level = 3;
      else level = 4;
    }
    cells.push({ ds, level });
  }
  // pad start so weeks align Monday-first
  const firstOffset = weekdayIndexMonFirst(cells[0].ds);
  for(let i=0;i<firstOffset;i++){
    const pad = document.createElement('div');
    pad.className = 'heat-cell heat-0';
    pad.style.visibility = 'hidden';
    container.appendChild(pad);
  }
  cells.forEach(c=>{
    const el = document.createElement('div');
    el.className = `heat-cell heat-${c.level}`;
    el.title = `${formatShortDate(c.ds)}`;
    container.appendChild(el);
  });
}

/* -------------------------------- STATISTICS -------------------------------- */

function getRangeDates(range){
  const today = todayStr();
  const dates = [];
  if(range === '7'){
    for(let i=6;i>=0;i--) dates.push(addDaysStr(today, -i));
  } else if(range === '30'){
    for(let i=29;i>=0;i--) dates.push(addDaysStr(today, -i));
  } else if(range === 'month'){
    const d = parseLocalDate(today);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    for(let dt=new Date(first); dt<=d; dt.setDate(dt.getDate()+1)) dates.push(formatLocalDate(dt));
  } else {
    const start = earliestHabitDate();
    const end = parseLocalDate(today);
    for(let dt=new Date(start); dt<=end; dt.setDate(dt.getDate()+1)) dates.push(formatLocalDate(dt));
  }
  return dates;
}

function renderStatistics(){
  renderWeeklyBarChart();

  const range = state.statsRange;
  const dates = getRangeDates(range);
  let totalSched=0, totalDone=0;
  const weekdayTotals = {};
  WEEKDAY_NAMES.forEach(n=> weekdayTotals[n] = {sched:0, done:0});

  dates.forEach(ds=>{
    const stats = getDayStats(ds);
    totalSched += stats.scheduled;
    totalDone += stats.completed;
    const idx = weekdayIndexMonFirst(ds);
    weekdayTotals[WEEKDAY_NAMES[idx]].sched += stats.scheduled;
    weekdayTotals[WEEKDAY_NAMES[idx]].done += stats.completed;
  });

  const completionPct = totalSched ? Math.round((totalDone/totalSched)*100) : 0;
  document.getElementById('statCompletionPct').textContent = `${completionPct}%`;
  document.getElementById('statCompleted').textContent = totalDone;
  document.getElementById('statMissed').textContent = Math.max(0,totalSched-totalDone);

  let bestDay = '—', worstDay = '—', bestPct = -1, worstPct = 101;
  WEEKDAY_NAMES.forEach(n=>{
    const t = weekdayTotals[n];
    if(t.sched === 0) return;
    const pct = (t.done/t.sched)*100;
    if(pct > bestPct){ bestPct = pct; bestDay = n; }
    if(pct < worstPct){ worstPct = pct; worstDay = n; }
  });
  document.getElementById('statBestDay').textContent = bestDay;
  document.getElementById('statWorstDay').textContent = worstDay;

  let longestStreak = calcOverallDayStreak().best;
  state.habits.forEach(h=>{ longestStreak = Math.max(longestStreak, calcHabitStreaks(h).best); });
  document.getElementById('statLongestStreak').textContent = longestStreak;

  const perfContainer = document.getElementById('habitPerformanceList');
  const enabledHabits = state.habits.filter(h=>h.enabled);
  if(enabledHabits.length === 0){
    perfContainer.innerHTML = `<div class="empty-state"><span>📊</span>No habits to show yet.</div>`;
  } else {
    perfContainer.innerHTML = enabledHabits.map(h=>{
      let sched=0, done=0;
      dates.forEach(ds=>{
        if(isHabitScheduledOnDate(h, ds) && ds <= todayStr()){
          sched++;
          const rec = getRecord(ds, h.id);
          if(rec && rec.completed) done++;
        }
      });
      const pct = sched ? Math.round((done/sched)*100) : 0;
      return `<div class="perf-row">
        <div class="perf-name"><span>${h.icon}</span><span>${escapeHtml(h.name)}</span></div>
        <div class="perf-track"><div class="perf-fill" style="width:${pct}%"></div></div>
        <div class="perf-pct">${pct}%</div>
      </div>`;
    }).join('');
  }
}

function renderWeeklyBarChart(){
  const today = new Date();
  const idxToday = (today.getDay()+6)%7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - idxToday);

  const container = document.getElementById('weeklyBarChart');
  container.innerHTML = '';
  for(let i=0;i<7;i++){
    const d = new Date(monday);
    d.setDate(monday.getDate()+i);
    const ds = formatLocalDate(d);
    const isFuture = ds > todayStr();
    const stats = isFuture ? {pct:0} : getDayStats(ds);
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <span class="bar-day">${WEEKDAY_NAMES[i]}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${isFuture?0:stats.pct}%; opacity:${isFuture?0.35:1}"></div></div>
      <span class="bar-pct">${isFuture ? '–' : stats.pct+'%'}</span>
    `;
    container.appendChild(row);
  }
}

/* -------------------------------- GOALS -------------------------------- */

function currentMonthKey(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
}

function goalProgress(goal){
  const [y,m] = goal.month.split('-').map(Number);
  const habit = state.habits.find(h=>h.id===goal.habitId);
  if(!habit) return 0;
  const first = new Date(y, m-1, 1);
  const last = new Date(y, m, 0);
  const today = parseLocalDate(todayStr());
  const end = last < today ? last : today;
  let count = 0;
  for(let dt=new Date(first); dt<=end; dt.setDate(dt.getDate()+1)){
    const ds = formatLocalDate(dt);
    if(isHabitScheduledOnDate(habit, ds)){
      const rec = getRecord(ds, habit.id);
      if(rec && rec.completed) count++;
    }
  }
  return count;
}

function renderGoals(){
  const select = document.getElementById('goalHabit');
  select.innerHTML = state.habits.filter(h=>h.enabled).map(h=>`<option value="${h.id}">${h.icon} ${escapeHtml(h.name)}</option>`).join('');

  const container = document.getElementById('goalsList');
  const monthGoals = state.goals.filter(g=>g.month === currentMonthKey());
  if(monthGoals.length === 0){
    container.innerHTML = `<div class="empty-state"><span>🎯</span>No goals yet for this month. Click "+ Add Goal" to set one.</div>`;
    return;
  }
  container.innerHTML = '';
  monthGoals.forEach(goal=>{
    const habit = state.habits.find(h=>h.id===goal.habitId);
    const progress = goalProgress(goal);
    const pct = Math.min(100, Math.round((progress/goal.target)*100));
    const card = document.createElement('div');
    card.className = 'card goal-card';
    card.innerHTML = `
      <div class="goal-top">
        <div>
          <div class="goal-title">${pct>=100?'☑':'☐'} ${escapeHtml(goal.title)}</div>
          <div class="goal-sub">${habit ? habit.icon+' '+escapeHtml(habit.name) : 'Habit removed'} · ${progress} / ${goal.target}</div>
        </div>
        <div class="goal-actions">
          <button class="btn-icon-sm" data-edit-goal="${goal.id}" aria-label="Edit goal">✎</button>
          <button class="btn-icon-sm" data-delete-goal="${goal.id}" aria-label="Delete goal">🗑</button>
        </div>
      </div>
      <div class="goal-track"><div class="goal-fill ${pct>=100?'complete':''}" style="width:${pct}%"></div></div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('[data-edit-goal]').forEach(el=>{
    el.addEventListener('click', ()=> openEditGoalModal(el.dataset.editGoal));
  });
  container.querySelectorAll('[data-delete-goal]').forEach(el=>{
    el.addEventListener('click', ()=>{
      showConfirm('Delete goal?', 'This goal will be permanently removed.', ()=>{
        state.goals = state.goals.filter(g=>g.id !== el.dataset.deleteGoal);
        saveGoals();
        renderGoals();
        showToast('Goal deleted');
      });
    });
  });
}

function openAddGoalModal(){
  if(state.habits.filter(h=>h.enabled).length === 0){
    showToast('Create a habit first');
    return;
  }
  state.editingGoalId = null;
  document.getElementById('goalModalTitle').textContent = 'Add Goal';
  document.getElementById('goalForm').reset();
  renderGoals();
  document.getElementById('goalModalOverlay').classList.add('open');
}
function openEditGoalModal(goalId){
  const goal = state.goals.find(g=>g.id===goalId);
  if(!goal) return;
  state.editingGoalId = goalId;
  document.getElementById('goalModalTitle').textContent = 'Edit Goal';
  renderGoals();
  document.getElementById('goalTitle').value = goal.title;
  document.getElementById('goalHabit').value = goal.habitId;
  document.getElementById('goalTarget').value = goal.target;
  document.getElementById('goalModalOverlay').classList.add('open');
}
function closeGoalModal(){ document.getElementById('goalModalOverlay').classList.remove('open'); }

function handleGoalFormSubmit(e){
  e.preventDefault();
  const title = document.getElementById('goalTitle').value.trim();
  const habitId = document.getElementById('goalHabit').value;
  const target = parseInt(document.getElementById('goalTarget').value, 10);
  if(!title || !habitId || !target || target <= 0){ showToast('Please fill in all fields'); return; }

  if(state.editingGoalId){
    const goal = state.goals.find(g=>g.id===state.editingGoalId);
    Object.assign(goal, { title, habitId, target });
    showToast('Goal updated');
  } else {
    state.goals.push({ id: uid('g'), title, habitId, target, month: currentMonthKey(), createdAt: todayStr() });
    showToast('Goal created');
  }
  saveGoals();
  closeGoalModal();
  renderGoals();
}

/* -------------------------------- ACHIEVEMENTS -------------------------------- */

function renderAchievements(){
  checkAchievements();
  const grid = document.getElementById('achievementsGrid');
  grid.innerHTML = ACHIEVEMENT_DEFS.map(def=>{
    const unlocked = state.achievementsUnlocked[def.id];
    return `<div class="card achievement-card ${unlocked?'':'locked'}">
      <span class="ach-icon">${def.icon}</span>
      <div>
        <div class="ach-title">${def.title}</div>
        <div class="ach-desc">${def.desc}</div>
        ${unlocked ? `<div class="ach-desc" style="color:var(--success); margin-top:4px;">Unlocked ${formatShortDate(unlocked)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

/* ------------------------------- PROFILE / WELCOME ------------------------------- */

function showWelcomeScreen(){
  const screen = document.getElementById('welcomeScreen');
  if(!screen) return;
  screen.classList.add('open');
  screen.setAttribute('aria-hidden','false');
  document.getElementById('welcomeName')?.focus();
}

function hideWelcomeScreen(){
  const screen = document.getElementById('welcomeScreen');
  if(!screen) return;
  screen.classList.remove('open');
  screen.setAttribute('aria-hidden','true');
}

function updateProfileUI(){
  const name = state.profile?.name || 'Guest';
  const email = state.profile?.email || 'No email saved';
  const nameEl=document.getElementById('profileNameDisplay');
  const emailEl=document.getElementById('profileEmailDisplay');
  const avatar=document.getElementById('profileAvatar');
  if(nameEl) nameEl.textContent=name;
  if(emailEl) emailEl.textContent=email;
  if(avatar) avatar.textContent=(name.trim()[0] || 'P').toUpperCase();
}

async function registerVisitorRemotely(profile){
  try{
    if(window.habitlySupabase){
      const { error } = await window.habitlySupabase.rpc('register_visitor', {
        p_name: profile.name,
        p_email: profile.email
      });
      if(error) console.warn('Visitor registry unavailable:', error.message);
    }
  }catch(err){ console.warn('Visitor registry unavailable:', err); }
}

async function saveProfile(name,email,shareRecords=state.profile?.shareRecords ?? true){
  state.profile={name:name.trim(),email:email.trim().toLowerCase(),updatedAt:new Date().toISOString(),shareRecords};
  lsSet(LS_KEYS.profile,state.profile);
  updateProfileUI();
  if(shareRecords) await registerVisitorRemotely(state.profile);
}

function logoutLocalProfile(){
  showConfirm('Log out of Habitly?', 'Your local profile and habit data will be removed from this browser. Your visitor record, if shared, remains in the admin registry.', ()=>{
    Object.values(LS_KEYS).forEach(k=> localStorage.removeItem(k));
    loadState();
    applyTheme();
    state.selectedDate = todayStr();
    state.calendarYear = new Date().getFullYear();
    state.calendarMonth = new Date().getMonth();
    setView('dashboard');
    updateProfileUI();
    showWelcomeScreen();
    showToast('You have been logged out');
  });
}

function editProfile(){
  const name=prompt('Update your name:',state.profile?.name || '');
  if(name===null) return;
  const cleanName=name.trim();
  if(!cleanName){ showToast('Please enter a name'); return; }
  const email=prompt('Update your email:',state.profile?.email || '');
  if(email===null) return;
  const cleanEmail=email.trim().toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(cleanEmail)){ showToast('Please enter a valid email'); return; }
  saveProfile(cleanName,cleanEmail).then(()=>{ renderDashboard(); renderSettings(); showToast('Profile updated'); });
}

function setupProfile(){
  document.getElementById('welcomeForm')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const name=document.getElementById('welcomeName').value.trim();
    const email=document.getElementById('welcomeEmail').value.trim().toLowerCase();
    const shareRecords=document.getElementById('welcomeConsent')?.checked !== false;
    if(!name || !/^\S+@\S+\.\S+$/.test(email)){ showToast('Please enter your name and a valid email'); return; }
    state.profile={name:name.trim(),email,updatedAt:new Date().toISOString(),shareRecords};
    lsSet(LS_KEYS.profile,state.profile);
    updateProfileUI();
    if(shareRecords) await registerVisitorRemotely(state.profile);
    hideWelcomeScreen();
    renderDashboard();
    renderSettings();
    showToast(`Welcome, ${name}!`);
  });
  document.getElementById('editProfileBtn')?.addEventListener('click',editProfile);
  document.getElementById('logoutBtn')?.addEventListener('click',logoutLocalProfile);
}

/* ----------------------------- REMINDER NOTIFICATIONS ----------------------------- */

function notificationSupported(){ return 'Notification' in window; }
function notificationStorageKey(){ return 'habitly_notified_reminders'; }
function getNotifiedReminders(){ return lsGet(notificationStorageKey(),{}); }
function markReminderNotified(key){ const data=getNotifiedReminders(); data[key]=Date.now(); lsSet(notificationStorageKey(),data); }

async function enableNotifications(){
  if(!notificationSupported()){ showToast('This browser does not support notifications'); return; }
  try{
    const permission=await Notification.requestPermission();
    updateNotificationUI();
    if(permission==='granted'){
      showToast('Reminder notifications enabled');
      checkReminderNotifications(true);
    }else if(permission==='denied') showToast('Notifications are blocked in browser settings');
  }catch(err){ showToast('Could not enable notifications'); }
}

function updateNotificationUI(){
  const btn=document.getElementById('enableNotificationsBtn');
  const status=document.getElementById('notificationStatus');
  if(!btn || !status) return;
  if(!notificationSupported()){
    btn.disabled=true; btn.textContent='Unavailable'; status.textContent='This browser does not support notifications.'; return;
  }
  if(Notification.permission==='granted'){
    btn.textContent='Enabled'; btn.classList.add('active'); status.textContent='Habitly will notify you when a reminder is due while the app is open.';
  }else if(Notification.permission==='denied'){
    btn.textContent='Blocked'; status.textContent='Notifications are blocked. Allow them in your browser site settings.';
  }else{
    btn.textContent='Enable'; btn.classList.remove('active'); status.textContent='Allow Habitly to notify you when a scheduled reminder is due.';
  }
}

function checkReminderNotifications(force=false){
  if(!notificationSupported() || Notification.permission!=='granted') return;
  const now=new Date();
  const today=todayStr();
  const currentMinutes=now.getHours()*60+now.getMinutes();
  const notified=getNotifiedReminders();
  state.habits.filter(h=>h.enabled && h.reminder && isHabitScheduledOnDate(h,today)).forEach(h=>{
    const rec=getRecord(today,h.id);
    if(rec && rec.completed) return;
    const [hr,min]=h.reminder.split(':').map(Number);
    const reminderMinutes=hr*60+min;
    if(currentMinutes < reminderMinutes) return;
    if(currentMinutes-reminderMinutes > 2 && !force) return;
    const key=`${today}|${h.id}|${h.reminder}`;
    if(notified[key]) return;
    const n=new Notification(`${h.icon} ${h.name}`,{body:`It's time for your ${h.name} habit.`,tag:`habitly-${h.id}-${today}`,icon:'./favicon.svg'});
    n.onclick=()=>{ window.focus(); setView('dashboard'); };
    markReminderNotified(key);
  });
}

function setupNotifications(){
  if('serviceWorker' in navigator && window.location.protocol !== 'file:') navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  document.getElementById('enableNotificationsBtn')?.addEventListener('click',enableNotifications);
  updateNotificationUI();
  checkReminderNotifications();
  if(state.notificationTimer) clearInterval(state.notificationTimer);
  state.notificationTimer=setInterval(()=>checkReminderNotifications(),30000);
}

/* -------------------------------- SETTINGS -------------------------------- */

function applyTheme(){
  document.documentElement.setAttribute('data-theme', state.settings.theme);
  const isDark = state.settings.theme === 'dark';
  const icon = document.getElementById('dashboardThemeIcon');
  const label = document.getElementById('dashboardThemeLabel');
  if(icon) icon.className = `dashboard-theme-icon ${isDark ? 'is-dark' : 'is-light'}`;
  if(label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

function renderSettings(){
  updateProfileUI();
  updateNotificationUI();
}

function setTheme(theme){
  state.settings.theme = theme;
  saveSettings();
  applyTheme();
  renderSettings();
}

function exportData(){
  const payload = {
    habits: state.habits,
    records: state.records,
    goals: state.goals,
    achievementsUnlocked: state.achievementsUnlocked,
    notes: state.notes,
    settings: state.settings,
    profile: state.profile,
    exportedAt: new Date().toISOString(),
    version: 1
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `habitly-export-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Data exported');
}

function importData(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const data = JSON.parse(e.target.result);
      if(!data || !Array.isArray(data.habits) || typeof data.records !== 'object'){
        throw new Error('Invalid file structure');
      }
      showConfirm('Import data?', 'This will overwrite your current data with the contents of this file.', ()=>{
        state.habits = data.habits || [];
        state.records = data.records || {};
        state.goals = data.goals || [];
        state.achievementsUnlocked = data.achievementsUnlocked || {};
        state.notes = data.notes || {};
        state.settings = data.settings || { theme:'dark' };
        state.profile = data.profile || null;
        persistAll();
        lsSet(LS_KEYS.seeded, true);
        applyTheme();
        renderCurrentView();
        showToast('Data imported successfully');
      });
    }catch(err){
      console.error(err);
      showToast('⚠️ Invalid or corrupted file');
    }
  };
  reader.readAsText(file);
}

function resetAllData(){
  showConfirm('Reset all data?', 'Every habit, record, goal and note will be permanently deleted. This cannot be undone.', ()=>{
    Object.values(LS_KEYS).forEach(k=> localStorage.removeItem(k));
    loadState();
    applyTheme();
    state.selectedDate = todayStr();
    state.calendarYear = new Date().getFullYear();
    state.calendarMonth = new Date().getMonth();
    setView('dashboard');
    if(!state.profile) showWelcomeScreen();
    showToast('All data has been reset');
  });
}

/* -------------------------------- CONFIRM MODAL -------------------------------- */

function showConfirm(title, message, onConfirm){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  state.confirmCallback = onConfirm;
  document.getElementById('confirmModalOverlay').classList.add('open');
}
function closeConfirm(){
  document.getElementById('confirmModalOverlay').classList.remove('open');
  state.confirmCallback = null;
}

/* -------------------------------- EVENT WIRING -------------------------------- */

function setupEventListeners(){
  document.querySelectorAll('.nav-item, .bnav-item').forEach(btn=>{
    btn.addEventListener('click', ()=> setView(btn.dataset.view));
  });

  document.getElementById('dashboardThemeToggle')?.addEventListener('click', ()=>{
    setTheme(state.settings.theme === 'dark' ? 'light' : 'dark');
  });
  document.getElementById('sidebarLogoutBtn')?.addEventListener('click', logoutLocalProfile);

  // dashboard category filters
  document.getElementById('categoryFilterChips').addEventListener('click', (e)=>{
    const chip = e.target.closest('.chip');
    if(!chip) return;
    document.querySelectorAll('#categoryFilterChips .chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    state.dashboardCategoryFilter = chip.dataset.cat;
    renderTodayHabitsList();
  });
  document.getElementById('habitsFilterChips').addEventListener('click', (e)=>{
    const chip = e.target.closest('.chip');
    if(!chip) return;
    document.querySelectorAll('#habitsFilterChips .chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    state.manageCategoryFilter = chip.dataset.cat;
    renderHabitsManage();
  });

  // note
  document.getElementById('saveNoteBtn').addEventListener('click', ()=>{
    const val = document.getElementById('dailyNoteInput').value.trim();
    state.notes[todayStr()] = val;
    saveNotes();
    showToast('Note saved');
  });

  // habit modal
  document.getElementById('openAddHabitBtn').addEventListener('click', openAddHabitModal);
  document.getElementById('closeHabitModalBtn').addEventListener('click', closeHabitModal);
  document.getElementById('cancelHabitBtn').addEventListener('click', closeHabitModal);
  document.getElementById('habitModalOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'habitModalOverlay') closeHabitModal(); });
  document.getElementById('habitForm').addEventListener('submit', handleHabitFormSubmit);
  document.querySelectorAll('input[name="habitType"]').forEach(r=> r.addEventListener('change', updateHabitFormVisibility));
  document.querySelectorAll('input[name="habitFrequency"]').forEach(r=> r.addEventListener('change', updateHabitFormVisibility));
  document.getElementById('daysPicker').addEventListener('click', (e)=>{
    const chip = e.target.closest('.day-chip');
    if(!chip) return;
    chip.classList.toggle('selected');
  });

  // goal modal
  document.getElementById('openAddGoalBtn').addEventListener('click', openAddGoalModal);
  document.getElementById('closeGoalModalBtn').addEventListener('click', closeGoalModal);
  document.getElementById('cancelGoalBtn').addEventListener('click', closeGoalModal);
  document.getElementById('goalModalOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'goalModalOverlay') closeGoalModal(); });
  document.getElementById('goalForm').addEventListener('submit', handleGoalFormSubmit);

  // confirm modal
  document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirm);
  document.getElementById('confirmOkBtn').addEventListener('click', ()=>{
    const cb = state.confirmCallback;
    closeConfirm();
    if(cb) cb();
  });
  document.getElementById('confirmModalOverlay').addEventListener('click', (e)=>{ if(e.target.id === 'confirmModalOverlay') closeConfirm(); });

  // history
  document.getElementById('prevMonthBtn').addEventListener('click', ()=> changeMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', ()=> changeMonth(1));

  // statistics range tabs
  document.getElementById('statsRangeTabs').addEventListener('click', (e)=>{
    const tab = e.target.closest('.range-tab');
    if(!tab) return;
    document.querySelectorAll('.range-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    state.statsRange = tab.dataset.range;
    renderStatistics();
  });

  // settings: data
  document.getElementById('exportDataBtn').addEventListener('click', exportData);
  document.getElementById('importDataBtn').addEventListener('click', ()=> document.getElementById('importFileInput').click());
  document.getElementById('importFileInput').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(file) importData(file);
    e.target.value = '';
  });
  document.getElementById('resetDataBtn').addEventListener('click', resetAllData);

  setupProfile();
  setupNotifications();

  // Escape key closes modals
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      closeHabitModal(); closeGoalModal(); closeConfirm();
    }
  });
}

/* -------------------------------- INIT -------------------------------- */

function init(){
  loadState();
  applyTheme();
  setupEventListeners();
  setView('dashboard');
  updateProfileUI();
  if(!state.profile) showWelcomeScreen();

  // keep dashboard/reminders time-aware
  setInterval(()=>{
    if(state.currentView === 'dashboard') renderDashboard();
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
