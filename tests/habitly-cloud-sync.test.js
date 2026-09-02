const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync('app.js', 'utf8');
const element = () => ({ innerHTML:'', classList:{add(){},remove(){},toggle(){},contains(){return false;}}, setAttribute(){}, addEventListener(){}, querySelector(){return null;}, querySelectorAll(){return [];} });
const elements = new Map();
const documentStub = { getElementById(id){ if(!elements.has(id)) elements.set(id,element()); return elements.get(id); }, querySelector(){return null;}, querySelectorAll(){return[];}, addEventListener(){}, body:{classList:{add(){},remove(){},toggle(){}}}, visibilityState:'visible' };
const windowStub = { habitlySupabase:null, addEventListener(){}, removeEventListener(){}, matchMedia(){return {matches:false};}, navigator:{standalone:false,onLine:true}, parent:null, location:{hash:'#/login',origin:'http://localhost'} };
windowStub.window=windowStub; windowStub.parent=windowStub;
const storage = new Map();
const localStorageStub={getItem(k){return storage.has(k)?storage.get(k):null;},setItem(k,v){storage.set(k,String(v));},removeItem(k){storage.delete(k);}};
const sessionStorageStub={getItem(){return null;},setItem(){}};
const sandbox={window:windowStub,localStorage:localStorageStub,sessionStorage:sessionStorageStub,document:documentStub,navigator:windowStub.navigator,location:windowStub.location,console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval,queueMicrotask,Date,Math,JSON,Number,String,Object,Array,Map,Set,Promise,URL,Blob:class Blob{},Headers:class Headers{constructor(){} set(){} get(){return ''}},Notification:undefined,google:undefined,fetch:async()=>({ok:false,status:503})};
vm.createContext(sandbox); vm.runInContext(appSource,sandbox,{filename:'app.js'});

const user={id:'cloud-user',email:'cloud@example.com',user_metadata:{}};
sandbox.window.__habitlyTestHooks.setAuthUser(user);
let state=sandbox.freshUserState(user);
state.settings.storage={mode:'cloud',setupCompleted:true};
state.habits=[{id:'h1',name:'Reading',target:100,current:10,daily:{'2026-09-01':10},dailyUpdatedAt:{'2026-09-01':'2026-09-01T10:00:00Z'},paused:false,updatedAt:'2026-09-01T10:00:00Z'}];
state.goals=[{id:'g1',title:'Baseline Goal',target:100,current:10,date:'2026-12-31',status:'active',updatedAt:'2026-09-01T10:00:00Z'}];
sandbox.window.__habitlyTestHooks.setState(state);
sandbox.window.__habitlyTestHooks.resetSyncTracking();

let remoteRow=null;
const fakeSupabase={
  from(table){
    assert.strictEqual(table,'habitly_sync_documents_v2','cloud sync must use the fresh v2 table');
    const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:remoteRow,error:null};}};
    return q;
  },
  async rpc(name,args){
    assert.strictEqual(name,'commit_habitly_sync_v2','cloud writes must use the atomic CAS RPC');
    const expected=Number(args.p_expected_revision)||0;
    const actual=remoteRow ? Number(remoteRow.revision) : 0;
    if(expected!==actual){ return {data:null,error:{message:`HABITLY_CONFLICT: expected revision ${expected}, actual revision ${actual}`}}; }
    const next={user_id:user.id,revision:actual+1,state:args.p_state,updated_at:new Date().toISOString(),updated_by:args.p_device_id};
    remoteRow=next;
    return {data:next,error:null};
  },
  auth:{async updateUser(){return {data:{user},error:null};}}
};
sandbox.window.habitlySupabase=fakeSupabase;

