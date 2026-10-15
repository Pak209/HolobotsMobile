import { tournamentAdmission, tournamentIndex, tournamentLevel, ARENA_TOURNAMENT_SCHEMA } from '../story/arenaTournament';
import { StoryError } from '../story/storyFlags';
import { PilotRankError } from '../account/pilotRank';
/** Durable economy/HP receipts for the client-observed CPU practice sim (#56/#58).
 * This binds admission and settlement; it does NOT prove the simulated combat happened.
 * The account parent is a transactionally shared lease; child receipts never use TTL cleanup.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ActivityError, arenaOpen, duelOpen } from '../lib/arenaActivity';
import { withRankHealingReward } from '../lib/rankHealingReward';
import { getArenaTier, getArenaBaseRewards, getArenaBlueprintAmount, incrementArenaBattlesToday, ArenaTierId } from '../lib/arenaEconomy';
import { BATTLE_COMBO_BONUS, BATTLE_PERFECT_DEFENSE_BONUS, BATTLE_LOSS_EXP_FRACTION, BATTLE_LOSS_SYNC_FRACTION, MAX_PERFORMANCE_EVENTS, EXP_BOOSTER_MULTIPLIER } from '../lib/battleSettlement';
import { buildPlayerCombatants, playerCombatant, readOpenBattles, RivalError } from '../lib/rivalLadder';
import { readHoloZoneRuns, HoloZoneError } from '../lib/holoZoneRuns';
import { HealthError, requireLivingVitals, settleVitals, Vitals } from '../lib/rivalHealth';
import { applyHolobotExperience, calculateExperience, HOLOBOT_BASE_STATS } from '../lib/progression';
import { toHolobotKey } from '../lib/mintingEconomy';

export const ARENA_MATCH_SCHEMA = 'arena-match-1';
export const ARENA_MATCH_TTL_MS = 30 * 60 * 1000;
export const ARENA_MIN_SETTLE_MS = 1000; // Replay plausibility only, not proof of combat.
export class ArenaError extends Error { constructor(public code: string) { super(code); } }
type Data = Record<string, any>;
type Command = Data & { operation: 'issue'|'start'|'resume'|'settle'|'cancel' };
type Match = Data & { matchId: string; state: 'issued'|'active'|'settled'|'cancelled'|'expired' };
const object = (x: unknown): x is Data => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const whole = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const terminal = (m: Match) => ['settled', 'cancelled', 'expired'].includes(m.state);
const fail = (code: string): never => { throw new ArenaError(code); };
function command(raw: unknown): Command {
  if (!object(raw) || raw.schemaVersion !== ARENA_MATCH_SCHEMA) return fail('invalid_request');
  const fields: Record<string, string[]> = {
    issue: ['requestId','tierId','paymentMethod','holobotId','opponentName','tournamentId'],
    start: ['matchId'], resume: ['matchId'], cancel: ['matchId','playerFinalHealth'],
    settle: ['matchId','playerFinalHealth','opponentFinalHealth','combosCompleted','perfectDefenses'],
  };
  if (typeof raw.operation !== 'string' || !Object.hasOwn(fields, raw.operation) || Object.keys(raw).some(k => !['schemaVersion','operation',...fields[raw.operation]].includes(k))) return fail('invalid_request');
  if (raw.operation === 'issue') {
    if (typeof raw.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(raw.requestId)
      || typeof raw.holobotId !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(raw.holobotId)
      || typeof raw.tierId !== 'string' || !getArenaTier(raw.tierId)
      || !['pass','tokens'].includes(raw.paymentMethod) || typeof raw.opponentName !== 'string') return fail('invalid_request');
    if (raw.tournamentId !== undefined) {
      try { tournamentIndex(raw.tournamentId); } catch { return fail('invalid_request'); }
    }
    const tier = getArenaTier(raw.tierId)!;
    const pool = tier.id === 'rookie' ? [...tier.opponentPool,'KUMA','SHADOW'] : [...tier.opponentPool];
    if (!pool.includes(raw.opponentName)) return fail('invalid_request');
  } else {
    if (!(raw.operation === 'resume' && raw.matchId === undefined) && (typeof raw.matchId !== 'string' || !/^am_[a-f0-9]{32}$/.test(raw.matchId))) return fail('invalid_request');
    if (raw.operation === 'settle') {
      if (!finite(raw.playerFinalHealth) || raw.playerFinalHealth < 0 || !finite(raw.opponentFinalHealth) || raw.opponentFinalHealth < 0
        || !whole(raw.combosCompleted) || raw.combosCompleted > MAX_PERFORMANCE_EVENTS
        || !whole(raw.perfectDefenses) || raw.perfectDefenses > MAX_PERFORMANCE_EVENTS) return fail('invalid_request');
    }
    if (raw.operation === 'cancel' && raw.playerFinalHealth !== undefined && (!finite(raw.playerFinalHealth) || raw.playerFinalHealth < 0)) return fail('invalid_request');
  }
  return raw as Command;
}
/** Validate persisted accounting before trusting a quote, refund, or replay. These checks detect
 * malformed/inconsistent records; a coherent privileged rewrite is outside this host's trust boundary.
 * Numeric quotes are bounded independently of today's table, so later prices do not reprice a match.
 */
