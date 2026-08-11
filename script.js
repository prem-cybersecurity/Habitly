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
  settings: 'habitly_settings',
  reminders: 'habitly_reminders',
  profile: 'habitly_profile',
  session: 'habitly_session',
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
  settings: { theme: 'dark' },
  reminders: [],
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
  sessionActive: false,
  notificationTimer: null,
  editingReminderId: null,
  reminderAlert: null,
  achievementFilter: 'all'
};

function defaultHabits(){
  const t = todayStr();
  return [
    { id: uid('h'), name:'Drink Water', icon:'💧', category:'Health', type:'quantity', target:3, unit:'L', frequency:'daily', days:[], reminder:'', enabled:true, createdAt:t, step:0.25 },
    { id: uid('h'), name:'Eat Meals', icon:'🍛', category:'Health', type:'count', target:3, unit:'meals', items:['Breakfast','Lunch','Dinner'], frequency:'daily', days:[], reminder:'', enabled:true, createdAt:t },
    { id: uid('h'), name:'Drink Milk', icon:'🥛', category:'Health', type:'quantity', target:1, unit:'glass', frequency:'daily', days:[], reminder:'20:00', reminderSound:'gentle', enabled:true, createdAt:t, step:1 },
    { id: uid('h'), name:'Exercise', icon:'🏃', category:'Fitness', type:'quantity', target:30, unit:'minutes', frequency:'daily', days:[], reminder:'', enabled:true, createdAt:t, step:5 },
    { id: uid('h'), name:'Study', icon:'📚', category:'Study', type:'quantity', target:2, unit:'hours', frequency:'daily', days:[], reminder:'21:30', reminderSound:'chime', enabled:true, createdAt:t, step:0.5 },
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
    state.settings = { theme: 'dark' };
    state.reminders = [];
    state.profile = null;
    state.sessionActive = false;
    persistAll();
    lsSet(LS_KEYS.session, false);
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
    state.settings = lsGet(LS_KEYS.settings, { theme: 'dark' });
    state.reminders = lsGet(LS_KEYS.reminders, []);
    if (!Array.isArray(state.reminders)) state.reminders = [];
    if (!state.settings?.theme) state.settings = { ...state.settings, theme: 'dark' };
    state.profile = lsGet(LS_KEYS.profile, null);
    state.sessionActive = lsGet(LS_KEYS.session, false) === true;
    state.habits.forEach(h => { if(h.reminder && !h.reminderSound) h.reminderSound = 'gentle'; });
    if(state.reminders.length === 0){ state.reminders = state.habits.filter(h=>h.reminder).map(h=>({id:uid('r'),habitId:h.id,time:h.reminder,sound:h.reminderSound||'gentle',enabled:true})); }
    saveHabits();
    saveReminders();
  }
}

