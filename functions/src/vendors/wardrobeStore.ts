import { Firestore } from 'firebase-admin/firestore';
import { command, reduceWardrobe, WardrobeError } from '../lib/wardrobe';
export async function transactWardrobe(db:Firestore,uid:string,raw:unknown) {
 const c=command(raw), fingerprint=JSON.stringify(c);
 const user=db.doc(`users/${uid}`), wardrobe=db.doc(`wardrobes/${uid}`), receipt=db.doc(`wardrobes/${uid}/receipts/${c.requestId}`);
 return db.runTransaction(async tx=>{
  const [u,w,r]=await Promise.all([tx.get(user),tx.get(wardrobe),tx.get(receipt)]);
  if(!u.exists) throw new WardrobeError('unavailable');
  if(r.exists) {if(r.get('fingerprint')!==fingerprint) throw new WardrobeError('sequence_conflict'); return {...r.get('reply'),alreadyProcessed:true};}
  const result=reduceWardrobe(u.data()!,w.data()??{},c);
  tx.update(user,{holosTokens:result.balance}); tx.set(wardrobe,result.state);
  tx.create(receipt,{fingerprint,reply:result.reply}); return result.reply;
 });
}
