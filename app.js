/* Habitly — unified five-page frontend
   Dashboard / Habits / Goals / Calendar / Statistics
*/
const AS = 'assets/';
const APP_VERSION = '3.9.7';
const ROUTES = ['dashboard', 'habits', 'goals', 'calendar', 'statistics', 'settings'];
const STORAGE = 'habitly.final.v2';
const USER_STORAGE_PREFIX = 'habitly.final.v3.user.';
const STORAGE_OWNER_PREFIX = 'habitly.final.v3.owner.';
let currentAuthUser = null;
let currentStorageKey = '';
// Google Drive OAuth: replace with your Google Cloud Web OAuth client ID.
const GOOGLE_DRIVE_CLIENT_ID = window.HABITLY_CONFIG?.googleDriveClientId || '';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let googleTokenClient = null;
let googleAccessToken = '';
let googleTokenExpiresAt = 0;
let googleDriveBusy = false;
let driveUploadQueued = false;
// Explicit initialization phases: AUTH_INITIALIZING -> DRIVE_RESTORING -> READY.
// While DRIVE_RESTORING, normal automatic Drive uploads stay blocked (see
// driveStorageSelected/scheduleDriveBackup) and render() shows a small
// restoring notice instead of flashing whatever state happens to be in
// localStorage, which may be stale relative to the Drive backup being
// downloaded.
let appPhase = 'AUTH_INITIALIZING';
let driveBackupTimer = null;
let driveLoginSyncPending = false;
let driveLoginSyncBusy = false; let driveLoginSyncedUserId = '';
let driveHydrationConfirmedUserId = '';
let driveHydrationGeneration = 0;
let driveLoginSyncRetryTimer = null;
let driveLoginSyncRetryUsed = false;
let driveLoginSyncWaitAttempts = 0;
let driveTokenRequestPromise = null;
let driveTokenRequestContext = null;
let deferredInstallPrompt = null;
let cropState = null;
let pendingUndo = null;
let storageOnboardingMode = '';
let storageOnboardingBusy = false;
let syncBaseState = null;
let syncDirty = { habits: false, goals: false, events: false, reminders: false, profile: false, settings: false, activityHistory: false };
let syncLastSavedSnapshot = null;
let driveRemoteMissing = false;
let driveLastKnownRemoteModifiedAt = '';
let driveLastSyncCheckAt = 0;
let driveSyncRetryTimer = null;
let driveSyncRetryCount = 0;
let syncGeneration = 0;

// Supabase is the realtime synchronization layer for cloud-enabled accounts.
// Google Drive remains a backup/restore/export layer.
const CLOUD_TABLE = 'habitly_sync_documents_v2';
const CLOUD_CHANNEL = 'habitly-cloud-sync';
let cloudRevision = 0;
let cloudDeviceId = '';
let cloudSyncTimer = null;
let cloudSyncBusy = false;
let cloudSyncQueued = false;
let cloudSyncPending = false;
let cloudSyncAvailable = false;
let cloudSyncLastAt = 0;
let cloudSyncError = '';
let cloudChannel = null;
let cloudRealtimeReady = false;
let cloudLastSafetyPollAt = 0;
let cloudHydrationGeneration = 0;
let cloudHydrationConfirmedUserId = '';
let reminderSchedulerTimer = null;
let reminderUiTimer = null;
let headerClockTimer = null;
let lastReminderSweepKey = "";

const defaultState = {
  habits: [
    { id: 'h1', name: 'Drink Water', emoji: '🥤', category: 'Health', target: 8, current: 0, unit: 'glasses', paused: false, created: 1, frequency: 'Daily' },
    { id: 'h2', name: 'Read Book', emoji: '📖', category: 'Personal', target: 30, current: 0, unit: 'pages', paused: false, created: 2, frequency: 'Daily' },
    { id: 'h3', name: 'Workout', emoji: '🏋️', category: 'Fitness', target: 30, current: 0, unit: 'min', paused: false, created: 3, frequency: 'Daily' },
    { id: 'h4', name: 'Meditate', emoji: '🧘', category: 'Mindfulness', target: 15, current: 0, unit: 'min', paused: false, created: 4, frequency: 'Daily' },
    { id: 'h5', name: 'Practice Coding', emoji: '⌨️', category: 'Study', target: 60, current: 0, unit: 'min', paused: false, created: 5, frequency: 'Daily' }
  ],
  goals: [
    { id: 'g1', title: 'Score 90% in Final Exams', emoji: '🎓', category: 'Education', target: 90, current: 0, unit: '%', date: '2026-12-30', status: 'active' },
    { id: 'g2', title: 'Save ₹1,00,000', emoji: '💰', category: 'Finance', target: 100000, current: 0, unit: '₹', date: '2027-01-31', status: 'active' },
    { id: 'g3', title: 'Lose 8 kg', emoji: '🏋️', category: 'Health', target: 8, current: 0, unit: 'kg', date: '2026-11-15', status: 'active' },
    { id: 'g4', title: 'Learn Data Structures', emoji: '📚', category: 'Learning', target: 100, current: 0, unit: '%', date: '2026-10-30', status: 'active' }
  ],
  events: [],
  reminders: [],
  profile: { name: '', email: '', avatar: '' },
  activityHistory: {},
  syncMeta: { deleted: { habits: {}, goals: {}, events: {}, reminders: {} }, recordVersions: { habits: {}, goals: {}, events: {}, reminders: {} }, pending: { habits: false, goals: false, events: false, reminders: false, profile: false, settings: false, activityHistory: false }, mutations: [] },
  settings: {
    timeFormat: '12h',
    notifications: { daily: true, habitReminders: true, eventReminders: true, motivational: true, weekly: true, goal: true, defaultHabitTime: '20:00:00', defaultHabitDays: [0,1,2,3,4,5,6] },
    habits: { defaultView: 'All Habits', weekStarts: 'Sunday', autoComplete: true, keepStreak: true, quickQuantity: true },
    fitness: { workoutLogging: false, bodyMeasurements: false },
    drive: { connected: false, email: '', folderId: '', fileId: '', lastBackupDate: '', lastBackupAt: '', lastRemoteUpdatedAt: '', remoteEverSynced: false, syncRevision: 0, autoDaily: false },
    storage: { mode: 'cloud', setupCompleted: true }
  }
};

let state = normalizeState(clone(defaultState));
let calendarSelectedDate = todayISO();

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function userStorageKey(userId) { return USER_STORAGE_PREFIX + String(userId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_'); }
function freshUserState(user) {
  const fresh = clone(defaultState);
  fresh.habits = fresh.habits.map(h => ({ ...h, current: 0, daily: {} }));
  fresh.goals = [];
  fresh.events = [];
  fresh.reminders = [];
  fresh.activityHistory = {};
  fresh.syncMeta = clone(defaultState.syncMeta);
  fresh.settings.storage = { mode: 'cloud', setupCompleted: true };
  fresh.profile = {
    name: user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? user.email.split('@')[0] : 'Habitly User'),
    email: user?.email || '',
    avatar: user?.user_metadata?.avatar_url || user?.user_metadata?.picture || ''
  };
  return normalizeState(fresh);
}
function loadStateForUser(user) {
  currentAuthUser = user || null;
  currentStorageKey = user?.id ? userStorageKey(user.id) : '';
  if (!user?.id) return freshUserState(null);
  try {
    const raw = localStorage.getItem(currentStorageKey);
    if (raw) return normalizeState(mergeState(JSON.parse(raw)));

    // Legacy v2 was a single browser-wide key with no authenticated owner.
    // Never silently assign it to an account unless the stored profile email
    // proves it belongs to the current account. Otherwise leave it untouched
    // for explicit manual recovery instead of risking cross-account leakage.
    const legacyRaw = localStorage.getItem(STORAGE);
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw);
        const legacyEmail = String(legacy?.profile?.email || '').trim().toLowerCase();
        const accountEmail = String(user.email || '').trim().toLowerCase();
        if (legacyEmail && accountEmail && legacyEmail === accountEmail) {
          const migrated = normalizeState(mergeState(legacy));
          localStorage.setItem(currentStorageKey, JSON.stringify(migrated));
          localStorage.removeItem(STORAGE);
          localStorage.setItem(STORAGE_OWNER_PREFIX + user.id, accountEmail);
          return migrated;
        }
      } catch (_) {}
    }
    return freshUserState(user);
  } catch (e) {
    console.error('Habitly local state load failed:', e);
    return freshUserState(user);
  }
}

function loadState() { return loadStateForUser(currentAuthUser); }
function mergeState(saved, options = {}) {
  const preserveMutations = options.preserveMutations !== false;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const merged = {
    habits: Array.isArray(saved.habits) ? saved.habits : [],
    goals: Array.isArray(saved.goals) ? saved.goals : [],
    events: Array.isArray(saved.events) ? saved.events : [],
    reminders: Array.isArray(saved.reminders) ? saved.reminders : [],
    profile: saved.profile ? { ...clone(defaultState.profile), ...saved.profile } : clone(defaultState.profile),
    activityHistory: saved.activityHistory && typeof saved.activityHistory === 'object' ? saved.activityHistory : {},
    syncMeta: saved.syncMeta && typeof saved.syncMeta === 'object' ? {
      deleted: { habits: { ...(saved.syncMeta.deleted?.habits || {}) }, goals: { ...(saved.syncMeta.deleted?.goals || {}) }, events: { ...(saved.syncMeta.deleted?.events || {}) }, reminders: { ...(saved.syncMeta.deleted?.reminders || {}) } },
      recordVersions: { habits: { ...(saved.syncMeta.recordVersions?.habits || {}) }, goals: { ...(saved.syncMeta.recordVersions?.goals || {}) }, events: { ...(saved.syncMeta.recordVersions?.events || {}) }, reminders: { ...(saved.syncMeta.recordVersions?.reminders || {}) } },
      pending: { ...defaultState.syncMeta.pending, ...(saved.syncMeta.pending || {}) },
      mutations: preserveMutations && Array.isArray(saved.syncMeta.mutations) ? clone(saved.syncMeta.mutations) : [],
      cloudRevision: Number(saved.syncMeta.cloudRevision) || 0,
      cloudDeviceId: String(saved.syncMeta.cloudDeviceId || '')
    } : clone(defaultState.syncMeta),
    settings: saved.settings ? {
      ...clone(defaultState.settings), ...saved.settings,
      timeFormat: saved.settings?.timeFormat === '24h' ? '24h' : '12h',
      notifications: normalizeNotificationSettings({ ...defaultState.settings.notifications, ...(saved.settings.notifications || {}) }),
      habits: { ...defaultState.settings.habits, ...(saved.settings.habits || {}) },
      fitness: { ...defaultState.settings.fitness, ...(saved.settings.fitness || {}) },
      drive: { ...defaultState.settings.drive, ...(saved.settings.drive || {}) },
      storage: { ...defaultState.settings.storage, ...(saved.settings.storage || {}) }
    } : clone(defaultState.settings)
  };
  merged.reminders = merged.reminders.filter(r => r && r.source === 'manual');
  return merged;
}
function buildSnapshot(s, date) { return { date, habits: (s.habits || []).map(h => { const current = Math.max(0, Number((h.daily || {})[date] ?? 0) || 0), target = Math.max(1, Number(h.target) || 1); return { id: h.id, name: h.name, emoji: h.emoji || '', category: h.category, paused: !!h.paused, target, unit: h.unit || '', current, percent: Math.min(100, Math.round(current / target * 100)) }; }) }; }
function captureActivitySnapshot(s, date) { s.activityHistory = s.activityHistory || {}; const snap = buildSnapshot(s, date); const meaningful = snap.habits.some(h => h.current > 0); if (meaningful || s.activityHistory[date]) s.activityHistory[date] = snap; }
function normalizeFitnessGoal(g) {
  if (!g || g.type !== 'fitness') return g;
  const f = g.fitness && typeof g.fitness === 'object' ? g.fitness : {};
  const startWeight = Number(f.startWeight ?? g.startWeight ?? g.current ?? 0) || 0;
  const targetWeight = Number(f.targetWeight ?? g.target ?? 0) || 0;
  const entries = Array.isArray(f.weightEntries) ? f.weightEntries : [];
  const measurements = Array.isArray(f.measurements) ? f.measurements : [];
  const workouts = Array.isArray(f.workouts) ? f.workouts : [];
  g.fitness = {
    direction: f.direction === 'loss' ? 'loss' : 'gain',
    startWeight, targetWeight,
    height: Number(f.height) || 0,
    age: Number(f.age) || 0,
    gender: String(f.gender || ''),
    weightEntries: entries.filter(x => x && x.date && Number.isFinite(Number(x.weight))).map(x => ({
      id: String(x.id || uid('fw')), date: String(x.date).slice(0,10), weight: Number(x.weight), bodyFat: Number(x.bodyFat) || 0,
      notes: String(x.notes || ''), updatedAt: x.updatedAt || new Date().toISOString()
    })).sort((a,b)=>a.date.localeCompare(b.date)),
    measurements: measurements.filter(x => x && x.date).map(x => ({ id:String(x.id||uid('fm')), date:String(x.date).slice(0,10), chest:Number(x.chest)||0, waist:Number(x.waist)||0, arms:Number(x.arms)||0, thighs:Number(x.thighs)||0, shoulders:Number(x.shoulders)||0, hips:Number(x.hips)||0, updatedAt:x.updatedAt||new Date().toISOString() })),
    workouts: workouts.filter(x => x && x.date && x.exercise).map(x => ({ id:String(x.id||uid('fwk')), date:String(x.date).slice(0,10), exercise:String(x.exercise), weight:Number(x.weight)||0, reps:Number(x.reps)||0, sets:Number(x.sets)||0, notes:String(x.notes||''), updatedAt:x.updatedAt||new Date().toISOString() }))
  };
  const latest = g.fitness.weightEntries[g.fitness.weightEntries.length - 1];
  g.current = latest ? latest.weight : startWeight;
  g.target = targetWeight;
  g.unit = 'kg';
  g.category = 'Fitness';
  return g;
}


function normalizeGoalComponents(g) {
  if (!g || typeof g !== 'object') return g;
  const legacy = g.type;
  const old = g.components && typeof g.components === 'object' ? g.components : {};
  const components = {
    target: old.target !== undefined ? !!old.target : !['milestone','habit'].includes(legacy),
    milestones: old.milestones !== undefined ? !!old.milestones : legacy === 'milestone',
    habits: old.habits !== undefined ? !!old.habits : legacy === 'habit'
  };
  if (!components.target && !components.milestones && !components.habits) components.target = true;
  g.components = components;
  g.milestones = Array.isArray(g.milestones) ? g.milestones : [];
  g.milestones = g.milestones.map((m, i) => ({
    id: String(m?.id || uid('gm')),
    title: String(m?.title ?? m?.name ?? (m?.value != null ? `${m.value}${g.unit || ''}` : `Milestone ${i+1}`)),
    value: Number.isFinite(Number(m?.value)) ? Number(m.value) : null,
    completed: !!m?.completed,
    completedAt: m?.completedAt || '',
    updatedAt: m?.updatedAt || new Date().toISOString()
  }));
  g.goalHabitIds = Array.isArray(g.goalHabitIds) ? g.goalHabitIds.map(String) : [];
  if (g.type === 'fitness') {
    // Weight milestones are derived from actual weight; never preserve a
    // legacy checked state that contradicts the current weight.
    const current = fitnessCurrentWeight(g);
    const dir = g.fitness?.direction === 'loss' ? 'loss' : 'gain';
    g.milestones.forEach(m => {
      if (Number.isFinite(m.value)) {
        const reached = dir === 'loss' ? current <= m.value : current >= m.value;
        if (reached) {
          m.completed = true;
          m.completedAt = m.completedAt || new Date().toISOString();
        } else {
          m.completed = false;
          m.completedAt = '';
        }
      }
    });
  }
  return g;
}
function goalTargetProgress(g) {
  if (!g?.components?.target) return null;
  if (g.type === 'fitness') return fitnessProgress(g);
  const target = Math.max(1, Number(g.target) || 1);
  const current = Math.max(0, Number(g.current) || 0);
  return Math.min(100, Math.round(current / target * 100));
}
function goalMilestoneProgress(g) {
  if (!g?.components?.milestones) return null;
  const ms = Array.isArray(g.milestones) ? g.milestones : [];
  if (!ms.length) return 0;
  return Math.round(ms.filter(m => m.completed).length / ms.length * 100);
}
function goalHabitProgress(g) {
  if (!g?.components?.habits) return null;
  const hs = (g.goalHabitIds || []).map(id => state.habits.find(h => h.id === id)).filter(Boolean).filter(h => !h.paused);
  if (!hs.length) return 0;
  return Math.round(hs.reduce((sum,h)=>sum+pct(h),0) / hs.length);
}
function goalOverallProgress(g) {
  const t = goalTargetProgress(g);
  if (t !== null) return t;
  const m = goalMilestoneProgress(g);
  if (m !== null) return m;
  const h = goalHabitProgress(g);
  return h === null ? 0 : h;
}

function fitnessEntries(g) { return g?.type === 'fitness' && Array.isArray(g.fitness?.weightEntries) ? g.fitness.weightEntries : []; }
function fitnessCurrentWeight(g) { const e=fitnessEntries(g); return e.length ? Number(e[e.length-1].weight) : Number(g?.fitness?.startWeight || g?.current || 0); }
function fitnessAverage(g, days=7) { const e=fitnessEntries(g); if (!e.length) return fitnessCurrentWeight(g); const cutoff=new Date(); cutoff.setHours(12,0,0,0); cutoff.setDate(cutoff.getDate()-(days-1)); const vals=e.filter(x=>new Date(x.date+'T12:00:00')>=cutoff).map(x=>Number(x.weight)).filter(Number.isFinite); const use=vals.length?vals:e.slice(-Math.min(days,e.length)).map(x=>Number(x.weight)); return use.reduce((a,b)=>a+b,0)/Math.max(1,use.length); }
function fitnessProgress(g) { const f=g?.fitness||{}; const start=Number(f.startWeight)||0, target=Number(f.targetWeight)||0, current=fitnessCurrentWeight(g); if (f.direction==='loss') return target<start ? Math.min(100,Math.max(0,((start-current)/(start-target))*100)) : 0; return target>start ? Math.min(100,Math.max(0,((current-start)/(target-start))*100)) : 0; }
function fitnessChange(g) { const f=g?.fitness||{}; return fitnessCurrentWeight(g)-(Number(f.startWeight)||0); }
function fitnessWeeklyRate(g) { const e=fitnessEntries(g); if(e.length<2)return 0; const first=e[0], last=e[e.length-1]; const days=Math.max(1,(new Date(last.date)-new Date(first.date))/86400000); return (Number(last.weight)-Number(first.weight))/(days/7); }
function fitnessGoalStatus(g) { const p=fitnessProgress(g); const f=g?.fitness||{}; const reached=f.direction==='loss' ? fitnessCurrentWeight(g)<=Number(f.targetWeight) : fitnessCurrentWeight(g)>=Number(f.targetWeight); return reached ? 'completed' : g.status==='paused' ? 'paused' : 'active'; }

function normalizeState(s) {
  const input = (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  const out = clone(input);
  const today = todayISO();

  out.habits = Array.isArray(out.habits) ? out.habits : [];
  out.goals = Array.isArray(out.goals) ? out.goals : [];
  out.goals.forEach(normalizeFitnessGoal);
  out.events = Array.isArray(out.events) ? out.events : [];
  out.reminders = Array.isArray(out.reminders) ? out.reminders : [];
  out.activityHistory = out.activityHistory && typeof out.activityHistory === 'object' && !Array.isArray(out.activityHistory) ? out.activityHistory : {};
  out.profile = out.profile && typeof out.profile === 'object' ? { ...clone(defaultState.profile), ...out.profile } : clone(defaultState.profile);
  out.syncMeta = out.syncMeta && typeof out.syncMeta === 'object' ? out.syncMeta : clone(defaultState.syncMeta);
  out.syncMeta.deleted = out.syncMeta.deleted && typeof out.syncMeta.deleted === 'object' ? out.syncMeta.deleted : clone(defaultState.syncMeta.deleted);
  out.syncMeta.recordVersions = out.syncMeta.recordVersions && typeof out.syncMeta.recordVersions === 'object' ? out.syncMeta.recordVersions : clone(defaultState.syncMeta.recordVersions);
  for (const key of ['habits','goals','events','reminders']) out.syncMeta.recordVersions[key] = out.syncMeta.recordVersions[key] && typeof out.syncMeta.recordVersions[key] === 'object' ? out.syncMeta.recordVersions[key] : {};
  for (const key of ['habits','goals','events','reminders']) out.syncMeta.deleted[key] = out.syncMeta.deleted[key] && typeof out.syncMeta.deleted[key] === 'object' ? out.syncMeta.deleted[key] : {};
  out.syncMeta.pending = out.syncMeta.pending && typeof out.syncMeta.pending === 'object' ? { ...defaultState.syncMeta.pending, ...out.syncMeta.pending } : { ...defaultState.syncMeta.pending };
  out.syncMeta.mutations = Array.isArray(out.syncMeta.mutations) ? out.syncMeta.mutations.filter(m => m && typeof m === 'object' && ['habits','goals','events','reminders','profile','settings','activityHistory'].includes(m.kind) && ['upsert','delete','replace'].includes(m.op) && m.at) : [];
  out.syncMeta.cloudRevision = Number(out.syncMeta.cloudRevision) || 0;
  out.syncMeta.cloudDeviceId = String(out.syncMeta.cloudDeviceId || '');
  out.settings = out.settings && typeof out.settings === 'object' ? {
    ...clone(defaultState.settings), ...out.settings,
    timeFormat: out.settings?.timeFormat === '24h' ? '24h' : '12h',
    notifications: normalizeNotificationSettings({ ...defaultState.settings.notifications, ...(out.settings.notifications || {}) }),
    habits: { ...defaultState.settings.habits, ...(out.settings.habits || {}) },
    fitness: { ...defaultState.settings.fitness, ...(out.settings.fitness || {}) },
    drive: { ...defaultState.settings.drive, ...(out.settings.drive || {}) },
    storage: { ...defaultState.settings.storage, ...(out.settings.storage || {}) }
  } : clone(defaultState.settings);
  if (out.settings.drive.driveOptInVersion !== 1) { out.settings.drive.autoDaily = false; out.settings.drive.driveOptInVersion = 1; }

  out.habits = out.habits.map(h => {
    const habit = { ...h };
    habit.daily = habit.daily && typeof habit.daily === 'object' && !Array.isArray(habit.daily) ? { ...habit.daily } : {};
    habit.dailyUpdatedAt = habit.dailyUpdatedAt && typeof habit.dailyUpdatedAt === 'object' && !Array.isArray(habit.dailyUpdatedAt) ? { ...habit.dailyUpdatedAt } : {};
    // current is a view of today's authoritative daily record. Historical
    // current values are deliberately not carried into today.
    const rawToday = habit.daily[today];
    habit.current = Number.isFinite(Number(rawToday)) ? Math.max(0, Number(rawToday)) : 0;
    if (Number.isFinite(Number(habit.target))) habit.target = Math.max(1, Number(habit.target));
    return habit;
  });

  out.goals = out.goals.filter(Boolean).map(g => ({
    ...g,
    current: Math.max(0, Number(g.current) || 0),
    target: Math.max(1, Number(g.target) || 1)
  })).map(normalizeGoalComponents);

  out.events = out.events.filter(e => e && typeof e === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))).map(e => ({
    ...e,
    time: parseTime24(e.time) || '12:00:00',
    updatedAt: e.updatedAt || new Date().toISOString()
  }));
  out.reminders = out.reminders.filter(r => {
    if (!r || typeof r !== 'object' || r.source !== 'manual') return false;
    if (!parseTime24(r.time)) return false;
    return stateReminderHabitExists(out.habits, r.habitId) || stateReminderEventExists(out.events, r.eventId);
  }).map(r => ({
    ...r,
    time: parseTime24(r.time),
    offsetMinutes: r.eventId ? 0 : undefined,
    days: r.eventId ? undefined : normalizeReminderDays(r.days)
  }));

  // History is observational data, never something normalization invents.
  // Keep only structurally valid date keys and snapshots; do not manufacture
  // a snapshot from a habit's current value.
  const validHistory = {};
  for (const [date, snap] of Object.entries(out.activityHistory)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !snap || !Array.isArray(snap.habits)) continue;
    validHistory[date] = { ...snap, date, habits: snap.habits.filter(Boolean).map(h => ({ ...h, current: Math.max(0, Number(h.current) || 0), target: Math.max(1, Number(h.target) || 1), percent: Math.min(100, Math.max(0, Number(h.percent) || 0)) })) };
  }
  out.activityHistory = validHistory;
  return out;
}
function normalizeNotificationSettings(input = {}) {
  const n = { ...clone(defaultState.settings.notifications), ...(input || {}) };
  n.habitReminders = n.habitReminders !== false;
  n.eventReminders = n.eventReminders !== false;
  n.daily = n.habitReminders;
  n.motivational = n.motivational !== false;
  n.weekly = n.weekly !== false;
  n.goal = n.goal !== false;
  // Events always notify at the event time. Legacy offset settings are ignored.
  delete n.defaultEventOffset;
  n.defaultHabitTime = parseTime24(n.defaultHabitTime) || '20:00:00';
  const days = Array.isArray(n.defaultHabitDays) ? n.defaultHabitDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  n.defaultHabitDays = [...new Set(days)].sort((a,b) => a-b);
  if (!n.defaultHabitDays.length) n.defaultHabitDays = [0,1,2,3,4,5,6];
  return n;
}
function stateReminderHabitExists(habits, id) { return !!id && habits.some(h => h && h.id === id); }
function stateReminderEventExists(events, id) { return !!id && events.some(e => e && e.id === id); }
function normalizeReminderDays(days) { const values = Array.isArray(days) ? days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : []; const unique = [...new Set(values)].sort((a,b) => a-b); return unique.length ? unique : [0,1,2,3,4,5,6]; }

function createSyncSnapshot(s) {
  const snap = clone(s || {});
  if (snap.profile) snap.profile.avatar = '';
  return snap;
}
function markSyncDirty(previous, current) {
  if (!currentAuthUser || !previous) return;
  const keys = ['habits','goals','events','reminders','profile','settings','activityHistory'];
  for (const key of keys) {
    if (JSON.stringify(previous[key] ?? null) !== JSON.stringify(current[key] ?? null)) syncDirty[key] = true;
  }
}
function dirtyFromMutations() {
  const dirty = { habits:false, goals:false, events:false, reminders:false, profile:false, settings:false, activityHistory:false };
  for (const m of state?.syncMeta?.mutations || []) if (dirty[m.kind] !== undefined) dirty[m.kind] = true;
  return dirty;
}
function resetSyncTracking(base = state) {
  syncBaseState = createSyncSnapshot(base);
  syncLastSavedSnapshot = createSyncSnapshot(base);
  syncDirty = dirtyFromMutations();
}
function appendSyncMutations(previous, current) {
  if (!currentAuthUser || !previous) return;
  current.syncMeta = current.syncMeta || clone(defaultState.syncMeta);
  current.syncMeta.mutations = Array.isArray(current.syncMeta.mutations) ? current.syncMeta.mutations : [];
  const now = new Date().toISOString();
  const makeId = () => uid('m');
  const collections = ['habits','goals','events','reminders'];
  for (const kind of collections) {
    const prevMap = new Map((previous[kind] || []).map(x => [x.id, x]));
    const curMap = new Map((current[kind] || []).map(x => [x.id, x]));
    for (const item of current[kind] || []) {
      const before = prevMap.get(item.id);
      if (!before || JSON.stringify(before) !== JSON.stringify(item)) {
        current.syncMeta.mutations.push({ id: makeId(), kind, op:'upsert', record: clone(item), at: item.updatedAt || now, baseRevision: Number(current.syncMeta.cloudRevision) || 0, deviceId: ensureCloudDeviceId() });
      }
    }
    for (const item of previous[kind] || []) {
      if (!curMap.has(item.id)) {
        const tombstone = current.syncMeta.deleted?.[kind]?.[item.id] || now;
        current.syncMeta.mutations.push({ id: makeId(), kind, op:'delete', recordId:item.id, at:tombstone, baseRevision: Number(current.syncMeta.cloudRevision) || 0, deviceId: ensureCloudDeviceId() });
      }
    }
  }
  for (const kind of ['profile','settings']) {
    if (JSON.stringify(previous[kind] ?? null) !== JSON.stringify(current[kind] ?? null)) {
      current.syncMeta.mutations.push({ id: makeId(), kind, op:'replace', record: clone(current[kind]), at: current[kind]?.updatedAt || now, baseRevision: Number(current.syncMeta.cloudRevision) || 0, deviceId: ensureCloudDeviceId() });
    }
  }
  if (JSON.stringify(previous.activityHistory ?? {}) !== JSON.stringify(current.activityHistory ?? {})) {
    current.syncMeta.mutations.push({ id: makeId(), kind:'activityHistory', op:'replace', record:clone(current.activityHistory || {}), at:now, baseRevision: Number(current.syncMeta.cloudRevision) || 0, deviceId: ensureCloudDeviceId() });
  }
  // Coalesce redundant pending writes for the same record using queue order,
  // never wall-clock order. Two rapid edits on one device can legitimately have
  // the same timestamp, and device clocks are not a safe cross-device ordering
  // mechanism. The newest locally queued mutation is always the one retained.
  const latest = new Map();
  current.syncMeta.mutations.forEach((m, index) => {
    const key = `${m.kind}:${m.recordId || m.record?.id || '__all'}`;
    latest.set(key, { mutation: m, index });
  });
  current.syncMeta.mutations = Array.from(latest.values())
    .sort((a,b) => a.index - b.index)
    .map(x => x.mutation);
}
function pendingMutations(s) { return Array.isArray(s?.syncMeta?.mutations) ? s.syncMeta.mutations : []; }
function dirtyFromMutationList(mutations = []) {
  const dirty = { habits:false, goals:false, events:false, reminders:false, profile:false, settings:false, activityHistory:false };
  for (const m of mutations) if (dirty[m.kind] !== undefined) dirty[m.kind] = true;
  return dirty;
}
function getRemoteRecordVersion(remoteState, kind, recordId) {
  return Number(remoteState?.syncMeta?.recordVersions?.[kind]?.[recordId]?.revision || 0);
}
function getRemoteRecordOwner(remoteState, kind, recordId) {
  return String(remoteState?.syncMeta?.recordVersions?.[kind]?.[recordId]?.deviceId || '');
}
function findRecordById(source, kind, id) {
  return (source?.[kind] || []).find(x => x?.id === id) || null;
}
function mutationConflictsWithRemote(remoteState, mutation, baseState) {
  if (!['habits','goals','events','reminders'].includes(mutation?.kind)) return false;
  const id = mutation.recordId || mutation.record?.id;
  if (!id) return false;
  const baseRevision = Number(mutation.baseRevision) || 0;
  const remoteVersion = getRemoteRecordVersion(remoteState, mutation.kind, id);
  const remoteOwner = getRemoteRecordOwner(remoteState, mutation.kind, id);
  const localDevice = String(mutation.deviceId || '');

  // A newer server version from this same device is an earlier mutation from
  // this browser. It must not suppress a newer local edit that was queued
  // before the browser observed its own acknowledgement.
  if (remoteVersion > baseRevision && remoteOwner && localDevice && remoteOwner === localDevice) return false;

  if (remoteVersion > baseRevision) return true;

  // Legacy cloud documents do not have per-record server versions. Fall back
  // conservatively to the local synchronization baseline: if the same record
  // changed remotely after the baseline, do not let a stale pending mutation
  // overwrite it.
  if (Object.prototype.hasOwnProperty.call(mutation, 'baseRevision') && baseRevision > 0 && !remoteVersion && baseState) {
    const remoteRecord = findRecordById(remoteState, mutation.kind, id);
    const baseRecord = findRecordById(baseState, mutation.kind, id);
    if (remoteRecord && baseRecord && JSON.stringify(remoteRecord) !== JSON.stringify(baseRecord)) return true;
  }
  return false;
}
function applyMutationJournal(remoteState, localState, mutations, baseState = null) {
  const merged = normalizeState(mergeState(remoteState || {}, { preserveMutations: false }));
  const local = normalizeState(clone(localState || {}));
  const tomb = merged.syncMeta?.deleted || (merged.syncMeta.deleted = { habits:{}, goals:{}, events:{}, reminders:{} });
  for (const kind of ['habits','goals','events','reminders']) tomb[kind] = tomb[kind] || {};
  const conflicts = [];
  // Pending local mutations are NEVER discarded merely because another device
  // committed a newer server revision. The revision is a compare-and-swap
  // guard for the write, not a reason to throw away an explicit user action.
  // On a CAS conflict we refetch the newest remote state, rebase the complete
  // pending journal on top of it, and retry. This gives us deterministic
  // server-commit ordering without trusting phone/laptop clocks and, crucially,
  // prevents legitimate offline edits from silently disappearing.
  for (const m of [...(mutations || [])]) {
    if (['habits','goals','events','reminders'].includes(m.kind)) {
      const list = Array.isArray(merged[m.kind]) ? merged[m.kind] : [];
      if (m.op === 'delete') {
        merged[m.kind] = list.filter(x=>x.id!==m.recordId);
        tomb[m.kind][m.recordId] = m.at || new Date().toISOString();
      } else if (m.op === 'upsert' && m.record?.id) {
        const existing = list.find(x => x.id === m.record.id);
        let nextRecord = clone(m.record);
        // Habit progress is date-scoped. Merge daily history by the per-day
        // timestamp so two devices can update different days without one full
        // habit snapshot erasing the other's history.
        if (m.kind === 'habits' && existing?.daily && m.record?.daily) {
          nextRecord = mergeCollectionById([existing], [m.record], true, [existing], {})[0] || nextRecord;
        }
        merged[m.kind] = list.filter(x=>x.id!==m.record.id);
        merged[m.kind].push(nextRecord);
        if (tomb[m.kind][m.record.id]) delete tomb[m.kind][m.record.id];
      }
    } else if (m.kind === 'profile' || m.kind === 'settings') {
      if (m.record) merged[m.kind] = clone(m.record);
    } else if (m.kind === 'activityHistory' && m.record) {
      merged.activityHistory = { ...(merged.activityHistory || {}), ...(m.record || {}) };
    }
  }
  merged.syncMeta = merged.syncMeta || clone(defaultState.syncMeta);
  merged.syncMeta.conflictedMutations = conflicts;
  return normalizeState(merged);
}

