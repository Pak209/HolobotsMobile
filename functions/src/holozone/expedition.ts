import { ZoneExpeditionTuning, ZONE_EXPEDITION_DEFAULT_SELECTOR, ZONE_EXPEDITION_RULES, loadZoneExpeditionDefaults } from '../config/zoneExpedition';
import { createHash } from 'node:crypto';
import { DuelFighterStats, DuelIntent, DuelReceipt, duelFighterFromCombatant, resolveDuel, validateDuelIntents } from '../lib/duelResolver';
import { buildPlayerCombatants, playerCombatant } from '../lib/rivalLadder';
import { requireLivingVitals, issueVitals, Vitals } from '../lib/rivalHealth';
import { healingDelta, healingStock, healingItem } from '../lib/repairItems';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { readStoryFlags } from '../story/storyFlags';

/** Storage version of every run document AND the zone-run-3 wire. zone-run-4 is a reply shape over the same rulings. */
export const ZONE_RUN_SCHEMA = 'zone-run-3';
/** zone-run-4 (additive over zone-run-3): run.utilityUsed + utility reply utilityResult. A zone-run-3 request still gets
 * exactly the zone-run-3 shapes (no utilityUsed / utilityResult, same key order); rulings are identical in both. */
export const ZONE_RUN_SCHEMA_V4 = 'zone-run-4';
/** zone-run-5 (additive over zone-run-4): the signature pilot (FORECAST + SLIPSTREAM). Accepted only while the
 * HOLOCITY_ZONE_SIGNATURES flag is on; zone-run-3/4 shapes and rulings are unchanged for runs that never signature. */
export const ZONE_RUN_SCHEMA_V5 = 'zone-run-5';
export type ZoneRunWire = typeof ZONE_RUN_SCHEMA | typeof ZONE_RUN_SCHEMA_V4 | typeof ZONE_RUN_SCHEMA_V5;
export const ZONE_RUN_WIRES:readonly string[] = [ZONE_RUN_SCHEMA, ZONE_RUN_SCHEMA_V4];
/** v4-or-later views (utilityUsed, glimpse/dangerLabel, utilityResult). */
const atLeastV4=(wire:ZoneRunWire)=>wire===ZONE_RUN_SCHEMA_V4||wire===ZONE_RUN_SCHEMA_V5;
export const ZONE_EXTRACT_SCHEMA = 'zone-extract-1';
export const EXTRACTION_CHANNEL_MS = ZONE_EXPEDITION_RULES.extraction.channelMs;
export const UTILITY_COOLDOWN_MS = ZONE_EXPEDITION_RULES.utility.cooldownMs;
export const SIGNATURE_COOLDOWN_MS = ZONE_EXPEDITION_RULES.signatures.cooldownMs;
export const SIGNATURE_KINDS = ['forecast','slipstream','snare','aegis','lockbox'] as const;
export type SignatureKind = typeof SIGNATURE_KINDS[number];
const MAX_HAUL = 9;
export class ExpeditionError extends Error { constructor(public code:string, public details:Record<string,unknown>={}) { super(code); } }
const fail=(code:string):never=>{throw new ExpeditionError(code);};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const whole=(v:unknown,max=1_000_000):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
export type ExpeditionConfig = ZoneExpeditionTuning;
/** A reviewed server-owned config is required for new purchases/entries; proposed defaults never auto-activate. */
export function expeditionConfig(raw:unknown):ExpeditionConfig {
  if(!object(raw)||typeof raw.version!=='string'||!/^zone-config-[a-zA-Z0-9_-]{1,64}$/.test(raw.version))return fail('expedition_unavailable');
  const keys=['energyCapacity','energyPackUnits','energyPackPrice','sectorEnergyCost','fightEnergyCost','extractionChargePrice','cacheFragments','bulkySalvageUnits','rareBlueprintChanceBasisPoints'];
  if(Object.keys(raw).some(k=>!['version','bandLevels',...keys].includes(k))||keys.some(k=>!whole(raw[k])||raw[k]===0&&k!=='rareBlueprintChanceBasisPoints'))return fail('expedition_unavailable');
  const levels=raw.bandLevels;
  if(!Array.isArray(levels)||levels.length!==3||!levels.every(n=>whole(n,99)&&n>=1)||levels[0]>1||levels[1]<=levels[0]||levels[2]<21||levels[2]<levels[1]
    ||(raw.rareBlueprintChanceBasisPoints as number)>10000||(raw.energyPackUnits as number)>(raw.energyCapacity as number)
    ||(raw.sectorEnergyCost as number)>(raw.energyCapacity as number)||(raw.fightEnergyCost as number)>(raw.energyCapacity as number))return fail('expedition_unavailable');
  return structuredClone(raw) as ExpeditionConfig;
}
export function configuredExpedition():ExpeditionConfig|null {
  const selected=process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;
  if(!selected)return null;
  try{return expeditionConfig(selected===ZONE_EXPEDITION_DEFAULT_SELECTOR?loadZoneExpeditionDefaults():JSON.parse(selected));}catch{return null;}
}
export type Supplies={energy:number;extractionCharges:number};
export function expeditionSupplies(profile:Record<string,unknown>):Supplies {
  const r=profile.expeditionSupplies??{energy:ZONE_EXPEDITION_RULES.initialEnergy,extractionCharges:0};
  if(!object(r)||!whole(r.energy)||!whole(r.extractionCharges)||Object.keys(r).some(k=>!['energy','extractionCharges'].includes(k)))return fail('unavailable');
  return {energy:r.energy,extractionCharges:r.extractionCharges};
}
function count(raw:unknown):number {if(raw===undefined)return 0;if(!whole(raw,Number.MAX_SAFE_INTEGER))return fail('unavailable');return raw;}
export function seed32(value:string):number{return createHash('sha256').update(value).digest().readUInt32LE(0);}
export type Sector={id:string;band:number;safe:boolean;beacon:boolean;neighbors:string[];cache:boolean;rareDiscovery:boolean;guardian:boolean;utility:'ace'|'shadow'|'kuma'|null};
export type Layout={day:string;seed:number;sectors:Sector[]};
/** Public global UTC layout: account-independent. Existing runs keep their pinned layout across midnight. */
export function dailyLayout(now:number):Layout {
  if(!whole(now,8_640_000_000_000_000))return fail('invalid_request');
  const day=new Date(now).toISOString().slice(0,10),seed=seed32('neonforest:zone-run-3:'+day);
  const sectors:Sector[]=[{id:'entry',band:0,safe:true,beacon:true,neighbors:['gate1'],cache:false,rareDiscovery:false,guardian:false,utility:null}];
  for(let band=1;band<=3;band++){
    const previous=band===1?['entry']:[`b${band-1}a`,`b${band-1}b`];
    sectors.push({id:`gate${band}`,band,safe:true,beacon:true,neighbors:[...previous,`b${band}a`,`b${band}b`],cache:false,rareDiscovery:false,guardian:false,utility:null});
    for(const side of ['a','b']){
      const pick=(seed>>>(band*3))&1,chosen=side===(pick?'a':'b');
      sectors.push({id:`b${band}${side}`,band,safe:false,beacon:false,neighbors:[`gate${band}`,...(band<3?[`gate${band+1}`]:[]),...((seed>>>(band+13))&1?[`b${band}${side==='a'?'b':'a'}`]:[])],cache:chosen,
        rareDiscovery:band===2&&chosen,guardian:band===3&&chosen,utility:chosen?null:band===1?'ace':band===2?'shadow':'kuma'});
    }
  }
  return {day,seed,sectors};
}
export type Haul={id:string;kind:'blueprint_fragment'|'rare_blueprint_fragment'|'bulky_salvage';amount:number;protected:boolean};
export type ExtractionReceipt={schemaVersion:typeof ZONE_EXTRACT_SCHEMA;runId:string;outcome:'normal'|'emergency'|'wipe';closedAtMs:number;banked:Haul[];lost:Haul[];guardianDefeated:boolean;finalVitals:Vitals};
export type ExpeditionRun={schemaVersion:typeof ZONE_RUN_SCHEMA;runId:string;state:'open'|'closed';issuedAtMs:number;config:ExpeditionConfig;layout:Layout;privateSeed:number;
  opponents:Record<string,DuelFighterStats>;sectorId:string;visited:string[];cleared:string[];looted:string[];squad:DuelFighterStats[];energy:number;kits:number;charge:number;haul:Haul[];guardianDefeated:boolean;
  extraction:{startedAtMs:number}|null;receipt:ExtractionReceipt|null;revision:number;
  /** Sector ids whose utility has been spent this run (one-shot). Absent on documents issued before zone-run-4 = []. */
  utilityUsed:string[];
  /** Host clock of the last spent utility (cooldown anchor). Internal: never in a run view. */
  utilityAtMs:number|null;
  /** zone-run-5 signature state. Absent on runs issued with the signature flag off (read as "no signatures"); never
   * defaulted into storage, so flag-off documents keep their exact shape. */
  signaturePool?:SignaturePool;signatureArmed?:{kind:'snare'|'aegis';holobotId:string}|null;forecasts?:Forecast[];slipOpened?:string[];protectedSlots?:number;
  /** Host clock of the last spent signature (cooldown anchor). Internal: never in a run view. */
  signatureAtMs?:number|null};
