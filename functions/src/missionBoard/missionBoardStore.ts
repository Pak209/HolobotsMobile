import { randomBytes } from 'node:crypto';
import { Firestore, Transaction } from 'firebase-admin/firestore';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { HostError } from '../acquisition/wildEncounterDomain';
import { CITY_KURAI_ENCOUNTER_ID } from '../city/cityEncounterHost';
import { HoloZoneError, readHoloZoneRuns } from '../lib/holoZoneRuns';
import { INTRO_QUEST_STEPS, IntroQuestError, introStatus, readIntroQuestState, readRivalWinsForQuest } from '../lib/introQuests';
import {
  BoardCandidates, BoardFacts, boardView, claimPosting, CITY_KURAI_HOLOBOT, factsNeeded, freshBoard, MISSION_BOARD_SCHEMA,
  MissionBoardDoc, MissionBoardError, missionBoardBalances, readBoard, refillBoard, validateMissionBoardCommand,
} from '../lib/missionBoard';
import { transactIntroQuest } from '../quests/introQuestStore';
import { gatheringRoster } from '../story/arenaGathering';
import { readStoryFlags, StoryError } from '../story/storyFlags';

/**
 * Mission Board store (contract: ./README.md). Board state lives at missionBoards/{uid}: top-level, server-only
 * (rules deny every client read/write). Completion is verified from EXISTING server-only records, never from the
 * client-writable users/{uid}:
 *   beast   → holoZoneRuns/{uid}.runs[].settlement (zoneId, didWin, expWithheld, settledAtMs)
 *   rival   → rivalBattles/{uid}/battles/* (settlement.didWin, settlement.settledAtMs, lineup.opponentPilot.pilotId)
 *   capture → wildEncounterSessions/{uid}/receipts/* (reply.captureResult.captured / holobotId; the receipt's createTime)
 * The intro quest chain is read from (and intro step claims forwarded to) the intro quest store; nothing is copied.
 */

/** Bounded fact reads: more than this many settles / captures since a posting went up is not expected. */
export const MISSION_BOARD_FACT_LIMIT = 100;

function guard<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    // Malformed stored data in a source record fails closed, as in the hosts that own it.
    if (e instanceof IntroQuestError || e instanceof HoloZoneError || e instanceof HostError || e instanceof StoryError) throw new MissionBoardError('unavailable');
    throw e;
  }
}

const HOLOBOT_ID = /^[a-z][a-z0-9_]{0,63}$/;
type SessionLike = { enabled?: unknown; encounters?: unknown } | undefined;

/** What the generator may draw: citizens once the Arena gathering was seen; open wild encounters + KURAI until linked. */
export function boardCandidates(uid: string, profile: Record<string, unknown>, session: SessionLike, sessionExists: boolean): BoardCandidates {
  const citizens = guard(() => readStoryFlags(profile.storyFlags)).arenaGatheringSeen
    ? gatheringRoster(uid).map(c => ({ citizenId: c.citizenId, pilotName: c.pilotName })) : [];
  const captureTargets: string[] = [];
  if (!sessionExists || session?.enabled === true) {
    const encounters = sessionExists && Array.isArray(session?.encounters) ? session!.encounters as Record<string, unknown>[] : [];
    for (const e of encounters) {
      if (!e || typeof e.holobotId !== 'string' || !HOLOBOT_ID.test(e.holobotId) || e.ended === true || e.captureOpen !== true) continue;
      if (!captureTargets.includes(e.holobotId)) captureTargets.push(e.holobotId);
    }
    // The Research Garden KURAI: offered until its city encounter exists (cityEncounterHost provisions it on arrival).
    if (!encounters.some(e => e && e.encounterId === CITY_KURAI_ENCOUNTER_ID) && !captureTargets.includes(CITY_KURAI_HOLOBOT)) captureTargets.push(CITY_KURAI_HOLOBOT);
  }
  return { citizens, captureTargets };
}

