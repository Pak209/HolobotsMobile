/**
 * buddy-capture-1 (owner ruling 2026-11-11): Buddy capture by LIVE DUEL at the city's wild spots. The plain "Link"
 * (cityEncounterHost provisionSpot + wildEncounterHost offerToy / capture) stays exactly as it is for shipped phone builds and
 * Unity; this callable is the new path, used only by new phone builds.
 *
 * Callable `wildDuelHost`, schemaVersion 'wild-duel-1':
 * - `quote {spotId}`: the spot (provisioned through the existing provisionSpot: open, or resting until readyAtMs), the player's
 *   Buddy Units, the failed-win count for this wild Holobot and each tier's chance on a win. Writes nothing new (provisionSpot
 *   may open the spot's encounter, as the Link flow does).
 * - `issue {requestId, spotId, tier, holobotId, duelInputs:'duel-inputs-2', fightRules?}`: one Unit of `tier` is taken (it is
 *   given back only when the player leaves before FIGHT) and a live input-log duel is issued with rival/fightReplayIssue
 *   .buildFightReplayIssue against the wild Holobot (level = the fielded Holobot's level, plain progression stats, CPU rank
 *   Starter), exactly like the rival / Arena / Guild Court live duels; the rules version follows the shared HOLOCITY_FIGHT_CHASE /
 *   HOLOCITY_FIGHT_ATTRS flags and the request's `fightRules` ask (duel-rules-6 / -7 / -8). The player fights at FULL HP; the
 *   fielded Holobot needs a living ledger row to enter. One open wild duel per player: a new issue closes an open one as a
 *   forfeit (its Unit stays spent). Idempotent by requestId.
 * - `settle {battleId, inputLog}`: the log is replay-checked (sim/fight/replay.verifyFightReplay, outside the transaction). Only a
 *   VERIFIED WIN rolls: lib/wildDuel (Light 25 %, Medium 45 %, Heavy 100 %, +20 points per earlier failed win for that wild
 *   Holobot, the 4th win always joins), seeded from the server-only wildEncounterSessions/{uid}.rollSeed and the host-minted battle
 *   id. A join projects ownership exactly as a capture does (acquisition/captureOwnership.projectCapture: a new Lv1 Holobot, or
 *   +5 blueprints if already owned), resets the counter, ends the spot's encounter and writes a capture receipt into
 *   wildEncounterSessions/{uid}/receipts (so the spot's 30 min rest, Mission Board capture postings and the intro quest read it
 *   as they read any capture). A loss / draw spends the Unit and leaves the counter. A log that fails replay closes the duel as a
 *   forfeit (no roll). A verified win sooner than 20 s after issue is too_fast (nothing written, resend later). Idempotent.
 * - `forfeit {battleId, leftBeforeFight?}`: `leftBeforeFight: true` within lib/leftBeforeFight's window of the issue cancels the
 *   duel and gives the Unit back; otherwise the duel closes as a forfeit (the Unit stays spent). HP stays as issued.
 *
 * Host env flag HOLOCITY_WILD_DUEL, default off, ON only for exactly "1" and only together with HOLOCITY_FIGHT_REPLAY=1. Off: every
 * operation answers live_unavailable before any read or write (the phone then offers the old Link).
 * State (server-only, default-denied by firestore.rules): wildDuels/{uid} {open, progress{holobotId:{failedWins,...}}},
 * wildDuels/{uid}/duels/{battleId}, wildDuels/{uid}/requests/{requestId}. The CPU brain and the sim are untouched.
 */
import { createHash, randomBytes } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { db } from '../admin';
import { FIGHT_ATTRS_FLAG, FIGHT_CHASE_FLAG, FIGHT_INPUTS_CAPABILITY_FIELD, FIGHT_INPUTS_SCHEMA, FIGHT_LOG_FIELD, FIGHT_RECEIPT_FIELD, FIGHT_REPLAY_FLAG, FIGHT_REPLAY_MODE, FightReceiptWire, FightReplayIssueWire } from '../shared/fightReplayContract';
import { FightReplayError, FightReplayVerdict, verifyFightReplay } from '../sim/fight/replay';
import { RULES_SCHEMA_6, RULES_SCHEMA_7, RULES_SCHEMA_8 } from '../sim/fight/rules';
import { buildFightReplayIssue, inputLogCombatant } from '../rival/fightReplayIssue';
import { FIGHT_PLAUSIBILITY_COLLECTION, FIGHT_RULES_CAPABILITY_FIELD } from '../rival/rivalBattleStore';
import { buildPlayerCombatants, playerCombatant, RIVAL_MIN_WIN_MS, RIVAL_WINS_FIELD, tierForWins } from '../lib/rivalLadder';
import { awardBattleExperienceRaw } from '../lib/battleProgression';
import { FIRST_WIN_COLLECTION, FIRST_WIN_OF_DAY_MULTIPLIER, firstWinAvailable, firstWinRecord, firstWinWire, LIVE_WIN_BONUS_CAP, livePerformanceFromReceipt, utcDayOf } from '../lib/liveWinRewards';
import { equippedPartBoosts, ledgerHealthAfterFight } from '../lib/partStats';
import { liveMoveRanksFor } from '../lib/liveMoveRanks';
import { HealthError, issueVitals, requireLivingVitals, settleVitals, Vitals } from '../lib/rivalHealth';
import { commitVitals } from '../lib/autoHeal';
import { arenaOpen, ActivityError } from '../lib/arenaActivity';
import { BUDDY_UNITS_FIELD, BuddyInventory, BuddyTierKey, readBuddyInventory, ROLL_SEED, tierByKey, withTierDelta } from '../lib/buddyUnits';
import { guaranteedCaptureHolobot } from '../lib/introQuests';
import { LEFT_BEFORE_FIGHT_CLOSED_BY, LEFT_BEFORE_FIGHT_FIELD, leftBeforeFightInWindow, readLeftBeforeFight } from '../lib/leftBeforeFight';
import { readFailedWins, WILD_DUEL_RANK_TIER, WILD_DUEL_SCHEMA, WILD_DUEL_TTL_MS, wildDuelChance01, wildDuelChances, wildDuelLevel, wildDuelRoll01, wildDuelWinOutcome } from '../lib/wildDuel';
import { projectCapture, readTravelSquad } from '../acquisition/captureOwnership';
import { ACQUISITION_SCHEMA, HostError, newRollSeed, Session } from '../acquisition/wildEncounterDomain';
import { cityWildSpot, currentSpotEncounter } from './cityWildSpots';
import { CITY_ENCOUNTER_SCHEMA, CITY_KURAI_ENCOUNTER_ID, provisionCityEncounter, provisionCitySpot } from './cityEncounterHost';