(async()=>{
  // First device establishes a fresh cloud document.
  await sandbox.window.__habitlyTestHooks.reconcileCloudDocument();
  assert(remoteRow,'first authenticated device must create the cloud baseline');
  assert.strictEqual(remoteRow.revision,1,'initial cloud state must start at revision 1');

  // Local goal edit becomes a durable mutation and commits atomically.
  state=sandbox.window.__habitlyTestHooks.getState();
  state.goals[0].title='Updated Goal';
  sandbox.window.__habitlyTestHooks.setState(state);
  sandbox.window.__habitlyTestHooks.save({skipDrive:true});
  assert(sandbox.window.__habitlyTestHooks.getState().syncMeta.mutations.length>0,'goal edit must create a durable mutation');
  assert.strictEqual(await sandbox.window.__habitlyTestHooks.flushCloudSync(),true,'cloud mutation must be acknowledged');
  assert.strictEqual(remoteRow.revision,2,'successful cloud commit must increment revision');
  assert.strictEqual(remoteRow.state.goals[0].title,'Updated Goal','cloud state must contain goal edit');
  assert.strictEqual(sandbox.window.__habitlyTestHooks.getState().syncMeta.mutations.length,0,'acknowledged mutation must leave queue');

  // Simulate another device committing a newer goal plus a new habit.
  remoteRow={...remoteRow,revision:3,state:sandbox.window.__habitlyTestHooks.cloudDocumentState({
    ...sandbox.window.__habitlyTestHooks.getState(),
    goals:[{...sandbox.window.__habitlyTestHooks.getState().goals[0],current:50,updatedAt:'2026-09-01T10:03:00Z'}],
    habits:[...sandbox.window.__habitlyTestHooks.getState().habits,{id:'h2',name:'Remote Habit',target:10,current:4,daily:{'2026-09-01':4},dailyUpdatedAt:{'2026-09-01':'2026-09-01T10:03:00Z'},updatedAt:'2026-09-01T10:03:00Z'}]
  },3,[{id:'remote-goal',kind:'goals',op:'upsert',record:{id:'g1'},deviceId:'device-b'}])};
  // Local device makes a different habit edit while remote revision is newer.
  state=sandbox.window.__habitlyTestHooks.getState();
  state.habits[0].daily['2026-09-01']=20; state.habits[0].current=20;
  sandbox.window.__habitlyTestHooks.setState(state); sandbox.window.__habitlyTestHooks.save({skipDrive:true});
  assert.strictEqual(await sandbox.window.__habitlyTestHooks.flushCloudSync(),true,'stale local mutation must rebase and commit after remote revision advances');
  assert(remoteRow.state.habits.some(h=>h.id==='h2'),'remote concurrent creation must survive local habit edit');
  assert.strictEqual(remoteRow.state.habits.find(h=>h.id==='h1').daily['2026-09-01'],20,'local habit progress must survive the rebase');

  // Two devices updating different records must preserve both changes.
  remoteRow={...remoteRow,revision:remoteRow.revision+1,state:sandbox.window.__habitlyTestHooks.cloudDocumentState({
    ...sandbox.window.__habitlyTestHooks.getState(),
    goals:[...sandbox.window.__habitlyTestHooks.getState().goals,{id:'g2',title:'Remote Goal',target:50,current:5,date:'2026-12-31',status:'active',updatedAt:'2026-09-01T10:06:00Z'}]
  },remoteRow.revision+1,[])};
  state=sandbox.window.__habitlyTestHooks.getState();
  state.habits.find(h=>h.id==='h1').target=120;
  sandbox.window.__habitlyTestHooks.setState(state); sandbox.window.__habitlyTestHooks.save({skipDrive:true});
  assert.strictEqual(await sandbox.window.__habitlyTestHooks.flushCloudSync(),true,'different-entity local edit must commit');
  assert(remoteRow.state.goals.some(g=>g.id==='g2'),'remote goal must survive unrelated local habit edit');
  assert.strictEqual(remoteRow.state.habits.find(h=>h.id==='h1').target,120,'local habit edit must commit');

  // Habit history is merged by day, so two devices updating different dates
  // cannot erase one another's progress.
  const dayMerge = sandbox.window.__habitlyTestHooks.mergeForDriveUpload(
    {habits:[{id:'h-day',name:'Reading',target:10,current:2,daily:{'2026-09-01':2,'2026-09-02':0},dailyUpdatedAt:{'2026-09-01':'2026-09-01T08:00:00Z','2026-09-02':'2026-09-02T08:00:00Z'},updatedAt:'2026-09-02T08:00:00Z'}],goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}}}},
    {habits:[{id:'h-day',name:'Reading',target:10,current:3,daily:{'2026-09-01':2,'2026-09-02':3},dailyUpdatedAt:{'2026-09-01':'2026-09-01T08:00:00Z','2026-09-02':'2026-09-02T09:00:00Z'},updatedAt:'2026-09-02T09:00:00Z'}],goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}}}},
    {habits:true,goals:false,events:false,reminders:false,profile:false,settings:false,activityHistory:false},
    {habits:[{id:'h-day',name:'Reading',target:10,current:2,daily:{'2026-09-01':2,'2026-09-02':0},dailyUpdatedAt:{'2026-09-01':'2026-09-01T08:00:00Z','2026-09-02':'2026-09-02T08:00:00Z'},updatedAt:'2026-09-02T08:00:00Z'}],goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}}}}
  );
  assert.strictEqual(dayMerge.habits[0].daily['2026-09-01'],2,'existing day history must survive a later update');
  assert.strictEqual(dayMerge.habits[0].daily['2026-09-02'],3,'new day progress must survive merge');

  // Yes/No and pause are synchronized as ordinary habit record mutations.
  const yesNo = {id:'yn',name:'Read',type:'yesno',target:1,current:1,daily:{'2026-09-02':1},dailyUpdatedAt:{'2026-09-02':'2026-09-02T10:00:00Z'},paused:false,updatedAt:'2026-09-02T10:00:00Z'};
  const yesNoRemote = sandbox.window.__habitlyTestHooks.mergeForDriveUpload(
    {habits:[{...yesNo,current:0,daily:{'2026-09-02':0},dailyUpdatedAt:{'2026-09-02':'2026-09-02T09:00:00Z'}}],goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}}}},
    {habits:[yesNo],goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}}}},
    {habits:true,goals:false,events:false,reminders:false,profile:false,settings:false,activityHistory:false},
    {habits:[{...yesNo,current:0,daily:{'2026-09-02':0},dailyUpdatedAt:{'2026-09-02':'2026-09-02T09:00:00Z'}}],goals:[],events:[],reminders:[],syncMeta:{deleted:{habits:{},goals:{},events:{},reminders:{}}}}
  );
  assert.strictEqual(yesNoRemote.habits[0].current,1,'Yes/No completion must sync without a reload');

  console.log('PASS: Habitly Supabase cloud-sync integration tests');
})().catch(e=>{console.error(e);process.exit(1);});