export type SignaturePool=Partial<Record<SignatureKind,{charges:number;max:number;holders:string[]}>>;
export type ForecastProjection='clean'|'bruised'|'heavy'|'wipe_risk';
export type Forecast={sectorId:string;openingIntents:DuelIntent[];projection:ForecastProjection};
export type SignatureEffect='forecast'|'armed'|'route'|'protect'|'none';
/** zone-run-5 signature reply field. sectorId = the sector the effect is about (forecast: the target; slipstream: here). */
export type SignatureResult={signature:SignatureKind;holobotId:string;sectorId:string;effect:SignatureEffect;spent:boolean;chargesLeft:number;
  cooldownMs:number|null;opensSectorId:string|null;forecast:Forecast|null;protectedSlots:number|null};
export type UtilityEffect='route'|'cache'|'clear'|'none';
/** zone-run-4 utility reply field. haul = rows this use added (also present in run.haul, unbanked until extraction). */
export type UtilityResult={sectorId:string;utility:'ace'|'shadow'|'kuma';effect:UtilityEffect;opensSectorId:string|null;haul:Haul[];spent:boolean;cooldownMs:number|null};
export type ExpeditionCommand={schemaVersion:string;operation:string;requestId?:string;runId?:string;itemId?:string;repairKits?:number;carryExtractionCharge?:boolean;
  sectorId?:string;holobotId?:string;order?:string[];haulId?:string;utility?:string;playerIntents?:unknown;signature?:string;targetSectorId?:string};
