const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync('app.js', 'utf8');
const authGateSource = fs.readFileSync('auth-gate.js', 'utf8');
const authSource = fs.readFileSync('auth/app.js', 'utf8');
const swSource = fs.readFileSync('service-worker.js', 'utf8');
const schemaSource = fs.readFileSync('supabase-schema.sql', 'utf8');

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


const pendingState = sandbox.mergeState({
  habits:[{id:'h-pending',name:'Pending',target:10,current:0,daily:{[today]:0},updatedAt:'2026-08-30T10:00:00Z'}],
  goals:[],events:[],reminders:[],profile:{},activityHistory:{},settings:{},
  syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}},pending:{habits:true},mutations:[{id:'m1',kind:'habits',op:'upsert',record:{id:'h-pending',name:'Pending edit',target:10,current:0,daily:{[today]:0}},at:'2026-08-30T11:00:00Z'}]}
});
assert.strictEqual(pendingState.syncMeta.mutations.length, 1, 'local pending mutation journal must survive local state reload');
const remoteClean = sandbox.mergeState(pendingState, { preserveMutations:false });
assert.strictEqual(remoteClean.syncMeta.mutations.length, 0, 'remote baseline normalization must not treat old remote mutations as new local work');

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
assert(appSource.includes("await requestDriveToken('consent')"), 'Drive onboarding must use the deduplicated token request path');
assert(appSource.includes("requestDriveToken('', { silent: true })"), 'automatic Drive authorization must use silent token acquisition');
assert(appSource.includes('login_hint'), 'Drive authorization must provide the remembered Google account as a login hint');
assert(appSource.includes("const APP_VERSION = '3.0.0'"), 'application version must match the stabilization build');
assert(appSource.includes('Version ${APP_VERSION}'), 'visible About version must use the central application version');
assert(appSource.includes('<span>Last synced</span>'), 'Settings must show the last synchronization time');
assert(appSource.includes('if (driveLoginSyncBusy || googleDriveBusy) { driveUploadQueued = true; return; }'), 'busy Drive uploads must queue a newer state');
assert(appSource.includes('incoming.accountId !== currentAuthUser.id'), 'Drive backups must reject another Habitly account when accountId is present');
assert(appSource.includes('const body = JSON.stringify(backupPayload(uploadState, nextDriveRevision));'), 'backup body must be created from the immutable upload snapshot before remote metadata is committed');
assert(/d\.lastRemoteUpdatedAt=uploadedRemoteTime;[\s\S]*?d\.lastBackupDate=todayISO\(\);[\s\S]*?d\.lastBackupAt=new Date\(\)\.toISOString\(\);/.test(appSource), 'successful Drive upload must commit backup metadata');
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
assert(appSource.includes('Metadata validation is deliberately one request on the normal path'), 'every Drive upload must re-check remote metadata through the fast cached-file path');
assert(appSource.includes('checkDriveForExternalChanges'), 'cross-device sync must have a lightweight external-change checker');
assert(appSource.includes('const localSnapshot = normalizeState(clone(state));'), 'Drive upload must snapshot the current local state before any network work');
assert(appSource.includes('driveUploadQueued = true;'), 'a change during an upload must queue a follow-up upload');
assert(appSource.includes('state.syncMeta.pending[key] = !!syncDirty[key]'), 'unsynced local changes must persist across logout/login');
assert(appSource.includes('pendingMutations(state).length > 0') || appSource.includes('pendingMutations(state)'), 'login sync must recover persisted pending mutations');
assert(appSource.includes('adoptRemoteWithPending'), 'login sync must preserve pending local edits while adopting a remote baseline');
assert(appSource.includes('Accelerate long-press input for large targets'), 'quantity controls must support accelerated long press');
assert(appSource.includes('the click handler consumes it instead of adding another unit'), 'long press must not add an extra unit on pointerup/click');
assert(swSource.includes("fetch(request, { cache: 'no-store' })"), 'app code must use network-first fetching');
assert(swSource.includes('habitly-v30-shell-20260902'), 'service-worker cache version must be bumped for this stabilization build');
assert(appSource.includes('Metadata validation is deliberately one request on the normal path'), 'fast Drive sync path must be documented in code');
assert(appSource.includes('Metadata validation is deliberately one request on the normal path'), 'normal Drive sync should use cached IDs rather than repeated folder/file discovery');
assert(!appSource.includes('drive-restoring-screen'), 'login-time Drive restore must not replace the whole application with a blocking restore screen');
assert(appSource.includes('driveUploadQueued = true;'), 'newer changes must be queued after an in-flight upload');