function recordTime(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : 0;
}
function touchChangedRecords(previous, current) {
  const now = new Date().toISOString();
  const collections = ['habits', 'goals', 'events', 'reminders'];
  for (const key of collections) {
    const prevMap = new Map((previous?.[key] || []).map(x => [x.id, x]));
    for (const item of current?.[key] || []) {
      const before = prevMap.get(item.id);
      const strip = x => { if (!x) return x; const copy = clone(x); delete copy.updatedAt; return copy; };
      if (!before || JSON.stringify(strip(before)) !== JSON.stringify(strip(item))) item.updatedAt = now;
    }
  }
  for (const key of ['profile', 'settings']) {
    if (!current?.[key]) continue;
    const before = previous?.[key];
    const strip = x => { if (!x) return x; const copy = clone(x); delete copy.updatedAt; return copy; };
    if (!before || JSON.stringify(strip(before)) !== JSON.stringify(strip(current[key]))) current[key].updatedAt = now;
  }
  if (current?.habits) {
    const prevMap = new Map((previous?.habits || []).map(x => [x.id, x]));
    for (const habit of current.habits) {
      const before = prevMap.get(habit.id);
      habit.dailyUpdatedAt = habit.dailyUpdatedAt && typeof habit.dailyUpdatedAt === 'object' ? habit.dailyUpdatedAt : {};
      for (const [date, value] of Object.entries(habit.daily || {})) {
        if (!before || Number(before.daily?.[date] ?? 0) !== Number(value ?? 0)) {
          habit.dailyUpdatedAt[date] = now;
          // Progress is a real habit mutation too. Keep the record timestamp
          // current so the mutation journal cannot be rejected as an older
          // edit when another device has a newer Drive snapshot.
          habit.updatedAt = now;
        }
      }
    }
  }
}
function mergeCollectionById(remoteList = [], localList = [], dirty, baseList = [], tombstones = {}) {
  if (!dirty) return clone(remoteList);
  const remoteMap = new Map(remoteList.map(x => [x.id, x]));
  const localMap = new Map(localList.map(x => [x.id, x]));
  const baseMap = new Map(baseList.map(x => [x.id, x]));
  const merged = [];

  for (const local of localList) {
    const remote = remoteMap.get(local.id);
    if (!remote) { merged.push(clone(local)); continue; }

    const base = baseMap.get(local.id);
    const localTime = recordTime(local.updatedAt);
    const remoteTime = recordTime(remote.updatedAt);
    const localChangedAfterBase = !base || localTime > recordTime(base.updatedAt) || JSON.stringify(local) !== JSON.stringify(base);
    const remoteChangedAfterBase = !base || remoteTime > recordTime(base.updatedAt) || JSON.stringify(remote) !== JSON.stringify(base);

    if (local.daily && remote.daily) {
      const winner = localChangedAfterBase && remoteChangedAfterBase
        ? (localTime >= remoteTime ? clone(local) : clone(remote))
        : (localChangedAfterBase ? clone(local) : clone(remote));
      const daily = { ...(remote.daily || {}), ...(local.daily || {}) };
      const dailyUpdatedAt = { ...(remote.dailyUpdatedAt || {}), ...(local.dailyUpdatedAt || {}) };
      for (const date of new Set([...Object.keys(remote.daily || {}), ...Object.keys(local.daily || {})])) {
        const lt = recordTime(local.dailyUpdatedAt?.[date] || local.updatedAt);
        const rt = recordTime(remote.dailyUpdatedAt?.[date] || remote.updatedAt);
        if (remote.daily?.[date] !== undefined && local.daily?.[date] !== undefined && rt > lt) daily[date] = remote.daily[date];
      }
      winner.daily = daily;
      winner.dailyUpdatedAt = dailyUpdatedAt;
      merged.push(winner);
    } else {
      merged.push(localChangedAfterBase && remoteChangedAfterBase
        ? (localTime >= remoteTime ? clone(local) : clone(remote))
        : (localChangedAfterBase ? clone(local) : clone(remote)));
    }
  }

  // A local deletion is represented by a tombstone. If it is newer than the
  // remote record, the deletion wins and the remote copy is deliberately not
  // reintroduced. This fixes the old "delete -> Drive restores the habit"
  // race without making an unrelated newer remote edit disappear.
  for (const remote of remoteList) {
    if (localMap.has(remote.id)) continue;
    const deletedAt = recordTime(tombstones?.[remote.id]);
    if (deletedAt && deletedAt >= recordTime(remote.updatedAt)) continue;
    // A remote record that is not present locally is normally a legitimate
    // concurrent creation/update from another device. Preserve it even when
    // this device has unrelated pending mutations and the local baseline did
    // not contain the record. Only a newer local tombstone may suppress it.
    // The previous `base && ...` requirement incorrectly dropped concurrent
    // goal/habit/event/reminder creations whenever this device was also dirty.
    if (!deletedAt || deletedAt < recordTime(remote.updatedAt)) merged.push(clone(remote));
  }
  return merged;
}

function mergeTombstones(remoteMeta = {}, localMeta = {}) {
  const result = { deleted: {} };
  for (const kind of ['habits', 'goals', 'events', 'reminders']) {
    result.deleted[kind] = { ...(remoteMeta?.deleted?.[kind] || {}) };
    for (const [id, value] of Object.entries(localMeta?.deleted?.[kind] || {})) {
      const localTime = recordTime(value);
      const remoteTime = recordTime(result.deleted[kind][id]);
      if (localTime >= remoteTime) result.deleted[kind][id] = value;
    }
  }
  return result;
}

function adoptRemoteWithPending(remoteState, localState, baseOverride = syncBaseState) {
  const pending = clone(pendingMutations(localState));
  const dirty = dirtyFromMutations();
  const merged = pending.length
    ? mergeForDriveUpload(remoteState, localState, dirty, baseOverride)
    : normalizeState(clone(remoteState));
  // The remote snapshot is the new baseline, but local mutations remain pending
  // until a subsequent upload is acknowledged. Never reset them before upload.
  merged.syncMeta = merged.syncMeta || clone(defaultState.syncMeta);
  merged.syncMeta.mutations = pending;
  merged.syncMeta.pending = { ...defaultState.syncMeta.pending, ...dirtyFromMutations() };
  return normalizeState(merged);
}

function mergeForDriveUpload(remoteState, localState, dirtyOverride = syncDirty, baseOverride = syncBaseState) {
  const local = normalizeState(clone(localState || {}));
  const mutations = pendingMutations(local);
  if (mutations.length) return applyMutationJournal(remoteState, local, mutations, baseOverride || syncBaseState);
  const remote = mergeState(remoteState || {}, { preserveMutations: false });
  const dirty = dirtyOverride || syncDirty;
  const base = baseOverride || syncBaseState;
  const merged = clone(remote);
  merged.syncMeta = mergeTombstones(remote.syncMeta, local.syncMeta);
  merged.habits = mergeCollectionById(remote.habits, local.habits, dirty.habits, base?.habits || [], local.syncMeta?.deleted?.habits || {});
  merged.goals = mergeCollectionById(remote.goals, local.goals, dirty.goals, base?.goals || [], local.syncMeta?.deleted?.goals || {});
  merged.events = mergeCollectionById(remote.events, local.events, dirty.events, base?.events || [], local.syncMeta?.deleted?.events || {});
  merged.reminders = mergeCollectionById(remote.reminders, local.reminders, dirty.reminders, base?.reminders || [], local.syncMeta?.deleted?.reminders || {});
  if (dirty.profile) merged.profile = recordTime(local.profile?.updatedAt) >= recordTime(remote.profile?.updatedAt) ? clone(local.profile) : clone(remote.profile);
  if (dirty.settings) merged.settings = recordTime(local.settings?.updatedAt) >= recordTime(remote.settings?.updatedAt) ? clone(local.settings) : clone(remote.settings);
  if (dirty.activityHistory) merged.activityHistory = { ...(remote.activityHistory || {}), ...(local.activityHistory || {}) };
  return normalizeState(merged);
}


function save(options = {}) {
  try {
    const before = syncLastSavedSnapshot ? createSyncSnapshot(syncLastSavedSnapshot) : null;
    touchChangedRecords(before, state);
    captureActivitySnapshot(state, todayISO());
    const afterSnapshot = createSyncSnapshot(state);
    const changed = !!before && JSON.stringify(before) !== JSON.stringify(afterSnapshot);
    if (options.markDirty !== false && before && changed) {
      appendSyncMutations(before, state);
      syncDirty = dirtyFromMutations();
      state.syncMeta = state.syncMeta || clone(defaultState.syncMeta);
      state.syncMeta.pending = { ...(state.syncMeta.pending || {}) };
      for (const key of Object.keys(syncDirty)) state.syncMeta.pending[key] = !!syncDirty[key];
      syncGeneration++;
    }
    if (currentStorageKey) localStorage.setItem(currentStorageKey, JSON.stringify(state));
    if (options.markDirty !== false && changed) {
      announceLocalMutation();
      cloudSyncPending = true;
      scheduleCloudSync();
    }
    syncLastSavedSnapshot = createSyncSnapshot(state);
    // Keep every reminder surface synchronized with local state immediately.
    // This is intentionally separate from render() because save() is also used
    // by settings, calendar, and background sync paths that may not re-render.
    refreshReminderBadge();
    refreshReminderUi();
    if (!options.skipDrive && cloudStorageSelected()) {
      scheduleCloudSync();
    } else if (!options.skipDrive && driveStorageSelected()) {
      scheduleDriveBackup();
    }
    return true;
  } catch (e) { console.error('Habitly save failed:', e); return false; }
}

function cloudStorageSelected() {
  // Supabase is the ONLY active cross-device data synchronization authority.
  // Google Drive is backup/restore only and never hydrates or overwrites the
  // working state automatically. This removes the old Drive-vs-device race.
  return !!currentAuthUser && storageIsConfigured() && storageMode() === 'cloud' && !!window.habitlySupabase;
}
function ensureCloudDeviceId() {
  if (cloudDeviceId) return cloudDeviceId;
  const key = 'habitly.cloud.device.id';
  try {
    // sessionStorage gives each open tab/window its own writer identity while
    // surviving normal page navigations/reloads. This prevents two tabs on the
    // same laptop from masquerading as one writer during conflict resolution.
    const session = window.sessionStorage;
    cloudDeviceId = session?.getItem(key) || '';
    if (!cloudDeviceId) {
      cloudDeviceId = `d_${uid('device')}_${Math.random().toString(36).slice(2,10)}`;
      session?.setItem(key, cloudDeviceId);
    }
  } catch (_) { cloudDeviceId = `d_${uid('device')}_${Math.random().toString(36).slice(2,10)}`; }
  return cloudDeviceId;
}
function cloudStatusText() {
  if (!cloudStorageSelected()) return 'Local only';
  if (!navigator.onLine) return 'Offline — changes saved locally';
  if (cloudSyncBusy) return 'Syncing…';
  if (cloudSyncError) return `Sync failed — ${cloudSyncError}`;
  if (cloudSyncPending || pendingMutations(state).length) return 'Changes waiting to sync';
  if (cloudSyncLastAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - cloudSyncLastAt) / 1000));
    return seconds < 10 ? 'Synced just now' : `Synced ${seconds} seconds ago`;
  }
  return cloudSyncAvailable ? 'Ready to sync' : 'Sync unavailable — local data is safe';
}
function cloudDocumentState(source = state, revisionOverride = cloudRevision, committedMutations = []) {
  const doc = normalizeState(clone(source || {}));
  doc.syncMeta = doc.syncMeta || clone(defaultState.syncMeta);
  doc.syncMeta.mutations = [];
  doc.syncMeta.pending = { ...defaultState.syncMeta.pending };
  doc.syncMeta.cloudRevision = Number(revisionOverride) || 0;
  doc.syncMeta.cloudDeviceId = ensureCloudDeviceId();
  doc.syncMeta.recordVersions = doc.syncMeta.recordVersions || clone(defaultState.syncMeta.recordVersions);
  for (const kind of ['habits','goals','events','reminders']) {
    doc.syncMeta.recordVersions[kind] = { ...(doc.syncMeta.recordVersions[kind] || {}) };
  }
  const committedRevision = Number(revisionOverride) || 0;
  for (const m of committedMutations || []) {
    if (!m) continue;
    const id = m.recordId || m.record?.id;
    if (['habits','goals','events','reminders'].includes(m.kind) && id && committedRevision > 0) {
      doc.syncMeta.recordVersions[m.kind][id] = {
        revision: committedRevision,
        deviceId: String(m.deviceId || ensureCloudDeviceId()),
        mutationId: String(m.id || '')
      };
    }
  }
  // On first creation there is no mutation journal to stamp. Give existing
  // records a server version so future stale-device writes can be detected.
  if (committedRevision === 1) {
    for (const kind of ['habits','goals','events','reminders']) {
      for (const item of doc[kind] || []) if (item?.id && !doc.syncMeta.recordVersions[kind][item.id]) {
        doc.syncMeta.recordVersions[kind][item.id] = { revision: 1, deviceId: ensureCloudDeviceId(), mutationId: 'initial-state' };
      }
    }
  }
  return createSyncSnapshot(doc);
}
function validateCloudDocument(row) {
  if (!row || typeof row !== 'object') throw new Error('Invalid cloud document');
  if (row.user_id && currentAuthUser?.id && row.user_id !== currentAuthUser.id) throw new Error('Cloud document belongs to another account');
  if (!Number.isInteger(Number(row.revision)) || Number(row.revision) < 1) throw new Error('Invalid cloud revision');
  const raw = row.state;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Cloud state is invalid');
  return normalizeState(raw);
}
async function fetchCloudDocument() {
  const sb = window.habitlySupabase;
  if (!sb || !currentAuthUser?.id) return null;
  const { data, error } = await sb.from(CLOUD_TABLE).select('user_id,revision,state,updated_at,updated_by').eq('user_id', currentAuthUser.id).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function createCloudDocument(initialState) {
  return commitCloudDocument(0, initialState, []);
}
async function commitCloudDocument(expectedRevision, nextState, committedMutations = []) {
  const sb = window.habitlySupabase;
  if (!sb || !currentAuthUser?.id) throw new Error('Cloud sync is not available');
  const nextRevision = Number(expectedRevision) + 1;
  const payload = cloudDocumentState(nextState, nextRevision, committedMutations);
  const { data, error } = await sb.rpc('commit_habitly_sync_v2', {
    p_expected_revision: Number(expectedRevision) || 0,
    p_state: payload,
    p_device_id: ensureCloudDeviceId()
  });
  if (error) {
    const msg = String(error.message || error.details || error.hint || '');
    if (/HABITLY_CONFLICT|revision conflict|expected revision/i.test(msg)) {
      const conflict = new Error('Cloud revision conflict');
      conflict.code = 'CLOUD_CONFLICT';
      throw conflict;
    }
    throw error;
  }
  if (!data) throw new Error('Cloud commit returned no document');
  return data;
}
async function updateCloudDocument(expectedRevision, nextState, committedMutations = []) {
  return commitCloudDocument(expectedRevision, nextState, committedMutations);
}
function mergeCloudHydration(remoteState, localState) {
  const remote = normalizeState(clone(remoteState || {}));
  const local = normalizeState(clone(localState || {}));
  const merged = normalizeState(clone(remote));
  for (const kind of ['habits','goals','events','reminders']) {
    const remoteMap = new Map((remote[kind] || []).map(x => [x.id, x]));
    const tombstones = remote.syncMeta?.deleted?.[kind] || {};
    for (const item of local[kind] || []) {
      if (remoteMap.has(item.id)) continue;
      const deletedAt = recordTime(tombstones[item.id]);
      if (!deletedAt || deletedAt < recordTime(item.updatedAt)) merged[kind].push(clone(item));
    }
  }
  // Activity history is date-scoped, so missing local dates can be safely retained.
  merged.activityHistory = { ...(local.activityHistory || {}), ...(remote.activityHistory || {}) };
  if (local.profile?.avatar && !merged.profile?.avatar) merged.profile.avatar = local.profile.avatar;
  return normalizeState(merged);
}

async function reconcileCloudDocument() {
  if (!cloudStorageSelected() || !currentAuthUser?.id) return false;
  // A remote read is asynchronous. A user can edit Habitly while it is in
  // flight; never apply the older read result over that newer local state.
  const reconcileGeneration = syncGeneration;
  const reconcileUserId = currentAuthUser.id;
  const remote = await fetchCloudDocument();
  if (reconcileUserId !== currentAuthUser?.id || reconcileGeneration !== syncGeneration) {
    cloudSyncPending = pendingMutations(state).length > 0;
    if (cloudSyncPending) scheduleCloudSync();
    return false;
  }
  if (!remote) {
    // This is a fresh cloud namespace. Drive is intentionally ignored here:
    // an old/deleted Drive backup must never become the source of active data.
    // The first authenticated device establishes the clean cloud baseline.
    const createGeneration = syncGeneration;
    const created = await createCloudDocument(state);
    cloudRevision = Number(created.revision) || 1;
    cloudSyncAvailable = true;
    cloudSyncLastAt = Date.now();
    state.syncMeta = state.syncMeta || clone(defaultState.syncMeta);
    state.syncMeta.cloudRevision = cloudRevision;
    if (createGeneration === syncGeneration) {
      resetSyncTracking(state);
      if (currentStorageKey) localStorage.setItem(currentStorageKey, JSON.stringify(state));
    } else {
      // A user action occurred while the initial cloud write was in flight.
      // Never clear that newer mutation; let the normal CAS flush publish it.
      cloudSyncPending = pendingMutations(state).length > 0;
      if (cloudSyncPending) scheduleCloudSync();
    }
    return false;
  }
  const remoteState = validateCloudDocument(remote);
  const before = createSyncSnapshot(state);
  const pending = pendingMutations(state);
  if (!pending.length && isSuspiciousEmptySync(state, remoteState, [])) {
    // A fresh/partial cloud document must never erase a populated local cache.
    // Preserve local records that are not explicitly tombstoned remotely, then
    // publish those preserved records back to the cloud through the normal CAS path.
    const protectedState = mergeCloudHydration(remoteState, state);
    state = normalizeState(protectedState);
    state.syncMeta.cloudRevision = cloudRevision;
    appendSyncMutations(remoteState, state);
    state.syncMeta.pending = dirtyFromMutations();
    syncBaseState = createSyncSnapshot(remoteState);
    syncLastSavedSnapshot = createSyncSnapshot(state);
    cloudSyncAvailable = true;
    cloudSyncError = 'Cloud state was incomplete; local records were protected and will be reconciled.';
    if (currentStorageKey) localStorage.setItem(currentStorageKey, JSON.stringify(state));
    return true;
  }
  const avatar = state.profile?.avatar || '';
  const next = pending.length ? adoptRemoteWithPending(remoteState, state, syncBaseState) : mergeCloudHydration(remoteState, state);
  if (avatar && !next.profile.avatar) next.profile.avatar = avatar;
  next.settings.storage = { ...(next.settings.storage || {}), mode: 'cloud', setupCompleted:true };
  state = normalizeState(next);
  cloudRevision = Number(remote.revision);
  state.syncMeta.cloudRevision = cloudRevision;
  cloudSyncAvailable = true;
  cloudSyncError = '';
  cloudSyncLastAt = Date.now();
  if (pending.length) {
    syncBaseState = createSyncSnapshot(remoteState);
    syncLastSavedSnapshot = createSyncSnapshot(state);
    syncDirty = dirtyFromMutations();
  } else {
    const preserved = JSON.stringify(createSyncSnapshot(remoteState)) !== JSON.stringify(createSyncSnapshot(state));
    if (preserved) {
      state.syncMeta.mutations = [];
      appendSyncMutations(remoteState, state);
      state.syncMeta.pending = dirtyFromMutations();
      syncBaseState = createSyncSnapshot(remoteState);
      syncLastSavedSnapshot = createSyncSnapshot(state);
      syncDirty = dirtyFromMutations();
      cloudSyncPending = pendingMutations(state).length > 0;
    } else resetSyncTracking(state);
  }
  if (currentStorageKey) localStorage.setItem(currentStorageKey, JSON.stringify(state));
  return JSON.stringify(before) !== JSON.stringify(createSyncSnapshot(state));
}
async function flushCloudSync() {
  if (!cloudStorageSelected() || !currentAuthUser?.id || !navigator.onLine) return false;
  if (cloudSyncBusy) { cloudSyncQueued = true; return false; }
  if (!pendingMutations(state).length) { cloudSyncPending = false; return true; }
  cloudSyncBusy = true; cloudSyncPending = true;
  const flushGeneration = syncGeneration;
  try {
    let remote = await fetchCloudDocument();
    if (!remote) {
      try { remote = await createCloudDocument(state); }
      catch (e) {
        if (e?.code === '23505' || /duplicate|unique/i.test(String(e?.message || ''))) remote = await fetchCloudDocument();
        else throw e;
      }
    }
    if (!remote) throw new Error('Cloud document could not be read');
    for (let attempt = 0; attempt < 4; attempt++) {
      const remoteState = validateCloudDocument(remote);
      const localSnapshot = normalizeState(clone(state));
      const mutationSnapshot = clone(pendingMutations(localSnapshot));
      if (!mutationSnapshot.length) break;

      // Rebase every still-pending user mutation on the newest remote snapshot.
      // The server revision is the CAS guard; it is NOT a conflict winner.
      // Therefore an offline/local edit remains pending until a successful
      // server commit instead of being silently discarded when another device
      // changed the same record first.
      const effectiveMutations = mutationSnapshot;
      localSnapshot.syncMeta.mutations = effectiveMutations;
      localSnapshot.syncMeta.pending = dirtyFromMutationList(effectiveMutations);
      const merged = mergeForDriveUpload(remoteState, localSnapshot, dirtyFromMutationList(effectiveMutations), syncBaseState);
      // Do not apply the empty-state safety guard to the authoritative
      // Supabase commit path. At this point we have an explicit pending
      // mutation journal produced by a real local user change, and the
      // database CAS revision is the final overwrite protection. The old
      // guard could deadlock a legitimate first sync when the cloud document
      // existed but contained an empty state: it rejected the very upsert that
      // was supposed to populate that document. Drive backup keeps its own
      // empty-state protection because Drive is not the active sync authority.
      let write;
      try { write = await updateCloudDocument(Number(remote.revision), merged, effectiveMutations); }
      catch (e) {
        if (e?.code !== 'CLOUD_CONFLICT') throw e;
        remote = await fetchCloudDocument();
        if (!remote) throw new Error('Cloud document disappeared during synchronization');
        continue;
      }
      cloudRevision = Number(write.revision);
      const committedState = validateCloudDocument(write);
      const liveMutations = pendingMutations(state);
      const acknowledged = new Set(effectiveMutations.map(m => m.id));
      if (flushGeneration === syncGeneration) {
        const liveAvatar = state.profile?.avatar || '';
        state = normalizeState(committedState);
        if (liveAvatar && !state.profile.avatar) state.profile.avatar = liveAvatar;
        state.syncMeta.mutations = liveMutations.filter(m => !acknowledged.has(m.id));
        state.syncMeta.pending = dirtyFromMutations();
        state.syncMeta.cloudRevision = cloudRevision;
        if (currentStorageKey) localStorage.setItem(currentStorageKey, JSON.stringify(state));
        resetSyncTracking(state);
        cloudSyncPending = pendingMutations(state).length > 0;
      } else {
        // A user action happened while the request was in flight. Never replace
        // the live state with the older request snapshot. Keep the new local
        // mutations, fold them over the acknowledged cloud result, and queue
        // another revisioned write.
        const live = normalizeState(clone(state));
        live.syncMeta.mutations = liveMutations.filter(m => !acknowledged.has(m.id));
        live.syncMeta.pending = dirtyFromMutations();
        live.syncMeta.cloudRevision = cloudRevision;
        live.syncMeta.recordVersions = clone(committedState.syncMeta?.recordVersions || live.syncMeta.recordVersions || defaultState.syncMeta.recordVersions);
        state = normalizeState(live);
        if (currentStorageKey) localStorage.setItem(currentStorageKey, JSON.stringify(state));
        cloudSyncPending = pendingMutations(state).length > 0;
        if (cloudSyncPending) cloudSyncQueued = true;
      }
      cloudSyncLastAt = Date.now();
      cloudSyncError = '';
      // Drive is a backup of the acknowledged cloud state. Never let a
      // delayed Drive upload race ahead of the primary synchronization layer.
      if (cloudSyncPending === false && driveStorageSelected()) scheduleDriveBackup();
      return true;
    }
    cloudSyncPending = pendingMutations(state).length > 0;
    return !cloudSyncPending;
  } catch (e) {
    cloudSyncError = e?.message || 'Cloud synchronization failed';
    cloudSyncPending = pendingMutations(state).length > 0;
    return false;
  } finally {
    cloudSyncBusy = false;
    if (cloudSyncQueued) { cloudSyncQueued = false; queueMicrotask(scheduleCloudSync); }
  }
}
function scheduleCloudSync() {
  if (!cloudStorageSelected() || !navigator.onLine) { cloudSyncPending = pendingMutations(state).length > 0; return; }
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => flushCloudSync().catch(() => {}), 80);
}
async function initializeCloudSync() {
  if (!cloudStorageSelected()) return;
  cloudHydrationGeneration++;
  try {
    const changed = await reconcileCloudDocument();
    cloudHydrationConfirmedUserId = currentAuthUser?.id || '';
    if (cloudSyncAvailable && cloudRevision > 0) {
      // Supabase hydration is authoritative for cloud-enabled accounts, so a
      // connected Drive backup may safely resume after cloud confirmation.
      driveHydrationConfirmedUserId = currentAuthUser?.id || '';
    }
    if (changed && currentRoute() !== 'login') render();
    if (pendingMutations(state).length) scheduleCloudSync();
  } catch (e) {
    cloudSyncError = e?.message || 'Cloud synchronization unavailable';
    console.warn('Habitly cloud hydration unavailable:', e);
  }
}
function subscribeCloudRealtime() {
  if (cloudChannel || !cloudStorageSelected() || !window.habitlySupabase || !currentAuthUser?.id) return;
  cloudRealtimeReady = false;
  const userId = currentAuthUser.id;
  cloudChannel = window.habitlySupabase.channel(`${CLOUD_CHANNEL}:${userId}`)
    .on('postgres_changes', { event:'*', schema:'public', table:CLOUD_TABLE, filter:`user_id=eq.${userId}` }, payload => {
      const row = payload?.new;
      if (!row || row.updated_by === ensureCloudDeviceId() || Number(row.revision) <= cloudRevision) return;
      reconcileCloudDocument().then(changed => {
        if (changed && currentRoute() !== 'login') render();
        if (pendingMutations(state).length) scheduleCloudSync();
      }).catch(e => { cloudSyncError = e?.message || 'Realtime reconciliation failed'; });
    })
    .subscribe(status => {
      cloudRealtimeReady = status === 'SUBSCRIBED';
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        cloudSyncError = 'Realtime unavailable — using sync fallback';
      } else if (cloudRealtimeReady) {
        cloudSyncError = '';
        cloudLastSafetyPollAt = 0;
        if (pendingMutations(state).length) scheduleCloudSync();
      }
    });
}
function stopCloudSync() {
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = null;
  cloudHydrationGeneration++;
  if (cloudChannel && window.habitlySupabase) { try { window.habitlySupabase.removeChannel(cloudChannel); } catch (_) {} }
  cloudChannel = null; cloudRealtimeReady = false; cloudLastSafetyPollAt = 0; cloudRevision = 0; cloudSyncBusy = false; cloudSyncQueued = false;
  cloudSyncPending = false; cloudSyncAvailable = false; cloudSyncLastAt = 0; cloudSyncError = '';
  cloudHydrationConfirmedUserId = ''; cloudDeviceId = '';
}
function startCloudPolling() {
  clearInterval(window.__habitlyCloudPoll);
  // Realtime is primary. Polling is a safety net and becomes aggressive only
  // when the websocket is not subscribed, avoiding reload-dependent syncing.
  window.__habitlyCloudPoll = setInterval(() => {
    if (!cloudStorageSelected() || !navigator.onLine || cloudSyncBusy) return;
    const now = Date.now();
    const interval = cloudRealtimeReady ? 3000 : 1000;
    if (now - cloudLastSafetyPollAt < interval) return;
    cloudLastSafetyPollAt = now;
    fetchCloudDocument().then(row => {
      if (row && Number(row.revision) > cloudRevision) reconcileCloudDocument().then(changed => {
        if (changed && currentRoute() !== 'login') render();
        if (pendingMutations(state).length) scheduleCloudSync();
      }).catch(() => {});
    }).catch(() => {});
  }, 1000);
}
function driveStorageSelected() {
  // Drive connection is optional. It can receive a backup from either local or
  // cloud state, but it is NEVER an active synchronization source.
  const d = driveSettings();
  return !!currentAuthUser && !!d.connected;
}

function scheduleDriveBackup() {
  if (!driveStorageSelected() || driveSettings().autoDaily !== true || driveLoginSyncPending || driveLoginSyncBusy) return;
  // In Drive storage mode, Drive is the active synchronization authority.
  // In Both mode, Supabase is primary and Drive only receives acknowledged
  // cloud snapshots. Never let an unavailable Supabase table block Drive mode.
  if (cloudStorageSelected() && !cloudSyncAvailable) return;
  // Never upload a possibly stale local cache until this account has completed
  // a successful Drive reconciliation for the current login.
  if (driveHydrationConfirmedUserId !== currentAuthUser?.id) return;
  clearTimeout(driveBackupTimer);
  driveBackupTimer = setTimeout(async () => {
    if (driveLoginSyncBusy || googleDriveBusy) { driveUploadQueued = true; return; }
    if (!driveStorageSelected() || driveLoginSyncPending || driveRemoteMissing) return;
    if (googleAccessToken && Date.now() < googleTokenExpiresAt - 60000) {
      await uploadDriveBackup({ silent: true, fromCloudAck: true });
      return;
    }
    if (ensureDriveClient()) {
      try {
        await requestDriveToken('', { silent: true });
      } catch (e) {
        console.warn('Automatic Drive token refresh unavailable:', e);
      }
    }
  }, 120);
}

function scheduleDriveSyncRetry() {
  if (driveSyncRetryTimer || driveLoginSyncPending || driveLoginSyncBusy || !driveStorageSelected()) return;
  if (driveSyncRetryCount >= 4) return;
  const delays = [1500, 3000, 7000, 15000];
  const delay = delays[Math.min(driveSyncRetryCount, delays.length - 1)];
  driveSyncRetryCount++;
  driveSyncRetryTimer = setTimeout(() => {
    driveSyncRetryTimer = null;
    scheduleDriveBackup();
  }, delay);
}

function requestDriveToken(prompt = '', options = {}) {
  if (driveTokenRequestPromise) return driveTokenRequestPromise;
  if (!ensureDriveClient()) return Promise.reject(new Error('Google Drive client is not ready'));
  const hint = String(options.hint || driveSettings().email || currentAuthUser?.email || '').trim();
  const silent = !!options.silent;
  driveTokenRequestContext = { silent, hint, prompt };
  driveTokenRequestPromise = new Promise((resolve, reject) => {
    googleTokenClient.__habitlyResolve = value => { driveTokenRequestPromise = null; driveTokenRequestContext = null; resolve(value); };
    googleTokenClient.__habitlyReject = error => { driveTokenRequestPromise = null; driveTokenRequestContext = null; reject(error); };
    try {
      const override = { prompt: silent ? 'none' : prompt };
      if (hint) override.login_hint = hint;
      googleTokenClient.requestAccessToken(override);
    } catch (e) {
      googleTokenClient.__habitlyResolve = null;
      googleTokenClient.__habitlyReject = null;
      driveTokenRequestPromise = null;
      driveTokenRequestContext = null;
      reject(e);
    }
  });
  return driveTokenRequestPromise;
}

function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function todayISO() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString().slice(0, 10); }
function habitCurrent(h, date = todayISO()) { return Math.max(0, Number(date === todayISO() ? h.current : ((h.daily || {})[date] ?? 0)) || 0); }
function habitPctForDate(h, date = todayISO()) { return Math.min(100, Math.round(habitCurrent(h, date) / Math.max(1, Number(h.target) || 1) * 100)); }
function pct(h) { return habitPctForDate(h, todayISO()); }
function goalPct(g) { return Math.round(goalOverallProgress(g)); }
function formatDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'No deadline';
  const d = new Date(raw + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? 'No deadline' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function daysLeft(date) {
  const raw = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(raw + 'T00:00:00');
  if (Number.isNaN(b.getTime())) return null;
  return Math.ceil((b - a) / 86400000);
}
function formatNumber(n) { return Number(n).toLocaleString('en-IN'); }

function parseTime24(value) {
  const raw = String(value || '').trim();
  // Accept normal 24-hour input, with or without seconds.
  let m = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (m) return `${m[1]}:${m[2]}:${m[3] || '00'}`;

  // Accept standard 12-hour input such as 3:30 PM.
  m = raw.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*(AM|PM)$/i);
  if (!m) return '';

  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] || 0);
  const ap = m[4].toUpperCase();

  // Be tolerant of a common manual-entry form such as “15:30 PM”.
  // The numeric time is already unambiguously 24-hour, so the suffix is
  // ignored instead of making an otherwise valid event impossible to save.
  if (h >= 13 && h <= 23) {
    return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  if (h < 1 || h > 12) return '';
  if (ap === 'AM') h = h === 12 ? 0 : h;
  else h = h === 12 ? 12 : h + 12;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function userTimeFormat() {
  return state?.settings?.timeFormat === '24h' ? '24h' : '12h';
}
function formatTime(value) {
  const t = parseTime24(value);
  if (!t) return String(value || '');
  const [h,m] = t.split(':').map(Number);
  if (userTimeFormat() === '24h') return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  const ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2,'0')} ${ap}`;
}
function formatTimeShort(value) {
  const t = parseTime24(value);
  if (!t) return String(value || '');
  const [h,m] = t.split(':').map(Number);
  if (userTimeFormat() === '24h') return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  const ap = h >= 12 ? 'PM' : 'AM', hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2,'0')} ${ap}`;
}
function formatDateTime(dateValue, timeValue) {
  return `${formatDate(dateValue)} · ${formatTime(timeValue)}`;
}

/* =========================
   REMINDER MANAGER
========================= */

const REMINDER_SOUNDS = {
  gentle: { freq: [660, 880], dur: [.16, .22] },
  chime: { freq: [523.25, 659.25, 783.99], dur: [.12, .12, .24] },
  calm: { freq: [392, 523.25], dur: [.25, .35] },
  classic: { freq: [880, 660, 880], dur: [.12, .12, .16] },
  simple: { freq: [660, 660], dur: [.10, .18] },
  bright: { freq: [784, 988, 1175], dur: [.10, .10, .20] },
  marimba: { freq: [392, 494, 587], dur: [.13, .13, .22] },
  digital: { freq: [880, 1175, 880], dur: [.08, .08, .14] }
};

let audioCtx = null;