const fields:Record<string,string[]>={status:[],layout:[],buy:['itemId'],issue:['repairKits','carryExtractionCharge'],move:['sectorId'],fight:['playerIntents'],cache:[],protect:['haulId'],heal:['holobotId'],reorder:['order'],utility:['utility'],signature:['signature','holobotId','targetSectorId'],extract:['mode'],emergency_start:[],emergency_finish:[],wipe:[]};
/** signatures = the HOLOCITY_ZONE_SIGNATURES flag (store passes it). Off: zone-run-5 is an unknown version (invalid_request). */
export function validateExpeditionCommand(raw:unknown,options:{signatures?:boolean}={}):ExpeditionCommand {
  if(!object(raw)||typeof raw.operation!=='string'||!Object.hasOwn(fields,raw.operation))return fail('invalid_request');
  const op=raw.operation,read=op==='status'||op==='layout',town=op==='issue'||op==='buy',extract=op==='extract'||op.startsWith('emergency_')||op==='wipe';
  const v5=options.signatures===true&&raw.schemaVersion===ZONE_RUN_SCHEMA_V5;
  // The signature operation exists only on zone-run-5.
  if(op==='signature'&&!v5)return fail('invalid_request');
  if(!(extract?raw.schemaVersion===ZONE_EXTRACT_SCHEMA:ZONE_RUN_WIRES.includes(String(raw.schemaVersion))||v5)||Object.keys(raw).some(k=>!['schemaVersion','operation',...(!read?['requestId']:[]),...(!read&&!town?['runId']:[]),...fields[op]].includes(k)))return fail('invalid_request');
  const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
  if(!read&&!id(raw.requestId)||!read&&!town&&!id(raw.runId))return fail('invalid_request');
  if(op==='issue'&&(!whole(raw.repairKits,99)||typeof raw.carryExtractionCharge!=='boolean'))return fail('invalid_request');
  if(op==='buy'&&!['item.expedition_energy','item.extraction_charge','item.repair_kit'].includes(String(raw.itemId)))return fail('unknown_item');
  if(['move','heal','protect','utility'].includes(op)&&!id(raw[fields[op][0]]))return fail('invalid_request');
  if(op==='reorder'&&(!Array.isArray(raw.order)||raw.order.length<1||raw.order.length>3||!raw.order.every(id)||new Set(raw.order).size!==raw.order.length))return fail('invalid_request');
  if(op==='fight'){try{validateDuelIntents(raw.playerIntents);}catch{return fail('invalid_intents');}}
  if(op==='extract'&&raw.mode!=='normal')return fail('invalid_request');
  if(op==='signature'){
    // Shape only: kind / holder / target rulings are host refusals (signature_unknown, ...), not schema errors.
    if(!id(raw.signature)||!id(raw.holobotId))return fail('invalid_request');
    if(raw.signature==='forecast'?!id(raw.targetSectorId):raw.targetSectorId!==undefined)return fail('invalid_request');
  }
  return structuredClone(raw) as ExpeditionCommand;
}
export function buyExpedition(profile:Record<string,unknown>,item:string,config:ExpeditionConfig):Record<string,unknown>{
  const supplies=expeditionSupplies(profile),holos=count(profile.holosTokens);
  let price=0,updates:Record<string,unknown>={};
  if(item==='item.expedition_energy'){
    if(supplies.energy>=config.energyCapacity)return fail('energy_full');
    price=config.energyPackPrice;supplies.energy=Math.min(config.energyCapacity,supplies.energy+config.energyPackUnits);
  }else if(item==='item.extraction_charge'){
    price=config.extractionChargePrice;if(supplies.extractionCharges>=1_000_000)return fail('stock_full');supplies.extractionCharges++;
  }else if(item==='item.repair_kit'){price=healingItem(item)!.price;updates=healingDelta(profile,item,1);}else return fail('unknown_item');
  if(holos<price)return fail('not_enough_holos');
  return {...updates,holosTokens:holos-price,expeditionSupplies:supplies};
}
/** One entry per enabled KIND present in the pinned squad (catalog bot -> kind). Duplicate holders never add charges. */
export function signaturePool(squad:readonly {holobotId:string}[]):SignaturePool{
  const rules=ZONE_EXPEDITION_RULES.signatures,catalog=rules.catalog as Readonly<Record<string,SignatureKind>>,pool:SignaturePool={};
  for(const kind of SIGNATURE_KINDS){
    if(!(rules.enabled as readonly string[]).includes(kind))continue;
    const holders=squad.map(b=>b.holobotId).filter(id=>Object.hasOwn(catalog,id)&&catalog[id]===kind);
    if(holders.length)pool[kind]={charges:rules.charges[kind],max:rules.charges[kind],holders};
  }
  return pool;
}
export function issueExpedition(profile:Record<string,unknown>,c:ExpeditionCommand,id:string,seed:number,now:number,config:ExpeditionConfig,options:{signatures?:boolean}={}):{run:ExpeditionRun;updates:Record<string,unknown>}{
  const flags=readStoryFlags(profile.storyFlags);
  if(!flags.arenaArcBuilt)return fail('arena_arc_required');
  // The HoloZones portal gate (critic review 2026-10-17 #1): no expedition until the host flips holoZonesArcBuilt.
  if(!flags.holoZonesArcBuilt)return fail('zone_locked');
  const ids=readTravelSquad(profile).holobotIds;if(!ids.length)return fail('squad_required');
  requireLivingVitals(profile,ids);
  const players=buildPlayerCombatants(profile,ids);if(players.length!==ids.length)return fail('unavailable');
  const vitals=issueVitals(profile,players),supplies=expeditionSupplies(profile);
  if(supplies.energy<config.sectorEnergyCost)return fail('no_energy');
  const kits=c.repairKits!,charge=c.carryExtractionCharge?ZONE_EXPEDITION_RULES.extraction.carriedCharges:0;
  if(healingStock(profile,'item.repair_kit')<kits)return fail('no_kit');
  if(supplies.extractionCharges<charge)return fail('no_extraction_charge');
  const squad=players.map(p=>duelFighterFromCombatant({...p,currentHealth:vitals[p.holobotId].currentHealth}));
  const layout=dailyLayout(now),opponents=Object.fromEntries(layout.sectors.filter(s=>!s.safe).map(at=>[at.id,buildThreat(config,at)]));
  const run:ExpeditionRun={schemaVersion:ZONE_RUN_SCHEMA,runId:id,state:'open',issuedAtMs:now,config:structuredClone(config),layout,privateSeed:seed,opponents,
    sectorId:'entry',visited:['entry'],cleared:[],looted:[],squad,energy:supplies.energy,kits,charge,haul:[],guardianDefeated:false,extraction:null,receipt:null,revision:0,
    utilityUsed:[],utilityAtMs:null,
    ...(options.signatures===true?{signaturePool:signaturePool(squad),signatureArmed:null,forecasts:[],slipOpened:[],protectedSlots:ZONE_EXPEDITION_RULES.protectedSlot.count,signatureAtMs:null}:{})};
  return {run,updates:{...healingDelta(profile,'item.repair_kit',-kits),holobotVitals:vitals,expeditionSupplies:{...supplies,extractionCharges:supplies.extractionCharges-charge}}};
}
/** zone-run-3 view: the deployed shape, byte for byte (utility bookkeeping stripped). zone-run-4 view: schemaVersion
 * "zone-run-4" plus utilityUsed. The cooldown anchor and private seed never leave the host. */
