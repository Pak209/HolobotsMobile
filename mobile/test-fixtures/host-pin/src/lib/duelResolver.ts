import { desktopPracticeCommands } from './desktopPracticeCommands';

/** Host combat policy v1. No clock, database, client damage, or ambient randomness. */
export const DUEL_RECEIPT_SCHEMA = 'duel-receipt-1';
export const DUEL_MAX_ROUNDS = 120;
export const DUEL_RULES = Object.freeze({ strikeCost: 1, heavyCost: 2, finisherCost: 4,
  defendRestore: 2, guardReduction: 0.5, strikeSync: 10, heavySync: 14, defendSync: 6,
  finisherSync: 100, strikeScale: 1, heavyScale: 1.55, finisherScale: 2,
  defenseScale: 0.5, varianceMin: 0.9, varianceRange: 0.2 });
export type DuelIntent = 'strike' | 'heavy' | 'defend' | 'finisher';
export type DuelMove = { moveId: string; staminaCost: number; damageScale: number; syncGain: number;
  syncCost: number; staminaRestore: number; guardReduction: number; source: 'issued-move'|'host-policy-fallback'|'derived-host-heavy' };
export type DuelFighterStats = { holobotId: string; level: number; tier: number; maxHealth: number; currentHealth?: number;
  attack: number; defense: number; speed: number; maxStamina: number; staminaRegen: number;
  moveset: Record<DuelIntent,DuelMove> };
export type DuelFighterState = { holobotId: string; currentHealth: number; maxHealth: number;
  stamina: number; maxStamina: number; sync: number };
export type DuelAction = { holobotId: string; requested: DuelIntent; action: DuelIntent | 'wait';
  refusal?: 'insufficient_stamina' | 'sync_not_ready'; damage: number; currentHealth: number; stamina: number; sync: number };
export type DuelRound = { round: number; side: 'player'|'opponent'; attacker: string; defender: string;
  move: DuelIntent|'wait'; moveId: string; requested: DuelIntent; hit: boolean; damage: number;
  defenderHpAfter: number; staAfter: number; syncAfter: number; refusal?: DuelAction['refusal']|'knocked_out' };
export type DuelInput = { seed: number; player: readonly DuelFighterStats[]; opponent: readonly DuelFighterStats[];
  /** Omit only at a trusted server seam for CPU-vs-CPU. Public hosts must require explicit intents. */
  playerIntents?: readonly DuelIntent[] };
export type DuelReceipt = { schemaVersion: typeof DUEL_RECEIPT_SCHEMA; seed: number;
  winner: 'player' | 'opponent'; reason: 'knockout' | 'round_limit'; rounds: DuelRound[];
  playerFinal: DuelFighterState[]; opponentFinal: DuelFighterState[] };

export function validateDuelIntents(raw: unknown): DuelIntent[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > DUEL_MAX_ROUNDS
    || raw.some(x => !['strike','heavy','defend','finisher'].includes(x))) throw new RangeError('invalid_intents');
  return [...raw] as DuelIntent[];
}

/** Pin issued named move scales (including tier tuning) and host command costs.
 * Missing legacy move names use explicit versioned fallback rows; no client definitions are accepted.
 */
export function duelFighterFromCombatant(c: { holobotId: string; level?:number; tier?:number; maxHealth: number; currentHealth?: number;
  attack: number; defense: number; speed?: number; moves?:readonly {moveId:string;staminaCost:number;damageScale:number}[];
  commandRules?:ReturnType<typeof desktopPracticeCommands> }): DuelFighterStats {
  const commands = c.commandRules ?? desktopPracticeCommands(c.holobotId);
  const named=(names:string[])=>c.moves?.find(m=>names.includes(m.moveId));
  const strike=named(['strike','gap_closer']),heavy=named(['heavy','break_heavy']),finisher=named(['finisher','full_finisher']);
  const move=(id:string,issued:typeof strike,cost:number,scale:number,gain:number,syncCost=0):DuelMove=>({
    moveId:issued?.moveId??id,staminaCost:cost,damageScale:issued?.damageScale??scale,syncGain:gain,syncCost,
    staminaRestore:0,guardReduction:0,source:issued?'issued-move':'host-policy-fallback'});
  const moveset:Record<DuelIntent,DuelMove>={
    strike:move('fallback_strike',strike,commands.strikeCost,DUEL_RULES.strikeScale,commands.strikeSync),
    heavy:move('fallback_heavy',heavy,commands.comboCost,DUEL_RULES.heavyScale,commands.comboSync),
    finisher:move('derived_finisher',finisher,commands.fullCost,(heavy?.damageScale??DUEL_RULES.heavyScale)*DUEL_RULES.finisherScale,0,commands.fullSync),
    defend:{moveId:'defend',staminaCost:0,damageScale:0,syncGain:commands.guardSync,syncCost:0,
      staminaRestore:commands.defendRestore,guardReduction:commands.guardReduction,source:'host-policy-fallback'},
  };
  if(!finisher)moveset.finisher.source='derived-host-heavy';
  return { holobotId: c.holobotId, level:c.level??1,tier:c.tier??0,maxHealth: Math.round(c.maxHealth),
    ...(c.currentHealth === undefined ? {} : { currentHealth: Math.floor(c.currentHealth) }),
    attack: Math.round(c.attack), defense: Math.round(c.defense), speed: Math.round(c.speed ?? 0),
    maxStamina: commands.maxStamina, staminaRegen: commands.staminaRegen,moveset };
}

