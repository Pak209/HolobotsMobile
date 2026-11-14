/** Persisted health at the existing client-observed rival settlement boundary.
 * Clients report remaining display health, never healing. This is NOT a replay/anti-cheat service.
 * Authenticated issue snapshots + server-owned downward-only ledger bound every report.
 */
export const RIVAL_HEALTH_SCHEMA='rival-health-1';
export type HealthRow={holobotId:string;currentHealth:number};
export type Vitals=Record<string,{currentHealth:number;maxHealth:number}>;
import {effectiveRow,fightReady,koRefusalDetail,readyAtMs,VitalsRow} from "./autoHeal";
/** `detail` (holobot_ko only, ko-return-25): koRefusalDetail, carried into the callable error's details. */
export class HealthError extends Error{constructor(message:string,public readonly detail?:Record<string,unknown>){super(message);}}
/** DECISIONS #72.1: any item heal on a bot below this fraction starts FROM it (lib/repairItems.ts repairUse). Until
 * ko-return-25 it was also the HP a KO'd bot entered its next rival duel with; that issue-time floor is gone: a bot under
 * KO_RETURN_FRACTION (25 %) is refused admission instead (requireLivingVitals), so the floor could never apply. */
export const KO_FALLBACK_FRACTION=0.4;
export function healthRows(raw:unknown):HealthRow[]|undefined{
 if(raw===undefined)return undefined;
 if(!Array.isArray(raw)||raw.length>3)throw new HealthError('invalid_request');
 const ids=new Set<string>();return raw.map(r=>{if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['holobotId','currentHealth'].includes(k))||typeof r.holobotId!=='string'||ids.has(r.holobotId)||typeof r.currentHealth!=='number'||!Number.isFinite(r.currentHealth)||r.currentHealth<0)throw new HealthError('invalid_request');ids.add(r.holobotId);return {holobotId:r.holobotId,currentHealth:r.currentHealth};});
}
/** The validated ledger as stored (rows may carry auto-heal-1's hpUpdatedAt, a finite server ms). */
function storedLedger(profile:Record<string,unknown>):Record<string,VitalsRow>{
 const raw=profile.holobotVitals;if(raw===undefined)return {};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HealthError('unavailable');
 const out:Record<string,VitalsRow>={};for(const [id,v]of Object.entries(raw)){const x=v as VitalsRow;if(!x||typeof x.currentHealth!=='number'||!Number.isFinite(x.currentHealth)||typeof x.maxHealth!=='number'||!Number.isFinite(x.maxHealth)||x.maxHealth<=0||x.currentHealth<0||x.currentHealth>x.maxHealth||(x.hpUpdatedAt!==undefined&&(typeof x.hpUpdatedAt!=='number'||!Number.isFinite(x.hpUpdatedAt))))throw new HealthError('unavailable');out[id]={...x};}return out;
}
/** auto-heal-1: every gameplay read sees the EFFECTIVE HP at the server's `nowMs` (lib/autoHeal.ts), as plain rows. */
function ledger(profile:Record<string,unknown>,nowMs:number):Vitals{
 const out:Vitals={};for(const [id,x]of Object.entries(storedLedger(profile)))out[id]=effectiveRow(x,nowMs);return out;
}
/** Fight admission (rival, Arena, Guild Court, expedition) reads the validated authoritative ledger; missing entries are
 * fresh. ko-return-25 (Pak 2026-11-12): every named bot needs EFFECTIVE HP >= 25 % of max (lib/autoHeal.ts fightReady);
 * otherwise holobot_ko with koRefusalDetail for the bot that is ready last (readyAtMs / readyInMs / fullAtMs / message).
 * An empty list only validates the ledger. */
export function requireLivingVitals(profile:Record<string,unknown>,holobotIds:readonly string[],nowMs:number):void{
 const stored=storedLedger(profile);let worst:{id:string;at:number}|null=null;
 for(const id of holobotIds){const row=stored[id];if(!row||fightReady(row,nowMs))continue;const at=readyAtMs(row,nowMs)!;if(!worst||at>worst.at)worst={id,at};}
 if(worst)throw new HealthError('holobot_ko',koRefusalDetail(worst.id,stored[worst.id],nowMs));
}
/** active-lead-ko-1 (QA retest 2026-11-12): the squad a City rival duel fields. The lead (slot 1, the active Holobot) always
 * stays, so a KO'd lead is still refused by requireLivingVitals; a squad mate under KO_RETURN_FRACTION sits the duel out
 * instead of blocking it. Missing ledger rows are fresh. */
export function fightReadySquad(profile:Record<string,unknown>,holobotIds:readonly string[],nowMs:number):string[]{
 if(holobotIds.length<2)return [...holobotIds];
 const stored=storedLedger(profile);
 return holobotIds.filter((id,i)=>i===0||!stored[id]||fightReady(stored[id],nowMs));
}
/** The issue-time ledger (plain effective rows; the caller writes it through lib/autoHeal.ts commitVitals). Callers gate
 * admission first (requireLivingVitals), so every fielded bot carries at least 25 % of max: there is no KO floor here. */
export function issueVitals(profile:Record<string,unknown>,players:{holobotId:string;maxHealth:number}[],nowMs:number){
 const next=ledger(profile,nowMs);for(const p of players){if(!Number.isFinite(p.maxHealth)||p.maxHealth<=0)throw new HealthError('unavailable');const old=next[p.holobotId];let hp=old?Math.min(old.currentHealth,p.maxHealth):p.maxHealth;
 next[p.holobotId]={currentHealth:hp,maxHealth:p.maxHealth};}return next;
}
/** The settled ledger (plain effective rows; the caller writes it through lib/autoHeal.ts commitVitals). */
export function settleVitals(profile:Record<string,unknown>,issued:Vitals,rows:HealthRow[],nowMs:number):Vitals{
 const next=ledger(profile,nowMs);for(const r of rows){const start=issued[r.holobotId],current=next[r.holobotId];if(!start||!current||r.currentHealth>start.currentHealth)throw new HealthError('invalid_request');next[r.holobotId]={...current,currentHealth:Math.min(current.currentHealth,r.currentHealth)};}return next;
}
