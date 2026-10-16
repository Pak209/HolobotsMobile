import { DUEL_RECEIPT_SCHEMA, DUEL_MAX_ROUNDS, duelFighterFromCombatant, resolveDuel, validateDuelIntents, DuelReceipt } from '../lib/duelResolver';
import { bindGatheringRival, gatheringRivalRequest } from '../story/gatheringRival';
import { pilotRankAfterWin, PilotRankError } from '../account/pilotRank';
import { ActivityError, leaseHolder } from '../lib/arenaActivity';
import {withRankHealingReward} from "../lib/rankHealingReward";
import { allyAfterZellVictory, bindZellLineup, meetZell, readZellStory, storyRequest, StoryRivalRecord, ZELL_STORY_SCHEMA, zellStoryView } from '../lib/zellStory';
import {issueVitals,settleVitals,RIVAL_HEALTH_SCHEMA,HealthError,Vitals} from "../lib/rivalHealth";
import { randomBytes, randomInt } from 'node:crypto';
import { Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { issueRivalBattle, rivalLineupScaleFor, rivalReplyForVersion, openBattlesAfterIssue, openBattlesAfterSettle, readOpenBattles, RIVAL_BATTLE_CLEANUP_FIELD, RIVAL_OPEN_BATTLES_FIELD, rivalBattleCleanupAtMs, RivalBattleRecord, readRivalLastSettled, requireRivalOffCooldown, rivalLastSettledAfterSettle, RIVAL_LAST_SETTLED_FIELD, RivalError, rivalStatus, settleRivalBattle, validateRivalCommand } from '../lib/rivalLadder';

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
export async function transactRivalBattle(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), random: () => number = () => randomInt(0, 0x100000000) / 0x100000000, options: { zellEnabled?: boolean; allowLegacySettlement?: boolean; issueLegacy?: boolean } = {}) {
  // One-release server flag. Requests cannot select or downgrade a stored mode.
  const legacyMode = options.issueLegacy ?? process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER !== '1';
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
  const healthEnabled=!legacyMode || (raw as {healthSchema?:unknown})?.healthSchema===RIVAL_HEALTH_SCHEMA;
  const userRef = db.doc(`users/${uid}`);
  // Pin the battle id and draws outside the transaction so retries rule identically.
  const battleId = command.operation === 'settle' ? command.battleId : `rb_${randomBytes(12).toString('hex')}`;
  const draws = Array.from({ length: 8 }, random);
  // Separate from the legacy public presentation seed; never reveal future CPU draws at issue.
  const resolverSeed = randomBytes(4).readUInt32LE(0);
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
      if (!legacyMode && r.reply.playerCombatants.length === 0) throw new RivalError('squad_required');
      if(healthEnabled){if(Object.keys(open).length)throw new RivalError("too_many_open");try{const vitals=issueVitals(profile,r.reply.playerCombatants);r.userUpdates.holobotVitals=vitals;(r.battle as typeof r.battle & {healthSchema:string;issuedVitals:Vitals}).healthSchema=RIVAL_HEALTH_SCHEMA;(r.battle as typeof r.battle & {issuedVitals:Vitals}).issuedVitals=Object.fromEntries(r.reply.playerCombatants.map(p=>[p.holobotId,vitals[p.holobotId]]));for(const p of r.reply.playerCombatants)(p as typeof p & {currentHealth:number}).currentHealth=vitals[p.holobotId].currentHealth;}catch(e){if(e instanceof HealthError)throw new RivalError(e.message==='invalid_request'?'invalid_request':'unavailable');throw e;}}
      if (story.issueZell) {
        bindZellLineup(r);
        const nextStory = meetZell(storyState!, nowMs);
        if (nextStory !== storyState) tx.set(storyRef, nextStory);
        storyState = nextStory;
      }
      if (citizenId !== undefined) bindGatheringRival(uid,profile,citizenId,r);
      if (legacyMode) r.battle.duel = {mode:'legacy'};
      else {
        const input = {seed:resolverSeed,player:r.reply.playerCombatants.map(c=>duelFighterFromCombatant({...c,tier:r.battle.tier})),
          opponent:r.reply.encounter.opponentSquad.map(c=>duelFighterFromCombatant({...c,tier:r.battle.tier}))};
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
      if (citizenId !== undefined) delete (issueReply as {playerCombatants?: unknown}).playerCombatants;
      return withStory({...issueReply,duel:r.battle.duel.mode === 'resolver'
        ? {mode:'resolver',schemaVersion:DUEL_RECEIPT_SCHEMA,maxRounds:DUEL_MAX_ROUNDS,
          player:r.battle.duel.input.player,opponent:r.battle.duel.input.opponent} : {mode:'legacy'}});
    }
    const battle = await tx.get(battleRef);
    const ledger = await tx.get(ledgerRef);
    const issued = battle.exists ? battle.data() as StoryRivalRecord : undefined;
    const isStoryBattle = issued?.storySchema === ZELL_STORY_SCHEMA && issued.storyRivalId === 'zell';
    if (isStoryBattle && !storyState) storyState = readZellStory((await tx.get(storyRef)).data());
    const record = battle.exists ? battle.data() as RivalBattleRecord : undefined;
    const withReceipt = (reply: object, receipt?: DuelReceipt) => receipt ? {...reply,duelReceipt:receipt} : reply;
    // Replays need no new intents/legacy flag and never recompute combat or write a grant.
    if (record?.settlement) {
      const replay = settleRivalBattle(profile,record,command.battleId,record.settlement.didWin,nowMs);
      return withStory(withReceipt(rivalReplyForVersion(replay.reply,command.schemaVersion),record.duelReceipt));
    }
    if (!record) throw new RivalError('unknown_battle');
    let receipt: DuelReceipt | undefined;
    let settleCommand = command;
    if (record.duel?.mode === 'resolver') {
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
      receipt ? [] : squadIdsOf(profile));
    // Apply to the authoritative ruling, once in the same transaction as its receipt.
    // All rival versions (including gathering/Zell) count; losses and replays never do.
    if (r.battleUpdates?.settlement?.didWin) {
      try { r.userUpdates.pilotRank = pilotRankAfterWin(profile.pilotRank); }
      catch (e) { if (e instanceof PilotRankError) throw new RivalError('unavailable'); throw e; }
    }
    // A delayed pre-Arena battle must not settle rewards/HP into the current Arena activity.
    requireArenaClosed((await tx.get(db.doc(`arenaMatches/${uid}`))).data());
    if (r.battleUpdates && receipt) {
      r.battleUpdates.duelReceipt = receipt;
      const b = battle.data()!;
      try { r.userUpdates.holobotVitals = settleVitals(profile,b.issuedVitals,
        receipt.playerFinal.map(f => ({holobotId:f.holobotId,currentHealth:f.currentHealth}))); }
      catch { throw new RivalError('unavailable'); }
    } else if(r.battleUpdates&&settleCommand.health!==undefined){const b=battle.data()!;if(b.healthSchema!==RIVAL_HEALTH_SCHEMA)throw new RivalError("invalid_request");try{r.userUpdates.holobotVitals=settleVitals(profile,b.issuedVitals,settleCommand.health);}catch(e){if(e instanceof HealthError)throw new RivalError(e.message==='invalid_request'?'invalid_request':'unavailable');throw e;}}
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
      tx.set(ledgerRef, { [RIVAL_OPEN_BATTLES_FIELD]: openBattlesAfterSettle(readOpenBattles(ledger.data(), nowMs), command.battleId), [RIVAL_LAST_SETTLED_FIELD]: rivalLastSettledAfterSettle(readRivalLastSettled(ledger.data()), pilotId, nowMs) });
    }
    return withStory(withReceipt(rivalReplyForVersion(r.reply, command.schemaVersion),receipt));
  });
}
