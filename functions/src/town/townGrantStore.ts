import { createHash, randomBytes } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
export const TOWN_GRANT_SCHEMA = 'town-grant-1';
export const TOWN_GRANT_TTL_MS = 120000;
const id = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max && /^[A-Za-z0-9_-]+$/.test(x);
const hash = (grant: string) => createHash('sha256').update(grant).digest('hex');
export function parseTownGrant(data: unknown, verify = false): { instance: string; grant?: string; uid?: string } {
 if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('invalid_request');
 const x = data as Record<string, unknown>;
 if (x.schemaVersion !== TOWN_GRANT_SCHEMA || !id(x.instance, 64) || Object.keys(x).some(k => !['schemaVersion','instance','grant',...(verify ? ['uid'] : [])].includes(k))) throw Error('invalid_request');
 if (x.grant !== undefined && (typeof x.grant !== 'string' || !/^sg_[a-f0-9]{24}$/.test(x.grant))) throw Error('invalid_request');
 if (verify && (!id(x.uid, 128) || x.grant === undefined)) throw Error('invalid_request');
 return x as { instance: string; grant?: string; uid?: string };
}
export async function issueTownGrant(db: Firestore, uid: string, data: unknown, now = Date.now()) {
 if (!id(uid,128)) throw Error('invalid_request'); const x=parseTownGrant(data); if(x.grant!==undefined)throw Error('invalid_request');
 const grant='sg_'+randomBytes(12).toString('hex'), digest=hash(grant);
 return db.runTransaction(async tx => {
  const user=db.doc(`users/${uid}`), pilot=db.doc(`townGrantPilots/${uid}`), instance=db.doc(`townInstances/${x.instance}`);
  const [u,i]=await tx.getAll(user,instance);const ins=i.data();
  if(!u.exists)throw Error('profile_missing');
  if(!ins||ins.enabled!==true||!Number.isSafeInteger(ins.expiresAtMs)||ins.expiresAtMs<=now)throw Error('instance_unavailable');
  const expiresAtMs=Math.min(now+TOWN_GRANT_TTL_MS,ins.expiresAtMs);
  tx.set(db.doc(`townGrants/${digest}`),{schemaVersion:TOWN_GRANT_SCHEMA,uid,instance:x.instance,issuedAtMs:now,expiresAtMs,consumedAtMs:null,revokedAtMs:null});
  tx.set(pilot,{digest}); // A new issue supersedes every previous grant for this pilot.
  return {schemaVersion:TOWN_GRANT_SCHEMA,uid,instance:x.instance,grant,expiresAtMs};
 });
}
/** SERVER PROCESS ONLY. Not exported from the Cloud Functions index or reachable as a player callable.
 * Invoke with an Admin SDK Firestore handle using workload service-account ADC; never player credentials.
 * Atomic verification consumes admission once; use its returned expiry to disconnect the admitted socket.
 */
export async function townGrantVerify(db: Firestore, data: unknown, now = Date.now()) {
 const x=parseTownGrant(data,true), ref=db.doc(`townGrants/${hash(x.grant!)}`);
 return db.runTransaction(async tx => {
  const s=await tx.get(ref),r=s.data();
  if(!r)return {status:'invalid' as const};
  if(r.uid!==x.uid||r.instance!==x.instance)return {status:'foreign' as const};
  if(r.schemaVersion!==TOWN_GRANT_SCHEMA||!Number.isSafeInteger(r.expiresAtMs))return {status:'invalid' as const};
  if(r.expiresAtMs<=now)return {status:'expired' as const};
  const [u,p,i]=await tx.getAll(db.doc(`users/${x.uid}`),db.doc(`townGrantPilots/${x.uid}`),db.doc(`townInstances/${x.instance}`));
  if(!u.exists||p.data()?.digest!==ref.id||i.data()?.enabled!==true||!Number.isSafeInteger(i.data()?.expiresAtMs)||i.data()?.expiresAtMs<=now||r.revokedAtMs!==null)return {status:'revoked' as const};
  if(r.consumedAtMs!==null)return {status:'replay' as const};
  tx.update(ref,{consumedAtMs:now});return {status:'live' as const,uid:r.uid,instance:r.instance,grant:x.grant!,expiresAtMs:r.expiresAtMs};
 });
}
export async function revokeTownGrant(db: Firestore, uid: string, data: unknown, now = Date.now()) {
 if(!id(uid,128))throw Error('invalid_request');const x=parseTownGrant(data);if(!x.grant)throw Error('invalid_request');
 const ref=db.doc(`townGrants/${hash(x.grant)}`);
 return db.runTransaction(async tx=>{const r=(await tx.get(ref)).data();if(!r||r.uid!==uid||r.instance!==x.instance)throw Error('foreign');tx.update(ref,{revokedAtMs:now});return {schemaVersion:TOWN_GRANT_SCHEMA,revoked:true};});
}