function match(raw: unknown, id: string): Match {
  if (!object(raw) || raw.schemaVersion !== ARENA_MATCH_SCHEMA || raw.matchId !== id
    || !/^am_[a-f0-9]{32}$/.test(id) || typeof raw.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(raw.requestId)
    || !['issued','active','settled','cancelled','expired'].includes(raw.state)
    || !whole(raw.issuedAtMs) || !whole(raw.expiresAtMs) || raw.expiresAtMs <= raw.issuedAtMs
    || typeof raw.tierId !== 'string' || !getArenaTier(raw.tierId)
    || !object(raw.entrant) || !object(raw.opponent) || !object(raw.entryReceipt) || !object(raw.rules)) return fail('unavailable');
  if (raw.tournament !== undefined) {
    const t = raw.tournament;
    if (!object(t) || t.schemaVersion !== ARENA_TOURNAMENT_SCHEMA || !whole(raw.entrant.level) || raw.entrant.level < 1) return fail('unavailable');
    // Pre-pilot-rank #80 admissions remain valid; a present snapshot must be well formed.
    if (t.pilotRankAtAdmission !== undefined && !whole(t.pilotRankAtAdmission)) return fail('unavailable');
    try { if (t.requiredLevel !== tournamentLevel(t.tournamentId)) return fail('unavailable'); }
    catch { return fail('unavailable'); }
  }
  if (raw.bracket !== undefined && (!object(raw.bracket) || raw.bracket.schemaVersion !== 'arena-bracket-1'
    || raw.bracket.matchId !== id || !whole(raw.bracket.boundAtMs) || raw.bracket.boundAtMs < raw.issuedAtMs)) return fail('unavailable');
  assertFiniteTree(raw);
  const entrant = raw.entrant, opponent = raw.opponent, entry = raw.entryReceipt, rules = raw.rules;
  const health = (n: unknown, max: number) => finite(n) && n >= 0 && n <= max;
  const boundedQuote = (n: unknown) => whole(n) && n <= 1_000_000;
  const fraction = (n: unknown) => finite(n) && n >= 0 && n <= 1;
  const tier = getArenaTier(raw.tierId)!;
  const pool = tier.id === 'rookie' ? [...tier.opponentPool,'KUMA','SHADOW'] : [...tier.opponentPool];
  if (typeof entrant.holobotId !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(entrant.holobotId)
    || typeof entrant.name !== 'string' || !entrant.name || toHolobotKey(entrant.name) !== entrant.holobotId
    || !Object.hasOwn(HOLOBOT_BASE_STATS,entrant.holobotId.toUpperCase())
    || !finite(entrant.maxHealth) || entrant.maxHealth <= 0 || !health(entrant.currentHealth,entrant.maxHealth) || entrant.currentHealth === 0
    || typeof opponent.name !== 'string' || !(raw.bracket ? Object.hasOwn(HOLOBOT_BASE_STATS,opponent.name) : pool.includes(opponent.name)) || opponent.holobotId !== toHolobotKey(opponent.name)
    || !finite(opponent.maxHealth) || opponent.maxHealth <= 0
    || rules.version !== 'arena-economy-legacy-1'
    || !boundedQuote(rules.entryFeeHolos) || rules.entryFeeHolos === 0
    || !boundedQuote(rules.exp) || !boundedQuote(rules.syncPoints) || !boundedQuote(rules.holos) || !boundedQuote(rules.blueprints)
    || !fraction(rules.comboBonus) || !fraction(rules.perfectDefenseBonus) || !fraction(rules.lossExpFraction) || !fraction(rules.lossSyncFraction)
    || !whole(rules.maxPerformanceEvents) || rules.maxPerformanceEvents > 25
    || !whole(rules.expBoosterMultiplier) || rules.expBoosterMultiplier < 1 || rules.expBoosterMultiplier > 10
    || entry.matchId !== id || !['tokens','pass'].includes(entry.method) || !whole(entry.amount) || entry.amount === 0
    || entry.amount !== (entry.method === 'pass' ? 1 : rules.entryFeeHolos)
    || !whole(entry.balanceBefore) || !whole(entry.balanceAfter) || entry.balanceBefore - entry.balanceAfter !== entry.amount
    || entry.chargedAtMs !== raw.issuedAtMs) return fail('unavailable');
  const started = whole(raw.startedAtMs) && raw.startedAtMs >= raw.issuedAtMs && raw.startedAtMs <= raw.expiresAtMs;
  if (raw.state === 'issued' || raw.state === 'active') {
    if ((raw.state === 'issued' ? raw.startedAtMs !== null : !started)
      || raw.closedAtMs !== null || raw.settlementReceipt !== null) return fail('unavailable');
    return raw as Match;
  }
  const receipt = raw.settlementReceipt;
  if (!object(receipt) || receipt.matchId !== id || !whole(raw.closedAtMs) || raw.closedAtMs < raw.issuedAtMs
    || receipt.closedAtMs !== raw.closedAtMs || (started && raw.closedAtMs < raw.startedAtMs)
    || (raw.state === 'expired' ? raw.closedAtMs <= raw.expiresAtMs : raw.closedAtMs > raw.expiresAtMs)) return fail('unavailable');
  if (receipt.outcome === 'cancelled_before_start') {
    const refund = receipt.refund;
    if (raw.state === 'settled' || raw.startedAtMs !== null || receipt.refunded !== true || receipt.settlement !== null
      || !object(refund) || refund.method !== entry.method || refund.amount !== entry.amount
      || !whole(refund.balanceBefore) || !whole(refund.balanceAfter) || refund.balanceAfter - refund.balanceBefore !== refund.amount) return fail('unavailable');
    return raw as Match;
  }
  const report = receipt.report, vitals = receipt.finalVitals;
  if (!started || receipt.refunded !== false || !object(report) || !health(report.playerFinalHealth,entrant.currentHealth)
    || !object(vitals) || Object.keys(vitals).length !== 1 || !Object.hasOwn(vitals,entrant.holobotId)) return fail('unavailable');
  const final = vitals[entrant.holobotId];
  if (!object(final) || !finite(final.maxHealth) || final.maxHealth <= 0 || !health(final.currentHealth,final.maxHealth)
    || final.currentHealth > report.playerFinalHealth) return fail('unavailable');
  if (receipt.outcome === 'forfeit') {
    if (raw.state === 'settled' || receipt.settlement !== null) return fail('unavailable');
    return raw as Match;
  }
  const settlement = receipt.settlement;
  if (raw.state !== 'settled' || !['win','loss'].includes(receipt.outcome) || !object(settlement)
    || !health(report.opponentFinalHealth,opponent.maxHealth)
    || (raw.bracket ? !['player','opponent'].includes(report.bracketWinner)
      || (receipt.outcome === 'win') !== (report.bracketWinner === 'player')
      || (report.bracketWinner === 'player' ? report.playerFinalHealth <= 0 : report.opponentFinalHealth <= 0)
      : (report.playerFinalHealth === 0) === (report.opponentFinalHealth === 0)
        || (receipt.outcome === 'win') !== (report.opponentFinalHealth === 0))
    || !whole(report.combosCompleted) || report.combosCompleted > rules.maxPerformanceEvents
    || !whole(report.perfectDefenses) || report.perfectDefenses > rules.maxPerformanceEvents) return fail('unavailable');
  const won = receipt.outcome === 'win';
  const bonus = 1 + rules.comboBonus * report.combosCompleted + rules.perfectDefenseBonus * report.perfectDefenses;
  const exp = Math.floor(rules.exp * (won ? bonus : rules.lossExpFraction));
  const sync = Math.floor(rules.syncPoints * (won ? bonus : rules.lossSyncFraction));
  const blueprint = settlement.blueprints;
  if (!whole(settlement.exp) || settlement.exp !== exp || !whole(settlement.awardedExp)
    || ![exp,exp * rules.expBoosterMultiplier].includes(settlement.awardedExp)
    || !whole(settlement.syncPoints) || settlement.syncPoints !== sync
    || !whole(settlement.holos) || settlement.holos !== (won ? rules.holos : 0)
    || (won ? !object(blueprint) || blueprint.holobotKey !== toHolobotKey(opponent.name) || blueprint.amount !== rules.blueprints : blueprint !== null)) return fail('unavailable');
  return raw as Match;
}
function counter(profile: Data, key: string): number {
  const n = profile[key] ?? 0;
  if (!whole(n)) return fail('unavailable');
  return n;
}
function uniqueEntrant(profile: Data, id: string): Data {
  if (!Array.isArray(profile.holobots)) return fail('unavailable');
  const found = profile.holobots.filter((h: unknown) => object(h) && typeof h.name === 'string' && toHolobotKey(h.name) === id);
  if (found.length !== 1 || !Object.hasOwn(HOLOBOT_BASE_STATS,id.toUpperCase())) return fail('invalid_request');
  const bot = found[0];
  // These legacy profile fields are owner-writable. Validate before calling the progression loop.
  const level = bot.level ?? 1, exp = bot.experience ?? 0;
  if (!whole(level) || level < 1 || !whole(exp)) return fail('unavailable');
  const threshold = calculateExperience(level + 1);
  if (!whole(threshold) || exp >= threshold || (bot.nextLevelExp !== undefined && bot.nextLevelExp !== threshold)
    || (bot.attributePoints !== undefined && !whole(bot.attributePoints))) return fail('unavailable');
  if (bot.boostedAttributes !== undefined && (!object(bot.boostedAttributes) || Object.values(bot.boostedAttributes).some(n => !whole(n)))) return fail('unavailable');
  return bot;
}
function reply(m: Match, alreadyProcessed = false) {
  return { schemaVersion: ARENA_MATCH_SCHEMA, matchId: m.matchId, alreadyProcessed, match: m };
}
function guardOtherActivities(rival: Data|undefined, zone: Data|undefined, duel: Data|undefined, now: number) {
  if (Object.keys(readOpenBattles(rival, now)).length || readHoloZoneRuns(zone).some(r => r.settlement === null && r.closedAtMs === null && now <= r.expiresAtMs)) fail('activity_conflict');
  if (duelOpen(duel)) fail('activity_conflict'); // Shared guard; malformed -> ActivityError -> unavailable.
}
function assertFiniteTree(value: unknown): void {
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) fail('unavailable');
  if (Array.isArray(value)) value.forEach(assertFiniteTree);
  else if (object(value)) Object.values(value).forEach(assertFiniteTree);
}
/** Use the admission's numeric quote, so a later price/table release cannot change an outstanding match. */
function rewards(profile: Data, m: Match, c: Command, now: number, bracketWon?:boolean) {
  const r = m.rules, won = bracketWon ?? c.opponentFinalHealth === 0;
  const bonus = 1 + r.comboBonus * c.combosCompleted + r.perfectDefenseBonus * c.perfectDefenses;
  const exp = Math.floor(r.exp * (won ? bonus : r.lossExpFraction));
  const syncPoints = Math.floor(r.syncPoints * (won ? bonus : r.lossSyncFraction));
  const holos = won ? r.holos : 0;
  const awardedExp = exp * (finite(profile.expBoosterActiveUntil) && profile.expBoosterActiveUntil > now ? r.expBoosterMultiplier : 1);
  uniqueEntrant(profile, m.entrant.holobotId);
  const blueprints = { ...(profile.blueprints ?? {}) };
  if (!object(profile.blueprints ?? {} ) || Object.values(blueprints).some(n => !whole(n))) fail('unavailable');
  const blueprint = won ? { holobotKey: m.opponent.name.toLowerCase(), amount: r.blueprints } : null;
  if (blueprint) blueprints[blueprint.holobotKey] = (blueprints[blueprint.holobotKey] ?? 0) + blueprint.amount;
  const updates: Data = {
    blueprints,
    holobots: profile.holobots.map((h: Data) => object(h) && typeof h.name === 'string' && toHolobotKey(h.name) === m.entrant.holobotId ? applyHolobotExperience(h, awardedExp) : h),
    holosTokens: counter(profile,'holosTokens') + holos,
    wins: counter(profile,'wins') + (won ? 1 : 0), losses: counter(profile,'losses') + (won ? 0 : 1),
    syncPoints: counter(profile,'syncPoints') + syncPoints,
    rewardSystem: incrementArenaBattlesToday(profile.rewardSystem, new Date(now)),
  };
  assertFiniteTree(updates);
  return { updates, settlement: { exp, awardedExp, holos, syncPoints, blueprints: blueprint }, outcome: won ? 'win' : 'loss' };
}