export const WILD_DUEL_FLAG = 'HOLOCITY_WILD_DUEL';
export function wildDuelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[WILD_DUEL_FLAG] === '1' && env[FIGHT_REPLAY_FLAG] === '1';
}
export const WILD_DUEL_STATE_SCHEMA = 'wild-duel-state-1';
/** The capture receipt a join writes into wildEncounterSessions/{uid}/receipts (doc id = this prefix + battleId). */
export const WILD_DUEL_RECEIPT_PREFIX = 'wd_';
const TIERS: readonly BuddyTierKey[] = ['light', 'medium', 'heavy'];
/** buddy-capture-1 ruling 5 (owner 2026-11-12): the once-only Research Garden KURAI (and the Mission Board's kurai_garden capture
 * posting) is fought the same way. Its encounter is cityEncounterHost's `provision` one (city_kurai_garden); once joined it is gone. */
export const WILD_DUEL_GARDEN_SPOT = 'kurai_garden';
const wildSpot = (spotId: unknown): { spotId: string; holobotId: string } | undefined =>
  spotId === WILD_DUEL_GARDEN_SPOT ? { spotId: WILD_DUEL_GARDEN_SPOT, holobotId: 'kurai' } : typeof spotId === 'string' ? cityWildSpot(spotId) : undefined;

export class WildDuelError extends Error {
  constructor(public code: string, public retryAfterMs?: number, public detail?: Record<string, unknown>) { super(code); }
}
const fail = (code: string, retryAfterMs?: number, detail?: Record<string, unknown>): never => { throw new WildDuelError(code, retryAfterMs, detail); };
type Data = Record<string, any>;
const object = (x: unknown): x is Data => !!x && typeof x === 'object' && !Array.isArray(x);
const BATTLE_ID = /^wd_[a-f0-9]{32}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;

export type WildDuelCommand =
  | { operation: 'quote'; spotId: string }
  | { operation: 'issue'; requestId: string; spotId: string; tier: BuddyTierKey; holobotId: string; rules: 6 | 7 | 8 | null }
  | { operation: 'settle'; battleId: string; inputLog: unknown }
  | { operation: 'forfeit'; battleId: string; leftBeforeFight: boolean };

export function validateWildDuelCommand(raw: unknown): WildDuelCommand {
  if (!object(raw) || raw.schemaVersion !== WILD_DUEL_SCHEMA) return fail('invalid_request');
  const fields: Record<string, string[]> = {
    quote: ['spotId'],
    issue: ['requestId', 'spotId', 'tier', 'holobotId', FIGHT_INPUTS_CAPABILITY_FIELD, FIGHT_RULES_CAPABILITY_FIELD],
    settle: ['battleId', FIGHT_LOG_FIELD],
    forfeit: ['battleId', LEFT_BEFORE_FIGHT_FIELD],
  };
  const op = raw.operation;
  if (typeof op !== 'string' || !Object.hasOwn(fields, op) || Object.keys(raw).some(k => !['schemaVersion', 'operation', ...fields[op]].includes(k))) return fail('invalid_request');
  if (op === 'quote') {
    if (!wildSpot(raw.spotId)) return fail('invalid_request');
    return { operation: 'quote', spotId: raw.spotId };
  }
  if (op === 'issue') {
    const rulesAsk = raw[FIGHT_RULES_CAPABILITY_FIELD];
    if (typeof raw.requestId !== 'string' || !REQUEST_ID.test(raw.requestId) || !wildSpot(raw.spotId)
      || !TIERS.includes(raw.tier) || typeof raw.holobotId !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(raw.holobotId)
      // A wild duel is live only: the client declares the input-log capability.
      || raw[FIGHT_INPUTS_CAPABILITY_FIELD] !== FIGHT_INPUTS_SCHEMA
      || (rulesAsk !== undefined && rulesAsk !== RULES_SCHEMA_6 && rulesAsk !== RULES_SCHEMA_7 && rulesAsk !== RULES_SCHEMA_8)) return fail('invalid_request');
    return { operation: 'issue', requestId: raw.requestId, spotId: raw.spotId, tier: raw.tier, holobotId: raw.holobotId,
      rules: rulesAsk === RULES_SCHEMA_8 ? 8 : rulesAsk === RULES_SCHEMA_7 ? 7 : rulesAsk === RULES_SCHEMA_6 ? 6 : null };
  }
  if (typeof raw.battleId !== 'string' || !BATTLE_ID.test(raw.battleId)) return fail('invalid_request');
  if (op === 'settle') {
    if (typeof raw[FIGHT_LOG_FIELD] !== 'string' && !object(raw[FIGHT_LOG_FIELD])) return fail('invalid_request');
    return { operation: 'settle', battleId: raw.battleId, inputLog: raw[FIGHT_LOG_FIELD] };
  }
  const left = readLeftBeforeFight(raw);
  if (left === null) return fail('invalid_request');
  return { operation: 'forfeit', battleId: raw.battleId, leftBeforeFight: left };
}