function persistAll(){
  lsSet(LS_KEYS.habits, state.habits);
  lsSet(LS_KEYS.records, state.records);
  lsSet(LS_KEYS.goals, state.goals);
  lsSet(LS_KEYS.achievements, state.achievementsUnlocked);
  lsSet(LS_KEYS.settings, state.settings);
  lsSet(LS_KEYS.reminders, state.reminders);
  lsSet(LS_KEYS.profile, state.profile);
  lsSet(LS_KEYS.session, state.sessionActive === true);
}
function saveHabits(){ lsSet(LS_KEYS.habits, state.habits); }
function saveRecords(){ lsSet(LS_KEYS.records, state.records); }
function saveGoals(){ lsSet(LS_KEYS.goals, state.goals); }
function saveAchievements(){ lsSet(LS_KEYS.achievements, state.achievementsUnlocked); }
function saveSettings(){ lsSet(LS_KEYS.settings, state.settings); }
function saveReminders(){ lsSet(LS_KEYS.reminders, state.reminders); }

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
  {id:'first_step',icon:'🌱',title:'First Step',desc:'Complete your first habit.',category:'Milestones',target:1,getProgress:()=>totalCompletionsCount()},
  {id:'streak_3',icon:'🔥',title:'Three in a Row',desc:'Keep a habit going for 3 days.',category:'Streaks',target:3,getProgress:()=>maxHabitStreak()},
  {id:'streak_7',icon:'🔥',title:'7-Day Streak',desc:'Maintain a habit for 7 days.',category:'Streaks',target:7,getProgress:()=>maxHabitStreak()},
  {id:'streak_14',icon:'⚡',title:'Two Week Run',desc:'Maintain a habit for 14 days.',category:'Streaks',target:14,getProgress:()=>maxHabitStreak()},
  {id:'streak_30',icon:'🏔️',title:'30-Day Streak',desc:'Maintain a habit for 30 days.',category:'Streaks',target:30,getProgress:()=>maxHabitStreak()},
  {id:'streak_60',icon:'💎',title:'60-Day Streak',desc:'Maintain a habit for 60 days.',category:'Streaks',target:60,getProgress:()=>maxHabitStreak()},
  {id:'perfect_week',icon:'💯',title:'Perfect Week',desc:'Complete all active habits for 7 consecutive days.',category:'Consistency',target:7,getProgress:()=>calcOverallDayStreak().best},
  {id:'perfect_month',icon:'🌟',title:'Perfect Month',desc:'Complete every scheduled habit for 30 days.',category:'Consistency',target:30,getProgress:()=>calcOverallDayStreak().best},
  {id:'completions_25',icon:'✨',title:'25 Completions',desc:'Complete 25 habit instances.',category:'Milestones',target:25,getProgress:()=>totalCompletionsCount()},
  {id:'completions_100',icon:'🏆',title:'100 Completions',desc:'Complete 100 habit instances.',category:'Milestones',target:100,getProgress:()=>totalCompletionsCount()},
  {id:'completions_250',icon:'👑',title:'250 Completions',desc:'Complete 250 habit instances.',category:'Milestones',target:250,getProgress:()=>totalCompletionsCount()},
  {id:'habits_5',icon:'🧩',title:'Five Habits',desc:'Build a routine with 5 active habits.',category:'Milestones',target:5,getProgress:()=>state.habits.filter(h=>h.enabled).length},
  {id:'early_riser',icon:'🌅',title:'Early Riser',desc:'Complete a habit before 8:00 AM on 5 days.',category:'Consistency',target:5,getProgress:()=>countCompletionsByHour(0,8)},
  {id:'night_owl',icon:'🌙',title:'Night Routine',desc:'Complete a habit after 8:00 PM on 5 days.',category:'Consistency',target:5,getProgress:()=>countCompletionsByHour(20,24)},
  {id:'goal_one',icon:'🎯',title:'Goal Getter',desc:'Complete your first monthly goal.',category:'Milestones',target:1,getProgress:()=>state.goals.filter(g=>goalProgress(g)>=g.target).length},
  {id:'habit_variety',icon:'🎨',title:'Well Rounded',desc:'Complete habits from 3 categories.',category:'Milestones',target:3,getProgress:()=>completedCategoryCount()}
];
function maxHabitStreak(){return state.habits.reduce((m,h)=>Math.max(m,calcHabitStreaks(h).best),0)}
function completedCategoryCount(){const cats=new Set();Object.entries(state.records).forEach(([ds,recs])=>Object.entries(recs||{}).forEach(([id,r])=>{if(r?.completed){const h=state.habits.find(x=>x.id===id);if(h)cats.add(h.category)}}));return cats.size}
function countCompletionsByHour(startHour,endHour){let count=0;Object.values(state.records).forEach(recs=>Object.values(recs||{}).forEach(r=>{if(r?.completedAt){const h=new Date(r.completedAt).getHours();if(h>=startHour&&h<endHour)count++}}));return count}
function totalCompletionsCount(){let count=0;Object.values(state.records).forEach(dayRec=>Object.values(dayRec||{}).forEach(r=>{if(r?.completed)count++}));return count}
function checkAchievements(){const changed=[];ACHIEVEMENT_DEFS.forEach(def=>{if(Number(def.getProgress?.()||0)>=def.target&&!state.achievementsUnlocked[def.id]){state.achievementsUnlocked[def.id]=todayStr();changed.push(def)}});if(changed.length){saveAchievements();changed.forEach(showAchievementUnlock)}}
function showAchievementUnlock(def){showToast(`${def.icon} Achievement unlocked: ${def.title}`,3200);const f=document.getElementById('achievementFeature');if(f){f.innerHTML=`<div class="achievement-unlock-card"><span>${def.icon}</span><div><small>ACHIEVEMENT UNLOCKED</small><strong>${escapeHtml(def.title)}</strong><p>${escapeHtml(def.desc)}</p></div></div>`;setTimeout(()=>{if(f)f.innerHTML=''},5000)}}

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
  renderMomentum(stats);

  renderTodayHabitsList();
  renderReminders();

}