function validTeam(team: readonly DuelFighterStats[]): void {
  if (!Array.isArray(team) || team.length < 1 || team.length > 3) throw new RangeError('invalid_team');
  const ids = new Set<string>();
  for (const c of team) {
    if (!c || typeof c.holobotId !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(c.holobotId)
      || ids.has(c.holobotId)) throw new RangeError('invalid_fighter');
    ids.add(c.holobotId);
    if(!Number.isSafeInteger(c.level)||c.level<1||c.level>99||!Number.isSafeInteger(c.tier)||c.tier<0||c.tier>1000000)throw new RangeError('invalid_level_tier');
    for(const intent of ['strike','heavy','defend','finisher'] as const){
      const m=c.moveset?.[intent];if(!m||typeof m.moveId!=='string'||m.moveId.length>128)throw new RangeError('invalid_moveset');
      for(const key of ['staminaCost','damageScale','syncGain','syncCost','staminaRestore','guardReduction'] as const)
        if(!Number.isFinite(m[key])||m[key]<0||m[key]>(key==='guardReduction'?1:key==='damageScale'?100:1000))throw new RangeError('invalid_moveset');
    }
    for (const key of ['maxHealth','attack','defense','speed'] as const)
      if (!Number.isSafeInteger(c[key]) || c[key] < (key === 'maxHealth' ? 1 : 0) || c[key] > 1_000_000) throw new RangeError('invalid_stats');
    if (c.currentHealth !== undefined && (!Number.isSafeInteger(c.currentHealth) || c.currentHealth < 0 || c.currentHealth > c.maxHealth)) throw new RangeError('invalid_health');
    if (!Number.isFinite(c.maxStamina) || c.maxStamina <= 0 || c.maxStamina > 1000
      || !Number.isFinite(c.staminaRegen) || c.staminaRegen < 0 || c.staminaRegen > c.maxStamina) throw new RangeError('invalid_stamina');
  }
  if (!team.some(c => (c.currentHealth ?? c.maxHealth) > 0)) throw new RangeError('team_knocked_out');
}