type DuelDoc = Data & {
  schemaVersion: typeof WILD_DUEL_SCHEMA; battleId: string; requestId: string; spotId: string; holobotId: string; encounterId: string;
  tier: BuddyTierKey; fighterId: string; issuedAtMs: number; expiresAtMs: number; issuedVitals: { currentHealth: number; maxHealth: number };
  duel: FightReplayIssueWire; state: 'open' | 'settled' | 'closed'; closedAtMs: number | null; closedBy?: string; unitReturned?: boolean; result?: Data;
};
const readUnits = (profile: Data): { units: BuddyInventory; updates: Record<string, unknown> } => {
  const read = readBuddyInventory(profile);
  if (!read) return fail('unavailable');
  return { units: read.units, updates: read.updates };
};
const stateOf = (raw: unknown): { open: string | null; progress: Data } => {
  if (raw === undefined) return { open: null, progress: {} };
  if (!object(raw) || raw.schemaVersion !== WILD_DUEL_STATE_SCHEMA) return fail('unavailable');
  return { open: typeof raw.open === 'string' && BATTLE_ID.test(raw.open) ? raw.open : null, progress: object(raw.progress) ? raw.progress : {} };
};
const duelOf = (raw: unknown, battleId: string): DuelDoc => {
  if (!object(raw) || raw.schemaVersion !== WILD_DUEL_SCHEMA || raw.battleId !== battleId || !['open', 'settled', 'closed'].includes(raw.state) || !object(raw.duel) || raw.duel.mode !== FIGHT_REPLAY_MODE) return fail('unavailable');
  return raw as DuelDoc;
};

/** What a settled duel answers (and answers again on a resend). */
function settleReply(d: DuelDoc, alreadyProcessed: boolean) {
  const r = d.result ?? {};
  return { schemaVersion: WILD_DUEL_SCHEMA, battleId: d.battleId, alreadyProcessed, spotId: d.spotId, holobotId: d.holobotId, tier: d.tier,
    winner: r.winner, joined: r.joined === true, rolled: r.rolled === true, chance01: r.chance01 ?? null, failedWins: r.failedWinsAfter ?? 0, nextChance01: r.nextChance01 ?? null,
    ownershipOutcome: r.ownershipOutcome ?? '', blueprintDelta: r.blueprintDelta ?? 0, unitSpent: true, playerHealth: r.playerHealth ?? null,
    progression: Array.isArray(r.progression) ? r.progression : [], holosGranted: 0, ...(typeof r.firstWinOfDay === 'string' ? { firstWinOfDay: firstWinWire(r.firstWinOfDay) } : {}),
    ...(d.fightReceipt ? { [FIGHT_RECEIPT_FIELD]: d.fightReceipt } : {}) };
}
const closedReply = (d: DuelDoc, alreadyProcessed: boolean) => ({ schemaVersion: WILD_DUEL_SCHEMA, battleId: d.battleId, alreadyProcessed, spotId: d.spotId, holobotId: d.holobotId, tier: d.tier,
  closedBy: d.closedBy, unitSpent: d.unitReturned !== true });

/** Close the open duel (inside a transaction, after its reads): forfeit / expired / replay_mismatch keep the Unit spent; a
 * left-before-fight cancel gives it back. HP stays as issued (the ledger was not lowered at issue, so nothing to write). */
function closeDuel(d: DuelDoc, closedBy: string, nowMs: number, extra: Data = {}): DuelDoc {
  return { ...d, state: 'closed', closedAtMs: nowMs, closedBy, ...(closedBy === LEFT_BEFORE_FIGHT_CLOSED_BY ? { unitReturned: true } : {}), ...extra };
}