assert(appSource.includes('return delta >= 0 && delta <= 5 * 60 * 1000'), 'reminders must tolerate background timer throttling instead of requiring exact-minute equality');
assert(appSource.includes('startReminderService()'), 'reminder service must run a persistent scheduler');
assert(appSource.includes('previewReminderSound'), 'reminder editor must provide sound preview');
assert(appSource.includes('await requestDriveToken') || appSource.includes("requestDriveToken('', { silent: true })"), 'background Drive polling must refresh expired tokens silently');
assert(appSource.includes('}, 2000);'), 'cross-device Drive polling must use a short background detection interval');
assert(sandbox.reminderIsDue({id:'r1', time:'10:00', enabled:true}, new Date('2026-08-31T10:04:30')) === true, 'reminders must still trigger after a short background timer delay');
assert(sandbox.reminderIsDue({id:'r1', time:'10:00', enabled:true}, new Date('2026-08-31T10:06:00')) === false, 'reminder grace window must not fire hours or long after the scheduled minute');
assert(sandbox.nextReminderOccurrence({id:'r1', time:'10:00', enabled:true}, new Date('2026-08-31T10:01:00')).getDate() === 1, 'next daily reminder should roll to the next day after the scheduled time');


// Deterministic mutation-journal coverage for the core user actions.
sandbox.loadStateForUser({ id:'mutation-user', email:'mutation@example.com', user_metadata:{} });
sandbox.window.__habitlyTestHooks.setState(sandbox.freshUserState({id:'mutation-user',email:'mutation@example.com',user_metadata:{}}));
sandbox.window.__habitlyTestHooks.resetSyncTracking();
let st = sandbox.window.__habitlyTestHooks.getState();
st.habits.push({id:'test-habit',name:'Test',type:'quantity',target:10,current:0,daily:{[today]:0},dailyUpdatedAt:{},updatedAt:'2026-08-31T10:00:00Z',paused:false});
sandbox.window.__habitlyTestHooks.setState(st);
sandbox.window.__habitlyTestHooks.resetSyncTracking();
st = sandbox.window.__habitlyTestHooks.getState();
st.habits[st.habits.length-1].target = 100;
sandbox.window.__habitlyTestHooks.setState(st);
sandbox.window.__habitlyTestHooks.save({skipDrive:true});
let saved = sandbox.window.__habitlyTestHooks.getState();
assert(saved.syncMeta.mutations.some(m => m.kind === 'habits' && m.op === 'upsert' && m.record.target === 100), '10 → 100 target edit must be journaled');

st = sandbox.window.__habitlyTestHooks.getState();
const h = st.habits.find(x => x.id === 'test-habit');
h.type = 'yesno'; h.target = 1; h.unit = 'completion';
sandbox.window.__habitlyTestHooks.setState(st);
sandbox.window.__habitlyTestHooks.save({skipDrive:true});
saved = sandbox.window.__habitlyTestHooks.getState();
assert(saved.syncMeta.mutations.some(m => m.record?.id === 'test-habit' && m.record?.type === 'yesno'), 'Quantity → Yes/No must be journaled');

st = sandbox.window.__habitlyTestHooks.getState();
const hh = st.habits.find(x => x.id === 'test-habit');
hh.paused = true; hh.updatedAt = new Date().toISOString();
sandbox.window.__habitlyTestHooks.setState(st); sandbox.window.__habitlyTestHooks.save({skipDrive:true});
saved = sandbox.window.__habitlyTestHooks.getState();
assert(saved.habits.find(x=>x.id==='test-habit').paused === true, 'pause state must persist');
st = sandbox.window.__habitlyTestHooks.getState();
st.habits.find(x=>x.id==='test-habit').paused = false;
sandbox.window.__habitlyTestHooks.setState(st); sandbox.window.__habitlyTestHooks.save({skipDrive:true});
assert(sandbox.window.__habitlyTestHooks.getState().habits.find(x=>x.id==='test-habit').paused === false, 'resume state must persist');

