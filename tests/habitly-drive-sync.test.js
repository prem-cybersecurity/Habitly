const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const appSource = fs.readFileSync('app.js', 'utf8');
function makeSandbox(remote) {
  const element = () => ({ innerHTML:'', classList:{add(){},remove(){},toggle(){},contains(){return false;}}, setAttribute(){}, addEventListener(){}, querySelector(){return null;}, querySelectorAll(){return [];} });
  const elements = new Map();
  const documentStub = { getElementById(id){ if(!elements.has(id)) elements.set(id,element()); return elements.get(id); }, querySelector(){return null;}, querySelectorAll(){return[];}, addEventListener(){}, body:{classList:{add(){},remove(){},toggle(){}}}, visibilityState:'visible' };
  const windowStub = { habitlySupabase:null, addEventListener(){}, removeEventListener(){}, matchMedia(){return {matches:false};}, navigator:{standalone:false,onLine:true}, parent:null, location:{hash:'#/login',origin:'http://localhost'} };
  windowStub.window = windowStub; windowStub.parent = windowStub;
  const storage = new Map();
  const localStorageStub = { getItem(k){return storage.has(k)?storage.get(k):null;}, setItem(k,v){storage.set(k,String(v));}, removeItem(k){storage.delete(k);} };
  let patchStarted = false;
  let forceFirstConflict = false;
  let firstConflictDone = false;
  const fetchStub = async (url, options={}) => {
    const method = options.method || 'GET';
    if (url.includes('/files/folder-1?fields=id,name,mimeType,trashed')) return response({id:'folder-1',name:'Habitly Backups',mimeType:'application/vnd.google-apps.folder',trashed:false});
    if (url.includes('/files/file-1?fields=id,name,modifiedTime,parents,trashed')) return response({id:'file-1',name:'Habitly_Backup.json',modifiedTime:remote.modifiedTime,parents:['folder-1'],trashed:false}, {'ETag':remote.etag});
    if (url.includes('/files/file-1?alt=media')) return response(remote.body);
    if (url.includes('/upload/drive/v3/files/file-1?uploadType=media')) {
      patchStarted = true;
      if (forceFirstConflict && !firstConflictDone) {
        firstConflictDone = true;
        remote.body = JSON.parse(JSON.stringify(remote.body));
        remote.body.data.habits[0].daily[TODAY] = 45;
        remote.body.data.habits[0].current = 45;
        remote.etag = '"v2"';
        return response({}, {}, 412);
      }
      const ifMatch = new HeadersStub(options.headers).get('If-Match');
      if (ifMatch !== remote.etag) return response({}, {}, 412);
      const body = JSON.parse(options.body);
      remote.body = body;
      remote.modifiedTime = new Date(Date.now()+1000).toISOString();
      remote.etag = '"v' + (Number(remote.etag.replace(/\D/g,'')) + 1) + '"';
      return response({id:'file-1',modifiedTime:remote.modifiedTime}, {'ETag':remote.etag});
    }
    throw new Error(`Unexpected Drive request: ${method} ${url}`);
  };
  class HeadersStub { constructor(init={}) { this.map={}; if(init instanceof HeadersStub) this.map={...init.map}; else for(const [k,v] of Object.entries(init||{})) this.set(k,v); } set(k,v){this.map[String(k).toLowerCase()]=String(v);} get(k){return this.map[String(k).toLowerCase()]||'';} }
  function response(body, headers={}, status=200){ return {ok:status>=200&&status<300,status,headers:new HeadersStub(headers),async json(){return body;},async text(){return typeof body==='string'?body:JSON.stringify(body);} }; }
  const sandbox={window:windowStub,localStorage:localStorageStub,document:documentStub,navigator:windowStub.navigator,location:windowStub.location,console,setTimeout,clearTimeout,setInterval:()=>0,clearInterval,queueMicrotask,Date,Math,JSON,Number,String,Object,Array,Map,Set,Promise,URL,Blob:class Blob{},Headers:HeadersStub,Notification:undefined,google:undefined,fetch:fetchStub};
  vm.createContext(sandbox); vm.runInContext(appSource,sandbox,{filename:'app.js'});
  sandbox.window.__habitlyTestHooks.setAuthUser({id:'drive-user',email:'drive@example.com',user_metadata:{}});
  sandbox.window.__habitlyTestHooks.setGoogleAccessToken('token');
  return {sandbox,get patchStarted(){return patchStarted;}, enableFirstConflict(){forceFirstConflict=true;}};
}

const TODAY = new Date().toISOString().slice(0,10);
const NOW = new Date().toISOString();
const baseState = {
  habits:[{id:'h1',name:'Read',target:100,current:0,daily:{[TODAY]:0},dailyUpdatedAt:{[TODAY]:NOW},updatedAt:NOW}],
  goals:[],events:[],reminders:[],profile:{name:'User',email:'drive@example.com',avatar:''},activityHistory:{},
  settings:{storage:{mode:'drive',setupCompleted:true},drive:{connected:true,folderId:'folder-1',fileId:'file-1',remoteEverSynced:true,autoDaily:true,syncRevision:1},timeFormat:'12h'}
};
const remote = {etag:'"v1"',modifiedTime:'2026-08-31T10:00:00.000Z',body:{backupVersion:4,app:'Habitly',accountId:'drive-user',updatedAt:'2026-08-31T10:00:00.000Z',syncRevision:1,syncDeviceId:'device-a',data:baseState}};
const ctx=makeSandbox(remote);
ctx.sandbox.window.__habitlyTestHooks.setState({...baseState});
ctx.sandbox.window.__habitlyTestHooks.resetSyncTracking();
let state=ctx.sandbox.window.__habitlyTestHooks.getState();
state.habits[0].daily[TODAY]=70;
state.habits[0].current=70;
ctx.sandbox.window.__habitlyTestHooks.setState(state);
ctx.sandbox.window.__habitlyTestHooks.save({skipDrive:true});
assert(ctx.sandbox.window.__habitlyTestHooks.getState().syncMeta.mutations.length>=1,'Drive mode edits must enter the durable mutation queue');

(async()=>{
  ctx.enableFirstConflict();
  const ok=await ctx.sandbox.window.__habitlyTestHooks.uploadDriveBackup({silent:true});
  assert.strictEqual(ok,true,'Drive upload must acknowledge a habit value update');
  assert.strictEqual(remote.body.data.habits[0].current,70,'Drive must contain the updated habit value after a concurrent-write retry');
  assert.strictEqual(ctx.sandbox.window.__habitlyTestHooks.getState().syncMeta.mutations.length,0,'acknowledged Drive mutation must leave the queue');
  assert.strictEqual(remote.body.syncRevision,2,'Drive backup revision must advance atomically');
  assert.strictEqual(remote.body.data.settings.drive.syncRevision,2,'stored state must carry the Drive revision');
  assert(ctx.patchStarted,'real Drive upload path must execute');
  console.log('PASS: Habitly Google Drive sync integration tests');
})().catch(e=>{console.error(e);process.exit(1);});
