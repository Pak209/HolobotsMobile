import { arenaFighterSnapshot } from '../lib/arenaFighterSnapshot';
import { expeditionOpen } from '../lib/arenaActivity';
import { cupEntryAdmission, tournamentIndex, tournamentLevel, ARENA_TOURNAMENT_SCHEMA } from '../story/arenaTournament';
import { StoryError } from '../story/storyFlags';
import { PilotRankError } from '../account/pilotRank';
/** Durable economy/HP receipts for the client-observed CPU practice sim (#56/#58).
 * This binds admission and settlement; it does NOT prove the simulated combat happened.
 * The account parent is a transactionally shared lease; child receipts never use TTL cleanup.
 */
import { createHash, randomBytes } from 'node:crypto';
import { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { ActivityError, arenaOpen, duelOpen } from '../lib/arenaActivity';
import { withRankHealingReward } from '../lib/rankHealingReward';
import { applyPartBoosts, equippedPartBoosts, ledgerHealthAfterFight, partBoostsChangeFight } from '../lib/partStats';
import { ARENA_TIERS, getArenaTier, getArenaBaseRewards, getArenaBlueprintAmount, ArenaTierId } from '../lib/arenaEconomy';
import { dailyMissionCounterUpdates } from '../lib/economy';
import { BATTLE_COMBO_BONUS, BATTLE_PERFECT_DEFENSE_BONUS, BATTLE_LOSS_EXP_FRACTION, BATTLE_LOSS_SYNC_FRACTION, MAX_PERFORMANCE_EVENTS, EXP_BOOSTER_MULTIPLIER } from '../lib/battleSettlement';
import { buildPlayerCombatants, playerCombatant, readOpenBattles, RivalError } from '../lib/rivalLadder';
import { readHoloZoneRuns, HoloZoneError } from '../lib/holoZoneRuns';
import { HealthError, requireLivingVitals, settleVitals, Vitals } from '../lib/rivalHealth';
import { commitVitals, effectiveVitals } from '../lib/autoHeal';
import { applyHolobotExperience, calculateExperience, HOLOBOT_BASE_STATS, normalizeUserHolobot } from '../lib/progression';
import { holobotProgressionRow } from '../lib/battleProgression';
import { DUEL_MAX_ROUNDS, DUEL_RECEIPT_SCHEMA, DuelReceipt, duelFighterFromCombatant, resolveDuel, validateDuelIntents } from '../lib/duelResolver';
import { toHolobotKey } from '../lib/mintingEconomy';
import type { HolobotProgressionEntry } from '../lib/battleProgression';
import { repairHolobotProgression } from '../lib/holobotRecordRepair';
import { recordAccountRepair, RepairChange } from '../lib/accountRepairAudit';
import { FIGHT_ATTRS_FLAG, FIGHT_CHASE_FLAG, FIGHT_INPUTS_CAPABILITY_FIELD, FIGHT_INPUTS_SCHEMA, FIGHT_LOG_FIELD, FIGHT_RECEIPT_FIELD, FIGHT_RECEIPT_SCHEMA, FIGHT_REPLAY_FLAG, FIGHT_REPLAY_MODE, FightReplayIssueWire } from '../shared/fightReplayContract';
import { FightReplayError, FightReplayVerdict, readIssue, verifyFightReplay } from '../sim/fight/replay';
import { RULES_SCHEMA_6, RULES_SCHEMA_7, RULES_SCHEMA_8 } from '../sim/fight/rules';
import { buildFightReplayIssue, inputLogCombatant } from '../rival/fightReplayIssue';
import { liveMoveRanksFor } from '../lib/liveMoveRanks';
import { FIGHT_PLAUSIBILITY_COLLECTION, FIGHT_RULES_CAPABILITY_FIELD } from '../rival/rivalBattleStore';
import { RIVAL_MIN_WIN_MS } from '../lib/rivalLadder';
import { LEFT_BEFORE_FIGHT_FIELD, leftBeforeFightInWindow, readLeftBeforeFight } from '../lib/leftBeforeFight';
import { FIRST_WIN_COLLECTION, FIRST_WIN_OF_DAY_MULTIPLIER, LIVE_WIN_BONUS_CAP, firstWinAvailable, firstWinRecord, firstWinWire, livePerformanceFromReceipt, utcDayOf } from '../lib/liveWinRewards';

/**
 * early-progression-1 (Pak 2026-11-12): a NEW account's first Arena entry is free. createGenesisProfile writes the server-only
 * arenaMatches/{uid}/ledger/starterEntry {state 'available'}; the first non-cup issue that finds it 'available' charges nothing
 * (entryReceipt.amount 0, starterFree true; method stays the requested one, so a shipped phone's receipt check still passes) and
 * marks it 'used' with the match id. A cancel before start (or a left-before-fight refund) of that match puts it back to
 * 'available'. Rewards are the tier's as normal. Accounts without the doc (every account created before this) never get it.
 */
export const ARENA_STARTER_ENTRY_SCHEMA = 'arena-starter-entry-1';
export const ARENA_STARTER_ENTRY_DOC = 'starterEntry';
export function arenaStarterEntryAvailable(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as Data).schemaVersion === ARENA_STARTER_ENTRY_SCHEMA && (raw as Data).state === 'available';
}
export function arenaStarterEntryGrant(nowMs: number) {
  return { schemaVersion: ARENA_STARTER_ENTRY_SCHEMA, state: 'available', grantedAtMs: nowMs };
}

export const ARENA_MATCH_SCHEMA = 'arena-match-1';
/**
 * arena-live-1 (Pak 2026-11-11: live duel is the battle system for every battle): the Arena CPU match as an input-log fight,
 * issued and replay-checked exactly like the rival live duel (rival/fightReplayIssue.buildFightReplayIssue at issue,
 * sim/fight/replay.verifyFightReplay at settle). Host env flag, default off, ON only for exactly "1", and only together with
 * HOLOCITY_FIGHT_REPLAY=1 (the expedition realtime precedent). Off: a request carrying `duelInputs` is answered exactly as
 * before this lane would have answered it without the field (resolver when `duelSchema` is sent, else today's legacy match).
 * The rules version follows the shared HOLOCITY_FIGHT_CHASE / HOLOCITY_FIGHT_ATTRS flags and the `fightRules` ask, as on the rival host.
 */
export const ARENA_FIGHT_REPLAY_FLAG = 'HOLOCITY_ARENA_FIGHT_REPLAY';
/** A verified WIN settled sooner than this after `start` is too_fast (nothing written, retryAfterMs); a loss never is.
 * The rival input-log rule (RIVAL_MIN_WIN_MS, 20 s): a live fight lasts real time, unlike the 3 s CPU-practice floor. */
export const ARENA_MIN_WIN_MS_LIVE = RIVAL_MIN_WIN_MS;
/** Arena tier index (rookie, challenger, elite, legend) -> the rival tier fed to buildFightReplayIssue, which only picks the CPU
 * rank from it (fightRankForTier: Starter, Champion, Rare, Elite). Producer pick, opponent levels 12 / 24 / 36 / 45; Pak tunes. */
export const ARENA_FIGHT_RANK_TIER: readonly number[] = [2, 4, 6, 8];
/** live-tuning-1 (Pak 2026-11-11, after a level-4 ACE was one-shot by the level-12 rookie HARE): a LIVE Arena match's CPU level.
 * Rookie = the entrant Holobot's own level, clamped to 1..12 (the old fixed rookie level is the cap); every other tier keeps its
 * fixed ARENA_TIERS opponentLevel (24 / 36 / 45). The resolver / legacy match keeps the fixed level. */
export const ARENA_ROOKIE_LIVE_MAX_LEVEL = 12;
export function arenaLiveOpponentLevel(tierId: string, fixedLevel: number, entrantLevel: number): number {
  if (tierId !== 'rookie') return fixedLevel;
  const lv = Number.isSafeInteger(entrantLevel) ? entrantLevel : 1;
  return Math.max(1, Math.min(ARENA_ROOKIE_LIVE_MAX_LEVEL, lv));
}
export type ArenaMatchOptions = { arenaFightReplay?: boolean; fightChase?: boolean; fightAttrs?: boolean; fightSeed?: () => string };
export function arenaFightReplayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ARENA_FIGHT_REPLAY_FLAG] === '1' && env[FIGHT_REPLAY_FLAG] === '1';
}
export const ARENA_MATCH_TTL_MS = 30 * 60 * 1000;
/**
 * Critic review 2026-10-17 S1 — BOUNDED mitigation for the client-reported CPU practice outcome (host re-simulation
 * from seeded intents is the next lane; until then the client still decides win / HP / performance).
 *
 * ARENA_MIN_SETTLE_MS_CPU: a WIN reported sooner than this after `start` is too_fast (nothing written; the match stays
 * active and may settle later, inside the TTL; the refusal carries details.retryAfterMs = floor - elapsed so the client
 * resends the identical settle once); a LOSS that soon settles but pays nothing (the rival #58 rule).
 * #143 set 20 s (RIVAL_MIN_WIN_MS / HOLOZONE_MIN_XP_MS, the host-played duel-receipt class: 8 rounds x 6,400 ms).
 * Every `settle` here is a CLIENT-PLAYED real-time CPU practice fight; the host never plays a receipt back for it
 * (tournament matches must use the host bracket, settleArenaBracketRecord, which has no floor). The lite scout measured
 * those fights at 0.7-7.3 s, so 20 s refused every lite win. 3 s is the producer pick for all CPU practice
 * (hardening-2; Pak may override): it still refuses a sub-3 s scripted loop, and a fight that really ends sooner waits
 * at most retryAfterMs (< 2.3 s at the measured 0.7 s minimum) for its one resend.
 */
