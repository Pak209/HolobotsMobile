#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const fail=message=>{throw Error(message);};
export function parseOptions(args){
 const allowed=new Set(['--uid','--confirm','--project','--arena-arc-built','--holo-zones-arc-built','--pilot-rank']);const opts={};
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!allowed.has(key)||Object.hasOwn(opts,key)||value===undefined||value.startsWith('--'))fail('Unknown, duplicate or missing option value');opts[key]=value;}
 const uid=opts['--uid'];if(!uid||! /^[A-Za-z0-9:_-]{1,128}$/.test(uid))fail('Explicit valid --uid required');
 if(opts['--confirm']!==uid)fail('--confirm must repeat the exact UID');
 if(!/^[a-z][a-z0-9-]{4,62}$/.test(opts['--project']??''))fail('Explicit valid --project required');
 const updates={};for(const [option,path] of [['--arena-arc-built','storyFlags.arenaArcBuilt'],['--holo-zones-arc-built','storyFlags.holoZonesArcBuilt']]){if(opts[option]!==undefined){if(!['true','false'].includes(opts[option]))fail('Flags must be exactly true or false');updates[path]=opts[option]==='true';}}
 if(opts['--pilot-rank']!==undefined){const raw=opts['--pilot-rank'];if(!/^(0|[1-9][0-9]*)$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail('pilotRank must be a nonnegative safe integer');updates.pilotRank=Number(raw);}
 if(!Object.keys(updates).length)fail('Select at least one field');return {uid,project:opts['--project'],updates};
}
/** Pak-approved local QA completion: all three story fields share one transaction. */
export function expandArenaEnable(updates){
 return updates['storyFlags.arenaArcBuilt']===true
  ? {...updates,'storyFlags.tournamentsWon':3,'storyFlags.arenaGatheringSeen':true}
  : {...updates};
}
export function credentialMode(env,project){
 for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_GHA_CREDS_PATH','GCE_METADATA_HOST','GCE_METADATA_IP','FIREBASE_TOKEN','GOOGLE_IMPERSONATE_SERVICE_ACCOUNT','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT'])if(env[key])fail(`Unset ${key}; only local user ADC is permitted`);
 if(env.FIRESTORE_EMULATOR_HOST){if(!/^127\.0\.0\.1:[0-9]{1,5}$/.test(env.FIRESTORE_EMULATOR_HOST)||!project.startsWith('demo-'))fail('Emulator requires loopback and demo- project');return 'emulator';}
 if(project.startsWith('demo-'))fail('Demo project requires an emulator');return 'user-adc';
}
export function validateUserAdc(raw){
 if(!raw||raw.type!=='authorized_user'||['private_key','private_key_id','client_email','service_account_impersonation_url','credential_source'].some(k=>Object.hasOwn(raw,k))||!['client_id','client_secret','refresh_token'].every(k=>typeof raw[k]==='string'&&raw[k].length>0))fail('Only authorized_user ADC accepted; service accounts/impersonation are forbidden');
 return {clientId:raw.client_id,clientSecret:raw.client_secret,refreshToken:raw.refresh_token};
}
export function selectedState(data){return {storyFlags:data.storyFlags??null,pilotRank:data.pilotRank??null};}
export function validateResult(data,updates){
 const s=data.storyFlags;
 if(s!==undefined&&(!s||typeof s!=='object'||Array.isArray(s)))fail('Malformed existing storyFlags');
 const flags={arenaGatheringSeen:false,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false,...s};
 if(!['arenaGatheringSeen','arenaArcBuilt','holoZonesArcBuilt'].every(k=>typeof flags[k]==='boolean')||!Number.isInteger(flags.tournamentsWon)||flags.tournamentsWon<0||flags.tournamentsWon>3||Object.values(flags).some(v=>v===null))fail('Malformed existing story flags');
 const rank=updates.pilotRank??data.pilotRank??0;if(!Number.isSafeInteger(rank)||rank<0)fail('Malformed pilotRank');
 if(data.pilotRank!==undefined&&(!Number.isSafeInteger(data.pilotRank)||data.pilotRank<0))fail('Malformed existing pilotRank');
 for(const [path,value] of Object.entries(updates))if(path.startsWith('storyFlags.'))flags[path.slice(11)]=value;
 if(flags.arenaArcBuilt!==(flags.tournamentsWon===3))fail('arenaArcBuilt must match tournamentsWon===3; Arena disable requires an already-consistent win count');
}
/* Transport: plain Firestore REST v1 over fetch.
 * Why not @google-cloud/firestore: this script resolves google-auth-library 10.x, whose
 * getRequestHeaders() returns a WHATWG Headers object; google-gax 4 / grpc-js 1.14 (used by
 * @google-cloud/firestore 7) copy auth headers with Object.keys()/object spread, which yields {}
 * for a Headers instance. Every request therefore went out with NO Authorization header on both
 * the gRPC and preferRest transports, was evaluated by security rules as unauthenticated, and
 * failed "7 PERMISSION_DENIED: Missing or insufficient permissions." even for the project owner.
 * Here the bearer token is attached explicitly and the request is the same one `curl` makes.
 */