async function gatherFacts(db: Firestore, tx: Transaction, uid: string, board: MissionBoardDoc, sessionExists: boolean): Promise<BoardFacts> {
  const need = factsNeeded(board.slots.map(s => s.posting));
  const facts: { zoneSettles: BoardFacts['zoneSettles'][number][]; rivalSettles: BoardFacts['rivalSettles'][number][]; captures: BoardFacts['captures'][number][] } = { zoneSettles: [], rivalSettles: [], captures: [] };
  if (need.zone) {
    const snap = await tx.get(db.doc(`holoZoneRuns/${uid}`));
    for (const r of guard(() => readHoloZoneRuns(snap.exists ? snap.data() : undefined))) {
      const s = r.settlement;
      if (s && typeof s.settledAtMs === 'number') facts.zoneSettles.push({ zoneId: r.zoneId, didWin: s.didWin === true, expWithheld: s.expWithheld === true, settledAtMs: s.settledAtMs });
    }
  }
  if (need.rival) {
    const q = db.collection(`rivalBattles/${uid}/battles`).where('settlement.settledAtMs', '>', need.sinceMs).orderBy('settlement.settledAtMs').limit(MISSION_BOARD_FACT_LIMIT);
    for (const d of (await tx.get(q)).docs) {
      const b = d.data() as { settlement?: { didWin?: unknown; settledAtMs?: unknown }; lineup?: { opponentPilot?: { pilotId?: unknown } } };
      const pilotId = b.lineup?.opponentPilot?.pilotId;
      if (typeof pilotId === 'string' && typeof b.settlement?.settledAtMs === 'number') facts.rivalSettles.push({ pilotId, didWin: b.settlement.didWin === true, settledAtMs: b.settlement.settledAtMs });
    }
  }
  if (need.capture && sessionExists) {
    const q = db.collection(`wildEncounterSessions/${uid}/receipts`).where('reply.captureResult.captured', '==', true).limit(MISSION_BOARD_FACT_LIMIT);
    for (const d of (await tx.get(q)).docs) {
      const holobotId = (d.data() as { reply?: { captureResult?: { holobotId?: unknown } } }).reply?.captureResult?.holobotId;
      if (typeof holobotId === 'string' && d.createTime) facts.captures.push({ holobotId, capturedAtMs: d.createTime.toMillis() });
    }
  }
  return facts;
}

const INTRO_CODE: Record<string, MissionBoardError['code']> = { not_met: 'not_complete', already_claimed: 'already_claimed', out_of_order: 'out_of_order', invalid_request: 'invalid_request', unavailable: 'unavailable' };

/**
 * status | claim{postingId, requestId, destinationId?}. `seed` is pinned outside the transaction (used only when the
 * board doc is first created) so a retried transaction draws the same postings.
 */
export async function transactMissionBoard(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), seed: string = randomBytes(16).toString('hex')) {
  const command = validateMissionBoardCommand(raw);
  // Intro steps are claimed through the ONE intro quest store (its own transaction, rules and receipts).
  if (command.operation === 'claim' && INTRO_QUEST_STEPS.some(s => s.stepId === command.postingId)) {
    try {
      const intro = await transactIntroQuest(db, uid, { operation: 'claim', stepId: command.postingId, requestId: command.requestId, ...(command.destinationId ? { destinationId: command.destinationId } : {}) }, nowMs);
      return { schemaVersion: MISSION_BOARD_SCHEMA, source: 'intro' as const, postingId: command.postingId, requestId: command.requestId, alreadyProcessed: (intro as { alreadyProcessed?: boolean }).alreadyProcessed === true, intro };
    } catch (e) {
      if (e instanceof IntroQuestError) throw new MissionBoardError(INTRO_CODE[e.code] ?? 'unavailable');
      throw e;
    }
  }
  const userRef = db.doc(`users/${uid}`), introRef = db.doc(`introQuests/${uid}`), boardRef = db.doc(`missionBoards/${uid}`), sessionRef = db.doc(`wildEncounterSessions/${uid}`);
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new MissionBoardError('unavailable');
    const profile = user.data()!;
    const introDoc = await tx.get(introRef);
    const { state: intro } = guard(() => readIntroQuestState(introDoc.exists ? introDoc.data() : undefined, nowMs, readRivalWinsForQuest(profile)));
    const balances = missionBoardBalances(profile);
    if (intro.currentIndex < INTRO_QUEST_STEPS.length) {
      if (command.operation === 'claim') throw new MissionBoardError('intro_pending');
      return { schemaVersion: MISSION_BOARD_SCHEMA, introPending: true, intro: introStatus(intro), postings: [], refillAtMs: null, hostFlags: { new_posting: false, posting_cleared: false }, balances };
    }
    const boardSnap = await tx.get(boardRef);
    const session = await tx.get(sessionRef);
    const candidates = boardCandidates(uid, profile, session.data() as SessionLike, session.exists);
    const stored = readBoard(boardSnap.exists ? boardSnap.data() : undefined);
    let board = stored ? refillBoard(stored, uid, candidates, nowMs).board : freshBoard(uid, seed, candidates, nowMs);
    const facts = await gatherFacts(db, tx, uid, board, session.exists);
    if (command.operation === 'status') {
      const view = boardView(board, facts, board.seenThroughMs);
      board = { ...board, seenThroughMs: Math.max(board.seenThroughMs, nowMs) };
      tx.set(boardRef, board);
      return { schemaVersion: MISSION_BOARD_SCHEMA, introPending: false, intro: null, ...view, balances };
    }
    const target = board.slots.find(s => s.posting.postingId === command.postingId)?.posting;
    const squadIds = target && !target.claim && target.kind !== 'visit' ? guard(() => readTravelSquad(profile)).holobotIds : [];
    const r = claimPosting(board, profile, command, facts, squadIds, nowMs);
    if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
    if (r.board) tx.set(boardRef, r.board);
    else if (board !== stored) tx.set(boardRef, board);
    return r.reply;
  });
}
