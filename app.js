/* Habitly — unified five-page frontend
   Dashboard / Habits / Goals / Calendar / Statistics
*/
const AS = 'assets/';
const ROUTES = ['dashboard', 'habits', 'goals', 'calendar', 'statistics', 'settings'];
const STORAGE = 'habitly.final.v2';
const USER_STORAGE_PREFIX = 'habitly.final.v3.user.';
let currentAuthUser = null;
let currentStorageKey = '';
// Google Drive OAuth: replace with your Google Cloud Web OAuth client ID.
const GOOGLE_DRIVE_CLIENT_ID = window.HABITLY_CONFIG?.googleDriveClientId || '';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let googleTokenClient = null;
let googleAccessToken = '';
let googleDriveBusy = false;
let deferredInstallPrompt = null;
let cropState = null;
let pendingUndo = null;
let storageOnboardingMode = '';
let storageOnboardingBusy = false;

const defaultState = {
  habits: [
    { id: 'h1', name: 'Drink Water', emoji: '🥤', category: 'Health', target: 8, current: 6, unit: 'glasses', paused: false, created: 1, frequency: 'Daily' },
    { id: 'h2', name: 'Read Book', emoji: '📖', category: 'Personal', target: 30, current: 20, unit: 'pages', paused: false, created: 2, frequency: 'Daily' },
    { id: 'h3', name: 'Workout', emoji: '🏋️', category: 'Fitness', target: 30, current: 30, unit: 'min', paused: false, created: 3, frequency: 'Daily' },
    { id: 'h4', name: 'Meditate', emoji: '🧘', category: 'Mindfulness', target: 15, current: 10, unit: 'min', paused: false, created: 4, frequency: 'Daily' },
    { id: 'h5', name: 'Practice Coding', emoji: '⌨️', category: 'Study', target: 60, current: 0, unit: 'min', paused: false, created: 5, frequency: 'Daily' }
  ],
  goals: [
    { id: 'g1', title: 'Score 90% in Final Exams', emoji: '🎓', category: 'Education', target: 90, current: 65, unit: '%', date: '2026-12-30', status: 'active' },
    { id: 'g2', title: 'Save ₹1,00,000', emoji: '💰', category: 'Finance', target: 100000, current: 45000, unit: '₹', date: '2027-01-31', status: 'active' },
    { id: 'g3', title: 'Lose 8 kg', emoji: '🏋️', category: 'Health', target: 8, current: 5, unit: 'kg', date: '2026-11-15', status: 'active' },
    { id: 'g4', title: 'Learn Data Structures', emoji: '📚', category: 'Learning', target: 100, current: 30, unit: '%', date: '2026-10-30', status: 'active' }
  ],
  events: [
    { id: 'e1', title: 'Team Meeting', date: '2026-08-21', time: '10:00 AM', emoji: '📅' },
    { id: 'e2', title: 'Doctor Appointment', date: '2026-08-22', time: '4:00 PM', emoji: '🗓️' }
  ],
  reminders: [],
  profile: { name: 'Prem Kumar', email: 'premkumar@example.com', avatar: '' },
  activityHistory: {},
  settings: {
    notifications: { daily: true, motivational: true, weekly: true, goal: true },
    habits: { defaultView: 'All Habits', weekStarts: 'Monday', autoComplete: true, keepStreak: true, quickQuantity: true },
    drive: { connected: false, email: '', folderId: '', fileId: '', lastBackupDate: '', lastBackupAt: '', autoDaily: true },
    storage: { mode: 'local', setupCompleted: true }
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
  fresh.settings.storage = { mode: '', setupCompleted: false };
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
  try {
    const raw = currentStorageKey ? localStorage.getItem(currentStorageKey) : null;
    return normalizeState(raw ? mergeState(JSON.parse(raw)) : freshUserState(user));
  } catch (e) { return freshUserState(user); }
}
function loadState() { return loadStateForUser(currentAuthUser); }
function mergeState(saved) {
  const merged = {
    habits: Array.isArray(saved.habits) ? saved.habits : clone(defaultState.habits),
    goals: Array.isArray(saved.goals) ? saved.goals : [],
    events: Array.isArray(saved.events) ? saved.events : [],
    reminders: Array.isArray(saved.reminders) ? saved.reminders : [],
    profile: saved.profile ? { ...clone(defaultState.profile), ...saved.profile } : clone(defaultState.profile),
    activityHistory: saved.activityHistory && typeof saved.activityHistory === 'object' ? saved.activityHistory : {},
    settings: saved.settings ? {
      ...clone(defaultState.settings), ...saved.settings,
      notifications: { ...defaultState.settings.notifications, ...(saved.settings.notifications || {}) },
      habits: { ...defaultState.settings.habits, ...(saved.settings.habits || {}) },
      drive: { ...defaultState.settings.drive, ...(saved.settings.drive || {}) },
      storage: { ...defaultState.settings.storage, ...(saved.settings.storage || {}) }
    } : clone(defaultState.settings)
  };
  merged.reminders = merged.reminders.filter(r => r && r.source === 'manual');
  return merged;
}
function buildSnapshot(s, date) { return { date, habits: (s.habits || []).map(h => { const current = Math.max(0, Number((h.daily || {})[date] ?? (date === todayISO() ? h.current : 0)) || 0), target = Math.max(1, Number(h.target) || 1); return { id: h.id, name: h.name, emoji: h.emoji || '', category: h.category, paused: !!h.paused, target, unit: h.unit || '', current, percent: Math.min(100, Math.round(current / target * 100)) }; }) }; }
function captureActivitySnapshot(s, date) { s.activityHistory = s.activityHistory || {}; const snap = buildSnapshot(s, date); const meaningful = snap.habits.some(h => h.current > 0); if (meaningful || s.activityHistory[date]) s.activityHistory[date] = snap; }
function normalizeState(s) {
  const today = todayISO();

  // Make sure every major state collection always exists.
  s.habits = Array.isArray(s.habits)
    ? s.habits
    : clone(defaultState.habits);

  s.goals = Array.isArray(s.goals)
    ? s.goals
    : clone(defaultState.goals);

  s.events = Array.isArray(s.events)
    ? s.events
    : clone(defaultState.events);

  s.reminders = Array.isArray(s.reminders)
    ? s.reminders
    : [];

  s.activityHistory =
    s.activityHistory || {};

  s.profile =
    s.profile || clone(defaultState.profile);

  s.settings =
    s.settings || clone(defaultState.settings);

  const hasHistory =
    Object.keys(s.activityHistory).length > 0;

  s.habits = s.habits.map(h => {
    h.daily = {
      ...(h.daily || {})
    };

    if (
      !hasHistory &&
      Object.keys(h.daily).length === 0 &&
      Number(h.current) > 0
    ) {
      h.daily[today] = Math.min(
        Number(h.current) || 0,
        Math.max(
          1,
          Number(h.target) || 1
        )
      );
    }

    h.current = Math.max(
      0,
      Number(
        h.daily[today] ?? 0
      )
    );

    return h;
  });

  const dates =
    new Set(
      Object.keys(s.activityHistory)
    );

  s.habits.forEach(h => {
    Object.keys(
      h.daily || {}
    ).forEach(d =>
      dates.add(d)
    );
  });

  dates.forEach(d =>
    captureActivitySnapshot(
      s,
      d
    )
  );

  captureActivitySnapshot(
    s,
    today
  );

  return s;
}
function save() { try { const t = todayISO(); (state.habits || []).forEach(h => { h.daily = h.daily || {}; h.daily[t] = Math.max(0, Number(h.current) || 0); }); captureActivitySnapshot(state, t); if (currentStorageKey) localStorage.setItem(currentStorageKey, JSON.stringify(state)); } catch (e) { console.error('Habitly save failed:', e); } }

function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function esc(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function todayISO() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString().slice(0, 10); }
function habitCurrent(h, date = todayISO()) { return Math.max(0, Number(date === todayISO() ? h.current : ((h.daily || {})[date] ?? 0)) || 0); }
function habitPctForDate(h, date = todayISO()) { return Math.min(100, Math.round(habitCurrent(h, date) / Math.max(1, Number(h.target) || 1) * 100)); }
function pct(h) { return habitPctForDate(h, todayISO()); }
function goalPct(g) { return Math.min(100, Math.round((Math.max(0, Number(g.current) || 0) / Math.max(1, Number(g.target) || 1)) * 100)); }
function formatDate(value) { return new Date(value + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function daysLeft(date) { const a = new Date(); a.setHours(0, 0, 0, 0); const b = new Date(date + 'T00:00:00'); return Math.ceil((b - a) / 86400000); }
function formatNumber(n) { return Number(n).toLocaleString('en-IN'); }
/* =========================
   REMINDER MANAGER
========================= */

const REMINDER_SOUNDS = {
  gentle: {
    freq: [660, 880],
    dur: [.16, .22]
  },
  chime: {
    freq: [523.25, 659.25, 783.99],
    dur: [.12, .12, .24]
  },
  calm: {
    freq: [392, 523.25],
    dur: [.25, .35]
  },
  classic: {
    freq: [880, 660, 880],
    dur: [.12, .12, .16]
  },
  simple: {
    freq: [660, 660],
    dur: [.10, .18]
  }
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
  return 'habitly_v2_notified_reminders';
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

function reminderDateKey(reminder, date = todayISO()) {
  return `${date}:${reminder.id}:${reminder.time}`;
}

function reminderIsDue(reminder, now = new Date()) {
  if (!reminder || reminder.enabled === false) return false;

  const [hours, minutes] =
    String(reminder.time || '')
      .split(':')
      .map(Number);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return false;
  }

  const currentMinutes =
    now.getHours() * 60 +
    now.getMinutes();

  const reminderMinutes =
    hours * 60 + minutes;

  return currentMinutes === reminderMinutes;
}

function showReminderNotification(reminder) {
  const habit =
    state.habits.find(
      h => h.id === reminder.habitId
    );

  if (!habit || habit.paused) return;

  const title =
    `Habitly Reminder · ${habit.name}`;

  const body =
    `It's time for "${habit.name}".`;

  if (
    notificationSupported() &&
    Notification.permission === 'granted'
  ) {
    try {
      const notification =
        new Notification(title, {
          body,
          icon:
            `${AS}Habitly Leaf Transparent.png`,
          tag:
            `habitly-reminder-${reminder.id}`
        });

      notification.onclick = () => {
        window.focus();
        notification.close();
        navigate('habits');
      };
    } catch (err) {
      console.warn(
        'Browser notification failed:',
        err
      );
    }
  }

  playReminderSound(
    reminder.sound || 'gentle'
  );

  toast(
    `⏰ ${habit.name} reminder`
  );
}

function checkReminderNotifications(force = false) {
  const now = new Date();

  if (
    notificationSupported() &&
    Notification.permission !== 'granted' &&
    !force
  ) {
    return;
  }

  const reminders =
    Array.isArray(state.reminders)
      ? state.reminders
      : [];

  reminders.forEach(reminder => {

    if (!reminderIsDue(reminder, now)) {
      return;
    }

    const key =
      reminderDateKey(
        reminder,
        todayISO()
      );

    const notified =
      getNotifiedReminders();

    if (notified[key]) {
      return;
    }

    markReminderNotified(key);

    showReminderNotification(
      reminder
    );
  });
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
function reminderForm(id) {
  const reminder = id ? state.reminders.find(r => r.id === id && r.source === 'manual') : null;
  const habits = state.habits.filter(h => !h.paused || h.id === reminder?.habitId);
  if (!habits.length) { toast('Create a habit first'); return; }

  const habitId = reminder?.habitId || habits[0].id;
  const selectedHabit = state.habits.find(h => h.id === habitId);

  modal(
    id ? 'Edit reminder' : 'Add reminder',
    id ? 'Update or turn off this reminder.' : 'Choose a habit and set a reminder only when you need one.',
    `<form class="form" id="reminderForm">
      <div class="field"><label>Habit *</label><select name="habitId" required>${habits.map(h => `<option value="${esc(h.id)}" ${h.id === habitId ? 'selected' : ''}>${esc(h.emoji || '🔔')} ${esc(h.name)}</option>`).join('')}</select></div>
      <div class="form-grid two">
        <div class="field"><label>Reminder time *</label><input name="time" type="time" required value="${esc(reminder?.time || '20:00')}"></div>
        <div class="field"><label>Reminder sound</label><select name="sound">${[['gentle','Gentle Bell'],['chime','Soft Chime'],['calm','Calm'],['classic','Classic'],['simple','Simple'],['none','No Sound']].map(([v,t]) => `<option value="${v}" ${v === (reminder?.sound || 'gentle') ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      ${id ? `<label class="switch-row"><span><b>Reminder enabled</b><small>Turn this reminder off without deleting it.</small></span><input type="checkbox" name="enabled" ${reminder?.enabled !== false ? 'checked' : ''}><i></i></label>` : ''}
      <div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button>${id ? '<button type="button" class="danger-btn" id="deleteReminder">Delete Reminder</button>' : ''}<button class="primary-btn">${id ? 'Save Changes' : 'Add Reminder'} →</button></div>
    </form>`
  );

  const form = document.getElementById('reminderForm');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const selectedHabitId = String(fd.get('habitId') || '');
    const time = String(fd.get('time') || '');
    const sound = String(fd.get('sound') || 'gentle');
    const selected = state.habits.find(h => h.id === selectedHabitId);
    if (!selectedHabitId || !time || !selected) { toast('Choose a habit and reminder time'); return; }

    if (id) {
      const existing = state.reminders.find(r => r.id === id);
      if (existing) Object.assign(existing, { habitId: selectedHabitId, time, sound, enabled: fd.get('enabled') === 'on', source: 'manual' });
    } else {
      const existing = state.reminders.find(r => r.habitId === selectedHabitId && r.source === 'manual');
      if (existing) Object.assign(existing, { time, sound, enabled: true, source: 'manual' });
      else state.reminders.push({ id: uid('r'), habitId: selectedHabitId, time, sound, enabled: true, source: 'manual' });
    }
    save(); closeModal(); render(); toast(id ? 'Reminder updated' : 'Reminder added');
  });

  document.getElementById('deleteReminder')?.addEventListener('click', () => {
    state.reminders = state.reminders.filter(r => r.id !== id);
    save(); closeModal(); render(); toast('Reminder deleted');
  });
}
function reminderData() {
  // Reminder center should contain only active/current and upcoming items.
  // Past calendar dates are deliberately excluded so finished events do not
  // remain in the dashboard bell or reminder overview.
  const today = todayISO();
  const events = (state.events || [])
    .filter(e => String(e.date || '') >= today)
    .slice()
    .sort((a, b) => `${a.date || ''} ${a.time || ''}`.localeCompare(`${b.date || ''} ${b.time || ''}`))
    .map(e => ({
      id: e.id,
      emoji: e.emoji || '📅',
      title: e.title,
      date: formatDate(e.date),
      time: e.time || '',
      kind: 'Event'
    }));

  const habits = (state.reminders || [])
    .filter(r => r.source === 'manual' && r.enabled !== false)
    .map(r => {
      const habit = state.habits.find(h => h.id === r.habitId);
      if (!habit || habit.paused) return null;
      return {
        id: r.id,
        emoji: habit.emoji || '🔔',
        title: habit.name,
        date: 'Daily reminder',
        time: r.time || '',
        kind: 'Habit'
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));

  return { events, habits };
}

function eventNotificationCount() {
  const data = reminderData();
  return data.events.length + data.habits.length;
}

function reminderSectionMarkup(title, items, emptyText, options = {}) {
  const { editable = false } = options;
  return `<section class="reminder-section">
    <div class="reminder-section-head"><strong>${esc(title)}</strong><span>${items.length}</span></div>
    ${items.length ? `<div class="reminder-list">${items.map(i => {
      const action = editable
        ? `data-edit-reminder="${esc(i.id)}"`
        : `data-route="calendar"`;
      return `<button class="reminder-item ${editable ? 'is-habit-reminder' : 'is-event-reminder'}" ${action}>
        <span class="reminder-emoji">${esc(i.emoji)}</span>
        <span class="reminder-copy"><strong>${esc(i.title)}</strong><small>${esc(i.date)} · ${esc(i.time)}</small></span>
        <span class="reminder-dot"></span>
      </button>`;
    }).join('')}</div>` : `<div class="reminder-section-empty">${esc(emptyText)}</div>`}
  </section>`;
}

function reminderPanel() {
  const data = reminderData();
  return `<div class="reminder-popover hidden" id="reminderPopover" role="dialog" aria-label="Reminders">
    <div class="reminder-head">
      <div><strong>Reminders</strong><small>Events and habit reminders you have set</small></div>
      <button class="reminder-close" data-close-reminders aria-label="Close reminders">×</button>
    </div>
    <div class="reminder-sections">
      ${reminderSectionMarkup('Reminder Events', data.events, 'No calendar events yet.')}
      ${reminderSectionMarkup('Reminder Habits', data.habits, 'No habit reminders are set.', { editable: true })}
    </div>
    <button class="reminder-view" data-route="calendar">View calendar →</button>
  </div>`;
}

function topActions() { return `<div class="top-actions"><button class="action-icon reminder" aria-label="Reminders" data-reminders>${icon('bell')}<span class="badge">${eventNotificationCount()}</span></button><div class="date">${icon('calendar')}<span class="today-label"></span></div><button class="profile-mini" data-route="settings" aria-label="Open account settings">${avatarMarkup()}</button><button class="profile-chevron" data-route="settings" aria-label="Account settings">${icon('chevron')}</button></div>`; }
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
      ${isYesNo ? `<div class="yesno-controls"><button type="button" class="yesno-choice ${done ? 'selected' : ''}" data-habit-action="yes" aria-pressed="${done}">Yes</button><button type="button" class="yesno-choice ${!done ? 'selected' : ''}" data-habit-action="no" aria-pressed="${!done}">No</button></div>` : `<div class="quantity-controls"><button class="qty-btn" data-habit-action="minus" aria-label="Decrease ${esc(h.name)}">${icon('minus')}</button><span class="qty-value">${esc(current)} / ${esc(target)} ${esc(h.unit || 'times')}</span><button class="qty-btn" data-habit-action="plus" aria-label="Increase ${esc(h.name)}">${icon('plus')}</button></div>`}
      <div class="progress-track"><i style="width:${p}%"></i></div>
      <strong class="percent">${p}%</strong>
    </div>
    ${isYesNo ? `<div class="yesno-leaf-status ${done ? 'done' : ''}" aria-label="${done ? 'Completed' : 'Not completed'}"><img src="${done ? AS + 'Habitly Leaf White.png' : AS + 'Habitly Leaf Transparent.png'}" alt="${done ? 'Completed' : 'Not complete'}"></div>` : `<button class="complete ${done ? 'done' : ''}" ${done ? '' : 'disabled'} data-habit-action="complete" aria-label="${done ? 'Mark complete' : 'Reach 100% to complete'}">${done ? `<img src="${AS}Habitly Leaf White.png" alt="Completed">` : `<img src="${AS}Habitly Leaf Transparent.png" alt="Not complete">`}</button>`}
    ${opts.menu ? `<button class="dots-btn" data-menu="habit:${h.id}" aria-label="Habit actions">${icon('dots')}</button>` : ''}
  </article>`;
}

function dashboard() { const habits = state.habits.filter(h => !h.paused), total = habits.length, avg = dailyProgress(todayISO()), completed = habits.filter(h => pct(h) >= 100).length, weekly = weeklyActivityData(new Date()), recorded = weekly.filter(x => x.value !== null), weekAvg = recorded.length ? Math.round(recorded.reduce((a, x) => a + x.value, 0) / recorded.length) : 0; return shell('dashboard', `${greeting()}<section class="stats-grid dashboard-stats"><article class="stat-card"><div class="progress-ring" style="--p:${avg}%"><span>${avg}%</span></div><h2>Today's Progress</h2><p>${avg >= 75 ? 'Great going!' : 'Keep building!'}</p></article><article class="stat-card"><div class="stat-emoji fire">🔥</div><div class="big-number">${currentStreak()}</div><h2>Current Streak</h2><p>days</p></article><article class="stat-card"><div class="stat-emoji trophy">🏆</div><div class="big-number">${bestStreak()}</div><h2>Best Streak</h2><p>days</p></article><article class="stat-card"><div class="stat-emoji check">✓</div><div class="big-number">${completed}</div><h2>Completed Today</h2><p>out of ${total}</p></article><article class="stat-card"><div class="stat-emoji trend">↗</div><div class="big-number">${weekAvg}%</div><h2>Consistency</h2><p>This week</p></article></section><section class="dashboard-grid"><article class="panel habits-panel"><div class="panel-header"><div><h2>Today's Habits</h2><div class="filters" data-filter-group="dashboard"><button class="filter active" data-filter="All">All</button><button class="filter" data-filter="Health">Health</button><button class="filter" data-filter="Fitness">Fitness</button><button class="filter" data-filter="Study">Study</button><button class="filter" data-filter="Personal">Personal</button><button class="filter" data-filter="Mindfulness">Mindfulness</button></div></div><button class="primary-btn" data-open-habit>+ Add Habit</button></div><div class="habit-list" id="dashboardHabits">${habits.map(h => habitRow(h)).join('')}</div><button class="view-link" data-route="habits">View all habits →</button></article><div class="right-column"><article class="panel weekly-panel"><div class="panel-title-row"><div><h2>Weekly Activity</h2><p class="panel-subtitle">Actual recorded completion this week</p></div><span class="week-total">${weekAvg}%</span></div><div class="activity-chart" id="dashboardWeeklyChart">${weekly.map(x => `<div class="activity-day ${x.value === null ? 'future' : ''}"><span class="bar-value">${x.value === null ? '' : x.value + '%'}</span><div class="bar"><i style="height:${x.value === null ? 0 : x.value}%"></i></div><b>${x.label}</b></div>`).join('')}</div></article><article class="panel upcoming"><div class="upcoming-head"><h3>Upcoming</h3><button class="text-btn" data-route="calendar">View all</button></div>${state.events.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 3).map(e => `<div class="up-item"><span class="up-icon">${icon('bell')}</span><span class="up-copy"><strong>${esc(e.title)}</strong><small>${esc(formatDate(e.date))}</small></span><span class="up-time">${esc(e.time)}</span></div>`).join('') || '<div class="muted-copy">No upcoming events.</div>'}<button class="view-schedule" data-route="calendar">View full schedule →</button></article></div></section>`); }

function habitsPage() {
  const avg = Math.round(state.habits.reduce((a, h) => a + pct(h), 0) / Math.max(1, state.habits.length));
  return shell('habits', `<div class="page-title"><span class="eyebrow">YOUR ROUTINES</span><h1>My Habits</h1><p>Build better habits, achieve your goals.</p></div><div class="page-actions"><button class="primary-btn" data-open-habit>+ Add Habit</button></div>
 <section class="habit-summary"><article class="summary-card"><div class="summary-icon purple">☷</div><div><strong>${state.habits.length}</strong><span>Total Habits</span><small>All time</small></div></article><article class="summary-card"><div class="summary-icon green">✓</div><div><strong>${state.habits.filter(h => !h.paused).length}</strong><span>Active Habits</span><small>Keep going!</small></div></article><article class="summary-card"><div class="summary-icon blue">▥</div><div><strong>${avg}%</strong><span>Average Progress</span><small>This month</small></div></article><article class="summary-card"><div class="summary-icon orange">🔥</div><div><strong>12</strong><span>Current Streak</span><small>days</small></div></article></section>
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
  return shell('goals', `<div class="page-title goals-title"><span class="eyebrow">YOUR FUTURE, ONE GOAL AT A TIME</span><h1>My Goals</h1><p>Set meaningful goals, track your progress, and celebrate every milestone.</p></div><div class="page-actions"><button class="primary-btn" data-open-goal>+ Add Goal</button></div><section class="goals-layout"><div><div class="filters goal-filters" id="goalFilters"><button class="filter active" data-goal-filter="all">All Goals</button><button class="filter" data-goal-filter="active">Active</button><button class="filter" data-goal-filter="ontrack">On Track</button><button class="filter" data-goal-filter="completed">Completed</button><button class="filter" data-goal-filter="paused">Paused</button></div><div class="goal-list" id="goalCards"></div></div><aside class="goals-side"><article class="panel overview-card"><h2>Goals Overview</h2><div class="overview-grid"><div><strong>${state.goals.length}</strong><span>Total Goals</span></div><div><strong>${state.goals.filter(g => g.status !== 'paused' && goalPct(g) < 100).length}</strong><span>Active</span></div><div><strong>${state.goals.filter(g => g.status === 'paused').length}</strong><span>Paused</span></div><div><strong>${state.goals.filter(g => goalPct(g) >= 100 || g.status === 'completed').length}</strong><span>Completed</span></div></div><button class="view-link" data-goal-filter="all">View all goals →</button></article><article class="panel category-card"><h2>Goals by Category</h2><div class="goal-category-list">${Object.entries(state.goals.reduce((acc,g)=>{acc[g.category]=(acc[g.category]||0)+1;return acc;},{})).map(([category,count])=>`<div><span>${esc(category)}</span><b>${count}</b></div>`).join('') || '<div class="muted-copy">No goals yet.</div>'}</div></article></aside></section>`);
}
function renderGoals(filter = 'all') {
  const root = document.getElementById('goalCards'); if (!root) return; let list = [...state.goals];
  if (filter === 'active') list = list.filter(g => g.status !== 'paused' && goalPct(g) < 100);
  if (filter === 'ontrack') list = list.filter(g => g.status !== 'paused' && goalPct(g) >= 50 && goalPct(g) < 100);
  if (filter === 'completed') list = list.filter(g => goalPct(g) >= 100 || g.status === 'completed');
  if (filter === 'paused') list = list.filter(g => g.status === 'paused');
  root.innerHTML = list.map(g => { const p = goalPct(g), left = daysLeft(g.date); return `<article class="goal-card ${g.status === 'paused' ? 'is-paused' : ''}" data-goal-id="${esc(g.id)}"><div class="goal-emoji">${esc(g.emoji || '')}</div><div class="goal-main"><strong>${esc(g.title)}</strong><span class="goal-category">${esc(g.category)}</span><small>Target: ${esc(g.unit)}${formatNumber(g.target)}</small></div><div class="goal-progress"><div class="goal-progress-top"><strong>${p}%</strong><button class="goal-update-btn" data-update-goal="${esc(g.id)}">Update</button></div><div class="progress-track"><i style="width:${p}%"></i></div><small>${esc(g.unit)}${formatNumber(g.current)} / ${esc(g.unit)}${formatNumber(g.target)}</small></div><div class="goal-date">${icon('calendar')}<span>${formatDate(g.date)}</span><b>${left >= 0 ? left + ' days left' : 'Past due'}</b></div><button class="dots-btn goal-dots" data-menu="goal:${esc(g.id)}" aria-label="Goal actions">${icon('dots')}</button></article>`; }).join('') || `<div class="empty-state"><strong>No goals here yet.</strong><span>Try another filter or add a new goal.</span></div>`;
  bindGoalInteractions(root);
}
function goalProgressForm(id) {
  const g = state.goals.find(x => x.id === id); if (!g) return;
  const unit = String(g.unit || ''), current = Math.max(0, Number(g.current) || 0), target = Math.max(1, Number(g.target) || 1);
  modal('Update goal progress', 'Change your progress without editing the goal itself.', `<form class="form" id="goalProgressForm"><div class="progress-edit-hero"><div class="goal-emoji">${esc(g.emoji || '🎯')}</div><div><strong>${esc(g.title)}</strong><small>${esc(g.category)} · Target ${esc(unit)}${formatNumber(target)}</small></div></div><div class="field"><label>Current progress <span>*</span></label><div class="goal-progress-input"><span>${esc(unit)}</span><input id="goalCurrentInput" name="current" type="number" min="0" max="${target}" step="any" required value="${current}"></div></div><div class="quick-progress"><span>Quick add</span><div>${[1,5,10].map(step=>`<button type="button" data-goal-step="${step}">+${step}</button>`).join('')}</div></div><div class="goal-live-preview"><span>New progress</span><strong id="goalProgressPreview">${goalPct(g)}%</strong><small id="goalProgressValue">${esc(unit)}${formatNumber(current)} / ${esc(unit)}${formatNumber(target)}</small></div><div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn">Update Goal →</button></div></form>`);
  const form = document.getElementById('goalProgressForm'), input = document.getElementById('goalCurrentInput'), preview = document.getElementById('goalProgressPreview'), value = document.getElementById('goalProgressValue');
  const updatePreview = () => { const n = Math.min(target, Math.max(0, Number(input.value) || 0)); preview.textContent = Math.min(100, Math.round(n / target * 100)) + '%'; value.textContent = `${unit}${formatNumber(n)} / ${unit}${formatNumber(target)}`; };
  input.addEventListener('input', updatePreview);
  form.querySelectorAll('[data-goal-step]').forEach(b => b.addEventListener('click', () => { input.value = Math.min(target, (Number(input.value) || 0) + Number(b.dataset.goalStep)); updatePreview(); }));
  form.addEventListener('submit', e => { e.preventDefault(); const n = Math.min(target, Math.max(0, Number(input.value) || 0)); g.current = n; g.status = n >= target ? 'completed' : (g.status === 'paused' ? 'paused' : 'active'); save(); closeModal(); render(); toast(n >= target ? 'Goal completed ✓' : 'Goal progress updated'); });
}

function calendarPage() { return shell('calendar', `<div class="page-title calendar-title"><h1>Calendar</h1><p>View your habits and goals activity.</p></div><div class="calendar-actions"><div class="segmented" id="calModes"><button class="active" data-mode="month">Month</button><button data-mode="week">Week</button><button data-mode="day">Day</button></div><button class="primary-btn" data-add-event>+ Add Event</button></div><section class="calendar-layout"><article class="panel calendar-panel"><div class="calendar-toolbar"><button class="month-selector" id="monthTitle">August 2026 ${icon('chevron')}</button><div class="calendar-nav"><button id="calPrev" aria-label="Previous month">${icon('left')}</button><button id="calToday">Today</button><button id="calNext" aria-label="Next month">${icon('right')}</button></div><div id="monthPicker" class="month-picker hidden"></div></div><div id="calendarBody"></div></article><aside class="calendar-side"><article class="panel day-summary" id="dayDetail"></article><article class="panel calendar-overview" id="reminderOverview"><div class="reminder-overview-head"><div><h2>Reminder Overview</h2><p>Events and habit reminders in one place.</p></div></div><div id="calendarReminderList"></div></article></aside></section>`); }

function pctForDate(d) { return calendarPercentForDay(d); }
function dateISO(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString().slice(0, 10); }
function snapshotForDate(date) { const iso = typeof date === 'string' ? date : dateISO(date); return state.activityHistory?.[iso] || null; }
function dailyProgress(date) { const snap = snapshotForDate(date); if (!snap || !snap.habits.length) return 0; const active = snap.habits.filter(h => !h.paused); if (!active.length) return 0; return Math.round(active.reduce((a, h) => a + Math.max(0, Math.min(100, Number(h.percent) || 0)), 0) / active.length); }
function dailyCounts(date) { const snap = snapshotForDate(date); if (!snap || !snap.habits.length) return { completed: 0, partial: 0, notDone: 0, total: 0 }; const active = snap.habits.filter(h => !h.paused), completed = active.filter(h => h.percent >= 100).length, partial = active.filter(h => h.percent > 0 && h.percent < 100).length; return { completed, partial, notDone: Math.max(0, active.length - completed - partial), total: active.length }; }
function weekBounds(cursor) { const start = new Date(cursor); start.setHours(12, 0, 0, 0); start.setDate(start.getDate() - start.getDay()); return { start, days: Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; }) }; } function weekView(cursor) { const { days } = weekBounds(cursor); let out = '<div class="week-grid">';['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((n, i) => { const d = days[i], iso = dateISO(d), p = calendarPercentForDay(d), sel = iso === calendarSelectedDate; out += `<button class="week-day ${sel ? 'selected' : ''} ${p >= 100 ? 'is-complete' : ''} ${p === 0 ? 'is-empty' : ''}" data-cal-date="${iso}"><strong>${n}</strong><span class="day-number">${d.getDate()}</span>${calendarRingMarkup(p, 'week-ring')}<span class="week-percent">${p ? p + '%' : ''}</span><div class="progress-track"><i style="width:${p}%"></i></div></button>` }); return out + '</div>'; }
function dayView(cursor) { const iso = dateISO(cursor), p = pctForDate(cursor), items = state.events.filter(e => e.date === iso), habits = calendarHabitsForDay(cursor); return `<div class="day-view"><div class="day-focus"><div class="focus-date">Selected day</div><div class="focus-title-row"><h3>${cursor.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h3><strong>${p}%</strong></div><div class="progress-line"><i style="width:${p}%"></i></div><div class="day-habit-list">${habits.map(x => `<div class="detail-item"><span class="item-emoji">${esc(x.habit.emoji || '')}</span><span>${esc(x.habit.name)}</span><small>${x.percent}%</small></div>`).join('') || '<p class="muted-copy">No recorded habit activity for this date.</p>'}${items.map(e => `<div class="detail-item"><span class="item-emoji">${esc(e.emoji || '📅')}</span><span>${esc(e.title)}</span><small>${esc(e.time)}</small><button class="icon-delete" data-delete-event="${e.id}">${icon('trash')}</button></div>`).join('')}</div></div></div>`; }
function initCalendar() { let cursor = new Date(calendarSelectedDate + 'T12:00:00'); if (Number.isNaN(cursor.getTime())) { cursor = new Date(); cursor.setHours(12, 0, 0, 0); } let mode = 'month'; const root = document.querySelector('.page-calendar'); if (!root) return; const body = root.querySelector('#calendarBody'), title = root.querySelector('#monthTitle'), picker = root.querySelector('#monthPicker'); function rebuildPicker() { picker.innerHTML = ''; picker.classList.remove('picker-months', 'picker-weeks', 'picker-days'); if (mode === 'month') { picker.classList.add('picker-months'); for (let i = -6; i <= 6; i++) { const d = new Date(cursor.getFullYear(), cursor.getMonth() + i, 1, 12), b = document.createElement('button'); b.type = 'button'; b.textContent = monthLabel(d); if (d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear()) b.classList.add('active'); b.addEventListener('click', () => { cursor = d; calendarSelectedDate = dateISO(d); picker.classList.add('hidden'); renderCal(); }); picker.appendChild(b); } } else if (mode === 'week') { picker.classList.add('picker-weeks'); const y = cursor.getFullYear(), m = cursor.getMonth(), daysInMonth = new Date(y, m + 1, 0).getDate(), first = new Date(y, m, 1, 12).getDay(), weekCount = Math.ceil((first + daysInMonth) / 7); for (let w = 1; w <= weekCount; w++) { const startDay = (w - 1) * 7 - first + 1, firstDay = Math.max(1, startDay), lastDay = Math.min(daysInMonth, startDay + 6), b = document.createElement('button'); b.type = 'button'; b.textContent = `Week ${w} · ${firstDay}–${lastDay}`; const currentWeek = Math.floor((first + cursor.getDate() - 1) / 7) + 1; if (w === currentWeek) b.classList.add('active'); b.addEventListener('click', () => { cursor = new Date(y, m, firstDay, 12); calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); renderCal(); }); picker.appendChild(b); } } else { picker.classList.add('picker-days'); const y = cursor.getFullYear(), m = cursor.getMonth(), days = new Date(y, m + 1, 0).getDate(); for (let n = 1; n <= days; n++) { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${n} · ${new Date(y, m, n, 12).toLocaleDateString('en-IN', { weekday: 'short' })}`; if (n === cursor.getDate()) b.classList.add('active'); b.addEventListener('click', () => { cursor = new Date(y, m, n, 12); calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); renderCal(); }); picker.appendChild(b); } } } function renderCal() { title.innerHTML = `${monthLabel(cursor)} ${icon('chevron')}`; body.innerHTML = calendarGrid(cursor, mode); root.querySelectorAll('[data-cal-date]').forEach(b => b.addEventListener('click', () => { cursor = new Date(b.dataset.calDate + 'T12:00:00'); calendarSelectedDate = b.dataset.calDate; renderCal(); })); root.querySelectorAll('[data-delete-event]').forEach(b => b.addEventListener('click', () => { state.events = state.events.filter(e => e.id !== b.dataset.deleteEvent); save(); renderCal(); })); renderDetail(); } function renderDetail() { const d = dateISO(cursor), dayHabits = calendarHabitsForDay(cursor), p = dailyProgress(d), items = state.events.filter(e => e.date === d); root.querySelector('#dayDetail').innerHTML = `<div class="detail-kicker">Selected day</div><div class="detail-title">${cursor.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div><div class="daily-progress"><span>Daily progress</span><strong>${p}%</strong></div><div class="progress-line"><i style="width:${p}%"></i></div><div class="detail-items">${dayHabits.map(x => `<div class="detail-item"><span class="item-emoji">${esc(x.habit.emoji || '')}</span><span>${esc(x.habit.name)}</span><small>${x.percent}%</small></div>`).join('') || '<p class="muted-copy">No recorded habit activity for this date.</p>'}${items.map(e => `<div class="detail-item"><span class="item-emoji">${esc(e.emoji || '📅')}</span><span>${esc(e.title)}</span><small>${esc(e.time)}</small><button class="icon-delete" data-delete-event="${e.id}">${icon('trash')}</button></div>`).join('')}</div>`; const reminderList = root.querySelector('#calendarReminderList'); if (reminderList) { reminderList.innerHTML = reminderOverviewMarkup(d); root.querySelectorAll('[data-add-reminder]').forEach(b => b.addEventListener('click', () => reminderForm())); } root.querySelectorAll('[data-delete-event]').forEach(b => b.addEventListener('click', () => { state.events = state.events.filter(e => e.id !== b.dataset.deleteEvent); save(); renderCal(); })); root.querySelectorAll('[data-edit-reminder]').forEach(b => b.addEventListener('click', () => reminderForm(b.dataset.editReminder))); root.querySelectorAll('[data-toggle-reminder]').forEach(b => b.addEventListener('change', () => { const r = state.reminders.find(x => x.id === b.dataset.toggleReminder); if (!r) return; r.enabled = b.checked; save(); renderCal(); toast(r.enabled ? 'Reminder enabled' : 'Reminder turned off'); })); } root.querySelectorAll('#calModes button').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; root.querySelectorAll('#calModes button').forEach(x => x.classList.toggle('active', x === b)); picker.classList.add('hidden'); rebuildPicker(); renderCal(); })); root.querySelector('#calPrev').addEventListener('click', () => { if (mode === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, Math.min(cursor.getDate(), 28), 12); else if (mode === 'week') { cursor = new Date(cursor); cursor.setDate(cursor.getDate() - 7); } else { cursor = new Date(cursor); cursor.setDate(cursor.getDate() - 1); } calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); rebuildPicker(); renderCal(); }); root.querySelector('#calNext').addEventListener('click', () => { if (mode === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, Math.min(cursor.getDate(), 28), 12); else if (mode === 'week') { cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 7); } else { cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 1); } calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); rebuildPicker(); renderCal(); }); root.querySelector('#calToday').addEventListener('click', () => { cursor = new Date(); cursor.setHours(12, 0, 0, 0); calendarSelectedDate = dateISO(cursor); picker.classList.add('hidden'); rebuildPicker(); renderCal(); }); title.addEventListener('click', () => { rebuildPicker(); picker.classList.toggle('hidden'); }); calendarSelectedDate = dateISO(cursor); rebuildPicker(); renderCal(); }

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

function menuPopover(kind, id) { document.querySelectorAll('.menu-popover').forEach(x => x.remove()); const isGoal = kind === 'goal', items = isGoal ? [['update', 'Update progress'], ['edit', 'Edit goal'], ['pause', 'Pause goal'], ['complete', 'Mark complete'], ['trash', 'Delete goal']] : [['edit', 'Edit habit'], ['reminder', 'Set reminder'], ['trash', 'Delete habit']]; const menu = document.createElement('div'); menu.className = 'menu-popover'; menu.dataset.kind = kind; menu.innerHTML = items.map(([i, t]) => `<button data-menu-action="${i}" data-menu-id="${id}">${icon(i === 'reminder' ? 'bell' : i)}<span>${t}</span></button>`).join(''); const anchor = document.querySelector(`[data-menu="${kind}:${id}"]`); if (!anchor) return; anchor.closest('article').appendChild(menu); const rect = anchor.getBoundingClientRect(); const card = anchor.closest('article').getBoundingClientRect(); menu.style.top = `${Math.min(anchor.offsetTop + 38, card.height - menu.offsetHeight - 10)}px`; menu.style.right = '8px'; }
function bindHabitInteractions(root) {
  root.querySelectorAll('[data-habit-action]').forEach(b => b.addEventListener('click', () => {
    const row = b.closest('.habit-row');
    const h = state.habits.find(x => x.id === row?.dataset.id);
    if (!h || h.paused) return;
    const action = b.dataset.habitAction;
    if (action === 'plus') h.current = Math.min(Math.max(1, Number(h.target) || 1), (Number(h.current) || 0) + 1);
    if (action === 'minus') h.current = Math.max(0, (Number(h.current) || 0) - 1);
    if (action === 'complete' && pct(h) >= 100) h.current = Math.max(1, Number(h.target) || 1);
    if (action === 'yes') h.current = 1;
    if (action === 'no') h.current = 0;
    h.daily = h.daily || {};
    h.daily[todayISO()] = h.current;
    save();
    render();
  }));
  root.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); menuPopover('habit', b.dataset.menu.split(':')[1]); }));
}

function bindHabitPage() { document.querySelectorAll('[data-habit-filter]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-habit-filter]').forEach(x => x.classList.toggle('active', x === b)); renderHabitCards(b.dataset.habitFilter, document.getElementById('habitSort').value); })); document.getElementById('habitSort').addEventListener('change', e => { const active = document.querySelector('[data-habit-filter].active')?.dataset.habitFilter || 'all'; renderHabitCards(active, e.target.value); }); }
function bindGoalInteractions(root) { root.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); menuPopover('goal', b.dataset.menu.split(':')[1]); })); root.querySelectorAll('[data-update-goal]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); goalProgressForm(b.dataset.updateGoal); })); }
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
  const y = cursor.getFullYear(), m = cursor.getMonth(), first = new Date(y, m, 1, 12).getDay(), days = new Date(y, m + 1, 0).getDate();
  let out = '<div class="calendar-grid">';
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(x => out += `<div class="weekday">${x}</div>`);
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
  const start = new Date(cursor); start.setHours(12, 0, 0, 0); start.setDate(start.getDate() - start.getDay());
  let out = '<div class="week-grid">';
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((n, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); const iso = dateISO(d), p = calendarPercentForDay(d), sel = iso === calendarSelectedDate;
    out += `<button class="week-day ${sel ? 'selected' : ''} ${p >= 100 ? 'is-complete' : ''} ${p === 0 ? 'is-empty' : ''}" data-cal-date="${iso}"><strong>${n}</strong><span class="day-number">${d.getDate()}</span>${calendarRingMarkup(p, 'week-ring')}<span class="week-percent">${p ? p + '%' : ''}</span><div class="progress-track"><i style="width:${p}%"></i></div></button>`;
  });
  return out + '</div>';
}

function storageModeLabel(mode) {
  return mode === 'drive' ? 'Google Drive' : mode === 'both' ? 'This device + Google Drive' : 'This device';
}
function storageIsConfigured() { return !!(state.settings?.storage?.setupCompleted || currentAuthUser?.user_metadata?.habitly_storage_setup); }
function accountStorageMode() { return currentAuthUser?.user_metadata?.habitly_storage_mode || state.settings?.storage?.mode || 'local'; }
function storageMode() { return accountStorageMode(); }
function backupStatusText(d) {
  if (!d?.connected) return 'Connect Google Drive to start cloud backups.';
  if (!d.lastBackupDate) return 'Waiting for your first automatic backup.';
  if (d.lastBackupDate === todayISO()) return `Backed up today · ${formatBackupTime(d.lastBackupAt)}`;
  return 'Waiting for today’s automatic backup.';
}
function showStorageOnboarding() {
  if (!currentAuthUser || storageIsConfigured() || storageOnboardingBusy) return;
  modal('Choose your storage', 'Choose once how Habitly should keep your personal data. You can change this later in Settings.', `<div class="storage-choice-grid">
    <button class="storage-choice" type="button" data-storage-choice="local"><span class="storage-choice-icon">${icon('desktop')}</span><span><b>This device</b><small>Keep Habitly data in this browser. No Google Drive permission is required.</small></span><strong>Recommended for simple use</strong></button>
    <button class="storage-choice" type="button" data-storage-choice="drive"><span class="storage-choice-icon">${icon('database')}</span><span><b>Google Drive</b><small>Use Google Drive for your Habitly data and complete Drive access now.</small></span><strong>Cloud storage</strong></button>
    <button class="storage-choice" type="button" data-storage-choice="both"><span class="storage-choice-icon">${icon('cloud')}</span><span><b>This device + Google Drive</b><small>Keep a local copy and securely back up the same Habitly data to Drive.</small></span><strong>Best protection</strong></button>
  </div><div class="storage-choice-note">You’ll only see this setup once. Google Drive permission is requested immediately if you choose Drive or Both.</div>`);
  document.querySelectorAll('[data-storage-choice]').forEach(b => b.addEventListener('click', () => chooseStorage(b.dataset.storageChoice)));
}
async function chooseStorage(mode) {
  if (storageOnboardingBusy) return;
  if (mode === 'local') {
    state.settings.storage = { mode: 'local', setupCompleted: true };
    await persistStorageChoice('local');
    save(); closeModal(); render(); toast('Storage set to This device'); return;
  }
  storageOnboardingMode = mode;
  storageOnboardingBusy = true;
  const title = mode === 'both' ? 'Connect Google Drive' : 'Set up Google Drive';
  modal(title, 'Google permission is required to finish your storage setup.', `<div class="storage-progress"><div class="storage-progress-icon">${icon('cloud')}</div><h3>Connect your Google Drive</h3><p>Habitly will create or use its dedicated backup folder and finish setup before opening your dashboard.</p><div class="storage-progress-steps"><span>1. Authorize Google Drive</span><span>2. Verify access</span><span>3. Create your Habitly backup</span></div><div class="form-actions"><button class="secondary-btn" id="storageCancel">Cancel</button><button class="primary-btn" id="storageConnect">Continue with Google Drive ${icon('arrow')}</button></div></div>`);
  document.getElementById('storageCancel')?.addEventListener('click', () => { storageOnboardingMode = ''; storageOnboardingBusy = false; closeModal(); });
  document.getElementById('storageConnect')?.addEventListener('click', () => { if (!ensureDriveClient()) { storageOnboardingBusy = false; return; } googleTokenClient.requestAccessToken({ prompt: 'consent' }); });
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
  save();
  storageOnboardingMode = '';
  storageOnboardingBusy = false;
  closeModal();
  render();
}
function changeStorageMode() {
  const current = storageMode();
  modal('Change storage', `Current storage: ${storageModeLabel(current)}. Choose a new storage method.`, `<div class="storage-choice-grid compact">
    <button class="storage-choice ${current === 'local' ? 'selected' : ''}" type="button" data-change-storage="local"><span class="storage-choice-icon">${icon('desktop')}</span><span><b>This device</b><small>Keep your local Habitly data in this browser.</small></span></button>
    <button class="storage-choice ${current === 'drive' ? 'selected' : ''}" type="button" data-change-storage="drive"><span class="storage-choice-icon">${icon('database')}</span><span><b>Google Drive</b><small>Use Google Drive for cloud storage.</small></span></button>
    <button class="storage-choice ${current === 'both' ? 'selected' : ''}" type="button" data-change-storage="both"><span class="storage-choice-icon">${icon('cloud')}</span><span><b>This device + Google Drive</b><small>Keep local data and Drive backup.</small></span></button>
  </div>`);
  document.querySelectorAll('[data-change-storage]').forEach(b => b.addEventListener('click', () => { const m=b.dataset.changeStorage; if(m==='local'){ state.settings.storage={mode:'local',setupCompleted:true}; state.settings.drive.connected=false; state.settings.drive.email=''; save(); closeModal(); render(); toast('Storage changed to This device'); } else { storageOnboardingMode=m; storageOnboardingBusy=false; closeModal(); chooseStorage(m); } }));
}
function settingsPage() {
  const s = state.settings || defaultState.settings, p = state.profile || defaultState.profile;
  return shell('settings', `<div class="settings-page-title"><div><span class="eyebrow">HABITLY SETTINGS</span><h1>Settings</h1><p>Manage your account and preferences.</p></div></div>
 <section class="settings-layout">
  <aside class="settings-nav" aria-label="Settings navigation">
   ${[['account', 'Account', 'user'], ['notifications', 'Notifications', 'bell'], ['habits', 'Habit Preferences', 'target'], ['security', 'Privacy & Security', 'shield'], ['data', 'Data & Backup', 'database'], ['about', 'About Habitly', 'info']].map(([k, t, i], idx) => `<button class="settings-tab ${idx === 0 ? 'active' : ''}" data-settings-tab="${k}"><span class="settings-tab-icon">${icon(i)}</span><span>${t}</span></button>`).join('')}
  </aside>
  <div class="settings-content" id="settingsContent"></div>
 </section>`);
}
function settingsSection(key) {
  const p = state.profile || defaultState.profile, s = state.settings || defaultState.settings;
  if (key === 'account') return `<article class="settings-card settings-account"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('user')}</div><div><h2>Account</h2><p>Update your personal information and profile picture.</p></div></div><form id="profileForm" class="settings-form"><div class="profile-editor"><div class="profile-avatar-wrap"><div class="profile-avatar" id="profileAvatar">${p.avatar ? `<img src="${esc(p.avatar)}" alt="Profile picture">` : `<span class="avatar-initials">${esc((p.name || 'Prem Kumar').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase() || 'PK')}</span>`}</div><label class="avatar-upload" title="Change profile picture">${icon('upload')}<input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp"></label><small>PNG, JPG or WebP · max 10 MB · crop supported</small></div><div class="settings-fields"><div class="field"><label>Full name</label><input name="name" value="${esc(p.name)}" required></div><div class="field"><label>Email address</label><input name="email" type="email" value="${esc(p.email)}" required></div></div></div><div class="settings-save-row"><button class="primary-btn">Save changes ${icon('arrow')}</button></div></form></article>
 <article class="settings-card install-app-card"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('download')}</div><div><h2>Install Habitly</h2><p>Use Habitly like an app on your phone with a home-screen icon and standalone experience.</p></div></div><div id="installAppContent"></div></article>
 <div class="settings-two-col"><article class="settings-card"><div class="settings-card-head compact"><div class="settings-heading-icon green">${icon('shield')}</div><div><h2>Account status</h2><p>Your Habitly profile is ready to use.</p></div><span class="status-pill">Good</span></div><div class="info-list"><div><span>${icon('check')}Profile information</span><b>Complete</b></div><div><span>${icon('database')}Local data</span><b>Protected</b></div></div></article><article class="settings-card about-mini"><div class="settings-brand-mark">${logo()}</div><h2>Habitly by PRK</h2><p>Build better habits. Achieve your goals. One consistent day at a time.</p></article></div>`;
  if (key === 'notifications') return `<article class="settings-card"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('bell')}</div><div><h2>Notifications</h2><p>Choose when Habitly should remind you.</p></div></div><div class="settings-options">${[['daily', 'Daily reminders', 'Get reminded about your habits', 'bell'], ['motivational', 'Motivational messages', 'Receive helpful daily motivation', 'star'], ['weekly', 'Weekly summary', 'Get a weekly progress summary', 'chart'], ['goal', 'Goal reminders', 'Stay on track with important goals', 'trophy']].map(([k, t, d, i]) => `<label class="settings-option"><span class="option-icon">${icon(i === 'star' ? 'plusCircle' : i)}</span><span><b>${t}</b><small>${d}</small></span><input type="checkbox" data-notify="${k}" ${s.notifications[k] ? 'checked' : ''}><i class="toggle"></i></label>`).join('')}</div><div class="settings-note">Changes are saved automatically on this page.</div></article>`;
  if (key === 'habits') return `<article class="settings-card"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('target')}</div><div><h2>Habit Preferences</h2><p>Customize how your habits are displayed and tracked.</p></div></div><div class="settings-preference-grid"><div class="field"><label>Default habit view</label><select id="prefDefaultView"><option>All Habits</option><option>Active</option><option>Completed</option><option>Paused</option></select></div><div class="field"><label>Week starts on</label><select id="prefWeekStart"><option>Monday</option><option>Sunday</option></select></div></div><div class="settings-options compact-options"><label class="settings-option"><span class="option-icon">${icon('check')}</span><span><b>Auto-complete at target</b><small>Mark quantity habits complete when they reach their target.</small></span><input type="checkbox" id="prefAuto" ${s.habits.autoComplete ? 'checked' : ''}><i class="toggle"></i></label><label class="settings-option"><span class="option-icon">${icon('pause')}</span><span><b>Keep streaks during pauses</b><small>Paused habits do not break an existing streak.</small></span><input type="checkbox" id="prefStreak" ${s.habits.keepStreak ? 'checked' : ''}><i class="toggle"></i></label><label class="settings-option"><span class="option-icon">${icon('plus')}</span><span><b>Show quick quantity controls</b><small>Keep plus and minus controls visible on habit cards.</small></span><input type="checkbox" id="prefQuick" ${s.habits.quickQuantity ? 'checked' : ''}><i class="toggle"></i></label></div></article>`;
  if (key === 'security') return `<article class="settings-card"><div class="settings-card-head"><div class="settings-heading-icon blue">${icon('shield')}</div><div><h2>Privacy & Security</h2><p>Protect your account and control access to your local Habitly data.</p></div></div><div class="security-status"><span class="security-icon">${icon('shield')}</span><div><b>Local data protection</b><small>Habitly stores this frontend's data in your browser's local storage.</small></div><span class="status-pill">Active</span></div><div class="security-grid"><button class="security-action" data-security="sessions"><span>${icon('desktop')}</span><b>Active session</b><small>This browser</small></button><button class="security-action" data-security="clear"><span>${icon('trash')}</span><b>Clear local data</b><small>Requires confirmation</small></button></div><div class="settings-note">There is no server-side login or password system in this frontend, so password/2FA controls are intentionally not presented as fake functionality.</div></article>`;
  if (key === 'data') {
    const d = (state.settings?.drive) || {};
    const storage = state.settings?.storage || { mode: 'local', setupCompleted: true };
    const mode = storage.mode || 'local';
    const driveSelected = mode === 'drive' || mode === 'both';
    const connected = !!d.connected && driveSelected;
    const status = connected ? backupStatusText(d) : '';
    return `<article class="settings-card"><div class="settings-card-head"><div class="settings-heading-icon purple">${icon('database')}</div><div><h2>Data & Backup</h2><p>Choose where Habitly keeps your personal data. Your choice is remembered for this account.</p></div></div>
      <div class="storage-current"><div><span class="eyebrow">CURRENT STORAGE</span><strong>${esc(storageModeLabel(mode))}</strong><small>${mode === 'local' ? 'Your Habitly data stays on this device.' : mode === 'drive' ? 'Google Drive is your selected cloud storage.' : 'Habitly keeps local data and a Google Drive backup.'}</small></div><button class="secondary-btn" id="changeStorage">Change storage</button></div>
      <div class="backup-actions"><button class="backup-card" id="exportBackup"><span>${icon('download')}</span><b>Export backup</b><small>Download your complete Habitly data as JSON.</small></button><label class="backup-card"><span>${icon('upload')}</span><b>Import backup</b><small>Restore a Habitly JSON backup from this device.</small><input id="importBackup" type="file" accept="application/json,.json"></label></div>
      ${driveSelected ? `<div class="drive-backup-card"><div class="drive-head"><div class="drive-icon">${icon('cloud')}</div><div><h3>Google Drive Backup</h3><p>Habitly keeps one rolling backup file in your Drive. It updates instead of creating daily files.</p></div><span class="drive-status ${connected ? 'connected' : ''}">${connected ? 'Connected' : 'Not connected'}</span></div><div class="drive-copy"><div><b>Habitly_Backup.json</b><small>${connected ? (d.email ? `Google account: ${esc(d.email)}` : 'Connected to Google Drive') : 'Connect Google Drive to enable cloud backup.'}</small></div><div class="drive-last"><span>Last automatic backup</span><strong>${connected && d.lastBackupAt ? formatBackupTime(d.lastBackupAt) : 'Not backed up yet'}</strong></div></div>${connected ? `<div class="backup-status-line ${d.lastBackupDate === todayISO() ? 'ready' : 'waiting'}">${icon(d.lastBackupDate === todayISO() ? 'check' : 'info')}<span>${esc(status)}</span></div>` : ''}<div class="drive-actions"><button class="primary-btn" id="driveConnect">${icon(connected ? 'refresh' : 'cloud')}${connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button>${connected ? `<button class="secondary-btn" id="driveBackupNow">${icon('cloud')} Back up now</button><button class="secondary-btn" id="driveRestore">${icon('download')} Restore backup</button>` : ''}</div>${connected ? `<label class="drive-auto"><span><b>Daily backup · ${d.autoDaily !== false ? 'On' : 'Off'}</b><small>When Habitly is opened on a new calendar day, it checks the last successful backup and updates the same Drive file only when needed.</small></span><input type="checkbox" id="driveAutoDaily" ${d.autoDaily !== false ? 'checked' : ''}><i class="toggle"></i></label>` : ''}<div class="settings-note drive-note">${connected ? 'Only one cloud backup is maintained. No separate daily files are created. Your profile photo is not included in the cloud JSON backup.' : 'Connect Google Drive to enable cloud storage and backup controls.'}</div></div>` : `<div class="settings-note">Google Drive backup controls are hidden because this account is using This device storage. Choose Drive or Both above if you want cloud storage.</div>`}
    </article>`;
  }
  return `<article class="settings-card about-settings"><div class="about-hero"><div class="about-logo"><img src="${AS}Habitly Leaf Transparent.png" alt="Habitly leaf logo"></div><div><span class="eyebrow">HABITLY BY PRK</span><h2>About Habitly</h2><p>Your personal habit and goal tracking companion.</p></div></div><div class="about-copy"><h3>About me</h3><p>I'm Prem Kumar, an Integrated B.Tech–M.Tech Cyber Security student focused on cloud security, secure software and practical cybersecurity engineering. I build hands-on projects to strengthen my skills in secure systems, automation and real-world application development.</p><h3>Why I created Habitly</h3><p>I created Habitly as a practical productivity application that brings habits and long-term goals into one focused workspace. It makes progress visible, measurable and editable while giving me a real-world project for building responsive interfaces, state management, persistence and user-focused software.</p></div><div class="about-links"><a href="https://github.com/prem-cybersecurity" target="_blank" rel="noopener noreferrer" aria-label="Open GitHub">${icon('github')}<span>GitHub</span></a><a href="https://premkumar-portfolio-kohl.vercel.app/" target="_blank" rel="noopener noreferrer" aria-label="Open portfolio"><span>Portfolio</span>${icon('external')}</a><a class="linkedin-link" href="https://www.linkedin.com/in/premkumar-cybersecurity" target="_blank" rel="noopener noreferrer" aria-label="Open LinkedIn">${icon('linkedin')}<span>LinkedIn</span></a></div><small class="version-line">Habitly by PRK · Version 1.0.0</small></article>`;
}
function driveSettings() { if (!state.settings) state.settings = clone(defaultState.settings); if (!state.settings.drive) state.settings.drive = clone(defaultState.settings.drive); return state.settings.drive; }
function formatBackupTime(v) { try { return new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return 'Not backed up yet'; } }
function driveClientReady() { return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2; }
function ensureDriveClient() {
  if (!driveClientReady()) { toast('Google sign-in is still loading. Try again in a moment.'); return false; }
  if (!GOOGLE_DRIVE_CLIENT_ID || GOOGLE_DRIVE_CLIENT_ID.startsWith('PASTE_YOUR_')) { toast('Add your Google OAuth Web Client ID in config.js first.'); return false; }
  if (!googleTokenClient) { googleTokenClient = google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_DRIVE_CLIENT_ID, scope: GOOGLE_DRIVE_SCOPE, callback: async response => { if (response.error) { toast('Google authorization was not completed'); return; } googleAccessToken = response.access_token; await finishDriveConnection(); } }); }
  return true;
}
async function driveRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${googleAccessToken}`);
  return fetch(url, { ...options, headers });
}
function backupPayload() { const safeState = clone(state); if (safeState.profile) safeState.profile.avatar = ''; return { backupVersion: 1, app: 'Habitly', updatedAt: new Date().toISOString(), data: safeState }; }
async function findOrCreateDriveFolder() {
  const q = encodeURIComponent("name='Habitly Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const res = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)&pageSize=10`); if (!res.ok) throw new Error('Drive folder lookup failed'); const data = await res.json(); if (data.files?.[0]) return data.files[0].id;
  const create = await driveRequest('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Habitly Backups', mimeType: 'application/vnd.google-apps.folder' }) }); if (!create.ok) throw new Error('Drive folder creation failed'); return (await create.json()).id;
}
async function findDriveBackup(folderId) { const q = encodeURIComponent(`name='Habitly_Backup.json' and '${folderId}' in parents and trashed=false`); const res = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime,size)&pageSize=10`); if (!res.ok) throw new Error('Drive backup lookup failed'); const data = await res.json(); return data.files?.[0] || null; }
async function cleanupDriveRevisions(fileId) { try { const meta = await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=headRevisionId`); if (!meta.ok) return; const head = (await meta.json()).headRevisionId; const r = await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}/revisions?fields=revisions(id,keepForever)`); if (!r.ok) return; const data = await r.json(); for (const rev of (data.revisions || [])) { if (rev.id !== head && !rev.keepForever) { await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${rev.id}`, { method: 'DELETE' }); } } } catch (e) { console.warn('Revision cleanup skipped', e); } }
async function uploadDriveBackup() {
  if (googleDriveBusy) return; googleDriveBusy = true; try { if (!googleAccessToken) throw new Error('Connect Google Drive first'); const d = driveSettings(); const folderId = d.folderId || await findOrCreateDriveFolder(); let file = d.fileId ? { id: d.fileId } : await findDriveBackup(folderId); const body = JSON.stringify(backupPayload()); let res, result; if (file) { res = await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }); if (!res.ok) { const text = await res.text(); throw new Error(text || 'Drive upload failed'); } result = await res.json(); } else { const create = await driveRequest('https://www.googleapis.com/drive/v3/files?fields=id,name,modifiedTime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Habitly_Backup.json', parents: [folderId], mimeType: 'application/json' }) }); if (!create.ok) { const text = await create.text(); throw new Error(text || 'Drive file creation failed'); } result = await create.json(); const upload = await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${result.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }); if (!upload.ok) { const text = await upload.text(); throw new Error(text || 'Drive upload failed'); } result = await upload.json(); } await cleanupDriveRevisions(result.id || file?.id); d.connected = true; d.folderId = folderId; d.fileId = result.id || file?.id || ''; d.lastBackupDate = todayISO(); d.lastBackupAt = new Date().toISOString(); save(); toast('Habitly backup updated in Google Drive'); return true; } catch (err) { console.error(err); toast(err.message?.includes('401') ? 'Google Drive authorization expired. Reconnect Drive.' : err.message?.includes('403') ? 'Google Drive permission was denied. Reconnect Drive and allow Drive access.' : 'Google Drive backup failed'); return false; } finally { googleDriveBusy = false; }
}
async function finishDriveConnection() {
  try {
    const d = driveSettings();
    const folderId = d.folderId || await findOrCreateDriveFolder();
    const file = d.fileId ? { id: d.fileId } : await findDriveBackup(folderId);
    d.connected = true; d.folderId = folderId; d.fileId = file?.id || '';
    const email = await getGoogleEmail(); if (email) d.email = email;
    save();
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
    if (d.autoDaily !== false && d.lastBackupDate !== todayISO()) setTimeout(() => uploadDriveBackup().then(() => { if (currentRoute() === 'settings') render(); }), 250);
  } catch (e) {
    console.error(e);
    if (storageOnboardingMode) { storageOnboardingBusy = false; toast('Could not finish Google Drive setup. Please try again.'); }
    else toast('Could not connect to Google Drive');
  }
}
async function getGoogleEmail() { try { const r = await driveRequest('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)'); if (!r.ok) return ''; return (await r.json()).user?.emailAddress || ''; } catch (e) { return ''; } }
function connectDrive() { if (!ensureDriveClient()) return; googleTokenClient.requestAccessToken({ prompt: driveSettings().connected ? '' : 'consent' }); }
async function bindDriveSettings(root) { const d = driveSettings(); root.querySelector('#driveConnect')?.addEventListener('click', connectDrive); root.querySelector('#driveBackupNow')?.addEventListener('click', () => uploadDriveBackup().then(() => { if (currentRoute() === 'settings') render(); })); root.querySelector('#driveRestore')?.addEventListener('click', restoreDriveBackup); root.querySelector('#driveAutoDaily')?.addEventListener('change', e => { d.autoDaily = e.target.checked; save(); }); if (d.connected && d.autoDaily !== false && d.lastBackupDate !== todayISO()) { if (googleAccessToken) setTimeout(() => uploadDriveBackup().then(() => { if (currentRoute() === 'settings') render(); }), 250); else if (ensureDriveClient()) { try { googleTokenClient.requestAccessToken({ prompt: '' }); } catch (e) { console.warn('Silent Drive authorization unavailable', e); } } } }
async function restoreDriveBackup() { if (!googleAccessToken) { connectDrive(); return; } const d = driveSettings(); try { const folderId = d.folderId || await findOrCreateDriveFolder(); const file = d.fileId ? { id: d.fileId } : await findDriveBackup(folderId); if (!file) { toast('No Habitly backup found in Google Drive'); return; } const r = await driveRequest(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`); if (!r.ok) throw new Error('Could not download backup'); const incoming = await r.json(); modal('Restore Google Drive backup', 'Your current local Habitly data will be replaced by this backup.', `<div class="confirm-box"><p>Backup updated ${esc(formatBackupTime(incoming.updatedAt || file.modifiedTime))}. This restores the complete Habitly state.</p><div class="form-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn" id="confirmDriveRestore">Restore backup</button></div></div>`); document.getElementById('confirmDriveRestore').addEventListener('click', () => { try { state = mergeState(incoming.data || incoming); save(); closeModal(); render(); toast('Google Drive backup restored'); } catch (e) { toast('Invalid Habitly backup'); } }); } catch (e) { console.error(e); toast('Google Drive restore failed'); } }
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
  function show(key) { root.querySelectorAll('.settings-nav [data-settings-tab]').forEach(x => x.classList.toggle('active', x.dataset.settingsTab === key)); content.innerHTML = settingsSection(key); bindSection(key); }
  function bindSection(key) {
    if (key === 'account') {
      const input = root.querySelector('#avatarInput'); input?.addEventListener('change', e => { const f = e.target.files?.[0]; if (!f) return; if (!/^image\/(png|jpeg|webp)$/i.test(f.type)) { toast('Please choose a PNG, JPG or WebP image'); e.target.value = ''; return; } if (f.size > 10 * 1024 * 1024) { toast('Profile picture must be 10 MB or smaller'); e.target.value = ''; return; } openCropper(f, result => { state.profile.avatar = result; root.querySelector('#profileAvatar').innerHTML = `<img src="${esc(result)}" alt="Profile picture">`; }); e.target.value = ''; });
      root.querySelector('#profileForm')?.addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.target); state.profile.name = String(fd.get('name') || '').trim() || 'Prem Kumar'; state.profile.email = String(fd.get('email') || '').trim(); save(); render(); toast('Profile updated'); });
      renderInstallOption(root.querySelector('#installAppContent'));
    }
    if (key === 'notifications') root.querySelectorAll('[data-notify]').forEach(i => i.addEventListener('change', () => { if (!state.settings) state.settings = clone(defaultState.settings); state.settings.notifications[i.dataset.notify] = i.checked; save(); toast('Notification preference saved'); }));
    if (key === 'habits') {
      const v = safesettings().habits; root.querySelector('#prefDefaultView').value = v.defaultView; root.querySelector('#prefWeekStart').value = v.weekStarts;
      root.querySelector('#prefDefaultView').addEventListener('change', e => { v.defaultView = e.target.value; save(); }); root.querySelector('#prefWeekStart').addEventListener('change', e => { v.weekStarts = e.target.value; save(); });
      [['#prefAuto', 'autoComplete'], ['#prefStreak', 'keepStreak'], ['#prefQuick', 'quickQuantity']].forEach(([sel, k]) => root.querySelector(sel).addEventListener('change', e => { v[k] = e.target.checked; save(); }));
    }
    if (key === 'security') { root.querySelector('[data-security="sessions"]')?.addEventListener('click', () => toast('This browser is the only active local session.')); root.querySelector('[data-security="clear"]')?.addEventListener('click', () => confirmClearData()); }
    if (key === 'data') { root.querySelector('#exportBackup')?.addEventListener('click', exportBackup); root.querySelector('#importBackup')?.addEventListener('change', importBackup); root.querySelector('#changeStorage')?.addEventListener('click', changeStorageMode); if (state.settings?.storage?.mode === 'drive' || state.settings?.storage?.mode === 'both') bindDriveSettings(root); }
  }
  function safesettings() { if (!state.settings) state.settings = clone(defaultState.settings); return state.settings; }
  function confirmClearData() { modal('Clear local data', 'This removes your saved Habitly data from this browser.', `<div class="confirm-box"><p>Your habits, goals, events and settings will be reset to the default Habitly data.</p><div class="form-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="danger-btn" id="confirmClearSettings">Clear data</button></div></div>`); root.querySelector('#confirmClearSettings'); document.getElementById('confirmClearSettings').addEventListener('click', () => { localStorage.removeItem(STORAGE); state = clone(defaultState); closeModal(); render(); toast('Local data reset'); }); }
  function exportBackup() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `habitly-backup-${todayISO()}.json`; a.click(); URL.revokeObjectURL(url); toast('Backup exported'); }
  function importBackup(e) { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const incoming = JSON.parse(r.result); state = mergeState(incoming); save(); render(); toast('Backup restored'); } catch (err) { toast('Invalid Habitly backup'); } }; r.readAsText(f); }
  root.addEventListener('click', e => { const tab = e.target.closest('[data-settings-tab]'); if (tab) { e.preventDefault(); show(tab.dataset.settingsTab); } });
  show('account');
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
      <div class="field"><label>Target <span class="target-required">*</span></label><input name="target" type="number" min="1" value="${esc(h?.target ?? '')}" placeholder="e.g. 8"><small class="yesno-help hidden">Yes / No habits automatically use one completion.</small></div>
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
  const syncTypeUI = () => {
    const type = form.querySelector('[name="type"]:checked')?.value || 'quantity';
    form.querySelectorAll('.track-option').forEach(x => x.classList.toggle('selected', x.querySelector('input')?.checked));
    const yesno = type === 'yesno';
    measureFields.classList.toggle('hidden', yesno);
    targetInput.required = !yesno;
    targetInput.disabled = yesno;
    unitInput.disabled = yesno;
    requiredMark.classList.toggle('hidden', yesno);
    help.classList.toggle('hidden', !yesno);
    if (yesno) { targetInput.value = '1'; unitInput.value = 'completion'; }
    else if (unitInput.value === 'completion' && h?.type === 'yesno') unitInput.value = '';
  };
  form.querySelectorAll('[name="type"]').forEach(r => r.addEventListener('change', syncTypeUI));
  syncTypeUI();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const type = String(fd.get('type') || 'quantity');
    const target = type === 'yesno' ? 1 : Math.max(1, Number(fd.get('target')) || 1);
    const unit = type === 'yesno' ? 'completion' : (String(fd.get('unit') || '').trim() || 'times');
    if (id) {
      Object.assign(h, { name: String(fd.get('name')).trim(), category: fd.get('category'), emoji: String(fd.get('emoji') || '').trim(), type, target, unit, frequency: fd.get('frequency'), paused: fd.get('paused') === 'on' });
      h.current = Math.min(Number(h.current) || 0, target);
    } else {
      state.habits.push({ id: uid('h'), name: String(fd.get('name')).trim(), emoji: String(fd.get('emoji') || '').trim(), category: fd.get('category'), type, target, current: 0, unit, paused: false, created: Date.now(), frequency: fd.get('frequency') });
    }
    save(); closeModal(); render(); toast(id ? 'Habit updated' : 'Habit added');
  });
}