function playReminderSound(kind = 'gentle') {
  if (kind === 'none') return;

  const spec =
    REMINDER_SOUNDS[kind] ||
    REMINDER_SOUNDS.gentle;

  try {
    audioCtx =
      audioCtx ||
      new (window.AudioContext ||
        window.webkitAudioContext)();

    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    const start =
      audioCtx.currentTime + .02;

    let offset = 0;

    spec.freq.forEach((freq, i) => {

      const osc =
        audioCtx.createOscillator();

      const gain =
        audioCtx.createGain();

      const t =
        start + offset;

      const d =
        spec.dur[i] || .16;

      osc.type = 'sine';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(
        .0001,
        t
      );

      gain.gain.exponentialRampToValueAtTime(
        .18,
        t + .02
      );

      gain.gain.exponentialRampToValueAtTime(
        .0001,
        t + d
      );

      osc.connect(gain)
        .connect(audioCtx.destination);

      osc.start(t);
      osc.stop(t + d + .03);

      offset += d + .035;
    });

  } catch (err) {
    console.warn(
      'Reminder sound unavailable',
      err
    );
  }
}

function getReminderByHabit(habitId) {
  return state.reminders.find(
    r =>
      r.habitId === habitId &&
      r.enabled !== false
  ) || null;
}

function syncHabitReminder(habit) {
  // Kept for compatibility with older integrations. Habit editing no longer
  // creates reminders automatically; reminders are managed separately.
  const existing = state.reminders.find(r => r.habitId === habit.id && r.source === 'manual');
  if (existing && !habit.reminder) {
    existing.enabled = false;
  }
  save();
}
/* =========================
   BROWSER NOTIFICATIONS
========================= */

function notificationSupported() {
  return 'Notification' in window;
}

function notificationStorageKey() {
  return `habitly_v2_notified_reminders.${currentAuthUser?.id || 'guest'}`;
}

function getNotifiedReminders() {
  try {
    return JSON.parse(
      localStorage.getItem(
        notificationStorageKey()
      ) || '{}'
    );
  } catch {
    return {};
  }
}

function markReminderNotified(key) {
  const data = getNotifiedReminders();

  data[key] = Date.now();

  localStorage.setItem(
    notificationStorageKey(),
    JSON.stringify(data)
  );
}

async function enableNotifications() {

  if (!notificationSupported()) {
    toast(
      'This browser does not support notifications'
    );
    return;
  }

  try {

    const permission =
      await Notification.requestPermission();

    if (permission === 'granted') {

      toast(
        'Reminder notifications enabled'
      );

      checkReminderNotifications(true);

    } else if (permission === 'denied') {

      toast(
        'Notifications are blocked in browser settings'
      );

    } else {

      toast(
        'Notification permission was not granted'
      );
    }

  } catch (err) {

    console.error(
      'Notification permission error:',
      err
    );

    toast(
      'Could not enable notifications'
    );
  }
}
/* =========================
   REMINDER CHECKER
========================= */

function refreshReminderBadge() {
  const count = eventNotificationCount();
  document.querySelectorAll('[data-reminders]').forEach(button => {
    const badge = button.querySelector('.badge');
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
      badge.setAttribute('aria-label', `${count} upcoming reminder${count === 1 ? '' : 's'}`);
    }
    button.classList.toggle('has-reminders', count > 0);
    button.setAttribute('aria-label', count ? `Reminders · ${count} upcoming` : 'Reminders');
    button.title = count ? `${count} upcoming reminder${count === 1 ? '' : 's'}` : 'No upcoming reminders';
  });
}
function deleteReminderById(id) {
  const reminder = state.reminders.find(r => r && r.id === id);
  if (!reminder) return false;
  const now = new Date().toISOString();
  state.reminders = state.reminders.filter(r => r.id !== id);
  state.syncMeta = state.syncMeta || clone(defaultState.syncMeta);
  state.syncMeta.deleted = state.syncMeta.deleted || clone(defaultState.syncMeta.deleted);
  state.syncMeta.deleted.reminders = state.syncMeta.deleted.reminders || {};
  state.syncMeta.deleted.reminders[id] = now;
  save();
  checkReminderNotifications(true);
  refreshReminderUi();
  return true;
}
function bindReminderControls(root = document) {
  root.querySelectorAll('[data-add-reminder]').forEach(b => b.addEventListener('click', () => reminderForm()));
  root.querySelectorAll('[data-edit-reminder]').forEach(b => b.addEventListener('click', () => reminderForm(b.dataset.editReminder)));
  root.querySelectorAll('[data-edit-event-reminder]').forEach(b => b.addEventListener('click', () => eventForm(b.dataset.editEventReminder)));
  root.querySelectorAll('[data-edit-event]').forEach(b => b.addEventListener('click', () => eventForm(b.dataset.editEvent)));
  root.querySelectorAll('[data-delete-reminder]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (deleteReminderById(b.dataset.deleteReminder)) toast('Reminder deleted');
  }));
  root.querySelectorAll('[data-toggle-reminder]').forEach(b => b.addEventListener('change', () => {
    const r = state.reminders.find(x => x.id === b.dataset.toggleReminder);
    if (!r) return;
    r.enabled = b.checked;
    r.updatedAt = new Date().toISOString();
    save();
    checkReminderNotifications(true);
    refreshReminderUi();
    toast(r.enabled ? 'Reminder enabled' : 'Reminder turned off');
  }));
}
function refreshReminderPopover() {
  const popover = document.querySelector('#reminderPopover');
  if (!popover) return;
  const data = reminderData();
  const sections = popover.querySelector('.reminder-sections');
  if (sections) sections.innerHTML = `${reminderSectionMarkup('Upcoming Events', data.events, 'No upcoming events.', { events: true })} ${reminderSectionMarkup('Habit Reminders', data.habits, 'No habit reminders are set.', { editable: true })}`;
  bindReminderControls(popover);
}
function refreshReminderUi() {
  refreshReminderBadge();
  const list = document.querySelector('#calendarReminderList');
  if (list) {
    list.innerHTML = reminderOverviewMarkup(calendarSelectedDate);
    bindReminderControls(list);
  }
  refreshReminderPopover();
}
function scheduleNextReminderCheck() {
  clearTimeout(reminderSchedulerTimer);
  const now = new Date();
  let soonest = null;
  for (const reminder of (state.reminders || [])) {
    if (!reminder || reminder.enabled === false) continue;
    const candidate = nextReminderOccurrence(reminder, now);
    if (!candidate) continue;
    if (!soonest || candidate < soonest) soonest = candidate;
  }
  if (!soonest) return;
  const delay = Math.max(500, soonest.getTime() - Date.now() + 500);
  reminderSchedulerTimer = setTimeout(() => {
    checkReminderNotifications(true);
    refreshReminderUi();
    scheduleNextReminderCheck();
  }, Math.min(delay, 60000));
}
function reminderEventFor(reminder) {
  return state.events.find(e => e.id === reminder?.eventId) || null;
}
function reminderHabitFor(reminder) {
  return state.habits.find(h => h.id === reminder?.habitId) || null;
}
function reminderScheduledTime(reminder, now = new Date()) {
  if (!reminder || reminder.enabled === false || !/^\d{4}-\d{2}-\d{2}$/.test(String(reminder.date || '')) && reminder.eventId) return null;
  if (reminder.eventId) {
    const event = reminderEventFor(reminder);
    if (!event) return null;
    const base = new Date(`${event.date}T${parseTime24(event.time) || '00:00:00'}`);
    // Legacy before-event offsets are intentionally ignored.
    base.setMinutes(base.getMinutes());
    return base;
  }
  const parsed = parseTime24(reminder.time);
  if (!parsed) return null;
  const [hours, minutes, seconds] = parsed.split(':').map(Number);
  const candidate = new Date(now);
  candidate.setHours(hours, minutes, seconds, 0);
  return candidate;
}
function reminderIsDue(reminder, now = new Date()) {
  const scheduled = reminderScheduledTime(reminder, now);
  if (!scheduled) return false;
  const delta = now.getTime() - scheduled.getTime();
  return delta >= 0 && delta <= 5 * 60 * 1000;
}
function dispatchBrowserReminderNotification(title, body, route, reminderId) {
  if (!notificationSupported() || Notification.permission !== 'granted') return;
  const options = {
    body,
    icon: `${AS}Habitly Leaf Transparent.png`,
    tag: `habitly-reminder-${reminderId}`,
    renotify: true,
    data: { route }
  };
  const fallback = () => {
    try {
      const notification = new Notification(title, options);
      notification.onclick = () => { window.focus(); notification.close(); navigate(route); };
    } catch (err) { console.warn('Browser notification failed:', err); }
  };
  // A service-worker notification is more reliable than constructing a
  // window Notification when the PWA/tab is backgrounded. It still cannot
  // bypass OS/browser permission or a completely closed web app.
  if (document.visibilityState !== 'visible' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, options))
      .catch(fallback);
    return;
  }
  fallback();
}
function showReminderNotification(reminder) {
  const habit = reminderHabitFor(reminder);
  const event = reminderEventFor(reminder);
  if (reminder.eventId) {
    if (!event) return;
    const title = `Habitly Reminder · ${event.title}`;
    const body = `Upcoming event: "${event.title}" · ${formatDateTime(event.date, event.time)}`;
    dispatchBrowserReminderNotification(title, body, 'calendar', reminder.id);
    playReminderSound(reminder.sound || 'gentle');
    toast(`⏰ ${event.title}`);
    return;
  }
  if (!habit || habit.paused) return;
  const title = `Habitly Reminder · ${habit.name}`;
  const body = `It's time for "${habit.name}".`;
  dispatchBrowserReminderNotification(title, body, 'habits', reminder.id);
  playReminderSound(reminder.sound || 'gentle');
  toast(`⏰ ${habit.name} reminder`);
}
function reminderDateKey(reminder, date = todayISO()) {
  const occurrence = reminder.eventId ? (reminderEventFor(reminder)?.date || date) : date;
  return `${occurrence}:${reminder.id}:${reminder.time}:${Number(reminder.offsetMinutes)||0}`;
}
function checkReminderNotifications(force = false) {
  const now = new Date();
  const minuteKey = `${todayISO()}-${now.getHours()}-${now.getMinutes()}`;
  if (!force && minuteKey === lastReminderSweepKey) return;
  lastReminderSweepKey = minuteKey;
  const reminders = Array.isArray(state.reminders) ? state.reminders : [];
  const notified = getNotifiedReminders();
  let changed = false;
  reminders.forEach(reminder => {
    if (!reminder || reminder.enabled === false || !reminderIsDue(reminder, now)) return;
    const key = reminderDateKey(reminder, todayISO());
    if (notified[key]) return;
    notified[key] = Date.now();
    changed = true;
    const reminderAllowed = reminder.eventId
      ? state.settings?.notifications?.eventReminders !== false
      : state.settings?.notifications?.habitReminders !== false;
    if (reminderAllowed) showReminderNotification(reminder);
  });
  const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
  const trimmed = Object.fromEntries(Object.entries(notified).filter(([, ts]) => Number(ts) >= cutoff));
  if (changed) localStorage.setItem(notificationStorageKey(), JSON.stringify(trimmed));
  scheduleNextReminderCheck();
}
function startReminderService() {
  clearInterval(reminderUiTimer);
  clearInterval(headerClockTimer);
  clearTimeout(headerClockTimer);
  headerClockTimer = null;
  clearTimeout(reminderSchedulerTimer);
  reminderUiTimer = setInterval(() => { checkReminderNotifications(); refreshReminderUi(); }, 10000);
  checkReminderNotifications(true);
  scheduleNextReminderCheck();
}

function icon(type) {
  const p = {
    calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7 3.5v4M17 3.5v4M3.5 9h17"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="m7 9 5 5 5-5"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="m10 5 7 7-7 7"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="m4 20 4.2-1 9.9-9.9a2.2 2.2 0 0 0-3.1-3.1L5.1 15.9 4 20Z"/><path d="m13.8 6.2 4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
    leaf: `<img class="leaf-icon" src="${AS}Habitly Leaf Transparent.png" alt="">`,
    download: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 20h14"/></svg>',
    plusCircle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M12 3l1.1 2.1 2.3.5.7-1.2 2.1 2.1-1.2.7.5 2.3L21 10.6v2.8l-2.5.6-.5 2.3 1.2.7-2.1 2.1-.7-1.2-2.3.5L12 21l-1.1-2.1-2.3-.5-.7 1.2-2.1-2.1 1.2-.7-.5-2.3L3 13.4v-2.8l2.5-.6.5-2.3-1.2-.7 2.1-2.1.7 1.2 2.3-.5L12 3Z"/><circle cx="12" cy="12" r="3"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
    palette: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18h1.2a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10H12Z"/><circle cx="7.5" cy="10" r="1" fill="currentColor"/><circle cx="10" cy="6.5" r="1" fill="currentColor"/><circle cx="14" cy="6.5" r="1" fill="currentColor"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.8-3 8.5-7 10-4-1.5-7-5.2-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    database: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.1.1l2-2A5 5 0 0 0 12 4l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.2-1.2"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/></svg>',
    key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 6l2 2M14 8l2 2"/></svg>',
    desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>',
    external: '<svg viewBox="0 0 24 24"><path d="M14 5h5v5M13 11l6-6M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>',
    cloud: '<svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.3A3.5 3.5 0 0 0 7 18Z"/><path d="M12 10v7M9.5 14.5 12 17l2.5-2.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4"/></svg>',
    github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M12 2.2a9.8 9.8 0 0 0-3.1 19.1c.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.3-.3-4.7-1.2-4.7-5.1 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.7 9.7 0 0 1 5.1 0c2-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.7 5.1.4.3.7 1 .7 1.9v2.8c0 .3.2.6.7.5A9.8 9.8 0 0 0 12 2.2Z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M6.2 8.2H3.1V21h3.1V8.2ZM4.65 3A1.85 1.85 0 1 0 4.65 6.7 1.85 1.85 0 0 0 4.65 3ZM8.7 8.2h3V10c.6-1.1 1.7-2.1 3.7-2.1 3.9 0 4.6 2.6 4.6 6V21h-3.1v-6.3c0-1.5 0-3.5-2.1-3.5s-2.4 1.6-2.4 3.4V21H8.7V8.2Z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v2M22 12h-2M12 22v-2M2 12h2"/></svg>',
    trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM12 13v4M8 21h8M9 17h6"/><path d="M8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 6.2A10.6 10.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16.8 16.8 0 0 1-3.2 3.7M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.5 6 9.5 6c1.1 0 2.1-.2 3-.5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
    logout: '<svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M20 19V5a2 2 0 0 0-2-2h-5"/></svg>'
  }; return p[type] || '';
}
function logo() { return `<img class="brand-logo" src="${AS}Habitly Leaf Transparent.png" alt="Habitly">`; }
function avatarMarkup(sizeClass = '') { const p = state.profile || {}; const initials = (p.name || 'Prem Kumar').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase() || 'PK'; return p.avatar ? `<img class="avatar-photo ${sizeClass}" src="${esc(p.avatar)}" alt="Profile picture">` : `<span class="avatar-initials ${sizeClass}">${esc(initials)}</span>`; }

const navItems = [['dashboard', 'Dashboard', 'dashboard'], ['habits', 'Habits', 'target'], ['goals', 'Goals', 'trophy'], ['calendar', 'Calendar', 'calendar'], ['statistics', 'Statistics', 'chart'], ['settings', 'Settings', 'settings']];
function navIcon(name) { const map = { dashboard: '▦', target: '🎯', trophy: '🏆', chart: '📊' }; return ['calendar', 'settings'].includes(name) ? icon(name) : `<span class="emoji-nav">${map[name] || '•'}</span>`; }
function sidebar(route) { return `<aside class="sidebar"><div class="brand">${logo()}<span class="brand-name">Habitly</span></div><nav class="main-nav" aria-label="Main navigation">${navItems.map(([r, t, i]) => `<button class="nav-item ${route === r ? 'active' : ''}" data-route="${r}"><span class="nav-icon">${navIcon(i)}</span><span>${t}</span></button>`).join('')}</nav><div class="sidebar-bottom"><button class="profile-card" data-route="settings" aria-label="Open account settings"><span class="avatar">${avatarMarkup()}</span><span class="profile-copy"><strong>${esc(state.profile?.name || 'Prem Kumar')}</strong><small>View profile</small></span><span class="chevron">${icon('chevron')}</span></button><button class="logout" type="button" data-logout aria-label="Log out of Habitly">${icon('logout')}<span>Log out</span></button></div></aside>`; }
function mobileDrawer(route) { return `<div class="mobile-drawer" id="drawer" aria-hidden="true"><div class="scrim" data-close-drawer></div><aside class="drawer"><div class="drawer-head"><div class="mobile-brand">${logo()}<strong>Habitly</strong></div><button class="drawer-close" data-close-drawer aria-label="Close menu">×</button></div><nav class="main-nav">${navItems.map(([r, t, i]) => `<button class="nav-item ${route === r ? 'active' : ''}" data-route="${r}"><span class="nav-icon">${navIcon(i)}</span><span>${t}</span></button>`).join('')}</nav><div class="sidebar-bottom"><button class="profile-card" data-route="settings" aria-label="Open account settings"><span class="avatar">${avatarMarkup()}</span><span class="profile-copy"><strong>${esc(state.profile?.name || 'Prem Kumar')}</strong><small>View profile</small></span><span class="chevron">${icon('chevron')}</span></button><button class="logout" type="button" data-logout aria-label="Log out of Habitly">${icon('logout')}<span>Log out</span></button></div></aside></div>`; }

function reminderOverviewMarkup(date) {
  const selectedDate = String(date || calendarSelectedDate || todayISO());
  const now = new Date();
  const selectedEvents = (state.events||[]).filter(e=>e && e.date===selectedDate).sort((a,b)=>String(a.time).localeCompare(String(b.time)));
  const selectedHabitReminders = (state.reminders||[]).filter(r=>r && r.source==='manual' && !r.eventId && r.enabled!==false).map(r=>{
    const next=nextReminderOccurrence(r,new Date(`${selectedDate}T00:00:00`));
    if(!next || dateISO(next)!==selectedDate) return null;
    const h=reminderHabitFor(r); if(!h || h.paused || state.settings?.notifications?.habitReminders===false) return null;
    return {kind:'habit',id:r.id,title:h.name,emoji:h.emoji||'🔔',time:r.time,next,detail:`Habit reminder · ${reminderDaysLabel(r.days)}`};
  }).filter(Boolean).sort((a,b)=>a.next-b.next);

  const upcoming = [];
  for(const e of (state.events||[])){
    if(state.settings?.notifications?.eventReminders===false) continue;
    const eventNext=nextEventOccurrence(e,now);
    if(!eventNext) continue;
    const linked=state.reminders.find(r=>r.eventId===e.id && r.source==='manual' && r.enabled!==false);
    const reminderAt=linked ? nextEventReminderOccurrence(linked,now) : eventNext;
    // The bell and upcoming list represent the event itself, but show an
    // earlier reminder time when one exists.
    upcoming.push({kind:'event',id:linked?.id||`event:${e.id}`,eventId:e.id,title:e.title,emoji:e.emoji||'📅',eventAt:eventNext,at:reminderAt||eventNext,detail:linked && `Event at ${formatTimeShort(e.time)}`});
  }
  if(state.settings?.notifications?.habitReminders!==false){
    for(const r of (state.reminders||[])){
      if(!r || r.source!=='manual' || r.eventId || r.enabled===false) continue;
      const h=reminderHabitFor(r); if(!h||h.paused) continue;
      const next=nextReminderOccurrence(r,now); if(next) upcoming.push({kind:'habit',id:r.id,title:h.name,emoji:h.emoji||'🔔',eventAt:next,at:next,detail:`Habit reminder · ${reminderDaysLabel(r.days)}`});
    }
  }
  upcoming.sort((a,b)=>a.at-b.at);
  const selectedEventMarkup = selectedEvents.map(e=>{
    const linked=state.reminders.find(r=>r.eventId===e.id && r.source==='manual');
    const future=new Date(`${e.date}T${parseTime24(e.time)||'00:00:00'}`).getTime()>now.getTime();
    return `<div class="calendar-reminder-row ${future?'is-upcoming':'is-past'}"><span class="reminder-emoji">${esc(e.emoji||'📅')}</span><span class="reminder-copy"><strong>${esc(e.title)}</strong><small>Event · ${esc(formatTimeShort(e.time))}${linked ? ' · Reminder at event time' : ''}</small></span><span class="reminder-status">${future?'Upcoming':'Passed'}</span><button class="reminder-edit-btn" type="button" data-edit-event="${esc(e.id)}" aria-label="Edit event">${icon('edit')}</button><button class="icon-delete reminder-overview-delete" type="button" data-delete-event="${esc(e.id)}" aria-label="Delete event">${icon('trash')}</button></div>`;
  }).join('');
  const selectedHabitMarkup = selectedHabitReminders.map(r=>`<div class="calendar-reminder-row"><span class="reminder-emoji">${esc(r.emoji)}</span><span class="reminder-copy"><strong>${esc(r.title)}</strong><small>${esc(formatTimeShort(r.time))} · Habit reminder</small></span><span class="reminder-status">Scheduled</span><button class="reminder-edit-btn" type="button" data-edit-reminder="${esc(r.id)}" aria-label="Edit reminder">${icon('edit')}</button><button class="icon-delete reminder-overview-delete" type="button" data-delete-reminder="${esc(r.id)}" aria-label="Delete reminder">${icon('trash')}</button></div>`).join('');
  const upcomingMarkup = upcoming.slice(0,10).map(r=>`<div class="calendar-reminder-row"><span class="reminder-emoji">${esc(r.emoji)}</span><span class="reminder-copy"><strong>${esc(r.title)}</strong><small>${esc(formatDate(dateISO(r.eventAt)))} · ${esc(formatTimeShort(r.at))} · ${esc(r.detail)}</small></span><span class="reminder-status">${r.kind==='event'?'Event':'Habit'}</span>${r.kind==='event'?`<button class="reminder-edit-btn" type="button" data-edit-event="${esc(r.eventId)}" aria-label="Edit event">${icon('edit')}</button>`:`<button class="reminder-edit-btn" type="button" data-edit-reminder="${esc(r.id)}" aria-label="Edit reminder">${icon('edit')}</button>`}</div>`).join('');

  return `<div class="reminder-overview-sections">
    <section class="reminder-overview-subsection"><div class="reminder-subhead"><div><strong>Selected day</strong><small>${esc(formatDate(selectedDate))}</small></div><span>${selectedEvents.length+selectedHabitReminders.length}</span></div>${selectedEventMarkup||selectedHabitMarkup?`<div class="reminder-overview-list">${selectedEventMarkup}${selectedHabitMarkup}</div>`:'<div class="reminder-overview-empty compact"><span>No events or reminders for this day.</span></div>'}</section>
    <section class="reminder-overview-subsection"><div class="reminder-subhead"><div><strong>Upcoming reminders</strong><small>Next scheduled event and habit notifications</small></div><span>${upcoming.length}</span></div>${upcomingMarkup?`<div class="reminder-overview-list">${upcomingMarkup}</div>`:'<div class="reminder-overview-empty compact"><span>No upcoming reminders.</span></div>'}</section>
    <button class="primary-btn reminder-add-btn" type="button" data-add-event><span aria-hidden="true">+</span><span>Add Event</span></button>
  </div>`;
}

function formatReminderTime(value) {
  if (!value) return 'No time';
  const [h, m] = String(value).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(value);
  return formatTimeShort(value);
}
function reminderSoundLabel(value) {
  return ({ gentle:'Gentle Bell', chime:'Soft Chime', calm:'Calm', classic:'Classic', simple:'Simple', bright:'Bright', marimba:'Marimba', digital:'Digital', none:'No Sound' }[value] || 'Gentle Bell');
}
function reminderDaysLabel(days) {
  const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const values = normalizeReminderDays(days);
  if (values.length === 7) return 'Every day';
  return values.map(d => labels[d]).join(' · ');
}
function eventReminderTimeValue(date, time) {
  if (!date || !time) return '';
  return parseTime24(time) || '';
}