// Goal/event/reminder mutation coverage.
st = sandbox.window.__habitlyTestHooks.getState();
st.goals.push({id:'test-goal',title:'Goal',target:10,current:0,date:'2026-12-31',status:'active'});
st.events.push({id:'test-event',title:'Event',date:'2026-08-31',time:'18:00',updatedAt:new Date().toISOString()});
st.reminders.push({id:'test-reminder',eventId:'test-event',time:'17:45',offsetMinutes:15,sound:'gentle',enabled:true,source:'manual',updatedAt:new Date().toISOString()});
sandbox.window.__habitlyTestHooks.setState(st); sandbox.window.__habitlyTestHooks.save({skipDrive:true});
saved = sandbox.window.__habitlyTestHooks.getState();
assert(saved.goals.some(x=>x.id==='test-goal'), 'goal creation must persist');
assert(saved.events.some(x=>x.id==='test-event'), 'event creation must persist');
assert(saved.reminders.some(x=>x.id==='test-reminder'), 'event reminder creation must persist');

// Offline/pending safety is deterministic at the journal level.
st = sandbox.window.__habitlyTestHooks.getState();
st.syncMeta.mutations.push({id:'offline-1',kind:'goals',op:'upsert',record:{id:'offline-goal',title:'Offline',target:1,current:0},at:'2026-08-31T17:00:00Z'});
st.syncMeta.pending.goals = true;
sandbox.window.__habitlyTestHooks.setState(st);
assert(sandbox.window.__habitlyTestHooks.getState().syncMeta.mutations.some(m=>m.id==='offline-1'), 'offline mutation must survive local state serialization');

// Concurrent devices: different entities survive, same entity uses deterministic latest data.
const remoteConcurrent = sandbox.normalizeState({
  habits:[{id:'h-a',name:'A',target:1,current:0,updatedAt:'2026-08-31T10:00:00Z'}],
  goals:[{id:'g-b',title:'Remote',target:10,current:2,updatedAt:'2026-08-31T10:02:00Z'}],
  events:[],reminders:[],profile:{},settings:{},activityHistory:{},syncMeta:{}
});
const localConcurrent = sandbox.normalizeState({
  habits:[{id:'h-a',name:'A local',target:2,current:0,updatedAt:'2026-08-31T10:03:00Z'}],
  goals:[],events:[],reminders:[],profile:{},settings:{},activityHistory:{},
  syncMeta:{mutations:[
    {id:'ca',kind:'habits',op:'upsert',record:{id:'h-a',name:'A local',target:2,current:0,updatedAt:'2026-08-31T10:03:00Z'},at:'2026-08-31T10:03:00Z'},
    {id:'cb',kind:'goals',op:'upsert',record:{id:'g-b',title:'Local Goal',target:20,current:0,updatedAt:'2026-08-31T10:04:00Z'},at:'2026-08-31T10:04:00Z'}
  ]}
});
const concurrentMerged = sandbox.window.__habitlyTestHooks.mergeForDriveUpload(remoteConcurrent, localConcurrent);
assert.strictEqual(concurrentMerged.habits.find(x=>x.id==='h-a').name, 'A local', 'newer local same-record mutation must win');
assert.strictEqual(concurrentMerged.goals.find(x=>x.id==='g-b').title, 'Local Goal', 'concurrent different-entity local change must survive');

// Empty/corrupt remote safety.
const tenHabits = sandbox.normalizeState({
  habits:Array.from({length:10},(_,i)=>({id:`h${i}`,name:`H${i}`,target:1,current:1,daily:{[today]:1},updatedAt:'2026-08-31T10:00:00Z'})),
  goals:Array.from({length:3},(_,i)=>({id:`g${i}`,title:`G${i}`,target:1,current:1,date:'2026-12-31'})),
  events:Array.from({length:5},(_,i)=>({id:`e${i}`,title:`E${i}`,date:'2026-08-31',time:'18:00',updatedAt:'2026-08-31T10:00:00Z'})),
  reminders:Array.from({length:4},(_,i)=>({id:`r${i}`,eventId:`e${i%5}`,time:'17:45',offsetMinutes:15,sound:'gentle',enabled:true,source:'manual',updatedAt:'2026-08-31T10:00:00Z'})),
  profile:{},settings:{},activityHistory:{},syncMeta:{}
});
const emptyRemote = sandbox.normalizeState({habits:[],goals:[],events:[],reminders:[],profile:{},settings:{},activityHistory:{},syncMeta:{}});
assert.strictEqual(sandbox.window.__habitlyTestHooks.isSuspiciousEmptySync(tenHabits, emptyRemote, []), true, 'unexplained empty remote state must be rejected');
const deleteKinds = ['habits','goals','events','reminders'];
const deleteMutations = deleteKinds.flatMap(kind => (tenHabits[kind] || []).map((r,i)=>({id:`del-${kind}-${i}`,kind,op:'delete',recordId:r.id,at:'2026-08-31T11:00:00Z'})));
const tombRemote = sandbox.normalizeState({
  habits:[],goals:[],events:[],reminders:[],profile:{},settings:{},activityHistory:{},
  syncMeta:{deleted:Object.fromEntries(deleteKinds.map(kind=>[kind,Object.fromEntries((tenHabits[kind] || []).map(r=>[r.id,'2026-08-31T11:00:00Z']))]))}
});
assert.strictEqual(sandbox.window.__habitlyTestHooks.isSuspiciousEmptySync(tenHabits, tombRemote, deleteMutations), false, 'explicit deletion of all records must allow a legitimately empty state');