function renderMomentum(stats){
  const fill=document.getElementById('momentumFill'),value=document.getElementById('momentumValue'),title=document.getElementById('momentumTitle'),text=document.getElementById('momentumText');
  if(!fill||!value||!title||!text)return; const pct=stats.pct||0; fill.style.width=`${pct}%`; value.textContent=`${pct}%`;
  if(stats.scheduled===0){title.textContent='Start your routine.';text.textContent='Add a habit and make the first step count.'}
  else if(pct===100){title.textContent='Perfect day. 🔥';text.textContent='Every scheduled habit is complete.'}
  else if(pct>=80){title.textContent='Finish strong.';text.textContent='You are almost there today.'}
  else if(pct>=50){title.textContent='Nice momentum.';text.textContent='Keep going and build the streak.'}
  else if(pct>0){title.textContent='Keep going.';text.textContent='Small progress still counts.'}
  else {title.textContent='Start small.';text.textContent='One completed habit can change the day.'}
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
        <span class="progress-inline-pct">${pct}%</span>
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
    rec.completedAt = rec.completed ? new Date().toISOString() : null;
  } else if(habit.type === 'quantity'){
    if(rec.completed){
      rec.value = 0;
      rec.completed = false;
      rec.completedAt = null;
    } else {
      rec.value = habit.target;
      rec.completed = true;
      rec.completedAt = new Date().toISOString();
    }
  } else if(habit.type === 'count'){
    const done = !!rec.completed;
    rec.items = (habit.items || []).map(()=> !done);
    rec.completed = !done;
    rec.completedAt = rec.completed ? new Date().toISOString() : null;
  }
  refreshAfterMutation();
}

function toggleBooleanHabit(habitId){
  const habit = state.habits.find(h=>h.id===habitId);
  if(!habit) return;
  const today = todayStr();
  const rec = ensureRecord(today, habit);
  rec.completed = !rec.completed;
  rec.completedAt = rec.completed ? new Date().toISOString() : null;
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
  rec.completedAt = rec.completed ? (rec.completedAt || new Date().toISOString()) : null;
  refreshAfterMutation();
}

function toggleCountItem(habitId, idx){
  const habit = state.habits.find(h=>h.id===habitId);
  if(!habit) return;
  const today = todayStr();
  const rec = ensureRecord(today, habit);
  rec.items[idx] = !rec.items[idx];
  rec.completed = computeCompleted(habit, rec);
  rec.completedAt = rec.completed ? (rec.completedAt || new Date().toISOString()) : null;
  refreshAfterMutation();
}