function reminderForm(id) {
  const eventReminder = id ? state.reminders.find(r => r.id === id && r.source === 'manual' && r.eventId) : null;
  if (eventReminder) {
    const event = reminderEventFor(eventReminder);
    if (event) { eventForm(event.id); return; }
  }
  const reminder = id ? state.reminders.find(r => r.id === id && r.source === 'manual' && !r.eventId) : null;
  const habits = state.habits.filter(h => !h.paused || h.id === reminder?.habitId);
  if (!habits.length) { toast('Create a habit first'); return; }

  const habitId = reminder?.habitId || habits[0].id;
  const days = normalizeReminderDays(reminder?.days || state.settings?.notifications?.defaultHabitDays);
  const selectedDays = new Set(days);
  const dayOptions = [[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri'],[6,'Sat'],[0,'Sun']];
  const defaultTime = parseTime24(reminder?.time) || parseTime24(state.settings?.notifications?.defaultHabitTime) || '20:00:00';

  modal(
    id ? 'Edit habit reminder' : 'Add habit reminder',
    id ? 'Update the time, selected days, sound, or status of this habit reminder.' : 'Choose when and on which days Habitly should remind you.',
    `<form class="form" id="reminderForm">
      <div class="field"><label>Habit *</label><select name="habitId" required>${habits.map(h => `<option value="${esc(h.id)}" ${h.id === habitId ? 'selected' : ''}>${esc(h.emoji || '🔔')} ${esc(h.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Reminder time *</label><input name="time" class="time-text-input" type="text" required value="${esc(formatTimeShort(defaultTime))}" placeholder="${userTimeFormat()==='12h'?'8:00 PM':'20:00'}" autocomplete="off"></div>
      <div class="field"><label>Repeat on</label><div class="reminder-day-picker" role="group" aria-label="Days for habit reminder">${dayOptions.map(([v,label]) => `<label class="reminder-day"><input type="checkbox" name="days" value="${v}" ${selectedDays.has(v) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><small class="field-help">The reminder will use the next selected day after the current time.</small></div>
      <div class="field"><label>Reminder sound</label><div class="form-grid two"><select name="sound">${[['gentle','Gentle Bell'],['chime','Soft Chime'],['calm','Calm'],['classic','Classic'],['simple','Simple'],['bright','Bright'],['marimba','Marimba'],['digital','Digital'],['none','No Sound']].map(([v,t]) => `<option value="${v}" ${v === (reminder?.sound || 'gentle') ? 'selected' : ''}>${t}</option>`).join('')}</select><button type="button" class="secondary-btn reminder-preview-btn" id="previewReminderSound">▶ Preview sound</button></div></div>
      ${id ? `<label class="switch-row"><span><b>Reminder enabled</b><small>Turn this reminder off without deleting it.</small></span><input type="checkbox" name="enabled" ${reminder?.enabled !== false ? 'checked' : ''}><i></i></label>` : ''}
      <div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button>${id ? '<button type="button" class="danger-btn" id="deleteReminder">Delete Reminder</button>' : ''}<button class="primary-btn">${id ? 'Save Changes' : 'Add Reminder'} →</button></div>
    </form>`
  );

  const form = document.getElementById('reminderForm');
  if (!form) return;
  form.querySelector('#previewReminderSound')?.addEventListener('click', () => {
    const selected = String(form.querySelector('[name="sound"]')?.value || 'gentle');
    if (selected === 'none') { toast('Sound is disabled for this reminder'); return; }
    playReminderSound(selected);
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const selectedHabitId = String(fd.get('habitId') || '');
    const time = parseTime24(fd.get('time'));
    const sound = String(fd.get('sound') || 'gentle');
    const selected = state.habits.find(h => h.id === selectedHabitId);
    const selectedDays = normalizeReminderDays(fd.getAll('days').map(Number));
    if (!selectedHabitId || !time || !selected || !selectedDays.length) { toast('Choose a habit, time, and at least one day'); return; }

    if (id) {
      const existing = state.reminders.find(r => r.id === id);
      if (existing) Object.assign(existing, { habitId: selectedHabitId, time, days: selectedDays, sound, enabled: fd.get('enabled') === 'on', source: 'manual', updatedAt: new Date().toISOString() });
    } else {
      const existing = state.reminders.find(r => r.habitId === selectedHabitId && r.source === 'manual' && !r.eventId);
      if (existing) Object.assign(existing, { time, days: selectedDays, sound, enabled: true, source: 'manual', updatedAt: new Date().toISOString() });
      else state.reminders.push({ id: uid('r'), habitId: selectedHabitId, time, days: selectedDays, sound, enabled: true, source: 'manual', updatedAt: new Date().toISOString() });
    }
    save(); closeModal(); render(); checkReminderNotifications(true); refreshReminderUi(); toast(id ? 'Reminder updated' : 'Reminder added');
  });

  document.getElementById('deleteReminder')?.addEventListener('click', () => {
    if (deleteReminderById(id)) { closeModal(); render(); toast('Reminder deleted'); }
  });
}
function nextEventOccurrence(event, from = new Date()) {
  if (!event || !event.date || !event.time) return null;
  const base = new Date(`${event.date}T${parseTime24(event.time) || '00:00:00'}`);
  return Number.isNaN(base.getTime()) || base.getTime() <= from.getTime() ? null : base;
}
function nextEventReminderOccurrence(reminder, from = new Date()) {
  const event = reminderEventFor(reminder);
  if (!event) return null;
  const base = nextEventOccurrence(event, from);
  if (!base) return null;
  // Event reminders always fire at the event time. Legacy before-event offsets are ignored.
  base.setMinutes(base.getMinutes());
  return base.getTime() >= from.getTime() ? base : null;
}
function nextReminderOccurrence(reminder, from = new Date()) {
  if (!reminder || reminder.enabled === false) return null;
  if (reminder.eventId) return nextEventReminderOccurrence(reminder, from);
  const t = parseTime24(reminder.time);
  if (!t) return null;
  const days = normalizeReminderDays(reminder.days);
  const [hours, minutes, seconds] = t.split(':').map(Number);
  const base = new Date(from);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + offset);
    candidate.setHours(hours, minutes, seconds, 0);
    if (candidate.getTime() <= from.getTime()) continue;
    if (days.includes(candidate.getDay())) return candidate;
  }
  return null;
}
function reminderData() {
  const now = new Date(), today = todayISO();
  // The bell is a combined "Events + Reminders" surface. Every future event
  // counts once, whether or not a reminder was configured for that event.
  const eventItems = (state.events || [])
    .map(e => {
      const nextEvent = nextEventOccurrence(e, now);
      if (!nextEvent) return null;
      const linked = state.reminders.find(r => r.eventId === e.id && r.source === 'manual' && r.enabled !== false);
      const displayTime = linked
        ? nextReminderOccurrence(linked, now)
        : nextEvent;
      // A reminder can be in the past while the event itself is still upcoming
      // (for example, "30 minutes before"). The event still belongs in the bell.
      return {
        id: e.id,
        eventId: e.id,
        reminderId: linked?.id || null,
        emoji:e.emoji || '📅',
        title:e.title,
        date:dateISO(nextEvent),
        displayDate:formatDate(dateISO(nextEvent)),
        time:formatTime(`${String(nextEvent.getHours()).padStart(2,'0')}:${String(nextEvent.getMinutes()).padStart(2,'0')}:${String(nextEvent.getSeconds()).padStart(2,'0')}`),
        reminderTime: displayTime ? formatTime(`${String(displayTime.getHours()).padStart(2,'0')}:${String(displayTime.getMinutes()).padStart(2,'0')}:${String(displayTime.getSeconds()).padStart(2,'0')}`) : null,
        kind:'Event',
        sortKey:nextEvent.getTime(),
        hasReminder:!!linked
      };
    }).filter(Boolean).sort((a,b) => a.sortKey - b.sortKey);

  const habits = (state.reminders || [])
    .filter(r => r && r.source === 'manual' && r.enabled !== false && !r.eventId)
    .map(r => {
      const habit = reminderHabitFor(r);
      if (!habit || habit.paused) return null;
      const next = nextReminderOccurrence(r, now); if (!next) return null;
      const iso = dateISO(next);
      return { id:r.id, emoji:habit.emoji || '🔔', title:habit.name, date:iso === today ? 'Today' : iso === dateISO(new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,12)) ? 'Tomorrow' : formatDate(iso), time:formatTime(r.time), kind:'Habit', sortKey:`${iso} ${r.time}` };
    }).filter(Boolean);
  return { events:eventItems, habits };
}
function eventNotificationCount() {
  const data = reminderData();
  const notifications = state.settings?.notifications || defaultState.settings.notifications;
  // Event count is independent of the event's reminder/offset. An event with
  // no reminder still counts, while an event with a reminder counts only once.
  const events = notifications.eventReminders !== false ? data.events.length : 0;
  const habits = notifications.habitReminders !== false ? data.habits.length : 0;
  return events + habits;
}

function reminderSectionMarkup(title, items, emptyText, options = {}) {
  const { editable = false, events = false } = options;
  return `<section class="reminder-section">
    <div class="reminder-section-head"><strong>${esc(title)}</strong><span>${items.length}</span></div>
    ${items.length ? `<div class="reminder-list">${items.map(i => {
      const action = editable ? `data-edit-reminder="${esc(i.id)}"` : `data-edit-event-reminder="${esc(i.eventId || '')}"`;
      const deleteButton = events && i.hasReminder
        ? `<button class="reminder-delete-btn" type="button" data-delete-reminder="${esc(i.reminderId)}" aria-label="Delete reminder for ${esc(i.title)}" title="Delete reminder">${icon('trash')}</button>`
        : editable
          ? `<button class="reminder-delete-btn" type="button" data-delete-reminder="${esc(i.id)}" aria-label="Delete reminder for ${esc(i.title)}" title="Delete reminder">${icon('trash')}</button>`
          : '';
      return `<div class="reminder-item-row">
        <button class="reminder-item ${editable ? 'is-habit-reminder' : 'is-event-reminder'}" type="button" ${action}>
          <span class="reminder-emoji">${esc(i.emoji)}</span>
          <span class="reminder-copy"><strong>${esc(i.title)}</strong><small>${esc(formatTimeShort(i.time))}${events && i.hasReminder ? ' · Reminder at event time' : ''}</small></span>
          <span class="reminder-dot"></span>
        </button>
        ${deleteButton}
      </div>`;
    }).join('')}</div>` : `<div class="reminder-section-empty">${esc(emptyText)}</div>`}
  </section>`;
}

function reminderPanel() {
  const data = reminderData();
  return `<div class="reminder-popover hidden" id="reminderPopover" role="dialog" aria-label="Reminders">
    <div class="reminder-head">
      <div><strong>Reminders</strong><small>Upcoming events and habit reminders</small></div>
      <button class="reminder-close" data-close-reminders aria-label="Close reminders">×</button>
    </div>
    <div class="reminder-sections">
      ${reminderSectionMarkup('Upcoming Events', data.events, 'No upcoming events.', { events: true })}
      ${reminderSectionMarkup('Habit Reminders', data.habits, 'No habit reminders are set.', { editable: true })}
    </div>
    <button class="reminder-view" data-route="calendar">View calendar →</button>
  </div>`;
}

function topActions() { return `<div class="top-actions"><button class="action-icon reminder" aria-label="Reminders" data-reminders>${icon('bell')}<span class="badge">${eventNotificationCount()}</span></button><div class="date">${icon('calendar')}<span class="today-label"></span><span class="today-time"></span></div><button class="profile-mini" data-route="settings" aria-label="Account settings">${avatarMarkup()}</button><button class="profile-chevron" data-route="settings" aria-label="Account settings">${icon('chevron')}</button></div>`; }
function mobileHeader() { const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true; return `<div class="mobile-header"><button class="hamburger" id="menuToggle" aria-label="Open menu">${icon('menu')}</button><div class="mobile-brand">${logo()}<strong>Habitly</strong></div><div class="mobile-actions"><button class="action-icon reminder" data-reminders aria-label="Reminders" title="Reminders">${icon('bell')}<span class="badge">${eventNotificationCount()}</span></button>${standalone ? '' : `<button class="action-icon install-mobile" data-install-app aria-label="Install Habitly" title="Install Habitly">${icon('download')}</button>`}<button class="action-icon" data-route="calendar" aria-label="Calendar" title="Calendar">${icon('calendar')}</button><button class="profile-mini" data-route="settings" aria-label="Open account settings">${avatarMarkup()}</button></div></div>`; }
function shell(route, content) { return `<div class="app-shell">${sidebar(route)}<main class="main-content page-${route}">${mobileHeader()}<div class="desktop-top">${topActions()}</div>${content}</main>${mobileDrawer(route)}${reminderPanel()}</div>`; }
function greeting(sub = 'Stay consistent, the results will follow.') { const hour = new Date().getHours(); const text = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : hour >= 17 && hour < 21 ? 'Good evening' : 'Good night'; const name = esc(state.profile?.name || currentAuthUser?.user_metadata?.name || currentAuthUser?.email?.split('@')[0] || 'there'); return `<header class="greeting"><h1>${text}, <span>${name}!</span> <b>👋</b></h1><p>${sub}</p></header>`; }
function refreshGreeting() { const h = document.querySelector('.greeting h1'); if (!h) return; const hour = new Date().getHours(); const text = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : hour >= 17 && hour < 21 ? 'Good evening' : 'Good night'; const name = esc(state.profile?.name || currentAuthUser?.user_metadata?.name || currentAuthUser?.email?.split('@')[0] || 'there'); h.innerHTML = `${text}, <span>${name}!</span> <b>👋</b>`; }

function habitIconClass(h) { return 'habit-icon'; }
function habitRow(h, opts = {}) {
  const p = pct(h);
  const done = h.type === 'yesno' ? Number(h.current) >= 1 : p >= 100;
  const compact = !!opts.compact;
  const isYesNo = h.type === 'yesno';
  const current = Number(h.current) || 0;
  const target = isYesNo ? 1 : Math.max(1, Number(h.target) || 1);
  return `<article class="habit-row ${compact ? 'compact' : ''} ${h.paused ? 'is-paused' : ''}" data-id="${h.id}" data-category="${esc(h.category)}">
    <div class="habit-icon">${esc(h.emoji || '')}</div>
    <div class="habit-name"><strong>${esc(h.name)}</strong><small>${isYesNo ? 'Yes / No' : `${esc(target)} ${esc(h.unit || 'times')} a day`}${h.paused ? ' · Paused' : ''}</small></div>
    <div class="habit-progress">
      ${isYesNo ? `<div class="yesno-controls"><button type="button" class="yesno-choice ${done ? 'selected' : ''}" ${h.paused ? 'disabled' : ''} data-habit-action="yes" aria-pressed="${done}">Yes</button><button type="button" class="yesno-choice ${!done ? 'selected' : ''}" ${h.paused ? 'disabled' : ''} data-habit-action="no" aria-pressed="${!done}">No</button></div>` : `<div class="quantity-controls"><button class="qty-btn" ${h.paused ? 'disabled' : ''} data-habit-action="minus" aria-label="Decrease ${esc(h.name)}">${icon('minus')}</button><span class="qty-value">${esc(current)} / ${esc(target)} ${esc(h.unit || 'times')}</span><button class="qty-btn" ${h.paused ? 'disabled' : ''} data-habit-action="plus" aria-label="Increase ${esc(h.name)}">${icon('plus')}</button></div>`}
      <div class="progress-track"><i style="width:${p}%"></i></div>
      <strong class="percent">${p}%</strong>
    </div>
    ${isYesNo ? `<div class="yesno-leaf-status ${done ? 'done' : ''}" aria-label="${done ? 'Completed' : 'Not completed'}"><img src="${done ? AS + 'Habitly Leaf White.png' : AS + 'Habitly Leaf Transparent.png'}" alt="${done ? 'Completed' : 'Not complete'}"></div>` : `<button class="complete ${done ? 'done' : ''}" ${done && !h.paused ? '' : 'disabled'} data-habit-action="complete" aria-label="${done ? 'Mark complete' : 'Reach 100% to complete'}">${done ? `<img src="${AS}Habitly Leaf White.png" alt="Completed">` : `<img src="${AS}Habitly Leaf Transparent.png" alt="Not complete">`}</button>`}
    ${opts.menu ? `<button class="dots-btn" data-menu="habit:${h.id}" aria-label="Habit actions">${icon('dots')}</button>` : ''}
  </article>`;
}

function dashboard() { const habits = state.habits.filter(h => !h.paused), total = habits.length, avg = dailyProgress(todayISO()), completed = habits.filter(h => pct(h) >= 100).length, weekly = weeklyActivityData(new Date()), recorded = weekly.filter(x => x.value !== null), weekAvg = recorded.length ? Math.round(recorded.reduce((a, x) => a + x.value, 0) / recorded.length) : 0; return shell('dashboard', `${greeting()}<section class="stats-grid dashboard-stats"><article class="stat-card"><div class="progress-ring" style="--p:${avg}%"><span>${avg}%</span></div><h2>Today's Progress</h2><p>${avg >= 75 ? 'Great going!' : 'Keep building!'}</p></article><article class="stat-card"><div class="stat-emoji fire">🔥</div><div class="big-number">${currentStreak()}</div><h2>Current Streak</h2><p>days</p></article><article class="stat-card"><div class="stat-emoji trophy">🏆</div><div class="big-number">${bestStreak()}</div><h2>Best Streak</h2><p>days</p></article><article class="stat-card"><div class="stat-emoji check">✓</div><div class="big-number">${completed}</div><h2>Completed Today</h2><p>out of ${total}</p></article><article class="stat-card"><div class="stat-emoji trend">↗</div><div class="big-number">${weekAvg}%</div><h2>Consistency</h2><p>This week</p></article></section><section class="dashboard-grid"><article class="panel habits-panel"><div class="panel-header"><div><h2>Today's Habits</h2><div class="filters" data-filter-group="dashboard"><button class="filter active" data-filter="All">All</button><button class="filter" data-filter="Health">Health</button><button class="filter" data-filter="Fitness">Fitness</button><button class="filter" data-filter="Study">Study</button><button class="filter" data-filter="Personal">Personal</button><button class="filter" data-filter="Mindfulness">Mindfulness</button></div></div><button class="primary-btn" data-open-habit>+ Add Habit</button></div><div class="habit-list" id="dashboardHabits">${habits.map(h => habitRow(h)).join('')}</div><button class="view-link" data-route="habits">View all habits →</button></article><div class="right-column"><article class="panel weekly-panel"><div class="panel-title-row"><div><h2>Weekly Activity</h2><p class="panel-subtitle">Actual recorded completion this week</p></div><span class="week-total">${weekAvg}%</span></div><div class="activity-chart" id="dashboardWeeklyChart">${weekly.map(x => `<div class="activity-day ${x.value === null ? 'future' : ''}"><span class="bar-value">${x.value === null ? '' : x.value + '%'}</span><div class="bar"><i style="height:${x.value === null ? 0 : x.value}%"></i></div><b>${x.label}</b></div>`).join('')}</div></article></div></section>`); }

function habitsPage() {
  const avg = Math.round(state.habits.reduce((a, h) => a + pct(h), 0) / Math.max(1, state.habits.length));
  return shell('habits', `<div class="page-title"><span class="eyebrow">YOUR ROUTINES</span><h1>My Habits</h1><p>Build better habits, achieve your goals.</p></div><div class="page-actions"><button class="primary-btn" data-open-habit>+ Add Habit</button></div>
 <section class="habit-summary"><article class="summary-card"><div class="summary-icon purple">☷</div><div><strong>${state.habits.length}</strong><span>Total Habits</span><small>All time</small></div></article><article class="summary-card"><div class="summary-icon green">✓</div><div><strong>${state.habits.filter(h => !h.paused).length}</strong><span>Active Habits</span><small>Keep going!</small></div></article><article class="summary-card"><div class="summary-icon blue">▥</div><div><strong>${avg}%</strong><span>Average Progress</span><small>This month</small></div></article><article class="summary-card"><div class="summary-icon orange">🔥</div><div><strong>${currentStreak()}</strong><span>Current Streak</span><small>days</small></div></article></section>
 <section class="panel habits-page-panel"><div class="list-toolbar"><div class="filters" id="habitFilters"><button class="filter active" data-habit-filter="all">All Habits</button><button class="filter" data-habit-filter="active">Active</button><button class="filter" data-habit-filter="completed">Completed</button><button class="filter" data-habit-filter="paused">Paused</button></div><label class="sort-select">Sort by:<select id="habitSort"><option value="recent">Recent</option><option value="progress">Progress</option><option value="name">Name</option></select>${icon('chevron')}</label></div><div class="habit-list full" id="habitCards"></div></section>`);
}
function renderHabitCards(filter = 'all', sort = 'recent') {
  const root = document.getElementById('habitCards'); if (!root) return;
  let list = [...state.habits];
  if (filter === 'active') list = list.filter(h => !h.paused && pct(h) < 100); if (filter === 'completed') list = list.filter(h => pct(h) >= 100); if (filter === 'paused') list = list.filter(h => h.paused);
  if (sort === 'progress') list.sort((a, b) => pct(b) - pct(a)); if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name)); if (sort === 'recent') list.sort((a, b) => (b.created || 0) - (a.created || 0));
  root.innerHTML = list.map(h => habitRow(h, { menu: true })).join('') || `<div class="empty-state"><strong>No habits here yet.</strong><span>Try another filter or add a new habit.</span></div>`;
  bindHabitInteractions(root);
}

function goalsPage() {
  return shell('goals', `<div class="page-title goals-title"><span class="eyebrow">YOUR FUTURE, ONE GOAL AT A TIME</span><h1>My Goals</h1><p>Set meaningful goals, track your progress, and celebrate every milestone.</p></div><div class="page-actions"><button type="button" class="primary-btn" data-open-goal>+ Add Goal</button></div><section class="goals-layout"><div><div class="filters goal-filters" id="goalFilters"><button class="filter active" data-goal-filter="all">All Goals</button><button class="filter" data-goal-filter="active">Active</button><button class="filter" data-goal-filter="ontrack">On Track</button><button class="filter" data-goal-filter="completed">Completed</button><button class="filter" data-goal-filter="paused">Paused</button></div><div class="goal-list" id="goalCards"></div></div><aside class="goals-side"><article class="panel overview-card"><h2>Goals Overview</h2><div class="overview-grid"><div><strong>${state.goals.length}</strong><span>Total Goals</span></div><div><strong>${state.goals.filter(g => g.status !== 'paused' && goalPct(g) < 100).length}</strong><span>Active</span></div><div><strong>${state.goals.filter(g => g.status === 'paused').length}</strong><span>Paused</span></div><div><strong>${state.goals.filter(g => goalPct(g) >= 100 || g.status === 'completed').length}</strong><span>Completed</span></div></div><button class="view-link" data-goal-filter="all">View all goals →</button></article><article class="panel category-card"><h2>Goals by Category</h2><div class="goal-category-list">${Object.entries(state.goals.reduce((acc,g)=>{acc[g.category]=(acc[g.category]||0)+1;return acc;},{})).map(([category,count])=>`<div><span>${esc(category)}</span><b>${count}</b></div>`).join('') || '<div class="muted-copy">No goals yet.</div>'}</div></article></aside></section>`);
}

function fitnessGoalCard(g, p, left) {
  const current=fitnessCurrentWeight(g), avg=fitnessAverage(g,7), change=fitnessChange(g), rate=fitnessWeeklyRate(g);
  const sign=change>=0?'+':'';
  const ms=(g.milestones||[]), doneMs=ms.filter(m=>m.completed).length;
  return `<article class="goal-card fitness-goal-card ${g.status === 'paused' ? 'is-paused' : ''}" data-goal-id="${esc(g.id)}"><div class="goal-emoji">🏋️</div><div class="goal-main"><strong>${esc(g.title)}</strong><span class="goal-category">Fitness · ${g.fitness?.direction==='loss'?'Weight Loss':'Weight Gain'}</span><small>${current.toFixed(1)} kg now · ${Number(g.fitness?.targetWeight||g.target).toFixed(1)} kg target</small><div class="goal-component-chips"><span>Target</span>${g.components?.milestones?`<span>${doneMs}/${ms.length} milestones</span>`:''}${g.components?.habits?`<span>Habits linked</span>`:''}</div></div><div class="goal-progress"><div class="goal-progress-top"><strong>${p}%</strong><button class="goal-update-btn" data-fitness-goal="${esc(g.id)}">Track</button></div><div class="progress-track"><i style="width:${p}%"></i></div><small>7-day avg ${avg.toFixed(1)} kg · ${sign}${rate.toFixed(2)} kg/week</small></div><div class="goal-date">${icon('calendar')}<span>${formatDate(g.date)}</span><b>${left === null ? 'No deadline' : left >= 0 ? left + ' days left' : 'Past due'}</b></div><button class="dots-btn goal-dots" data-menu="goal:${esc(g.id)}" aria-label="Goal actions">${icon('dots')}</button></article>`;
}
function renderFitnessChart(g) {
  const e=fitnessEntries(g); if(e.length<2) return '<div class="fitness-chart-empty">Add at least two weigh-ins to see your trend.</div>';
  const w=720,h=250,pad=28, vals=e.map(x=>Number(x.weight)), min=Math.min(...vals),max=Math.max(...vals), range=Math.max(.5,max-min), points=e.map((x,i)=>{const X=pad+(i/(e.length-1))*(w-pad*2),Y=h-pad-((Number(x.weight)-min)/range)*(h-pad*2);return [X,Y,x.weight,x.date]}), path=points.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+','+q[1].toFixed(1)).join(' ');
  return `<svg class="fitness-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weight trend"><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" class="chart-axis"/><path d="${path}" class="fitness-line" fill="none"/>${points.map(q=>`<circle cx="${q[0]}" cy="${q[1]}" r="4" class="fitness-dot"><title>${q[3]} · ${Number(q[2]).toFixed(1)} kg</title></circle>`).join('')}</svg>`;
}
function fitnessDashboard(id) {
  const g=state.goals.find(x=>x.id===id); if(!g||g.type!=='fitness') return;
  normalizeFitnessGoal(g);
  const f=g.fitness||{}, current=fitnessCurrentWeight(g), avg7=fitnessAverage(g,7), avg30=fitnessAverage(g,30), change=fitnessChange(g), rate=fitnessWeeklyRate(g), p=goalPct(g), entries=fitnessEntries(g).slice().reverse();
  const sign=change>=0?'+':'-', settings=state.settings?.fitness||defaultState.settings.fitness;
  const measurements=(f.measurements||[]).slice().reverse(), workouts=(f.workouts||[]).slice().reverse();
  const milestoneBlock = g.components?.milestones ? `<section class="fitness-panel goal-component-panel"><div class="fitness-section-head"><div><h4>Milestones</h4><small>Checkpoints are based on your actual weight.</small></div><span>${(g.milestones||[]).filter(m=>m.completed).length}/${(g.milestones||[]).length}</span></div>${(g.milestones||[]).map(m=>`<div class="fitness-check-row ${m.completed?'done':''}"><span class="milestone-status">${m.completed?'✓':'○'}</span><span><b>${esc(m.title)}</b>${m.value!=null?`<small>${Number(m.value).toFixed(1)} kg</small>`:''}</span><strong>${m.completed?'Reached':'Not yet'}</strong></div>`).join('')||'<div class="muted-copy">No milestones added.</div>'}</section>` : '';
  const habitBlock = g.components?.habits ? `<section class="fitness-panel goal-component-panel"><div class="fitness-section-head"><div><h4>Supporting habits</h4><small>Habits that contribute to this fitness goal.</small></div></div>${(g.goalHabitIds||[]).map(hid=>state.habits.find(h=>h.id===hid)).filter(Boolean).map(h=>`<div class="fitness-check-row"><span>${esc(h.emoji||'•')}</span><span><b>${esc(h.name)}</b><small>Today ${pct(h)}%</small></span><strong>${pct(h)}%</strong></div>`).join('')||'<div class="muted-copy">No supporting habits linked.</div>'}</section>` : '';
  const bodyBlock = settings.bodyMeasurements ? `<section class="fitness-panel"><div class="fitness-section-head"><div><h4>Body measurements</h4><small>Optional advanced tracking enabled in Settings.</small></div></div><form id="fitnessMeasurementForm" class="form"><div class="form-grid two"><div class="field"><label>Date</label><input name="date" type="date" value="${todayISO()}" required></div><div class="field"><label>Chest (in)</label><input name="chest" type="number" step="0.1"></div><div class="field"><label>Waist (in)</label><input name="waist" type="number" step="0.1"></div><div class="field"><label>Arms (in)</label><input name="arms" type="number" step="0.1"></div><div class="field"><label>Thighs (in)</label><input name="thighs" type="number" step="0.1"></div><div class="field"><label>Shoulders (in)</label><input name="shoulders" type="number" step="0.1"></div></div><div class="form-actions"><button class="secondary-btn">Save measurements</button></div></form>${measurements.slice(0,4).map(m=>`<div class="fitness-history-row"><b>${formatDate(m.date)}</b><span>Chest ${m.chest||'—'} · Waist ${m.waist||'—'} · Arms ${m.arms||'—'}</span></div>`).join('')||'<div class="muted-copy">No measurements yet.</div>'}</section>` : '';
  const workoutBlock = settings.workoutLogging ? `<section class="fitness-panel"><div class="fitness-section-head"><div><h4>Strength log</h4><small>Optional advanced tracking enabled in Settings.</small></div></div><form id="fitnessWorkoutForm" class="form"><div class="form-grid two"><div class="field"><label>Date</label><input name="date" type="date" value="${todayISO()}" required></div><div class="field"><label>Exercise *</label><input name="exercise" placeholder="Bench Press" required></div><div class="field"><label>Weight (kg)</label><input name="weight" type="number" step="0.5" min="0"></div><div class="field"><label>Sets</label><input name="sets" type="number" min="0" step="1"></div><div class="field"><label>Reps</label><input name="reps" type="number" min="0" step="1"></div><div class="field"><label>Notes</label><input name="notes" placeholder="e.g. felt strong"></div></div><div class="form-actions"><button class="secondary-btn">Log workout</button></div></form>${workouts.slice(0,8).map(w=>`<div class="fitness-history-row"><b>${esc(w.exercise)}</b><span>${formatDate(w.date)} · ${w.weight||0} kg · ${w.sets||0}×${w.reps||0}</span></div>`).join('')||'<div class="muted-copy">No strength records yet.</div>'}</section>` : '';
  const bodyFatField = settings.bodyMeasurements ? `<div class="field"><label>Body fat % <small>(optional)</small></label><input name="bodyFat" type="number" step="0.1" min="0" max="100"></div>` : '';

  modal('Fitness Dashboard', 'Weight tracking is always available. Advanced workout and body-measurement sections appear only when enabled in Settings.', `<div class="fitness-dashboard">
    <section class="fitness-hero"><div><span class="eyebrow">${f.direction==='loss'?'WEIGHT LOSS':'WEIGHT GAIN'} GOAL</span><h3>${esc(g.title)}</h3><p>${Number(f.startWeight||0).toFixed(1)} kg → ${Number(f.targetWeight||0).toFixed(1)} kg · ${p}% complete</p></div><div class="fitness-progress-ring"><strong>${p}%</strong><span>complete</span></div></section>
    <div class="fitness-kpis"><div><span>Current</span><strong>${current.toFixed(1)} kg</strong></div><div><span>7-day avg</span><strong>${avg7.toFixed(1)} kg</strong></div><div><span>30-day avg</span><strong>${avg30.toFixed(1)} kg</strong></div><div><span>Total change</span><strong>${change>=0?'+':''}${change.toFixed(1)} kg</strong></div><div><span>Weekly pace</span><strong>${rate>=0?'+':''}${rate.toFixed(2)} kg</strong><small>per week</small></div><div><span>Remaining</span><strong>${Math.abs(Number(f.targetWeight||0)-current).toFixed(1)} kg</strong></div></div>
    <section class="fitness-panel"><div class="fitness-section-head"><div><h4>Weight trend</h4><small>Use averages and the trend instead of one day's number.</small></div><span>${entries.length} weigh-ins</span></div>${renderFitnessChart(g)}</section>
    <section class="fitness-panel"><div class="fitness-section-head"><div><h4>Log weight</h4><small>Record one measurement per day. Updating an existing date replaces that day's value.</small></div></div><form id="fitnessWeightForm" class="form"><div class="form-grid two"><div class="field"><label>Date *</label><input name="date" type="date" value="${todayISO()}" required></div><div class="field"><label>Weight (kg) *</label><input name="weight" type="number" step="0.1" min="1" value="${current.toFixed(1)}" required></div>${bodyFatField}<div class="field"><label>Note <small>(optional)</small></label><input name="notes" placeholder="e.g. morning, before breakfast"></div></div><div class="form-actions"><button class="primary-btn">Save weight →</button></div></form></section>
    ${milestoneBlock}${habitBlock}${bodyBlock}${workoutBlock}
  </div>`);
  document.getElementById('fitnessWeightForm')?.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(e.target),date=String(fd.get('date')),weight=Number(fd.get('weight'));if(!date||!Number.isFinite(weight)||weight<=0)return toast('Enter a valid date and weight');f.weightEntries=Array.isArray(f.weightEntries)?f.weightEntries:[];const existing=f.weightEntries.find(x=>x.date===date);const row={id:existing?.id||uid('fw'),date,weight,bodyFat:settings.bodyMeasurements?(Number(fd.get('bodyFat'))||0):0,notes:String(fd.get('notes')||''),updatedAt:new Date().toISOString()};if(existing)Object.assign(existing,row);else f.weightEntries.push(row);f.weightEntries.sort((a,b)=>a.date.localeCompare(b.date));g.current=weight;g.updatedAt=new Date().toISOString();normalizeFitnessGoal(g);g.status=fitnessGoalStatus(g);const ok=save(); if(!ok){toast('Could not save weight'); return;} closeModal(); render(); fitnessDashboard(id); toast('Weight saved');});
  document.getElementById('fitnessMeasurementForm')?.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(e.target);f.measurements=Array.isArray(f.measurements)?f.measurements:[];f.measurements.push({id:uid('fm'),date:String(fd.get('date')),chest:Number(fd.get('chest'))||0,waist:Number(fd.get('waist'))||0,arms:Number(fd.get('arms'))||0,thighs:Number(fd.get('thighs'))||0,shoulders:Number(fd.get('shoulders'))||0,hips:0,updatedAt:new Date().toISOString()});g.updatedAt=new Date().toISOString();const ok=save(); if(!ok){toast('Could not save measurements'); return;} closeModal(); render(); fitnessDashboard(id); toast('Measurements saved');});
  document.getElementById('fitnessWorkoutForm')?.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(e.target);f.workouts=Array.isArray(f.workouts)?f.workouts:[];f.workouts.push({id:uid('fwk'),date:String(fd.get('date')),exercise:String(fd.get('exercise')).trim(),weight:Number(fd.get('weight'))||0,sets:Number(fd.get('sets'))||0,reps:Number(fd.get('reps'))||0,notes:String(fd.get('notes')||''),updatedAt:new Date().toISOString()});g.updatedAt=new Date().toISOString();const ok=save(); if(!ok){toast('Could not save workout'); return;} closeModal(); render(); fitnessDashboard(id); toast('Workout logged');});
}

function renderGoals(filter = 'all') {
  const root = document.getElementById('goalCards'); if (!root) return; let list = [...state.goals];
  if (filter === 'active') list = list.filter(g => g.status !== 'paused' && goalPct(g) < 100);
  if (filter === 'ontrack') list = list.filter(g => g.status !== 'paused' && goalPct(g) >= 50 && goalPct(g) < 100);
  if (filter === 'completed') list = list.filter(g => goalPct(g) >= 100 || g.status === 'completed');
  if (filter === 'paused') list = list.filter(g => g.status === 'paused');
  root.innerHTML = list.map(g => { const p=goalPct(g), left=daysLeft(g.date); if(g.type==='fitness') return fitnessGoalCard(g,p,left); const chips=[g.components?.target?'Target':'',g.components?.milestones?`${(g.milestones||[]).filter(m=>m.completed).length}/${(g.milestones||[]).length} milestones`:'',g.components?.habits?`${(g.goalHabitIds||[]).length} habits`:'' ].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('');
    return `<article class="goal-card ${g.status === 'paused' ? 'is-paused' : ''}" data-goal-id="${esc(g.id)}"><div class="goal-emoji">${esc(g.emoji || '')}</div><div class="goal-main"><strong>${esc(g.title)}</strong><span class="goal-category">${esc(g.category)}</span>${chips?`<div class="goal-component-chips">${chips}</div>`:''}</div><div class="goal-progress"><div class="goal-progress-top"><strong>${p}%</strong><button class="goal-update-btn" data-update-goal="${esc(g.id)}">Update</button></div><div class="progress-track"><i style="width:${p}%"></i></div><small>${g.components?.target?`${esc(g.unit)}${formatNumber(g.current)} / ${esc(g.unit)}${formatNumber(g.target)}`:'Component progress'}</small></div><div class="goal-date">${icon('calendar')}<span>${formatDate(g.date)}</span><b>${left === null ? 'No deadline' : left >= 0 ? left + ' days left' : 'Past due'}</b></div><button class="dots-btn goal-dots" data-menu="goal:${esc(g.id)}" aria-label="Goal actions">${icon('dots')}</button></article>`; }).join('') || `<div class="empty-state"><strong>No goals here yet.</strong><span>Try another filter or add a new goal.</span></div>`;
  bindGoalInteractions(root);
}
function goalProgressForm(id) {
  const g = state.goals.find(x => x.id === id); if (!g) return;
  if(g.type==='fitness'){ fitnessDashboard(id); return; }
  const unit = String(g.unit || ''), current = Math.max(0, Number(g.current) || 0), target = Math.max(1, Number(g.target) || 1);
  modal('Update goal progress', 'Change your progress without editing the goal itself.', `<form class="form" id="goalProgressForm"><div class="progress-edit-hero"><div class="goal-emoji">${esc(g.emoji || '🎯')}</div><div><strong>${esc(g.title)}</strong><small>${esc(g.category)} · Target ${esc(unit)}${formatNumber(target)}</small></div></div><div class="field"><label>Current progress <span>*</span></label><div class="goal-progress-input"><span>${esc(unit)}</span><input id="goalCurrentInput" name="current" type="number" min="0" max="${target}" step="any" required value="${current}"></div></div><div class="quick-progress"><span>Quick add</span><div>${[1,5,10].map(step=>`<button type="button" data-goal-step="${step}">+${step}</button>`).join('')}</div></div><div class="goal-live-preview"><span>New progress</span><strong id="goalProgressPreview">${goalPct(g)}%</strong><small id="goalProgressValue">${esc(unit)}${formatNumber(current)} / ${esc(unit)}${formatNumber(target)}</small></div><div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn">Update Goal →</button></div></form>`);
  const form=document.getElementById('goalProgressForm'),input=document.getElementById('goalCurrentInput'),preview=document.getElementById('goalProgressPreview'),value=document.getElementById('goalProgressValue'); const updatePreview=()=>{const n=Math.min(target,Math.max(0,Number(input.value)||0));preview.textContent=Math.min(100,Math.round(n/target*100))+'%';value.textContent=`${unit}${formatNumber(n)} / ${unit}${formatNumber(target)}`}; input.addEventListener('input',updatePreview); form.querySelectorAll('[data-goal-step]').forEach(b=>b.addEventListener('click',()=>{input.value=Math.min(target,(Number(input.value)||0)+Number(b.dataset.goalStep));updatePreview()})); form.addEventListener('submit',e=>{e.preventDefault();const n=Math.min(target,Math.max(0,Number(input.value)||0));g.current=n;g.status=n>=target?'completed':(g.status==='paused'?'paused':'active');g.updatedAt=new Date().toISOString();save();closeModal();render();toast(n>=target?'Goal completed ✓':'Goal progress updated')});
}
function calendarPage() { return shell('calendar', `<div class="page-title calendar-title"><h1>Calendar</h1><p>View your habits and goals activity.</p></div><div class="calendar-actions"><div class="segmented" id="calModes"><button class="active" data-mode="month">Month</button><button data-mode="week">Week</button><button data-mode="day">Day</button></div><button class="primary-btn" data-add-event>+ Add Event</button></div><section class="calendar-layout"><article class="panel calendar-panel"><div class="calendar-toolbar"><button class="month-selector" id="monthTitle">August 2026 ${icon('chevron')}</button><div class="calendar-nav"><button id="calPrev" aria-label="Previous month">${icon('left')}</button><button id="calToday">Today</button><button id="calNext" aria-label="Next month">${icon('right')}</button></div><div id="monthPicker" class="month-picker hidden"></div></div><div id="calendarBody"></div></article><aside class="calendar-side"><article class="panel day-summary" id="dayDetail"></article><article class="panel calendar-overview" id="reminderOverview"><div class="reminder-overview-head"><div><h2>Reminder Overview</h2><p>Events and habit reminders in one place.</p></div></div><div id="calendarReminderList"></div></article></aside></section>`); }