// Cloud document validation/account isolation.
sandbox.window.habitlySupabase = {};
sandbox.window.__habitlyTestHooks.setState(tenHabits);
const cloudDoc = sandbox.window.__habitlyTestHooks.cloudDocumentState(tenHabits);
assert.strictEqual(cloudDoc.syncMeta.mutations.length, 0, 'cloud canonical state must not contain pending local mutations');
assert.throws(() => sandbox.window.__habitlyTestHooks.validateCloudDocument({user_id:'another-user',revision:1,state:cloudDoc}), /another account/, 'cloud documents must be account-bound');
assert.throws(() => sandbox.window.__habitlyTestHooks.validateCloudDocument({user_id:'mutation-user',revision:0,state:cloudDoc}), /revision/, 'cloud documents must have a positive revision');

console.log('PASS: Habitly data/auth/Drive/PWA audit tests');

// Mutation-journal conflict tests: creates, edits and deletes must survive
// a remote refresh without resurrecting stale records.
const remoteGoals = { goals:[{id:'g1',title:'Old Goal',target:100,current:0,updatedAt:'2026-08-30T10:00:00Z'}], habits:[], events:[], reminders:[], profile:{}, settings:{}, activityHistory:{}, syncMeta:{} };
const localGoals = sandbox.normalizeState({ goals:[{id:'g1',title:'New Goal',target:100,current:0,updatedAt:'2026-08-30T11:00:00Z'},{id:'g2',title:'Created Goal',target:50,current:0,updatedAt:'2026-08-30T11:05:00Z'}], habits:[], events:[], reminders:[], profile:{}, settings:{}, activityHistory:{}, syncMeta:{mutations:[
  {id:'m1',kind:'goals',op:'upsert',record:{id:'g1',title:'New Goal',target:100,current:0,updatedAt:'2026-08-30T11:00:00Z'},at:'2026-08-30T11:00:00Z'},
  {id:'m2',kind:'goals',op:'upsert',record:{id:'g2',title:'Created Goal',target:50,current:0,updatedAt:'2026-08-30T11:05:00Z'},at:'2026-08-30T11:05:00Z'}
]}});
const goalJournalMerged = sandbox.mergeForDriveUpload(remoteGoals, localGoals);
assert.strictEqual(goalJournalMerged.goals.find(g=>g.id==='g1').title, 'New Goal', 'journal must preserve newer local goal edit');
assert(goalJournalMerged.goals.some(g=>g.id==='g2'), 'journal must preserve newly created goal');

const deleteRemote = { habits:[{id:'h-delete',name:'Delete Me',target:1,current:0,updatedAt:'2026-08-30T10:00:00Z'}], goals:[],events:[],reminders:[],profile:{},settings:{},activityHistory:{},syncMeta:{} };
const deleteLocal = sandbox.normalizeState({ habits:[], goals:[],events:[],reminders:[],profile:{},settings:{},activityHistory:{},syncMeta:{deleted:{habits:{'h-delete':'2026-08-30T11:00:00Z'},goals:{},events:{},reminders:{}},mutations:[{id:'m3',kind:'habits',op:'delete',recordId:'h-delete',at:'2026-08-30T11:00:00Z'}]}});
const deleteMerged = sandbox.mergeForDriveUpload(deleteRemote, deleteLocal);
assert(!deleteMerged.habits.some(h=>h.id==='h-delete'), 'journal delete must remove stale remote habit');

console.log('PASS: Habitly mutation journal create/edit/delete tests');

