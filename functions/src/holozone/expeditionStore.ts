import { randomBytes, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { arenaOpen, duelOpen, expeditionOpen } from '../lib/arenaActivity';
import { readHoloZoneRuns, HOLOZONE_RECORD_SCHEMA } from '../lib/holoZoneRuns';
import { readOpenBattles } from '../lib/rivalLadder';
import { healingStock } from '../lib/repairItems';
import { ExpeditionConfig, ExpeditionError, ZONE_RUN_SCHEMA, advanceExpedition, buyExpedition, configuredExpedition, dailyLayout,
  expeditionConfig, expeditionSupplies, issueExpedition, readExpedition, runView, validateExpeditionCommand } from './expedition';

/** Exact-account server-only parent is also the activity lease observed by legacy hosts. */
export async function transactExpedition(db:Firestore,uid:string,raw:unknown,now=Date.now(),options:{config?:ExpeditionConfig|null;newId?:()=>string;seed?:()=>number}={}){
  const c=validateExpeditionCommand(raw),id=c.operation==='issue'?(options.newId??randomUUID)():c.runId;
  // Private entropy is pinned outside retries, separate from the public daily layout seed.
  const seed=c.operation==='issue'?(options.seed??(()=>randomBytes(4).readUInt32LE(0)))():0;
  const configured=options.config===undefined?configuredExpedition():options.config;
  const parent=db.doc(`holoZoneRuns/${uid}`),userRef=db.doc(`users/${uid}`),requestRef=c.requestId?parent.collection('expeditionRequests').doc(c.requestId):null;
  const identity=JSON.stringify(Object.fromEntries(Object.entries(c).sort(([a],[b])=>a.localeCompare(b))));
  return db.runTransaction(async tx=>{
    const user=await tx.get(userRef),lease=await tx.get(parent),saved=requestRef?await tx.get(requestRef):null;
    if(!user.exists)throw new ExpeditionError('unavailable');
    if(saved?.exists){if(saved.data()!.identity!==identity)throw new ExpeditionError('request_conflict');return {...saved.data()!.reply,alreadyProcessed:true};}
    const profile=user.data()!,parentData=lease.data(),open=expeditionOpen(parentData);
    if(c.operation==='layout'){
      if(!configured)throw new ExpeditionError('expedition_unavailable');
      return {schemaVersion:ZONE_RUN_SCHEMA,layout:dailyLayout(now),config:expeditionConfig(configured)};
    }
    if(c.operation==='status'){
      const active=open?readExpedition((await tx.get(parent.collection('expeditions').doc(parentData!.expedition.runId))).data()):null;
      return {schemaVersion:ZONE_RUN_SCHEMA,enabled:configured!==null,supplies:expeditionSupplies(profile),repairKits:healingStock(profile,'item.repair_kit'),run:active?runView(active):null};
    }
    let updates:Record<string,unknown>,reply:Record<string,unknown>;
    if(c.operation==='issue'||c.operation==='buy'){
      if(open)throw new ExpeditionError('expedition_open');
      if(!configured)throw new ExpeditionError('expedition_unavailable');
      const config=expeditionConfig(configured);
      const arena=await tx.get(db.doc(`arenaMatches/${uid}`)),duel=await tx.get(db.doc(`duelHealingRuns/${uid}`)),rival=await tx.get(db.doc(`rivalBattles/${uid}`));
      if(arenaOpen(arena.data())||duelOpen(duel.data())||Object.keys(readOpenBattles(rival.data(),now)).length||readHoloZoneRuns(parentData).some(r=>r.closedAtMs===null&&r.settlement===null&&now<=r.expiresAtMs))throw new ExpeditionError('activity_conflict');
      if(c.operation==='buy'){
        updates=buyExpedition(profile,c.itemId!,config);
        reply={schemaVersion:ZONE_RUN_SCHEMA,operation:'buy',itemId:c.itemId,holosTokens:updates.holosTokens,supplies:updates.expeditionSupplies,repairKits:healingStock({...profile,...updates},'item.repair_kit'),alreadyProcessed:false};
      }else{
        const result=issueExpedition(profile,c,id!,seed,now,config);updates=result.updates;
        tx.create(parent.collection('expeditions').doc(id!),result.run);
        tx.set(parent,{...(parentData??{schemaVersion:HOLOZONE_RECORD_SCHEMA,runs:[]}),expedition:{runId:id!,open:true}});
        reply={schemaVersion:ZONE_RUN_SCHEMA,operation:'issue',run:runView(result.run),alreadyProcessed:false};
      }
    }else{
      const runRef=parent.collection('expeditions').doc(id!),snapshot=await tx.get(runRef);
      if(!snapshot.exists)throw new ExpeditionError('unknown_run');
      const previous=readExpedition(snapshot.data());
      if(previous.state==='closed'){
        if(['extract','emergency_finish','wipe'].includes(c.operation)){
          const replay={schemaVersion:'zone-extract-1',receipt:previous.receipt,alreadyProcessed:true};
          tx.create(requestRef!,{identity,reply:replay,createdAtMs:now});return replay;
        }
        throw new ExpeditionError('run_closed');
      }
      if(!open||parentData!.expedition.runId!==id)throw new ExpeditionError('activity_conflict');
      const result=advanceExpedition(profile,previous,c,now);updates=result.updates;
      tx.set(runRef,result.run);
      if(result.run.state==='closed')tx.set(parent,{...parentData,expedition:{runId:id!,open:false}});
      reply={schemaVersion:result.run.receipt?'zone-extract-1':ZONE_RUN_SCHEMA,operation:c.operation,run:runView(result.run),receipt:result.run.receipt,
        ...(result.duelReceipt?{duelReceipt:result.duelReceipt}:{}),...(result.interrupted?{interrupted:true}:{}),alreadyProcessed:false};
    }
    tx.update(userRef,updates);tx.create(requestRef!,{identity,reply,createdAtMs:now});return reply;
  });
}
