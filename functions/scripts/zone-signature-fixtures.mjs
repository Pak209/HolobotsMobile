// zone-run-5 signature pilot test helpers. TEST-ONLY squads/tuning; nothing here is production data.
import {createRequire} from 'node:module';
import {T,CONFIG,profile} from './zone-expedition-fixtures.mjs';
const require=createRequire(import.meta.url),Z=require('../lib/holozone/expedition.js');
/** A squad of the given bot ids at one level (the pilot kinds: wolf/era/tsuin forecast, ace/hare/shadow slipstream). */
export const squadProfile=(ids,level=1,extra={})=>profile({holobots:ids.map(id=>({name:id.toUpperCase(),level})),travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:ids},...extra});
export function signatureState(ids=['ace','wolf','hare'],{level=1,seed=1,signatures=true}={}){
  const p=squadProfile(ids,level),r=Z.issueExpedition(p,{repairKits:2,carryExtractionCharge:true},'sig_run',seed,T,CONFIG,{signatures});
  return {p:{...p,...r.updates},r:r.run};
}
export function step(s,operation,fields={},now=T){const x=Z.advanceExpedition(s.p,s.r,{operation,...fields},now);s.r=x.run;s.p={...s.p,...x.updates};return x;}
export const code=(s,op,f={},now=T)=>{try{step(s,op,f,now);return null;}catch(e){if(!e.code)throw e;return e.code;}};
export const utilityAt=(s,band)=>s.r.layout.sectors.find(x=>x.band===band&&x.utility);
export const cacheAt=(s,band)=>s.r.layout.sectors.find(x=>x.band===band&&x.cache);
export {T,CONFIG};
