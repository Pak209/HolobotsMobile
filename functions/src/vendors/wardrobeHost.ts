import { onCall,HttpsError } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { WARDROBE_SCHEMA, WardrobeError } from '../lib/wardrobe';
import { transactWardrobe } from './wardrobeStore';
export const wardrobeHost=onCall(async request=>{
 if(!request.auth) throw new HttpsError('unauthenticated','Sign in to use your wardrobe.');
 try{
  if(request.data?.operation==='read' && request.data.schemaVersion===WARDROBE_SCHEMA) {const user=await db.doc(`users/${request.auth.uid}`).get();if(!user.exists)throw new WardrobeError('unavailable');const state=await db.doc(`wardrobes/${request.auth.uid}`).get();return {schemaVersion:WARDROBE_SCHEMA,entitlements:state.get('entitlements')??[],recipe:state.get('recipe')??null};}
  return await transactWardrobe(db,request.auth.uid,request.data);}catch(e){
  if(e instanceof WardrobeError) throw new HttpsError(e.message==='invalid_request'?'invalid-argument':e.message==='sequence_conflict'?'already-exists':'failed-precondition',e.message);
  throw e;
 }
});
