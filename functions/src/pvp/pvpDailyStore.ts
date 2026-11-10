import { Firestore } from 'firebase-admin/firestore';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { IssueReply, PVP_ASYNC_SOURCE, RivalBattleRecord, RivalError, tierForWins } from '../lib/rivalLadder';
import { desktopPracticeCommands } from '../lib/desktopPracticeCommands';
import {
  buildPvpDaily, candidateFromProfile, PVP_CANDIDATE_QUERY_LIMIT, PVP_DAILY_SCHEMA, PVP_NEAR_TIER_BAND, PVP_WIDE_TIER_BAND,
  PvpCandidate, PvpError, pvpDailyNeedsRefresh, pvpDailyView, pvpIssue, readPvpDaily, validatePvpCommand, winsRangeForBand,
} from '../lib/pvpDaily';
import { pvpReplayMode, PvpReplayMode, transactRivalBattle } from '../rival/rivalBattleStore';

/**
 * pvp-daily-1 host (ship-readiness item 7). pvpDaily/{uid} is the day's list (server-only path). `list` rebuilds it once
 * per UTC day from users/ near the caller's rival tier; `issue` hands one opponent to the ordinary rival issue
 * (transactRivalBattle with a pvp binding: same transaction, same open-battle cap, cooldown, health and duel modes), and
 * the client settles that battleId through rivalBattleHost as for any rival. The record's `source: "pvp_async"` makes the
 * settle pay Holos only.
 */

const CANDIDATE_FIELDS = ['rivalWins', 'username', 'holobots', 'travelSquad'] as const;

function squadIdsOf(profile: Record<string, unknown>): string[] {
  try { return readTravelSquad(profile).holobotIds; } catch { return []; }
}

function rivalTierOf(profile: Record<string, unknown>): number {
  const wins = profile.rivalWins === undefined ? 0 : profile.rivalWins;
  if (typeof wins !== 'number' || !Number.isSafeInteger(wins) || wins < 0) throw new PvpError('unavailable');
  return tierForWins(wins);
}

/** Other pilots near the caller's tier: the near band first, then the wide band (two bounded range reads on rivalWins). */
async function readCandidates(db: Firestore, callerTier: number): Promise<PvpCandidate[]> {
  const out: PvpCandidate[] = [];
  for (const band of [PVP_NEAR_TIER_BAND, PVP_WIDE_TIER_BAND]) {
    const { lo, hi } = winsRangeForBand(callerTier, band);
    const snap = await db.collection('users').where('rivalWins', '>=', lo).where('rivalWins', '<=', hi)
      .select(...CANDIDATE_FIELDS).limit(PVP_CANDIDATE_QUERY_LIMIT).get();
    for (const d of snap.docs) {
      const profile = d.data();
      const c = candidateFromProfile(d.id, profile, squadIdsOf(profile));
      if (c) out.push(c);
    }
  }
  return out;
}

export async function transactPvpDaily(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), replay: PvpReplayMode | undefined = pvpReplayMode()) {
  const command = validatePvpCommand(raw);
  const pvpRef = db.doc(`pvpDaily/${uid}`);
  if (command.operation === 'list') {
    let doc = readPvpDaily((await pvpRef.get()).data());
    if (pvpDailyNeedsRefresh(doc, nowMs)) {
      const user = await db.doc(`users/${uid}`).get();
      if (!user.exists) throw new PvpError('unavailable');
      const tier = rivalTierOf(user.data()!);
      const candidates = await readCandidates(db, tier);
      const fresh = buildPvpDaily(uid, tier, candidates, nowMs);
      // Queries run outside; the write re-checks so two racing lists keep ONE day's list (and its spent attempts).
      doc = await db.runTransaction(async tx => {
        const current = readPvpDaily((await tx.get(pvpRef)).data());
        if (!pvpDailyNeedsRefresh(current, nowMs)) return current!;
        tx.set(pvpRef, fresh);
        return fresh;
      });
    }
    const results: Record<string, boolean> = {};
    for (const o of doc!.opponents) {
      if (!o.battleId) continue;
      const b = (await db.doc(`rivalBattles/${uid}/battles/${o.battleId}`).get()).data() as RivalBattleRecord | undefined;
      if (b?.settlement) results[o.battleId] = b.settlement.didWin;
    }
    return pvpDailyView(doc!, nowMs, results);
  }
  // issue: the ordinary rival issue request a rival-battle-3 desktop client sends, bound to the chosen opponent.
  const rivalRequest: Record<string, unknown> = { schemaVersion: 'rival-battle-3', operation: 'issue', healthSchema: 'rival-health-1' };
  if (command.duelInputs !== undefined) rivalRequest.duelInputs = command.duelInputs;
  let callsign = '';
  const reply = await transactRivalBattle(db, uid, rivalRequest, nowMs, undefined, {
    pvp: {
      replay,
      bind: async (tx, r: { battle: RivalBattleRecord; reply: IssueReply }) => {
        const ruling = pvpIssue(readPvpDaily((await tx.get(pvpRef)).data()), command.opponentId, r.battle.battleId, nowMs);
        callsign = ruling.opponent.callsign;
        r.battle.lineup = { opponentPilot: ruling.lineup.opponentPilot, opponentSquad: ruling.lineup.opponentSquad };
        r.battle.source = PVP_ASYNC_SOURCE;
        r.battle.pvp = { opponentId: command.opponentId, day: ruling.doc.day };
        const fromPlayer = ruling.opponent.kind === 'player';
        r.reply.encounter = {
          ...r.reply.encounter, opponentPilot: { ...ruling.lineup.opponentPilot },
          opponentSquad: ruling.lineup.opponentSquad.map(c => ({ ...c, commandRules: desktopPracticeCommands(c.holobotId), ...(fromPlayer ? { statSource: 'progression' as const } : {}) })),
        };
        tx.set(pvpRef, ruling.doc);
      },
    },
  });
  return { ...reply, pvp: { schemaVersion: PVP_DAILY_SCHEMA, opponentId: command.opponentId, callsign, source: PVP_ASYNC_SOURCE } };
}

/** HttpsError mapping for the callable (rejectionCode carries the PvP or rival code). */
export function pvpErrorCode(error: PvpError | RivalError): 'invalid-argument' | 'not-found' | 'failed-precondition' | 'unavailable' {
  const c = error.code;
  if (c === 'invalid_request') return 'invalid-argument';
  if (c === 'unknown_opponent') return 'not-found';
  if (c === 'no_attempts_left' || c === 'list_expired' || c === 'too_many_open' || c === 'activity_conflict' || c === 'rival_cooldown' || c === 'squad_required') return 'failed-precondition';
  return 'unavailable';
}