function goalForm(id) {
  const g = id ? state.goals.find(x => x.id === id) : null;
  const selectedType = g?.type || 'target';
  modal(id ? 'Edit goal' : 'Add goal', id ? 'Update your goal without losing progress.' : 'Turn an intention into a measurable goal.', `<form class="form" id="goalForm">
    <div class="form-grid two"><div class="field"><label>Goal title *</label><input name="title" required value="${esc(g?.title || '')}" placeholder="e.g. Run a Half Marathon"></div><div class="field"><label>Category *</label><select name="category" required><option>Select category</option>${['Education', 'Finance', 'Health', 'Personal Growth', 'Lifestyle', 'Learning'].map(x => `<option ${x === g?.category ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="field"><label>Choose an emoji</label><input class="emoji-input" name="emoji" value="${esc(g?.emoji || '')}" placeholder="Tap here and choose an emoji" inputmode="text" autocomplete="off"><small>Use your phone's emoji keyboard to choose any emoji.</small></div>
    <div class="field"><label>Goal type</label><div class="goal-type">${[['target','Target'],['milestone','Milestone'],['habit','Habit Based']].map(([v,t]) => `<button type="button" class="${selectedType === v ? 'selected' : ''}" data-goal-type="${v}">${t}</button>`).join('')}</div></div>
    <div class="form-grid two"><div class="field"><label id="goalTargetLabel">Target <span>*</span></label><input name="target" type="number" min="1" required value="${esc(g?.target ?? '')}" placeholder="e.g. 90, 100000, 8"></div><div class="field"><label>Unit</label><input name="unit" value="${esc(g?.unit || '')}" placeholder="%, ₹, kg, books, days"></div></div>
    <div class="form-grid two"><div class="field"><label>Target date *</label><input name="date" type="date" required value="${esc(g?.date || '')}"></div><div class="field"><label>Reminder time</label><div class="time-input"><input name="reminder" type="time" value="${esc(g?.reminder || '')}">${icon('bell')}</div></div></div>
    ${id ? `<label class="switch-row"><span><b>Pause goal</b><small>Pause without losing progress.</small></span><input type="checkbox" name="paused" ${g?.status === 'paused' ? 'checked' : ''}><i></i></label>` : ''}
    <div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn">${id ? 'Save Changes' : 'Add Goal'} →</button></div>
  </form>`);

  const form = document.getElementById('goalForm');
  let goalType = selectedType;
  const syncGoalType = () => {
    form.querySelectorAll('[data-goal-type]').forEach(b => b.classList.toggle('selected', b.dataset.goalType === goalType));
    const label = form.querySelector('#goalTargetLabel');
    if (label) label.innerHTML = goalType === 'milestone' ? 'Milestone target <span>*</span>' : goalType === 'habit' ? 'Habit target <span>*</span>' : 'Target <span>*</span>';
  };
  form.querySelectorAll('[data-goal-type]').forEach(b => b.addEventListener('click', () => { goalType = b.dataset.goalType; syncGoalType(); }));
  syncGoalType();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const category = fd.get('category');
    if (category === 'Select category') { toast('Choose a category'); return; }
    const target = Math.max(1, Number(fd.get('target')) || 1);
    const reminder = String(fd.get('reminder') || '');
    if (id) {
      Object.assign(g, { title: String(fd.get('title')).trim(), category, emoji: String(fd.get('emoji') || '').trim(), type: goalType, target, unit: String(fd.get('unit') || '').trim(), date: fd.get('date'), reminder, status: fd.get('paused') === 'on' ? 'paused' : (goalPct(g) >= 100 ? 'completed' : 'active') });
      g.current = Math.min(Number(g.current) || 0, target);
    } else {
      state.goals.push({ id: uid('g'), title: String(fd.get('title')).trim(), category, emoji: String(fd.get('emoji') || '').trim(), type: goalType, target, current: 0, unit: String(fd.get('unit') || '').trim(), date: fd.get('date'), reminder, status: 'active' });
    }
    save(); closeModal(); render(); toast(id ? 'Goal updated' : 'Goal added');
  });
}

function eventForm(dateOverride) { const defaultDate = dateOverride || calendarSelectedDate || todayISO(); modal('Add event', 'Add something scheduled to your calendar.', `<form class="form" id="eventForm"><div class="form-grid two"><div class="field"><label>Event title *</label><input name="title" required placeholder="e.g. Team Meeting"></div><div class="field"><label>Emoji</label><input name="emoji" class="emoji-input" placeholder="Tap here and choose an emoji" inputmode="text"></div></div><div class="form-grid two"><div class="field"><label>Date *</label><input name="date" type="date" required value="${defaultDate}"></div><div class="field"><label>Time *</label><input name="time" type="time" required></div></div><div class="form-actions"><button type="button" class="secondary-btn" data-modal-close>Cancel</button><button class="primary-btn">Add Event →</button></div></form>`); document.getElementById('eventForm').addEventListener('submit', e => { e.preventDefault(); const fd = new FormData(e.target), time24 = fd.get('time'); const [hh, mm] = time24.split(':').map(Number); const ampm = hh >= 12 ? 'PM' : 'AM', hh12 = hh % 12 || 12; state.events.push({ id: uid('e'), title: String(fd.get('title')).trim(), emoji: String(fd.get('emoji') || '📅').trim(), date: fd.get('date'), time: `${String(hh12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ampm}` }); save(); closeModal(); render(); toast('Event added'); }); }


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
  if (!currentAuthUser || !storageIsConfigured() || (mode !== 'drive' && mode !== 'both') || !d.connected || d.autoDaily === false || d.lastBackupDate === todayISO()) return;
  const run = () => { if (!googleAccessToken) return; uploadDriveBackup(); };
  if (googleAccessToken) setTimeout(run, 400);
  else if (ensureDriveClient()) { try { googleTokenClient.requestAccessToken({ prompt: '' }); } catch (e) { console.warn('Automatic Drive authorization unavailable:', e); } }
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

function setTodayLabels() { const d = new Date(); document.querySelectorAll('.today-label').forEach(x => x.textContent = d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })); }
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
    location.hash = '/login';
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
  document.querySelectorAll('[data-add-reminder]')
    .forEach(b =>
      b.addEventListener(
        'click',
        () => reminderForm()
      )
    );

  document.querySelectorAll('[data-edit-reminder]')
    .forEach(b =>
      b.addEventListener(
        'click',
        () => reminderForm(
          b.dataset.editReminder
        )
      )
    );
  document.querySelectorAll('[data-close-reminders]').forEach(b => b.addEventListener('click', () => document.getElementById('reminderPopover')?.classList.add('hidden')));
  document.addEventListener('keydown', keyHandler, { once: true });
  document.querySelectorAll('[data-open-habit]').forEach(b => b.addEventListener('click', () => habitForm()));
  document.querySelectorAll('[data-open-goal]').forEach(b => b.addEventListener('click', () => goalForm()));
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
document.addEventListener('click', e => {
  const addEventButton = e.target.closest('[data-add-event]');
  if (addEventButton) { e.preventDefault(); e.stopPropagation(); eventForm(calendarSelectedDate); return; }
  const action = e.target.closest('[data-menu-action]'); if (action) { const kind = action.closest('.menu-popover').dataset.kind, id = action.dataset.menuId; const obj = kind === 'goal' ? state.goals.find(g => g.id === id) : state.habits.find(h => h.id === id); if (!obj) return; const a = action.dataset.menuAction; if (a === 'update' && kind === 'goal') goalProgressForm(id); if (a === 'edit') kind === 'goal' ? goalForm(id) : habitForm(id); if (a === 'reminder' && kind === 'habit') { const existingReminder = state.reminders.find(r => r.habitId === id && r.source === 'manual'); reminderForm(existingReminder?.id); } if (a === 'trash') confirmDelete(kind, id); if (a === 'pause' && kind === 'goal') { obj.status = 'paused'; save(); render(); toast('Goal paused'); } if (a === 'complete' && kind === 'goal') { obj.current = obj.target; obj.status = 'completed'; save(); render(); toast('Goal completed'); } document.querySelectorAll('.menu-popover').forEach(x => x.remove()); return; } if (!e.target.closest('.menu-popover') && !e.target.closest('[data-menu]')) document.querySelectorAll('.menu-popover').forEach(x => x.remove()); if (!e.target.closest('#reminderPopover') && !e.target.closest('[data-reminders]')) document.getElementById('reminderPopover')?.classList.add('hidden'); });
function confirmDelete(kind, id) {
  const label = kind === 'goal' ? 'goal' : 'habit';
  modal(`Delete ${label}`, 'You will have a few seconds to undo this action.', `<div class="confirm-box"><p>Are you sure you want to delete this ${label}?</p><div class="form-actions"><button class="secondary-btn" data-modal-close>Cancel</button><button class="danger-btn" id="confirmDelete">Delete ${label}</button></div></div>`);
  document.getElementById('confirmDelete').addEventListener('click', () => {
    const collection = kind === 'goal' ? state.goals : state.habits;
    const index = collection.findIndex(x => x.id === id);
    if (index < 0) return;
    const deleted = clone(collection[index]);
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
      pendingUndo = null;
      save();
      render();
      toast(`${label[0].toUpperCase() + label.slice(1)} restored ✓`);
    });
  });
}


window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; if (currentRoute() === 'settings') render(); });
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; if (currentRoute() === 'settings') render(); toast('Habitly installed successfully'); });
if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn('Habitly service worker registration failed', e))); }

async function bootstrapApp() {
  if (window.habitlySupabase) {
    try {
      const { data } = await window.habitlySupabase.auth.getSession();
      if (data?.session?.user) {
        state = loadStateForUser(data.session.user);
        if (!state.profile.email) state.profile.email = data.session.user.email || '';
        if (data.session.user.user_metadata?.habitly_storage_setup && data.session.user.user_metadata?.habitly_storage_mode) { state.settings.storage = { mode: data.session.user.user_metadata.habitly_storage_mode, setupCompleted: true }; }
      }
    } catch (e) { console.error('Habitly session bootstrap failed:', e); }
    window.habitlySupabase.auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user || null, nextId = nextUser?.id || '';
      if (nextId !== (currentAuthUser?.id || '')) {
        state = nextUser ? loadStateForUser(nextUser) : normalizeState(clone(defaultState));
        if (nextUser && !state.profile.email) state.profile.email = nextUser.email || '';
        if (nextUser?.user_metadata?.habitly_storage_setup && nextUser?.user_metadata?.habitly_storage_mode) state.settings.storage = { mode: nextUser.user_metadata.habitly_storage_mode, setupCompleted: true };
        if (nextUser && location.hash !== '#/login') render();
      }
    });
  }
  if (!location.hash) location.hash = '/dashboard';
  render();
}
window.addEventListener('hashchange', () => { closeModal(); closeDrawer(); render(); });
bootstrapApp();
/* =========================
   START REMINDER SERVICE
========================= */

setInterval(() => {
  checkReminderNotifications();
}, 30000);

checkReminderNotifications();
setInterval(refreshGreeting, 60000);
