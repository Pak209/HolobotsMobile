import test from 'node:test';import assert from 'node:assert/strict';
import {parseOptions,credentialMode,validateUserAdc,validateResult,selectedState,createUserFirestore} from './admin/story-flags.mjs';
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
test('Arena invariant is preserved; no hidden tournament-win mutation',()=>{
 assert.throws(()=>validateResult({storyFlags:{tournamentsWon:0}}, {'storyFlags.arenaArcBuilt':true}),/tournamentsWon/);
 assert.throws(()=>validateResult({storyFlags:{tournamentsWon:3,arenaArcBuilt:true}}, {'storyFlags.arenaArcBuilt':false}),/tournamentsWon/);
 assert.doesNotThrow(()=>validateResult({storyFlags:{tournamentsWon:3,arenaArcBuilt:true}}, {'storyFlags.arenaArcBuilt':true}));
});
test('malformed existing records refuse; reporting excludes all other profile fields',()=>{
 for(const data of [{storyFlags:[]},{storyFlags:{arenaGatheringSeen:'true'}},{pilotRank:-1},{storyFlags:{tournamentsWon:4}},{storyFlags:{holoZonesArcBuilt:null}}])assert.throws(()=>validateResult(data,{pilotRank:1}));
 assert.deepEqual(selectedState({email:'not-output',private:'not-output',pilotRank:2}),{storyFlags:null,pilotRank:2});
});

test('verified authorized_user constructs Google Cloud Firestore without ADC rediscovery or token requests',async()=>{
 const db=await createUserFirestore('synthetic-project',{type:'authorized_user',client_id:'fake-id',client_secret:'fake-secret',refresh_token:'fake-token'});
 const client=await db._settings.auth.getClient();
 client.getAccessToken=()=>{throw Error('Token/network request forbidden in construction test');};
 assert.equal(client.constructor.name,'UserRefreshClient');assert.equal(client.credentials.refresh_token,'fake-token');
 assert.equal(db.doc('users/offline').path,'users/offline');
 const {default:FirestoreClient}=await import('@google-cloud/firestore/build/src/v1/index.js');const transport=new FirestoreClient({projectId:'synthetic-project',auth:db._settings.auth});assert.equal(await transport.auth.getClient(),client);
 await transport.close();await db.terminate();
});
