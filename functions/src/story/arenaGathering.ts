import { createHash } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { readStoryFlags, StoryError } from './storyFlags';

export const ARENA_GATHERING_SCHEMA = 'arena-gathering-1';
/** Exact scene instance ids from HoloCity_Main, CV1_Population (15 CitizenWander bodies). */
export const CV1_CITIZENS = [
  ['CV1_HB_CITIZEN5_PlazaSignal_00', 'Plaza Signal'],
  ['CV1_HB_CITIZEN1_FerryOlive_01', 'Ferry Olive'],
  ['CV1_HB_CITIZEN4_DaycrewWhite_02', 'Daycrew White'],
  ['CV1_HB_CITIZEN3_MarketMagenta_03', 'Market Magenta'],
  ['CV1_HB_CITIZEN2_CampusAmber_04', 'Campus Amber'],
  ['CV1_HB_CITIZEN5_MarketAmber_05', 'Market Amber'],
  ['CV1_HB_CITIZEN1_LineCyan_06', 'Line Cyan'],
  ['CV1_HB_CITIZEN4_DepotOlive_07', 'Depot Olive'],
  ['CV1_HB_CITIZEN3_HarvestAmber_08', 'Harvest Amber'],
  ['CV1_HB_CITIZEN2_CampusWhite_09', 'Campus White'],
  ['CV1_HB_CITIZEN5_TransitCyan_10', 'Transit Cyan'],
  ['CV1_HB_CITIZEN1_HarbourSlate_11', 'Harbour Slate'],
  ['CV1_HB_CITIZEN4_HiVisAmber_12', 'Hi Vis Amber'],
  ['CV1_HB_CITIZEN3_StallLinen_13', 'Stall Linen'],
  ['CV1_HB_CITIZEN2_CampusMagenta_14', 'Campus Magenta'],
] as const;
/** Frozen v1 pool: additions to the wider catalog must not reshuffle returning citizens. */
export const GATHERING_HOLOBOTS = ['ace','wolf','shadow','kuma','tora','ken','kurai','era','hare','wake','gama','tsuin'] as const;
/** Exact SlotAccentPalette.cs Color32 RGB values, player then rival. Repeats allowed. */
export const GATHERING_RING_COLORS = ['#2FE6FF','#7CFF4F','#B07CFF','#FF7A1A','#FF3D8B','#FFD21A'] as const;
export type CitizenPilot = { citizenId: string; pilotName: string; holobotId: string; rank: 'Rookie'; ringColor: string };
const digest = (uid: string, key: string) => createHash('sha256').update(JSON.stringify([ARENA_GATHERING_SCHEMA, uid, key])).digest();
export function gatheringRoster(uid: string): CitizenPilot[] {
  const usedPairs = new Set<string>();
  return CV1_CITIZENS.map(([citizenId,pilotName]) => ({citizenId,pilotName,hash:digest(uid,citizenId)}))
    .sort((a,b) => Buffer.compare(a.hash,b.hash) || a.citizenId.localeCompare(b.citizenId)).slice(0,8)
    .map(({citizenId,pilotName,hash}, i) => {
      const ringColor = GATHERING_RING_COLORS[i%GATHERING_RING_COLORS.length];
      let botIndex = hash.readUInt32BE(0)%GATHERING_HOLOBOTS.length;
      // Eight citizens share six palette hues. A repeated bot must have a different ring.
      while (usedPairs.has(`${GATHERING_HOLOBOTS[botIndex]}:${ringColor}`)) botIndex = (botIndex+1)%GATHERING_HOLOBOTS.length;
      const holobotId = GATHERING_HOLOBOTS[botIndex];
      usedPairs.add(`${holobotId}:${ringColor}`);
      return {citizenId,pilotName,holobotId,rank:'Rookie',ringColor};
    });
}
export async function transactArenaGathering(db: Firestore, uid: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || (raw as Record<string, unknown>).schemaVersion !== ARENA_GATHERING_SCHEMA
    || Object.keys(raw).some(k => k !== 'schemaVersion')) throw new StoryError('invalid_request');
  const roster = gatheringRoster(uid);
  return db.runTransaction(async tx => {
    const ref = db.doc(`users/${uid}`), snap = await tx.get(ref);
    if (!snap.exists) throw new StoryError('unavailable');
    const previous = readStoryFlags(snap.data()!.storyFlags);
    const storyFlags = {...previous,arenaGatheringSeen:true};
    if (JSON.stringify(snap.data()!.storyFlags) !== JSON.stringify(storyFlags)) tx.update(ref,{storyFlags});
    return {schemaVersion:ARENA_GATHERING_SCHEMA,roster,storyFlags};
  });
}