export function runView(run:ExpeditionRun,wire:ZoneRunWire=ZONE_RUN_SCHEMA){
  const {privateSeed:_seed,utilityUsed,utilityAtMs:_cooldown,signaturePool:pool,signatureArmed:armed,forecasts,slipOpened,protectedSlots,signatureAtMs:_sig,...view}=run;
  // zone-run-5 = the zone-run-4 view plus the five signature fields (a run issued without signatures shows an empty pool).
  const signatures=wire===ZONE_RUN_SCHEMA_V5?{signaturePool:pool??{},signatureArmed:armed??null,forecasts:forecasts??[],slipOpened:slipOpened??[],
    protectedSlots:protectedSlots??ZONE_EXPEDITION_RULES.protectedSlot.count}:{};
  const shaped=atLeastV4(wire)?{...view,schemaVersion:wire,layout:layoutView(run.layout,wire),utilityUsed,...signatures}:view;
  return structuredClone({...shaped,seed:run.layout.seed,band:sector(run).band,sector:run.sectorId,protectedSlot:run.haul.find(h=>h.protected)??null});
}
/** The host-authored preview line for a sector, from its role in the daily layout table. */
export function sectorGlimpse(at:Sector):string{
  const g=ZONE_EXPEDITION_RULES.layoutCopy.glimpse;
  return at.band===0?g.entry:at.safe?g.gate:at.utility?g[at.utility]:at.guardian?g.guardian:at.rareDiscovery?g.rareDiscovery:g.cache;
}
/** zone-run-3 layout: unchanged. zone-run-4 layout: every sector adds glimpse; band 1-3 sectors add their band's dangerLabel. */
export function layoutView(layout:Layout,wire:ZoneRunWire=ZONE_RUN_SCHEMA):Layout{
  if(!atLeastV4(wire))return structuredClone(layout);
  return {...structuredClone(layout),sectors:layout.sectors.map(s=>({...structuredClone(s),glimpse:sectorGlimpse(s),
    ...(s.band>0?{dangerLabel:ZONE_EXPEDITION_RULES.layoutCopy.dangerLabels[s.band-1]}:{}),
    ...(wire===ZONE_RUN_SCHEMA_V5?{signatureBlocked:signatureBlocked(s)}:{})}))};
}
/** zone-run-5 layout: the ENABLED kinds the host always refuses for this sector (slipstream acting here; forecast
 * targeting here), so the prompt can be honest without Unity inferring rules. Static per layout. */
export function signatureBlocked(at:Sector):SignatureKind[]{
  const enabled=ZONE_EXPEDITION_RULES.signatures.enabled as readonly string[];
  return SIGNATURE_KINDS.filter(k=>enabled.includes(k)&&(k==='forecast'?at.safe:k==='slipstream'?at.safe||at.band>=3||at.guardian:false));
}
/** Reply to a run-advancing operation. A closing reply stays zone-extract-1 with the zone-run-3 run view (that schema
 * references zone-run-3's run); only an open zone-run-4 reply carries utilityResult. */