function getReminderByHabit(habitId){return state.reminders.find(r=>r.habitId===habitId&&r.enabled!==false)||null}
function syncHabitReminder(habit){const existing=state.reminders.find(r=>r.habitId===habit.id);if(!habit.reminder){state.reminders=state.reminders.filter(r=>r.habitId!==habit.id)}else if(existing){Object.assign(existing,{time:habit.reminder,sound:habit.reminderSound||existing.sound||'gentle',enabled:true})}else{state.reminders.push({id:uid('r'),habitId:habit.id,time:habit.reminder,sound:habit.reminderSound||'gentle',enabled:true})}saveReminders()}
function repeatLabel(h){if(h.frequency==='daily')return'Every day';const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];return(h.days||[]).slice().sort().map(d=>names[d]).join(' · ')||'Selected days'}
function soundLabel(sound){return({gentle:'Gentle Bell',chime:'Soft Chime',calm:'Calm',classic:'Classic',simple:'Simple',none:'No sound'})[sound]||'Gentle Bell'}
function renderReminders(){
  const container=document.getElementById('remindersList'),today=todayStr();
  const items=state.reminders.map(r=>({r,h:state.habits.find(h=>h.id===r.habitId)})).filter(x=>x.h&&x.r.enabled!==false&&x.h.enabled&&isHabitScheduledOnDate(x.h,today)).filter(x=>{const rec=getRecord(today,x.h.id);return!(rec&&rec.completed)}).sort((a,b)=>a.r.time.localeCompare(b.r.time));
  if(!items.length){container.innerHTML='<div class="empty-state reminder-empty"><span>⏰</span><div><strong>No reminders yet</strong><p>Add a reminder to a habit and allow notifications when you are ready.</p></div><button class="btn btn-secondary btn-small" type="button" data-empty-add-reminder>+ Add Reminder</button></div>';container.querySelector('[data-empty-add-reminder]')?.addEventListener('click',openAddReminderModal);return}
  container.innerHTML=items.map(({r,h})=>`<div class="reminder-item reminder-timeline-item"><span class="reminder-time">${formatTime12(r.time)}</span><span class="reminder-timeline-dot"></span><span class="habit-icon">${h.icon}</span><div class="reminder-name-wrap"><span class="reminder-name">${escapeHtml(h.name)}</span><small>${soundLabel(r.sound)} · ${repeatLabel(h)}</small></div><button class="btn-icon-sm reminder-edit-btn" data-edit-reminder="${r.id}" aria-label="Edit reminder">✎</button></div>`).join('');
  container.querySelectorAll('[data-edit-reminder]').forEach(b=>b.addEventListener('click',()=>openEditReminderModal(b.dataset.editReminder)));
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
        state.reminders = state.reminders.filter(r=>r.habitId!==habit.id);
        saveHabits();
        saveReminders();
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
  const reminderSound = reminder ? (state.habits.find(h=>h.id===state.editingHabitId)?.reminderSound || 'gentle') : 'gentle';

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
    Object.assign(habit, { name, icon, category, type, target, unit, items, frequency, days, reminder, reminderSound, step: habit.step || step });
    if(type === 'quantity') habit.step = step;
    showToast('Habit updated');
  } else {
    state.habits.push({
      id: uid('h'), name, icon, category, type, target, unit, items,
      frequency, days, reminder, reminderSound, enabled:true, createdAt: todayStr(), step
    });
    showToast('Habit created');
  }
  const savedHabit = state.habits.find(h=>h.id===state.editingHabitId) || state.habits[state.habits.length-1];
  if(savedHabit) syncHabitReminder(savedHabit);
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
  checkAchievements(); const grid=document.getElementById('achievementsGrid');if(!grid)return;
  const unlockedCount=ACHIEVEMENT_DEFS.filter(d=>state.achievementsUnlocked[d.id]).length;const summary=document.getElementById('achievementSummary');if(summary)summary.textContent=`${unlockedCount} / ${ACHIEVEMENT_DEFS.length} unlocked`;
  const next=ACHIEVEMENT_DEFS.filter(d=>!state.achievementsUnlocked[d.id]).sort((a,b)=>(b.getProgress?.()||0)/b.target-(a.getProgress?.()||0)/a.target)[0];const feature=document.getElementById('achievementFeature');
  if(feature){if(next){const p=Math.min(100,Math.round(((next.getProgress?.()||0)/next.target)*100));feature.innerHTML=`<div class="achievement-feature-card"><div class="achievement-feature-icon">${next.icon}</div><div class="achievement-feature-copy"><small>NEXT MILESTONE</small><strong>${escapeHtml(next.title)}</strong><p>${escapeHtml(next.desc)}</p><div class="achievement-feature-track"><span style="width:${p}%"></span></div><div class="achievement-feature-meta"><span>${Math.min(next.getProgress?.()||0,next.target)} / ${next.target}</span><span>${p}%</span></div></div></div>`}else feature.innerHTML='<div class="achievement-feature-card complete-feature"><div class="achievement-feature-icon">🏆</div><div><small>ALL UNLOCKED</small><strong>Habitly legend.</strong><p>You completed every current milestone.</p></div></div>'}
  const filter=state.achievementFilter||'all';const defs=ACHIEVEMENT_DEFS.filter(d=>filter==='all'||d.category===filter);
  grid.innerHTML=defs.map(def=>{const unlocked=!!state.achievementsUnlocked[def.id];const progress=Math.min(def.target,Number(def.getProgress?.()||0));const pct=Math.min(100,Math.round(progress/def.target*100));return `<article class="achievement-card-v2 ${unlocked?'unlocked':'locked'}"><div class="achievement-badge ${unlocked?'badge-unlocked':''}"><span>${unlocked?def.icon:'🔒'}</span></div><div class="achievement-card-body"><div class="achievement-card-top"><span class="achievement-category">${def.category}</span>${unlocked?'<span class="achievement-check">✓</span>':''}</div><h3>${escapeHtml(def.title)}</h3><p>${escapeHtml(def.desc)}</p><div class="achievement-progress-track"><span style="width:${pct}%"></span></div><div class="achievement-progress-meta"><span>${progress} / ${def.target}</span><span>${unlocked?'Unlocked':pct+'%'}</span></div></div></article>`}).join('');
}