export const ARENA_MIN_SETTLE_MS_CPU = 3_000;
/** @deprecated #143 name, kept as an alias of the CPU floor for in-flight branches whose tests import it. */
export const ARENA_MIN_SETTLE_MS = ARENA_MIN_SETTLE_MS_CPU;
/** Performance clamp: a report can claim at most one completed combo per 2 s and one perfect defense per 3 s of the
 * recorded receipt length (settle - start). Generous bounds: the client sim spaces defense plays by >= 2 cooldown turns
 * x DEFENSE_COOLDOWN_MS_PER_TURN 3,000 ms (mobile/src/features/arena/arenaCards.ts) and a duel-receipt action is
 * 3,200 ms. The clamp scales with elapsed, not the floor: at 3 s that is <= 1 combo / 1 perfect (bonus <= 1.35x),
 * at 20 s <= 10 / 6 (<= 2.3x, was 4.75x); 25 / 25 needs >= 75 s. */
export const ARENA_MS_PER_COMBO = 2_000;
export const ARENA_MS_PER_PERFECT_DEFENSE = 3_000;
/**
 * Paid CPU practice settles per account per UTC day; later settles still close the match and write HP but pay nothing
 * (settlement.payoutWithheld 'daily_cap'). From lib/arenaEconomy.ts a paid win returns 2 x entryFeeHolos for an entry of
 * entryFeeHolos (net +50 / +100 / +150 / +225 Holos rookie..legend) plus 5 / 10 / 15 / 20 blueprints of the opponent the
 * client picked. 10 keeps >= 3x the arena_v2_battle daily mission (target 3) fully paid for an honest player and bounds
 * the reported-win farm at <= +2,250 net Holos and 200 blueprints per account per day (legend), from unbounded.
 * Producer default; Pak tunes.
 */
export const ARENA_CPU_DAILY_PAYOUT_CAP = 10;
export const ARENA_CPU_PAYOUTS_SCHEMA = 'arena-cpu-payouts-1';
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Server-only arenaMatches/{uid}/ledger/cpuPayouts (rules deny every depth; recursiveDelete covers it). */
function paidToday(raw: unknown, nowMs: number): number {
  if (raw === undefined) return 0;
  if (!object(raw) || raw.schemaVersion !== ARENA_CPU_PAYOUTS_SCHEMA || typeof raw.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day) || !whole(raw.paidSettles)) return fail('unavailable');
  return raw.day === utcDay(nowMs) ? raw.paidSettles : 0;
}
export class ArenaError extends Error { constructor(public code: string, public retryAfterMs?: number, public reason?: string, public detail?: Record<string, unknown>) { super(code); } }
/** host-crawl-fixes-1 (RC7): a stored holobot record the host cannot normalize. NON-transient (never 'unavailable'):
 * retrying cannot help; details.reason is a lib/holobotRecordRepair HolobotRepairRefusal. */
