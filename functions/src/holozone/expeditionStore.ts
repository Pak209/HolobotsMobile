import { randomBytes, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { arenaOpen, duelOpen, expeditionOpen } from '../lib/arenaActivity';
import { readHoloZoneRuns, HOLOZONE_RECORD_SCHEMA } from '../lib/holoZoneRuns';
import { readOpenBattles } from '../lib/rivalLadder';
import { healingStock } from '../lib/repairItems';
import { FIGHT_REPLAY_FLAG } from '../shared/fightReplayContract';
import { FightReplayError, verifyFightReplay } from '../sim/fight/replay';
import { ExpeditionConfig, ExpeditionError, ZONE_EXTRACT_SCHEMA, ZONE_RUN_SCHEMA, ZONE_RUN_SCHEMA_V4, ZONE_RUN_SCHEMA_V6, ZONE_REALTIME_FLAG, ZoneRunWire, advanceExpedition, advanceRealtimeExpedition, advanceReply, buyExpedition,
  configuredExpedition, dailyLayout, expeditionConfig, expeditionSupplies, issueExpedition, layoutView, readExpedition, runView, validateExpeditionCommand } from './expedition';

/** Exact-account server-only parent is also the activity lease observed by legacy hosts. */
export async function transactExpedition(db:Firestore,uid:string,raw:unknown,now=Date.now(),options:{config?:ExpeditionConfig|null;newId?:()=>string;seed?:()=>number}={}){
  const c=validateExpeditionCommand(raw),id=c.operation==='issue'?(options.newId??randomUUID)():c.runId;
  const realtimeEnabled=process.env[ZONE_REALTIME_FLAG]==='1'&&process.env[FIGHT_REPLAY_FLAG]==='1';
  if(c.operation==='issue'&&realtimeEnabled&&c.schemaVersion!==ZONE_RUN_SCHEMA_V6)throw new ExpeditionError('client_update_required');
  if(c.schemaVersion===ZONE_RUN_SCHEMA_V6&&!realtimeEnabled&&c.operation==='issue')throw new ExpeditionError('expedition_unavailable');
  // Private entropy is pinned outside retries, separate from the public daily layout seed.
  const seed=c.operation==='issue'?(options.seed??(()=>randomBytes(4).readUInt32LE(0)))():0;
  const configured=options.config===undefined?configuredExpedition():options.config;
  const parent=db.doc(`holoZoneRuns/${uid}`),userRef=db.doc(`users/${uid}`),requestRef=c.requestId?parent.collection('expeditionRequests').doc(c.requestId):null;
  const identity=JSON.stringify(Object.fromEntries(Object.entries(c).sort(([a],[b])=>a.localeCompare(b))));
  // zone-extract-1 requests keep the zone-run-3 view (that schema references zone-run-3's run).
  const wire:ZoneRunWire=c.schemaVersion===ZONE_RUN_SCHEMA_V6?ZONE_RUN_SCHEMA_V6:c.schemaVersion===ZONE_RUN_SCHEMA_V4?ZONE_RUN_SCHEMA_V4:ZONE_RUN_SCHEMA;
  // CPU replay is deliberately outside Firestore's retried transaction. The transaction checks the same immutable issue.
  let preverified:ReturnType<typeof verifyFightReplay> | undefined;
  if(c.operation==='fight_settle'){
    const pre=(await parent.collection('expeditions').doc(id!).get()).data();
    const pending=pre?readExpedition(pre).pendingFight:null;
    if(pending&&pending.fightId===c.fightId){
      try{preverified=verifyFightReplay(pending.issue,c.inputLog,{battleId:pending.fightId});}
      catch(e){if(e instanceof FightReplayError)throw new ExpeditionError(e.code==='invalid_log'?'invalid_request':e.code==='invalid_issue'?'unavailable':'replay_mismatch',e.detail);throw e;}
    }
  }
  return db.runTransaction(async tx=>{
    const user=await tx.get(userRef),lease=await tx.get(parent),saved=requestRef?await tx.get(requestRef):null;
    if(!user.exists)throw new ExpeditionError('unavailable');
    if(saved?.exists){if(saved.data()!.identity!==identity)throw new ExpeditionError('request_conflict');return {...saved.data()!.reply,alreadyProcessed:true};}
    const profile=user.data()!,parentData=lease.data(),open=expeditionOpen(parentData);
    if(c.operation==='layout'){
      if(wire===ZONE_RUN_SCHEMA_V6&&!realtimeEnabled)throw new ExpeditionError('expedition_unavailable');
      if(!configured)throw new ExpeditionError('expedition_unavailable');
      return {schemaVersion:wire,layout:layoutView(dailyLayout(now),wire),config:expeditionConfig(configured),...(wire===ZONE_RUN_SCHEMA_V6?{serverNowMs:now}:{})};
    }
    if(c.operation==='status'){
      const active=open?readExpedition((await tx.get(parent.collection('expeditions').doc(parentData!.expedition.runId))).data()):null;
      if(active&&active.realtime&&wire!==ZONE_RUN_SCHEMA_V6)throw new ExpeditionError('client_update_required');
      if(active&&!active.realtime&&wire===ZONE_RUN_SCHEMA_V6)throw new ExpeditionError('client_update_required');
      return {schemaVersion:wire,enabled:configured!==null&&(wire!==ZONE_RUN_SCHEMA_V6||realtimeEnabled),supplies:expeditionSupplies(profile),repairKits:healingStock(profile,'item.repair_kit'),run:active?runView(active,wire):null,
        ...(wire===ZONE_RUN_SCHEMA_V6?{serverNowMs:now,...(active?.pendingFight?{fightIssue:active.pendingFight.issue}:{})}:{})};
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
        reply={schemaVersion:wire,operation:'buy',itemId:c.itemId,holosTokens:updates.holosTokens,supplies:updates.expeditionSupplies,repairKits:healingStock({...profile,...updates},'item.repair_kit'),...(wire===ZONE_RUN_SCHEMA_V6?{serverNowMs:now}:{}),alreadyProcessed:false};
      }else{
        const result=issueExpedition(profile,c,id!,seed,now,config);updates=result.updates;
        tx.create(parent.collection('expeditions').doc(id!),result.run);
        tx.set(parent,{...(parentData??{schemaVersion:HOLOZONE_RECORD_SCHEMA,runs:[]}),expedition:{runId:id!,open:true}});
        reply={schemaVersion:wire,operation:'issue',run:runView(result.run,wire),...(wire===ZONE_RUN_SCHEMA_V6?{serverNowMs:now}:{}),alreadyProcessed:false};
      }
    }else{
      const runRef=parent.collection('expeditions').doc(id!),snapshot=await tx.get(runRef);
      if(!snapshot.exists)throw new ExpeditionError('unknown_run');
      const previous=readExpedition(snapshot.data());
      const lastFight=previous.lastFight;
      if(previous.realtime&&wire!==ZONE_RUN_SCHEMA_V6&&c.schemaVersion!==ZONE_EXTRACT_SCHEMA)throw new ExpeditionError('client_update_required');
      if(!previous.realtime&&wire===ZONE_RUN_SCHEMA_V6)throw new ExpeditionError('client_update_required');
      if(previous.state==='closed'){
        if(c.operation==='fight_settle'&&lastFight&&lastFight.fightId===c.fightId){
          const replay=advanceReply(ZONE_RUN_SCHEMA_V6,'fight_settle',previous,{fightReceipt:lastFight.receipt,encounterResult:lastFight.encounterResult},now);
          tx.create(requestRef!,{identity,reply:replay,createdAtMs:now});return {...replay,alreadyProcessed:true};
        }
        if(['extract','emergency_finish','wipe'].includes(c.operation)){
          const replay={schemaVersion:ZONE_EXTRACT_SCHEMA,receipt:previous.receipt,alreadyProcessed:true};
          tx.create(requestRef!,{identity,reply:replay,createdAtMs:now});return replay;
        }
        throw new ExpeditionError('run_closed');
      }
      if(!open||parentData!.expedition.runId!==id)throw new ExpeditionError('activity_conflict');
      const result=previous.realtime?advanceRealtimeExpedition(profile,previous,c,now,preverified?.receipt):advanceExpedition(profile,previous,c,now);updates=result.updates;
      if(c.operation==='fight_settle'&&preverified&&previous.pendingFight&&(previous.pendingFight.issue.rulesHash!==preverified.receipt.rulesHash||previous.pendingFight.issue.seed!==preverified.receipt.seed))throw new ExpeditionError('unavailable');
      tx.set(runRef,result.run);
      if(result.run.state==='closed')tx.set(parent,{...parentData,expedition:{runId:id!,open:false}});
      reply=advanceReply(wire,c.operation,result.run,result,now);
    }
    if(Object.keys(updates).length)tx.update(userRef,updates);
    tx.create(requestRef!,{identity,reply,createdAtMs:now});return reply;
  });
}
