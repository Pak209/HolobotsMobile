import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { issueTownGrant, revokeTownGrant } from './townGrantStore';
function pilot(request: {auth?: {uid: string; token: Record<string, unknown>}}) {
 if(!request.auth?.uid)throw new HttpsError('unauthenticated','Sign in.');
 if(request.auth.token.holoServer===true)throw new HttpsError('permission-denied','server_not_allowed');return request.auth.uid;
}
const run=async(fn:()=>Promise<unknown>)=>{try{return await fn();}catch(e){const code=(e as Error).message;if(['invalid_request','profile_missing','instance_unavailable','foreign'].includes(code))throw new HttpsError(code==='invalid_request'?'invalid-argument':'failed-precondition',code,{rejectionCode:code});throw e;}};
export const townGrantIssue=onCall({region:'us-central1'},request=>{const uid=pilot(request);return run(()=>issueTownGrant(db,uid,request.data));});
export const townGrantRevoke=onCall({region:'us-central1'},request=>{const uid=pilot(request);return run(()=>revokeTownGrant(db,uid,request.data));});
