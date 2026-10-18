import test from 'node:test';import assert from 'node:assert/strict';
import {parseOptions,expandArenaEnable,credentialMode,validateUserAdc,validateResult,selectedState,createRestClient,updateStoryFlags,encodeUpdates,decodeFields,main} from './admin/story-flags.mjs';
const base=['--uid','throwaway_01','--confirm','throwaway_01','--project','demo-admin-story'];
test('KNOWN-BAD missing confirmation and unknown/malformed options refuse before credentials',()=>{
 for(const args of [[],['--uid','x'],[...base,'--pilot-rank','-1'],[...base,'--pilot-rank','1.5'],[...base,'--pilot-rank','9007199254740992'],[...base,'--arena-arc-built','1'],[...base,'--all','true'],[...base,'--uid','different'],[...base,'--pilot-rank']])assert.throws(()=>parseOptions(args));
 assert.throws(()=>parseOptions(['--uid','a/b','--confirm','a/b','--project','demo-story','--pilot-rank','0']));
});
test('only explicit selected fields are parsed, including false and rank zero',()=>{assert.deepEqual(parseOptions([...base,'--holo-zones-arc-built','false','--pilot-rank','0']).updates,{'storyFlags.holoZonesArcBuilt':false,pilotRank:0});});
test('service account/env impersonation credentials cannot fall through to ADC',()=>{
 assert.throws(()=>credentialMode({GOOGLE_APPLICATION_CREDENTIALS:'/fake/service-key.json'},'demo-story'));
 for(const raw of [{type:'service_account',private_key:'fake'},{type:'external_account'},{type:'authorized_user',client_id:'x',client_secret:'x',refresh_token:'x',service_account_impersonation_url:'fake'}])assert.throws(()=>validateUserAdc(raw));
 assert.deepEqual(validateUserAdc({type:'authorized_user',client_id:'fake-id',client_secret:'fake-secret',refresh_token:'fake-token'}),{clientId:'fake-id',clientSecret:'fake-secret',refreshToken:'fake-token'});
});
test('emulator guard only allows loopback demo project; real route requires user ADC',()=>{
 assert.equal(credentialMode({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8193'},'demo-story'),'emulator');
 assert.throws(()=>credentialMode({FIRESTORE_EMULATOR_HOST:'remote:8193'},'demo-story'));
 assert.throws(()=>credentialMode({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8193'},'real-project'));
 assert.throws(()=>credentialMode({},'demo-story'));assert.equal(credentialMode({},'real-project'),'user-adc');
});
test('final Arena invariant remains enforced, including disabling completed accounts',()=>{
 assert.throws(()=>validateResult({storyFlags:{tournamentsWon:0}}, {'storyFlags.arenaArcBuilt':true}),/tournamentsWon/);
 assert.throws(()=>validateResult({storyFlags:{tournamentsWon:3,arenaArcBuilt:true}}, {'storyFlags.arenaArcBuilt':false}),/tournamentsWon/);
 assert.doesNotThrow(()=>validateResult({storyFlags:{tournamentsWon:3,arenaArcBuilt:true}}, {'storyFlags.arenaArcBuilt':true}));
});
test('malformed existing records refuse; reporting excludes all other profile fields',()=>{
 for(const data of [{storyFlags:[]},{storyFlags:{arenaGatheringSeen:'true'}},{pilotRank:-1},{storyFlags:{tournamentsWon:4}},{storyFlags:{holoZonesArcBuilt:null}}])assert.throws(()=>validateResult(data,{pilotRank:1}));
 assert.deepEqual(selectedState({email:'not-output',private:'not-output',pilotRank:2}),{storyFlags:null,pilotRank:2});
});

test('explicit Arena enable expands to the three approved fields, false and omission do not',()=>{
 const options=parseOptions([...base,'--arena-arc-built','true','--pilot-rank','9']);
 assert.deepEqual(expandArenaEnable(options.updates),{'storyFlags.arenaArcBuilt':true,pilotRank:9,'storyFlags.tournamentsWon':3,'storyFlags.arenaGatheringSeen':true});
 assert.doesNotThrow(()=>validateResult({storyFlags:{tournamentsWon:0}},expandArenaEnable(options.updates)));
 assert.deepEqual(expandArenaEnable({'storyFlags.arenaArcBuilt':false}),{'storyFlags.arenaArcBuilt':false});
 assert.deepEqual(expandArenaEnable({pilotRank:0}),{pilotRank:0});
});

// ---- REST transport (fake fetch; no network, no real credentials) ----
const ADC={type:'authorized_user',client_id:'fake-id',client_secret:'fake-secret',refresh_token:'fake-token'};
const REAL='holobots-synthetic';const UT1='2026-10-18T01:02:03.000004Z',UT2='2026-10-18T01:02:04.000005Z';
const enc=v=>typeof v==='boolean'?{booleanValue:v}:Number.isInteger(v)?{integerValue:String(v)}:typeof v==='string'?{stringValue:v}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,enc(x)]))}};
const docJson=(data,updateTime)=>({name:'x',fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,enc(v)])),createTime:UT1,updateTime});
/** Minimal Firestore REST double: one document; documents:commit honours updateMask + currentDocument.updateTime; records every call. */
function fakeFirestore({doc,onBeforePatch}={}){
 const state={doc:doc?structuredClone(doc):null,updateTime:UT1,calls:[]};
 const fetch=async(url,init)=>{
  const u=new URL(url);state.calls.push({method:init.method,url:u,headers:init.headers,body:init.body?JSON.parse(init.body):undefined});
  const reply=(status,json)=>({status,ok:status>=200&&status<300,text:async()=>JSON.stringify(json)});
  if(init.method==='POST'&&u.pathname.endsWith('/documents:commit')){
   if(onBeforePatch)onBeforePatch(state);
   const [write,...extra]=JSON.parse(init.body).writes;if(extra.length)return reply(400,{error:{status:'INVALID_ARGUMENT'}});
   const pre=write.currentDocument?.updateTime;if(pre!==undefined&&(!state.doc||pre!==state.updateTime))return reply(400,{error:{code:400,status:'FAILED_PRECONDITION',message:'the stored version does not match the required base version'}});
   state.doc??={};const fields=decodeFields(write.update.fields);
   for(const path of write.updateMask.fieldPaths){const [a,b]=path.split('.');if(b)state.doc[a]={...state.doc[a],[b]:fields[a][b]};else state.doc[a]=fields[a];}
   state.updateTime=UT2;return reply(200,{writeResults:[{updateTime:UT2}],commitTime:UT2});
  }
  if(!state.doc)return reply(404,{error:{code:404,status:'NOT_FOUND',message:'Document not found'}});
  if(init.method==='GET')return reply(200,docJson({storyFlags:state.doc.storyFlags,pilotRank:state.doc.pilotRank},state.updateTime));
  return reply(405,{});
 };
 return {state,fetch};
}
async function realClient(fake){const client=await createRestClient({project:REAL,env:{},rawAdc:ADC,fetchImpl:fake.fetch});client.authClient.getAccessToken=async()=>({token:'FAKE_ACCESS_TOKEN'});return client;}
const seed={storyFlags:{arenaGatheringSeen:true,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false,extraFlag:'untouched'},pilotRank:2,email:'not-output@example.invalid'};