export function advanceReply(wire:ZoneRunWire,operation:string,run:ExpeditionRun,result:{duelReceipt?:DuelReceipt;interrupted?:boolean;utilityResult?:UtilityResult;signatureResult?:SignatureResult}){
  const closed=run.receipt!==null,v4=atLeastV4(wire)&&!closed;
  return {schemaVersion:closed?ZONE_EXTRACT_SCHEMA:wire,operation,run:runView(run,closed?ZONE_RUN_SCHEMA:wire),receipt:run.receipt,
    ...(result.duelReceipt?{duelReceipt:result.duelReceipt}:{}),...(result.interrupted?{interrupted:true}:{}),
    ...(v4&&result.utilityResult?{utilityResult:structuredClone(result.utilityResult)}:{}),
    ...(wire===ZONE_RUN_SCHEMA_V5&&!closed&&result.signatureResult?{signatureResult:structuredClone(result.signatureResult)}:{}),alreadyProcessed:false};
}
export function readExpedition(raw:unknown):ExpeditionRun{
  if(!object(raw)||raw.schemaVersion!==ZONE_RUN_SCHEMA||typeof raw.runId!=='string'||!['open','closed'].includes(String(raw.state))
    ||!whole(raw.privateSeed,0xffffffff)||!whole(raw.energy)||!whole(raw.kits,99)||!whole(raw.charge,1)||!whole(raw.revision)||!Array.isArray(raw.squad)
    ||!Array.isArray(raw.haul)||!Array.isArray(raw.visited)||!Array.isArray(raw.cleared)||!Array.isArray(raw.looted)||!object(raw.layout))return fail('unavailable');
  expeditionConfig(raw.config);
  const r=raw as unknown as ExpeditionRun;
  if(!whole(r.issuedAtMs,8_640_000_000_000_000)||typeof r.sectorId!=='string'||typeof r.guardianDefeated!=='boolean'
    ||r.squad.length<1||r.squad.length>3||new Set(r.squad.map(b=>b.holobotId)).size!==r.squad.length
    ||r.squad.some(b=>!b||typeof b.holobotId!=='string'||!whole(b.maxHealth)||b.maxHealth<1||typeof b.currentHealth!=='number'||!Number.isFinite(b.currentHealth)||b.currentHealth<0||b.currentHealth>b.maxHealth)
    ||r.haul.length>MAX_HAUL||r.haul.some(h=>!h||typeof h.id!=='string'||!['blueprint_fragment','rare_blueprint_fragment','bulky_salvage'].includes(h.kind)||!whole(h.amount)||h.amount<1||typeof h.protected!=='boolean')
    ||r.haul.filter(h=>h.protected).length>ZONE_EXPEDITION_RULES.protectedSlot.count||new Set(r.haul.map(h=>h.id)).size!==r.haul.length
    ||!Array.isArray(r.layout.sectors)||r.layout.sectors.length!==10||!r.layout.sectors.some(s=>s.id===r.sectorId)||!whole(r.layout.seed,0xffffffff)
    ||typeof r.layout.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.layout.day)||!object(r.opponents)
    ||[r.visited,r.cleared,r.looted].some(a=>a.length>10||new Set(a).size!==a.length||a.some(id=>typeof id!=='string'||!r.layout.sectors.some(s=>s.id===id)))
    ||(r.extraction!==null&&(!object(r.extraction)||!whole(r.extraction.startedAtMs,8_640_000_000_000_000)))
    ||(r.state==='open'?r.receipt!==null:!r.receipt||r.receipt.schemaVersion!==ZONE_EXTRACT_SCHEMA||r.receipt.runId!==r.runId))return fail('unavailable');
  const used=r.utilityUsed??[],at=r.utilityAtMs??null;
  if(!Array.isArray(used)||used.length>10||new Set(used).size!==used.length||used.some(id=>typeof id!=='string'||!r.layout.sectors.some(s=>s.id===id&&s.utility!==null))
    ||(at!==null&&!whole(at,8_640_000_000_000_000))||(used.length>0)!==(at!==null))return fail('unavailable');
  readSignatures(r);
  return structuredClone({...r,utilityUsed:used,utilityAtMs:at});
}
/** zone-run-5 bookkeeping: all six fields together or none (a flag-off run). Malformed = fail closed. */
function readSignatures(r:ExpeditionRun):void{
  const keys=['signaturePool','signatureArmed','forecasts','slipOpened','protectedSlots','signatureAtMs'] as const;
  const present=keys.filter(k=>Object.hasOwn(r,k));
  if(!present.length)return;
  if(present.length!==keys.length)return fail('unavailable');
  const pool=r.signaturePool!,ids=r.squad.map(b=>b.holobotId),sector=(id:unknown)=>typeof id==='string'&&r.layout.sectors.some(s=>s.id===id);
  if(!object(pool)||Object.entries(pool).some(([k,e])=>!(SIGNATURE_KINDS as readonly string[]).includes(k)||!object(e)||!whole(e.max,99)||!whole(e.charges,e.max as number)
    ||!Array.isArray(e.holders)||e.holders.length<1||new Set(e.holders).size!==e.holders.length||e.holders.some(h=>!ids.includes(h))))return fail('unavailable');
  const armed=r.signatureArmed;
  if(armed!==null&&(!object(armed)||!['snare','aegis'].includes(String(armed.kind))||!ids.includes(String(armed.holobotId))))return fail('unavailable');
  if(!Array.isArray(r.forecasts)||r.forecasts.length>10||new Set(r.forecasts.map(f=>f?.sectorId)).size!==r.forecasts.length
    ||r.forecasts.some(f=>!object(f)||!sector(f.sectorId)||!Array.isArray(f.openingIntents)||f.openingIntents.length<1||f.openingIntents.length>ZONE_EXPEDITION_RULES.signatures.forecast.openingIntents
      ||f.openingIntents.some(i=>!['strike','heavy','defend','finisher'].includes(i))||!['clean','bruised','heavy','wipe_risk'].includes(f.projection)))return fail('unavailable');
  if(!Array.isArray(r.slipOpened)||r.slipOpened.length>10||new Set(r.slipOpened).size!==r.slipOpened.length||!r.slipOpened.every(sector))return fail('unavailable');
  if(!whole(r.protectedSlots,2)||r.protectedSlots<1)return fail('unavailable');
  const spentAny=Object.values(pool).some(e=>e!.charges<e!.max);
  if(r.signatureAtMs!==null&&!whole(r.signatureAtMs,8_640_000_000_000_000)||spentAny!==(r.signatureAtMs!==null))return fail('unavailable');
}
function sector(run:ExpeditionRun):Sector {return run.layout.sectors.find(s=>s.id===run.sectorId)??fail('unavailable');}
/** ACE route target, read from the pinned layout: the utility sector's safe neighbor one band deeper (gate{n+1}). */
export function utilityRoute(layout:Layout,at:Sector):string|null{
  return at.neighbors.map(id=>layout.sectors.find(s=>s.id===id)).find(s=>!!s&&s.safe&&s.band===at.band+1)?.id??null;
}
/** The deeper crossing is open without a clear: the ACE route point was spent here, or (zone-run-5) Slipstream was. */
function routeOpened(run:ExpeditionRun,at:Sector,next:Sector):boolean{
  const viaPoint=!!at.utility&&ZONE_EXPEDITION_RULES.utility.effects[at.utility]==='route'&&run.utilityUsed.includes(at.id);
  return (viaPoint||(run.slipOpened??[]).includes(at.id))&&utilityRoute(run.layout,at)===next.id;
}
/** Host-only resolution. Effect comes from the rules table for the layout's utility; loot from the run's private seed.
 * Nothing to do (route already open, barrier already down, haul full) = effect "none": not spent, no cooldown. */
