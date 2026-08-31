const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync('app.js', 'utf8');
const element = () => ({
  innerHTML: '', classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  setAttribute(){}, addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; }
});
const elements = new Map();
const documentStub = {
  getElementById(id){ if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
  querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(){},
  body: { classList: { add(){}, remove(){}, toggle(){} } }, visibilityState:'visible'
};
const windowStub = {
  habitlySupabase: null, addEventListener(){}, removeEventListener(){},
  matchMedia(){ return {matches:false}; }, navigator:{standalone:false,onLine:true},
  parent:null, location:{hash:'#/login',origin:'http://localhost'}
};
windowStub.window = windowStub; windowStub.parent = windowStub;
const storage = new Map();
const localStorageStub = {
  getItem(k){ return storage.has(k) ? storage.get(k) : null; },
  setItem(k,v){ storage.set(k,String(v)); }, removeItem(k){ storage.delete(k); }
};
const sandbox = {
  window:windowStub, localStorage:localStorageStub, document:documentStub,
  navigator:windowStub.navigator, location:windowStub.location, console,
  setTimeout,clearTimeout,setInterval:()=>0,clearInterval,Date,Math,JSON,Number,String,
  Object,Array,Map,Set,Promise,URL,Blob:class Blob{},
  Headers:class Headers{constructor(){} set(){} get(){return ''}},
  Notification:undefined, google:undefined, fetch:async()=>({ok:false,status:503})
};
vm.createContext(sandbox);
vm.runInContext(appSource,sandbox,{filename:'app.js'});

const user = {id:'cloud-user',email:'cloud@example.com',user_metadata:{}};
sandbox.loadStateForUser(user);
let state = sandbox.freshUserState(user);
state.settings.storage = {mode:'both',setupCompleted:true};
state.goals = [{id:'g1',title:'Remote baseline',target:100,current:10,date:'2026-12-31',status:'active',updatedAt:'2026-08-31T10:00:00Z'}];
sandbox.window.__habitlyTestHooks.setState(state);
sandbox.window.__habitlyTestHooks.resetSyncTracking();

let delayCloudRead = false;
let releaseCloudRead = null;
let remoteRow = {
  user_id:user.id, revision:1,
  state:sandbox.window.__habitlyTestHooks.cloudDocumentState(state),
  updated_at:'2026-08-31T10:00:00Z', updated_by:'device-a'
};

function chainSelect() {
  return {
    select(){ return this; },
    eq(column,value){ this._eq = this._eq || []; this._eq.push([column,value]); return this; },
    async maybeSingle(){
      if (this._mode === 'update') {
        const expected = this._eq.find(x=>x[0]==='revision')?.[1];
        if (Number(expected) !== Number(remoteRow.revision)) return {data:null,error:null};
        remoteRow = {...this._payload, user_id:user.id};
        return {data:remoteRow,error:null};
      }
      if (delayCloudRead) {
        return new Promise(resolve => { releaseCloudRead = () => resolve({data:remoteRow,error:null}); });
      }
      return {data:remoteRow,error:null};
    },
    async single(){ remoteRow = {...this._payload,user_id:user.id}; return {data:remoteRow,error:null}; }
  };
}
const fakeSupabase = {
  from(table){
    assert.strictEqual(table,'habitly_sync_documents','sync must use the dedicated table');
    const q = chainSelect();
    q.insert = payload => { q._payload=payload; q._mode='insert'; return q; };
    q.update = payload => { q._payload=payload; q._mode='update'; return q; };
    return q;
  }
};
sandbox.window.habitlySupabase = fakeSupabase;

(async()=>{
  // Local edit is queued and acknowledged into revision 2.
  state = sandbox.window.__habitlyTestHooks.getState();
  state.goals[0].title = 'Local edit';
  sandbox.window.__habitlyTestHooks.setState(state);
  sandbox.window.__habitlyTestHooks.save({skipDrive:true});
  assert(sandbox.window.__habitlyTestHooks.getState().syncMeta.mutations.length > 0,'local cloud edit must create a durable mutation');
  const ok = await sandbox.window.__habitlyTestHooks.flushCloudSync();
  assert.strictEqual(ok,true,'cloud mutation should be acknowledged');
  assert.strictEqual(remoteRow.revision,2,'successful optimistic write must increment server revision');
  assert.strictEqual(remoteRow.state.goals[0].title,'Local edit','acknowledged cloud state must contain local edit');
  assert.strictEqual(remoteRow.state.syncMeta.recordVersions.goals.g1.revision,2,'cloud commit must stamp the affected record with the server revision');
  assert.strictEqual(sandbox.window.__habitlyTestHooks.getState().syncMeta.mutations.length,0,'acknowledged mutations must leave the queue');

  // A stale device cannot overwrite revision 2.
  await assert.rejects(
    sandbox.window.__habitlyTestHooks.updateCloudDocument(1, sandbox.window.__habitlyTestHooks.getState()),
    e => e && e.code === 'CLOUD_CONFLICT',
    'stale expected revision must fail instead of overwriting a newer cloud state'
  );

  // Realtime/refresh-style remote edit to another entity can be merged with
  // a new local pending mutation without losing either side.
  remoteRow.revision = 3;
  remoteRow.state = sandbox.window.__habitlyTestHooks.cloudDocumentState({
    ...sandbox.window.__habitlyTestHooks.getState(),
    goals:[{id:'g1',title:'Local edit',target:100,current:10,date:'2026-12-31',status:'active',updatedAt:'2026-08-31T10:02:00Z'}],
    habits:[{id:'h1',name:'Remote habit',target:1,current:1,daily:{},updatedAt:'2026-08-31T10:03:00Z'}]
  });
  state = sandbox.window.__habitlyTestHooks.getState();
  state.settings.storage = {mode:'both',setupCompleted:true};
  state.habits.push({id:'h2',name:'New local habit',target:2,current:0,daily:{},updatedAt:'2026-08-31T10:04:00Z'});
  sandbox.window.__habitlyTestHooks.setState(state);
  sandbox.window.__habitlyTestHooks.resetSyncTracking();
  state = sandbox.window.__habitlyTestHooks.getState();
  state.habits.push({id:'h3',name:'Pending local habit',target:3,current:0,daily:{},updatedAt:'2026-08-31T10:05:00Z'});
  sandbox.window.__habitlyTestHooks.setState(state);
  sandbox.window.__habitlyTestHooks.save({skipDrive:true});
  const ok2 = await sandbox.window.__habitlyTestHooks.flushCloudSync();
  assert.strictEqual(ok2,true,'pending mutation should reconcile after a newer remote revision');
  assert(remoteRow.state.habits.some(h=>h.id==='h1'),'remote device change must survive reconciliation');
  assert(remoteRow.state.habits.some(h=>h.id==='h3'),'new local mutation must survive reconciliation');



  // Concurrent remote creation must survive while this device has a pending
  // mutation in the same collection family. This reproduces the old goal
  // creation cross-device loss: local dirty state must not hide remote IDs
  // that were created after the local baseline.
  remoteRow.revision = 4;
  remoteRow.state = sandbox.window.__habitlyTestHooks.cloudDocumentState({
    ...sandbox.window.__habitlyTestHooks.getState(),
    goals: [{id:'g1',title:'Local edit',target:100,current:10,date:'2026-12-31',status:'active',updatedAt:'2026-08-31T10:02:00Z'}]
  });
  state = sandbox.window.__habitlyTestHooks.getState();
  state.habits[0].name = 'Local habit edit';
  sandbox.window.__habitlyTestHooks.setState(state);
  sandbox.window.__habitlyTestHooks.resetSyncTracking();
  state = sandbox.window.__habitlyTestHooks.getState();
  state.habits[0].name = 'Local habit edit 2';
  sandbox.window.__habitlyTestHooks.setState(state);
  sandbox.window.__habitlyTestHooks.save({skipDrive:true});

  remoteRow.revision = 5;
  const remoteWithConcurrentGoal = sandbox.window.__habitlyTestHooks.cloudDocumentState({
    ...sandbox.window.__habitlyTestHooks.getState(),
    goals: [
      {id:'g1',title:'Local edit',target:100,current:10,date:'2026-12-31',status:'active',updatedAt:'2026-08-31T10:02:00Z'},
      {id:'g2',title:'Goal created on Device B',target:50,current:0,date:'2026-12-31',status:'active',updatedAt:'2026-08-31T10:06:00Z'}
    ]
  });
  remoteRow.state = remoteWithConcurrentGoal;
  const reconciled = sandbox.window.__habitlyTestHooks.mergeForDriveUpload(
    remoteRow.state,
    sandbox.window.__habitlyTestHooks.getState(),
    {habits:true,goals:false,events:false,reminders:false,profile:false,settings:false,activityHistory:false},
    sandbox.window.__habitlyTestHooks.getState()
  );
  assert(reconciled.goals.some(g=>g.id==='g2'),'concurrent remote goal creation must survive local dirty state');

  // Yes/No progress and pause are ordinary habit mutations and must retain
  // their latest record state rather than requiring a reload to become visible
  // after reconciliation.
  const yesNo = {id:'yn1',name:'Read',type:'yesno',target:1,unit:'completion',current:1,daily:{'2026-08-31':1},dailyUpdatedAt:{'2026-08-31':'2026-08-31T10:07:00Z'},paused:false,updatedAt:'2026-08-31T10:07:00Z'};
  const paused = {...yesNo,id:'p1',name:'Meditate',type:'quantity',target:10,current:3,daily:{'2026-08-31':3},dailyUpdatedAt:{'2026-08-31':'2026-08-31T10:07:00Z'},paused:true};
  const remoteHabitMerge = sandbox.window.__habitlyTestHooks.mergeForDriveUpload(
    {habits:[{...yesNo,current:0,daily:{'2026-08-31':0},dailyUpdatedAt:{'2026-08-31':'2026-08-31T10:06:00Z'}},{...paused,paused:false,updatedAt:'2026-08-31T10:06:00Z'}],goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}}}},
    {habits:[yesNo,paused],goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}}}},
    {habits:true,goals:false,events:false,reminders:false,profile:false,settings:false,activityHistory:false},
    {habits:[{...yesNo,current:0,daily:{'2026-08-31':0},updatedAt:'2026-08-31T10:05:00Z'},{...paused,paused:false,updatedAt:'2026-08-31T10:05:00Z'}],goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}}}}
  );
  assert.strictEqual(remoteHabitMerge.habits.find(h=>h.id==='yn1').current,1,'newer Yes/No progress must win');
  assert.strictEqual(remoteHabitMerge.habits.find(h=>h.id==='p1').paused,true,'newer pause state must win');

  // A remote hydration read must never overwrite a goal update that happened
  // while the network request was still in flight. This reproduces the UI
  // symptom where the toast says the goal was updated/completed but the card
  // immediately falls back to the old value until a reload.
  state = sandbox.window.__habitlyTestHooks.getState();
  state.goals = [{id:'race-goal',title:'Race Goal',target:100,current:0,date:'2026-12-31',status:'active',updatedAt:'2026-08-31T10:20:00Z'}];
  state.settings.storage = {mode:'both',setupCompleted:true};
  sandbox.window.__habitlyTestHooks.setState(state);
  sandbox.window.__habitlyTestHooks.resetSyncTracking();
  delayCloudRead = true;
  const hydrationPromise = sandbox.window.__habitlyTestHooks.reconcileCloudDocument();
  await new Promise(resolve => setTimeout(resolve, 0));
  state = sandbox.window.__habitlyTestHooks.getState();
  state.goals[0].current = 100;
  state.goals[0].status = 'completed';
  state.goals[0].updatedAt = '2026-08-31T10:21:00Z';
  sandbox.window.__habitlyTestHooks.setState(state);
  sandbox.window.__habitlyTestHooks.save({skipDrive:true});
  assert.strictEqual(sandbox.window.__habitlyTestHooks.getState().goals[0].current,100,'local goal update must remain visible immediately');
  releaseCloudRead();
  await hydrationPromise;
  delayCloudRead = false;
  assert.strictEqual(sandbox.window.__habitlyTestHooks.getState().goals[0].current,100,'stale hydration must not revert a newer goal update');
  assert.strictEqual(sandbox.window.__habitlyTestHooks.getState().goals[0].status,'completed','stale hydration must not revert goal completion');

  // Cross-device concurrent-writer regression: Device A has already committed
  // 70 at server revision 21. Device B still has an explicit pending 45 based
  // on revision 20. The server revision is used as CAS ordering, but B's
  // acknowledged user action must not be silently discarded. After a 412/CAS
  // conflict the pending mutation is rebased on revision 21 and committed as
  // revision 22. This prevents the old 'one device wins, other device silently
  // loses its edit' behaviour.
  const skewRemote = {
    habits:[{id:'clock-h1',name:'Skew test',target:100,current:70,daily:{'2026-08-31':70},dailyUpdatedAt:{'2026-08-31':'2026-08-31T19:00:00Z'},updatedAt:'2026-08-31T19:00:00Z'}],
    goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}},recordVersions:{habits:{'clock-h1':{revision:21,deviceId:'device-a',mutationId:'a1'}},goals:{},events:{},reminders:{}}}
  };
  const skewLocal = {
    habits:[{id:'clock-h1',name:'Skew test',target:100,current:45,daily:{'2026-08-31':45},dailyUpdatedAt:{'2026-08-31':'2026-08-31T23:00:00Z'},updatedAt:'2026-08-31T23:00:00Z'}],
    goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}},mutations:[{id:'skew-m1',kind:'habits',op:'upsert',record:{id:'clock-h1',name:'Skew test',target:100,current:45,daily:{'2026-08-31':45},dailyUpdatedAt:{'2026-08-31':'2026-08-31T23:00:00Z'},updatedAt:'2026-08-31T23:00:00Z'},at:'2026-08-31T23:00:00Z',baseRevision:20,deviceId:'device-b'}]}
  };
  const skewMerged = sandbox.window.__habitlyTestHooks.mergeForDriveUpload(skewRemote, skewLocal,
    {habits:true,goals:false,events:false,reminders:false,profile:false,settings:false,activityHistory:false}, skewRemote);
  assert.strictEqual(skewMerged.habits.find(h=>h.id==='clock-h1').current,45,'an explicit pending user edit must survive a remote revision conflict and be rebased on the latest server state');

  // Exercise the real flush path, not only the pure merge helper: the stale
  // writer must be removed from its local queue and must not perform a second
  // cloud write that changes the remote 70 back to 45.
  remoteRow.revision = 21;
  remoteRow.state = sandbox.window.__habitlyTestHooks.cloudDocumentState(skewRemote, 21, []);
  state = sandbox.window.__habitlyTestHooks.getState();
  state.settings.storage = {mode:'both',setupCompleted:true};
  state.habits = skewLocal.habits;
  state.syncMeta = {deleted:{habits:{},goals:{},events:{},reminders:{}},mutations:[{id:'flush-stale',kind:'habits',op:'upsert',record:skewLocal.habits[0],at:'2026-08-31T23:00:00Z',baseRevision:20,deviceId:'device-b'}],recordVersions:{habits:{},goals:{},events:{},reminders:{}}};
  sandbox.window.__habitlyTestHooks.setState(state);
  const staleFlush = await sandbox.window.__habitlyTestHooks.flushCloudSync();
  assert.strictEqual(staleFlush,true,'a CAS-conflicted mutation should be safely rebased and committed');
  assert.strictEqual(remoteRow.state.habits.find(h=>h.id==='clock-h1').current,45,'the pending user edit must be committed after rebasing on the newer cloud revision');
  assert.strictEqual(remoteRow.revision,22,'rebased mutation must create the next cloud revision');
  assert.strictEqual(sandbox.window.__habitlyTestHooks.getState().habits.find(h=>h.id==='clock-h1').current,45,'the committing device must retain its latest local value');
  assert.strictEqual(sandbox.window.__habitlyTestHooks.getState().syncMeta.mutations.length,0,'acknowledged rebased mutation must leave the queue');

  // A newer mutation from the same device may follow an earlier acknowledgement
  // without being mistaken for an external conflict.
  const sameDeviceRemote = {
    habits:[{id:'clock-h1',name:'Skew test',target:100,current:40,daily:{'2026-08-31':40},dailyUpdatedAt:{'2026-08-31':'2026-08-31T20:00:00Z'},updatedAt:'2026-08-31T20:00:00Z'}],
    goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}},recordVersions:{habits:{'clock-h1':{revision:21,deviceId:'device-b',mutationId:'b1'}},goals:{},events:{},reminders:{}}}
  };
  const sameDeviceLocal = {
    habits:[{id:'clock-h1',name:'Skew test',target:100,current:45,daily:{'2026-08-31':45},dailyUpdatedAt:{'2026-08-31':'2026-08-31T20:01:00Z'},updatedAt:'2026-08-31T20:01:00Z'}],
    goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}},mutations:[{id:'b2',kind:'habits',op:'upsert',record:{id:'clock-h1',name:'Skew test',target:100,current:45,daily:{'2026-08-31':45},dailyUpdatedAt:{'2026-08-31':'2026-08-31T20:01:00Z'},updatedAt:'2026-08-31T20:01:00Z'},at:'2026-08-31T20:01:00Z',baseRevision:20,deviceId:'device-b'}]}
  };
  const sameDeviceMerged = sandbox.window.__habitlyTestHooks.mergeForDriveUpload(sameDeviceRemote, sameDeviceLocal,
    {habits:true,goals:false,events:false,reminders:false,profile:false,settings:false,activityHistory:false}, sameDeviceRemote);
  assert.strictEqual(sameDeviceMerged.habits.find(h=>h.id==='clock-h1').current,45,'a newer pending edit from the same device must survive its earlier server acknowledgement');

  // Display/time storage regression: seconds are preserved internally and the
  // default presentation is 12-hour with seconds, with 24-hour formatting only
  // when the user explicitly selects it.
  state = sandbox.window.__habitlyTestHooks.getState();
  state.settings.timeFormat = '12h';
  sandbox.window.__habitlyTestHooks.setState(state);
  assert.strictEqual(sandbox.formatTime('19:05:09'),'7:05:09 PM','default time format must be 12-hour with seconds');
  assert.strictEqual(sandbox.formatTimeShort('19:05:09'),'7:05 PM','reminder lists should show hours and minutes only');
  state = sandbox.window.__habitlyTestHooks.getState();
  state.settings.timeFormat = '24h';
  sandbox.window.__habitlyTestHooks.setState(state);
  assert.strictEqual(sandbox.formatTime('19:05:09'),'19:05:09','24-hour format must be opt-in and include seconds');
  assert.strictEqual(sandbox.parseTime24('7:05:09 PM'),'19:05:09','12-hour input must normalize to a seconds-aware 24-hour value');

  console.log('PASS: Habitly Supabase optimistic-concurrency integration tests');
})().catch(err=>{ console.error(err); process.exitCode=1; });
