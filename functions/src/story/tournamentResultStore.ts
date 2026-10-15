import { Firestore } from 'firebase-admin/firestore';
import { ArenaError, readArenaMatchRecord } from '../arena/arenaMatchStore';
import { ARENA_TOURNAMENT_SCHEMA, requireNextTournament, tournamentIndex, tournamentLevel } from './arenaTournament';
import { StoryError } from './storyFlags';

/** Consumes only an authenticated account's host-issued, tournament-tagged win.
 * No outcome/level/win count is accepted from the request. Existing practice-sim
 * receipts retain their documented client-observed-combat trust boundary.
 */
export async function transactTournamentResult(db: Firestore, uid: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new StoryError('invalid_request');
  const c = raw as Record<string, unknown>;
  if (c.schemaVersion !== ARENA_TOURNAMENT_SCHEMA || typeof c.matchId !== 'string'
    || !/^am_[a-f0-9]{32}$/.test(c.matchId)
    || Object.keys(c).some(k => !['schemaVersion','tournamentId','matchId'].includes(k))) throw new StoryError('invalid_request');
  tournamentIndex(c.tournamentId);
  const matchId = c.matchId;
  return db.runTransaction(async tx => {
    const userRef = db.doc(`users/${uid}`), snap = await tx.get(userRef);
    if (!snap.exists) throw new StoryError('unavailable');
    const flags = requireNextTournament(snap.data()!.storyFlags,c.tournamentId);
    const matchRef = db.doc(`arenaMatches/${uid}/matches/${matchId}`), matchSnap = await tx.get(matchRef);
    if (!matchSnap.exists) throw new StoryError('unknown_match');
    let m;
    try { m = readArenaMatchRecord(matchSnap.data(),matchId); }
    catch (e) { if (e instanceof ArenaError) throw new StoryError('unavailable'); throw e; }
    if (m.tournament?.tournamentId !== c.tournamentId) throw new StoryError('invalid_match');
    if (m.entrant.level < tournamentLevel(c.tournamentId)) throw new StoryError('rank_too_low');
    if (m.state !== 'settled' || m.settlementReceipt?.outcome !== 'win') throw new StoryError('win_required');
    const tournamentsWon = flags.tournamentsWon + 1;
    // TODO: a later HoloZones story lane owns holoZonesArcBuilt. Preserve it here.
    const storyFlags = {...flags,tournamentsWon,arenaArcBuilt:tournamentsWon === 3};
    tx.update(userRef,{storyFlags});
    return {schemaVersion:ARENA_TOURNAMENT_SCHEMA,tournamentId:c.tournamentId,matchId,storyFlags};
  });
}