/** Any open duel past its life closes as a loss ('expired') on the next touch. */
async function sweepExpired(store: Firestore, uid: string, nowMs: number) {
  const stateRef = store.doc(`wildDuels/${uid}`);
  let open: string | null;
  try { open = stateOf((await stateRef.get()).data()).open; } catch { return; }
  if (!open) return;
  const duelRef = store.doc(`wildDuels/${uid}/duels/${open}`);
  const pre = (await duelRef.get()).data();
  if (!object(pre) || pre.state !== 'open' || !(nowMs > pre.expiresAtMs)) return;
  await store.runTransaction(async tx => {
    const state = (await tx.get(stateRef)).data(), raw = (await tx.get(duelRef)).data();
    const s = stateOf(state);
    if (s.open !== open || !object(raw) || raw.state !== 'open' || !(nowMs > raw.expiresAtMs)) return;
    tx.set(duelRef, closeDuel(duelOf(raw, open!), 'expired', nowMs));
    tx.set(stateRef, { ...state, open: null });
  });
}

type Pre = { verdict?: FightReplayVerdict; mismatch?: Record<string, unknown>; issue: FightReplayIssueWire };
async function preVerify(store: Firestore, uid: string, c: Extract<WildDuelCommand, { operation: 'settle' }>, nowMs: number): Promise<Pre | undefined> {
  const pre = (await store.doc(`wildDuels/${uid}/duels/${c.battleId}`).get()).data();
  if (!object(pre) || pre.state !== 'open' || nowMs > pre.expiresAtMs || !object(pre.duel) || pre.duel.mode !== FIGHT_REPLAY_MODE) return undefined;
  const issue = pre.duel as FightReplayIssueWire;
  try {
    const verdict = verifyFightReplay(issue, c.inputLog, { battleId: c.battleId });
    console.info(JSON.stringify({ event: 'wild_duel_replay_verified', battleId: c.battleId, ticks: verdict.ticks, winner: verdict.receipt.winner }));
    return { issue, verdict };
  } catch (e) {
    if (!(e instanceof FightReplayError)) throw e;
    if (e.code === 'invalid_issue') return fail('unavailable');
    console.warn(JSON.stringify({ event: 'wild_duel_replay_rejected', battleId: c.battleId, code: e.code, ...e.detail }));
    if (e.code === 'invalid_log') return fail('invalid_request', undefined, { reason: 'invalid_log', ...e.detail });
    return { issue, mismatch: { ...e.detail } };
  }
}

export type WildDuelOptions = { enabled?: boolean; fightChase?: boolean; fightAttrs?: boolean; fightSeed?: () => string; battleId?: () => string; rollSeed?: string };
const THROW_AFTER_COMMIT = '__throwAfterCommit';

export async function transactWildDuel(store: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), options: WildDuelOptions = {}) {
  const c = validateWildDuelCommand(raw);
  if (!(options.enabled ?? wildDuelEnabled())) return fail('live_unavailable', undefined, { reason: 'wild_duel_off' });
  try {
    if (c.operation === 'quote') return await quote(store, uid, c.spotId, nowMs);
    await sweepExpired(store, uid, nowMs);
    if (c.operation === 'issue') return await issue(store, uid, c, nowMs, options);
    if (c.operation === 'forfeit') return await forfeit(store, uid, c, nowMs);
    return await settle(store, uid, c, nowMs, options);
  } catch (e) {
    if (e instanceof HostError) throw new WildDuelError(e.code === 'invalid_request' ? 'invalid_request' : 'unavailable');
    if (e instanceof HealthError) throw new WildDuelError(e.message === 'holobot_ko' ? 'holobot_ko' : e.message === 'invalid_request' ? 'invalid_request' : 'unavailable', undefined, e.message === 'holobot_ko' ? e.detail : undefined);
    if (e instanceof ActivityError || e instanceof RangeError) throw new WildDuelError('unavailable');
    throw e;
  }
}

/** The spot through the existing provisionSpot (idempotent per cycle): open, or resting until readyAtMs. */
async function spotNow(store: Firestore, uid: string, spotId: string, nowMs: number): Promise<{ encounterId: string; resting: boolean; readyAtMs: number | null; gone: boolean }> {
  if (spotId === WILD_DUEL_GARDEN_SPOT) {
    // The garden KURAI is once-only: joined (through the old Link or a duel) means gone for good.
    const p = await provisionCityEncounter(store, uid, { schemaVersion: CITY_ENCOUNTER_SCHEMA, operation: 'provision' }, newRollSeed(), nowMs);
    return { encounterId: p.encounterId, resting: p.linked === true, readyAtMs: null, gone: p.linked === true };
  }
  const p = await provisionCitySpot(store, uid, spotId, newRollSeed(), nowMs);
  return { encounterId: p.encounterId, resting: p.linked === true, readyAtMs: p.readyAtMs as number | null, gone: false };
}
/** The spot's encounter in the session (the garden's fixed id, or the spot's current cycle). */
function spotEncounter(session: Session | undefined, spotId: string) {
  if (spotId !== WILD_DUEL_GARDEN_SPOT) return currentSpotEncounter(session, spotId)?.encounter ?? null;
  return (Array.isArray(session?.encounters) ? session!.encounters : []).find(e => e?.encounterId === CITY_KURAI_ENCOUNTER_ID) ?? null;
}

