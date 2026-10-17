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
 if(flags.arenaArcBuilt!==(flags.tournamentsWon===3))fail('arenaArcBuilt must match tournamentsWon===3; no implicit tournament changes');
}
export async function updateStoryFlags(db,options){
 // Validate even programmatic callers, not just the CLI.
 const args=['--uid',options.uid,'--confirm',options.uid,'--project',options.project];
 const names={'storyFlags.arenaArcBuilt':'--arena-arc-built','storyFlags.holoZonesArcBuilt':'--holo-zones-arc-built',pilotRank:'--pilot-rank'};
 for(const [key,value] of Object.entries(options.updates)){if(!names[key])fail('Unapproved update field');args.push(names[key],String(value));}
 const checked=parseOptions(args);const ref=db.doc(`users/${checked.uid}`);
 return db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)fail('Unknown UID; refusing upsert');const before=snap.data();validateResult(before,checked.updates);
  const after={...before,...(Object.hasOwn(checked.updates,'pilotRank')?{pilotRank:checked.updates.pilotRank}:{})};
  const flagUpdates=Object.entries(checked.updates).filter(([k])=>k.startsWith('storyFlags.'));if(flagUpdates.length)after.storyFlags={...before.storyFlags,...Object.fromEntries(flagUpdates.map(([k,v])=>[k.slice(11),v]))};
  tx.update(ref,checked.updates);return {uid:checked.uid,project:checked.project,before:selectedState(before),after:selectedState(after),changedFields:Object.keys(checked.updates)};
 });
}
/** Use the installed Google Cloud transport with this exact verified user client.
 * Firebase Admin refreshToken credentials are not accepted by its Firestore adapter.
 * Supplying auth explicitly avoids any second ADC/metadata/key-file discovery.
 */
export async function createUserFirestore(project, rawAdc) {
 const {Firestore}=await import('@google-cloud/firestore');
 if(rawAdc===undefined){if(credentialMode(process.env,project)!=='emulator')fail('User ADC required');return new Firestore({projectId:project});}
 const credentials=validateUserAdc(rawAdc);
 const {GoogleAuth,UserRefreshClient}=await import('google-auth-library');
 const client=new UserRefreshClient(credentials.clientId,credentials.clientSecret,credentials.refreshToken);
 const auth=new GoogleAuth({projectId:project,authClient:client});
 return new Firestore({projectId:project,auth});
}
export async function main(args=process.argv.slice(2),env=process.env){
 const options=parseOptions(args);const mode=credentialMode(env,options.project);
 let credentials;
 if(mode==='user-adc'){
  const adcPath=resolve(env.CLOUDSDK_CONFIG||resolve(homedir(),'.config/gcloud'),'application_default_credentials.json');
  credentials=JSON.parse(await readFile(adcPath,'utf8'));validateUserAdc(credentials);
 }
 const db=await createUserFirestore(options.project,credentials);
 try{const result=await updateStoryFlags(db,options);console.log(JSON.stringify(result,null,2));return result;}finally{await db.terminate();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(`story-flags: ${error.message}`);process.exitCode=1;});
