import { randomBytes, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { arenaOpen, duelOpen, expeditionOpen } from '../lib/arenaActivity';
import { readHoloZoneRuns, HOLOZONE_RECORD_SCHEMA } from '../lib/holoZoneRuns';
import { readOpenBattles } from '../lib/rivalLadder';
import { healingStock } from '../lib/repairItems';
import { zoneSignaturesEnabled } from '../config/zoneExpedition';
import { ExpeditionConfig, ExpeditionError, ZONE_EXTRACT_SCHEMA, ZONE_RUN_SCHEMA, ZONE_RUN_SCHEMA_V4, ZONE_RUN_SCHEMA_V5, ZoneRunWire, advanceExpedition, advanceReply, buyExpedition,
  configuredExpedition, dailyLayout, expeditionConfig, expeditionSupplies, issueExpedition, layoutView, readExpedition, runView, validateExpeditionCommand } from './expedition';

/** Exact-account server-only parent is also the activity lease observed by legacy hosts. */
export async function transactExpedition(db:Firestore,uid:string,raw:unknown,now=Date.now(),options:{config?:ExpeditionConfig|null;newId?:()=>string;seed?:()=>number;signatures?:boolean}={}){
  // zone-run-5 signature pilot: HOLOCITY_ZONE_SIGNATURES flag, default off (tests may pin it).
  const signatures=options.signatures??zoneSignaturesEnabled();
  const c=validateExpeditionCommand(raw,{signatures}),id=c.operation==='issue'?(options.newId??randomUUID)():c.runId;
  // Private entropy is pinned outside retries, separate from the public daily layout seed.
  const seed=c.operation==='issue'?(options.seed??(()=>randomBytes(4).readUInt32LE(0)))():0;
  const configured=options.config===undefined?configuredExpedition():options.config;
  const parent=db.doc(`holoZoneRuns/${uid}`),userRef=db.doc(`users/${uid}`),requestRef=c.requestId?parent.collection('expeditionRequests').doc(c.requestId):null;
  const identity=JSON.stringify(Object.fromEntries(Object.entries(c).sort(([a],[b])=>a.localeCompare(b))));
  // zone-extract-1 requests keep the zone-run-3 view (that schema references zone-run-3's run).
  const wire:ZoneRunWire=c.schemaVersion===ZONE_RUN_SCHEMA_V5?ZONE_RUN_SCHEMA_V5:c.schemaVersion===ZONE_RUN_SCHEMA_V4?ZONE_RUN_SCHEMA_V4:ZONE_RUN_SCHEMA;
  return db.runTransaction(async tx=>{
    const user=await tx.get(userRef),lease=await tx.get(parent),saved=requestRef?await tx.get(requestRef):null;
    if(!user.exists)throw new ExpeditionError('unavailable');
    if(saved?.exists){if(saved.data()!.identity!==identity)throw new ExpeditionError('request_conflict');return {...saved.data()!.reply,alreadyProcessed:true};}
    const profile=user.data()!,parentData=lease.data(),open=expeditionOpen(parentData);
    if(c.operation==='layout'){
      if(!configured)throw new ExpeditionError('expedition_unavailable');
      return {schemaVersion:wire,layout:layoutView(dailyLayout(now),wire),config:expeditionConfig(configured)};
    }
    if(c.operation==='status'){
      const active=open?readExpedition((await tx.get(parent.collection('expeditions').doc(parentData!.expedition.runId))).data()):null;
      return {schemaVersion:wire,enabled:configured!==null,supplies:expeditionSupplies(profile),repairKits:healingStock(profile,'item.repair_kit'),run:active?runView(active,wire):null};
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
        reply={schemaVersion:wire,operation:'buy',itemId:c.itemId,holosTokens:updates.holosTokens,supplies:updates.expeditionSupplies,repairKits:healingStock({...profile,...updates},'item.repair_kit'),alreadyProcessed:false};
      }else{
        const result=issueExpedition(profile,c,id!,seed,now,config,{signatures});updates=result.updates;
        tx.create(parent.collection('expeditions').doc(id!),result.run);
        tx.set(parent,{...(parentData??{schemaVersion:HOLOZONE_RECORD_SCHEMA,runs:[]}),expedition:{runId:id!,open:true}});
        reply={schemaVersion:wire,operation:'issue',run:runView(result.run,wire),alreadyProcessed:false};
      }
    }else{
      const runRef=parent.collection('expeditions').doc(id!),snapshot=await tx.get(runRef);
      if(!snapshot.exists)throw new ExpeditionError('unknown_run');
      const previous=readExpedition(snapshot.data());
      if(previous.state==='closed'){
        if(['extract','emergency_finish','wipe'].includes(c.operation)){
          const replay={schemaVersion:ZONE_EXTRACT_SCHEMA,receipt:previous.receipt,alreadyProcessed:true};
          tx.create(requestRef!,{identity,reply:replay,createdAtMs:now});return replay;
        }
        throw new ExpeditionError('run_closed');
      }
      if(!open||parentData!.expedition.runId!==id)throw new ExpeditionError('activity_conflict');
      const result=advanceExpedition(profile,previous,c,now);updates=result.updates;
      tx.set(runRef,result.run);
      if(result.run.state==='closed')tx.set(parent,{...parentData,expedition:{runId:id!,open:false}});
      reply=advanceReply(wire,c.operation,result.run,result);
    }
    tx.update(userRef,updates);tx.create(requestRef!,{identity,reply,createdAtMs:now});return reply;
  });
}