export async function transactArenaMatch(firestore: Firestore, uid: string, raw: unknown, nowMs = Date.now()) {
  const c = command(raw);
  if (!whole(nowMs)) return fail('invalid_request');
  const generatedId = `am_${randomBytes(16).toString('hex')}`; // Stable across transaction retries.
  const parentRef = firestore.doc(`arenaMatches/${uid}`), userRef = firestore.doc(`users/${uid}`);
  const identity = c.operation === 'issue' ? createHash('sha256').update(JSON.stringify([c.tierId,c.paymentMethod,c.holobotId,c.opponentName,...(c.tournamentId === undefined ? [] : [c.tournamentId])])).digest('hex') : '';
  try {
    return await firestore.runTransaction(async tx => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) return fail('unavailable');
      const profile = userSnap.data()!;
      if (c.operation === 'issue') {
        const requestRef = parentRef.collection('requests').doc(c.requestId);
        const request = await tx.get(requestRef);
        if (request.exists) {
          if (request.data()!.identity !== identity) return fail('request_conflict');
          const id = request.data()!.matchId;
          if (typeof id !== 'string' || !/^am_[a-f0-9]{32}$/.test(id)) return fail('unavailable');
          const saved = match((await tx.get(parentRef.collection('matches').doc(id))).data(),id);
          if (saved.requestId !== c.requestId) return fail('unavailable');
          return reply(saved,true);
        }
        const lease = await tx.get(parentRef);
        if (arenaOpen(lease.data())) return fail('activity_conflict');
        const rival = await tx.get(firestore.doc(`rivalBattles/${uid}`));
        const zone = await tx.get(firestore.doc(`holoZoneRuns/${uid}`));
        const duel = await tx.get(firestore.doc(`duelHealingRuns/${uid}`));
        guardOtherActivities(rival.data(),zone.data(),duel.data(),nowMs);
        const owned = uniqueEntrant(profile,c.holobotId);
        requireLivingVitals(profile,[c.holobotId]); // Validates the whole ledger; NEVER invoke city 40% revival.
        const player = buildPlayerCombatants(profile,[c.holobotId])[0];
        const tournament = c.tournamentId === undefined ? undefined : tournamentAdmission(profile.storyFlags,c.tournamentId,player?.level,profile.pilotRank);
        if (!player || !finite(player.maxHealth) || player.maxHealth <= 0) return fail('unavailable');
        const current = profile.holobotVitals?.[c.holobotId];
        const hp = current ? Math.min(current.currentHealth,player.maxHealth) : player.maxHealth;
        if (hp <= 0) return fail('holobot_ko');
        const vitals = { ...(profile.holobotVitals ?? {}), [c.holobotId]: {currentHealth:hp,maxHealth:player.maxHealth} };
        const tier = getArenaTier(c.tierId)!;
        const opponentStats = playerCombatant(c.opponentName.toLowerCase(), {name:c.opponentName,level:tier.opponentLevel});
        const field = c.paymentMethod === 'pass' ? 'arenaPassses' : 'holosTokens';
        const amount = c.paymentMethod === 'pass' ? 1 : tier.entryFeeHolos;
        const before = counter(profile,field);
        if (before < amount) return fail('insufficient_funds');
        const m: Match = {
          schemaVersion:ARENA_MATCH_SCHEMA,matchId:generatedId,requestId:c.requestId,state:'issued',tierId:tier.id as ArenaTierId,
          issuedAtMs:nowMs,expiresAtMs:nowMs+ARENA_MATCH_TTL_MS,startedAtMs:null,closedAtMs:null,
          entrant:{...player,name:owned.name,currentHealth:hp},opponent:{...opponentStats,name:c.opponentName},
          entryReceipt:{matchId:generatedId,method:c.paymentMethod,amount,balanceBefore:before,balanceAfter:before-amount,chargedAtMs:nowMs},
          rules:{version:'arena-economy-legacy-1',entryFeeHolos:tier.entryFeeHolos,...getArenaBaseRewards(tier),blueprints:getArenaBlueprintAmount(tier),comboBonus:BATTLE_COMBO_BONUS,perfectDefenseBonus:BATTLE_PERFECT_DEFENSE_BONUS,lossExpFraction:BATTLE_LOSS_EXP_FRACTION,lossSyncFraction:BATTLE_LOSS_SYNC_FRACTION,maxPerformanceEvents:MAX_PERFORMANCE_EVENTS,expBoosterMultiplier:EXP_BOOSTER_MULTIPLIER},
          settlementReceipt:null,...(tournament ? {tournament} : {}),
        };
        match(m,generatedId);
        tx.update(userRef,{[field]:before-amount,holobotVitals:vitals,
          ...(tournament && profile.pilotRank === undefined ? {pilotRank:tournament.pilotRankAtAdmission} : {})});
        tx.create(parentRef.collection('matches').doc(generatedId),m);
        tx.create(requestRef,{schemaVersion:ARENA_MATCH_SCHEMA,identity,matchId:generatedId,createdAtMs:nowMs});
        tx.set(parentRef,{schemaVersion:'arena-healing-1',recordSchemaVersion:ARENA_MATCH_SCHEMA,matchId:generatedId,open:true,issuedAtMs:nowMs,expiresAtMs:m.expiresAtMs});
        return reply(m);
      }
      // A fresh device may have lost both local IDs. Discover only this authenticated account's latest match.
      let requestedId = c.matchId;
      let discoveredOpen: boolean|undefined;
      if (c.operation === 'resume' && requestedId === undefined) {
        const current = (await tx.get(parentRef)).data();
        if (current === undefined) return {schemaVersion:ARENA_MATCH_SCHEMA,matchId:null,alreadyProcessed:true,match:null};
        discoveredOpen = arenaOpen(current); // Validate even a closed parent; never infer unlock from time.
        if (current.recordSchemaVersion !== ARENA_MATCH_SCHEMA || !/^am_[a-f0-9]{32}$/.test(current.matchId)) return fail('unavailable');
        requestedId = current.matchId;
      }
      const matchRef = parentRef.collection('matches').doc(requestedId), snap = await tx.get(matchRef);
      if (!snap.exists) return fail(discoveredOpen !== undefined ? 'unavailable' : 'unknown_match');
      const m = match(snap.data(),requestedId);
      if (discoveredOpen !== undefined && discoveredOpen === terminal(m)) return fail('unavailable');
      if (c.operation === 'resume') return reply(m,true);
      if (terminal(m)) return reply(m,true); // Durable replay does not inspect/release a newer match's lease.
      if (m.bracket && ['start','settle','cancel'].includes(c.operation)) return fail('bracket_bound');
      // Every new tournament outcome must use the host bracket, including old active admissions.
      if (m.tournament && (c.operation === 'start' || c.operation === 'settle')) return fail('bracket_required');
      const parent = (await tx.get(parentRef)).data();
      if (!arenaOpen(parent) || parent?.matchId !== m.matchId || parent?.recordSchemaVersion !== ARENA_MATCH_SCHEMA) return fail('unavailable');
      if (c.operation === 'start') {
        if (nowMs > m.expiresAtMs) return fail('match_expired');
        if (m.state === 'active') return reply(m,true);
        const next: Match = {...m,state:'active',startedAtMs:nowMs};
        match(next,m.matchId);
        tx.set(matchRef,next); return reply(next);
      }
      let updates: Data = {}, receipt: Data;
      let nextState: Match['state'];
      if (c.operation === 'cancel' && m.state === 'issued') {
        if (c.playerFinalHealth !== undefined) return fail('invalid_request');
        const field = m.entryReceipt.method === 'pass' ? 'arenaPassses' : 'holosTokens';
        const before = counter(profile,field);
        updates[field] = before + m.entryReceipt.amount;
        receipt = {matchId:m.matchId,outcome:'cancelled_before_start',refunded:true,refund:{method:m.entryReceipt.method,amount:m.entryReceipt.amount,balanceBefore:before,balanceAfter:updates[field]},settlement:null,closedAtMs:nowMs};
        nextState = nowMs > m.expiresAtMs ? 'expired' : 'cancelled';
      } else {
        if (m.state !== 'active') return fail('invalid_state');
        if (!finite(c.playerFinalHealth) || c.playerFinalHealth < 0 || c.playerFinalHealth > m.entrant.currentHealth) return fail('invalid_request');
        const issued: Vitals = {[m.entrant.holobotId]:{currentHealth:m.entrant.currentHealth,maxHealth:m.entrant.maxHealth}};
        const vitals = settleVitals(profile,issued,[{holobotId:m.entrant.holobotId,currentHealth:c.playerFinalHealth}]);
        if (c.operation === 'settle') {
          if (nowMs > m.expiresAtMs) return fail('match_expired');
          if (nowMs - m.startedAtMs < ARENA_MIN_SETTLE_MS) return fail('too_fast');
          if (c.combosCompleted > m.rules.maxPerformanceEvents || c.perfectDefenses > m.rules.maxPerformanceEvents || c.opponentFinalHealth > m.opponent.maxHealth || (c.playerFinalHealth === 0) === (c.opponentFinalHealth === 0)) return fail('invalid_request');
          const result = rewards(profile,m,c,nowMs);
          updates = withRankHealingReward(profile, result.updates); // #72 rank-tier Kit, moved off the closed legacy settle.
          receipt = {matchId:m.matchId,outcome:result.outcome,refunded:false,settlement:result.settlement,report:{playerFinalHealth:c.playerFinalHealth,opponentFinalHealth:c.opponentFinalHealth,combosCompleted:c.combosCompleted,perfectDefenses:c.perfectDefenses},closedAtMs:nowMs};
          nextState = 'settled';
        } else {
          receipt = {matchId:m.matchId,outcome:'forfeit',refunded:false,settlement:null,report:{playerFinalHealth:c.playerFinalHealth},closedAtMs:nowMs};
          nextState = nowMs > m.expiresAtMs ? 'expired' : 'cancelled';
        }
        updates.holobotVitals = vitals;
        receipt.finalVitals = {[m.entrant.holobotId]:vitals[m.entrant.holobotId]};
      }
      assertFiniteTree(updates);
      const next: Match = {...m,state:nextState,closedAtMs:nowMs,settlementReceipt:receipt};
      match(next,m.matchId);
      tx.update(userRef,updates);
      tx.set(matchRef,next);
      tx.set(parentRef,{...parent,open:false,closedAtMs:nowMs});
      return reply(next);
    });
  } catch (e) {
    if (e instanceof StoryError) throw new ArenaError(e.code);
    if (e instanceof HealthError) throw new ArenaError(e.message === 'holobot_ko' ? 'holobot_ko' : e.message === 'invalid_request' ? 'invalid_request' : 'unavailable');
    if (e instanceof ActivityError || e instanceof RivalError || e instanceof HoloZoneError || e instanceof PilotRankError) throw new ArenaError('unavailable');
    throw e;
  }
}