/** Mulberry32: explicit unsigned-32 state, identical under transaction retries and receipt replay. */
function randomFromSeed(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function initial(c: DuelFighterStats): DuelFighterState {
  return { holobotId: c.holobotId, currentHealth: c.currentHealth ?? c.maxHealth, maxHealth: c.maxHealth,
    stamina: c.maxStamina, maxStamina: c.maxStamina, sync: 0 };
}
function cpuIntent(s: DuelFighterState, stats: DuelFighterStats, draw: number): DuelIntent {
  if (s.stamina < stats.moveset.strike.staminaCost) return 'defend';
  if (s.sync >= stats.moveset.finisher.syncCost && s.stamina >= stats.moveset.finisher.staminaCost) return 'finisher';
  if (draw < 0.2 || (s.stamina < stats.moveset.heavy.staminaCost && draw < 0.6)) return 'defend';
  return draw < 0.6 && s.stamina >= stats.moveset.heavy.staminaCost ? 'heavy' : 'strike';
}
function prepare(s: DuelFighterState, stats:DuelFighterStats, requested: DuelIntent): DuelAction {
  const row: DuelAction = { holobotId: s.holobotId, requested, action: requested, damage: 0,
    currentHealth: s.currentHealth, stamina: s.stamina, sync: s.sync };
  const move=stats.moveset[requested],cost=move.staminaCost;
  if (s.stamina < cost) { row.action = 'wait'; row.refusal = 'insufficient_stamina'; }
  else if (s.sync < move.syncCost) { row.action = 'wait'; row.refusal = 'sync_not_ready'; }
  else if (requested === 'defend') {
    s.stamina = Math.min(s.maxStamina, s.stamina + move.staminaRestore);
    s.sync = Math.min(100, s.sync + move.syncGain);
  } else {
    s.stamina -= cost;
    s.sync = Math.min(100, s.sync - move.syncCost + move.syncGain);
  }
  return row;
}
function strike(actor: DuelFighterState, target: DuelFighterState, stats: DuelFighterStats,
  targetStats: DuelFighterStats, action: DuelAction, defense: DuelAction, variance: number): void {
  if (actor.currentHealth <= 0 || action.action === 'wait' || action.action === 'defend') return;
  const scale = stats.moveset[action.action].damageScale;
  const damage = Math.max(1, Math.floor((stats.attack * scale * variance - targetStats.defense * DUEL_RULES.defenseScale)
    * (defense.action === 'defend' ? 1 - targetStats.moveset.defend.guardReduction : 1)));
  action.damage = Math.min(target.currentHealth, damage);
  target.currentHealth -= action.damage;
}

export function resolveDuel(input: DuelInput): DuelReceipt {
  if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) throw new RangeError('invalid_seed');
  validTeam(input.player); validTeam(input.opponent);
  const intents = input.playerIntents === undefined ? undefined : validateDuelIntents(input.playerIntents);
  const random = randomFromSeed(input.seed), player = input.player.map(initial), opponent = input.opponent.map(initial);
  const rounds: DuelRound[] = [];
  for (let r = 0; r < DUEL_MAX_ROUNDS; r++) {
    const pi = player.findIndex(c => c.currentHealth > 0), oi = opponent.findIndex(c => c.currentHealth > 0);
    if (pi < 0 || oi < 0) break;
    const p = player[pi], o = opponent[oi], ps = input.player[pi], os = input.opponent[oi];
    // A finite explicit sequence repeats; it never silently becomes host autoplay when exhausted.
    const pa = prepare(p, ps, intents ? intents[r % intents.length] : cpuIntent(p, ps, random()));
    const oa = prepare(o, os, cpuIntent(o, os, random()));
    const pv = DUEL_RULES.varianceMin + random() * DUEL_RULES.varianceRange;
    const ov = DUEL_RULES.varianceMin + random() * DUEL_RULES.varianceRange;
    const initiative = ps.speed * pv - os.speed * ov;
    const first = initiative > 0 || (initiative === 0 && random() < 0.5) ? 'player' : 'opponent';
    const act=(side:'player'|'opponent',actor:DuelFighterState,target:DuelFighterState,stats:DuelFighterStats,targetStats:DuelFighterStats,action:DuelAction,defense:DuelAction,variance:number)=>{
      const knockedOut=actor.currentHealth<=0;
      strike(actor,target,stats,targetStats,action,defense,variance);
      rounds.push({round:r+1,side,attacker:actor.holobotId,defender:target.holobotId,
        move:knockedOut?'wait':action.action,moveId:stats.moveset[action.requested].moveId,requested:action.requested,
        hit:action.damage>0,damage:action.damage,defenderHpAfter:target.currentHealth,staAfter:actor.stamina,syncAfter:actor.sync,
        ...(knockedOut?{refusal:'knocked_out' as const}:action.refusal?{refusal:action.refusal}:{})});
    };
    if (first === 'player') { act('player',p,o,ps,os,pa,oa,pv); act('opponent',o,p,os,ps,oa,pa,ov); }
    else { act('opponent',o,p,os,ps,oa,pa,ov); act('player',p,o,ps,os,pa,oa,pv); }
    p.stamina = Math.min(p.maxStamina, p.stamina + ps.staminaRegen);
    o.stamina = Math.min(o.maxStamina, o.stamina + os.staminaRegen);
    Object.assign(pa, {currentHealth:p.currentHealth,stamina:p.stamina,sync:p.sync});
    Object.assign(oa, {currentHealth:o.currentHealth,stamina:o.stamina,sync:o.sync});
  }
  const alive = (team: DuelFighterState[]) => team.some(c => c.currentHealth > 0);
  const knockout = !alive(player) || !alive(opponent);
  const fraction = (team: DuelFighterState[]) => team.reduce((n,c) => n+c.currentHealth,0) / team.reduce((n,c) => n+c.maxHealth,0);
  const delta = fraction(player)-fraction(opponent);
  const winner = knockout ? (alive(player) ? 'player' : 'opponent') : delta > 0 ? 'player' : delta < 0 ? 'opponent' : random() < 0.5 ? 'player' : 'opponent';
  return {schemaVersion:DUEL_RECEIPT_SCHEMA,seed:input.seed,winner,reason:knockout?'knockout':'round_limit',rounds,playerFinal:player,opponentFinal:opponent};
}