/* ----------------------------- REMINDER MANAGER ----------------------------- */
const REMINDER_SOUNDS={gentle:{freq:[660,880],dur:[.16,.22]},chime:{freq:[523.25,659.25,783.99],dur:[.12,.12,.24]},calm:{freq:[392,523.25],dur:[.25,.35]},classic:{freq:[880,660,880],dur:[.12,.12,.16]},simple:{freq:[660,660],dur:[.10,.18]}};
let audioCtx=null;
function playReminderSound(kind='gentle'){if(kind==='none')return;const spec=REMINDER_SOUNDS[kind]||REMINDER_SOUNDS.gentle;try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();const start=audioCtx.currentTime+.02;let offset=0;spec.freq.forEach((freq,i)=>{const osc=audioCtx.createOscillator(),gain=audioCtx.createGain(),t=start+offset,d=spec.dur[i]||.16;osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(.18,t+.02);gain.gain.exponentialRampToValueAtTime(.0001,t+d);osc.connect(gain).connect(audioCtx.destination);osc.start(t);osc.stop(t+d+.03);offset+=d+.035})}catch(e){console.warn('Reminder sound unavailable',e)}}
function openAddReminderModal(){const habits=state.habits.filter(h=>h.enabled);if(!habits.length){showToast('Create a habit first');return}state.editingReminderId=null;document.getElementById('reminderModalTitle').textContent='Add Reminder';const select=document.getElementById('reminderHabit');select.innerHTML=habits.map(h=>`<option value="${h.id}">${h.icon} ${escapeHtml(h.name)}</option>`).join('');const first=habits[0],existing=getReminderByHabit(first.id);document.getElementById('reminderTime').value=existing?.time||first.reminder||'20:00';document.getElementById('reminderSound').value=existing?.sound||first.reminderSound||'gentle';document.getElementById('reminderModalOverlay').classList.add('open')}
function openEditReminderModal(reminderId){const r=state.reminders.find(x=>x.id===reminderId);if(!r)return;const habits=state.habits.filter(h=>h.enabled);if(!habits.length)return;state.editingReminderId=reminderId;document.getElementById('reminderModalTitle').textContent='Edit Reminder';const select=document.getElementById('reminderHabit');select.innerHTML=habits.map(h=>`<option value="${h.id}">${h.icon} ${escapeHtml(h.name)}</option>`).join('');select.value=r.habitId;document.getElementById('reminderTime').value=r.time;document.getElementById('reminderSound').value=r.sound||'gentle';document.getElementById('reminderModalOverlay').classList.add('open')}
function closeReminderModal(){document.getElementById('reminderModalOverlay').classList.remove('open');state.editingReminderId=null}
function saveReminderFromForm(e){e.preventDefault();const habitId=document.getElementById('reminderHabit').value,time=document.getElementById('reminderTime').value,sound=document.getElementById('reminderSound').value,habit=state.habits.find(h=>h.id===habitId);if(!habit||!time)return;const duplicate=state.reminders.find(r=>r.habitId===habitId&&r.id!==state.editingReminderId);if(duplicate){duplicate.time=time;duplicate.sound=sound;duplicate.enabled=true}else if(state.editingReminderId){const r=state.reminders.find(x=>x.id===state.editingReminderId);if(r)Object.assign(r,{habitId,time,sound,enabled:true})}else state.reminders.push({id:uid('r'),habitId,time,sound,enabled:true});habit.reminder=time;habit.reminderSound=sound;saveHabits();saveReminders();closeReminderModal();renderDashboard();renderSettings();showToast('Reminder saved')}
function deleteReminder(reminderId){const r=state.reminders.find(x=>x.id===reminderId);if(!r)return;const h=state.habits.find(x=>x.id===r.habitId);showConfirm('Delete reminder?',`Remove the reminder for ${h?.name||'this habit'}?`,()=>{state.reminders=state.reminders.filter(x=>x.id!==reminderId);if(h)h.reminder='';saveHabits();saveReminders();renderDashboard();renderSettings();showToast('Reminder deleted')})}
function previewSelectedReminderSound(){playReminderSound(document.getElementById('reminderSound').value)}
function getReminderSnoozes(){return lsGet('habitly_reminder_snoozes',{})}function setReminderSnooze(key,until){const d=getReminderSnoozes();d[key]=until;lsSet('habitly_reminder_snoozes',d)}
function showReminderAlert(reminder){const h=state.habits.find(x=>x.id===reminder.habitId);if(!h)return;state.reminderAlert={reminder,h};document.getElementById('reminderAlertIcon').textContent=h.icon;document.getElementById('reminderAlertTitle').textContent=`Time for ${h.name}`;document.getElementById('reminderAlertMessage').textContent=`Your ${formatTime12(reminder.time)} reminder is due. Keep the momentum going.`;document.getElementById('reminderAlertOverlay').classList.add('open');document.getElementById('reminderAlertOverlay').setAttribute('aria-hidden','false');playReminderSound(reminder.sound)}
function closeReminderAlert(){document.getElementById('reminderAlertOverlay').classList.remove('open');document.getElementById('reminderAlertOverlay').setAttribute('aria-hidden','true');state.reminderAlert=null}
function completeAlertHabit(){const r=state.reminderAlert?.reminder;if(!r)return;const h=state.habits.find(x=>x.id===r.habitId);if(h){const rec=ensureRecord(todayStr(),h);if(h.type==='quantity')rec.value=h.target;if(h.type==='count')rec.items=(h.items||[]).map(()=>true);rec.completed=true;rec.completedAt=new Date().toISOString();saveRecords();checkAchievements();renderCurrentView()}closeReminderAlert();showToast('Habit marked complete ✓')}
function snoozeAlert(){const r=state.reminderAlert?.reminder;if(!r)return;setReminderSnooze(`${todayStr()}|${r.id}|${r.time}`,Date.now()+10*60*1000);closeReminderAlert();showToast('Reminder snoozed for 10 minutes')}