function pctForDate(d) { return calendarPercentForDay(d); }
function dateISO(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString().slice(0, 10); }
function snapshotForDate(date) { const iso = typeof date === 'string' ? date : dateISO(date); return state.activityHistory?.[iso] || null; }
function dailyProgress(date) { const snap = snapshotForDate(date); if (!snap || !snap.habits.length) return 0; const active = snap.habits.filter(h => !h.paused); if (!active.length) return 0; return Math.round(active.reduce((a, h) => a + Math.max(0, Math.min(100, Number(h.percent) || 0)), 0) / active.length); }
function dailyCounts(date) { const snap = snapshotForDate(date); if (!snap || !snap.habits.length) return { completed: 0, partial: 0, notDone: 0, total: 0 }; const active = snap.habits.filter(h => !h.paused), completed = active.filter(h => h.percent >= 100).length, partial = active.filter(h => h.percent > 0 && h.percent < 100).length; return { completed, partial, notDone: Math.max(0, active.length - completed - partial), total: active.length }; }
function weekStartIndex() { return (state.settings?.habits?.weekStarts || 'Sunday') === 'Monday' ? 1 : 0; }
function weekBounds(cursor) { const start = new Date(cursor); start.setHours(12, 0, 0, 0); const offset = (start.getDay() - weekStartIndex() + 7) % 7; start.setDate(start.getDate() - offset); return { start, days: Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; }) }; } function weekView(cursor) { const { days } = weekBounds(cursor); let out = '<div class="week-grid">';['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((n, i) => { const d = days[i], iso = dateISO(d), p = calendarPercentForDay(d), sel = iso === calendarSelectedDate; out += `<button class="week-day ${sel ? 'selected' : ''} ${p >= 100 ? 'is-complete' : ''} ${p === 0 ? 'is-empty' : ''}" data-cal-date="${iso}"><strong>${n}</strong><span class="day-number">${d.getDate()}</span>${calendarRingMarkup(p, 'week-ring')}<span class="week-percent">${p ? p + '%' : ''}</span><div class="progress-track"><i style="width:${p}%"></i></div></button>` }); return out + '</div>'; }
function dayView(cursor) { const iso = dateISO(cursor), p = pctForDate(cursor), items = state.events.filter(e => e.date === iso), habits = calendarHabitsForDay(cursor); return `<div class="day-view"><div class="day-focus"><div class="focus-date">Selected day</div><div class="focus-title-row"><h3>${cursor.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h3><strong>${p}%</strong></div><div class="progress-line"><i style="width:${p}%"></i></div><div class="day-habit-list">${habits.map(x => `<div class="detail-item"><span class="item-emoji">${esc(x.habit.emoji || '')}</span><span>${esc(x.habit.name)}</span><small>${x.percent}%</small></div>`).join('') || '<p class="muted-copy">No recorded habit activity for this date.</p>'}${items.map(e => `<div class="detail-item"><span class="item-emoji">${esc(e.emoji || '📅')}</span><span>${esc(e.title)}</span><small>${esc(formatTime(e.time))}</small><button class="icon-delete" data-edit-event="${e.id}" aria-label="Edit event">${icon('edit')}</button><button class="icon-delete" data-delete-event="${e.id}" aria-label="Delete event">${icon('trash')}</button></div>`).join('')}</div></div></div>`; }
function initCalendar() { let cursor = new Date(calendarSelectedDate + 'T12:00:00'); if (Number.isNaN(cursor.getTime())) { cursor = new Date(); cursor.setHours(12, 0, 0, 0); } let mode = 'month'; const root = document.querySelector('.page-calendar'); if (!root) return; const body = root.querySelector('#calendarBody'), title = root.querySelector('#monthTitle'), picker = root.querySelector('#monthPicker'); function rebuildPicker() { picker.innerHTML = ''; picker.classList.remove('picker-months', 'picker-weeks', 'picker-days'); if (mode === 'month') { picker.classList.add('picker-months'); for (let i = -6; i <= 6; i++) { const d = new Date(cursor.getFullYear(), cursor.getMonth() + i, 1, 12), b = document.createElement('button'); b.type = 'button'; b.textContent = monthLabel(d); if (d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear()) b.classList.add('active'); b.addEventListener('click', () => { cursor = d; calendarSelectedDate = dateISO(d); picker.classList.add('hidden'); renderCal(); }); picker.appendChild(b); } } else if (mode === 'week') { picker.classList.add('picker-weeks'); const y = cursor.getFullYear(), m = cursor.getMonth(), daysInMonth = new Date(y, m + 1, 0).getDate(), first = (new Date(y, m, 1, 12).getDay() - weekStartIndex() + 7) % 7, weekCount = Math.ceil((first + daysInMonth) / 7); for (let w = 1; w <= weekCount; w++) { const startDay = (w - 1) * 7 - first + 1, firstDay = Math.max(1, startDay), lastDay = Math.min(daysInMonth, startDay + 6), b = document.createElement('button'); b.type = 'button'; b.textContent = `Week ${w} · ${firstDay}–${lastDay}`; const currentWeek = Math.floor((first + cursor.getDate() - 1) / 7) + 1; if (w === currentWeek) b.classList.add('active'); b.addEventListener('click', () => { cursor = new Date(y, m, firstDay, 12); calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); renderCal(); }); picker.appendChild(b); } } else { picker.classList.add('picker-days'); const y = cursor.getFullYear(), m = cursor.getMonth(), days = new Date(y, m + 1, 0).getDate(); for (let n = 1; n <= days; n++) { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${n} · ${new Date(y, m, n, 12).toLocaleDateString('en-IN', { weekday: 'short' })}`; if (n === cursor.getDate()) b.classList.add('active'); b.addEventListener('click', () => { cursor = new Date(y, m, n, 12); calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); renderCal(); }); picker.appendChild(b); } } } function renderCal() { title.innerHTML = `${monthLabel(cursor)} ${icon('chevron')}`; body.innerHTML = calendarGrid(cursor, mode); root.querySelectorAll('[data-cal-date]').forEach(b => b.addEventListener('click', () => { cursor = new Date(b.dataset.calDate + 'T12:00:00'); calendarSelectedDate = b.dataset.calDate; renderCal(); })); root.querySelectorAll('[data-edit-event]').forEach(b => b.addEventListener('click', () => eventForm(b.dataset.editEvent)));
    root.querySelectorAll('[data-delete-event]').forEach(b => b.addEventListener('click', () => { const e = state.events.find(x => x.id === b.dataset.deleteEvent); if (!e) return; state.events = state.events.filter(x => x.id !== e.id); const linked = state.reminders.filter(r => r.eventId === e.id); state.reminders = state.reminders.filter(r => r.eventId !== e.id); state.syncMeta = state.syncMeta || clone(defaultState.syncMeta); state.syncMeta.deleted = state.syncMeta.deleted || clone(defaultState.syncMeta.deleted); state.syncMeta.deleted.events = state.syncMeta.deleted.events || {}; state.syncMeta.deleted.events[e.id] = new Date().toISOString(); state.syncMeta.deleted.reminders = state.syncMeta.deleted.reminders || {}; linked.forEach(r => state.syncMeta.deleted.reminders[r.id] = new Date().toISOString()); save(); renderCal(); })); renderDetail(); } function renderDetail() { const d = dateISO(cursor), dayHabits = calendarHabitsForDay(cursor), p = dailyProgress(d), items = state.events.filter(e => e.date === d); root.querySelector('#dayDetail').innerHTML = `<div class="detail-kicker">Selected day</div><div class="detail-title">${cursor.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div><div class="daily-progress"><span>Daily progress</span><strong>${p}%</strong></div><div class="progress-line"><i style="width:${p}%"></i></div><div class="detail-items">${dayHabits.map(x => `<div class="detail-item"><span class="item-emoji">${esc(x.habit.emoji || '')}</span><span>${esc(x.habit.name)}</span><small>${x.percent}%</small></div>`).join('') || '<p class="muted-copy">No recorded habit activity for this date.</p>'}${items.map(e => `<div class="detail-item"><span class="item-emoji">${esc(e.emoji || '📅')}</span><span>${esc(e.title)}</span><small>${esc(formatTime(e.time))}</small><button class="icon-delete" data-edit-event="${e.id}" aria-label="Edit event">${icon('edit')}</button><button class="icon-delete" data-delete-event="${e.id}" aria-label="Delete event">${icon('trash')}</button></div>`).join('')}</div>`; const reminderList = root.querySelector('#calendarReminderList'); if (reminderList) { reminderList.innerHTML = reminderOverviewMarkup(d); root.querySelectorAll('[data-add-reminder]').forEach(b => b.addEventListener('click', () => reminderForm())); } root.querySelectorAll('[data-edit-event]').forEach(b => b.addEventListener('click', () => eventForm(b.dataset.editEvent)));
    root.querySelectorAll('[data-delete-event]').forEach(b => b.addEventListener('click', () => { const e = state.events.find(x => x.id === b.dataset.deleteEvent); if (!e) return; state.events = state.events.filter(x => x.id !== e.id); const linked = state.reminders.filter(r => r.eventId === e.id); state.reminders = state.reminders.filter(r => r.eventId !== e.id); state.syncMeta = state.syncMeta || clone(defaultState.syncMeta); state.syncMeta.deleted = state.syncMeta.deleted || clone(defaultState.syncMeta.deleted); state.syncMeta.deleted.events = state.syncMeta.deleted.events || {}; state.syncMeta.deleted.events[e.id] = new Date().toISOString(); state.syncMeta.deleted.reminders = state.syncMeta.deleted.reminders || {}; linked.forEach(r => state.syncMeta.deleted.reminders[r.id] = new Date().toISOString()); save(); renderCal(); })); root.querySelectorAll('[data-edit-reminder]').forEach(b => b.addEventListener('click', () => reminderForm(b.dataset.editReminder))); root.querySelectorAll('[data-toggle-reminder]').forEach(b => b.addEventListener('change', () => { const r = state.reminders.find(x => x.id === b.dataset.toggleReminder); if (!r) return; r.enabled = b.checked; save(); renderCal(); toast(r.enabled ? 'Reminder enabled' : 'Reminder turned off'); })); } root.querySelectorAll('#calModes button').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; root.querySelectorAll('#calModes button').forEach(x => x.classList.toggle('active', x === b)); picker.classList.add('hidden'); rebuildPicker(); renderCal(); })); root.querySelector('#calPrev').addEventListener('click', () => { if (mode === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, Math.min(cursor.getDate(), 28), 12); else if (mode === 'week') { cursor = new Date(cursor); cursor.setDate(cursor.getDate() - 7); } else { cursor = new Date(cursor); cursor.setDate(cursor.getDate() - 1); } calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); rebuildPicker(); renderCal(); }); root.querySelector('#calNext').addEventListener('click', () => { if (mode === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, Math.min(cursor.getDate(), 28), 12); else if (mode === 'week') { cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 7); } else { cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 1); } calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); rebuildPicker(); renderCal(); }); root.querySelector('#calToday').addEventListener('click', () => { cursor = new Date(); cursor.setHours(12, 0, 0, 0); calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); rebuildPicker(); renderCal(); }); title.addEventListener('click', () => { rebuildPicker(); picker.classList.toggle('hidden'); }); calendarSelectedDate = dateISO(cursor); rebuildPicker(); renderCal(); }

function statisticsPage() { return shell('statistics', `<div class="page-title statistics-title"><h1>Statistics</h1><p>Track your progress and build better habits.</p></div><div class="statistics-controls"><div class="period-switch" id="statPeriods"><button class="active" data-period="day">Day</button><button data-period="week">Week</button><button data-period="month">Month</button><button data-period="custom">Custom Range</button></div><div class="stat-date">${icon('calendar')}<span id="statDate"></span></div><button class="export-btn" id="exportStats">${icon('download')} Export</button></div><section class="kpi-grid" id="statKpis"></section><section class="statistics-grid"><article class="panel trend-panel"><div class="panel-title-row"><h2>Completion Trend</h2><select id="chartMode"><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="custom">Custom</option></select></div><div id="trendChart" class="trend-chart"></div><div class="trend-legend"><span><i></i> Completion</span><span id="trendCaption">Recorded activity</span></div></article><article class="panel performers"><h2>Top Performers</h2><div id="topPerformers"></div></article></section><section class="panel categories-panel"><h2>Habit Categories</h2><div id="categories" class="categories-grid"></div></section>`); }
function customRangeForm(apply) { modal('Custom range', 'Choose the period used by Statistics.', `<form class="form" id="rangeForm"><div class="form-grid"><div class="field"><label>Start date</label><input type="date" name="start" value="${todayISO()}" required></div><div class="field"><label>End date</label><input type="date" name="end" value="${todayISO()}" required></div></div><div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn">Apply range →</button></div></form>`); document.getElementById('rangeForm').addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.target), s = fd.get('start'), en = fd.get('end'); if (s > en) { toast('End date must be after the start date'); return; } apply(s, en); closeModal(); }); }
function dateRange(start, end) { const out = []; let d = new Date(start + 'T12:00:00'), last = new Date(end + 'T12:00:00'); while (d <= last) { out.push(new Date(d)); d.setDate(d.getDate() + 1); } return out; }
function weeklyActivityData(anchor) { const b = weekBounds(anchor); return b.days.map(d => { const iso = dateISO(d), future = iso > todayISO(), has = !!state.activityHistory?.[iso]; return { date: iso, label: d.toLocaleDateString('en-IN', { weekday: 'short' }), value: (!future && has) ? dailyProgress(iso) : null }; }); }
function recordedDates() { return Object.keys(state.activityHistory || {}).filter(d => d <= todayISO()).sort(); } function currentStreak() { let n = 0, d = new Date(todayISO() + 'T12:00:00'); while (true) { const iso = dateISO(d); if (!state.activityHistory?.[iso] || dailyProgress(iso) <= 0) break; n++; d.setDate(d.getDate() - 1); } return n; } function bestStreak() { let best = 0, run = 0, last = null; for (const iso of recordedDates()) { if (last) { const gap = (new Date(iso + 'T12:00:00') - new Date(last + 'T12:00:00')) / 86400000; if (gap > 1) run = 0; } if (dailyProgress(iso) > 0) { run++; best = Math.max(best, run); } else run = 0; last = iso; } return best; }
function rangeRecordedPoints(start, end) { return dateRange(start, end).map(d => { const iso = dateISO(d); return state.activityHistory?.[iso] ? { date: iso, value: dailyProgress(iso) } : null; }).filter(Boolean); }
function trendSeries(period, custom) { const today = new Date(todayISO() + 'T12:00:00'); if (period === 'day') return weeklyActivityData(today).map(x => ({ label: x.label, value: x.value })); if (period === 'week') { const out = []; for (let i = 5; i >= 0; i--) { const end = new Date(today); end.setDate(today.getDate() - i * 7); const start = new Date(end); start.setDate(end.getDate() - 6); const pts = rangeRecordedPoints(dateISO(start), dateISO(end)); out.push({ label: `W${6 - i}`, value: pts.length ? Math.round(pts.reduce((a, p) => a + p.value, 0) / pts.length) : null }); } return out; } if (period === 'month') { const out = []; for (let i = 5; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth() - i, 1, 12), end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12), pts = rangeRecordedPoints(dateISO(d), dateISO(end)); out.push({ label: d.toLocaleDateString('en-IN', { month: 'short' }), value: pts.length ? Math.round(pts.reduce((a, p) => a + p.value, 0) / pts.length) : null }); } return out; } const dates = dateRange(custom.s, custom.e); if (dates.length <= 7) return dates.map(d => { const iso = dateISO(d); return { label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), value: state.activityHistory?.[iso] ? dailyProgress(iso) : null }; }); const bucket = Math.ceil(dates.length / 7), out = []; for (let i = 0; i < 7; i++) { const chunk = dates.slice(i * bucket, (i + 1) * bucket), pts = chunk.map(d => { const iso = dateISO(d); return state.activityHistory?.[iso] ? dailyProgress(iso) : null; }).filter(v => v !== null); out.push({ label: chunk[0]?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) || '', value: pts.length ? Math.round(pts.reduce((a, v) => a + v, 0) / pts.length) : null }); } return out; }
function initStatistics() {
  let period = 'day', custom = { s: todayISO(), e: todayISO() }; const root = document.querySelector('.page-statistics'); if (!root) return; function setDateLabel() { const el = root.querySelector('#statDate'); if (period === 'day') el.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); else if (period === 'week') { const b = weekBounds(new Date()); el.textContent = `${formatDate(dateISO(b.start))} – ${formatDate(dateISO(b.days[6]))}`; } else if (period === 'month') el.textContent = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); else el.textContent = `${formatDate(custom.s)} – ${formatDate(custom.e)}`; }
  function draw() { const vals = trendSeries(period, custom), w = 760, h = 300, p = { l: 58, r: 18, t: 24, b: 52 }, step = (w - p.l - p.r) / Math.max(1, vals.length - 1), x = i => p.l + i * step, y = v => p.t + (100 - v) * (h - p.t - p.b) / 100, pts = vals.map((v, i) => v.value === null ? null : [x(i), y(v.value)]), axis = [0, 25, 50, 75, 100].map(v => `<line x1="${p.l}" x2="${w - p.r}" y1="${y(v)}" y2="${y(v)}" stroke="#eee9f1"/><text class="chart-axis-label" x="${p.l - 10}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join(''); let seg = [], lines = [], areas = []; const flush = () => { if (!seg.length) return; lines.push(`<polyline points="${seg.map(q => q.join(' ')).join(' ')}" fill="none" stroke="#9b63d8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`); if (seg.length > 1) { const a = seg[0], b = seg[seg.length - 1]; areas.push(`<path d="M ${a[0]} ${h - p.b} L ${seg.map(q => q.join(' L '))} L ${b[0]} ${h - p.b} Z" fill="#9b63d8" fill-opacity=".055"/>`); } seg = []; }; pts.forEach(pt => pt ? seg.push(pt) : flush()); flush(); const marks = vals.map((v, i) => pts[i] ? `<circle class="chart-point" tabindex="0" data-index="${i}" cx="${pts[i][0]}" cy="${pts[i][1]}" r="4" fill="#fff" stroke="#9b63d8" stroke-width="2"/><text class="chart-x-label" x="${pts[i][0]}" y="${h - 16}" text-anchor="middle">${esc(v.label)}</text>` : '').join(''); root.querySelector('#trendChart').innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Recorded Habitly completion trend">${axis}${areas.join('')}${lines.join('')}${marks}</svg>`; root.querySelectorAll('.chart-point').forEach(pt => { const show = () => { root.querySelectorAll('.chart-point').forEach(x => x.classList.remove('selected')); pt.classList.add('selected'); const v = vals[Number(pt.dataset.index)]; root.querySelector('#trendCaption').textContent = `${v.label}: ${v.value}%`; }; pt.addEventListener('mouseenter', show); pt.addEventListener('focus', show); pt.addEventListener('touchstart', show, { passive: true }); pt.addEventListener('click', show); }); root.querySelector('#trendCaption').textContent = 'Recorded activity'; setDateLabel(); }
  function updateKpis() { const dates = period === 'day' ? [todayISO()] : period === 'week' ? weeklyActivityData(new Date()).filter(x => x.value !== null).map(x => x.date) : period === 'month' ? dateRange(new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-01', todayISO()).map(dateISO) : dateRange(custom.s, custom.e).map(dateISO), snaps = dates.map(d => state.activityHistory?.[d]).filter(Boolean), values = snaps.flatMap(s => s.habits.filter(h => !h.paused).map(h => h.percent)), overall = values.length ? Math.round(values.reduce((a, v) => a + v, 0) / values.length) : 0, completed = values.filter(v => v >= 100).length, missed = values.filter(v => v === 0).length, total = values.length; root.querySelector('#statKpis').innerHTML = `<article class="kpi"><div class="kpi-top"><div class="kpi-icon target">🎯</div><div class="kpi-label">Overall Completion</div></div><div class="kpi-value">${overall}%</div><div class="kpi-foot">Recorded activity</div></article><article class="kpi"><div class="kpi-top"><div class="kpi-icon complete">✓</div><div class="kpi-label">Completed</div></div><div class="kpi-value">${completed}</div><div class="kpi-foot">Fully completed activities</div></article><article class="kpi"><div class="kpi-top"><div class="kpi-icon missed">•</div><div class="kpi-label">Missed</div></div><div class="kpi-value">${missed}</div><div class="kpi-foot">Recorded at 0%</div></article><article class="kpi"><div class="kpi-top"><div class="kpi-icon activities">📊</div><div class="kpi-label">Total Activities</div></div><div class="kpi-value">${total}</div><div class="kpi-foot">Recorded habit-days</div></article><article class="kpi"><div class="kpi-top"><div class="kpi-icon streak">🔥</div><div class="kpi-label">Current Streak</div></div><div class="kpi-value">${currentStreak()} <span>days</span></div><div class="kpi-foot">Best: ${bestStreak()} days</div></article>`; const latest = state.habits.map(h => ({ h, p: pct(h) })).sort((a, b) => b.p - a.p).slice(0, 5); root.querySelector('#topPerformers').innerHTML = latest.map((x, i) => `<div class="rank"><span class="rank-num">${i + 1}</span><span class="rank-name">${esc(x.h.emoji || '')} ${esc(x.h.name)}</span><div class="rank-bar"><i style="width:${x.p}%"></i></div><strong>${x.p}%</strong></div>`).join('') || '<p class="muted-copy">No habits yet.</p>'; const groups = { Health: ['💚', 'Health'], Fitness: ['🏋️', 'Fitness'], Study: ['📚', 'Productivity'], Personal: ['🌱', 'Personal Growth'], Mindfulness: ['🧘', 'Mindfulness'], Education: ['🎓', 'Learning'] }; root.querySelector('#categories').innerHTML = Object.entries(groups).map(([key, [em, name]]) => { const hs = state.habits.filter(h => h.category === key), v = hs.length ? Math.round(hs.reduce((a, h) => a + pct(h), 0) / hs.length) : 0; return `<div class="cat"><div class="cat-top"><div class="cat-icon">${em}</div><strong>${v}%</strong></div><div class="cat-name">${name}</div><div class="cat-meta">${hs.length} habit${hs.length === 1 ? '' : 's'}</div></div>`; }).join(''); }
  function applyPeriod(next) { period = next; root.querySelectorAll('[data-period]').forEach(x => x.classList.toggle('active', x.dataset.period === period)); root.querySelector('#chartMode').value = period; updateKpis(); draw(); }
  root.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => { if (b.dataset.period === 'custom') customRangeForm((s, e) => { custom = { s, e }; applyPeriod('custom'); }); else applyPeriod(b.dataset.period); })); root.querySelector('#chartMode').addEventListener('change', e => { if (e.target.value === 'custom') customRangeForm((s, en) => { custom = { s, en }; applyPeriod('custom'); }); else applyPeriod(e.target.value); }); root.querySelector('#exportStats').addEventListener('click', () => { const payload = { exportedAt: new Date().toISOString(), period, customRange: period === 'custom' ? custom : null, activityHistory: state.activityHistory, habits: state.habits, goals: state.goals, events: state.events }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `habitly-statistics-${todayISO()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Statistics exported'); }); updateKpis(); draw();
}

function menuPopover(kind, id) { document.querySelectorAll('.menu-popover').forEach(x => x.remove()); const isGoal = kind === 'goal', habit = !isGoal ? state.habits.find(h => h.id === id) : null, hasReminder = habit ? state.reminders.some(r => r.habitId === id && r.source === 'manual') : false, items = isGoal ? [['update', 'Update progress'], ['edit', 'Edit goal'], ['pause', 'Pause goal'], ['complete', 'Mark complete'], ['trash', 'Delete goal']] : [['edit', 'Edit habit'], ['reminder', hasReminder ? 'Edit reminder' : 'Set reminder'], ['pause', habit?.paused ? 'Resume habit' : 'Pause habit'], ['trash', 'Delete habit']]; const menu = document.createElement('div'); menu.className = 'menu-popover'; menu.dataset.kind = kind; menu.innerHTML = items.map(([i, t]) => `<button data-menu-action="${i}" data-menu-id="${id}">${icon(i === 'reminder' ? 'bell' : i)}<span>${t}</span></button>`).join(''); const anchor = document.querySelector(`[data-menu="${kind}:${id}"]`); if (!anchor) return; anchor.closest('article').appendChild(menu); const rect = anchor.getBoundingClientRect(); const card = anchor.closest('article').getBoundingClientRect(); menu.style.top = `${Math.min(anchor.offsetTop + 38, card.height - menu.offsetHeight - 10)}px`; menu.style.right = '8px'; }
function bindHabitInteractions(root) {
  root.querySelectorAll('[data-habit-action]').forEach(b => {
    let holdTimer = null, repeatTimer = null, holding = false, wasHeld = false;
    const updateRowVisual = (h, row) => {
      if (!row) return;
      const current = Math.max(0, Number(h.current) || 0);
      const target = Math.max(1, Number(h.target) || 1);
      const percent = Math.min(100, Math.round(current / target * 100));
      const value = row.querySelector('.qty-value');
      const bar = row.querySelector('.progress-track i');
      const pctEl = row.querySelector('.percent');
      if (value) value.textContent = `${current} / ${target} ${h.unit || 'times'}`;
      if (bar) bar.style.width = `${percent}%`;
      if (pctEl) pctEl.textContent = `${percent}%`;
      const complete = row.querySelector('[data-habit-action="complete"]');
      if (complete) {
        const done = percent >= 100;
        complete.disabled = !done;
        complete.classList.toggle('done', done);
        complete.innerHTML = `<img src="${done ? AS + 'Habitly Leaf White.png' : AS + 'Habitly Leaf Transparent.png'}" alt="${done ? 'Completed' : 'Not complete'}">`;
      }
    };
    const applyAction = (action, amount = 1, shouldRender = true) => {
      const row = b.closest('.habit-row');
      const h = state.habits.find(x => x.id === row?.dataset.id);
      if (!h || h.paused) return;
      if (action === 'plus') h.current = Math.min(Math.max(1, Number(h.target) || 1), (Number(h.current) || 0) + amount);
      if (action === 'minus') h.current = Math.max(0, (Number(h.current) || 0) - amount);
      if (action === 'complete' && pct(h) >= 100) h.current = Math.max(1, Number(h.target) || 1);
      if (action === 'yes') h.current = 1;
      if (action === 'no') h.current = 0;
      h.daily = h.daily || {};
      h.daily[todayISO()] = h.current;
      h.dailyUpdatedAt = h.dailyUpdatedAt || {};
      h.dailyUpdatedAt[todayISO()] = new Date().toISOString();
      save();
      if (shouldRender) render();
      else updateRowVisual(h, row);
    };
    const action = b.dataset.habitAction;
    const startHold = e => {
      if (action !== 'plus' && action !== 'minus') return;
      if (e.type === 'mousedown' && e.button !== 0) return;
      holding = true;
      wasHeld = false;
      clearTimeout(holdTimer); clearInterval(repeatTimer);
      holdTimer = setTimeout(() => {
        if (!holding) return;
        wasHeld = true;
        let amount = 5;
        let interval = 180;
        // Accelerate long-press input for large targets such as 100 pages.
        applyAction(action, amount, false);
        repeatTimer = setInterval(() => {
          if (!holding) return;
          applyAction(action, amount, false);
          if (amount === 5) {
            amount = 10;
            interval = 140;
            clearInterval(repeatTimer);
            repeatTimer = setInterval(() => {
              if (holding) applyAction(action, 10, false);
            }, interval);
          }
        }, interval);
      }, 450);
    };
    const stopHold = () => {
      holding = false;
      clearTimeout(holdTimer);
      clearInterval(repeatTimer);
      holdTimer = null;
      repeatTimer = null;
      // The pointerup is followed by a click on most browsers. Keep the flag
      // until that click arrives so a long press cannot add one extra unit;
      // the click handler consumes it instead of adding another unit.
    };
    b.addEventListener('click', e => {
      if (wasHeld) { e.preventDefault(); e.stopPropagation(); wasHeld = false; return; }
      applyAction(action, 1, true);
    });
    b.addEventListener('pointerdown', startHold);
    b.addEventListener('pointerup', stopHold);
    b.addEventListener('pointercancel', stopHold);
    b.addEventListener('pointerleave', stopHold);
  });
  root.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); menuPopover('habit', b.dataset.menu.split(':')[1]); }));
}
function bindHabitPage() { document.querySelectorAll('[data-habit-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-habit-filter]').forEach(x => x.classList.toggle('active', x === b)); renderHabitCards(b.dataset.habitFilter, document.getElementById('habitSort').value); })); document.getElementById('habitSort').addEventListener('change', e => { const active = document.querySelector('[data-habit-filter].active')?.dataset.habitFilter || 'all'; renderHabitCards(active, e.target.value); }); }
function bindGoalInteractions(root) { root.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); menuPopover('goal', b.dataset.menu.split(':')[1]); })); root.querySelectorAll('[data-update-goal]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); goalProgressForm(b.dataset.updateGoal); })); root.querySelectorAll('[data-fitness-goal]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); fitnessDashboard(b.dataset.fitnessGoal); })); }
function bindGoalPage() { document.querySelectorAll('[data-goal-filter]').forEach(b => b.addEventListener('click', () => { const f = b.dataset.goalFilter; if (!f) return; document.querySelectorAll('[data-goal-filter]').forEach(x => x.classList.toggle('active', x === b)); renderGoals(f); })); }



function monthLabel(d) { return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); }
function calendarRingMarkup(p, cls = 'day-ring') {
  const value = Math.max(0, Math.min(100, Number(p) || 0));
  if (value <= 0) return `<span class="${cls} empty" aria-label="No recorded activity"></span>`;
  if (value >= 100) return `<span class="${cls} complete-leaf" aria-label="100% complete"><img src="${AS}Habitly Leaf White.png" alt="Completed"></span>`;
  const r = 16, c = 2 * Math.PI * r, dash = value / 100 * c;
  return `<span class="${cls} partial" aria-label="${value}% complete"><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="ring-track" cx="20" cy="20" r="${r}"></circle><circle class="ring-value" cx="20" cy="20" r="${r}" style="stroke-dasharray:${dash} ${c - dash}"></circle></svg></span>`;
}
function calendarHabitsForDay(d) {
  const iso = dateISO(d);
  const snap = snapshotForDate(iso);
  if (!snap) return [];
  return snap.habits.map(h => ({ habit: state.habits.find(x => x.id === h.id) || h, percent: Math.max(0, Math.min(100, Number(h.percent) || 0)), current: h.current, target: h.target, unit: h.unit }));
}
function calendarDailyProgress(d) { return dailyProgress(dateISO(d)); }
function calendarPercentForDay(d) { return calendarDailyProgress(d); }
function calendarGrid(cursor, mode) { if (mode === 'week') return weekView(cursor); if (mode === 'day') return dayView(cursor); return monthView(cursor); }
function monthView(cursor) {
  const y = cursor.getFullYear(), m = cursor.getMonth(), firstDay = new Date(y, m, 1, 12).getDay(), days = new Date(y, m + 1, 0).getDate();
  const start = weekStartIndex();
  const first = (firstDay - start + 7) % 7;
  let out = '<div class="calendar-grid">';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  names.slice(start).concat(names.slice(0, start)).forEach(x => out += `<div class="weekday">${x}</div>`);
  let cells = 0;
  const prevDays = new Date(y, m, 0, 12).getDate();
  for (let i = 0; i < first; i++) { out += `<div class="cal-day muted"><span class="day-number">${prevDays - first + i + 1}</span></div>`; cells++; }
  for (let n = 1; n <= days; n++) {
    const d = new Date(y, m, n, 12), iso = dateISO(d), p = calendarPercentForDay(d), sel = iso === calendarSelectedDate, today = iso === todayISO();
    out += `<button class="cal-day ${sel ? 'selected' : ''} ${today ? 'today' : ''} ${p >= 100 ? 'is-complete' : ''} ${p === 0 ? 'is-empty' : ''}" data-cal-date="${iso}"><span class="day-number">${n}</span>${calendarRingMarkup(p)}<span class="day-percent">${p ? p + '%' : ''}</span></button>`;
    cells++;
  }
  while (cells % 7) { out += '<div class="cal-day muted"></div>'; cells++; }
  return out + '</div>';
}
function weekView(cursor) {
  const { start } = weekBounds(cursor);
  let out = '<div class="week-grid">';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const offset = weekStartIndex();
  names.slice(offset).concat(names.slice(0, offset)).forEach((n, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); const iso = dateISO(d), p = calendarPercentForDay(d), sel = iso === calendarSelectedDate;
    out += `<button class="week-day ${sel ? 'selected' : ''} ${p >= 100 ? 'is-complete' : ''} ${p === 0 ? 'is-empty' : ''}" data-cal-date="${iso}"><strong>${n}</strong><span class="day-number">${d.getDate()}</span>${calendarRingMarkup(p, 'week-ring')}<span class="week-percent">${p ? p + '%' : ''}</span><div class="progress-track"><i style="width:${p}%"></i></div></button>`;
  });
  return out + '</div>';
}

function storageModeLabel(mode) { return 'This device + Cloud sync'; }
function storageIsConfigured() { return !!currentAuthUser && (state.settings?.storage?.setupCompleted !== false); }
function accountStorageMode() {
  // Supabase is the authoritative cross-device source for authenticated users.
  // Google Drive is backup/restore only; a local-only account mode is no longer exposed.
  return 'cloud';
}
function storageMode() { return accountStorageMode(); }
function backupStatusText(d) {
  if (!d?.connected) return 'Connect Google Drive to start cloud backups.';
  const pending = pendingMutations(state).length > 0 || Object.values(state.syncMeta?.pending || {}).some(Boolean);
  if (d.autoDaily === false) return pending ? 'Automatic backup is off · cloud sync remains active.' : 'Automatic backup is off · your cloud data is still synchronized.';
  if (pending) return googleDriveBusy ? 'Syncing your latest changes…' : 'Changes waiting to sync…';
  const backupStamp = d.lastBackupAt || '';
  const backupDay = backupStamp ? dateISO(new Date(backupStamp)) : (d.lastBackupDate || '');
  if (backupDay === todayISO()) return `Synced today · ${formatBackupTime(backupStamp)}`;
  if (backupDay) return `Last synced · ${formatBackupTime(backupStamp)}`;
  return 'Waiting for your first automatic backup.';
}
function showStorageOnboarding() {
  if (!currentAuthUser || storageIsConfigured() || storageOnboardingBusy) return;
  modal('Cloud sync', 'Habitly uses Supabase as the authoritative cross-device data source. Google Drive is optional and is used only for backup/restore.', `<div class="storage-choice-grid">
    <button class="storage-choice selected" type="button" data-storage-choice="cloud"><span class="storage-choice-icon">${icon('cloud')}</span><span><b>This device + Cloud sync</b><small>Your data is stored locally for fast UI updates and synchronized through your authenticated Supabase account. Google Drive remains an optional backup.</small></span><strong>Active</strong></button>
  </div>`);
  document.querySelectorAll('[data-storage-choice]').forEach(b => b.addEventListener('click', () => chooseStorage('cloud')));
}
async function chooseStorage(mode) {
  if (storageOnboardingBusy || mode !== 'cloud') return;
  if (mode === 'cloud') {
    state.settings.storage = { mode: 'cloud', setupCompleted: true };
    await persistStorageChoice('cloud');
    await initializeCloudSync();
    subscribeCloudRealtime();
    startCloudPolling();
    closeModal(); render(); toast('Cloud sync is ready'); return;
  }
  // Legacy Drive setup path retained only for existing/manual callers.
  storageOnboardingMode = mode;
  storageOnboardingBusy = true;
  const title = mode === 'both' ? 'Connect Google Drive' : 'Set up Google Drive';
  modal(title, 'Google permission is required to finish your storage setup.', `<div class="storage-progress"><div class="storage-progress-icon">${icon('cloud')}</div><h3>Connect your Google Drive</h3><p>Habitly will create or use its dedicated backup folder and finish setup before opening your dashboard.</p><div class="storage-progress-steps"><span>1. Authorize Google Drive</span><span>2. Verify access</span><span>3. Create your Habitly backup</span></div><div class="form-actions"><button class="secondary-btn" id="storageCancel">Cancel</button><button class="primary-btn" id="storageConnect">Continue with Google Drive ${icon('arrow')}</button></div></div>`);
  document.getElementById('storageCancel')?.addEventListener('click', () => { storageOnboardingMode = ''; storageOnboardingBusy = false; closeModal(); });
  document.getElementById('storageConnect')?.addEventListener('click', async () => { if (!ensureDriveClient()) { storageOnboardingBusy = false; return; } try { await requestDriveToken('consent'); } catch (_) { storageOnboardingBusy = false; } });
}
async function persistStorageChoice(mode) {
  try {
    if (window.habitlySupabase) {
      const { data, error } = await window.habitlySupabase.auth.updateUser({ data: { habitly_storage_mode: mode, habitly_storage_setup: true } });
      if (!error && data?.user) currentAuthUser = data.user;
    }
  } catch (e) { console.warn('Could not persist storage choice to account metadata:', e); }
}
async function completeStorageSetup(mode) {
  state.settings.storage = { mode, setupCompleted: true };
  await persistStorageChoice(mode);
  save({ skipDrive: true });
  if (mode === 'drive' || mode === 'both') {
    await initializeCloudSync();
    subscribeCloudRealtime();
    startCloudPolling();
  }
  storageOnboardingMode = '';
  storageOnboardingBusy = false;
  closeModal();
  render();
}
function changeStorageMode() {
  modal('Cloud sync', 'Supabase is the active cross-device data source for authenticated Habitly accounts. Google Drive is available only as an optional backup/restore layer.', `<div class="storage-choice-grid compact">
    <button class="storage-choice selected" type="button" data-change-storage="cloud"><span class="storage-choice-icon">${icon('cloud')}</span><span><b>This device + Cloud sync</b><small>Local state remains responsive, while Supabase provides the authoritative cross-device copy.</small></span><strong>Active</strong></button>
  </div>`);
  document.querySelectorAll('[data-change-storage]').forEach(b => b.addEventListener('click', async () => {
    await persistStorageChoice('cloud');
    state.settings.storage = { mode: 'cloud', setupCompleted: true };
    await initializeCloudSync(); subscribeCloudRealtime(); startCloudPolling();
    closeModal(); render(); toast('Cloud sync is active');
  }));
}

function settingsPage() {
  const s = state.settings || defaultState.settings, p = state.profile || defaultState.profile;
  return shell('settings', `<div class="settings-page-title"><div><span class="eyebrow">HABITLY SETTINGS</span><h1>Settings</h1><p>Manage your account and preferences.</p></div></div>
 <section class="settings-layout">
  <aside class="settings-nav" aria-label="Settings navigation">
   ${[['account', 'Account', 'user'], ['notifications', 'Notifications', 'bell'], ['habits', 'Habit Preferences', 'target'], ['fitness', 'Fitness Tracking', 'target'], ['security', 'Privacy & Security', 'shield'], ['data', 'Data & Backup', 'database'], ['about', 'About Habitly', 'info']].map(([k, t, i], idx) => `<button class="settings-tab ${idx === 0 ? 'active' : ''}" data-settings-tab="${k}"><span class="settings-tab-icon">${icon(i)}</span><span>${t}</span></button>`).join('')}
  </aside>
  <div class="settings-content" id="settingsContent"></div>
 </section>`);
}
function settingsSection(key) {
  const p = state.profile || defaultState.profile, s = state.settings || defaultState.settings;
  if (key === 'account') return `<article class="settings-card settings-account"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('user')}</div><div><h2>Account</h2><p>Update your personal information and profile picture.</p></div></div><form id="profileForm" class="settings-form"><div class="profile-editor"><div class="profile-avatar-wrap"><div class="profile-avatar" id="profileAvatar">${p.avatar ? `<img src="${esc(p.avatar)}" alt="Profile picture">` : `<span class="avatar-initials">${esc((p.name || 'Prem Kumar').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase() || 'PK')}</span>`}</div><label class="avatar-upload" title="Change profile picture">${icon('upload')}<input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp"></label><small>PNG, JPG or WebP · max 10 MB · crop supported</small></div><div class="settings-fields"><div class="field"><label>Full name</label><input name="name" value="${esc(p.name)}" required></div><div class="field"><label>Email address</label><input name="email" type="email" value="${esc(p.email)}" required></div></div></div><div class="settings-save-row"><button class="primary-btn">Save changes ${icon('arrow')}</button></div></form></article>
 <article class="settings-card install-app-card"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('download')}</div><div><h2>Install Habitly</h2><p>Use Habitly like an app on your phone with a home-screen icon and standalone experience.</p></div></div><div id="installAppContent"></div></article>
 <div class="settings-two-col"><article class="settings-card"><div class="settings-card-head compact"><div class="settings-heading-icon green">${icon('shield')}</div><div><h2>Account status</h2><p>Your Habitly profile is ready to use.</p></div><span class="status-pill">Good</span></div><div class="info-list"><div><span>${icon('check')}Profile information</span><b>Complete</b></div><div><span>${icon('database')}Local data</span><b>Protected</b></div></div></article><article class="settings-card about-mini"><div class="settings-brand-mark">${logo()}</div><h2>Habitly by PRK</h2><p>Build better habits. Achieve your goals. One consistent day at a time.</p></article></div>`;
  if (key === 'notifications') return `<article class="settings-card"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('bell')}</div><div><h2>Notifications</h2><p>Control habit and event reminders independently. Events always notify at their scheduled time.</p></div></div><div class="settings-options">${[['habitReminders', 'Habit reminders', 'Allow scheduled reminders for your habits.', 'bell'], ['eventReminders', 'Event reminders', 'Allow scheduled reminders for calendar events.', 'calendar'], ['motivational', 'Motivational messages', 'Receive helpful daily motivation.', 'star'], ['weekly', 'Weekly summary', 'Get a weekly progress summary.', 'chart'], ['goal', 'Goal reminders', 'Stay on track with important goals.', 'trophy']].map(([k, t, d, i]) => `<label class="settings-option"><span class="option-icon">${icon(i === 'star' ? 'plusCircle' : i)}</span><span><b>${t}</b><small>${d}</small></span><input type="checkbox" data-notify="${k}" ${s.notifications[k] !== false ? 'checked' : ''}><i class="toggle"></i></label>`).join('')}</div><div class="settings-subsection"><div class="settings-subhead"><b>Habit reminder defaults</b><small>These defaults apply when you create a new habit reminder.</small></div><div class="settings-preference-grid"><div class="field"><label>Default habit reminder time</label><input id="prefDefaultHabitTime" class="time-text-input" type="text" value="${esc(formatTimeShort(s.notifications.defaultHabitTime || '20:00:00'))}" placeholder="${userTimeFormat()==='12h'?'8:00 PM':'20:00'}" autocomplete="off"></div></div><div class="field"><label>Default habit reminder days</label><div class="reminder-day-picker settings-day-picker">${[[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri'],[6,'Sat'],[0,'Sun']].map(([v,label]) => `<label class="reminder-day"><input type="checkbox" name="defaultHabitDays" value="${v}" ${normalizeReminderDays(s.notifications.defaultHabitDays).includes(v)?'checked':''}><span>${label}</span></label>`).join('')}</div></div></div><div class="notification-permission-card"><div><b>Browser notification permission</b><small>${typeof Notification === 'undefined' ? 'Not supported by this browser.' : Notification.permission === 'granted' ? 'Allowed — Habitly can show browser notifications.' : Notification.permission === 'denied' ? 'Blocked — enable notifications in browser settings.' : 'Not enabled yet.'}</small></div><button type="button" class="secondary-btn" id="enableBrowserNotifications">${typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'Notifications enabled' : 'Enable notifications'}</button></div><div class="settings-note">Habitly uses browser notifications and the reminder service for scheduled alerts. Keep browser notifications allowed if you want reminder alerts while Habitly is open or running in the background. Event reminders default to the event time for new events, and habit reminders default to 8:00 PM every day.</div></article>`;
  if (key === 'habits') return `<article class="settings-card"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('target')}</div><div><h2>Habit Preferences</h2><p>Customize how your habits are displayed and tracked.</p></div></div><div class="settings-preference-grid"><div class="field"><label>Time format</label><select id="prefTimeFormat"><option value="12h" ${s.timeFormat !== '24h' ? 'selected' : ''}>12-hour (AM/PM)</option><option value="24h" ${s.timeFormat === '24h' ? 'selected' : ''}>24-hour</option></select></div><div class="field"><label>Default habit view</label><select id="prefDefaultView"><option>All Habits</option><option>Active</option><option>Completed</option><option>Paused</option></select></div><div class="field"><label>Week starts on</label><select id="prefWeekStart"><option>Monday</option><option>Sunday</option></select></div></div><div class="settings-options compact-options"><label class="settings-option"><span class="option-icon">${icon('check')}</span><span><b>Auto-complete at target</b><small>Mark quantity habits complete when they reach their target.</small></span><input type="checkbox" id="prefAuto" ${s.habits.autoComplete ? 'checked' : ''}><i class="toggle"></i></label><label class="settings-option"><span class="option-icon">${icon('pause')}</span><span><b>Keep streaks during pauses</b><small>Paused habits do not break an existing streak.</small></span><input type="checkbox" id="prefStreak" ${s.habits.keepStreak ? 'checked' : ''}><i class="toggle"></i></label><label class="settings-option"><span class="option-icon">${icon('plus')}</span><span><b>Show quick quantity controls</b><small>Keep plus and minus controls visible on habit cards.</small></span><input type="checkbox" id="prefQuick" ${s.habits.quickQuantity ? 'checked' : ''}><i class="toggle"></i></label></div></article>`;
  if (key === 'fitness') { const f=s.fitness||defaultState.settings.fitness; return `<article class="settings-card fitness-settings-card"><div class="settings-card-head"><div class="settings-heading-icon purple">🏋️</div><div><h2>Fitness Tracking</h2><p>Choose which optional fitness sections appear inside Fitness Goals.</p></div></div><div class="fitness-settings-list"><label class="fitness-setting-row"><span class="fitness-setting-icon">🏋️</span><span class="fitness-setting-copy"><b>Workout & strength logging</b><small>Track exercises, weight, sets, reps and personal records.</small></span><input type="checkbox" id="prefWorkoutLogging" ${f.workoutLogging?'checked':''}><span class="fitness-setting-toggle" aria-hidden="true"></span></label><label class="fitness-setting-row"><span class="fitness-setting-icon">📏</span><span class="fitness-setting-copy"><b>Body measurements</b><small>Track optional chest, waist, arms, thighs and shoulder measurements.</small></span><input type="checkbox" id="prefBodyMeasurements" ${f.bodyMeasurements?'checked':''}><span class="fitness-setting-toggle" aria-hidden="true"></span></label></div><div class="settings-note">Weight tracking, averages, progress and the main Fitness Dashboard are always available. These advanced sections are off by default.</div></article>`; }
  if (key === 'security') return `<article class="settings-card"><div class="settings-card-head"><div class="settings-heading-icon blue">${icon('shield')}</div><div><h2>Privacy & Security</h2><p>Protect your account and control access to your local Habitly data.</p></div></div><div class="security-status"><span class="security-icon">${icon('shield')}</span><div><b>Local data protection</b><small>Habitly keeps a local working copy in this browser and, for cloud-enabled accounts, synchronizes through the authenticated Supabase data layer.</small></div><span class="status-pill">Active</span></div><div class="security-grid"><button class="security-action" data-security="sessions"><span>${icon('desktop')}</span><b>Active session</b><small>This browser</small></button><button class="security-action" data-security="clear"><span>${icon('trash')}</span><b>Clear local data</b><small>Requires confirmation</small></button></div><div class="settings-note">There is no server-side login or password system in this frontend, so password/2FA controls are intentionally not presented as fake functionality.</div></article>`;
  if (key === 'data') {
    const d = (state.settings?.drive) || {};
    const storage = state.settings?.storage || { mode: 'local', setupCompleted: true };
    const mode = storage.mode || 'local';
    const driveSelected = mode === 'cloud';
    const connected = !!d.connected && driveSelected;
    const status = connected ? backupStatusText(d) : '';
    return `<article class="settings-card"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('database')}</div><div><h2>Data & Backup</h2><p>Habitly keeps a local working copy for responsiveness while Supabase remains the authoritative cross-device data source. Google Drive is an optional backup and restore layer.</p></div></div>
      <div class="storage-current"><div><span class="eyebrow">CURRENT STORAGE</span><strong>This device + Cloud sync</strong><small>Supabase is the single authoritative cross-device data source. Google Drive is backup/restore only.</small></div></div>
       ${mode === 'cloud' ? `<div class="backup-status-line ${cloudSyncError ? 'waiting' : 'ready'}">${icon(cloudSyncError ? 'info' : 'check')}<span>${esc(cloudStatusText())}</span></div>` : ''}
      <div class="backup-actions"><button class="backup-card" id="exportBackup"><span>${icon('download')}</span><b>Export backup</b><small>Download your complete Habitly data as JSON.</small></button><label class="backup-card"><span>${icon('upload')}</span><b>Import backup</b><small>Restore a Habitly JSON backup from this device.</small><input id="importBackup" type="file" accept="application/json,.json"></label></div>
      ${driveSelected ? `<div class="drive-backup-card"><div class="drive-head"><div class="drive-icon">${icon('cloud')}</div><div><h3>Google Drive Backup</h3><p>Habitly keeps one rolling backup file in your Drive. It updates instead of creating daily files.</p></div><span class="drive-status ${connected ? 'connected' : ''}">${connected ? 'Connected' : 'Not connected'}</span></div><div class="drive-copy"><div><b>Habitly_Backup.json</b><small>${connected ? (d.email ? `Google account: ${esc(d.email)}` : 'Connected to Google Drive') : 'Connect Google Drive to enable cloud backup.'}</small></div><div class="drive-last"><span>Last synced</span><strong>${connected && d.lastBackupAt ? formatBackupTime(d.lastBackupAt) : 'Not backed up yet'}</strong></div></div>${connected ? `<div class="backup-status-line ${d.lastBackupDate === todayISO() ? 'ready' : 'waiting'}">${icon(d.lastBackupDate === todayISO() ? 'check' : 'info')}<span>${esc(status)}</span></div>` : ''}<div class="drive-actions"><button class="primary-btn" id="driveConnect">${icon(connected ? 'refresh' : 'cloud')}${connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button>${connected ? `<button class="secondary-btn" id="driveBackupNow">${icon('cloud')} Back up now</button><button class="secondary-btn" id="driveRestore">${icon('download')} Restore backup</button><button class="danger-btn" id="driveDisconnect">${icon('trash')} Disconnect Drive</button>` : ''}</div>${connected ? `<label class="drive-auto"><span><b>Automatic backup · ${d.autoDaily === true ? 'On' : 'Off'}</b><small>When enabled, Habitly backs up the latest acknowledged cloud state to the same Google Drive file. Drive is never used as the active sync source.</small></span><input type="checkbox" id="driveAutoDaily" ${d.autoDaily === true ? 'checked' : ''}><i class="toggle"></i></label>` : ''}<div class="settings-note drive-note">${connected ? 'Only one cloud backup is maintained. No separate daily files are created. Your profile photo is not included in the cloud JSON backup.' : 'Connect Google Drive only when you want an optional backup/restore copy of your cloud data.'}</div></div>` : `<div class="settings-note">Google Drive is optional. Connect it here when you want a durable backup/restore copy of your cloud-synchronized data.</div>`}
    </article>`;
  }
  return `<article class="settings-card about-settings"><div class="about-hero"><div class="about-logo"><img src="${AS}Habitly Leaf Transparent.png" alt="Habitly leaf logo"></div><div><span class="eyebrow">HABITLY BY PRK</span><h2>About Habitly</h2><p>Your personal habit and goal tracking companion.</p></div></div><div class="about-copy"><h3>About me</h3><p>I'm Prem Kumar, an Integrated B.Tech–M.Tech Cyber Security student focused on cloud security, secure software and practical cybersecurity engineering. I build hands-on projects to strengthen my skills in secure systems, automation and real-world application development.</p><h3>Why I created Habitly</h3><p>I created Habitly as a practical productivity application that brings habits and long-term goals into one focused workspace. It makes progress visible, measurable and editable while giving me a real-world project for building responsive interfaces, state management, persistence and user-focused software.</p></div><div class="about-links"><a href="https://github.com/prem-cybersecurity" target="_blank" rel="noopener noreferrer" aria-label="Open GitHub">${icon('github')}<span>GitHub</span></a><a href="https://premkumar-portfolio-kohl.vercel.app/" target="_blank" rel="noopener noreferrer" aria-label="Open portfolio"><span>Portfolio</span>${icon('external')}</a><a class="linkedin-link" href="https://www.linkedin.com/in/premkumar-cybersecurity" target="_blank" rel="noopener noreferrer" aria-label="Open LinkedIn">${icon('linkedin')}<span>LinkedIn</span></a></div><small class="version-line">Habitly by PRK · Version ${APP_VERSION}</small></article>`;
}
function driveSettings() { if (!state.settings) state.settings = clone(defaultState.settings); if (!state.settings.drive) state.settings.drive = clone(defaultState.settings.drive); return state.settings.drive; }
function formatBackupTime(v) { try { return new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: userTimeFormat() !== '24h' }); } catch (e) { return 'Not backed up yet'; } }
function driveClientReady() { return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2; }
function ensureDriveClient() {
  if (!driveClientReady()) { toast('Google sign-in is still loading. Try again in a moment.'); return false; }
  if (!GOOGLE_DRIVE_CLIENT_ID || GOOGLE_DRIVE_CLIENT_ID.startsWith('PASTE_YOUR_')) { toast('Add your Google OAuth Web Client ID in config.js first.'); return false; }
  if (!googleTokenClient) {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_DRIVE_CLIENT_ID,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: async response => {
        const resolve = googleTokenClient.__habitlyResolve;
        const reject = googleTokenClient.__habitlyReject;
        googleTokenClient.__habitlyResolve = null;
        googleTokenClient.__habitlyReject = null;
        const requestContext = driveTokenRequestContext || {};
        if (response.error) {
          reject?.(new Error(response.error));
          if (driveLoginSyncPending) {
            // Automatic login-time authorization is intentionally silent. If Google
            // requires interaction, do not interrupt the user with an account
            // chooser; keep local data usable and let Settings > Reconnect Drive
            // perform the explicit authorization when the user chooses it.
            driveLoginSyncBusy = false;
            if (requestContext.silent) {
              appPhase = 'READY';
              if (currentRoute() !== 'login') render();
            } else {
              scheduleDriveLoginSyncRetry();
            }
          } else if (!requestContext.silent) {
            toast('Google authorization was not completed');
          }
          return;
        }
        googleAccessToken = response.access_token || '';
        googleTokenExpiresAt = Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000;
        resolve?.(response);
        try {
          if (driveLoginSyncPending) {
            await syncDriveOnLogin();
          } else {
            await finishDriveConnection();
          }
        } catch (e) {
          console.error('Drive authorization follow-up failed:', e);
        }
      }
    });
  }
  return true;
}
async function driveRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${googleAccessToken}`);
  return fetch(url, { ...options, headers });
}
function backupPayload(sourceState = state, syncRevision = 0) { const safeState = clone(sourceState); if (safeState.profile) safeState.profile.avatar = ''; return { backupVersion: 4, app: 'Habitly', appVersion: APP_VERSION, accountId: currentAuthUser?.id || '', updatedAt: new Date().toISOString(), syncRevision: Number(syncRevision) || 0, syncDeviceId: ensureCloudDeviceId(), data: safeState }; }
async function findOrCreateDriveFolder() {
  const q = encodeURIComponent("name='Habitly Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const res = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)&pageSize=10`); if (!res.ok) throw new Error('Drive folder lookup failed'); const data = await res.json(); if (data.files?.[0]) return data.files[0].id;
  const create = await driveRequest('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Habitly Backups', mimeType: 'application/vnd.google-apps.folder' }) }); if (!create.ok) throw new Error('Drive folder creation failed'); return (await create.json()).id;
}
async function findDriveBackup(folderId) { const q = encodeURIComponent(`name='Habitly_Backup.json' and '${folderId}' in parents and trashed=false`); const res = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime,size,parents,trashed)&orderBy=modifiedTime desc&pageSize=10`); if (!res.ok) throw new Error('Drive backup lookup failed'); const data = await res.json(); return data.files?.[0] || null; }
async function validateDriveBackupFile(fileId, folderId) {
  if (!fileId) return null;
  try {
    const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,size,parents,trashed`);
    if (!res.ok) return null;
    const file = await res.json();
    if (file.trashed || file.name !== 'Habitly_Backup.json' || (folderId && !(file.parents || []).includes(folderId))) return null;
    return file;
  } catch (_) { return null; }
}
async function resolveDriveFolder(existingId = '') {
  if (existingId) {
    try {
      const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existingId)}?fields=id,name,mimeType,trashed`);
      if (res.ok) { const f = await res.json(); if (!f.trashed && f.name === 'Habitly Backups' && f.mimeType === 'application/vnd.google-apps.folder') return f.id; }
    } catch (_) {}
  }
  return findOrCreateDriveFolder();
}
async function cleanupDriveRevisions(fileId) { try { const meta = await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=headRevisionId`); if (!meta.ok) return; const head = (await meta.json()).headRevisionId; const r = await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}/revisions?fields=revisions(id,keepForever)`); if (!r.ok) return; const data = await r.json(); for (const rev of (data.revisions || [])) { if (rev.id !== head && !rev.keepForever) { await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${rev.id}`, { method: 'DELETE' }); } } } catch (e) { console.warn('Revision cleanup skipped', e); } }

function backupEnvelopeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Drive backup');
  // Drive stores an envelope. Never pass the envelope itself into state merge
  // functions: doing so turns a valid backup into an apparently empty state.
  const data = raw.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Drive backup data is missing');
  return validateBackupEnvelope(raw);
}
function stateRecordCount(s) {
  return ['habits','goals','events','reminders'].reduce((n,k)=>n + (Array.isArray(s?.[k]) ? s[k].length : 0), 0);
}
function isSuspiciousEmptySync(localState, remoteState, mutations = []) {
  const remoteCount = stateRecordCount(remoteState);
  const localCount = stateRecordCount(localState);
  if (remoteCount > 0 || localCount === 0) return false;

  const explicitDeletes = new Set(
    (mutations || []).filter(m => m?.op === 'delete' && ['habits','goals','events','reminders'].includes(m.kind))
      .map(m => `${m.kind}:${m.recordId}`)
  );

  // An empty remote state is legitimate only if every local record is
  // explicitly represented by a newer deletion tombstone. This protects both
  // Supabase hydration and Drive backup writes from accidental empty-state
  // replacement.
  for (const kind of ['habits','goals','events','reminders']) {
    const tombstones = remoteState?.syncMeta?.deleted?.[kind] || {};
    for (const record of (localState?.[kind] || [])) {
      const key = `${kind}:${record.id}`;
      const localDelete = explicitDeletes.has(key);
      const remoteDeleteAt = recordTime(tombstones[record.id]);
      if (!localDelete && (!remoteDeleteAt || remoteDeleteAt < recordTime(record.updatedAt))) return true;
    }
  }
  return false;
}
async function createDriveBackupFile(folderId, body) {
  const boundary = `habitly_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name: 'Habitly_Backup.json',
    parents: [folderId],
    mimeType: 'application/json'
  });
  const multipart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${body}\r\n` +
    `--${boundary}--`;
  const res = await driveRequest(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,parents',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Drive backup creation failed');
  }
  return res.json();
}

async function uploadDriveBackup(options = {}) {
  if (driveRemoteMissing && !options.force) return false;
  // When Supabase cloud sync is configured, Drive must only receive an
  // acknowledged cloud snapshot (or an explicit manual backup). Never let a
  // stale phone/laptop working copy become the backup source.
  if (cloudStorageSelected() && !options.force && !options.fromCloudAck) return false;
  if (googleDriveBusy) { driveUploadQueued = true; return false; }
  if (!options.force && driveSettings().autoDaily === false) return false;
  googleDriveBusy = true;
  const uploadGeneration = syncGeneration;
  const localSnapshot = normalizeState(clone(state));
  const mutationsSnapshot = clone(pendingMutations(localSnapshot));
  const dirtySnapshot = { ...dirtyFromMutations() };
  let d = driveSettings();
  const prevLastBackupDate = d.lastBackupDate, prevLastBackupAt = d.lastBackupAt;
  let remoteStateForMerge = null;
  let remoteDriveRevision = Number(driveSettings().syncRevision) || 0;
  let remoteETag = '';
  try {
    if (!googleAccessToken) throw new Error('Connect Google Drive first');
    let fileId = d.fileId || '', folderId = d.folderId || '', file = null;
    const discover = async () => {
      folderId = await resolveDriveFolder(folderId || '');
      file = await findDriveBackup(folderId); fileId = file?.id || ''; return file;
    };
    // Metadata validation is deliberately one request on the normal path. The live
    // application never waits for Drive to update its UI; this function is background work.
    if (fileId) {
      const metaRes = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,parents,trashed`);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        remoteETag = metaRes.headers.get('ETag') || metaRes.headers.get('etag') || '';
        if (!meta.trashed && meta.name === 'Habitly_Backup.json' && (!folderId || (meta.parents || []).includes(folderId))) file = meta;
        else await discover();
      } else if (metaRes.status === 404) await discover();
      else throw new Error('Could not verify the Google Drive backup before syncing');
    } else await discover();

    let uploadState = localSnapshot;
    if (cloudStorageSelected()) {
      if (pendingMutations(state).length) await flushCloudSync();
      if (pendingMutations(state).length) throw new Error('Cloud changes are still pending; Drive backup deferred safely');
      const cloudRow = await fetchCloudDocument();
      if (!cloudRow) throw new Error('Cloud state is not available; Drive backup deferred safely');
      uploadState = validateCloudDocument(cloudRow);
      cloudRevision = Number(cloudRow.revision) || cloudRevision;
    }
    const remoteChanged = !!(fileId && driveLastKnownRemoteModifiedAt && file?.modifiedTime && file.modifiedTime !== driveLastKnownRemoteModifiedAt);
    // Always fetch the remote envelope when a known backup exists. This costs one
    // download on a write, but guarantees that a delayed writer never turns a
    // complete remote backup into a partial/empty one.
    if (fileId) {
      const remoteResponse = await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
      if (!remoteResponse.ok) throw new Error('Remote backup could not be read');
      const rawRemote = await remoteResponse.json();
      remoteStateForMerge = backupEnvelopeState(rawRemote);
      remoteDriveRevision = Number(rawRemote?.syncRevision) || Number(remoteStateForMerge?.settings?.drive?.syncRevision) || 0;
      // Drive is downstream when Supabase cloud sync is enabled. Its existing
      // contents are never merged back into the active cloud state here; doing
      // that would reintroduce the exact phone-vs-laptop regression this layer
      // is designed to prevent. The acknowledged Supabase snapshot remains the
      // sole source for this backup.
      if (!cloudStorageSelected()) {
        // Reconcile against the real state, never against the outer backup envelope.
        uploadState = mergeForDriveUpload(remoteStateForMerge, localSnapshot, dirtySnapshot, syncBaseState);
      }
    }

    if (isSuspiciousEmptySync(uploadState, remoteStateForMerge, mutationsSnapshot)) {
      throw new Error('Sync safety guard: refusing to replace a non-empty backup with an unexplained empty state');
    }

    const nextDriveRevision = Math.max(Number(remoteDriveRevision) || 0, Number(d.syncRevision) || 0) + 1;
    uploadState.settings = uploadState.settings || clone(defaultState.settings);
    uploadState.settings.drive = { ...(uploadState.settings.drive || {}), syncRevision: nextDriveRevision };
    const body = JSON.stringify(backupPayload(uploadState, nextDriveRevision));
    let result = null;
    if (fileId) {
      let uploadHeaders = {'Content-Type':'application/json'};
      if (remoteETag) uploadHeaders['If-Match'] = remoteETag;
      let res = await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`, { method:'PATCH', headers:uploadHeaders, body });
      if (res.status === 412) {
        // Another device committed the backup between our metadata read and
        // PATCH. Never overwrite that newer Drive revision. Re-enter the full
        // upload path so it downloads the newest envelope, rebases the still-
        // pending user mutation journal, obtains the new ETag, and retries the
        // conditional write. This is the Drive equivalent of the Supabase CAS
        // retry loop and is essential for phone/laptop concurrent edits.
        const retryCount = Number(options._driveRetry || 0);
        if (retryCount < 3) {
          googleDriveBusy = false;
          return await uploadDriveBackup({ ...options, _driveRetry: retryCount + 1, silent: true });
        }
        driveUploadQueued = true;
        throw new Error('Drive changed repeatedly during sync; queued a safe retry');
      }
      if (!res.ok && res.status === 404) {
        await discover();
        if (fileId) {
          res = await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body });
        }
      }
      if (!res.ok) { const text = await res.text(); throw new Error(text || 'Drive upload failed'); }
      result = await res.json();
    }
    if (!result) {
      if (d.remoteEverSynced && !options.force) { driveRemoteMissing = true; throw new Error('Remote Habitly backup is missing. Confirm the backup before creating a new one.'); }
      folderId = folderId || await resolveDriveFolder('');
      // Create the backup with its JSON content atomically. Never create an
      // empty JSON file and then PATCH it: a failed second request used to leave
      // an empty cloud backup behind.
      result = await createDriveBackupFile(folderId, body);
      fileId = result.id;
    }
    const uploadedRemoteTime = result.modifiedTime || new Date().toISOString();
    d = driveSettings(); d.connected=true; d.folderId=folderId; d.fileId=result.id || fileId || ''; d.remoteEverSynced=true; d.lastRemoteUpdatedAt=uploadedRemoteTime; d.lastBackupDate=todayISO(); d.lastBackupAt=new Date().toISOString(); d.syncRevision=nextDriveRevision;
    driveLastKnownRemoteModifiedAt=uploadedRemoteTime; driveLastSyncCheckAt=Date.now(); driveSyncRetryCount=0; driveRemoteMissing=false;

    if (uploadGeneration === syncGeneration) {
      // The upload completed with no newer local mutation. The merged uploadState
      // is now the confirmed combined state, so it is safe to reconcile the live
      // state with it. Crucially, we do this only when the generation is unchanged;
      // a newer click/delete/edit can never be overwritten by an older upload.
      const liveBeforeConfirm = createSyncSnapshot(state);
      const liveAvatar = state.profile?.avatar || '';
      state = normalizeState(uploadState);
      if (liveAvatar && !state.profile.avatar) state.profile.avatar = liveAvatar;
      const ids = new Set(mutationsSnapshot.map(m=>m.id));
      state.syncMeta = state.syncMeta || clone(defaultState.syncMeta);
      state.syncMeta.mutations = pendingMutations(state).filter(m=>!ids.has(m.id));
      state.syncMeta.pending = dirtyFromMutations();
      resetSyncTracking(state);
      if (currentStorageKey) localStorage.setItem(currentStorageKey, JSON.stringify(state));
      if (JSON.stringify(liveBeforeConfirm) !== JSON.stringify(createSyncSnapshot(state)) && currentRoute() !== 'login') render();
    } else {
      // New mutations happened during the upload. Keep them and let the queued run upload them.
      state.syncMeta = state.syncMeta || clone(defaultState.syncMeta);
      state.syncMeta.mutations = pendingMutations(state);
      syncDirty = dirtyFromMutations();
      if (currentStorageKey) localStorage.setItem(currentStorageKey, JSON.stringify(state));
      driveUploadQueued = true;
    }
    if (!options.silent) toast('Habitly synced to Google Drive');
    return true;
  } catch (err) {
    console.error('Drive upload failed:', err); d=driveSettings(); d.lastBackupDate=prevLastBackupDate; d.lastBackupAt=prevLastBackupAt; scheduleDriveSyncRetry();
    if (!options.silent) toast(err.message?.includes('401')?'Google Drive authorization expired. Reconnect Drive.':err.message?.includes('403')?'Google Drive permission was denied. Reconnect Drive and allow Drive access.':'Google Drive sync failed — your local data is safe.');
    return false;
  } finally {
    googleDriveBusy=false;
    if (driveUploadQueued) { driveUploadQueued=false; queueMicrotask(()=>scheduleDriveBackup()); }
  }
}
async function finishDriveConnection() {
  try {
    const d = driveSettings();
    const authorizedEmail = await getGoogleEmail();

    // GOOGLE ACCOUNT SAFETY: reconnecting under a different Google account
    // than the one already associated with this Habitly account's backup
    // could otherwise silently point Habitly at (and overwrite) someone
    // else's Drive data. Ask before proceeding instead.
    if (d.email && authorizedEmail && authorizedEmail.toLowerCase() !== d.email.toLowerCase() && !storageOnboardingMode) {
      googleAccessToken = ''; googleTokenExpiresAt = 0;
      modal('Switch Google Drive account?', '', `<div class="confirm-box"><p>Habitly's Google Drive backup for this account is currently connected as <strong>${esc(d.email)}</strong>. You just authorized <strong>${esc(authorizedEmail)}</strong> instead.</p><p>Continuing will use ${esc(authorizedEmail)}'s Habitly backup (or create one) and stop using ${esc(d.email)}'s data.</p><div class="form-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" id="confirmDriveSwitch">Use ${esc(authorizedEmail)}</button></div></div>`);
      document.getElementById('confirmDriveSwitch')?.addEventListener('click', async () => {
        closeModal();
        d.folderId = ''; d.fileId = ''; d.email = authorizedEmail;
        save({ skipDrive: true });
        if (!ensureDriveClient()) return;
        requestDriveToken('consent').catch(() => {});
      });
      return;
    }

    const folderId = await resolveDriveFolder(d.folderId);
    const file = (await validateDriveBackupFile(d.fileId, folderId)) || await findDriveBackup(folderId);
    d.connected = true; d.folderId = folderId; d.fileId = file?.id || '';
     driveLastKnownRemoteModifiedAt = file?.modifiedTime || '';
     driveLastSyncCheckAt = Date.now();
    if (authorizedEmail) d.email = authorizedEmail;
    save({ skipDrive: true, markDirty: false });
    if (storageOnboardingMode) {
      const mode = storageOnboardingMode;
      const ok = await uploadDriveBackup();
      if (!ok) {
        storageOnboardingBusy = false;
        toast('Drive access was granted, but the first Habitly backup could not be completed. Please try again.');
        return;
      }
      await completeStorageSetup(mode);
      toast(mode === 'both' ? 'This device + Google Drive storage is ready' : 'Google Drive storage is ready');
      return;
    }
    render(); toast('Google Drive connected');
    if (d.autoDaily === true && d.lastBackupDate !== todayISO()) setTimeout(() => uploadDriveBackup().then(() => { if (currentRoute() === 'settings') render(); }), 250);
  } catch (e) {
    console.error(e);
    if (storageOnboardingMode) { storageOnboardingBusy = false; toast('Could not finish Google Drive setup. Please try again.'); }
    else toast('Could not connect to Google Drive');
  }
}
async function getGoogleEmail() { try { const r = await driveRequest('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)'); if (!r.ok) return ''; return (await r.json()).user?.emailAddress || ''; } catch (e) { return ''; } }
// If a login-time Drive sync fails, driveLoginSyncPending is deliberately left
// TRUE (see scheduleDriveBackup / save). That keeps automatic backup uploads
// blocked for this session so a temporary failure (offline, expired grant,
// slow Google script load, etc.) can never push a stale or empty local copy
// on top of the good backup already sitting in the user's Drive. A single
// safe retry is scheduled; after that the user can reconnect manually from
// Settings, which re-enters this same function.
function scheduleDriveLoginSyncRetry() {
  if (!currentAuthUser) return;
  if (driveLoginSyncRetryUsed) {
    appPhase = 'READY';
    if (currentRoute() !== 'login') render();
    return;
  }
  driveLoginSyncRetryUsed = true;
  clearTimeout(driveLoginSyncRetryTimer);
  driveLoginSyncRetryTimer = setTimeout(() => {
    if (driveLoginSyncPending && currentAuthUser && driveClientReady()) attemptDriveLoginSync();
  }, 10000);
}

// Waits (briefly, with a bounded number of attempts) for the Google Identity
// Services script to finish loading before requesting a Drive token for the
// post-login sync. While it waits, driveLoginSyncPending stays true so no
// automatic backup can run against an unsynced local copy.
function attemptDriveLoginSync() {
  if (!driveLoginSyncPending || !currentAuthUser) return;
  if (!driveClientReady()) {
    if (driveLoginSyncWaitAttempts++ < 20) {
      clearTimeout(driveLoginSyncRetryTimer);
      driveLoginSyncRetryTimer = setTimeout(attemptDriveLoginSync, 500);
      return;
    }
    // Google Identity Services never finished loading (e.g. blocked script,
    // offline). Stop waiting so the UI isn't stuck on the restoring screen
    // forever. driveLoginSyncPending stays true, which keeps automatic
    // uploads blocked for this session — local data is shown, but nothing
    // can overwrite the real Drive backup until the user reconnects.
    toast('Could not reach Google Drive. Your local data is shown — reconnect Google Drive in Settings to sync.');
    appPhase = 'READY';
    if (currentRoute() !== 'login') render();
    return;
  }
  driveLoginSyncWaitAttempts = 0;
  if (!ensureDriveClient()) {
    // Drive not configured (e.g. missing OAuth client ID); ensureDriveClient()
    // already surfaced a toast. Same reasoning as above: stop blocking the UI.
    appPhase = 'READY';
    if (currentRoute() !== 'login') render();
    return;
  }
  requestDriveToken('', { silent: true }).catch(() => {});
}