export const ARENA_HOLOBOT_RECORD_INVALID = 'holobot_record_invalid';
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
    issue: ['requestId','tierId','paymentMethod','holobotId','opponentName','tournamentId','duelSchema',FIGHT_INPUTS_CAPABILITY_FIELD,FIGHT_RULES_CAPABILITY_FIELD],
    start: ['matchId'], resume: ['matchId'], cancel: ['matchId','playerFinalHealth',LEFT_BEFORE_FIGHT_FIELD],
    settle: ['matchId','playerFinalHealth','opponentFinalHealth','combosCompleted','perfectDefenses','playerIntents',FIGHT_LOG_FIELD],
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
    // Opt-in: a host-resolved CPU fight (arena plan + send). A cup match always settles through the host bracket.
    if (raw.duelSchema !== undefined && (raw.duelSchema !== DUEL_RECEIPT_SCHEMA || raw.tournamentId !== undefined)) return fail('invalid_request');
    // arena-live-1: the live-duel capability (the rival host's `duelInputs`) and the duel-rules-6 ask; never on a cup issue.
    if (raw[FIGHT_INPUTS_CAPABILITY_FIELD] !== undefined && (raw[FIGHT_INPUTS_CAPABILITY_FIELD] !== FIGHT_INPUTS_SCHEMA || raw.tournamentId !== undefined)) return fail('invalid_request');
    if (raw[FIGHT_RULES_CAPABILITY_FIELD] !== undefined && ((raw[FIGHT_RULES_CAPABILITY_FIELD] !== RULES_SCHEMA_6 && raw[FIGHT_RULES_CAPABILITY_FIELD] !== RULES_SCHEMA_7 && raw[FIGHT_RULES_CAPABILITY_FIELD] !== RULES_SCHEMA_8) || raw.tournamentId !== undefined)) return fail('invalid_request');
    const tier = getArenaTier(raw.tierId)!;
    const pool = tier.id === 'rookie' ? [...tier.opponentPool,'KUMA','SHADOW'] : [...tier.opponentPool];
    if (!pool.includes(raw.opponentName)) return fail('invalid_request');
  } else {
    if (!(raw.operation === 'resume' && raw.matchId === undefined) && (typeof raw.matchId !== 'string' || !/^am_[a-f0-9]{32}$/.test(raw.matchId))) return fail('invalid_request');
    if (raw.operation === 'settle' && raw[FIGHT_LOG_FIELD] !== undefined) {
      // A live settle sends the recorded log only: outcome, HP and performance come from the host's replay of it.
      if (['playerFinalHealth','opponentFinalHealth','combosCompleted','perfectDefenses','playerIntents'].some(k => raw[k] !== undefined)) return fail('invalid_request');
      if (typeof raw[FIGHT_LOG_FIELD] !== 'string' && !object(raw[FIGHT_LOG_FIELD])) return fail('invalid_request');
    } else if (raw.operation === 'settle' && raw.playerIntents !== undefined) {
      // A resolver settle sends the plan only: no HP, performance or outcome is accepted from the client.
      if (['playerFinalHealth','opponentFinalHealth','combosCompleted','perfectDefenses'].some(k => raw[k] !== undefined)) return fail('invalid_request');
      try { validateDuelIntents(raw.playerIntents); } catch { return fail('invalid_request'); }
    } else if (raw.operation === 'settle') {
      if (!finite(raw.playerFinalHealth) || raw.playerFinalHealth < 0 || !finite(raw.opponentFinalHealth) || raw.opponentFinalHealth < 0
        || !whole(raw.combosCompleted) || raw.combosCompleted > MAX_PERFORMANCE_EVENTS
        || !whole(raw.perfectDefenses) || raw.perfectDefenses > MAX_PERFORMANCE_EVENTS) return fail('invalid_request');
    }
    if (raw.operation === 'cancel' && raw.playerFinalHealth !== undefined && (!finite(raw.playerFinalHealth) || raw.playerFinalHealth < 0)) return fail('invalid_request');
    // no-loss-before-fight (Pak 2026-11-11): only the literal true, and never with an HP report (a live cancel carries none).
    if (raw.operation === 'cancel' && (readLeftBeforeFight(raw) === null || (raw[LEFT_BEFORE_FIGHT_FIELD] !== undefined && raw.playerFinalHealth !== undefined))) return fail('invalid_request');
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
  if (raw.partBoosts !== undefined && (raw.tournament === undefined || !object(raw.partBoosts) || ['attack','defense','speed','special','hp'].some(k => !whole((raw.partBoosts as Data)[k])))) return fail('unavailable');
  if (raw.bracket !== undefined && (!object(raw.bracket) || raw.bracket.schemaVersion !== 'arena-bracket-1'
    || raw.bracket.matchId !== id || !whole(raw.bracket.boundAtMs) || raw.bracket.boundAtMs < raw.issuedAtMs)) return fail('unavailable');
  assertFiniteTree(raw);
  const live = object(raw.duel) && raw.duel.mode === FIGHT_REPLAY_MODE;
  if (raw.duel !== undefined && !live && (!object(raw.duel) || raw.duel.mode !== 'resolver' || raw.duel.schemaVersion !== DUEL_RECEIPT_SCHEMA || raw.tournament !== undefined || raw.bracket !== undefined
    || !object(raw.duel.input) || !whole(raw.duel.input.seed) || raw.duel.input.seed > 0xffffffff || !Array.isArray(raw.duel.input.player) || raw.duel.input.player.length !== 1 || !Array.isArray(raw.duel.input.opponent) || raw.duel.input.opponent.length !== 1)) return fail('unavailable');
  if (live) {
    // arena-live-1: the pinned input-log issue (structure + rules hash via the verifier's own reader), 1v1, bound to this match.
    if (raw.tournament !== undefined || raw.bracket !== undefined || typeof raw.duel.rulesId !== 'string' || !raw.duel.rulesId.endsWith(`:${id}`)) return fail('unavailable');
    let issue: FightReplayIssueWire;
    try { issue = readIssue(raw.duel).issue; } catch { return fail('unavailable'); }
    if (issue.player.roster.length !== 1 || issue.cpu.roster.length !== 1 || !object(raw.entrant) || !object(raw.opponent)
      || issue.player.roster[0].holobotId !== raw.entrant.holobotId || issue.cpu.roster[0].holobotId !== raw.opponent.holobotId) return fail('unavailable');
  }
  if (raw.duelReceipt !== undefined && (!object(raw.duel) || raw.duel.mode !== 'resolver' || raw.state !== 'settled' || !object(raw.duelReceipt) || raw.duelReceipt.schemaVersion !== DUEL_RECEIPT_SCHEMA)) return fail('unavailable');
  if (raw.fightReceipt !== undefined && (!live || raw.state !== 'settled' || !object(raw.fightReceipt) || raw.fightReceipt.schemaVersion !== FIGHT_RECEIPT_SCHEMA
    || raw.fightReceipt.battleId !== id || raw.fightReceipt.verified !== true)) return fail('unavailable');
  if (raw.progression !== undefined && (raw.state !== 'settled' || !Array.isArray(raw.progression))) return fail('unavailable');
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
    || entry.matchId !== id || !['tokens','pass'].includes(entry.method) || !whole(entry.amount)
    // early-progression-1: the account's one starter entry is charged nothing (amount 0, starterFree true, never a cup).
    || (entry.starterFree !== undefined && (entry.starterFree !== true || raw.tournament !== undefined))
    || (entry.starterFree === true ? entry.amount !== 0 : entry.amount === 0 || entry.amount !== (entry.method === 'pass' ? 1 : rules.entryFeeHolos))
    || (rules.winBonusCap !== undefined && (!finite(rules.winBonusCap) || rules.winBonusCap < 1 || rules.winBonusCap > 10 || !live))
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
  // no-loss-before-fight (Pak 2026-11-11): the refund receipt of a live match left during its countdown carries leftBeforeFight: true;
  // it is the only refund of a started match (cancelled inside the window, so never expired), and the marker appears nowhere else.
  if (receipt.leftBeforeFight !== undefined && (receipt.leftBeforeFight !== true || receipt.outcome !== 'cancelled_before_start' || !live || !started || raw.state !== 'cancelled')) return fail('unavailable');
  if (receipt.outcome === 'cancelled_before_start') {
    const refund = receipt.refund;
    if (raw.state === 'settled' || (receipt.leftBeforeFight === true ? false : raw.startedAtMs !== null) || receipt.refunded !== true || receipt.settlement !== null
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
    // arena-live-1: a log that failed replay closes the match as this forfeit (closedBy 'replay_mismatch'), never anything else.
    if (receipt.closedBy !== undefined && (receipt.closedBy !== 'replay_mismatch' || !live || report.playerFinalHealth !== entrant.currentHealth)) return fail('unavailable');
    // forfeit-is-loss: only a live match closed after start without a result (cancelled, a mismatch closure, or expired unplayed:
    // Pak 2026-11-11, timing out is a loss) at its issue-time HP is counted as a loss.
    if (receipt.countedAsLoss !== undefined && (receipt.countedAsLoss !== true || !live || report.playerFinalHealth !== entrant.currentHealth)) return fail('unavailable');
    return raw as Match;
  }
  const settlement = receipt.settlement;
  if (raw.state !== 'settled' || !['win','loss'].includes(receipt.outcome) || !object(settlement)
    || !health(report.opponentFinalHealth,opponent.maxHealth)
    || (raw.bracket ? !['player','opponent'].includes(report.bracketWinner)
      || (receipt.outcome === 'win') !== (report.bracketWinner === 'player')
      || (report.bracketWinner === 'player' ? report.playerFinalHealth <= 0 : report.opponentFinalHealth <= 0)
      : live ? !['player','opponent','draw'].includes(report.fightWinner)
        || (receipt.outcome === 'win') !== (report.fightWinner === 'player')
        || raw.fightReceipt === undefined || raw.fightReceipt.winner !== report.fightWinner
      : raw.duel ? !['player','opponent'].includes(report.resolverWinner)
        || (receipt.outcome === 'win') !== (report.resolverWinner === 'player')
        || (report.resolverWinner === 'player' ? report.playerFinalHealth <= 0 : report.opponentFinalHealth <= 0)
        || raw.duelReceipt === undefined
      : (report.playerFinalHealth === 0) === (report.opponentFinalHealth === 0)
        || (receipt.outcome === 'win') !== (report.opponentFinalHealth === 0))
    || !whole(report.combosCompleted) || report.combosCompleted > rules.maxPerformanceEvents
    || !whole(report.perfectDefenses) || report.perfectDefenses > rules.maxPerformanceEvents) return fail('unavailable');
  const won = receipt.outcome === 'win';
  if (settlement.payoutWithheld !== undefined) {
    // S1: a settle past the daily cap, or a loss under the floor, closes the match and pays nothing.
    if (!['daily_cap','under_floor'].includes(settlement.payoutWithheld) || (settlement.payoutWithheld === 'under_floor' && won)
      || settlement.exp !== 0 || settlement.awardedExp !== 0 || settlement.syncPoints !== 0 || settlement.holos !== 0 || settlement.blueprints !== null) return fail('unavailable');
    return raw as Match;
  }
  // early-progression-1: a live match issued with rules.winBonusCap caps the win multiplier; firstWinOfDay (live wins only)
  // doubles EXP and Holos after the cap. Records without either field are checked exactly as before.
  if (settlement.firstWinOfDay !== undefined && (settlement.firstWinOfDay !== true || !won || !live)) return fail('unavailable');
  const firstWin = settlement.firstWinOfDay === true ? FIRST_WIN_OF_DAY_MULTIPLIER : 1;
  const bonus = Math.min(1 + rules.comboBonus * report.combosCompleted + rules.perfectDefenseBonus * report.perfectDefenses, rules.winBonusCap ?? Infinity);
  const exp = Math.floor(rules.exp * (won ? bonus : rules.lossExpFraction)) * firstWin;
  const sync = Math.floor(rules.syncPoints * (won ? bonus : rules.lossSyncFraction));
  const blueprint = settlement.blueprints;
  if (!whole(settlement.exp) || settlement.exp !== exp || !whole(settlement.awardedExp)
    || ![exp,exp * rules.expBoosterMultiplier].includes(settlement.awardedExp)
    || !whole(settlement.syncPoints) || settlement.syncPoints !== sync
    || !whole(settlement.holos) || settlement.holos !== (won ? rules.holos * firstWin : 0)
    || (won ? !object(blueprint) || blueprint.holobotKey !== toHolobotKey(opponent.name) || blueprint.amount !== rules.blueprints : blueprint !== null)) return fail('unavailable');
  return raw as Match;
}
function counter(profile: Data, key: string): number {
  const n = profile[key] ?? 0;
  if (!whole(n)) return fail('unavailable');
  return n;
}
/** The one owned record for `id`, with its derived progression fields self-healed (lib/holobotRecordRepair: never
 * raises level / XP / points / boosts). `holobots` is the profile array with that record replaced; `changes` lists
 * what the heal rewrote (empty = stored record already canonical). Unhealable -> holobot_record_invalid + reason. */
function uniqueEntrant(profile: Data, id: string): { bot: Data; holobots: Data[]; changes: RepairChange[] } {
  if (!Array.isArray(profile.holobots)) return fail('unavailable');
  const index = profile.holobots.findIndex((h: unknown) => object(h) && typeof h.name === 'string' && toHolobotKey(h.name) === id);
  const found = profile.holobots.filter((h: unknown) => object(h) && typeof h.name === 'string' && toHolobotKey(h.name) === id);
  if (found.length !== 1 || !Object.hasOwn(HOLOBOT_BASE_STATS,id.toUpperCase())) return fail('invalid_request');
  // These legacy profile fields were owner-writable. Heal or refuse before calling the progression loop.
  const healed = repairHolobotProgression(found[0], `holobots.${id}`);
  if (!healed.ok) throw new ArenaError(ARENA_HOLOBOT_RECORD_INVALID, undefined, healed.reason);
  const holobots = profile.holobots.map((h: Data, i: number) => i === index ? healed.holobot : h);
  return { bot: healed.holobot, holobots, changes: healed.changes };
}
function reply(stored: Match, alreadyProcessed = false) {
  const tier = ARENA_TIERS.findIndex(row => row.id === stored.tierId);
  // The resolver seed never leaves the host before settle; receipt and progression travel at the top level.
  // arena-live-1: an input-log match serves its whole pinned issue block (seed included, by design: the phone predicts the CPU
  // locally), exactly the rival-battle-3 `duel` block; the settle's duel-receipt-2 travels at the top level as `fightReceipt`.
  // The plausibility read is host-only (as on the rival host).
  const { duel, duelReceipt, fightReceipt, fightPlausibility: _plausibility, progression, partBoosts: _partBoosts, ...m } = stored; // Part boosts are host-only: they reach clients as the bracket's fighter.
  const resolver = !duel ? {} : duel.mode === FIGHT_REPLAY_MODE ? { duel: { ...duel } }
    : { duel: { mode: 'resolver', schemaVersion: duel.schemaVersion, maxRounds: DUEL_MAX_ROUNDS, player: duel.input.player, opponent: duel.input.opponent } };
  // early-progression-1: the settle that spent the day's first live win (and its replays) says so at the top level.
  const firstWin = m.settlementReceipt?.settlement?.firstWinOfDay === true && whole(m.closedAtMs) ? { firstWinOfDay: firstWinWire(utcDayOf(m.closedAtMs)) } : {};
  return { schemaVersion: ARENA_MATCH_SCHEMA, matchId: m.matchId, alreadyProcessed, ...resolver, ...(duelReceipt ? { duelReceipt } : {}), ...(fightReceipt ? { [FIGHT_RECEIPT_FIELD]: fightReceipt } : {}), ...(progression ? { progression } : {}), ...firstWin, match: {
    ...m, entrant: { ...m.entrant, ...arenaFighterSnapshot({holobotId:m.entrant.holobotId,level:m.entrant.level}, tier) },
    opponent: { ...m.opponent, ...arenaFighterSnapshot({holobotId:m.opponent.holobotId,level:m.opponent.level}, tier) },
  } };
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
function rewards(profile: Data, m: Match, c: Command, now: number, bracketWon?:boolean, withheld?: 'daily_cap'|'under_floor', firstWinOfDay = false) {
  const r = m.rules, won = bracketWon ?? c.opponentFinalHealth === 0, pays = withheld === undefined;
  // early-progression-1: rules.winBonusCap (live matches) caps the multiplier; the day's first live win doubles EXP + Holos after it.
  const firstWin = firstWinOfDay && won && pays;
  const bonus = Math.min(1 + r.comboBonus * c.combosCompleted + r.perfectDefenseBonus * c.perfectDefenses, r.winBonusCap ?? Infinity);
  const exp = pays ? Math.floor(r.exp * (won ? bonus : r.lossExpFraction)) * (firstWin ? FIRST_WIN_OF_DAY_MULTIPLIER : 1) : 0;
  const syncPoints = pays ? Math.floor(r.syncPoints * (won ? bonus : r.lossSyncFraction)) : 0;
  const holos = won && pays ? r.holos * (firstWin ? FIRST_WIN_OF_DAY_MULTIPLIER : 1) : 0;
  const awardedExp = exp * (finite(profile.expBoosterActiveUntil) && profile.expBoosterActiveUntil > now ? r.expBoosterMultiplier : 1);
  const entrant = uniqueEntrant(profile, m.entrant.holobotId);
  const blueprints = { ...(profile.blueprints ?? {}) };
  if (!object(profile.blueprints ?? {} ) || Object.values(blueprints).some(n => !whole(n))) fail('unavailable');
  const blueprint = won && pays ? { holobotKey: m.opponent.name.toLowerCase(), amount: r.blueprints } : null;
  if (blueprint) blueprints[blueprint.holobotKey] = (blueprints[blueprint.holobotKey] ?? 0) + blueprint.amount;
  const progression: HolobotProgressionEntry[] = [];
  const updates: Data = {
    blueprints,
    holobots: entrant.holobots.map((h: Data) => {
      if (h !== entrant.bot) return h;
      // entrant.bot is already healed (nextLevelExp = the level's real threshold); the override is kept as main had it.
      const after = applyHolobotExperience({ ...h, nextLevelExp: calculateExperience(normalizeUserHolobot(h).level + 1) }, awardedExp);
      progression.push(holobotProgressionRow(m.entrant.holobotId, awardedExp, normalizeUserHolobot(h), after));
      return after;
    }),
    holosTokens: counter(profile,'holosTokens') + holos,
    wins: counter(profile,'wins') + (won ? 1 : 0), losses: counter(profile,'losses') + (won ? 0 : 1),
    syncPoints: counter(profile,'syncPoints') + syncPoints,
    // S2: the server-only daily-mission ledger + the rewardSystem display mirror.
    ...dailyMissionCounterUpdates(profile, 'arenaBattlesToday', new Date(now)),
  };
  assertFiniteTree(updates);
  return { updates, progression, repairs: entrant.changes, settlement: { exp, awardedExp, holos, syncPoints, blueprints: blueprint, ...(withheld ? { payoutWithheld: withheld } : {}), ...(firstWin ? { firstWinOfDay: true } : {}) }, outcome: won ? 'win' : 'loss' };
}

/** arena-live-1: the settle-time replay, run OUTSIDE the transaction (rivalBattleStore.preVerifyFightReplay's rule: the CPU work
 * never repeats on a transaction retry). `mismatch` = the replay did not reproduce the log (the transaction closes the match). */
type ArenaFightPre = { issue: FightReplayIssueWire; verdict?: FightReplayVerdict; mismatch?: Record<string, unknown> };
async function preVerifyArenaFight(firestore: Firestore, uid: string, c: Command): Promise<ArenaFightPre | undefined> {
  if (c.operation !== 'settle' || c[FIGHT_LOG_FIELD] === undefined) return undefined;
  const pre = (await firestore.doc(`arenaMatches/${uid}/matches/${c.matchId}`).get()).data();
  // Anything but an open input-log match is ruled inside the transaction (replay of a settled match, unknown_match, invalid_state...).
  if (!object(pre) || pre.state !== 'active' || !object(pre.duel) || pre.duel.mode !== FIGHT_REPLAY_MODE) return undefined;
  const issue = pre.duel as FightReplayIssueWire;
  try {
    const verdict = verifyFightReplay(issue, c[FIGHT_LOG_FIELD], { battleId: c.matchId });
    console.info(JSON.stringify({ event: 'arena_fight_replay_verified', matchId: c.matchId, ticks: verdict.ticks, replayMs: Math.round(verdict.replayMs * 10) / 10, winner: verdict.receipt.winner }));
    return { issue, verdict };
  } catch (e) {
    if (!(e instanceof FightReplayError)) throw e;
    if (e.code === 'invalid_issue') throw new ArenaError('unavailable');
    console.warn(JSON.stringify({ event: 'arena_fight_replay_rejected', matchId: c.matchId, code: e.code, ...e.detail }));
    // An undecodable log is not a mismatch: nothing is written and the match stays open (the rival host's rule).
    if (e.code === 'invalid_log') throw new ArenaError('invalid_request', undefined, 'invalid_log', e.detail);
    return { issue, mismatch: e.detail };
  }
}
/** Marks a transaction result whose error is thrown only after the transaction committed its writes. */
const THROW_AFTER_COMMIT = '__throwAfterCommit';

/** forfeit-is-loss (Pak 2026-11-11): a live match closed after start without a verified result (cancel, a log that failed replay,
 * or its expiry unplayed) is recorded as a loss: `losses` + 1 (wins unchanged) and one settle counted toward the daily CPU cap
 * (cpuPayouts, as a lost settle under the cap counts). Never paid: no EXP, Sync, Holos, blueprints, daily-mission count or rank kit;
 * the fee stays kept and the HP ledger keeps the issue-time value. Its only read precedes every write the caller makes. */
async function liveForfeitLoss(tx: Transaction, parentRef: DocumentReference, profile: Data, nowMs: number): Promise<Data> {
  const payoutsRef = parentRef.collection('ledger').doc('cpuPayouts');
  const paid = paidToday((await tx.get(payoutsRef)).data(), nowMs);
  const losses = counter(profile,'losses') + 1;
  if (paid < ARENA_CPU_DAILY_PAYOUT_CAP) tx.set(payoutsRef,{schemaVersion:ARENA_CPU_PAYOUTS_SCHEMA,day:utcDay(nowMs),paidSettles:paid+1});
  return { losses };
}
/** The after-start forfeit receipt of a live match closed without a result, at its issue-time HP (the vitals ledger row as issued). */
function liveForfeitClose(profile: Data, m: Match, nowMs: number, extra: Data = {}): { receipt: Data; vitals: Vitals } {
  const issued: Vitals = {[m.entrant.holobotId]:{currentHealth:m.entrant.currentHealth,maxHealth:m.entrant.maxHealth}};
  const vitals = settleVitals(profile,issued,[{holobotId:m.entrant.holobotId,currentHealth:m.entrant.currentHealth}],nowMs);
  return { vitals: commitVitals(profile.holobotVitals,vitals,nowMs), receipt: {matchId:m.matchId,outcome:'forfeit',refunded:false,settlement:null,report:{playerFinalHealth:m.entrant.currentHealth},closedAtMs:nowMs,...extra,countedAsLoss:true,
    finalVitals:{[m.entrant.holobotId]:vitals[m.entrant.holobotId]}} };
}
/**
 * forfeit-is-loss (Pak 2026-11-11: timing out is a loss). Before an issue, resume or settle, the account's open Arena match, when it
 * is a STARTED live (input-log) match already past its 30 min TTL, is closed in its own transaction as the after-start forfeit's
 * loss: state 'expired', outcome 'forfeit', countedAsLoss, losses + 1, one CPU-cap count, fee kept, HP as issued, lease freed.
 * Counted once (the match becomes terminal). A match never started is left alone (its cancel still refunds); resolver, legacy
 * and cup matches are never touched. A cancel needs no sweep: its own transaction records the same loss.
 */
async function sweepExpiredLiveMatch(firestore: Firestore, uid: string, nowMs: number): Promise<void> {
  const parentRef = firestore.doc(`arenaMatches/${uid}`), userRef = firestore.doc(`users/${uid}`);
  const stale = (parent: Data | undefined, m: Data | undefined) => object(parent) && parent.open === true && object(m) && m.state === 'active'
    && object(m.duel) && m.duel.mode === FIGHT_REPLAY_MODE && whole(m.expiresAtMs) && nowMs > m.expiresAtMs && m.tournament === undefined && m.bracket === undefined;
  const pre = (await parentRef.get()).data();
  if (!object(pre) || pre.open !== true || typeof pre.matchId !== 'string' || !/^am_[a-f0-9]{32}$/.test(pre.matchId)) return;
  const matchRef = parentRef.collection('matches').doc(pre.matchId);
  if (!stale(pre, (await matchRef.get()).data())) return;
  await firestore.runTransaction(async tx => {
    const parent = (await tx.get(parentRef)).data(), raw = (await tx.get(matchRef)).data();
    if (!stale(parent, raw) || parent!.matchId !== pre.matchId || !arenaOpen(parent)) return;
    const m = match(raw, pre.matchId);
    const user = await tx.get(userRef);
    if (!user.exists) return;
    const profile = user.data()!;
    const closed = liveForfeitClose(profile, m, nowMs);
    const updates: Data = { ...(await liveForfeitLoss(tx, parentRef, profile, nowMs)), holobotVitals: closed.vitals };
    assertFiniteTree(updates);
    const next: Match = {...m,state:'expired',closedAtMs:nowMs,settlementReceipt:closed.receipt};
    match(next,m.matchId);
    tx.update(userRef,updates);
    tx.set(matchRef,next);
    tx.set(parentRef,{...parent,open:false,closedAtMs:nowMs});
  });
}

export async function transactArenaMatch(firestore: Firestore, uid: string, raw: unknown, nowMs = Date.now(), options: ArenaMatchOptions = {}) {
  const c = command(raw);
  if (!whole(nowMs)) return fail('invalid_request');
  const generatedId = `am_${randomBytes(16).toString('hex')}`; // Stable across transaction retries.
  const duelSeed = randomBytes(4).readUInt32LE(0); // Resolver seed: pinned here, never disclosed before settle.
  // arena-live-1: the input-log seed, pinned outside retries (disclosed at issue). Tests may pin it; the callable never does.
  const fightSeed = options.fightSeed ? options.fightSeed() : randomBytes(32).toString('hex');
  const arenaFightReplay = options.arenaFightReplay ?? arenaFightReplayEnabled();
  const fightChase = options.fightChase ?? process.env[FIGHT_CHASE_FLAG] === '1';
  const fightAttrs = options.fightAttrs ?? process.env[FIGHT_ATTRS_FLAG] === '1';
  const parentRef = firestore.doc(`arenaMatches/${uid}`), userRef = firestore.doc(`users/${uid}`);
  // The live fields join the identity only when sent, so an old client's requestId hashes exactly as before.
  const identity = c.operation === 'issue' ? createHash('sha256').update(JSON.stringify([c.tierId,c.paymentMethod,c.holobotId,c.opponentName,...(c.tournamentId === undefined ? [] : [c.tournamentId]),...(c.duelSchema === undefined ? [] : [{duelSchema:c.duelSchema}]),
    ...(c[FIGHT_INPUTS_CAPABILITY_FIELD] === undefined ? [] : [{duelInputs:c[FIGHT_INPUTS_CAPABILITY_FIELD]}]),...(c[FIGHT_RULES_CAPABILITY_FIELD] === undefined ? [] : [{fightRules:c[FIGHT_RULES_CAPABILITY_FIELD]}])])).digest('hex') : '';
  try {
    if (c.operation === 'issue' || c.operation === 'resume' || c.operation === 'settle') await sweepExpiredLiveMatch(firestore, uid, nowMs);
    const fightPre = await preVerifyArenaFight(firestore, uid, c);
    const out = await firestore.runTransaction(async tx => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) return fail('unavailable');
      const profile = userSnap.data()!;
      if (c.operation === 'issue') {
        const requestRef = parentRef.collection('requests').doc(c.requestId);
        const request = await tx.get(requestRef);
        // hardening-2: issue replies carry payoutCapped so a client can warn before the fee. Advisory, read in this
        // transaction from the server-only cpuPayouts ledger (malformed -> unavailable, as settle). Never a refusal
        // (Pak call), and the fee is still charged: the persisted admission cannot express a free entry
        // (match(): rules.entryFeeHolos and entryReceipt.amount must be > 0 and equal the tier quote).
        // A tournament issue is never capped: it settles through the host bracket, outside the CPU cap.
        const payoutCapped = async () => c.tournamentId === undefined
          && paidToday((await tx.get(parentRef.collection('ledger').doc('cpuPayouts'))).data(), nowMs) >= ARENA_CPU_DAILY_PAYOUT_CAP;
        if (request.exists) {
          if (request.data()!.identity !== identity) return fail('request_conflict');
          const id = request.data()!.matchId;
          if (typeof id !== 'string' || !/^am_[a-f0-9]{32}$/.test(id)) return fail('unavailable');
          const saved = match((await tx.get(parentRef.collection('matches').doc(id))).data(),id);
          if (saved.requestId !== c.requestId) return fail('unavailable');
          return {...reply(saved,true), payoutCapped: await payoutCapped()};
        }
        const lease = await tx.get(parentRef);
        if (arenaOpen(lease.data())) return fail('activity_conflict');
        const rival = await tx.get(firestore.doc(`rivalBattles/${uid}`));
        const zone = await tx.get(firestore.doc(`holoZoneRuns/${uid}`));
        const duel = await tx.get(firestore.doc(`duelHealingRuns/${uid}`));
        if(expeditionOpen(zone.data()))return fail('activity_conflict');
        guardOtherActivities(rival.data(),zone.data(),duel.data(),nowMs);
        const entrant = uniqueEntrant(profile,c.holobotId), owned = entrant.bot;
        requireLivingVitals(profile,[c.holobotId],nowMs); // Validates the whole ledger; NEVER invoke city 40% revival.
        const player = buildPlayerCombatants({...profile,holobots:entrant.holobots},[c.holobotId])[0];
        const tournament = c.tournamentId === undefined ? undefined : cupEntryAdmission(profile.storyFlags,c.tournamentId,player?.level,profile.pilotRank);
        if (!player || !finite(player.maxHealth) || player.maxHealth <= 0) return fail('unavailable');
        const current = effectiveVitals(profile.holobotVitals,nowMs)[c.holobotId]; // auto-heal-1: the regenerated HP
        const hp = current ? Math.min(current.currentHealth,player.maxHealth) : player.maxHealth;
        if (hp <= 0) return fail('holobot_ko');
        const vitals = commitVitals(profile.holobotVitals,{ ...(profile.holobotVitals ?? {}), [c.holobotId]: {currentHealth:hp,maxHealth:player.maxHealth} },nowMs);
        const tier = getArenaTier(c.tierId)!;
        const opponentStats = playerCombatant(c.opponentName.toLowerCase(), {name:c.opponentName,level:tier.opponentLevel});
        const field = c.paymentMethod === 'pass' ? 'arenaPassses' : 'holosTokens';
        // early-progression-1: the account's one starter entry (never a cup) charges nothing.
        const starterRef = parentRef.collection('ledger').doc(ARENA_STARTER_ENTRY_DOC);
        const starterFree = c.tournamentId === undefined && arenaStarterEntryAvailable((await tx.get(starterRef)).data());
        const amount = starterFree ? 0 : c.paymentMethod === 'pass' ? 1 : tier.entryFeeHolos;
        const before = counter(profile,field);
        if (before < amount) return fail('insufficient_funds');
        const capped = await payoutCapped(); // Last read: every write below follows it.
        // Opt-in resolver fight: both fighters and the seed are pinned at issue (the rivalBattleHost resolver block).
        let resolverDuel: Data | undefined;
        const tierIndex = ARENA_TIERS.findIndex(row => row.id === tier.id);
        // guard-hold-1: a duel-rules-7 ask is the duel-rules-6 ask + the guard block; stamina-wind-1: duel-rules-8 = rules-7 + stamina
        const rules8Asked = c[FIGHT_RULES_CAPABILITY_FIELD] === RULES_SCHEMA_8, rules7Asked = rules8Asked || c[FIGHT_RULES_CAPABILITY_FIELD] === RULES_SCHEMA_7;
        const rules6Asked = rules7Asked || c[FIGHT_RULES_CAPABILITY_FIELD] === RULES_SCHEMA_6;
        // live-tuning-1: a live match pins its own opponent (rookie at the entrant's level) and fights at FULL HP; the match stores
        // both (entrant currentHealth = max), so the settle maps the fight's end HP onto the ledger as min(ledger now, fight end)
        // (settleVitals never raises the ledger) and a forfeit leaves the ledger as it was. The ledger still needs HP > 0 to enter.
        let matchOpponent = opponentStats, entrantHp = hp;
        // arena-live-1: a live duel when the flag is on and the client declares duel-inputs-2 (the rival rule: the capability only opts
        // INTO the verified mode). A lineup the fight core cannot express (no kit / profile row) keeps the next mode down.
        if (arenaFightReplay && c[FIGHT_INPUTS_CAPABILITY_FIELD] === FIGHT_INPUTS_SCHEMA) {
          if (Math.floor(hp) <= 0) return fail('holobot_ko');
          const tempo = rules6Asked && fightChase && fightAttrs;
          const liveOpponent = playerCombatant(c.opponentName.toLowerCase(), {name:c.opponentName,level:arenaLiveOpponentLevel(tier.id,tier.opponentLevel,player.level)});
          const live = buildFightReplayIssue({battleId:generatedId,seed:fightSeed,tier:ARENA_FIGHT_RANK_TIER[tierIndex] ?? 0,mentor:false,
            player:[inputLogCombatant({...player,currentHealth:player.maxHealth},equippedPartBoosts(profile,c.holobotId),tempo,liveMoveRanksFor(profile,c.holobotId))],
            opponent:[{...liveOpponent,statSource:'progression' as const}],chase:fightChase,attrs:fightAttrs,tempo,live:true,guardHold:rules7Asked,staminaWind:rules8Asked});
          if (live) { resolverDuel = live as unknown as Data; matchOpponent = liveOpponent; entrantHp = player.maxHealth; }
        }
        // rival-live-only (Pak 2026-11-11), the rival host's rule: a live-only client (duel-inputs-2 + the duel-rules-6 ask, no
        // duelSchema) that cannot get an input-log match is refused here, before the fee, the match, the request row or the lease.
        if (!resolverDuel && c[FIGHT_INPUTS_CAPABILITY_FIELD] === FIGHT_INPUTS_SCHEMA && rules6Asked && c.duelSchema === undefined)
          throw new ArenaError('live_unavailable', undefined, arenaFightReplay ? 'lineup_unsupported' : 'replay_off');
        if (!resolverDuel && c.duelSchema === DUEL_RECEIPT_SCHEMA) {
          if (Math.floor(hp) <= 0) return fail('holobot_ko');
          const input = {seed:duelSeed,player:[duelFighterFromCombatant({...applyPartBoosts({...player,currentHealth:hp},equippedPartBoosts(profile,c.holobotId)),tier:tierIndex})],opponent:[duelFighterFromCombatant({...opponentStats,tier:tierIndex})]};
          resolveDuel({...input,playerIntents:['defend']}); // Validates the pinned block; RangeError -> unavailable.
          resolverDuel = {mode:'resolver',schemaVersion:DUEL_RECEIPT_SCHEMA,input};
        }
        // A cup has no opt-in (the host always plays its bracket), so its parts are pinned here for the bracket to use at start.
        const cupParts = tournament ? equippedPartBoosts(profile,c.holobotId) : undefined;
        const m: Match = {
          schemaVersion:ARENA_MATCH_SCHEMA,matchId:generatedId,requestId:c.requestId,state:'issued',tierId:tier.id as ArenaTierId,
          issuedAtMs:nowMs,expiresAtMs:nowMs+ARENA_MATCH_TTL_MS,startedAtMs:null,closedAtMs:null,
          entrant:{...player,name:owned.name,currentHealth:entrantHp,nextLevelExp:calculateExperience(player.level+1)},opponent:{...matchOpponent,name:c.opponentName},
          entryReceipt:{matchId:generatedId,method:c.paymentMethod,amount,balanceBefore:before,balanceAfter:before-amount,chargedAtMs:nowMs,...(starterFree ? {starterFree:true} : {})},
          // early-progression-1: a live match quotes the win-bonus cap (its win multiplier comes from the verified receipt).
          rules:{version:'arena-economy-legacy-1',entryFeeHolos:tier.entryFeeHolos,...getArenaBaseRewards(tier),blueprints:getArenaBlueprintAmount(tier),comboBonus:BATTLE_COMBO_BONUS,perfectDefenseBonus:BATTLE_PERFECT_DEFENSE_BONUS,lossExpFraction:BATTLE_LOSS_EXP_FRACTION,lossSyncFraction:BATTLE_LOSS_SYNC_FRACTION,maxPerformanceEvents:MAX_PERFORMANCE_EVENTS,expBoosterMultiplier:EXP_BOOSTER_MULTIPLIER,
            ...(resolverDuel?.mode === FIGHT_REPLAY_MODE ? {winBonusCap:LIVE_WIN_BONUS_CAP} : {})},
          settlementReceipt:null,...(tournament ? {tournament} : {}),...(cupParts && partBoostsChangeFight(cupParts) ? {partBoosts:cupParts} : {}),...(resolverDuel ? {duel:resolverDuel} : {}),
        };
        match(m,generatedId);
        tx.update(userRef,{[field]:before-amount,holobotVitals:vitals,
          ...(entrant.changes.length ? {holobots:entrant.holobots} : {}),
          ...(tournament && profile.pilotRank === undefined ? {pilotRank:tournament.pilotRankAtAdmission} : {})});
        recordAccountRepair(firestore,tx,uid,'arenaMatchHost.issue',entrant.changes,nowMs);
        if (starterFree) tx.set(starterRef,{schemaVersion:ARENA_STARTER_ENTRY_SCHEMA,state:'used',matchId:generatedId,usedAtMs:nowMs});
        tx.create(parentRef.collection('matches').doc(generatedId),m);
        tx.create(requestRef,{schemaVersion:ARENA_MATCH_SCHEMA,identity,matchId:generatedId,createdAtMs:nowMs});
        tx.set(parentRef,{schemaVersion:'arena-healing-1',recordSchemaVersion:ARENA_MATCH_SCHEMA,matchId:generatedId,open:true,issuedAtMs:nowMs,expiresAtMs:m.expiresAtMs});
        return {...reply(m), payoutCapped: capped};
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
      // forfeit-is-loss: a live match closed by its expiry answers a late settle exactly as before (match_expired); the loss is recorded.
      if (c.operation === 'settle' && m.state === 'expired' && m.duel?.mode === FIGHT_REPLAY_MODE && m.settlementReceipt?.countedAsLoss === true) return fail('match_expired');
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
      let duelOutcome: DuelReceipt | undefined, progression: HolobotProgressionEntry[] | undefined;
      let fightVerdict: FightReplayVerdict | undefined, mismatch: Record<string, unknown> | undefined;
      if (c.operation === 'cancel' && m.state === 'issued') {
        if (c.playerFinalHealth !== undefined) return fail('invalid_request');
        const field = m.entryReceipt.method === 'pass' ? 'arenaPassses' : 'holosTokens';
        const before = counter(profile,field);
        updates[field] = before + m.entryReceipt.amount;
        receipt = {matchId:m.matchId,outcome:'cancelled_before_start',refunded:true,refund:{method:m.entryReceipt.method,amount:m.entryReceipt.amount,balanceBefore:before,balanceAfter:updates[field]},settlement:null,closedAtMs:nowMs};
        nextState = nowMs > m.expiresAtMs ? 'expired' : 'cancelled';
      } else if (c.operation === 'cancel' && m.state === 'active' && m.duel?.mode === FIGHT_REPLAY_MODE && c[LEFT_BEFORE_FIGHT_FIELD] === true
        && nowMs <= m.expiresAtMs && leftBeforeFightInWindow(m.startedAtMs, nowMs)) {
        // no-loss-before-fight (Pak 2026-11-11): a LIVE match left during its countdown, claimed within the window of its start (when
        // the fight is handed to the stage): cancelled with NO loss and the entry refunded in full, as a cancel before start. No
        // losses, no cap count, no daily-mission count, HP ledger untouched. Later than the window: the after-start forfeit loss below.
        const field = m.entryReceipt.method === 'pass' ? 'arenaPassses' : 'holosTokens';
        const before = counter(profile,field);
        updates[field] = before + m.entryReceipt.amount;
        receipt = {matchId:m.matchId,outcome:'cancelled_before_start',refunded:true,refund:{method:m.entryReceipt.method,amount:m.entryReceipt.amount,balanceBefore:before,balanceAfter:updates[field]},settlement:null,closedAtMs:nowMs,leftBeforeFight:true};
        nextState = 'cancelled';
      } else {
        if (m.state !== 'active') return fail('invalid_state');
        // A stored mode is never downgraded or upgraded by the request.
        const resolver = m.duel?.mode === 'resolver', live = m.duel?.mode === FIGHT_REPLAY_MODE;
        // arena-live-1: a live match settles from its log only (no intents, no HP); every other mode refuses a log.
        if (live && c.operation === 'settle' && c[FIGHT_LOG_FIELD] === undefined) throw new ArenaError('invalid_request', undefined, 'input_log_required');
        if (resolver ? (c.operation === 'settle' ? c.playerIntents === undefined : c.playerFinalHealth !== undefined)
          : live ? c.playerIntents !== undefined || (c.operation === 'cancel' && c.playerFinalHealth !== undefined)
          : c.playerIntents !== undefined || c[FIGHT_LOG_FIELD] !== undefined) return fail('invalid_request');
        if (live && c.operation === 'settle') {
          if (nowMs > m.expiresAtMs) return fail('match_expired');
          // The replay ran before the transaction against this same immutable issue; a record that changed in between (or a
          // start that raced the pre-read) is never settled from a stale verdict: retryable, the same log is resent.
          if (!fightPre || fightPre.issue.rulesHash !== m.duel.rulesHash || fightPre.issue.seed !== m.duel.seed) return fail('unavailable');
          if (fightPre.mismatch) mismatch = fightPre.mismatch;
          else {
            fightVerdict = fightPre.verdict!;
            // The rival input-log rule: a verified WIN sooner than ARENA_MIN_WIN_MS_LIVE after start changes nothing and may be
            // resent after retryAfterMs; a loss is never too fast.
            const sinceStart = nowMs - m.startedAtMs;
            if (fightVerdict.receipt.winner === 'player' && sinceStart < ARENA_MIN_WIN_MS_LIVE) throw new ArenaError('too_fast', ARENA_MIN_WIN_MS_LIVE - sinceStart);
          }
        }
        if (resolver && c.operation === 'settle') {
          if (nowMs > m.expiresAtMs) return fail('match_expired');
          // Refused BEFORE resolving and for every outcome: an outcome-dependent refusal that writes nothing would let a
          // client try plans until one wins. The stricter rule replaces the legacy "loss under the floor pays nothing".
          const sinceStart = nowMs - m.startedAtMs;
          if (sinceStart < ARENA_MIN_SETTLE_MS_CPU) throw new ArenaError('too_fast', ARENA_MIN_SETTLE_MS_CPU - sinceStart);
          duelOutcome = resolveDuel({...m.duel.input,playerIntents:c.playerIntents});
        }
        const entrantVitals = m.entrant as {currentHealth:number;maxHealth:number};
        const finalHealth = resolver ? (duelOutcome ? ledgerHealthAfterFight(duelOutcome.playerFinal[0].currentHealth,duelOutcome.playerFinal[0].maxHealth,entrantVitals) : m.entrant.currentHealth)
          // Live: the replay's HP, as the same fraction of max on the ledger's scale (the rival settle's rule); a forfeit or a
          // mismatch closure keeps the issue-time HP.
          : live ? (fightVerdict ? ledgerHealthAfterFight(fightVerdict.receipt.playerFinal[0].currentHealth,fightVerdict.receipt.playerFinal[0].maxHealth,entrantVitals) : m.entrant.currentHealth)
          : c.playerFinalHealth;
        if (!finite(finalHealth) || finalHealth < 0 || finalHealth > m.entrant.currentHealth) return fail('invalid_request');
        const issued: Vitals = {[m.entrant.holobotId]:{currentHealth:m.entrant.currentHealth,maxHealth:m.entrant.maxHealth}};
        const vitals = settleVitals(profile,issued,[{holobotId:m.entrant.holobotId,currentHealth:finalHealth}],nowMs);
        if (duelOutcome || fightVerdict) {
          const payoutsRef = parentRef.collection('ledger').doc('cpuPayouts');
          const paid = paidToday((await tx.get(payoutsRef)).data(), nowMs);
          const withheld = paid >= ARENA_CPU_DAILY_PAYOUT_CAP ? 'daily_cap' as const : undefined;
          const fightOpponent = fightVerdict?.receipt.opponentFinal[0];
          const won = duelOutcome ? duelOutcome.winner === 'player' : fightVerdict!.receipt.winner === 'player';
          // Live: the opponent's HP on the stored opponent's scale (a duel-rules-5 fight max carries the #72.80 row delta).
          const opponentFinalHealth = duelOutcome ? duelOutcome.opponentFinal[0].currentHealth
            : ledgerHealthAfterFight(fightOpponent!.currentHealth,fightOpponent!.maxHealth,{currentHealth:m.opponent.maxHealth,maxHealth:m.opponent.maxHealth});
          // Performance bonuses are client reports on the legacy path; the bracket's rule (0 / 0) applies on the resolver fight.
          // early-progression-1: a live WIN on a match issued with rules.winBonusCap takes its counts from the verified receipt
          // (lib/liveWinRewards.livePerformanceFromReceipt), capped by that quote; the day's first live win doubles EXP + Holos.
          const perf = fightVerdict && won && m.rules.winBonusCap !== undefined ? livePerformanceFromReceipt(fightVerdict.receipt) : {perfectDefenses:0,combosCompleted:0};
          const firstWinRef = firestore.doc(`${FIRST_WIN_COLLECTION}/${uid}`);
          const firstWin = !!fightVerdict && won && withheld === undefined && firstWinAvailable((await tx.get(firstWinRef)).data(), nowMs);
          const result = rewards(profile,m,{...c,combosCompleted:perf.combosCompleted,perfectDefenses:perf.perfectDefenses},nowMs,won,withheld,firstWin);
          updates = withRankHealingReward(profile, result.updates);
          progression = result.progression;
          receipt = {matchId:m.matchId,outcome:result.outcome,refunded:false,settlement:result.settlement,report:{playerFinalHealth:finalHealth,opponentFinalHealth,combosCompleted:perf.combosCompleted,perfectDefenses:perf.perfectDefenses,
            ...(duelOutcome ? {resolverWinner:duelOutcome.winner} : {fightWinner:fightVerdict!.receipt.winner})},closedAtMs:nowMs};
          if (withheld === undefined) tx.set(payoutsRef,{schemaVersion:ARENA_CPU_PAYOUTS_SCHEMA,day:utcDay(nowMs),paidSettles:paid+1});
          if (firstWin) tx.set(firstWinRef, firstWinRecord('arena', m.matchId, nowMs));
          // server-rulings-1 ruling 4, as on the rival host: a verified WIN carries its plausibility read; a flagged one is also listed
          // for admins. Never refuses, never withholds.
          if (fightVerdict && won) {
            const p = fightVerdict.plausibility;
            if (p.flagged) tx.set(firestore.doc(`${FIGHT_PLAUSIBILITY_COLLECTION}/${uid}_${m.matchId}`), { uid, matchId: m.matchId, source: 'arena', flaggedAtMs: nowMs,
              ...p, inputsHash: fightVerdict.receipt.inputsHash, rulesId: fightVerdict.receipt.rulesId, endTick: fightVerdict.receipt.endTick, reviewed: false });
          }
          nextState = 'settled';
        } else if (c.operation === 'settle' && mismatch) {
          // arena-live-1: a log that failed replay pays nothing and closes the match as the after-start forfeit (fee kept, HP as
          // issued, lease freed); replay_mismatch is reported after the commit. forfeit-is-loss: counted as that forfeit's loss.
          receipt = {matchId:m.matchId,outcome:'forfeit',refunded:false,settlement:null,report:{playerFinalHealth:finalHealth},closedAtMs:nowMs,closedBy:'replay_mismatch',replayRejection:mismatch,countedAsLoss:true};
          Object.assign(updates, await liveForfeitLoss(tx, parentRef, profile, nowMs));
          nextState = 'cancelled';
        } else if (c.operation === 'settle') {
          if (nowMs > m.expiresAtMs) return fail('match_expired');
          if (c.combosCompleted > m.rules.maxPerformanceEvents || c.perfectDefenses > m.rules.maxPerformanceEvents || c.opponentFinalHealth > m.opponent.maxHealth || (c.playerFinalHealth === 0) === (c.opponentFinalHealth === 0)) return fail('invalid_request');
          // S1 (bounded): floor, performance clamp and daily payout cap. Every read precedes the writes below.
          const elapsedMs = nowMs - m.startedAtMs, won = c.opponentFinalHealth === 0;
          if (won && elapsedMs < ARENA_MIN_SETTLE_MS_CPU) throw new ArenaError('too_fast', ARENA_MIN_SETTLE_MS_CPU - elapsedMs);
          const reported: Command = {...c,
            combosCompleted: Math.min(c.combosCompleted, m.rules.maxPerformanceEvents, Math.floor(elapsedMs / ARENA_MS_PER_COMBO)),
            perfectDefenses: Math.min(c.perfectDefenses, m.rules.maxPerformanceEvents, Math.floor(elapsedMs / ARENA_MS_PER_PERFECT_DEFENSE))};
          const payoutsRef = parentRef.collection('ledger').doc('cpuPayouts');
          const paid = paidToday((await tx.get(payoutsRef)).data(), nowMs);
          const withheld = elapsedMs < ARENA_MIN_SETTLE_MS_CPU ? 'under_floor' : paid >= ARENA_CPU_DAILY_PAYOUT_CAP ? 'daily_cap' : undefined;
          const result = rewards(profile,m,reported,nowMs,undefined,withheld);
          updates = withRankHealingReward(profile, result.updates); // #72 rank-tier Kit, moved off the closed legacy settle.
          progression = result.progression;
          recordAccountRepair(firestore,tx,uid,'arenaMatchHost.settle',result.repairs,nowMs);
          receipt = {matchId:m.matchId,outcome:result.outcome,refunded:false,settlement:result.settlement,report:{playerFinalHealth:c.playerFinalHealth,opponentFinalHealth:c.opponentFinalHealth,combosCompleted:reported.combosCompleted,perfectDefenses:reported.perfectDefenses},closedAtMs:nowMs};
          if (withheld === undefined) tx.set(payoutsRef,{schemaVersion:ARENA_CPU_PAYOUTS_SCHEMA,day:utcDay(nowMs),paidSettles:paid+1});
          nextState = 'settled';
        } else {
          // forfeit-is-loss (Pak 2026-11-11): cancelling a LIVE match after start is a loss (countedAsLoss), inside its TTL and past it
          // (timing out is a loss: the wait-then-cancel case). A resolver or legacy cancel closes exactly as before.
          const countedAsLoss = live;
          receipt = {matchId:m.matchId,outcome:'forfeit',refunded:false,settlement:null,report:{playerFinalHealth:finalHealth},closedAtMs:nowMs,...(countedAsLoss ? {countedAsLoss:true} : {})};
          if (countedAsLoss) Object.assign(updates, await liveForfeitLoss(tx, parentRef, profile, nowMs));
          nextState = nowMs > m.expiresAtMs ? 'expired' : 'cancelled';
        }
        updates.holobotVitals = commitVitals(profile.holobotVitals,vitals,nowMs);
        receipt.finalVitals = {[m.entrant.holobotId]:vitals[m.entrant.holobotId]};
      }
      assertFiniteTree(updates);
      const next: Match = {...m,state:nextState,closedAtMs:nowMs,settlementReceipt:receipt,...(duelOutcome ? {duelReceipt:duelOutcome} : {}),...(progression ? {progression} : {}),
        ...(fightVerdict ? {fightReceipt:fightVerdict.receipt,...(fightVerdict.receipt.winner === 'player' ? {fightPlausibility:fightVerdict.plausibility} : {})} : {})};
      match(next,m.matchId);
      tx.update(userRef,updates);
      tx.set(matchRef,next);
      tx.set(parentRef,{...parent,open:false,closedAtMs:nowMs});
      // early-progression-1: refunding the free starter entry gives the account its free entry back.
      if (receipt.outcome === 'cancelled_before_start' && m.entryReceipt.starterFree === true)
        tx.set(parentRef.collection('ledger').doc(ARENA_STARTER_ENTRY_DOC),{schemaVersion:ARENA_STARTER_ENTRY_SCHEMA,state:'available',restoredFromMatchId:m.matchId,restoredAtMs:nowMs});
      if (mismatch) return {[THROW_AFTER_COMMIT]: new ArenaError('replay_mismatch', undefined, undefined, mismatch)};
      return reply(next);
    });
    const deferred = (out as Record<string, unknown>)[THROW_AFTER_COMMIT];
    if (deferred instanceof ArenaError) throw deferred;
    return out;
  } catch (e) {
    if (e instanceof StoryError) throw new ArenaError(e.code);
    if (e instanceof HealthError) throw new ArenaError(e.message === 'holobot_ko' ? 'holobot_ko' : e.message === 'invalid_request' ? 'invalid_request' : 'unavailable', undefined, undefined, e.message === 'holobot_ko' ? e.detail : undefined);
    if (e instanceof ActivityError || e instanceof RivalError || e instanceof HoloZoneError || e instanceof PilotRankError || e instanceof RangeError) throw new ArenaError('unavailable');
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
  const finalVitals=settleVitals(profile,issued,[{holobotId:m.entrant.holobotId,currentHealth:playerFinalHealth}],nowMs);
  updates.holobotVitals=commitVitals(profile.holobotVitals,finalVitals,nowMs);
  const next:Match={...resolved,state:'settled',closedAtMs:nowMs,settlementReceipt:{matchId:m.matchId,outcome:result.outcome,refunded:false,
    settlement:result.settlement,report:{playerFinalHealth,opponentFinalHealth,combosCompleted:0,perfectDefenses:0,bracketWinner:won?'player':'opponent'},closedAtMs:nowMs,
    finalVitals:{[m.entrant.holobotId]:finalVitals[m.entrant.holobotId]}},progression:result.progression};
  assertFiniteTree(updates);match(next,m.matchId);
  return {updates,match:next,repairs:result.repairs};
}

/** A bound bracket can be abandoned using host-observed HP, including after expiry. */
export function cancelArenaBracketRecord(profile:Data,raw:unknown,playerFinalHealth:number,nowMs:number) {
  const m=match(raw,(raw as Match).matchId);
  if (!m.bracket || m.state!=='active') return fail('not_admitted');
  const issued:Vitals={[m.entrant.holobotId]:{currentHealth:m.entrant.currentHealth,maxHealth:m.entrant.maxHealth}};
  const holobotVitals=settleVitals(profile,issued,[{holobotId:m.entrant.holobotId,currentHealth:playerFinalHealth}],nowMs);
  const next:Match={...m,state:nowMs>m.expiresAtMs?'expired':'cancelled',closedAtMs:nowMs,settlementReceipt:{matchId:m.matchId,outcome:'forfeit',refunded:false,
    settlement:null,report:{playerFinalHealth},closedAtMs:nowMs,finalVitals:{[m.entrant.holobotId]:holobotVitals[m.entrant.holobotId]}}};
  match(next,m.matchId);return {updates:{holobotVitals:commitVitals(profile.holobotVitals,holobotVitals,nowMs)},match:next};
}