function resolveUtility(run:ExpeditionRun,at:Sector,now:number):UtilityResult{
  const utility=at.utility!,effect=ZONE_EXPEDITION_RULES.utility.effects[utility];
  let opensSectorId:string|null=null,haul:Haul[]=[],applied=false;
  // Starter per-point choice (DECISIONS #72.75 (2)): Slipstream already taken here = this point has nothing to do.
  if((run.slipOpened??[]).includes(at.id)){}
  else if(effect==='route'){opensSectorId=utilityRoute(run.layout,at);applied=opensSectorId!==null&&!run.cleared.includes(at.id);if(!applied)opensSectorId=null;}
  else if(effect==='cache'){
    if(run.haul.length<MAX_HAUL){
      const rare=seed32(`${run.privateSeed}:utility:${at.id}`)%10000<run.config.rareBlueprintChanceBasisPoints;
      haul=[{id:`${at.id}_utility`,kind:rare?'rare_blueprint_fragment':'blueprint_fragment',amount:run.config.cacheFragments,protected:false}];
      run.haul.push(...structuredClone(haul));applied=true;
    }
  }else if(effect==='clear'){if(!run.cleared.includes(at.id)){run.cleared.push(at.id);applied=true;}}
  if(!applied)return {sectorId:at.id,utility,effect:'none',opensSectorId:null,haul:[],spent:false,cooldownMs:null};
  run.utilityUsed.push(at.id);run.utilityAtMs=now;
  return {sectorId:at.id,utility,effect,opensSectorId,haul,spent:true,cooldownMs:UTILITY_COOLDOWN_MS>0?UTILITY_COOLDOWN_MS:null};
}
/** The fight's seed and inputs exactly as `case 'fight'` builds them: the forecast replays THE fight, not a lookalike. */
function fightSeed(run:ExpeditionRun,at:Sector):number{return seed32(`${run.privateSeed}:fight:${at.id}`);}
function fightSquad(run:ExpeditionRun):DuelFighterStats[]{return run.squad.map(b=>({...b,currentHealth:Math.floor(b.currentHealth??b.maxHealth)}));}
/** FORECAST read (host only). The host resolves the target's fight against the squad's CURRENT HP with the fixed
 * reference plan (explicit intents), then reports the threat's opening actions and a bucket. With explicit player
 * intents the threat's intents depend only on its own stamina/sync and the seeded stream, never on the player's
 * choices, so openingIntents are exact for the real fight for every round that fight reaches. A projection that ends
 * sooner than 3 rounds shows fewer. Resolver-fight form: when expedition fights move to the input-log core (DECISIONS
 * #72.75 (4)) this helper swaps to the CPU-vs-CPU replay with the same wire fields. */
export function forecastSector(run:ExpeditionRun,target:Sector):Forecast{
  const rules=ZONE_EXPEDITION_RULES.signatures.forecast,squad=fightSquad(run);
  const receipt=resolveDuel({seed:fightSeed(run,target),player:squad,opponent:[threat(run,target)],playerIntents:[...rules.referencePlan]});
  const openingIntents=receipt.rounds.filter(r=>r.side==='opponent').slice(0,rules.openingIntents).map(r=>r.requested);
  const now=squad.reduce((n,b)=>n+(b.currentHealth??b.maxHealth),0),after=receipt.playerFinal.reduce((n,b)=>n+b.currentHealth,0);
  const left=now>0?after/now:0;
  const projection:ForecastProjection=receipt.winner!=='player'?'wipe_risk':left>=rules.bands.clean?'clean':left>=rules.bands.bruised?'bruised':'heavy';
  return {sectorId:target.id,openingIntents,projection};
}
/** zone-run-5 signature use. Refusal order: signature_unknown, signature_not_in_squad, signature_not_here /
 * forecast_not_ahead, signature_no_charge, signature_cooling. Then nothing-to-do = effect "none": not spent, no cooldown. */
