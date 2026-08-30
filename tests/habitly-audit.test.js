const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync('app.js', 'utf8');
const authGateSource = fs.readFileSync('auth-gate.js', 'utf8');
const authSource = fs.readFileSync('auth/app.js', 'utf8');
const swSource = fs.readFileSync('service-worker.js', 'utf8');

const element = () => ({
  innerHTML: '', classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  setAttribute(){}, addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }
});
const elements = new Map();
const documentStub = {
  getElementById(id){ if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  addEventListener(){},
  body: { classList: { add(){}, remove(){}, toggle(){} } },
  visibilityState: 'visible'
};
const windowStub = {
  habitlySupabase: null,
  addEventListener(){},
  removeEventListener(){},
  matchMedia(){ return { matches:false }; },
  navigator: { standalone:false },
  parent: null,
  location: { hash:'#/login', origin:'http://localhost' },
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval,
};
windowStub.window = windowStub;
windowStub.parent = windowStub;
const storage = new Map();
const localStorageStub = { getItem(k){ return storage.has(k) ? storage.get(k) : null; }, setItem(k,v){ storage.set(k,String(v)); }, removeItem(k){ storage.delete(k); } };
const sandbox = {
  window: windowStub,
  localStorage: localStorageStub,
  document: documentStub,
  navigator: windowStub.navigator,
  location: windowStub.location,
  console,
  setTimeout, clearTimeout, setInterval:()=>0, clearInterval,
  Date, Math, JSON, Number, String, Object, Array, Map, Set, Promise, URL, Blob: class Blob {},
  Headers: class Headers { constructor(){ } set(){} },
  Notification: undefined,
  google: undefined,
  fetch: async()=>({ ok:false, status:503 }),
};
vm.createContext(sandbox);
vm.runInContext(appSource, sandbox, { filename:'app.js' });

const today = sandbox.todayISO();

const ownerUser = { id:'owner-a', email:'owner@example.com', user_metadata:{} };
storage.set('habitly.final.v2', JSON.stringify({ profile:{email:'other@example.com'}, habits:[{id:'h1',name:'Other',target:8,current:9,daily:{[today]:9}}], goals:[], events:[], reminders:[], activityHistory:{}, settings:{} }));
const isolated = sandbox.loadStateForUser(ownerUser);
assert.strictEqual(isolated.habits[0].current, 0, 'unowned legacy storage must never leak into a new account');
assert(storage.has('habitly.final.v2'), 'unowned legacy data must remain quarantined for explicit recovery');

storage.set('habitly.final.v2', JSON.stringify({ profile:{email:'owner@example.com'}, habits:[{id:'h1',name:'Water',target:8,current:2,daily:{[today]:2}}], goals:[], events:[], reminders:[], activityHistory:{}, settings:{} }));
const migrated = sandbox.loadStateForUser(ownerUser);
assert.strictEqual(migrated.habits[0].current, 2, 'owned legacy data should migrate intact');
assert(storage.has('habitly.final.v3.user.owner-a'), 'migrated state must become user-scoped');
assert(!storage.has('habitly.final.v2'), 'legacy key must be removed after verified ownership migration');

const fresh = sandbox.freshUserState({ id:'user-a', email:'a@example.com', user_metadata:{ full_name:'Alice' } });
assert(fresh.habits.length > 0, 'structural default habits should remain available');
assert(fresh.habits.every(h => h.current === 0 && Object.keys(h.daily).length === 0), 'new user habits must start at zero with no daily records');
assert.strictEqual(JSON.stringify(fresh.goals), '[]', 'new user goals must be empty');
assert.strictEqual(JSON.stringify(fresh.events), '[]', 'new user events must be empty');
assert.strictEqual(JSON.stringify(fresh.reminders), '[]', 'new user reminders must be empty');
assert.strictEqual(JSON.stringify(fresh.activityHistory), '{}', 'new user history must be empty');
assert.strictEqual(fresh.profile.email, 'a@example.com');

const historical = sandbox.normalizeState({
  habits:[{id:'h1', name:'Water', target:8, current:17, daily:{'2026-08-24':17}}],
  goals:[], events:[], reminders:[], activityHistory:{}, profile:{}, settings:{}
});
assert.strictEqual(historical.habits[0].current, 0, 'historical current must not become today current');
assert.strictEqual(historical.habits[0].daily['2026-08-24'], 17);
assert.strictEqual(historical.activityHistory[today], undefined, 'normalization must not manufacture today history');

const actualToday = sandbox.normalizeState({
  habits:[{id:'h1', name:'Water', target:8, current:3, daily:{[today]:3}}],
  goals:[], events:[], reminders:[], activityHistory:{}, profile:{}, settings:{}
});
assert.strictEqual(actualToday.habits[0].current, 3, 'today must come from today daily record');

sandbox.window.__habitlyTestHooks.setState({ habits: fresh.habits, goals:[], events:[], reminders:[], activityHistory:{}, profile:{}, settings:{habits:{weekStarts:'Monday'}} });
const mondayBounds = sandbox.weekBounds(new Date('2026-08-30T12:00:00'));
assert.strictEqual(sandbox.dateISO(mondayBounds.start), '2026-08-24', 'week calculations must honor Monday week start');

const snap = sandbox.buildSnapshot({ habits:[{id:'h1',name:'Water',target:8,current:99,daily:{'2026-08-24':4}}] }, '2026-08-24');
assert.strictEqual(snap.habits[0].current, 4, 'historical snapshot must use only historical daily record');

const reminder = { id:'r1', habitId:'h1', time:'20:00', enabled:true };
const next = sandbox.nextReminderOccurrence(reminder, new Date('2026-08-30T21:00:00'));
assert.strictEqual(next.toISOString().slice(0,10), '2026-08-31', 'upcoming reminder must not reuse an old date');

const base = { habits:[{id:'h1',name:'Water',target:8,current:1,daily:{[today]:1},updatedAt:'2026-08-30T10:00:00Z',dailyUpdatedAt:{[today]:'2026-08-30T10:00:00Z'}}] };
const remote = { habits:[{id:'h1',name:'Water',target:8,current:5,daily:{[today]:5},updatedAt:'2026-08-30T11:00:00Z',dailyUpdatedAt:{[today]:'2026-08-30T11:00:00Z'}}] };
const local = { habits:[{id:'h1',name:'Water',target:8,current:3,daily:{[today]:3},updatedAt:'2026-08-30T10:30:00Z',dailyUpdatedAt:{[today]:'2026-08-30T10:30:00Z'}}] };
const merged = sandbox.mergeCollectionById(remote.habits, local.habits, true, base.habits);
assert.strictEqual(merged[0].daily[today], 5, 'newer remote daily record must win deterministic conflict');

const editBase = [{id:'h-edit', name:'Read', type:'quantity', target:10, unit:'pages', current:0, daily:{}, updatedAt:'2026-08-30T10:00:00Z'}];
const editLocal = [{id:'h-edit', name:'Read', type:'yesno', target:1, unit:'completion', current:1, daily:{[today]:1}, updatedAt:'2026-08-30T10:05:00Z', dailyUpdatedAt:{[today]:'2026-08-30T10:05:00Z'}}];
const editMerged = sandbox.mergeCollectionById(editBase, editLocal, true, editBase);
assert.strictEqual(editMerged[0].type, 'yesno', 'a local habit type edit must win when Drive has not changed since the baseline');
assert.strictEqual(editMerged[0].target, 1, 'a local habit target edit must not be reverted by the unchanged Drive baseline');


assert(authGateSource.includes("event === 'SIGNED_IN' || event === 'INITIAL_SESSION'"));
assert(authGateSource.includes("event === 'SIGNED_OUT' || event === 'INITIAL_SESSION'"));
assert(!authGateSource.includes("event === 'TOKEN_REFRESHED') goDashboard"), 'token refresh must not navigate');
assert((appSource.match(/auth\.onAuthStateChange\(/g) || []).length === 0, 'main app must not register a second Supabase auth listener');
assert((authSource.match(/auth\.onAuthStateChange\(/g) || []).length === 0, 'auth iframe must not register a duplicate Supabase auth listener');
assert(authSource.includes('googleOAuthInFlight'), 'Google OAuth must have an in-flight guard');
assert(appSource.includes('await requestDriveToken(\'consent\')'), 'Drive onboarding must use the deduplicated token request path');
assert(appSource.includes('if (driveLoginSyncBusy || googleDriveBusy) { driveUploadQueued = true; return; }'), 'busy Drive uploads must queue a newer state');
assert(appSource.includes('incoming.accountId !== currentAuthUser.id'), 'Drive backups must reject another Habitly account when accountId is present');
assert(appSource.includes('const body = JSON.stringify(backupPayload(uploadState));'), 'backup body must be created from the immutable upload snapshot before remote metadata is committed');
assert(/d\.lastRemoteUpdatedAt = uploadedRemoteTime;[\s\S]*?d\.lastBackupDate = nextBackupDate;[\s\S]*?d\.lastBackupAt = nextBackupAt;/.test(appSource), 'successful Drive upload must commit backup metadata');
assert(!/function save\(options = \{\}\) \{[\s\S]*?daily\[t\] = Math\.max\(0, Number\(h\.current\)/.test(appSource), "save() must not manufacture today's daily progress");
assert(appSource.includes('type=\"text\" inputmode=\"numeric\" pattern=\"[0-9]*\"'), 'habit target editor must use a stable text/numeric input for multi-digit entry');
assert(appSource.includes("targetInput.addEventListener('beforeinput'"), 'habit target editor must guard non-numeric typing without coercing the value on every keystroke');
assert(!appSource.includes("targetInput.addEventListener('input', () => {"), 'habit target editor must not rewrite the field during normal input events');
assert(appSource.includes("const rawTarget = String(fd.get('target') ?? '').trim();"), 'habit target must be validated from the submitted draft value');

const deletionBase = [{id:'h-delete',name:'Delete Me',target:8,current:2,daily:{[today]:2},updatedAt:'2026-08-30T10:00:00Z'}];
const deletionRemote = [{id:'h-delete',name:'Delete Me',target:8,current:2,daily:{[today]:2},updatedAt:'2026-08-30T10:00:00Z'}];
const deletionMerged = sandbox.mergeCollectionById(deletionRemote, [], true, deletionBase, {'h-delete':'2026-08-30T12:00:00Z'});
assert.strictEqual(deletionMerged.length, 0, 'newer local habit deletion tombstone must not be resurrected from Drive');
const newerRemote = sandbox.mergeCollectionById([{...deletionRemote[0],updatedAt:'2026-08-30T13:00:00Z'}], [], true, deletionBase, {'h-delete':'2026-08-30T12:00:00Z'});
assert.strictEqual(newerRemote.length, 1, 'a genuinely newer remote habit edit may survive a stale local deletion');
assert(appSource.includes('one metadata request for the cached backup file'), 'every Drive upload must re-check remote metadata through the fast cached-file path');
assert(!appSource.includes('if (now - driveLastSyncCheckAt >= 15000)'), 'Drive upload must not skip remote conflict checks for 15 seconds');
assert(appSource.includes('const localSnapshot = normalizeState(clone(state));'), 'Drive upload must snapshot the current local state before any network work');
assert(appSource.includes('driveUploadQueued = true;'), 'a change during an upload must queue a follow-up upload');
assert(appSource.includes('state.syncMeta.pending[key] = true'), 'unsynced local changes must persist across logout/login');
assert(appSource.includes('const persistedPending = { ...(state.syncMeta?.pending || {}) };'), 'login sync must recover persisted pending changes');
assert(appSource.includes('A previous session may have changed data while Drive was unavailable'), 'login sync must not blindly discard pending local edits');
assert(appSource.includes('Accelerate long-press input for large targets'), 'quantity controls must support accelerated long press');
assert(appSource.includes('the click handler consumes it instead of adding another unit'), 'long press must not add an extra unit on pointerup/click');
assert(swSource.includes("fetch(request, { cache: 'no-store' })"), 'app code must use network-first fetching');
assert(swSource.includes('habitly-v11-shell-20260830'), 'service-worker cache version must be bumped for this stabilization build');
assert(appSource.includes('FAST SYNC PATH'), 'fast Drive sync path must be documented in code');
assert(appSource.includes('one metadata request for the cached backup file'), 'normal Drive sync should use cached IDs rather than repeated folder/file discovery');
assert(appSource.includes('queueMicrotask(() => scheduleDriveBackup())'), 'newer changes must be queued after an in-flight upload');

console.log('PASS: Habitly data/auth/Drive/PWA audit tests');