/** Validates the immutable admission and terminal receipt before story progression trusts them. */
export { match as readArenaMatchRecord };

/** Trusted bracket transaction seam. Clients cannot call this helper or provide its report.
 * Reuses the admission's existing quote once; intermediate bracket bouts grant no rewards. */
export function settleArenaBracketRecord(profile:Data, raw:unknown, opponent:Data, playerFinalHealth:number, opponentFinalHealth:number, won:boolean, nowMs:number) {
  const m=match(raw,(raw as Match).matchId);
  if (!m.bracket || m.state!=='active') return fail('not_admitted');
  if (nowMs>m.expiresAtMs) return fail('match_expired');
  const resolved:Match={...m,opponent};
  match(resolved,m.matchId);
  const c:Command={operation:'settle',playerFinalHealth,opponentFinalHealth,combosCompleted:0,perfectDefenses:0};
  if (!finite(playerFinalHealth) || playerFinalHealth<0 || playerFinalHealth>m.entrant.currentHealth
    || !finite(opponentFinalHealth) || opponentFinalHealth<0 || opponentFinalHealth>opponent.maxHealth
    || (won ? playerFinalHealth<=0 : opponentFinalHealth<=0)) return fail('unavailable');
  const result=rewards(profile,resolved,c,nowMs,won);
  const updates=withRankHealingReward(profile,result.updates);
  const issued:Vitals={[m.entrant.holobotId]:{currentHealth:m.entrant.currentHealth,maxHealth:m.entrant.maxHealth}};
  const finalVitals=settleVitals(profile,issued,[{holobotId:m.entrant.holobotId,currentHealth:playerFinalHealth}]);
  updates.holobotVitals=finalVitals;
  const next:Match={...resolved,state:'settled',closedAtMs:nowMs,settlementReceipt:{matchId:m.matchId,outcome:result.outcome,refunded:false,
    settlement:result.settlement,report:{playerFinalHealth,opponentFinalHealth,combosCompleted:0,perfectDefenses:0,bracketWinner:won?'player':'opponent'},closedAtMs:nowMs,
    finalVitals:{[m.entrant.holobotId]:finalVitals[m.entrant.holobotId]}}};
  assertFiniteTree(updates);match(next,m.matchId);
  return {updates,match:next};
}

/** A bound bracket can be abandoned using host-observed HP, including after expiry. */
export function cancelArenaBracketRecord(profile:Data,raw:unknown,playerFinalHealth:number,nowMs:number) {
  const m=match(raw,(raw as Match).matchId);
  if (!m.bracket || m.state!=='active') return fail('not_admitted');
  const issued:Vitals={[m.entrant.holobotId]:{currentHealth:m.entrant.currentHealth,maxHealth:m.entrant.maxHealth}};
  const holobotVitals=settleVitals(profile,issued,[{holobotId:m.entrant.holobotId,currentHealth:playerFinalHealth}]);
  const next:Match={...m,state:nowMs>m.expiresAtMs?'expired':'cancelled',closedAtMs:nowMs,settlementReceipt:{matchId:m.matchId,outcome:'forfeit',refunded:false,
    settlement:null,report:{playerFinalHealth},closedAtMs:nowMs,finalVitals:{[m.entrant.holobotId]:holobotVitals[m.entrant.holobotId]}}};
  match(next,m.matchId);return {updates:{holobotVitals},match:next};
}