const READ_MASK=['storyFlags','pilotRank'];
export function documentsBase(mode,project,env=process.env){
 if(mode==='emulator')return `http://${env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents`;
 if(mode==='user-adc')return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
 fail('Unknown transport mode');
}
/** Build the REST client. Emulator: loopback + demo- project + `Bearer owner`. Real: verified authorized_user ADC only. */
export async function createRestClient({project,env=process.env,rawAdc,fetchImpl=globalThis.fetch}){
 const mode=credentialMode(env,project);let authClient=null;
 if(mode==='user-adc'){
  const credentials=validateUserAdc(rawAdc);
  const {UserRefreshClient}=await import('google-auth-library');
  authClient=new UserRefreshClient(credentials.clientId,credentials.clientSecret,credentials.refreshToken);
 }else if(rawAdc!==undefined)fail('Emulator mode must not load user credentials');
 const client={mode,project,authClient,base:documentsBase(mode,project,env),
  async token(){if(mode==='emulator')return 'owner';const {token}=await client.authClient.getAccessToken();if(typeof token!=='string'||!token)fail('User ADC produced no access token');return token;},
  async request(method,url,body){
   const headers={authorization:`Bearer ${await client.token()}`};if(body!==undefined)headers['content-type']='application/json';
   const res=await fetchImpl(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
   const text=await res.text();let json=null;try{json=text?JSON.parse(text):null;}catch{json=null;}
   return {status:res.status,ok:res.ok,json};
  }};
 return client;
}
export function decodeValue(v){
 if(!v||typeof v!=='object')fail('Malformed Firestore value');
 if('nullValue' in v)return null;if('booleanValue' in v)return v.booleanValue;
 if('integerValue' in v){const n=Number(v.integerValue);return Number.isSafeInteger(n)?n:v.integerValue;}
 if('doubleValue' in v)return Number(v.doubleValue);
 for(const k of ['stringValue','timestampValue','bytesValue','referenceValue'])if(k in v)return v[k];
 if('geoPointValue' in v)return {...v.geoPointValue};
 if('arrayValue' in v)return (v.arrayValue.values??[]).map(decodeValue);
 if('mapValue' in v)return decodeFields(v.mapValue.fields);
 fail('Unsupported Firestore value');
}
export function decodeFields(fields={}){return Object.fromEntries(Object.entries(fields??{}).map(([k,v])=>[k,decodeValue(v)]));}
export function encodeValue(v){
 if(typeof v==='boolean')return {booleanValue:v};
 if(Number.isSafeInteger(v))return {integerValue:String(v)};
 fail('Only boolean and safe-integer updates are encodable');
}
/** {'storyFlags.a':true,pilotRank:9} -> REST fields body (only the masked paths are applied). */
export function encodeUpdates(updates){
 const fields={};
 for(const [path,value] of Object.entries(updates)){
  const parts=path.split('.');if(parts.length>2||parts.some(p=>!/^[A-Za-z][A-Za-z0-9]*$/.test(p)))fail('Unapproved update field path');
  if(parts.length===1)fields[parts[0]]=encodeValue(value);
  else{fields[parts[0]]??={mapValue:{fields:{}}};fields[parts[0]].mapValue.fields[parts[1]]=encodeValue(value);}
 }
 return fields;
}
const restError=(what,r)=>`Firestore REST ${what} failed: HTTP ${r.status} ${r.json?.error?.status??''} ${r.json?.error?.message??''}`.trim();
async function readUser(client,uid){
 const q=new URLSearchParams();for(const f of READ_MASK)q.append('mask.fieldPaths',f);
 const r=await client.request('GET',`${client.base}/users/${encodeURIComponent(uid)}?${q}`);
 if(r.status===404)fail('Unknown UID; refusing upsert');
 if(!r.ok||!r.json||typeof r.json.updateTime!=='string')fail(restError('read',r));
 return {data:decodeFields(r.json.fields),updateTime:r.json.updateTime};
}
export async function updateStoryFlags(client,options){
 // Validate even programmatic callers, not just the CLI.
 const args=['--uid',options.uid,'--confirm',options.uid,'--project',options.project];
 const names={'storyFlags.arenaArcBuilt':'--arena-arc-built','storyFlags.holoZonesArcBuilt':'--holo-zones-arc-built',pilotRank:'--pilot-rank'};
 for(const [key,value] of Object.entries(options.updates)){if(!names[key])fail('Unapproved update field');args.push(names[key],String(value));}
 const checked=parseOptions(args);if(checked.project!==client.project)fail('Client project does not match --project');
 const updates=expandArenaEnable(checked.updates);
 const read=await readUser(client,checked.uid);validateResult(read.data,updates);
 // One masked update with an optimistic-concurrency precondition, sent through documents:commit so the
 // precondition travels as a JSON Timestamp. (The Firestore emulator parses a PATCH query-param
 // currentDocument.updateTime as version 0, so the PATCH form cannot be exercised locally.)
 // The write only lands on the exact version validated above; the precondition also implies the
 // document exists, so a delete between read and write cannot turn into an upsert.
 const w=await client.request('POST',`${client.base}:commit`,{writes:[{
  update:{name:`${client.base.slice(client.base.indexOf('/v1/')+4)}/users/${checked.uid}`,fields:encodeUpdates(updates)},
  updateMask:{fieldPaths:Object.keys(updates)},
  currentDocument:{updateTime:read.updateTime}}]});
 if(!w.ok){
  if(w.json?.error?.status==='FAILED_PRECONDITION'||w.status===409)fail('Document changed or vanished since it was read (concurrent write); nothing written, rerun to retry');
  fail(restError('write',w));
 }
 const reread=await readUser(client,checked.uid);
 return {uid:checked.uid,project:checked.project,before:selectedState(read.data),after:selectedState(reread.data),changedFields:Object.keys(updates)};
}
export async function main(args=process.argv.slice(2),env=process.env,fetchImpl=globalThis.fetch){
 const options=parseOptions(args);const mode=credentialMode(env,options.project);
 let rawAdc;
 if(mode==='user-adc'){
  const adcPath=resolve(env.CLOUDSDK_CONFIG||resolve(homedir(),'.config/gcloud'),'application_default_credentials.json');
  rawAdc=JSON.parse(await readFile(adcPath,'utf8'));validateUserAdc(rawAdc);
 }
 const client=await createRestClient({project:options.project,env,rawAdc,fetchImpl});
 const result=await updateStoryFlags(client,options);console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(`story-flags: ${error.message}`);process.exitCode=1;});