function validateBackupEnvelope(incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('Invalid Habitly backup');
  if (incoming.app && incoming.app !== 'Habitly') throw new Error('This is not a Habitly backup');
  if (incoming.accountId && currentAuthUser?.id && incoming.accountId !== currentAuthUser.id) throw new Error('This Habitly backup belongs to another account');
  const raw = incoming.data || incoming;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Habitly backup data is invalid');
  for (const key of ['habits','goals','events','reminders']) {
    if (!Array.isArray(raw[key])) throw new Error(`Habitly backup is incomplete: ${key}`);
  }
  if (!raw.settings || typeof raw.settings !== 'object' || Array.isArray(raw.settings)) throw new Error('Habitly backup settings are incomplete');
  return normalizeState(mergeState(raw, { preserveMutations: false }));
}
async function syncDriveOnLogin(options = {}) {
  // Google Drive is never part of login hydration. Supabase Cloud is the sole automatic source of truth.
  if (cloudStorageSelected()) return false;
  if (!currentAuthUser || driveLoginSyncBusy || (!options.refresh && driveLoginSyncedUserId === currentAuthUser.id)) return;
  if (cloudStorageSelected() && cloudSyncAvailable && cloudRevision > 0) {
    driveLoginSyncPending = false;
    driveLoginSyncedUserId = currentAuthUser.id;
    appPhase = 'READY';
    if (currentRoute() !== 'login') render();
    return;
  }
  driveLoginSyncBusy = true;
  let succeeded = false;
  let stateChanged = false;
  try {
    const d = driveSettings();
    const authorizedEmail = await getGoogleEmail();
    if (d.email && authorizedEmail && authorizedEmail.toLowerCase() !== d.email.toLowerCase()) {
      googleAccessToken = ''; googleTokenExpiresAt = 0;
      toast(`Google Drive is connected as ${d.email}, but ${authorizedEmail} was authorized. Reconnect the correct Google account in Settings to sync.`);
      return;
    }
    const folderId = await resolveDriveFolder(d.folderId);
    const file = (await validateDriveBackupFile(d.fileId, folderId)) || await findDriveBackup(folderId);
    d.connected = true; d.folderId = folderId; d.fileId = file?.id || '';
    if (authorizedEmail) d.email = authorizedEmail;
    save({ skipDrive:true, markDirty:false });

    if (!file) {
      const hasPending = pendingMutations(state).length > 0 || Object.values(state.syncMeta?.pending || {}).some(Boolean);
      if (d.remoteEverSynced || hasPending) {
        driveRemoteMissing = true;
        driveLastKnownRemoteModifiedAt = '';
        driveLastSyncCheckAt = Date.now();
        succeeded = true;
        return;
      }
      driveHydrationConfirmedUserId = currentAuthUser.id;
      succeeded = await uploadDriveBackup({ silent:true, force:true });
      if (succeeded) driveHydrationGeneration++;
      else driveHydrationConfirmedUserId = '';
      stateChanged = succeeded;
      return;
    }

    // On periodic refreshes, metadata is enough unless the remote file actually changed.
    // This keeps cross-device detection fast without repeatedly downloading the full JSON.
    const remoteModified = file.modifiedTime || '';
    const remoteChanged = !driveLastKnownRemoteModifiedAt || remoteModified !== driveLastKnownRemoteModifiedAt;
    driveLastKnownRemoteModifiedAt = remoteModified;
    driveLastSyncCheckAt = Date.now();
    if (options.refresh && !remoteChanged) {
      d.remoteEverSynced = true;
      succeeded = true;
      return;
    }

    const response = await driveRequest(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
    if (!response.ok) throw new Error('Could not download Habitly backup');
    const remoteState = validateBackupEnvelope(await response.json());
    const hasPending = pendingMutations(state).length > 0 || Object.values(state.syncMeta?.pending || {}).some(Boolean);
    const previous = createSyncSnapshot(state);
    const localAvatar = state.profile?.avatar || '';
    const nextState = hasPending
      ? adoptRemoteWithPending(remoteState, state, syncBaseState)
      : normalizeState(clone(remoteState));
    if (localAvatar && !nextState.profile.avatar) nextState.profile.avatar = localAvatar;
    nextState.settings.storage = { ...(nextState.settings.storage || {}), mode: storageMode(), setupCompleted:true };
    // For a pending local change, establish the downloaded remote state as the
    // baseline WITHOUT clearing the local mutation journal. Clearing it here was
    // the root cause of edits/progress disappearing after delayed syncs.
    state = normalizeState(nextState);
    const rd = driveSettings();
    rd.connected=true; rd.folderId=folderId; rd.fileId=file.id; rd.remoteEverSynced=true;
    rd.lastRemoteUpdatedAt=remoteState.syncMeta?.remoteUpdatedAt || remoteState.updatedAt || file.modifiedTime || '';
    rd.lastBackupAt = rd.lastBackupAt || file.modifiedTime || '';
    driveHydrationConfirmedUserId = currentAuthUser.id;
    driveHydrationGeneration++;
    if (hasPending) {
      syncBaseState = createSyncSnapshot(remoteState);
      syncLastSavedSnapshot = createSyncSnapshot(state);
      syncDirty = dirtyFromMutations();
    } else {
      resetSyncTracking(state);
    }
    save({ skipDrive:true, markDirty:false });
    stateChanged = JSON.stringify(previous) !== JSON.stringify(createSyncSnapshot(state));
    succeeded = true;
    if (hasPending) {
      // Keep the mutation journal until uploadDriveBackup confirms the merged state.
      await uploadDriveBackup({ silent:true });
    }
    if (cloudStorageSelected() && !cloudRevision) {
      try {
        const existingCloud = await fetchCloudDocument();
        if (existingCloud) {
          const safe = validateCloudDocument(existingCloud);
          cloudRevision = Number(existingCloud.revision);
          state = adoptRemoteWithPending(safe, state, syncBaseState);
          state.syncMeta.cloudRevision = cloudRevision;
        } else {
          const createdCloud = await createCloudDocument(state);
          cloudRevision = Number(createdCloud.revision);
          state.syncMeta.cloudRevision = cloudRevision;
          cloudSyncAvailable = true;
          cloudSyncLastAt = Date.now();
        }
      } catch (cloudError) { console.warn('Supabase cloud seeding after Drive hydration failed:', cloudError); }
    }
  } catch (e) {
    console.error('Drive login/refresh sync failed:', e);
  } finally {
    driveLoginSyncBusy = false;
    if (succeeded) {
      if (currentAuthUser) {
        driveLoginSyncedUserId = currentAuthUser.id;
        driveHydrationConfirmedUserId = currentAuthUser.id;
        driveHydrationGeneration++;
      }
      driveLoginSyncPending = false;
      driveLoginSyncRetryUsed = false;
      appPhase = 'READY';
      if (stateChanged && currentRoute() !== 'login') render();
    } else {
      scheduleDriveLoginSyncRetry();
    }
  }
}
async function checkDriveForExternalChanges() {
  // Deprecated active-Drive synchronization path. Google Drive is backup/restore
  // only in the production architecture. Never hydrate or overwrite active
  // Habitly state from Drive automatically.
  return false;
}

function connectDrive() {
  if (!ensureDriveClient()) return;
  requestDriveToken(driveSettings().connected ? '' : 'consent').catch(() => {});
}
async function disconnectDrive() {
  const d = driveSettings();
  if (!d.connected) return;
  modal('Disconnect Google Drive', 'Habitly will stop using Google Drive for automatic backups. Your existing Drive backup will not be deleted.', `<div class="confirm-box"><p>This disconnects Habitly from <strong>${esc(d.email || 'your Google Drive')}</strong>. Your Supabase cloud data and local data remain unchanged.</p><p>You can reconnect Google Drive later from Settings.</p><div class="form-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="danger-btn" id="confirmDriveDisconnect">Disconnect Drive</button></div></div>`);
  document.getElementById('confirmDriveDisconnect')?.addEventListener('click', () => {
    clearTimeout(driveBackupTimer); driveBackupTimer = null; clearTimeout(driveSyncRetryTimer); driveSyncRetryTimer = null;
    driveUploadQueued = false; driveLoginSyncPending = false; driveLoginSyncBusy = false; driveRemoteMissing = false;
    driveHydrationConfirmedUserId = ''; driveLoginSyncedUserId = '';
    googleAccessToken = ''; googleTokenExpiresAt = 0; googleTokenClient = null; driveTokenRequestPromise = null; driveTokenRequestContext = null;
    d.connected = false; d.email = ''; d.folderId = ''; d.fileId = ''; d.lastBackupDate = ''; d.lastBackupAt = ''; d.lastRemoteUpdatedAt = ''; d.remoteEverSynced = false; d.syncRevision = 0; d.autoDaily = false;
    save({ skipDrive: true, markDirty: false }); closeModal(); render(); toast('Google Drive disconnected');
  });
}
async function bindDriveSettings(root) {
  const d = driveSettings();
  root.querySelector('#driveConnect')?.addEventListener('click', connectDrive);
  root.querySelector('#driveBackupNow')?.addEventListener('click', async () => {
    if (!googleAccessToken || Date.now() >= googleTokenExpiresAt - 60000) {
      try { await requestDriveToken(''); } catch (_) { return; }
    }
    await uploadDriveBackup({ force: true });
    if (currentRoute() === 'settings') render();
  });
  root.querySelector('#driveRestore')?.addEventListener('click', restoreDriveBackup);
  root.querySelector('#driveDisconnect')?.addEventListener('click', () => disconnectDrive());
  root.querySelector('#driveAutoDaily')?.addEventListener('change', e => { d.autoDaily = e.target.checked; d.driveOptInVersion = 1; save(); if (currentRoute() === 'settings') render(); toast(d.autoDaily ? 'Automatic Google Drive backup enabled' : 'Automatic Google Drive backup disabled'); });
  if (d.connected && d.autoDaily === true && d.lastBackupDate !== todayISO()) {
    if (googleAccessToken && Date.now() < googleTokenExpiresAt - 60000) setTimeout(() => uploadDriveBackup({ silent: true }), 250);
    else if (ensureDriveClient()) requestDriveToken('', { silent: true }).catch(() => {});
  }
}
async function restoreDriveBackup() { if (!googleAccessToken || Date.now() >= googleTokenExpiresAt - 60000) { try { await requestDriveToken(''); } catch (_) { return; } } const d = driveSettings(); try { const folderId = await resolveDriveFolder(d.folderId); const file = (await validateDriveBackupFile(d.fileId, folderId)) || await findDriveBackup(folderId); if (!file) { toast('No Habitly backup found in Google Drive'); return; } const r = await driveRequest(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`); if (!r.ok) throw new Error('Could not download backup'); const incoming = await r.json(); modal('Restore Google Drive backup', 'Your current local Habitly data will be replaced by this backup.', `<div class="confirm-box"><p>Backup updated ${esc(formatBackupTime(incoming.updatedAt || file.modifiedTime))}. This restores the complete Habitly state.</p><div class="form-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" id="confirmDriveRestore">Restore backup</button></div></div>`); document.getElementById('confirmDriveRestore').addEventListener('click', () => { try { state = validateBackupEnvelope(incoming); const activeDrive = driveSettings(); activeDrive.connected = true; activeDrive.folderId = folderId; activeDrive.fileId = file.id; activeDrive.remoteEverSynced = true; activeDrive.lastRemoteUpdatedAt = incoming.updatedAt || file.modifiedTime || ''; resetSyncTracking(state); save({ skipDrive: true, markDirty: false }); closeModal(); render(); toast('Google Drive backup restored'); } catch (e) { toast('Invalid Habitly backup'); } }); } catch (e) { console.error(e); toast('Google Drive restore failed'); } }
function isStandalone() { return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function renderInstallOption(root) {
  if (!root) return;
  if (isStandalone()) {
    root.innerHTML = `<div class="install-status installed"><span class="install-status-icon">${icon('check')}</span><div><strong>Habitly is installed</strong><small>You can open it from your phone's home screen like a normal app.</small></div></div>`;
    return;
  }
  if (isIOS()) {
    root.innerHTML = `<div class="install-status"><span class="install-status-icon">${icon('download')}</span><div><strong>Add Habitly to your Home Screen</strong><small>In Safari, tap Share → Add to Home Screen → Add.</small></div></div>`;
    return;
  }
  if (deferredInstallPrompt) {
    root.innerHTML = `<div class="install-status"><span class="install-status-icon">${icon('download')}</span><div><strong>Install Habitly on this device</strong><small>Get a home-screen icon and app-like full-screen experience.</small></div><button class="primary-btn install-app-btn" id="installHabitlyBtn">Install app</button></div>`;
    root.querySelector('#installHabitlyBtn')?.addEventListener('click', async () => {
      try {
        const prompt = deferredInstallPrompt;
        if (!prompt) return;
        await prompt.prompt();
        await prompt.userChoice;
      } catch (e) { console.warn('Habitly install prompt failed', e); }
      deferredInstallPrompt = null;
      renderInstallOption(root);
    });
    return;
  }
  root.innerHTML = `<div class="install-status"><span class="install-status-icon">${icon('download')}</span><div><strong>Install Habitly from your browser</strong><small>On Android Chrome, open the browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>. If the option is not shown yet, open Habitly once on a secure HTTPS connection.</small></div></div>`;
}
function openCropper(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    cropState = { src: reader.result, image: new Image(), zoom: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0, baseX: 0, baseY: 0, onDone };
    cropState.image.onload = () => renderCropper();
    cropState.image.src = reader.result;
  };
  reader.readAsDataURL(file);
}
function renderCropper() {
  const c = cropState;
  modal('Crop profile photo', 'Move the image inside the square and adjust the zoom.', `<div class="cropper"><div class="crop-stage" id="cropStage"><canvas id="cropCanvas" width="320" height="320"></canvas><div class="crop-frame"></div></div><div class="crop-controls"><label>Zoom <input id="cropZoom" type="range" min="1" max="3" step="0.01" value="${c.zoom}"></label><button type="button" class="secondary-btn" id="cropReset">Reset</button></div><p class="crop-help">Drag the photo to choose the area that will appear in your circular profile picture.</p><div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button><button type="button" class="primary-btn" id="cropApply">Use photo</button></div></div>`);
  const stage = document.getElementById('cropStage'), canvas = document.getElementById('cropCanvas'), ctx = canvas.getContext('2d');
  function draw() {
    const size = 320, img = c.image;
    ctx.clearRect(0,0,size,size);
    const scale = Math.max(size/img.width, size/img.height) * c.zoom;
    const w = img.width * scale, h = img.height * scale;
    const maxX = Math.max(0, (w-size)/2), maxY = Math.max(0, (h-size)/2);
    c.x = Math.max(-maxX, Math.min(maxX, c.x));
    c.y = Math.max(-maxY, Math.min(maxY, c.y));
    const x = (size-w)/2 + c.x, y = (size-h)/2 + c.y;
    ctx.drawImage(img,x,y,w,h);
  }
  c.draw = draw; draw();
  stage.addEventListener('pointerdown', e => { c.dragging = true; c.startX=e.clientX; c.startY=e.clientY; c.baseX=c.x; c.baseY=c.y; stage.setPointerCapture?.(e.pointerId); });
  stage.addEventListener('pointermove', e => { if (!c.dragging) return; c.x=c.baseX+(e.clientX-c.startX); c.y=c.baseY+(e.clientY-c.startY); draw(); });
  stage.addEventListener('pointerup', () => c.dragging=false); stage.addEventListener('pointercancel', () => c.dragging=false);
  document.getElementById('cropZoom')?.addEventListener('input', e => { c.zoom=Number(e.target.value); draw(); });
  document.getElementById('cropReset')?.addEventListener('click', () => { c.zoom=1;c.x=0;c.y=0;document.getElementById('cropZoom').value='1';draw(); });
  document.getElementById('cropApply')?.addEventListener('click', () => { const out=document.createElement('canvas'); out.width=512;out.height=512;const o=out.getContext('2d'); const size=320,img=c.image,scale=Math.max(size/img.width,size/img.height)*c.zoom,w=img.width*scale,h=img.height*scale,x=(size-w)/2+c.x,y=(size-h)/2+c.y; o.clearRect(0,0,512,512); o.drawImage(canvas,0,0,320,320,0,0,512,512); const result=out.toDataURL('image/jpeg',0.88); const done=c.onDone; cropState=null; closeModal(); done?.(result); });
}
function initSettings() {
  const root = document.querySelector('.page-settings'); if (!root) return;
  const content = root.querySelector('#settingsContent');
  function show(key) { window.__habitlyActiveSettingsSection = key; root.querySelectorAll('.settings-nav [data-settings-tab]').forEach(x => x.classList.toggle('active', x.dataset.settingsTab === key)); content.innerHTML = settingsSection(key); bindSection(key); }
  function bindSection(key) {
    if (key === 'account') {
      const input = root.querySelector('#avatarInput'); input?.addEventListener('change', e => { const f = e.target.files?.[0]; if (!f) return; if (!/^image\/(png|jpeg|webp)$/i.test(f.type)) { toast('Please choose a PNG, JPG or WebP image'); e.target.value = ''; return; } if (f.size > 10 * 1024 * 1024) { toast('Profile picture must be 10 MB or smaller'); e.target.value = ''; return; } openCropper(f, result => { state.profile.avatar = result; root.querySelector('#profileAvatar').innerHTML = `<img src="${esc(result)}" alt="Profile picture">`; }); e.target.value = ''; });
      root.querySelector('#profileForm')?.addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.target); state.profile.name = String(fd.get('name') || '').trim() || 'Prem Kumar'; state.profile.email = String(fd.get('email') || '').trim(); save(); render(); toast('Profile updated'); });
      renderInstallOption(root.querySelector('#installAppContent'));
    }
    if (key === 'notifications') {
      root.querySelectorAll('[data-notify]').forEach(i => i.addEventListener('change', () => { if (!state.settings) state.settings = clone(defaultState.settings); state.settings.notifications = normalizeNotificationSettings(state.settings.notifications); state.settings.notifications[i.dataset.notify] = i.checked; state.settings.notifications.daily = state.settings.notifications.habitReminders; save(); refreshReminderUi(); toast(i.dataset.notify === 'habitReminders' ? (i.checked ? 'Habit reminders enabled' : 'Habit reminders turned off') : i.dataset.notify === 'eventReminders' ? (i.checked ? 'Event reminders enabled' : 'Event reminders turned off') : 'Notification preference saved'); }));
      root.querySelector('#prefDefaultHabitTime')?.addEventListener('change', e => { const parsed=parseTime24(e.target.value); if(!parsed){ e.target.value=formatTimeShort(s.notifications.defaultHabitTime||'20:00:00'); toast('Enter a valid time'); return; } s.notifications.defaultHabitTime=parsed; e.target.value=formatTimeShort(parsed); save(); toast('Default habit reminder time updated'); });
      root.querySelectorAll('input[name="defaultHabitDays"]').forEach(i => i.addEventListener('change', () => { const checked = [...root.querySelectorAll('input[name="defaultHabitDays"]:checked')].map(x => Number(x.value)); if (!checked.length) { i.checked = true; toast('Select at least one day'); return; } s.notifications.defaultHabitDays = normalizeReminderDays(checked); save(); toast('Default reminder days updated'); }));
      root.querySelector('#enableBrowserNotifications')?.addEventListener('click', enableNotifications);
    }
    if (key === 'habits') {
      const s = safesettings(); const v = s.habits; root.querySelector('#prefTimeFormat').value = s.timeFormat || '12h'; root.querySelector('#prefTimeFormat').addEventListener('change', e => { s.timeFormat = e.target.value === '24h' ? '24h' : '12h'; save(); show('habits'); }); root.querySelector('#prefDefaultView').value = v.defaultView; root.querySelector('#prefWeekStart').value = v.weekStarts;
      root.querySelector('#prefDefaultView').addEventListener('change', e => { v.defaultView = e.target.value; save(); }); root.querySelector('#prefWeekStart').addEventListener('change', e => { v.weekStarts = e.target.value; save(); });
      [['#prefAuto', 'autoComplete'], ['#prefStreak', 'keepStreak'], ['#prefQuick', 'quickQuantity']].forEach(([sel, k]) => root.querySelector(sel).addEventListener('change', e => { v[k] = e.target.checked; save(); }));
    }
    if (key === 'fitness') { const f=safesettings().fitness; root.querySelector('#prefWorkoutLogging')?.addEventListener('change',e=>{f.workoutLogging=e.target.checked;save();show('fitness');toast(e.target.checked?'Workout logging enabled':'Workout logging disabled');}); root.querySelector('#prefBodyMeasurements')?.addEventListener('change',e=>{f.bodyMeasurements=e.target.checked;save();show('fitness');toast(e.target.checked?'Body measurements enabled':'Body measurements disabled');}); }
    if (key === 'security') { root.querySelector('[data-security="sessions"]')?.addEventListener('click', () => toast('This browser is the only active local session.')); root.querySelector('[data-security="clear"]')?.addEventListener('click', () => confirmClearData()); }
    if (key === 'data') { root.querySelector('#exportBackup')?.addEventListener('click', exportBackup); root.querySelector('#importBackup')?.addEventListener('change', importBackup); if (state.settings?.storage?.mode === 'cloud' || state.settings?.storage?.mode === 'drive' || state.settings?.storage?.mode === 'both') bindDriveSettings(root); }
  }
  function safesettings() { if (!state.settings) state.settings = clone(defaultState.settings); return state.settings; }
  function confirmClearData() { modal('Clear local data', 'This removes your saved Habitly data from this browser.', `<div class="confirm-box"><p>Your habits, goals, events and settings will be cleared from this browser. Google Drive data will not be deleted.</p><div class="form-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="danger-btn" id="confirmClearSettings">Clear data</button></div></div>`); document.getElementById('confirmClearSettings').addEventListener('click', () => { if (currentStorageKey) localStorage.removeItem(currentStorageKey); localStorage.removeItem(STORAGE); state = freshUserState(currentAuthUser); resetSyncTracking(state); if (cloudStorageSelected()) { state.syncMeta.mutations=[]; state.syncMeta.pending={...defaultState.syncMeta.pending}; initializeCloudSync(); } closeModal(); render(); toast('Local browser data cleared — cloud data remains safe'); }); }
  function exportBackup() { const payload = { backupVersion: 3, app: 'Habitly', appVersion: APP_VERSION, accountId: currentAuthUser?.id || '', updatedAt: new Date().toISOString(), data: clone(state) }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `habitly-backup-${todayISO()}.json`; a.click(); URL.revokeObjectURL(url); toast('Backup exported'); }
  function importBackup(e) { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const incoming = JSON.parse(r.result); state = validateBackupEnvelope(incoming); save(); render(); toast('Backup restored'); } catch (err) { toast('Invalid Habitly backup'); } }; r.readAsText(f); }
  root.addEventListener('click', e => { const tab = e.target.closest('[data-settings-tab]'); if (tab) { e.preventDefault(); show(tab.dataset.settingsTab); } });
  show(window.__habitlyActiveSettingsSection || 'account');
}

function habitForm(id) {
  const h = id ? state.habits.find(x => x.id === id) : null;
  const selectedType = h?.type || 'quantity';
  modal(id ? 'Edit habit' : 'Add habit', id ? 'Refine your routine without losing progress.' : 'Create a routine you can actually maintain.', `<form class="form" id="habitForm">
    <div class="form-section"><span class="form-step">01</span><div><strong>Basic details</strong><small>Name, emoji and category</small></div></div>
    <div class="form-grid two"><div class="field"><label>Habit name *</label><input name="name" required value="${esc(h?.name || '')}"></div><div class="field"><label>Category *</label><select name="category" required>${['Health', 'Fitness', 'Study', 'Personal', 'Mindfulness'].map(x => `<option ${x === h?.category ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="field"><label>Habit emoji</label><input class="emoji-input" name="emoji" value="${esc(h?.emoji || '')}" placeholder="Tap here and choose an emoji" inputmode="text" autocomplete="off"><small>Use your phone's emoji keyboard to choose any emoji.</small></div>
    <div class="form-section"><span class="form-step">02</span><div><strong>How you track it</strong><small>Choose the way progress is measured</small></div></div>
    <div class="track-options">
      <label class="track-option ${selectedType === 'quantity' ? 'selected' : ''}"><input type="radio" name="type" value="quantity" ${selectedType === 'quantity' ? 'checked' : ''}><b>Quantity</b><small>Glasses, pages, minutes</small></label>
      <label class="track-option ${selectedType === 'yesno' ? 'selected' : ''}"><input type="radio" name="type" value="yesno" ${selectedType === 'yesno' ? 'checked' : ''}><b>Yes / No</b><small>Complete it once</small></label>
      <label class="track-option ${selectedType === 'count' ? 'selected' : ''}"><input type="radio" name="type" value="count" ${selectedType === 'count' ? 'checked' : ''}><b>Count</b><small>Track repetitions</small></label>
    </div>
    <div class="form-grid two" id="habitMeasureFields">
      <div class="field"><label>Target <span class="target-required">*</span></label><input name="target" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(h?.target ?? '')}" placeholder="e.g. 8"><small class="yesno-help hidden">Yes / No habits automatically use one completion.</small></div>
      <div class="field"><label>Unit</label><input name="unit" value="${esc(h?.unit || '')}" placeholder="glasses, pages, min"></div>
    </div>
    <div class="form-section"><span class="form-step">03</span><div><strong>Schedule</strong><small>Keep the routine predictable</small></div></div>
    <div class="field"><label>Frequency</label><select name="frequency"><option ${h?.frequency === 'Daily' || !h ? 'selected' : ''}>Daily</option><option ${h?.frequency === 'Selected Days' ? 'selected' : ''}>Selected Days</option></select></div>
    ${id ? `<label class="switch-row"><span><b>Pause habit</b><small>Pause without losing progress.</small></span><input type="checkbox" name="paused" ${h?.paused ? 'checked' : ''}><i></i></label>` : ''}
    <div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn">${id ? 'Save Changes' : 'Add Habit'} →</button></div>
  </form>`);

  const form = document.getElementById('habitForm');
  const measureFields = form.querySelector('#habitMeasureFields');
  const targetInput = form.querySelector('[name="target"]');
  const unitInput = form.querySelector('[name="unit"]');
  const requiredMark = form.querySelector('.target-required');
  const help = form.querySelector('.yesno-help');
  let lastQuantityTarget = selectedType === 'yesno' ? '1' : String(h?.target ?? '');
  let lastQuantityUnit = selectedType === 'yesno' ? '' : String(h?.unit || '');
  let previousType = selectedType;
  const syncTypeUI = ({ initial = false } = {}) => {
    const type = form.querySelector('[name="type"]:checked')?.value || 'quantity';
    form.querySelectorAll('.track-option').forEach(x => x.classList.toggle('selected', x.querySelector('input')?.checked));
    const yesno = type === 'yesno';
    measureFields.classList.toggle('hidden', yesno);
    targetInput.required = !yesno;
    targetInput.disabled = yesno;
    unitInput.disabled = yesno;
    requiredMark.classList.toggle('hidden', yesno);
    help.classList.toggle('hidden', !yesno);

    // Only the tracking-type change is allowed to replace Target. Never
    // rewrite a user-entered multi-digit value while the form is being edited.
    if (yesno) {
      if (previousType !== 'yesno') {
        lastQuantityTarget = targetInput.value;
        lastQuantityUnit = unitInput.value;
      }
      targetInput.value = '1';
      unitInput.value = 'completion';
    } else if (previousType === 'yesno' || (initial && h?.type === 'yesno')) {
      targetInput.value = lastQuantityTarget || '1';
      unitInput.value = lastQuantityUnit || '';
    }
    previousType = type;
  };
  form.querySelectorAll('[name="type"]').forEach(r => r.addEventListener('change', () => syncTypeUI()));
  syncTypeUI({ initial: true });

  // Keep numeric target input stable while typing. The value is validated once
  // on submit instead of being coerced on every keystroke.
  // Do not coerce the value while the user is entering it. In particular,
  // never run Number()/Math.max() from an input event: doing that can turn
  // an in-progress multi-digit edit into a different value. Validation is
  // performed exactly once when Save Changes is submitted.
  targetInput.addEventListener('beforeinput', e => {
    if (targetInput.disabled) return;
    if (e.inputType === 'insertText' && e.data && /[^0-9]/.test(e.data)) e.preventDefault();
  });
  targetInput.addEventListener('paste', e => {
    if (targetInput.disabled) return;
    const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '');
    if (!text) { e.preventDefault(); return; }
    e.preventDefault();
    const start = targetInput.selectionStart ?? targetInput.value.length;
    const end = targetInput.selectionEnd ?? start;
    targetInput.setRangeText(text, start, end, 'end');
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const type = String(fd.get('type') || 'quantity');
    const rawTarget = String(fd.get('target') ?? '').trim();
    if (type !== 'yesno' && !/^\d+$/.test(rawTarget)) { toast('Enter a valid whole-number target'); targetInput.focus(); return; }
    const target = type === 'yesno' ? 1 : Math.max(1, Number(rawTarget));
    const unit = type === 'yesno' ? 'completion' : (String(fd.get('unit') || '').trim() || 'times');
    if (id) {
      const today = todayISO();
      const hasTodayRecord = Object.prototype.hasOwnProperty.call(h.daily || {}, today);
      Object.assign(h, { name: String(fd.get('name')).trim(), category: fd.get('category'), emoji: String(fd.get('emoji') || '').trim(), type, target, unit, frequency: fd.get('frequency'), paused: fd.get('paused') === 'on', updatedAt: new Date().toISOString() });
      h.current = Math.min(Number(h.current) || 0, target);
      // If today's progress actually exists, keep the authoritative daily
      // record in sync with a reduced target. Otherwise do not create one.
      if (hasTodayRecord) {
        h.daily = h.daily || {};
        h.dailyUpdatedAt = h.dailyUpdatedAt || {};
        h.daily[today] = h.current;
        h.dailyUpdatedAt[today] = new Date().toISOString();
      }
    } else {
      state.habits.push({ id: uid('h'), name: String(fd.get('name')).trim(), emoji: String(fd.get('emoji') || '').trim(), category: fd.get('category'), type, target, current: 0, unit, paused: false, created: Date.now(), frequency: fd.get('frequency'), updatedAt: new Date().toISOString() });
    }
    save(); closeModal(); render(); toast(id ? 'Habit updated' : 'Habit added');
  });
}

function goalForm(id) {
  const g = id ? state.goals.find(x => x.id === id) : null;
  const components = g?.components || { target: g?.type !== 'milestone' && g?.type !== 'habit', milestones: g?.type === 'milestone', habits: g?.type === 'habit' };
  const isFitness = g?.type === 'fitness';
  const ms = Array.isArray(g?.milestones) ? g.milestones : [];
  const habitIds = Array.isArray(g?.goalHabitIds) ? g.goalHabitIds : [];
  const fitness = g?.fitness || {};
  const selectedCategory = g?.category || (isFitness ? 'Fitness' : 'Personal Growth');
  const milestoneRows = ms.map(m => `<div class="goal-builder-row milestone-builder-row"><input class="gh-title" name="milestoneTitle" value="${esc(m.title)}" placeholder="Checkpoint name"><input class="gh-value" name="milestoneValue" type="number" step="any" value="${m.value == null ? '' : esc(m.value)}" placeholder="Value"><button type="button" class="remove-builder" data-remove-milestone="${esc(m.id)}">×</button></div>`).join('');
  const habitOptions = state.habits.map(h => `<label class="goal-habit-option"><input type="checkbox" name="goalHabit" value="${esc(h.id)}" ${habitIds.includes(h.id)?'checked':''}><span>${esc(h.emoji || '•')} ${esc(h.name)}</span><small>${pct(h)}%</small></label>`).join('');

  modal(id ? 'Edit goal' : 'Add goal',
    'Build a goal from the parts you actually need. Target = destination, milestones = checkpoints, habits = repeated actions.',
    `<form class="form goal-form" id="goalForm" novalidate>
      <div class="form-grid two">
        <div class="field"><label>Goal title *</label><input name="title" required value="${esc(g?.title || '')}" placeholder="e.g. Become Cloud Security Engineer"></div>
        <div class="field"><label>Category *</label><select name="category" required><option value="">Select category</option>${['Education','Finance','Health','Fitness','Personal Growth','Lifestyle','Learning','Career'].map(x => `<option value="${x}" ${x===selectedCategory?'selected':''}>${x}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Emoji</label><input class="emoji-input" name="emoji" value="${esc(g?.emoji || (isFitness?'🏋️':'🎯'))}" placeholder="Choose an emoji" inputmode="text"></div>

      <div class="goal-component-picker">
        <div class="settings-subhead"><b>What does this goal need?</b><small>Use any combination. You do not have to use all three.</small></div>
        <label class="goal-component-option"><input type="checkbox" name="useTarget" ${components.target?'checked':''}><span><b>Target</b><small>The final destination — e.g. 50 → 60 kg, ₹0 → ₹1,00,000, 7.8 → 9.0 CGPA.</small></span></label>
        <label class="goal-component-option"><input type="checkbox" name="useMilestones" ${components.milestones?'checked':''}><span><b>Milestones</b><small>Meaningful checkpoints along the way.</small></span></label>
        <label class="goal-component-option"><input type="checkbox" name="useHabits" ${components.habits?'checked':''}><span><b>Supporting habits</b><small>Repeated actions that help you reach the goal.</small></span></label>
      </div>

      <section id="targetBuilder" class="goal-builder-section">
        <div class="settings-subhead"><b>Target · Destination</b><small>Define the result you want to reach.</small></div>
        <div class="form-grid two">
          <div class="field"><label>Target value *</label><input name="target" type="number" step="any" min="0" value="${esc(g?.target ?? '')}" placeholder="e.g. 60"></div>
          <div class="field"><label>Unit</label><input name="unit" value="${esc(g?.unit || '')}" placeholder="kg, %, ₹, books"></div>
        </div>
      </section>

      <section id="fitnessBuilder" class="goal-builder-section ${isFitness ? '' : 'hidden'}">
        <div class="settings-subhead"><b>Fitness target</b><small>Weight tracking is built into a Fitness goal.</small></div>
        <div class="form-grid two">
          <div class="field"><label>Objective</label><select name="fitnessDirection"><option value="gain" ${fitness.direction!=='loss'?'selected':''}>Gain weight / build mass</option><option value="loss" ${fitness.direction==='loss'?'selected':''}>Lose weight / reduce mass</option></select></div>
          <div class="field"><label>Starting weight (kg) *</label><input name="startWeight" type="number" step="0.1" min="1" value="${esc(fitness.startWeight ?? g?.current ?? '')}"></div>
          <div class="field"><label>Target weight (kg) *</label><input name="targetWeight" type="number" step="0.1" min="1" value="${esc(fitness.targetWeight ?? g?.target ?? '')}"></div>
          <div class="field"><label>Height (cm) <small>optional</small></label><input name="height" type="number" step="0.1" min="1" value="${esc(fitness.height ?? '')}"></div>
        </div>
      </section>

      <section id="milestoneBuilder" class="goal-builder-section ${components.milestones?'':'hidden'}">
        <div class="settings-subhead"><b>Milestones · Checkpoints</b><small>For measurable milestones, enter a value. Fitness milestones are completed automatically from your weight.</small></div>
        <div id="milestoneRows">${milestoneRows}</div>
        <button type="button" class="secondary-btn" id="addMilestone">+ Add milestone</button>
      </section>

      <section id="habitBuilder" class="goal-builder-section ${components.habits?'':'hidden'}">
        <div class="settings-subhead"><b>Supporting habits</b><small>Select existing habits that contribute to this goal. Habit progress remains on the Habits page.</small></div>
        <div class="goal-habit-list">${habitOptions || '<div class="muted-copy">Create a habit first, then link it here.</div>'}</div>
      </section>

      <div class="form-grid two">
        <div class="field"><label>Target date <small>optional</small></label><input name="date" type="date" value="${esc(g?.date || '')}"></div>
        <div class="field"><label>Notification time</label><input name="reminder" class="time-text-input" type="text" value="${esc(g?.reminder ? formatTimeShort(g.reminder) : '')}" placeholder="${userTimeFormat()==='12h'?'8:00 PM':'20:00'}" autocomplete="off"></div>
      </div>
      ${id ? `<label class="switch-row"><span><b>Pause goal</b><small>Pause without losing progress.</small></span><input type="checkbox" name="paused" ${g?.status === 'paused' ? 'checked' : ''}><i></i></label>` : ''}
      <div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button><button type="submit" class="primary-btn" data-goal-submit>${id ? 'Save Changes' : 'Create Goal'} →</button></div>
    </form>`);

  const form=document.getElementById('goalForm');
  if(!form) return;
  const targetBuilder=form.querySelector('#targetBuilder');
  const fitnessBuilder=form.querySelector('#fitnessBuilder');
  const milestoneBuilder=form.querySelector('#milestoneBuilder');
  const habitBuilder=form.querySelector('#habitBuilder');
  const targetInput=form.querySelector('[name="target"]');
  const targetUnit=form.querySelector('[name="unit"]');
  const categoryInput=form.querySelector('[name="category"]');

  function syncBuilder() {
    const fitnessNow = categoryInput.value === 'Fitness' || isFitness;
    if (fitnessNow) {
      form.querySelector('[name="useTarget"]').checked = true;
    }
    const useTarget=form.querySelector('[name="useTarget"]').checked;
    const useMilestones=form.querySelector('[name="useMilestones"]').checked;
    const useHabits=form.querySelector('[name="useHabits"]').checked;
    targetBuilder.classList.toggle('hidden', !useTarget || fitnessNow);
    fitnessBuilder.classList.toggle('hidden', !fitnessNow);
    milestoneBuilder.classList.toggle('hidden', !useMilestones);
    habitBuilder.classList.toggle('hidden', !useHabits);
    targetInput.required=useTarget && !fitnessNow;
    targetInput.disabled=!useTarget || fitnessNow;
    targetUnit.disabled=!useTarget || fitnessNow;
  }
  form.querySelectorAll('input[name^="use"]').forEach(x=>x.addEventListener('change',syncBuilder));
  categoryInput?.addEventListener('change',()=>{ syncBuilder(); });
  form.querySelector('#addMilestone')?.addEventListener('click',()=>{
    const row=document.createElement('div');
    row.className='goal-builder-row milestone-builder-row';
    row.innerHTML='<input class="gh-title" name="milestoneTitle" placeholder="Checkpoint name"><input class="gh-value" name="milestoneValue" type="number" step="any" placeholder="Value"><button type="button" class="remove-builder">×</button>';
    row.querySelector('.remove-builder').addEventListener('click',()=>row.remove());
    form.querySelector('#milestoneRows').appendChild(row);
  });
  form.querySelectorAll('[data-remove-milestone]').forEach(b=>b.addEventListener('click',()=>b.closest('.milestone-builder-row')?.remove()));
  syncBuilder();

  const submitGoal = () => {
    const fd=new FormData(form), title=String(fd.get('title')||'').trim(), category=String(fd.get('category')||''), date=String(fd.get('date')||'');
    const useTarget=fd.get('useTarget')==='on', useMilestones=fd.get('useMilestones')==='on', useHabits=fd.get('useHabits')==='on';
    if(!title) { toast('Enter a goal title'); form.querySelector('[name="title"]')?.focus(); return; }
    if(!category) { toast('Choose a goal category'); categoryInput?.focus(); return; }
    if(!useTarget&&!useMilestones&&!useHabits) { toast('Select at least one goal component'); return; }

    let type='target';
    if(isFitness || category === 'Fitness') type='fitness';
    else if(useTarget) type='target';
    else if(useMilestones) type='milestone';
    else type='habit';

    let target=Math.max(1,Number(fd.get('target'))||1);
    let unit=String(fd.get('unit')||'').trim();
    let nextFitness=g?.fitness ? clone(g.fitness) : null;

    if(type==='fitness') {
      const direction=String(fd.get('fitnessDirection')||'gain');
      const startWeight=Number(fd.get('startWeight')), targetWeight=Number(fd.get('targetWeight'));
      if(!Number.isFinite(startWeight)||!Number.isFinite(targetWeight)||startWeight<=0||targetWeight<=0) { toast('Enter valid start and target weights'); return; }
      if((direction==='gain'&&targetWeight<=startWeight)||(direction==='loss'&&targetWeight>=startWeight)) { toast(direction==='gain'?'Target weight must be higher than starting weight':'Target weight must be lower than starting weight'); return; }
      nextFitness=nextFitness||{weightEntries:[],measurements:[],workouts:[]};
      Object.assign(nextFitness,{direction,startWeight,targetWeight,height:Number(fd.get('height'))||0,age:Number(nextFitness.age)||0,gender:String(nextFitness.gender||'')});
      if(!Array.isArray(nextFitness.weightEntries)||!nextFitness.weightEntries.length) nextFitness.weightEntries=[{id:uid('fw'),date:todayISO(),weight:startWeight,bodyFat:0,notes:'Starting weight',updatedAt:new Date().toISOString()}];
      target=targetWeight; unit='kg';
    }

    const milestones=[];
    const titles=fd.getAll('milestoneTitle'), values=fd.getAll('milestoneValue');
    titles.forEach((t,i)=>{const mt=String(t||'').trim(); if(!mt)return; const value=String(values[i]??'').trim(); const numeric=value===''?null:Number(value); milestones.push({id:uid('gm'),title:mt,value:Number.isFinite(numeric)?numeric:null,completed:false,completedAt:'',updatedAt:new Date().toISOString()});});
    const oldMilestones=Array.isArray(g?.milestones)?g.milestones:[];
    milestones.forEach(m=>{const oldm=oldMilestones.find(x=>String(x.title||'').trim().toLowerCase()===m.title.toLowerCase() && (m.value==null || Number(x.value)===Number(m.value)));if(oldm){m.id=oldm.id;m.completed=!!oldm.completed;m.completedAt=oldm.completedAt||'';}});
    const selectedHabitIds=fd.getAll('goalHabit').map(String);

    const payload={title,category,emoji:String(fd.get('emoji')||'🎯').trim()||'🎯',type,target,current:type==='fitness'?fitnessCurrentWeight({fitness:nextFitness,type:'fitness',current:Number(fd.get('startWeight'))||0}):Math.max(0,Number(g?.current)||0),unit,date,reminder:parseTime24(fd.get('reminder'))||'',components:{target:useTarget||type==='fitness',milestones:useMilestones,habits:useHabits},milestones,goalHabitIds:selectedHabitIds,status:fd.get('paused')==='on'?'paused':'active',updatedAt:new Date().toISOString()};
    if(type==='fitness') payload.fitness=nextFitness;
    if(id) Object.assign(g,payload);
    else state.goals.push({...payload,id:uid('g')});
    const savedGoal=id?g:state.goals[state.goals.length-1];
    normalizeGoalComponents(savedGoal);
    if(savedGoal.type==='fitness'){savedGoal.current=fitnessCurrentWeight(savedGoal);savedGoal.status=fitnessGoalStatus(savedGoal);}
    const persisted=save();
    if(!persisted){ toast('Could not save goal. Your changes were not confirmed.'); return; }
    closeModal(); render(); toast(id?'Goal updated':'Goal created');
  };
  // The button is a real submit control; use the form submit event as the single source of truth.
  // A capture-phase fallback is installed below for browsers/extensions that intercept
  // submit events inside dynamically-rendered modal content.
  form.addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); submitGoal(); });

}