/* ------------------------------- PROFILE / WELCOME ------------------------------- */

function showWelcomeScreen(){
  const screen = document.getElementById('welcomeScreen');
  if(!screen) return;
  const nameInput=document.getElementById('welcomeName');
  const emailInput=document.getElementById('welcomeEmail');
  const consent=document.getElementById('welcomeConsent');
  if(state.profile){
    if(nameInput) nameInput.value=state.profile.name || '';
    if(emailInput) emailInput.value=state.profile.email || '';
    if(consent) consent.checked=state.profile.shareRecords !== false;
    const heading=screen.querySelector('.welcome-form-head h2');
    const sub=screen.querySelector('.welcome-form-head > p:last-child');
    if(heading) heading.textContent='Welcome back to Habitly';
    if(sub) sub.textContent='Continue with your profile to pick up where you left off.';
  }else{
    const heading=screen.querySelector('.welcome-form-head h2');
    const sub=screen.querySelector('.welcome-form-head > p:last-child');
    if(heading) heading.textContent='Welcome to Habitly';
    if(sub) sub.textContent="Let's get started with your profile.";
  }
  screen.classList.add('open');
  screen.setAttribute('aria-hidden','false');
  setTimeout(()=>nameInput?.focus(),80);
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
  if(nameEl) nameEl.textContent=name;
  if(emailEl) emailEl.textContent=email;
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
  state.sessionActive=true;
  lsSet(LS_KEYS.profile,state.profile);
  lsSet(LS_KEYS.session,true);
  updateProfileUI();
  if(shareRecords) await registerVisitorRemotely(state.profile);
}