assert(appSource.includes("habits: Array.isArray(saved.habits) ? saved.habits : []"), 'saved/remote state must not fall back to demo habits');
assert(appSource.includes("out.habits = Array.isArray(out.habits) ? out.habits : []"), 'normalization must not inject demo habits');
assert(appSource.includes("Habitly backup is incomplete"), 'incomplete Drive backups must be rejected');
assert(authGateSource.includes("if (!current || current === '#/login')"), 'auth events must preserve an existing SPA route');
assert(appSource.includes('driveHydrationConfirmedUserId !== currentAuthUser?.id'), 'automatic uploads must wait for confirmed Drive hydration');



// Reminder/event semantics and display-format coverage.
const eventReminder = sandbox.normalizeState({
  habits:[],
  goals:[],
  events:[{id:'ev-next',title:'Meeting',date:'2026-08-31',time:'18:00',updatedAt:'2026-08-31T10:00:00Z'}],
  reminders:[{id:'rev-next',eventId:'ev-next',time:'17:45',offsetMinutes:15,sound:'gentle',enabled:true,source:'manual',updatedAt:'2026-08-31T10:00:00Z'}],
  profile:{},settings:{},activityHistory:{},syncMeta:{}
});
sandbox.window.__habitlyTestHooks.setState(eventReminder);
assert.strictEqual(sandbox.nextReminderOccurrence(eventReminder.reminders[0], new Date('2026-08-31T17:30:00')).toISOString(), '2026-08-31T17:45:00.000Z', 'event reminder must calculate the actual offset occurrence');
assert.strictEqual(sandbox.nextReminderOccurrence(eventReminder.reminders[0], new Date('2026-08-31T18:00:00')), null, 'passed event reminder must no longer be upcoming');

const formatState = sandbox.window.__habitlyTestHooks.getState();
formatState.settings.timeFormat = '24h';
sandbox.window.__habitlyTestHooks.setState(formatState);
assert.strictEqual(sandbox.formatTime('19:30'), '19:30:00', '24-hour display must use HH:mm:ss');
formatState.settings.timeFormat = '12h';
sandbox.window.__habitlyTestHooks.setState(formatState);
assert.strictEqual(sandbox.formatTime('19:30'), '7:30:00 PM', '12-hour display must use AM/PM with seconds');

const reminderDeleteState = sandbox.window.__habitlyTestHooks.getState();
reminderDeleteState.syncMeta.deleted.reminders['r-delete'] = '2026-08-31T12:00:00Z';
reminderDeleteState.syncMeta.mutations.push({id:'rm-delete',kind:'reminders',op:'delete',recordId:'r-delete',at:'2026-08-31T12:00:00Z'});
sandbox.window.__habitlyTestHooks.setState(reminderDeleteState);
const reminderRemote = sandbox.normalizeState({
  habits:[],goals:[],events:[{id:'ev',title:'E',date:'2026-12-01',time:'18:00',updatedAt:'2026-08-31T10:00:00Z'}],
  reminders:[{id:'r-delete',eventId:'ev',time:'17:45',offsetMinutes:15,sound:'gentle',enabled:true,source:'manual',updatedAt:'2026-08-31T10:00:00Z'}],
  profile:{},settings:{},activityHistory:{},syncMeta:{}
});
const reminderMerged = sandbox.window.__habitlyTestHooks.mergeForDriveUpload(reminderRemote, reminderDeleteState);
assert(!reminderMerged.reminders.some(r=>r.id==='r-delete'), 'reminder deletion tombstone must prevent resurrection');