function eventForm(idOrDate) {
  const editing = !!state.events.find(e => e.id === idOrDate);
  const existing = editing ? state.events.find(e => e.id === idOrDate) : null;
  const defaultDate = editing ? existing.date : (idOrDate || calendarSelectedDate || todayISO());
  const linkedReminder = existing ? state.reminders.find(r => r.eventId === existing.id && r.source === 'manual') : null;
  const defaultReminderTime = existing
    ? eventReminderTimeValue(existing.date, existing.time, 0)
    : eventReminderTimeValue(defaultDate, '12:00:00', 0);
  modal(editing ? 'Edit event' : 'Add event', editing ? 'Update the event and its reminder settings.' : 'Schedule an event. Habitly will remind you at the scheduled event time.', `<form class="form" id="eventForm">
    <div class="form-grid two">
      <div class="field"><label>Event title *</label><input name="title" required value="${esc(existing?.title || '')}" placeholder="e.g. Team Meeting"></div>
      <div class="field"><label>Emoji</label><input name="emoji" class="emoji-input" value="${esc(existing?.emoji || '📅')}" placeholder="Choose an emoji" inputmode="text"></div>
    </div>
    <div class="form-grid two">
      <div class="field"><label>Date *</label><input name="date" type="date" required value="${esc(defaultDate)}"></div>
      <div class="field"><label>Time *</label><input name="time" class="time-text-input" type="text" required value="${esc(formatTimeShort(existing?.time || '12:00:00'))}" placeholder="${userTimeFormat()==='12h'?'12:00 PM':'12:00'}" autocomplete="off"></div>
    </div>
    <div class="event-notification-note"><span>${icon('bell')}</span><div><b>Event reminder</b><small>Habitly will notify you at the exact scheduled event time. There is no separate “remind me before” setting.</small></div></div>
    <div class="field"><label>Reminder sound</label><div class="form-grid two"><select name="sound">${[['gentle','Gentle Bell'],['chime','Soft Chime'],['calm','Calm'],['classic','Classic'],['simple','Simple'],['bright','Bright'],['marimba','Marimba'],['digital','Digital'],['none','No Sound']].map(([v,t]) => `<option value="${v}" ${v === (linkedReminder?.sound || 'gentle') ? 'selected' : ''}>${t}</option>`).join('')}</select><button type="button" class="secondary-btn reminder-preview-btn" id="previewEventSound">▶ Preview sound</button></div></div>
    <div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button>${editing ? '<button type="button" class="danger-btn" id="deleteEvent">Delete Event</button>' : ''}<button class="primary-btn">${editing ? 'Save Changes' : 'Add Event'} →</button></div>
  </form>`);
  const form = document.getElementById('eventForm'); if (!form) return;
  form.querySelector('#previewEventSound')?.addEventListener('click', () => playReminderSound(String(form.querySelector('[name="sound"]')?.value || 'gentle')));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const title = String(fd.get('title') || '').trim(), date = String(fd.get('date') || ''), time = parseTime24(fd.get('time'));
    if (!title || !date || !time) { toast('Enter an event title, date and time'); return; }
    const now = new Date().toISOString();
    let event = existing;
    if (event) Object.assign(event, { title, emoji:String(fd.get('emoji') || '📅').trim() || '📅', date, time, updatedAt:now });
    else { event = { id:uid('e'), title, emoji:String(fd.get('emoji') || '📅').trim() || '📅', date, time, updatedAt:now }; state.events.push(event); }
    const wantsReminder = state.settings?.notifications?.eventReminders !== false;
    const offsetMinutes = 0;
    // Event reminders always use the event's exact scheduled time.
    const reminderTime = eventReminderTimeValue(date, time, 0) || time;
    const sound = String(fd.get('sound') || 'gentle');
    const old = state.reminders.find(r => r.eventId === event.id && r.source === 'manual');
    if (wantsReminder) {
      if (old) Object.assign(old, { time:reminderTime, offsetMinutes, sound, enabled:true, eventId:event.id, source:'manual', updatedAt:now });
      else state.reminders.push({ id:uid('r'), eventId:event.id, time:reminderTime, offsetMinutes, sound, enabled:true, source:'manual', updatedAt:now });
    } else if (old) {
      state.reminders = state.reminders.filter(r => r !== old);
      state.syncMeta = state.syncMeta || clone(defaultState.syncMeta);
      state.syncMeta.deleted = state.syncMeta.deleted || clone(defaultState.syncMeta.deleted);
      state.syncMeta.deleted.reminders = state.syncMeta.deleted.reminders || {};
      state.syncMeta.deleted.reminders[old.id] = now;
    }
    save(); closeModal(); render(); checkReminderNotifications(true); refreshReminderUi(); toast(editing ? 'Event updated' : 'Event added');
  });
  form.querySelector('#deleteEvent')?.addEventListener('click', () => {
    const now = new Date().toISOString();
    state.events = state.events.filter(e => e.id !== existing.id);
    const linked = state.reminders.filter(r => r.eventId === existing.id);
    state.reminders = state.reminders.filter(r => r.eventId !== existing.id);
    state.syncMeta = state.syncMeta || clone(defaultState.syncMeta);
    state.syncMeta.deleted = state.syncMeta.deleted || clone(defaultState.syncMeta.deleted);
    state.syncMeta.deleted.events = state.syncMeta.deleted.events || {};
    state.syncMeta.deleted.events[existing.id] = now;
    state.syncMeta.deleted.reminders = state.syncMeta.deleted.reminders || {};
    linked.forEach(r => state.syncMeta.deleted.reminders[r.id] = now);
    save(); closeModal(); render(); refreshReminderUi(); toast('Event deleted');
  });
}


function pageContent(route) {
  return route === 'dashboard' ? dashboard() :
    route === 'habits' ? habitsPage() :
      route === 'goals' ? goalsPage() :
        route === 'calendar' ? calendarPage() :
          route === 'statistics' ? statisticsPage() :
            settingsPage();
}
function currentRoute() {
  const r = location.hash.replace(/^#\//, '');
  return ROUTES.includes(r) ? r : 'dashboard';
}
function maybeAutoBackupOnOpen() {
  const mode = storageMode();
  const d = driveSettings();
  // driveLoginSyncPending being true means the post-login pull-from-Drive
  // hasn't finished yet (or failed and is waiting on a safe retry). Uploading
  // here first would overwrite the real Drive backup with a stale/unmerged
  // local copy, so this waits for that sync to settle instead.
  if (!currentAuthUser || !cloudStorageSelected() || !storageIsConfigured() || !d.connected || d.autoDaily === false || d.lastBackupDate === todayISO() || cloudSyncBusy || pendingMutations(state).length) return;
  const run = () => { if (!googleAccessToken || driveLoginSyncPending) return; uploadDriveBackup(); };
  if (googleAccessToken) setTimeout(run, 400);
  else if (ensureDriveClient()) { requestDriveToken('', { silent: true }).catch(e => console.warn('Automatic Drive authorization unavailable:', e)); }
}
function render() {
  const raw = location.hash.replace(/^#\//, '');
  const route = ROUTES.includes(raw) ? raw : 'dashboard';
  document.getElementById('app').innerHTML = pageContent(route);
  bindCommon();
  if (route === 'habits') { renderHabitCards(); bindHabitPage(); }
  if (route === 'goals') { renderGoals(); bindGoalPage(); }
  if (route === 'calendar') initCalendar();
  if (route === 'statistics') initStatistics();
  if (route === 'settings') initSettings();
  setTodayLabels();
  if (route === 'dashboard' && currentAuthUser && !storageIsConfigured()) setTimeout(showStorageOnboarding, 120);
  if (route === 'dashboard') maybeAutoBackupOnOpen();
}

function setTodayLabels() {
  const update = () => {
    const d = new Date();
    const dateText = d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    const timeText = formatTime(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`);
    document.querySelectorAll('.today-label').forEach(x => x.textContent = dateText);
    document.querySelectorAll('.today-time').forEach(x => x.textContent = ` · ${timeText}`);
  };
  update();
  if (!headerClockTimer) {
    const scheduleNextMinute = () => {
      update();
      const delay = Math.max(250, 60000 - (Date.now() % 60000) + 50);
      headerClockTimer = setTimeout(scheduleNextMinute, delay);
    };
    headerClockTimer = setTimeout(scheduleNextMinute, Math.max(250, 60000 - (Date.now() % 60000) + 50));
  }
}
function navigate(route) { if (!ROUTES.includes(route)) return; location.hash = '/' + route; }
function bindCommon() {
  document.querySelectorAll('[data-route]').forEach(b => b.addEventListener('click', () => { navigate(b.dataset.route); closeDrawer(); }));
  document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', async () => {
    closeDrawer();
    try {
      if (window.habitlySupabase) {
        const { error } = await window.habitlySupabase.auth.signOut();
        if (error) throw error;
      }
    } catch (error) {
      console.error('Habitly logout failed:', error);
      toast('Could not sign out. Please try again.');
      return;
    }
    clearAuthenticatedState();
    if (typeof window.habitlyShowLogin === 'function') window.habitlyShowLogin();
    else location.hash = '/login';
  })); document.querySelectorAll('[data-open-account]').forEach(b => b.addEventListener('click', () => { navigate('settings'); closeDrawer(); }));
  const t = document.getElementById('menuToggle'); if (t) t.addEventListener('click', openDrawer);
  document.querySelectorAll('[data-close-drawer]').forEach(b => b.addEventListener('click', closeDrawer));
  document.querySelectorAll('[data-install-app]').forEach(b => b.addEventListener('click', async e => {
    e.preventDefault();
    if (deferredInstallPrompt) {
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice?.outcome === 'accepted') toast('Habitly installed successfully');
        else toast('Installation cancelled');
      } catch (err) {
        console.error('Install prompt failed:', err);
        toast('Could not open the install prompt');
      }
      return;
    }
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (standalone) { toast('Habitly is already installed'); return; }
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
      toast('Tap Share in Safari, then choose Add to Home Screen');
    } else {
      toast('Open your browser menu and choose Install app or Add to Home screen');
    }
  }));
  document.querySelectorAll('[data-reminders]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); document.getElementById('reminderPopover')?.classList.toggle('hidden'); }));
  bindReminderControls(document);
  document.querySelectorAll('[data-close-reminders]').forEach(b => b.addEventListener('click', () => document.getElementById('reminderPopover')?.classList.add('hidden')));
  document.addEventListener('keydown', keyHandler, { once: true });
  document.querySelectorAll('[data-open-habit]').forEach(b => b.addEventListener('click', () => habitForm()));
  if (currentRoute() === 'dashboard') {
    const root = document.getElementById('dashboardHabits'); if (root) bindHabitInteractions(root);
    document.querySelectorAll('[data-filter-group="dashboard"] .filter').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-filter-group="dashboard"] .filter').forEach(x => x.classList.toggle('active', x === b)); const filter = b.dataset.filter; const habits = state.habits.filter(h => !h.paused && (filter === 'All' || h.category === filter)); if (root) root.innerHTML = habits.map(h => habitRow(h)).join('') || '<div class="empty-state"><strong>No habits in this category.</strong></div>'; if (root) bindHabitInteractions(root); }));
  }
}
function keyHandler(e) { if (e.key === 'Escape') { closeDrawer(); closeModal(); document.querySelectorAll('.menu-popover').forEach(x => x.remove()); } }
function openDrawer() { const d = document.getElementById('drawer'); if (d) { d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); document.body.classList.add('drawer-open'); } }
function closeDrawer() { const d = document.getElementById('drawer'); if (d) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); document.body.classList.remove('drawer-open'); } }
function toast(message) { const t = document.getElementById('toast'); if (!t) return; clearTimeout(window.__toast); clearTimeout(window.__undoToast); t.innerHTML = `<span>${esc(message)}</span>`; t.classList.remove('toast-with-action'); t.classList.add('show'); window.__toast = setTimeout(() => { t.classList.remove('show'); t.innerHTML = ''; }, 2200); }
function showUndoToast(message, undo) { const t = document.getElementById('toast'); if (!t) return; clearTimeout(window.__toast); clearTimeout(window.__undoToast); t.innerHTML = `<span>${esc(message)}</span><button type="button" class="toast-undo" id="toastUndo">Undo</button><i class="toast-timer"></i>`; t.classList.add('show', 'toast-with-action'); const btn=document.getElementById('toastUndo'); btn?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearTimeout(window.__undoToast); t.classList.remove('show', 'toast-with-action'); t.innerHTML = ''; undo(); }); window.__undoToast = setTimeout(() => { t.classList.remove('show', 'toast-with-action'); t.innerHTML = ''; pendingUndo = null; }, 6000); }
function modal(title, subtitle, html) { document.getElementById('modal-root').innerHTML = `<div class="modal-backdrop" data-modal-close><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" onclick="event.stopPropagation()"><button class="modal-close" data-modal-close aria-label="Close">×</button><div class="modal-head"><h2>${esc(title)}</h2><p>${esc(subtitle || '')}</p></div>${html}</section></div>`; document.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', closeModal)); }
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

// Modal action safety net: dynamically-rendered Goal forms should never depend on
// bubbling through the modal shell. Capture the click before the modal backdrop
// or any other delegated handler can consume it, then submit the actual form.
if (!window.__habitlyGoalSubmitGuard) {
  window.__habitlyGoalSubmitGuard = true;
  document.addEventListener('click', e => {
    const button = e.target.closest?.('#goalForm [data-goal-submit]');
    if (!button) return;
    const form = button.form || document.getElementById('goalForm');
    if (!form) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (typeof form.requestSubmit === 'function') form.requestSubmit(button);
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }, true);
}
document.addEventListener('click', e => {
  const addGoalButton = e.target.closest('[data-open-goal]');
  if (addGoalButton) { e.preventDefault(); e.stopPropagation(); goalForm(); return; }
  const addEventButton = e.target.closest('[data-add-event]');
  if (addEventButton) { e.preventDefault(); e.stopPropagation(); eventForm(calendarSelectedDate); return; }
  const action = e.target.closest('[data-menu-action]'); if (action) { const kind = action.closest('.menu-popover').dataset.kind, id = action.dataset.menuId; const obj = kind === 'goal' ? state.goals.find(g => g.id === id) : state.habits.find(h => h.id === id); if (!obj) return; const a = action.dataset.menuAction; if (a === 'update' && kind === 'goal') goalProgressForm(id); if (a === 'edit') kind === 'goal' ? goalForm(id) : habitForm(id); if (a === 'reminder' && kind === 'habit') { const existingReminder = state.reminders.find(r => r.habitId === id && r.source === 'manual'); reminderForm(existingReminder?.id); } if (a === 'trash') confirmDelete(kind, id); if (a === 'pause' && kind === 'goal') { obj.status = 'paused'; obj.updatedAt = new Date().toISOString(); save(); render(); toast('Goal paused'); }
    if (a === 'pause' && kind === 'habit') { obj.paused = !obj.paused; obj.updatedAt = new Date().toISOString(); save(); render(); toast(obj.paused ? 'Habit paused' : 'Habit resumed'); } if (a === 'complete' && kind === 'goal') { obj.current = obj.target; obj.status = 'completed'; obj.updatedAt = new Date().toISOString(); save(); render(); toast('Goal completed'); } document.querySelectorAll('.menu-popover').forEach(x => x.remove()); return; } if (!e.target.closest('.menu-popover') && !e.target.closest('[data-menu]')) document.querySelectorAll('.menu-popover').forEach(x => x.remove()); if (!e.target.closest('#reminderPopover') && !e.target.closest('[data-reminders]')) document.getElementById('reminderPopover')?.classList.add('hidden'); });
function confirmDelete(kind, id) {
  const label = kind === 'goal' ? 'goal' : 'habit';
  modal(`Delete ${label}`, 'You will have a few seconds to undo this action.', `<div class="confirm-box"><p>Are you sure you want to delete this ${label}?</p><div class="form-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="danger-btn" id="confirmDelete">Delete ${label}</button></div></div>`);
  document.getElementById('confirmDelete').addEventListener('click', () => {
    const collection = kind === 'goal' ? state.goals : state.habits;
    const index = collection.findIndex(x => x.id === id);
    if (index < 0) return;
    const deleted = clone(collection[index]);
    if (kind === 'habit') {
      state.syncMeta = state.syncMeta || clone(defaultState.syncMeta);
      state.syncMeta.deleted = state.syncMeta.deleted || clone(defaultState.syncMeta.deleted);
      state.syncMeta.deleted.habits = state.syncMeta.deleted.habits || {};
      const deletedAt = new Date().toISOString();
      state.syncMeta.deleted.habits[id] = deletedAt;
      state.syncMeta.deleted.reminders = state.syncMeta.deleted.reminders || {};
      // A deleted habit cannot keep an orphaned manual reminder alive. Tombstone
      // linked reminders too so another device cannot resurrect them.
      state.reminders.filter(r => r.habitId === id).forEach(r => { state.syncMeta.deleted.reminders[r.id] = deletedAt; });
      state.reminders = state.reminders.filter(r => r.habitId !== id);
    } else {
      state.syncMeta = state.syncMeta || clone(defaultState.syncMeta);
      state.syncMeta.deleted = state.syncMeta.deleted || clone(defaultState.syncMeta.deleted);
      state.syncMeta.deleted.goals = state.syncMeta.deleted.goals || {};
      state.syncMeta.deleted.goals[id] = new Date().toISOString();
    }
    collection.splice(index, 1);
    save();
    closeModal();
    render();
    pendingUndo = { kind, deleted, index };
    showUndoToast(`${label[0].toUpperCase() + label.slice(1)} deleted`, () => {
      const pending = pendingUndo;
      if (!pending || pending.deleted.id !== deleted.id || pending.kind !== kind) return;
      const target = kind === 'goal' ? state.goals : state.habits;
      if (!target.some(x => x.id === deleted.id)) target.splice(Math.min(index, target.length), 0, clone(deleted));
      const tombstones = state.syncMeta?.deleted?.[kind === 'goal' ? 'goals' : 'habits'];
      if (tombstones) delete tombstones[deleted.id];
      pendingUndo = null;
      save();
      render();
      toast(`${label[0].toUpperCase() + label.slice(1)} restored ✓`);
    });
  });
}


window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; if (currentRoute() === 'settings') render(); });
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; if (currentRoute() === 'settings') render(); toast('Habitly installed successfully'); });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', {
        updateViaCache: 'none'
      });
      await registration.update();
    } catch (e) {
      console.warn('Habitly service worker registration failed', e);
    }
  });
}

async function registerAuthenticatedVisitor(nextUser) {
  const sb = window.habitlySupabase;
  if (!sb || !nextUser?.email) return;
  const name = String(nextUser.user_metadata?.full_name || nextUser.user_metadata?.name || nextUser.email.split('@')[0] || 'Habitly User').trim();
  try {
    const { error } = await sb.rpc('register_visitor', { p_name: name, p_email: nextUser.email });
    if (error) console.warn('Habitly visitor registration failed:', error.message);
  } catch (error) {
    console.warn('Habitly visitor registration failed:', error);
  }
}

async function handleAuthenticatedUser(nextUser) {
  if (driveHydrationConfirmedUserId && driveHydrationConfirmedUserId !== nextUser?.id) driveHydrationConfirmedUserId = '';
  state = loadStateForUser(nextUser);
  registerAuthenticatedVisitor(nextUser);
  resetSyncTracking(state);
  if (!state.profile.email) state.profile.email = nextUser.email || '';
  // Authenticated Habitly accounts always use Supabase as the authoritative
  // cross-device source. Legacy local/Drive metadata is migrated to cloud mode.
  state.settings.storage = { mode: 'cloud', setupCompleted: true };
  startReminderService();
  try { await persistStorageChoice('cloud'); } catch (_) {}
  appPhase = 'READY';
  initializeCloudSync().finally(() => {
    if (currentAuthUser?.id !== nextUser.id) return;
    subscribeCloudRealtime();
    startCloudPolling();
    if (location.hash !== '#/login') render();
  });
}

function clearAuthenticatedState() {
  clearTimeout(driveBackupTimer);
  clearTimeout(driveLoginSyncRetryTimer);
  stopCloudSync();
  clearInterval(window.__habitlyCloudPoll);
  clearTimeout(driveSyncRetryTimer);
  clearInterval(driveRealtimePollTimer);
  clearInterval(reminderUiTimer);
  clearInterval(headerClockTimer);
  clearTimeout(headerClockTimer);
  headerClockTimer = null;
  clearTimeout(reminderSchedulerTimer);
  reminderUiTimer = null;
  reminderSchedulerTimer = null;
  driveBackupTimer = null;
  driveLoginSyncRetryTimer = null;
  driveSyncRetryTimer = null;
  driveLoginSyncPending = false;
  driveLoginSyncBusy = false;
  driveLoginSyncedUserId = '';
  driveHydrationConfirmedUserId = '';
  driveHydrationGeneration = 0;
  driveLoginSyncRetryUsed = false;
  driveLoginSyncWaitAttempts = 0;
  driveSyncRetryCount = 0;
  driveUploadQueued = false;
  googleDriveBusy = false;
  googleAccessToken = '';
  googleTokenExpiresAt = 0;
  driveRemoteMissing = false;
  driveLastKnownRemoteModifiedAt = '';
  driveLastSyncCheckAt = 0;
  currentAuthUser = null;
  currentStorageKey = '';
  syncBaseState = null;
  syncLastSavedSnapshot = null;
  syncGeneration = 0;
  syncDirty = { habits:false, goals:false, events:false, reminders:false, profile:false, settings:false, activityHistory:false };
  state = freshUserState(null);
  appPhase = 'READY';
  closeModal();
  closeDrawer();
  if (location.hash !== '#/login') history.replaceState(null, '', '#/login');
  document.getElementById('app').innerHTML = '';
}

if (typeof window !== 'undefined') {
  window.__habitlyTestHooks = {
    setState: next => { state = normalizeState(clone(next)); },
    setAuthUser: user => { currentAuthUser = user || null; },
    setGoogleAccessToken: token => { googleAccessToken = String(token || ''); googleTokenExpiresAt = Date.now() + 3600000; },
    uploadDriveBackup: options => uploadDriveBackup(options),
    checkDriveForExternalChanges: () => checkDriveForExternalChanges(),
    getState: () => clone(state),
    resetSyncTracking: () => resetSyncTracking(state),
    save: options => save(options),
    appendSyncMutations: (previous, current) => appendSyncMutations(previous, current),
    mergeForDriveUpload: (remote, local, dirty, base) => mergeForDriveUpload(remote, local, dirty, base),
    mergeCloudHydration: (remote, local) => mergeCloudHydration(remote, local),
    isSuspiciousEmptySync: (local, remote, mutations) => isSuspiciousEmptySync(local, remote, mutations),
    cloudDocumentState: source => cloudDocumentState(source),
    validateCloudDocument: row => validateCloudDocument(row),
    updateCloudDocument: (revision, next) => updateCloudDocument(revision, next),
    flushCloudSync: () => flushCloudSync(),
    reconcileCloudDocument: () => reconcileCloudDocument(),
    cloudStatusText: () => cloudStatusText(),
    eventNotificationCount: () => eventNotificationCount(),
    normalizeReminderDays: days => normalizeReminderDays(days),
    nextReminderOccurrence: (r, from) => nextReminderOccurrence(r, from),
    reminderDaysLabel: days => reminderDaysLabel(days),
    reminderOverviewMarkup: date => reminderOverviewMarkup(date || calendarSelectedDate),
    refreshReminderBadge: () => refreshReminderBadge(),
    deleteReminderById: id => deleteReminderById(id),
    showReminderNotification: reminder => showReminderNotification(reminder),
  };
}

async function bootstrapApp() {
  const sb = window.habitlySupabase;
  if (sb) {
    window.addEventListener('habitly-auth-state', event => {
      const { event: authEvent, session } = event.detail || {};
      const nextUser = session?.user || null;
      const nextId = nextUser?.id || '';
      const currentId = currentAuthUser?.id || '';

      if (authEvent === 'SIGNED_OUT') {
        clearAuthenticatedState();
        return;
      }
      if (!nextUser || nextId === currentId) return;
      if (authEvent === 'TOKEN_REFRESHED') return;
      if (authEvent === 'PASSWORD_RECOVERY') return;
      if (authEvent === 'INITIAL_SESSION' || authEvent === 'SIGNED_IN' || authEvent === 'USER_UPDATED') {
        handleAuthenticatedUser(nextUser).catch(error => {
          console.error('Habitly authenticated-state bootstrap failed:', error);
          appPhase = 'READY';
          render();
        });
      }
    });

    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (data?.session?.user) await handleAuthenticatedUser(data.session.user);
      else clearAuthenticatedState();
    } catch (e) {
      console.error('Habitly session bootstrap failed:', e);
      clearAuthenticatedState();
    }
  } else {
    clearAuthenticatedState();
  }
  if (!location.hash) location.hash = currentAuthUser ? '/dashboard' : '/login';
  render();
  startDriveRealtimePolling();
}

let lastDriveVisibilitySyncAt = 0;
let driveRealtimePollTimer = null;
let syncChannel = null;
try { syncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('habitly-sync-v2') : null; } catch (_) { syncChannel = null; }
function announceLocalMutation() { try { syncChannel?.postMessage({ type:'STATE_CHANGED', userId:currentAuthUser?.id || '', at:Date.now() }); } catch (_) {} }
function startDriveRealtimePolling() {
  clearInterval(driveRealtimePollTimer);
  driveRealtimePollTimer = setInterval(async () => {
    if (document.visibilityState !== 'visible' || !currentAuthUser || cloudStorageSelected() || !driveStorageSelected() || driveLoginSyncBusy || driveLoginSyncPending) return;
    if (!googleAccessToken || Date.now() >= googleTokenExpiresAt - 60000) {
      if (ensureDriveClient()) {
        try { await requestDriveToken('', { silent: true }); } catch (_) { return; }
      } else return;
    }
    checkDriveForExternalChanges().catch(()=>{});
  }, 2000);
}
if (syncChannel) syncChannel.addEventListener('message', event => {
  if (event.data?.type !== 'STATE_CHANGED' || event.data.userId !== currentAuthUser?.id || document.visibilityState !== 'visible') return;
  if (cloudStorageSelected()) {
    reconcileCloudDocument().then(changed => {
      if (changed && currentRoute() !== 'login') render();
      if (pendingMutations(state).length) scheduleCloudSync();
    }).catch(()=>{});
  } else if (driveStorageSelected()) {
    checkDriveForExternalChanges().catch(()=>{});
  }
});
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  checkReminderNotifications(true);
  refreshReminderUi();
  if (!currentAuthUser || cloudStorageSelected() || !driveStorageSelected()) return;
  const now = Date.now();
  if (now - lastDriveVisibilitySyncAt < 2000 || driveLoginSyncBusy || driveLoginSyncPending) return;
  lastDriveVisibilitySyncAt = now;
  // A visible app may have been changed on another device. Pull the latest
  // backup before allowing the normal local-to-Drive sync cycle to continue.
  if (googleAccessToken && Date.now() < googleTokenExpiresAt - 60000) {
    checkDriveForExternalChanges().catch(e => console.warn('Drive visibility sync skipped:', e));
  }
});
window.addEventListener('focus', () => {
  checkReminderNotifications(true);
  refreshReminderUi();
  if (currentAuthUser && !cloudStorageSelected() && driveStorageSelected() && googleAccessToken && !driveLoginSyncBusy && !driveLoginSyncPending) checkDriveForExternalChanges().catch(() => {});
});
window.addEventListener('online', () => { cloudSyncError = ''; if (cloudStorageSelected()) { scheduleCloudSync(); if (driveStorageSelected()) scheduleDriveBackup(); } });
window.addEventListener('offline', () => { if (pendingMutations(state).length) cloudSyncPending = true; });
window.addEventListener('hashchange', () => { closeModal(); closeDrawer(); render(); });
bootstrapApp();
/* =========================
   START REMINDER SERVICE
========================= */

startReminderService();
setInterval(refreshGreeting, 60000);