test('REGRESSION: the user ADC bearer token is on every request that reaches the wire (library transport dropped it)',async()=>{
 const fake=fakeFirestore({doc:seed});const client=await realClient(fake);
 assert.equal(client.authClient.constructor.name,'UserRefreshClient');assert.equal(client.authClient.credentials.refresh_token,'fake-token');
 await updateStoryFlags(client,{uid:'throwaway_01',project:REAL,updates:{'storyFlags.holoZonesArcBuilt':true}});
 assert.deepEqual(fake.state.calls.map(c=>c.method),['GET','POST','GET']);
 for(const c of fake.state.calls){assert.equal(c.headers.authorization,'Bearer FAKE_ACCESS_TOKEN');assert.equal(c.url.origin,'https://firestore.googleapis.com');}
 for(const c of [fake.state.calls[0],fake.state.calls[2]]){
  assert.equal(decodeURIComponent(c.url.pathname),`/v1/projects/${REAL}/databases/(default)/documents/users/throwaway_01`);
  assert.deepEqual(c.url.searchParams.getAll('mask.fieldPaths'),['storyFlags','pilotRank']);
 }
 assert.equal(decodeURIComponent(fake.state.calls[1].url.pathname),`/v1/projects/${REAL}/databases/(default)/documents:commit`);
});
test('the commit masks exactly the selected fields, is pinned to the read updateTime, and before/after report only storyFlags/pilotRank',async()=>{
 const fake=fakeFirestore({doc:seed});const client=await realClient(fake);
 const result=await updateStoryFlags(client,{uid:'throwaway_01',project:REAL,updates:{'storyFlags.holoZonesArcBuilt':true,pilotRank:9}});
 assert.deepEqual(fake.state.calls[1].body,{writes:[{
  update:{name:`projects/${REAL}/databases/(default)/documents/users/throwaway_01`,fields:{storyFlags:{mapValue:{fields:{holoZonesArcBuilt:{booleanValue:true}}}},pilotRank:{integerValue:'9'}}},
  updateMask:{fieldPaths:['storyFlags.holoZonesArcBuilt','pilotRank']},currentDocument:{updateTime:UT1}}]});
 assert.deepEqual(result,{uid:'throwaway_01',project:REAL,before:{storyFlags:seed.storyFlags,pilotRank:2},after:{storyFlags:{...seed.storyFlags,holoZonesArcBuilt:true},pilotRank:9},changedFields:['storyFlags.holoZonesArcBuilt','pilotRank']});
 assert.equal(JSON.stringify(result).includes('not-output'),false);
 assert.equal(fake.state.doc.email,seed.email);assert.equal(fake.state.doc.storyFlags.extraFlag,'untouched');
});
test('Arena enable sends all three approved story fields in one write',async()=>{
 const fake=fakeFirestore({doc:seed});const client=await realClient(fake);
 await updateStoryFlags(client,{uid:'throwaway_01',project:REAL,updates:{'storyFlags.arenaArcBuilt':true}});
 assert.deepEqual(new Set(fake.state.calls[1].body.writes[0].updateMask.fieldPaths),new Set(['storyFlags.arenaArcBuilt','storyFlags.tournamentsWon','storyFlags.arenaGatheringSeen']));
 assert.deepEqual(fake.state.doc.storyFlags,{...seed.storyFlags,arenaArcBuilt:true,tournamentsWon:3,arenaGatheringSeen:true});
});
test('KNOWN-BAD unknown UID (404) refuses before any write; no upsert',async()=>{
 const fake=fakeFirestore({doc:null});const client=await realClient(fake);
 await assert.rejects(()=>updateStoryFlags(client,{uid:'missing_01',project:REAL,updates:{pilotRank:0}}),/Unknown UID; refusing upsert/);
 assert.deepEqual(fake.state.calls.map(c=>c.method),['GET']);assert.equal(fake.state.doc,null);
});
test('KNOWN-BAD a concurrent host write between read and commit makes it refuse and write nothing',async()=>{
 const fake=fakeFirestore({doc:seed,onBeforePatch:s=>{s.doc={...s.doc,pilotRank:5};s.updateTime='2026-10-18T09:09:09.000009Z';}});const client=await realClient(fake);
 await assert.rejects(()=>updateStoryFlags(client,{uid:'throwaway_01',project:REAL,updates:{pilotRank:9,'storyFlags.holoZonesArcBuilt':true}}),/concurrent write/);
 assert.equal(fake.state.doc.pilotRank,5);assert.equal(fake.state.doc.storyFlags.holoZonesArcBuilt,false);
 assert.deepEqual(fake.state.calls.map(c=>c.method),['GET','POST']);
});
test('KNOWN-BAD a delete between read and commit is not recreated (precondition implies exists)',async()=>{
 const fake=fakeFirestore({doc:seed,onBeforePatch:s=>{s.doc=null;}});const client=await realClient(fake);
 await assert.rejects(()=>updateStoryFlags(client,{uid:'throwaway_01',project:REAL,updates:{pilotRank:9}}),/concurrent write/);assert.equal(fake.state.doc,null);
});
test('KNOWN-BAD invalid/unapproved fields, malformed stored records and project mismatch refuse before any request',async()=>{
 for(const [updates,re] of [[{holosTokens:1},/Unapproved/],[{'storyFlags.tournamentsWon':1},/Unapproved/],[{'storyFlags.arenaArcBuilt':'invalid'},/exactly/]]){
  const fake=fakeFirestore({doc:seed});await assert.rejects(async()=>updateStoryFlags(await realClient(fake),{uid:'throwaway_01',project:REAL,updates}),re);assert.equal(fake.state.calls.length,0);
 }
 const fake=fakeFirestore({doc:seed});await assert.rejects(async()=>updateStoryFlags(await realClient(fake),{uid:'throwaway_01',project:'other-project',updates:{pilotRank:1}}),/does not match/);assert.equal(fake.state.calls.length,0);
 const bad=fakeFirestore({doc:{storyFlags:{tournamentsWon:4},pilotRank:1}});
 await assert.rejects(async()=>updateStoryFlags(await realClient(bad),{uid:'throwaway_01',project:REAL,updates:{pilotRank:2}}),/Malformed/);
 assert.deepEqual(bad.state.calls.map(c=>c.method),['GET']);
});
test('non-precondition HTTP errors surface status without leaking the token',async()=>{
 const fetch=async()=>({status:403,ok:false,text:async()=>JSON.stringify({error:{code:403,status:'PERMISSION_DENIED',message:'Missing or insufficient permissions.'}})});
 const client=await createRestClient({project:REAL,env:{},rawAdc:ADC,fetchImpl:fetch});client.authClient.getAccessToken=async()=>({token:'FAKE_ACCESS_TOKEN'});
 await assert.rejects(()=>updateStoryFlags(client,{uid:'throwaway_01',project:REAL,updates:{pilotRank:1}}),e=>/HTTP 403 PERMISSION_DENIED/.test(e.message)&&!e.message.includes('FAKE_ACCESS_TOKEN'));
});
test('client construction refuses service accounts, env key files and emulator misuse; emulator uses loopback http + Bearer owner',async()=>{
 const never=async()=>{throw Error('no request expected');};
 await assert.rejects(()=>createRestClient({project:REAL,env:{},rawAdc:{type:'service_account',private_key:'fake'},fetchImpl:never}),/authorized_user/);
 await assert.rejects(()=>createRestClient({project:REAL,env:{},rawAdc:undefined,fetchImpl:never}),/authorized_user/);
 await assert.rejects(()=>createRestClient({project:REAL,env:{GOOGLE_APPLICATION_CREDENTIALS:'/fake/key.json'},rawAdc:ADC,fetchImpl:never}),/GOOGLE_APPLICATION_CREDENTIALS/);
 await assert.rejects(()=>createRestClient({project:REAL,env:{CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT:'sa@x'},rawAdc:ADC,fetchImpl:never}),/IMPERSONATE/);
 await assert.rejects(()=>createRestClient({project:'demo-story',env:{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'},rawAdc:ADC,fetchImpl:never}),/must not load user credentials/);
 const fake=fakeFirestore({doc:seed});const emu=await createRestClient({project:'demo-story',env:{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8193'},fetchImpl:fake.fetch});
 await updateStoryFlags(emu,{uid:'throwaway_01',project:'demo-story',updates:{pilotRank:3}});
 assert.equal(fake.state.calls[0].url.origin,'http://127.0.0.1:8193');assert.equal(fake.state.calls[0].headers.authorization,'Bearer owner');
});
test('CLI main refuses missing confirmation and env credentials before reading ADC or calling fetch',async()=>{
 const never=async()=>{throw Error('no request expected');};
 await assert.rejects(()=>main(['--uid','u1','--project',REAL,'--pilot-rank','1'],{},never),/--confirm/);
 await assert.rejects(()=>main(['--uid','u1','--confirm','u1','--project',REAL,'--pilot-rank','1'],{GOOGLE_APPLICATION_CREDENTIALS:'/fake'},never),/GOOGLE_APPLICATION_CREDENTIALS/);
});
test('encodeUpdates refuses anything outside boolean/safe-integer two-segment paths',()=>{
 assert.throws(()=>encodeUpdates({'a.b.c':true}));assert.throws(()=>encodeUpdates({'storyFlags.`x`':true}));assert.throws(()=>encodeUpdates({pilotRank:1.5}));assert.throws(()=>encodeUpdates({pilotRank:'1'}));
});