function resolveSignature(run:ExpeditionRun,at:Sector,c:ExpeditionCommand,now:number):SignatureResult{
  const rules=ZONE_EXPEDITION_RULES.signatures;
  if(!(rules.enabled as readonly string[]).includes(String(c.signature)))return fail('signature_unknown');
  const kind=c.signature as SignatureKind,entry=run.signaturePool?.[kind],bot=run.squad.find(b=>b.holobotId===c.holobotId);
  // Living holder of that kind, pinned at issue. A KO'd holder cannot act; the charges wait for a living one.
  if(!entry||!bot||!entry.holders.includes(bot.holobotId)||(bot.currentHealth??bot.maxHealth)<=0)return fail('signature_not_in_squad');
  let target:Sector=at;
  if(kind==='slipstream'){
    // Uncleared ordinary band-1/2 encounter only: never a safe room, band 3 (no deeper gate) or the guardian.
    if(at.safe||at.band<1||at.band>=3||at.guardian||run.cleared.includes(at.id)||utilityRoute(run.layout,at)===null)return fail('signature_not_here');
  }else{
    const next=run.layout.sectors.find(s=>s.id===c.targetSectorId);
    // ZoneLayout.Ahead semantics: a neighbour that is deeper, or the unsafe side of the current safe room's band.
    if(!next||next.safe||!at.neighbors.includes(next.id)||!(next.band>at.band||next.band===at.band&&at.safe))return fail('forecast_not_ahead');
    target=next;
  }
  if(entry.charges<1)return fail('signature_no_charge');
  if(run.signatureAtMs!==null&&run.signatureAtMs!==undefined){const retryAfterMs=run.signatureAtMs+SIGNATURE_COOLDOWN_MS-now;if(retryAfterMs>0)throw new ExpeditionError('signature_cooling',{retryAfterMs});}
  const none=(forecast:Forecast|null=null):SignatureResult=>({signature:kind,holobotId:bot.holobotId,sectorId:target.id,effect:'none',spent:false,chargesLeft:entry.charges,
    cooldownMs:null,opensSectorId:null,forecast:forecast?structuredClone(forecast):null,protectedSlots:null});
  let result:SignatureResult;
  if(kind==='slipstream'){
    // Per-point starter choice: this sector's utility point was taken (or it was already slipped) = nothing to do.
    if(run.slipOpened!.includes(at.id)||!!at.utility&&run.utilityUsed.includes(at.id))return none();
    run.slipOpened!.push(at.id);
    result={...none(),effect:'route',opensSectorId:utilityRoute(run.layout,at)};
  }else{
    const known=run.forecasts!.find(f=>f.sectorId===target.id);
    if(known||run.cleared.includes(target.id))return none(known??null);
    const forecast=forecastSector(run,target);run.forecasts!.push(forecast);
    result={...none(),effect:'forecast',forecast:structuredClone(forecast)};
  }
  entry.charges--;run.signatureAtMs=now;
  return {...result,spent:true,chargesLeft:entry.charges,cooldownMs:SIGNATURE_COOLDOWN_MS>0?SIGNATURE_COOLDOWN_MS:null};
}
function buildThreat(config:ExpeditionConfig,at:Sector):DuelFighterStats{
  const level=config.bandLevels[Math.max(0,at.band-1)];
  // Existing WOLF curve/commands only. The parked 13th bot is never fabricated or granted.
  return duelFighterFromCombatant({...playerCombatant('wolf',{name:'WOLF',level}),tier:at.band-1,holobotId:at.guardian?'zell_guardian_placeholder':'neon_beast'});
}
export function threat(run:ExpeditionRun,at:Sector):DuelFighterStats{return structuredClone(run.opponents[at.id]??fail('unavailable'));}
function vitalsOf(run:ExpeditionRun):Vitals{return Object.fromEntries(run.squad.map(b=>[b.holobotId,{currentHealth:b.currentHealth??b.maxHealth,maxHealth:b.maxHealth}]));}
function terminal(profile:Record<string,unknown>,run:ExpeditionRun,outcome:ExtractionReceipt['outcome'],now:number):Record<string,unknown>{
  const banked=run.haul.filter(h=>outcome==='normal'||outcome==='emergency'&&h.kind!=='bulky_salvage'||outcome==='wipe'&&h.protected);
  const lost=run.haul.filter(h=>!banked.includes(h));
  if(outcome==='wipe')run.squad=run.squad.map(b=>({...b,currentHealth:0}));
  const stocks=profile.itemStocks??{};if(!object(stocks))return fail('unavailable');
  const fragments=banked.filter(h=>h.kind==='blueprint_fragment'||h.kind==='rare_blueprint_fragment').reduce((n,h)=>n+h.amount,0);
  const bank=profile.expeditionBank??{};if(!object(bank))return fail('unavailable');
  const updates=healingDelta(profile,'item.repair_kit',run.kits),supplies=expeditionSupplies(profile),vitals=vitalsOf(run);
  run.state='closed';run.extraction=null;run.receipt={schemaVersion:ZONE_EXTRACT_SCHEMA,runId:run.runId,outcome,closedAtMs:now,banked,lost,guardianDefeated:run.guardianDefeated,finalVitals:vitals};
  return {...updates,itemStocks:{...(updates.itemStocks as Record<string,unknown>??stocks),blueprint_fragment:count(stocks.blueprint_fragment)+fragments},
    expeditionSupplies:{energy:run.energy,extractionCharges:supplies.extractionCharges+run.charge},holobotVitals:{...(profile.holobotVitals as Vitals??{}),...vitals},
    expeditionBank:{...bank,rareBlueprints:count(bank.rareBlueprints)+banked.filter(h=>h.kind==='rare_blueprint_fragment').reduce((n,h)=>n+h.amount,0),
      bulkySalvage:count(bank.bulkySalvage)+banked.filter(h=>h.kind==='bulky_salvage').reduce((n,h)=>n+h.amount,0),guardianDefeated:bank.guardianDefeated===true||run.guardianDefeated}};
}
export function advanceExpedition(profile:Record<string,unknown>,original:ExpeditionRun,c:ExpeditionCommand,now:number):{run:ExpeditionRun;updates:Record<string,unknown>;duelReceipt?:DuelReceipt;interrupted?:boolean;utilityResult?:UtilityResult;signatureResult?:SignatureResult}{
  const run=structuredClone(original);if(run.state!=='open')return fail('run_closed');
  if(now<run.issuedAtMs)return fail('invalid_request');
  const at=sector(run);let duelReceipt:DuelReceipt|undefined,interrupted=false,updates:Record<string,unknown>={},utilityResult:UtilityResult|undefined,signatureResult:SignatureResult|undefined;
  const terminalOp=(outcome:ExtractionReceipt['outcome'])=>{updates=terminal(profile,run,outcome,now);};
  if(run.extraction&&!['fight','emergency_finish','wipe'].includes(c.operation))return fail('extraction_in_progress');
  switch(c.operation){
    case 'move': {
      const next=run.layout.sectors.find(s=>s.id===c.sectorId);if(!next||!at.neighbors.includes(next.id))return fail('invalid_route');
      const deeper=next.band>at.band||at.safe&&!next.safe;
      if(deeper&&run.energy<run.config.sectorEnergyCost)return fail('no_energy');
      if(!at.safe&&!run.cleared.includes(at.id)&&next.band>at.band&&!routeOpened(run,at,next))return fail('sector_not_cleared');
      run.energy=Math.max(0,run.energy-run.config.sectorEnergyCost);run.sectorId=next.id;
      if(!run.visited.includes(next.id))run.visited.push(next.id);break;
    }
    case 'fight': {
      if(at.safe)return fail('safe_room');if(run.cleared.includes(at.id))return fail('already_cleared');
      // Slipstream forfeits the encounter AND its cache: the slipped sector never fights (so it can never be looted).
      if((run.slipOpened??[]).includes(at.id))return fail('sector_slipped');
      const intents=validateDuelIntents(c.playerIntents);
      run.energy=Math.max(0,run.energy-run.config.fightEnergyCost); // Zero never disables an already-entered fight.
      duelReceipt=resolveDuel({seed:fightSeed(run,at),player:fightSquad(run),opponent:[threat(run,at)],playerIntents:intents});
      run.squad=run.squad.map(b=>({...b,currentHealth:duelReceipt!.playerFinal.find(f=>f.holobotId===b.holobotId)!.currentHealth}));
      if(run.extraction&&duelReceipt.rounds.some(r=>r.side==='opponent'&&r.hit&&r.damage>0)){run.extraction=null;interrupted=true;}
      if(duelReceipt.winner==='opponent')terminalOp('wipe');else {run.cleared.push(at.id);if(at.guardian)run.guardianDefeated=true;}break;
    }
    case 'cache': {
      if(!at.cache)return fail('no_cache');if(!run.cleared.includes(at.id))return fail('sector_not_cleared');if(run.looted.includes(at.id))return fail('already_looted');
      run.looted.push(at.id);run.haul.push({id:`${at.id}_fragments`,kind:'blueprint_fragment',amount:run.config.cacheFragments,protected:false},
        {id:`${at.id}_salvage`,kind:'bulky_salvage',amount:run.config.bulkySalvageUnits,protected:false});
      if(at.rareDiscovery&&seed32(`${run.privateSeed}:loot:${at.id}`)%10000<run.config.rareBlueprintChanceBasisPoints)
        run.haul.push({id:`${at.id}_discovery`,kind:'rare_blueprint_fragment',amount:run.config.cacheFragments,protected:false});break;
    }
    case 'protect': {if(!run.haul.some(h=>h.id===c.haulId))return fail('unknown_haul');run.haul=run.haul.map(h=>({...h,protected:h.id===c.haulId}));break;}
    case 'heal': {
      if(!at.safe)return fail('safe_room_required');if(!run.kits)return fail('no_kit');const bot=run.squad.find(b=>b.holobotId===c.holobotId);if(!bot)return fail('not_in_squad');
      if((bot.currentHealth??bot.maxHealth)>=bot.maxHealth)return fail('already_full');run.kits--;bot.currentHealth=Math.min(bot.maxHealth,(bot.currentHealth??bot.maxHealth)+bot.maxHealth*healingItem('item.repair_kit')!.fraction);break;
    }
    case 'reorder': {if(!at.safe)return fail('safe_room_required');if(c.order!.length!==run.squad.length||c.order!.some(id=>!run.squad.some(b=>b.holobotId===id)))return fail('not_in_squad');run.squad=c.order!.map(id=>run.squad.find(b=>b.holobotId===id)!);break;}
    case 'utility': {
      if(!at.utility||at.utility!==c.utility)return fail('no_utility');if(!run.squad.some(b=>b.holobotId===c.utility&&(b.currentHealth??b.maxHealth)>0))return fail('companion_required');
      if(run.utilityUsed.includes(at.id))return fail('utility_spent');
      if(run.utilityAtMs!==null){const retryAfterMs=run.utilityAtMs+UTILITY_COOLDOWN_MS-now;if(retryAfterMs>0)throw new ExpeditionError('utility_cooling',{retryAfterMs});}
      utilityResult=resolveUtility(run,at,now);break;
    }
    case 'signature': signatureResult=resolveSignature(run,at,c,now);break;
    case 'extract': if(!at.beacon)return fail('beacon_required');terminalOp('normal');break;
    // Resolver fights settle atomically: uncleared host encounter is the conservative open-fight gate.
    // Refuse before spending a charge; no live mid-fight escape lifecycle is introduced.
    case 'emergency_start': if(!at.safe&&!run.cleared.includes(at.id))return fail('encounter_pending');if(!run.charge)return fail('no_extraction_charge');run.charge--;run.extraction={startedAtMs:now};break;
    case 'emergency_finish': {
      if(!run.extraction)return fail('extraction_not_started');const retryAfterMs=run.extraction.startedAtMs+EXTRACTION_CHANNEL_MS-now;
      if(retryAfterMs>0)throw new ExpeditionError('extraction_channeling',{retryAfterMs});terminalOp('emergency');break;
    }
    case 'wipe': terminalOp('wipe');break;
    default:return fail('invalid_request');
  }
  run.revision++;
  if(run.state==='open')updates={expeditionSupplies:{...expeditionSupplies(profile),energy:run.energy},holobotVitals:{...(profile.holobotVitals as Vitals??{}),...vitalsOf(run)}};
  return {run,updates,...(duelReceipt?{duelReceipt}:{}),...(interrupted?{interrupted:true}:{}),...(utilityResult?{utilityResult}:{}),...(signatureResult?{signatureResult}:{})};
}