async function quote(store: Firestore, uid: string, spotId: string, nowMs: number) {
  const spot = wildSpot(spotId)!;
  const s = await spotNow(store, uid, spotId, nowMs);
  const [user, state] = await Promise.all([store.doc(`users/${uid}`).get(), store.doc(`wildDuels/${uid}`).get()]);
  if (!user.exists) return fail('unavailable');
  const { units } = readUnits(user.data()!);
  const st = stateOf(state.data());
  const failedWins = readFailedWins(st.progress, spot.holobotId);
  return { schemaVersion: WILD_DUEL_SCHEMA, spotId, holobotId: spot.holobotId, resting: s.resting, readyAtMs: s.readyAtMs, ...(s.gone ? { gone: true } : {}), buddyUnits: units, failedWins, chances: wildDuelChances(failedWins), openBattleId: st.open };
}

async function issue(store: Firestore, uid: string, c: Extract<WildDuelCommand, { operation: 'issue' }>, nowMs: number, options: WildDuelOptions) {
  const spot = wildSpot(c.spotId)!;
  // Pinned outside the transaction so a retry rules identically.
  const battleId = options.battleId ? options.battleId() : `wd_${randomBytes(16).toString('hex')}`;
  const fightSeed = options.fightSeed ? options.fightSeed() : randomBytes(32).toString('hex');
  const fightChase = options.fightChase ?? process.env[FIGHT_CHASE_FLAG] === '1';
  const fightAttrs = options.fightAttrs ?? process.env[FIGHT_ATTRS_FLAG] === '1';
  const identity = createHash('sha256').update(JSON.stringify([c.spotId, c.tier, c.holobotId, c.rules])).digest('hex');
  const stateRef = store.doc(`wildDuels/${uid}`), userRef = store.doc(`users/${uid}`), requestRef = store.doc(`wildDuels/${uid}/requests/${c.requestId}`);
  // A replayed request answers its stored duel before anything else (no spot read, no Unit).
  const prior = (await requestRef.get()).data();
  if (prior) {
    if (prior.identity !== identity || typeof prior.battleId !== 'string') return fail('request_conflict');
    const d = duelOf((await store.doc(`wildDuels/${uid}/duels/${prior.battleId}`).get()).data(), prior.battleId);
    return issueReply(d, readFailedWins(stateOf((await stateRef.get()).data()).progress, d.holobotId), null, true);
  }
  const s = await spotNow(store, uid, c.spotId, nowMs);
  if (s.gone) return fail('spot_gone');
  if (s.resting) return fail('spot_resting', Math.max(0, (s.readyAtMs ?? nowMs) - nowMs));
  const out = await store.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) return fail('unavailable');
    const profile = user.data()!;
    if ((await tx.get(requestRef)).exists) return fail('unavailable'); // a racing twin: the retry replays it
    const stateRaw = (await tx.get(stateRef)).data(), st = stateOf(stateRaw);
    const openRef = st.open ? store.doc(`wildDuels/${uid}/duels/${st.open}`) : null;
    const openRaw = openRef ? (await tx.get(openRef)).data() : undefined;
    const session = (await tx.get(store.doc(`wildEncounterSessions/${uid}`))).data() as Session | undefined;
    if (arenaOpen((await tx.get(store.doc(`arenaMatches/${uid}`))).data())) return fail('activity_conflict');
    // The spot's encounter must be the open one provisionSpot just served (not linked through the old flow meanwhile).
    const current = spotEncounter(session, c.spotId);
    if (!current || current.ended || current.encounterId !== s.encounterId) return fail(c.spotId === WILD_DUEL_GARDEN_SPOT ? 'spot_gone' : 'spot_resting', 60_000);
    const { units, updates: inventoryUpdates } = readUnits(profile);
    if (units[c.tier] < 1) return fail('no_buddy_units', undefined, { tier: c.tier });
    // The fielded Holobot: one of the travel squad, with a living ledger row (ko-return-25).
    if (!readTravelSquad(profile).holobotIds.includes(c.holobotId)) return fail('invalid_request', undefined, { reason: 'not_in_squad' });
    requireLivingVitals(profile, [c.holobotId], nowMs);
    const player = buildPlayerCombatants(profile, [c.holobotId])[0];
    if (!player || !(player.maxHealth > 0)) return fail('unavailable');
    const vitals = issueVitals(profile, [player], nowMs);
    const issuedRow = vitals[c.holobotId];
    if (!(Math.floor(issuedRow.currentHealth) > 0)) return fail('holobot_ko');
    const rules8 = c.rules === 8, rules7 = rules8 || c.rules === 7, rules6 = rules7 || c.rules === 6;
    const tempo = rules6 && fightChase && fightAttrs;
    const level = wildDuelLevel(player.level);
    // Ruling 2: a verified win pays the town rival's win EXP at the player's rival tier now (pinned here).
    const expTier = tierForWins(typeof profile[RIVAL_WINS_FIELD] === 'number' && Number.isSafeInteger(profile[RIVAL_WINS_FIELD]) && profile[RIVAL_WINS_FIELD] > 0 ? profile[RIVAL_WINS_FIELD] : 0);
    const wild = playerCombatant(spot.holobotId, { name: spot.holobotId.toUpperCase(), level });
    const duel = buildFightReplayIssue({ battleId, seed: fightSeed, tier: WILD_DUEL_RANK_TIER, mentor: false,
      player: [inputLogCombatant({ ...player, currentHealth: player.maxHealth }, equippedPartBoosts(profile, c.holobotId), tempo, liveMoveRanksFor(profile, c.holobotId))],
      opponent: [{ ...wild, statSource: 'progression' as const }], chase: fightChase, attrs: fightAttrs, tempo, live: true, guardHold: rules7, staminaWind: rules8 });
    if (!duel) return fail('live_unavailable', undefined, { reason: 'lineup_unsupported' });
    // Every read is above; writes follow. An open duel is superseded. Ruling 6 (producer 2026-11-12): one replaced within the
    // leave-before-FIGHT window of its issue never started (the phone lost the issue reply and challenged again), so its Unit comes
    // back; one replaced later counts as a fight that started and keeps its Unit spent (the same bound as leftBeforeFight).
    let unitsAfter = withTierDelta(units, c.tier, -1);
    if (openRef && object(openRaw) && openRaw.state === 'open') {
      const prev = duelOf(openRaw, st.open!), unstarted = leftBeforeFightInWindow(prev.issuedAtMs, nowMs);
      tx.set(openRef, closeDuel(prev, 'superseded', nowMs, unstarted ? { unitReturned: true } : {}));
      if (unstarted) unitsAfter = withTierDelta(unitsAfter, prev.tier, 1);
    }
    const d: DuelDoc = { schemaVersion: WILD_DUEL_SCHEMA, battleId, requestId: c.requestId, spotId: c.spotId, holobotId: spot.holobotId, encounterId: s.encounterId,
      tier: c.tier, fighterId: c.holobotId, wildLevel: level, expTier, issuedAtMs: nowMs, expiresAtMs: nowMs + WILD_DUEL_TTL_MS, issuedVitals: { ...issuedRow }, duel, state: 'open', closedAtMs: null };
    tx.update(userRef, { ...inventoryUpdates, [BUDDY_UNITS_FIELD]: { ...unitsAfter }, holobotVitals: commitVitals(profile.holobotVitals, vitals, nowMs) });
    tx.create(store.doc(`wildDuels/${uid}/duels/${battleId}`), d);
    tx.create(requestRef, { schemaVersion: WILD_DUEL_SCHEMA, identity, battleId, createdAtMs: nowMs });
    tx.set(stateRef, { schemaVersion: WILD_DUEL_STATE_SCHEMA, ...(object(stateRaw) ? stateRaw : {}), progress: st.progress, open: battleId });
    return issueReply(d, readFailedWins(st.progress, spot.holobotId), unitsAfter, false);
  });
  return out;
}

