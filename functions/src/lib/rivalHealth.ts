/** Persisted health at the existing client-observed rival settlement boundary.
 * Clients report remaining display health, never healing. This is NOT a replay/anti-cheat service.
 * Authenticated issue snapshots + server-owned downward-only ledger bound every report.
 */
export const RIVAL_HEALTH_SCHEMA='rival-health-1';
export type HealthRow={holobotId:string;currentHealth:number};
export type Vitals=Record<string,{currentHealth:number;maxHealth:number}>;
export class HealthError extends Error{}
export function healthRows(raw:unknown):HealthRow[]|undefined{
 if(raw===undefined)return undefined;
 if(!Array.isArray(raw)||raw.length>3)throw new HealthError('invalid_request');
 const ids=new Set<string>();return raw.map(r=>{if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['holobotId','currentHealth'].includes(k))||typeof r.holobotId!=='string'||ids.has(r.holobotId)||typeof r.currentHealth!=='number'||!Number.isFinite(r.currentHealth)||r.currentHealth<0)throw new HealthError('invalid_request');ids.add(r.holobotId);return {holobotId:r.holobotId,currentHealth:r.currentHealth};});
}
function ledger(profile:Record<string,unknown>):Vitals{
 const raw=profile.holobotVitals;if(raw===undefined)return {};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HealthError('unavailable');
 const out:Vitals={};for(const [id,v]of Object.entries(raw)){const x=v as Vitals[string];if(!x||typeof x.currentHealth!=='number'||!Number.isFinite(x.currentHealth)||typeof x.maxHealth!=='number'||!Number.isFinite(x.maxHealth)||x.maxHealth<=0||x.currentHealth<0||x.currentHealth>x.maxHealth)throw new HealthError('unavailable');out[id]={...x};}return out;
}
export function issueVitals(profile:Record<string,unknown>,players:{holobotId:string;maxHealth:number}[]){
 const next=ledger(profile);for(const p of players){if(!Number.isFinite(p.maxHealth)||p.maxHealth<=0)throw new HealthError('unavailable');const old=next[p.holobotId];let hp=old?Math.min(old.currentHealth,p.maxHealth):p.maxHealth;
 // Pak: recovery at zero is host-owned. Retain the existing forty-percent recovery as host policy.
 if(hp===0)hp=p.maxHealth*.4;next[p.holobotId]={currentHealth:hp,maxHealth:p.maxHealth};}return next;
}
export function settleVitals(profile:Record<string,unknown>,issued:Vitals,rows:HealthRow[]):Vitals{
 const next=ledger(profile);for(const r of rows){const start=issued[r.holobotId],current=next[r.holobotId];if(!start||!current||r.currentHealth>start.currentHealth)throw new HealthError('invalid_request');next[r.holobotId]={...current,currentHealth:Math.min(current.currentHealth,r.currentHealth)};}return next;
}