function logoutLocalProfile(){
  showConfirm('Log out of Habitly?', 'You will return to the welcome page. Your profile, habits and progress will stay on this browser so you can continue later.', ()=>{
    state.sessionActive=false;
    lsSet(LS_KEYS.session,false);
    localStorage.removeItem('habitly_notified_reminders');
    localStorage.removeItem('habitly_reminder_snoozes');
    setView('dashboard');
    showWelcomeScreen();
    showToast('Logged out. Your data is safe.');
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
    state.sessionActive=true;
    lsSet(LS_KEYS.profile,state.profile);
    lsSet(LS_KEYS.session,true);
    updateProfileUI();
    if(shareRecords) await registerVisitorRemotely(state.profile);
    hideWelcomeScreen();
    renderDashboard();
    renderSettings();
    showToast(`Welcome, ${name}!`);
  });
  document.getElementById('editProfileBtn')?.addEventListener('click',editProfile);
  document.getElementById('logoutBtn')?.addEventListener('click',logoutLocalProfile);
  document.getElementById('sidebarLogoutBtn')?.addEventListener('click',logoutLocalProfile);
  document.getElementById('mobileLogoutBtn')?.addEventListener('click',logoutLocalProfile);
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
  const now=new Date(),today=todayStr(),currentMinutes=now.getHours()*60+now.getMinutes(),notified=getNotifiedReminders(),snoozes=getReminderSnoozes();
  state.reminders.filter(r=>r.enabled!==false).forEach(r=>{const h=state.habits.find(x=>x.id===r.habitId);if(!h||!h.enabled||!isHabitScheduledOnDate(h,today))return;const rec=getRecord(today,h.id);if(rec&&rec.completed)return;const [hr,min]=r.time.split(':').map(Number),reminderMinutes=hr*60+min,key=`${today}|${r.id}|${r.time}`;if(snoozes[key]&&Date.now()<snoozes[key])return;if(currentMinutes<reminderMinutes)return;if(currentMinutes-reminderMinutes>2&&!force&&!snoozes[key])return;if(notified[key]&&!snoozes[key])return;
    if(notificationSupported()&&Notification.permission==='granted'){const n=new Notification(`${h.icon} ${h.name}`,{body:`It's time for your ${h.name} habit.`,tag:`habitly-${r.id}-${today}`,icon:'./favicon.svg'});n.onclick=()=>{window.focus();setView('dashboard')}}
    markReminderNotified(key);delete snoozes[key];lsSet('habitly_reminder_snoozes',snoozes);showReminderAlert(r)
  })
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
  renderSettingsReminders();
}
function renderSettingsReminders(){
  const c=document.getElementById('settingsRemindersList');if(!c)return;const rows=state.reminders.map(r=>({r,h:state.habits.find(h=>h.id===r.habitId)})).filter(x=>x.h);
  if(!rows.length){c.innerHTML='<div class="empty-state compact-empty"><span>⏰</span><div>No reminders configured.</div></div>';return}
  c.innerHTML=rows.map(({r,h})=>`<div class="settings-reminder-row"><span class="habit-icon">${h.icon}</span><div class="settings-reminder-main"><strong>${escapeHtml(h.name)}</strong><span>${formatTime12(r.time)} · ${soundLabel(r.sound)}</span></div><button class="btn-icon-sm" data-edit-settings-reminder="${r.id}" aria-label="Edit reminder">✎</button><button class="btn-icon-sm danger-icon" data-delete-settings-reminder="${r.id}" aria-label="Delete reminder">×</button></div>`).join('');
  c.querySelectorAll('[data-edit-settings-reminder]').forEach(b=>b.addEventListener('click',()=>openEditReminderModal(b.dataset.editSettingsReminder)));c.querySelectorAll('[data-delete-settings-reminder]').forEach(b=>b.addEventListener('click',()=>deleteReminder(b.dataset.deleteSettingsReminder)));
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
    settings: state.settings,
    reminders: state.reminders,
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
        state.settings = data.settings || { theme:'dark' };
        state.reminders = Array.isArray(data.reminders) ? data.reminders : [];
        state.profile = data.profile || null;
        state.sessionActive = !!state.profile;
        if(!state.reminders.length) state.reminders=state.habits.filter(h=>h.reminder).map(h=>({id:uid('r'),habitId:h.id,time:h.reminder,sound:h.reminderSound||'gentle',enabled:true}));
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
  showConfirm('Reset all data?', 'Every habit, record, goal, achievement and reminder will be permanently deleted. This cannot be undone.', ()=>{
    Object.values(LS_KEYS).forEach(k=> localStorage.removeItem(k));
    localStorage.removeItem('habitly_reminder_snoozes');
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
  document.querySelectorAll('.nav-item, .bnav-item:not(.bnav-logout)').forEach(btn=>{
    btn.addEventListener('click', ()=> setView(btn.dataset.view));
  });

  document.getElementById('dashboardThemeToggle')?.addEventListener('click', ()=>{
    setTheme(state.settings.theme === 'dark' ? 'light' : 'dark');
  });

  document.getElementById('quickActionsGrid')?.addEventListener('click', (e)=>{
    const action=e.target.closest('[data-quick-action]')?.dataset.quickAction;
    if(!action) return;
    if(action==='habit') openAddHabitModal();
    if(action==='reminder') openAddReminderModal();
    if(action==='goals') setView('goals');
    if(action==='stats') setView('statistics');
  });

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

  document.getElementById('openAddReminderBtn')?.addEventListener('click',openAddReminderModal);
  document.getElementById('openAddReminderBtnSettings')?.addEventListener('click',openAddReminderModal);
  document.getElementById('closeReminderModalBtn')?.addEventListener('click',closeReminderModal);
  document.getElementById('cancelReminderBtn')?.addEventListener('click',closeReminderModal);
  document.getElementById('reminderModalOverlay')?.addEventListener('click',e=>{if(e.target.id==='reminderModalOverlay')closeReminderModal()});
  document.getElementById('reminderForm')?.addEventListener('submit',saveReminderFromForm);
  document.getElementById('previewReminderSoundBtn')?.addEventListener('click',previewSelectedReminderSound);
  document.getElementById('reminderHabit')?.addEventListener('change',()=>{const h=state.habits.find(x=>x.id===document.getElementById('reminderHabit').value),r=h&&getReminderByHabit(h.id);document.getElementById('reminderTime').value=r?.time||h?.reminder||'20:00';document.getElementById('reminderSound').value=r?.sound||h?.reminderSound||'gentle'});
  document.getElementById('reminderSnoozeBtn')?.addEventListener('click',snoozeAlert);
  document.getElementById('reminderCompleteBtn')?.addEventListener('click',completeAlertHabit);
  document.getElementById('reminderAlertOverlay')?.addEventListener('click',e=>{if(e.target.id==='reminderAlertOverlay')closeReminderAlert()});
  document.getElementById('achievementFilter')?.addEventListener('click',e=>{const b=e.target.closest('[data-ach-cat]');if(!b)return;document.querySelectorAll('#achievementFilter [data-ach-cat]').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.achievementFilter=b.dataset.achCat;renderAchievements()});
  setupProfile();
  setupNotifications();

  // Escape key closes modals
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      closeHabitModal(); closeGoalModal(); closeReminderModal(); closeConfirm(); closeReminderAlert();
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
  if(!state.profile || !state.sessionActive) showWelcomeScreen();

  // keep dashboard/reminders time-aware
  setInterval(()=>{
    if(state.currentView === 'dashboard') renderDashboard();
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