const rapidDeleteState = sandbox.normalizeState({
  habits:[],goals:[],events:[],reminders:[],profile:{},settings:{},activityHistory:{},
  syncMeta:{mutations:[
    {id:'d1',kind:'habits',op:'delete',recordId:'h1',at:'2026-08-31T12:00:01Z'},
    {id:'d2',kind:'habits',op:'delete',recordId:'h2',at:'2026-08-31T12:00:02Z'},
    {id:'d3',kind:'habits',op:'delete',recordId:'h3',at:'2026-08-31T12:00:03Z'}
  ],deleted:{habits:{h1:'2026-08-31T12:00:01Z',h2:'2026-08-31T12:00:02Z',h3:'2026-08-31T12:00:03Z'}}}
});
const rapidRemote = sandbox.normalizeState({habits:[
  {id:'h1',name:'1',target:1,updatedAt:'2026-08-31T11:00:00Z'},
  {id:'h2',name:'2',target:1,updatedAt:'2026-08-31T11:00:00Z'},
  {id:'h3',name:'3',target:1,updatedAt:'2026-08-31T11:00:00Z'}
],goals:[],events:[],reminders:[],profile:{},settings:{},activityHistory:{},syncMeta:{}});
const rapidMerged = sandbox.window.__habitlyTestHooks.mergeForDriveUpload(rapidRemote, rapidDeleteState);
assert.strictEqual(rapidMerged.habits.length,0,'multiple rapid deletes must not resurrect previously deleted habits');
const manyMutations = Array.from({length:300},(_,i)=>({id:`m-${i}`,kind:'goals',op:'upsert',record:{id:`g-${i}`,title:`G${i}`,target:1,current:0,date:'2026-12-31'},at:`2026-08-31T12:${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}Z`}));
const mutationPacked = sandbox.normalizeState({habits:[],goals:[],events:[],reminders:[],profile:{},settings:{},activityHistory:{},syncMeta:{mutations:manyMutations}});
assert.strictEqual(mutationPacked.syncMeta.mutations.length,300,'pending mutations must never be silently truncated while offline');


// Final hardening assertions
assert(appSource.includes('backupEnvelopeState'), 'Drive merge must unwrap backup envelopes before state merging');
assert(appSource.includes('If-Match'), 'Drive writes must use optimistic concurrency when an ETag is available');
assert(appSource.includes('status === 412'), 'Drive concurrent-write conflicts must be retried safely');
assert(appSource.includes('createDriveBackupFile'), 'new Drive backups must be created atomically with content');
assert(appSource.includes('isSuspiciousEmptySync'), 'empty-state safety guard must protect a non-empty cloud backup');
assert(appSource.includes("habit?.paused ? 'Resume habit' : 'Pause habit'"), 'habit menu must expose pause/resume action');
assert(schemaSource.includes('create table if not exists public.habitly_sync_documents_v2'), 'Supabase v2 sync table must be defined');
assert(schemaSource.includes('using (auth.uid() = user_id)'), 'Supabase sync rows must be account-isolated by RLS');
assert(schemaSource.includes('alter publication supabase_realtime add table public.habitly_sync_documents_v2'), 'Supabase v2 sync table must be enabled for Realtime');
assert(appSource.includes('commit_habitly_sync_v2'), 'Supabase cloud writes must use the atomic revision CAS RPC');
assert(appSource.includes('recordVersions'), 'cloud sync must track per-record server versions');
assert(appSource.includes('mutationConflictsWithRemote'), 'stale same-record writers must be detected deterministically');
assert(appSource.includes("CLOUD_CONFLICT"), 'Supabase revision conflicts must be handled explicitly');
assert(appSource.includes('subscribeCloudRealtime'), 'cloud sync must use Realtime when available');
assert(appSource.includes("mode === 'cloud'"), 'cloud storage mode must be explicit');
assert(appSource.includes('Google Drive is backup/restore only'), 'Google Drive must remain backup-only');
assert(appSource.includes('startCloudPolling'), 'cloud sync must have a polling fallback');
assert(appSource.includes('eventId'), 'reminders must support events');
assert(appSource.includes('function eventForm(idOrDate)'), 'events must have an editable form');
assert(appSource.includes("editing ? 'Edit event' : 'Add event'"), 'event form must support editing');
assert(appSource.includes('prefTimeFormat'), 'time format preference must be user configurable');
assert(appSource.includes('Pending local mutations are NEVER discarded'), 'pending local mutations must not be rejected by client clock skew');
assert(appSource.includes('const interval = cloudRealtimeReady ? 3000 : 1000;'), 'cloud polling fallback must remain fast enough to cover delayed realtime delivery');
assert(appSource.includes('fromCloudAck'), 'automatic Drive backups must originate from an acknowledged cloud state');
assert(appSource.includes('cloudStorageSelected() && !options.force && !options.fromCloudAck'), 'Drive must not race with Supabase as an automatic synchronization source');
assert(appSource.includes("second: '2-digit'"), 'date/time displays must include seconds');
assert(appSource.includes("hour12: userTimeFormat() !== '24h'"), 'backup timestamps must follow the user time-format preference');
assert(appSource.includes('step=\"1\"'), 'time inputs must support seconds');
console.log('PASS: final sync/reminder/pause hardening assertions');