function issueReply(d: DuelDoc, failedWins: number, units: BuddyInventory | null, alreadyProcessed: boolean) {
  return { schemaVersion: WILD_DUEL_SCHEMA, battleId: d.battleId, alreadyProcessed, spotId: d.spotId, holobotId: d.holobotId, tier: d.tier, tierName: tierByKey(d.tier).displayName,
    fighterId: d.fighterId, wildLevel: d.wildLevel, issuedAtMs: d.issuedAtMs, expiresAtMs: d.expiresAtMs, failedWins, chance01: wildDuelChance01(d.tier, failedWins),
    ...(units ? { buddyUnits: units } : {}), duel: structuredClone(d.duel) };
}

async function forfeit(store: Firestore, uid: string, c: Extract<WildDuelCommand, { operation: 'forfeit' }>, nowMs: number) {
  const stateRef = store.doc(`wildDuels/${uid}`), duelRef = store.doc(`wildDuels/${uid}/duels/${c.battleId}`), userRef = store.doc(`users/${uid}`);
  return store.runTransaction(async tx => {
    const raw = (await tx.get(duelRef)).data();
    if (!raw) return fail('unknown_duel');
    const d = duelOf(raw, c.battleId);
    if (d.state === 'settled') return settleReply(d, true);
    if (d.state === 'closed') return closedReply(d, true);
    const stateRaw = (await tx.get(stateRef)).data(), user = await tx.get(userRef);
    if (!user.exists) return fail('unavailable');
    const st = stateOf(stateRaw);
    const left = c.leftBeforeFight && nowMs <= d.expiresAtMs && leftBeforeFightInWindow(d.issuedAtMs, nowMs);
    const closed = closeDuel(d, left ? LEFT_BEFORE_FIGHT_CLOSED_BY : 'forfeit', nowMs);
    if (left) {
      // No loss before FIGHT: the Unit comes back. Nothing else changes.
      const { units, updates } = readUnits(user.data()!);
      tx.update(userRef, { ...updates, [BUDDY_UNITS_FIELD]: { ...withTierDelta(units, d.tier, 1) } });
    }
    tx.set(duelRef, closed);
    if (st.open === d.battleId) tx.set(stateRef, { ...stateRaw, open: null });
    return closedReply(closed, false);
  });
}

