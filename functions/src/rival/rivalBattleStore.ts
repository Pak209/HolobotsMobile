import { battlefieldIssueMovement } from '../lib/battlefieldMovement';
// Dormant internal verification seam; no current callable or issuance routes here.
export { verifyRivalInputLog } from './rivalInputVerification';
import { DUEL_RECEIPT_SCHEMA, DUEL_MAX_ROUNDS, duelFighterFromCombatant, resolveDuel, validateDuelIntents, DuelReceipt } from '../lib/duelResolver';
import { bindGatheringRival, gatheringRivalRequest } from '../story/gatheringRival';
import { pilotRankAfterWin, PilotRankError } from '../account/pilotRank';
import { ActivityError, expeditionOpen, leaseHolder } from '../lib/arenaActivity';
import {withRankHealingReward} from "../lib/rankHealingReward";
import { allyAfterZellVictory, bindZellLineup, meetZell, readZellStory, storyRequest, StoryRivalRecord, ZELL_STORY_SCHEMA, zellStoryView } from '../lib/zellStory';
import {issueVitals,settleVitals,RIVAL_HEALTH_SCHEMA,HealthError,Vitals} from "../lib/rivalHealth";
import { onboardingAfterEvent, onboardingMentorActive } from '../lib/onboarding';
import { applyOnboardingMentor, isOnboardingMentorBattle } from './onboardingMentor';
import { randomBytes, randomInt } from 'node:crypto';
import { FIGHT_INPUTS_CAPABILITY_FIELD, FIGHT_INPUTS_SCHEMA, FIGHT_LOG_FIELD, FIGHT_RECEIPT_FIELD, FIGHT_REPLAY_FLAG, FightReceiptWire, FightReplayIssueWire } from '../shared/fightReplayContract';
import { FightReplayError, FightReplayVerdict, verifyFightReplay } from '../sim/fight/replay';
import { buildFightReplayIssue } from './fightReplayIssue';
import { FieldValue, Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { issueRivalBattle, rivalLineupScaleFor, rivalReplyForVersion, openBattlesAfterIssue, openBattlesAfterSettle, readOpenBattles, RIVAL_BATTLE_CLEANUP_FIELD, RIVAL_OPEN_BATTLES_FIELD, RIVAL_BATTLE_ID, rivalBattleCleanupAtMs, RivalBattleRecord, readRivalLastSettled, requireRivalOffCooldown, rivalLastSettledAfterSettle, RIVAL_LAST_SETTLED_FIELD, RivalError, rivalStatus, settleRivalBattle, validateRivalCommand } from '../lib/rivalLadder';

/**
 * DECISIONS #43 rival host. users/{uid} holds buddyUnits / rivalWins / rivalRewardDay
 * (rules: server-only). Issued battles live at rivalBattles/{uid}/battles/{battleId},
 * outside client-writable user subcollections (default-denied by the catch-all rule).
 * The uid always comes from authentication, so a foreign battleId never resolves.
 * Replies: rival-battle-2 when the request asks for it, else the deployed rival-battle-1 shape (#44).
 * Each battle also carries `expireAt` (Timestamp) for TTL cleanup; see RIVAL_BATTLE_TTL_GRACE_MS.
 * The parent doc rivalBattles/{uid} is the open-battle ledger (≤ RIVAL_MAX_OPEN_BATTLES entries), so the
 * cap is a point read, not a query.
 * rival-battle-3 (DECISIONS #53): issue snapshots the travel squad into the record and serves
 * playerCombatants; settle{fielded} awards Holobot XP in the same transaction (users/{uid}.holobots).
 * #53 amendment 1: a rival-battle-3 issue fields WOLF's battle stats at level 1 + 4t (lineupScale on the
 * record); rival-battle-1 / -2 issues keep the #43 baseline x statScale.
 */

/** The travel squad ids for the player-side additions; [] when unreadable so v1/v2 rulings never depend on it. */
function squadIdsOf(profile: Record<string, unknown>): string[] {
  try {
    return readTravelSquad(profile).holobotIds;
  } catch {
    return [];
  }
}
/** Arena owns the shared health/activity lease until its host closes it, even past its deadline. */
function requireArenaClosed(raw: unknown): void {
  let open: boolean;
  try {
    open = leaseHolder(raw, undefined) !== null;
  } catch (error) {
    if (error instanceof ActivityError) throw new RivalError('unavailable');
    throw error;
  }
  if (open) throw new RivalError('activity_conflict');
}
/** The single account-parent lease read (Arena match OR duel-healing run), inside the issue transaction. */
async function requireLeaseFree(tx: Transaction, db: Firestore, uid: string): Promise<void> {
  if(expeditionOpen((await tx.get(db.doc(`holoZoneRuns/${uid}`))).data()))throw new RivalError('activity_conflict');
  const arena = (await tx.get(db.doc(`arenaMatches/${uid}`))).data(), duel = (await tx.get(db.doc(`duelHealingRuns/${uid}`))).data();
  let holder: 'arena' | 'duel' | null;
  try {
    holder = leaseHolder(arena, duel);
  } catch (error) {
    if (error instanceof ActivityError) throw new RivalError('unavailable');
    throw error;
  }
  if (holder === 'arena') throw new RivalError('activity_conflict');
  if (holder === 'duel') throw new RivalError('too_many_open');
}
/** fight-host-1: the settle-time replay, run OUTSIDE the transaction (CPU work never repeats on a transaction retry). */
async function preVerifyFightReplay(db: Firestore, uid: string, request: Record<string, unknown>): Promise<{ verdict: FightReplayVerdict; issue: FightReplayIssueWire } | undefined> {
  // Only a settle that carries a log pays the extra read; an input-log battle settled without one refuses in the transaction.
  if (request?.operation !== 'settle' || request[FIGHT_LOG_FIELD] === undefined || typeof request.battleId !== 'string' || !RIVAL_BATTLE_ID.test(request.battleId)) return undefined;
  const ref = db.doc(`rivalBattles/${uid}/battles/${request.battleId}`);
  const pre = (await ref.get()).data() as RivalBattleRecord | undefined;
  if (!pre || pre.settlement || pre.duel?.mode !== 'input-log') return undefined;
  const issue = pre.duel as FightReplayIssueWire;
  try {
    const verdict = verifyFightReplay(issue, request[FIGHT_LOG_FIELD], { battleId: request.battleId });
    console.info(JSON.stringify({ event: 'fight_replay_verified', battleId: request.battleId, ticks: verdict.ticks, replayMs: Math.round(verdict.replayMs * 10) / 10, winner: verdict.receipt.winner }));
    return { verdict, issue };
  } catch (e) {
    if (!(e instanceof FightReplayError)) throw e;
    if (e.code === 'invalid_issue') throw new RivalError('unavailable');
    // design-1 zero-tolerance: the result is not accepted; a telemetry line + a bounded record on the battle (repro handle).
    const rejection = { code: e.code, ...e.detail, atMs: Date.now() };
    console.warn(JSON.stringify({ event: 'fight_replay_rejected', battleId: request.battleId, ...rejection }));
    try { await ref.update({ fightReplayRejections: FieldValue.increment(1), lastFightReplayRejection: rejection }); } catch { /* telemetry is best effort */ }
    if (e.code === 'invalid_log') throw new RivalError('invalid_request', undefined, { reason: 'invalid_log', ...e.detail });
    throw new RivalError('replay_mismatch', undefined, e.detail);
  }
}

export async function transactRivalBattle(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), random: () => number = () => randomInt(0, 0x100000000) / 0x100000000, options: { zellEnabled?: boolean; allowLegacySettlement?: boolean; issueLegacy?: boolean; fightReplay?: boolean } = {}) {
  // One-release server flag. Requests cannot select or downgrade a stored mode.
  const legacyMode = options.issueLegacy ?? process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER !== '1';
  // fight-host-1: "replay verification ON" (HOLOCITY_FIGHT_REPLAY=1, default off) issues input-log to clients that declare
  // duel-inputs-2 on a rival-battle-3 issue. The capability only opts INTO the verified mode; it cannot pick legacy/resolver.
  const fightReplay = options.fightReplay ?? process.env[FIGHT_REPLAY_FLAG] === '1';
  const capability = (raw as Record<string, unknown> | null)?.[FIGHT_INPUTS_CAPABILITY_FIELD];
  if (capability !== undefined && capability !== FIGHT_INPUTS_SCHEMA) throw new RivalError('invalid_request');
  const allowLegacySettlement = options.allowLegacySettlement ?? process.env.HOLOCITY_RIVAL_ALLOW_LEGACY_DIDWIN !== '0';
  const request = raw as Record<string, unknown>;
  // Read the routing envelope before loading the pinned mode. Resolver mode ignores
  // client outcome/damage/HP/fielded claims; legacy validation happens in its branch.
  const command = validateRivalCommand(request?.operation === 'settle'
    ? {...request,didWin:false,fielded:undefined,health:undefined,healthSchema:undefined} : raw);
  const citizenId = gatheringRivalRequest(raw);
  const story = citizenId === undefined ? storyRequest(raw) : {requested:false,issueZell:false};
  const zellEnabled = options.zellEnabled === true;
  if (story.issueZell && !zellEnabled) throw new RivalError('unavailable');
  const inputLogIssue = fightReplay && capability === FIGHT_INPUTS_SCHEMA && command.operation === 'issue' && command.schemaVersion === 'rival-battle-3';
  const healthEnabled=!legacyMode || inputLogIssue || (raw as {healthSchema?:unknown})?.healthSchema===RIVAL_HEALTH_SCHEMA;
  const userRef = db.doc(`users/${uid}`);
  // Pin the battle id and draws outside the transaction so retries rule identically.
  const battleId = command.operation === 'settle' ? command.battleId : `rb_${randomBytes(12).toString('hex')}`;
  const draws = Array.from({ length: 8 }, random);
  // Separate from the legacy public presentation seed; never reveal future CPU draws at issue.
  const resolverSeed = randomBytes(4).readUInt32LE(0);
  // input-log seed: pinned outside the transaction like the draws (disclosed at issue: the client predicts the CPU locally).
  const fightSeed = randomBytes(32).toString('hex');
  const fightPre = await preVerifyFightReplay(db, uid, request);
  const ledgerRef = db.doc(`rivalBattles/${uid}`);
  const battleRef = db.doc(`rivalBattles/${uid}/battles/${battleId}`);
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new RivalError('unavailable');
    const profile = user.data()!;
    const storyRef = db.doc(`storyProgress/${uid}`);
    // All story reads happen before any Firestore write. Ordinary requests do not touch this path.
    let storyState = story.requested ? readZellStory((await tx.get(storyRef)).data()) : undefined;
    const withStory = (reply: object) => story.requested ? { ...reply, story: zellStoryView(storyState!, zellEnabled) } : reply;
    if (command.operation === 'status') {
      const r = rivalStatus(profile, nowMs);
      if (Object.keys(r.userUpdates).length) tx.update(userRef, withRankHealingReward(profile,r.userUpdates));
      return withStory(rivalReplyForVersion(r.reply, command.schemaVersion));
    }
    if (command.operation === 'issue') {
      // Read the same parent the Arena issue creates, so either transaction retries on a race.
      // This applies to legacy wire versions and flag-off issues too: they still open activity.
      await requireLeaseFree(tx, db, uid);
      const ledgerData = (await tx.get(ledgerRef)).data();
      const open = readOpenBattles(ledgerData, nowMs);
      const lastSettled = readRivalLastSettled(ledgerData);
      let i = 0;
      // #53 amendment 1: rival-battle-3 opponents = WOLF at level 1 + 4t; v1 / v2 keep the #43 baseline (byte-identical replies).
      const r = issueRivalBattle(profile, nowMs, battleId, () => draws[i++ % draws.length], squadIdsOf(profile), rivalLineupScaleFor(command.schemaVersion));
      // DECISIONS #72.3 (onboarding D1): Kaz's ordinary issue at host onboarding step <= 3 fields one tier-0 WOLF.
      const mentor = citizenId === undefined && !story.issueZell && onboardingMentorActive(profile);
      if (mentor) applyOnboardingMentor(r, rivalLineupScaleFor(command.schemaVersion));
      if ((!legacyMode || inputLogIssue) && r.reply.playerCombatants.length === 0) throw new RivalError('squad_required');
      if(healthEnabled){if(Object.keys(open).length)throw new RivalError("too_many_open");try{const vitals=issueVitals(profile,r.reply.playerCombatants);r.userUpdates.holobotVitals=vitals;(r.battle as typeof r.battle & {healthSchema:string;issuedVitals:Vitals}).healthSchema=RIVAL_HEALTH_SCHEMA;(r.battle as typeof r.battle & {issuedVitals:Vitals}).issuedVitals=Object.fromEntries(r.reply.playerCombatants.map(p=>[p.holobotId,vitals[p.holobotId]]));for(const p of r.reply.playerCombatants)(p as typeof p & {currentHealth:number}).currentHealth=vitals[p.holobotId].currentHealth;}catch(e){if(e instanceof HealthError)throw new RivalError(e.message==='invalid_request'?'invalid_request':'unavailable');throw e;}}
      if (story.issueZell) {
        bindZellLineup(r);
        const nextStory = meetZell(storyState!, nowMs);
        if (nextStory !== storyState) tx.set(storyRef, nextStory);
        storyState = nextStory;
      }
      if (citizenId !== undefined) bindGatheringRival(uid,profile,citizenId,r);
      const fightIssue = inputLogIssue ? buildFightReplayIssue({battleId, seed:fightSeed, tier:r.battle.tier, mentor,
        player:r.reply.playerCombatants, opponent:r.reply.encounter.opponentSquad}) : null;
      if (fightIssue) r.battle.duel = fightIssue;
      else if (legacyMode) r.battle.duel = {mode:'legacy'};
      else {
        const input = {seed:resolverSeed,player:r.reply.playerCombatants.map(c=>duelFighterFromCombatant({...c,tier:r.battle.tier})),
          opponent:r.reply.encounter.opponentSquad.map(c=>duelFighterFromCombatant({...c,tier:mentor ? 0 : r.battle.tier}))};
        try { resolveDuel({...input,playerIntents:['defend']}); } catch { throw new RivalError('unavailable'); }
        r.battle.duel = {mode:'resolver',schemaVersion:DUEL_RECEIPT_SCHEMA,input};
      }
      // DECISIONS #58 am. 1 (3): the SAME rival (pilotId, after the story binding) is refused within RIVAL_COOLDOWN_MS of its last settle.
      requireRivalOffCooldown(lastSettled, r.battle.lineup.opponentPilot.pilotId, nowMs);
      const nextOpen = openBattlesAfterIssue(open, r.battle);
      if (Object.keys(r.userUpdates).length) tx.update(userRef, withRankHealingReward(profile,r.userUpdates));
      tx.set(ledgerRef, { [RIVAL_OPEN_BATTLES_FIELD]: nextOpen, [RIVAL_LAST_SETTLED_FIELD]: lastSettled });
      // expireAt drives the Firestore TTL policy (functions/README.md); settle never changes it.
      tx.create(battleRef, { ...r.battle, [RIVAL_BATTLE_CLEANUP_FIELD]: Timestamp.fromMillis(rivalBattleCleanupAtMs(r.battle)) });
      // Gathering Unity keeps its existing player presentation payload. Omit only
      // the optional wire snapshot, after vitals and resolver fighters are pinned.
      const issueReply = rivalReplyForVersion(r.reply, command.schemaVersion);
      if (command.schemaVersion === 'rival-battle-3') issueReply.battlefieldMovement = battlefieldIssueMovement(r.reply);
      if (citizenId !== undefined) delete (issueReply as {playerCombatants?: unknown}).playerCombatants;
      return withStory({...issueReply,duel:r.battle.duel.mode === 'resolver'
        ? {mode:'resolver',schemaVersion:DUEL_RECEIPT_SCHEMA,maxRounds:DUEL_MAX_ROUNDS,
          player:r.battle.duel.input.player,opponent:r.battle.duel.input.opponent}
        : r.battle.duel.mode === 'input-log' ? {...r.battle.duel} : {mode:'legacy'}});
    }
    const battle = await tx.get(battleRef);
    const ledger = await tx.get(ledgerRef);
    const issued = battle.exists ? battle.data() as StoryRivalRecord : undefined;
    const isStoryBattle = issued?.storySchema === ZELL_STORY_SCHEMA && issued.storyRivalId === 'zell';
    if (isStoryBattle && !storyState) storyState = readZellStory((await tx.get(storyRef)).data());
    const record = battle.exists ? battle.data() as RivalBattleRecord : undefined;
    const withReceipt = (reply: object, receipt?: DuelReceipt, fight?: FightReceiptWire) => fight ? {...reply,[FIGHT_RECEIPT_FIELD]:fight} : receipt ? {...reply,duelReceipt:receipt} : reply;
    // Replays need no new intents/legacy flag/log and never recompute combat or write a grant.
    if (record?.settlement) {
      const replay = settleRivalBattle(profile,record,command.battleId,record.settlement.didWin,nowMs);
      return withStory(withReceipt(rivalReplyForVersion(replay.reply,command.schemaVersion),record.duelReceipt,record.fightReceipt));
    }
    if (!record) throw new RivalError('unknown_battle');
    let receipt: DuelReceipt | undefined;
    let fightReceipt: FightReceiptWire | undefined;
    let settleCommand = command;
    if (record.duel?.mode === 'input-log') {
      // The replay ran before the transaction against this same immutable issue block; a concurrent first settle, or a
      // record that changed in between, is never settled from a stale verdict.
      if (!fightPre) throw new RivalError('invalid_request', undefined, { reason: 'input_log_required' });
      if (fightPre.issue.rulesHash !== record.duel.rulesHash || fightPre.issue.seed !== record.duel.seed) throw new RivalError('unavailable');
      fightReceipt = fightPre.verdict.receipt;
      settleCommand = {...command,didWin:fightReceipt.winner === 'player',fielded:fightPre.verdict.fieldedHolobotIds};
    } else if (record.duel?.mode === 'resolver') {
      let intents;
      try { intents = validateDuelIntents(request.playerIntents); } catch { throw new RivalError('invalid_request'); }
      if (record.duel.schemaVersion !== DUEL_RECEIPT_SCHEMA) throw new RivalError('unavailable');
      try { receipt = resolveDuel({...record.duel.input,playerIntents:intents}); } catch { throw new RivalError('unavailable'); }
      settleCommand = {...command,didWin:receipt.winner === 'player',
        fielded:[...new Set(receipt.rounds.filter(round=>round.side==='player').map(round => round.attacker))]};
    } else {
      if (record.duel !== undefined && record.duel.mode !== 'legacy') throw new RivalError('unavailable');
      if (!allowLegacySettlement) throw new RivalError('legacy_settlement_disabled');
      const legacy = validateRivalCommand(raw);
      if (legacy.operation !== 'settle') throw new RivalError('invalid_request');
      settleCommand = legacy;
    }
    const r = settleRivalBattle(profile,record,command.battleId,settleCommand.didWin,nowMs,settleCommand.fielded,
      receipt || fightReceipt ? [] : squadIdsOf(profile));
    // Apply to the authoritative ruling, once in the same transaction as its receipt.
    // All rival versions (including gathering/Zell) count; losses and replays never do.
    if (r.battleUpdates?.settlement?.didWin) {
      try { r.userUpdates.pilotRank = pilotRankAfterWin(profile.pilotRank); }
      catch (e) { if (e instanceof PilotRankError) throw new RivalError('unavailable'); throw e; }
    }
    // A delayed pre-Arena battle must not settle rewards/HP into the current Arena activity.
    requireArenaClosed((await tx.get(db.doc(`arenaMatches/${uid}`))).data());
    if(expeditionOpen((await tx.get(db.doc(`holoZoneRuns/${uid}`))).data()))throw new RivalError('activity_conflict');
    if (r.battleUpdates && fightReceipt) {
      r.battleUpdates.fightReceipt = fightReceipt;
      // HP is the replay's, never the client's. A duel-healing run bound to THIS battle owns the duel's HP (#57: bench heals
      // are outside duel-sim-3 and settle with that run), exactly as for the legacy health rows.
      const bound=(await tx.get(db.doc(`duelHealingRuns/${uid}`))).data();
      if(bound?.rivalBattleId!==command.battleId){
        const b = battle.data()!;
        try { r.userUpdates.holobotVitals = settleVitals(profile,b.issuedVitals,
          fightReceipt.playerFinal.map(f => ({holobotId:f.holobotId,currentHealth:f.currentHealth}))); }
        catch { throw new RivalError('unavailable'); }
      }
    } else if (r.battleUpdates && receipt) {
      r.battleUpdates.duelReceipt = receipt;
      const b = battle.data()!;
      try { r.userUpdates.holobotVitals = settleVitals(profile,b.issuedVitals,
        receipt.playerFinal.map(f => ({holobotId:f.holobotId,currentHealth:f.currentHealth}))); }
      catch { throw new RivalError('unavailable'); }
    } else if(r.battleUpdates&&settleCommand.health!==undefined){const b=battle.data()!;if(b.healthSchema!==RIVAL_HEALTH_SCHEMA)throw new RivalError("invalid_request");
      // duel-healing-host-fix-1 (DECISIONS #57): a duel-healing run bound to THIS battle owns the duel's HP (bench heals settle
      // with the duel; its settle writes the ledger). The client rows are not applied here, so a healed bench bot presented
      // above its rival issue neither refuses the settle (invalid_request) nor undoes the heal.
      const bound=(await tx.get(db.doc(`duelHealingRuns/${uid}`))).data();
      if(bound?.rivalBattleId!==command.battleId){try{r.userUpdates.holobotVitals=settleVitals(profile,b.issuedVitals,settleCommand.health);}catch(e){if(e instanceof HealthError)throw new RivalError(e.message==='invalid_request'?'invalid_request':'unavailable');throw e;}}}
    // DECISIONS #72.3 (onboarding D1): a LOSS in a mentor-issued battle costs no HP. The squad's ledger rows go back to
    // their issue-time values (undoing a duel-healing run that settled first); the per-rival cooldown is not started below.
    const mentorLoss = !!r.battleUpdates && !r.battleUpdates.settlement?.didWin && isOnboardingMentorBattle(issued);
    if (mentorLoss) {
      const issuedVitals = (battle.data() as {issuedVitals?: Vitals}).issuedVitals;
      if (issuedVitals && Object.keys(issuedVitals).length) {
        const ledgerNow = (profile.holobotVitals ?? {}) as Vitals;
        r.userUpdates.holobotVitals = {...ledgerNow, ...Object.fromEntries(Object.entries(issuedVitals).map(([id,v]) => [id,{...v}]))};
      } else delete r.userUpdates.holobotVitals;
    }
    // Brief C2 beat 3: the first rival settle (any outcome) completes the mentor-duel beat.
    if (r.battleUpdates) Object.assign(r.userUpdates, onboardingAfterEvent(profile, 'rival_settle', nowMs));
    if (r.battleUpdates?.settlement?.didWin && isStoryBattle) {
      const nextStory = allyAfterZellVictory(storyState!, { ...issued!, ...r.battleUpdates }, nowMs);
      if (nextStory !== storyState) tx.set(storyRef, nextStory);
      storyState = nextStory;
    }
    if (Object.keys(r.userUpdates).length) tx.update(userRef, withRankHealingReward(profile,r.userUpdates));
    if (r.battleUpdates) {
      tx.update(battleRef, r.battleUpdates);
      // The cooldown clock starts at the first-time settle; a replay (returned above) never moves it.
      const pilotId = (battle.data() as RivalBattleRecord).lineup.opponentPilot.pilotId;
      tx.set(ledgerRef, { [RIVAL_OPEN_BATTLES_FIELD]: openBattlesAfterSettle(readOpenBattles(ledger.data(), nowMs), command.battleId), [RIVAL_LAST_SETTLED_FIELD]: mentorLoss ? readRivalLastSettled(ledger.data()) : rivalLastSettledAfterSettle(readRivalLastSettled(ledger.data()), pilotId, nowMs) });
    }
    return withStory(withReceipt(rivalReplyForVersion(r.reply, command.schemaVersion),receipt,fightReceipt));
  });
}