async function settle(store: Firestore, uid: string, c: Extract<WildDuelCommand, { operation: 'settle' }>, nowMs: number, options: WildDuelOptions) {
  const pre = await preVerify(store, uid, c, nowMs);
  const seedIfMissing = options.rollSeed ?? newRollSeed();
  const stateRef = store.doc(`wildDuels/${uid}`), duelRef = store.doc(`wildDuels/${uid}/duels/${c.battleId}`), userRef = store.doc(`users/${uid}`);
  const sessionRef = store.doc(`wildEncounterSessions/${uid}`);
  const out = await store.runTransaction(async (tx: Transaction) => {
    const raw = (await tx.get(duelRef)).data();
    if (!raw) return fail('unknown_duel');
    const d = duelOf(raw, c.battleId);
    if (d.state === 'settled') return settleReply(d, true);
    if (d.state === 'closed') return fail(d.closedBy === 'expired' ? 'duel_expired' : 'duel_closed', undefined, { closedBy: d.closedBy });
    if (nowMs > d.expiresAtMs) return fail('duel_expired');
    // The verdict must be for this same immutable issue (a stale pre-read is retryable: the same log is resent).
    if (!pre || pre.issue.rulesHash !== d.duel.rulesHash || pre.issue.seed !== d.duel.seed) return fail('unavailable');
    const stateRaw = (await tx.get(stateRef)).data(), st = stateOf(stateRaw);
    if (pre.mismatch) {
      tx.set(duelRef, closeDuel(d, 'replay_mismatch', nowMs, { replayRejection: pre.mismatch }));
      if (st.open === d.battleId) tx.set(stateRef, { ...stateRaw, open: null });
      return { [THROW_AFTER_COMMIT]: new WildDuelError('replay_mismatch', undefined, pre.mismatch) };
    }
    const verdict = pre.verdict!, receipt: FightReceiptWire = verdict.receipt, won = receipt.winner === 'player';
    if (won && nowMs - d.issuedAtMs < RIVAL_MIN_WIN_MS) return fail('too_fast', RIVAL_MIN_WIN_MS - (nowMs - d.issuedAtMs));
    const user = await tx.get(userRef);
    if (!user.exists) return fail('unavailable');
    const profile = user.data()!;
    const sessionSnap = await tx.get(sessionRef);
    const session = sessionSnap.data() as Session | undefined;
    const guaranteed = won ? guaranteedCaptureHolobot((await tx.get(store.doc(`introQuests/${uid}`))).data()) : null;
    const firstWinRef = store.doc(`${FIRST_WIN_COLLECTION}/${uid}`);
    const firstWin = won && firstWinAvailable((await tx.get(firstWinRef)).data(), nowMs);
    // HP: the fight started at full HP; its end HP maps onto the ledger from a full start, capped at the issue-time row.
    const final = receipt.playerFinal.find(f => f.holobotId === d.fighterId) ?? receipt.playerFinal[0];
    const issued: Vitals = { [d.fighterId]: { ...d.issuedVitals } };
    const reportHp = final ? Math.min(d.issuedVitals.currentHealth, ledgerHealthAfterFight(final.currentHealth, final.maxHealth, { currentHealth: d.issuedVitals.maxHealth, maxHealth: d.issuedVitals.maxHealth })) : d.issuedVitals.currentHealth;
    const vitals = settleVitals(profile, issued, [{ holobotId: d.fighterId, currentHealth: reportHp }], nowMs);
    const userUpdates: Data = { holobotVitals: commitVitals(profile.holobotVitals, vitals, nowMs) };
    const progress: Data = { ...st.progress };
    let result: Data = { winner: receipt.winner, joined: false, rolled: false, failedWinsAfter: readFailedWins(st.progress, d.holobotId), playerHealth: { currentHealth: vitals[d.fighterId].currentHealth, maxHealth: vitals[d.fighterId].maxHealth } };
    let sessionWrite: Session | null = null, receiptWrite: Data | null = null;
    let progression: unknown[] = [];
    if (won) {
      // Ruling 2: the town rival's win EXP (battle table kind 'rival' at the tier pinned at issue, the receipt's capped win bonus,
      // the day's first live win x2, the EXP Booster) to the fielded Holobot. No Holos. A loss pays nothing.
      const award = awardBattleExperienceRaw(profile, [d.fighterId],
        { kind: 'rival', tier: Number.isSafeInteger(d.expTier) ? d.expTier : 0, didWin: true, ...livePerformanceFromReceipt(receipt) }, nowMs,
        { bonusCap: LIVE_WIN_BONUS_CAP, expMultiplier: firstWin ? FIRST_WIN_OF_DAY_MULTIPLIER : 1 });
      if (!award) return fail('unavailable');
      progression = award.progression;
      if (award.expPerHolobot > 0) userUpdates.holobots = award.holobots;
      result.progression = progression;
      if (firstWin) result.firstWinOfDay = utcDayOf(nowMs);
      // The roll: server secret (the session's rollSeed; added now if an old session has none) + the host-minted battle id.
      const seed = session?.rollSeed !== undefined ? session.rollSeed : seedIfMissing;
      if (typeof seed !== 'string' || !ROLL_SEED.test(seed)) return fail('unavailable');
      const before = readFailedWins(st.progress, d.holobotId);
      const roll = wildDuelRoll01(seed, d.holobotId, d.battleId);
      const o = guaranteed === d.holobotId ? { ...wildDuelWinOutcome(d.tier, before, 0), chance01: 1 } : wildDuelWinOutcome(d.tier, before, roll);
      result = { ...result, rolled: true, roll, chance01: o.chance01, joined: o.joined, failedWinsBefore: before, failedWinsAfter: o.failedWinsAfter, nextChance01: o.joined ? null : o.nextChance01 };
      if (o.joined) {
        const projection = projectCapture(userUpdates.holobots ? { ...profile, holobots: userUpdates.holobots } : profile, d.holobotId);
        Object.assign(userUpdates, projection.updates);
        result.ownershipOutcome = projection.ownershipOutcome; result.blueprintDelta = projection.blueprintDelta;
        delete progress[d.holobotId];
        // The spot's encounter ends and the roster records the capture, exactly as wildEncounterDomain.execute does on a capture.
        if (session && session.enabled === true && Array.isArray(session.encounters)) {
          const s: Session = structuredClone(session);
          if (s.rollSeed === undefined) s.rollSeed = seed;
          if (!Array.isArray(s.entries)) s.entries = [];
          const e = s.encounters.find(x => x?.encounterId === d.encounterId);
          if (e && !e.ended) e.ended = true;
          if (!s.entries.some(x => x.holobotId === d.holobotId && x.availability === 'owned')) { s.entries = s.entries.filter(x => x.holobotId !== d.holobotId); s.entries.push({ holobotId: d.holobotId, availability: 'owned', source: 'capture', copies: 1 }); }
          s.revision = (Number.isSafeInteger(s.revision) ? s.revision : 0) + 1; s.rosterRevision = (Number.isSafeInteger(s.rosterRevision) ? s.rosterRevision : 0) + 1;
          sessionWrite = s;
        }
        // The capture receipt the spot's rest, Mission Board capture postings and the intro quest read (createTime = now).
        receiptWrite = { digest: 'wild-duel-1', reply: { captureResult: { schemaVersion: ACQUISITION_SCHEMA, requestId: WILD_DUEL_RECEIPT_PREFIX + d.battleId, encounterId: d.encounterId, holobotId: d.holobotId,
          captured: true, outcome: 'captured', affinityTierAfter: 0, retryGuaranteed: false, toyConsumedId: tierByKey(d.tier).id, ownershipOutcome: projection.ownershipOutcome, blueprintDelta: projection.blueprintDelta,
          buddyUnitTier: tierByKey(d.tier).id, buddyUnitsSpent: 1, rolled: true, roll, captureChance01: o.chance01, wildDuelBattleId: d.battleId } } };
      } else {
        progress[d.holobotId] = { failedWins: o.failedWinsAfter, lastBattleId: d.battleId, updatedAtMs: nowMs };
      }
      if (session === undefined || session.rollSeed === undefined) {
        // An old / missing session gets its secret persisted so the next roll uses the same one.
        if (!sessionWrite && session && session.enabled === true) sessionWrite = { ...session, rollSeed: seed };
      }
    }
    const settled: DuelDoc = { ...d, state: 'settled', closedAtMs: nowMs, result, fightReceipt: receipt, ...(won ? { fightPlausibility: verdict.plausibility } : {}) };
    tx.update(userRef, userUpdates);
    tx.set(duelRef, settled);
    if (firstWin) tx.set(firstWinRef, firstWinRecord('wild', d.battleId, nowMs));
    tx.set(stateRef, { schemaVersion: WILD_DUEL_STATE_SCHEMA, ...(object(stateRaw) ? stateRaw : {}), progress, open: st.open === d.battleId ? null : st.open });
    if (sessionWrite) tx.set(sessionRef, sessionWrite);
    if (receiptWrite) tx.create(store.doc(`wildEncounterSessions/${uid}/receipts/${WILD_DUEL_RECEIPT_PREFIX}${d.battleId}`), receiptWrite);
    if (won && verdict.plausibility.flagged) tx.set(store.doc(`${FIGHT_PLAUSIBILITY_COLLECTION}/${uid}_${d.battleId}`), { uid, battleId: d.battleId, source: 'wild_duel', flaggedAtMs: nowMs,
      ...verdict.plausibility, inputsHash: receipt.inputsHash, rulesId: receipt.rulesId, endTick: receipt.endTick, reviewed: false });
    return settleReply(settled, false);
  });
  const deferred = (out as Record<string, unknown>)[THROW_AFTER_COMMIT];
  if (deferred instanceof WildDuelError) throw deferred;
  return out;
}

export const wildDuelHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to meet wild Holobots.');
  try {
    return await transactWildDuel(db, uid, request.data);
  } catch (e) {
    if (e instanceof WildDuelError) {
      const code = e.code === 'invalid_request' ? 'invalid-argument' : e.code === 'unknown_duel' ? 'not-found' : e.code === 'unavailable' || e.code === 'live_unavailable' ? 'unavailable' : 'failed-precondition';
      throw new HttpsError(code, e.code, { ...(e.detail ?? {}), rejectionCode: e.code, ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}) });
    }
    throw e;
  }
});
