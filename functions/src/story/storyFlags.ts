/** DECISIONS #59: host-owned account story gates; absent fields lazily default. */
export type StoryFlags = {
  arenaGatheringSeen: boolean;
  tournamentsWon: number;
  arenaArcBuilt: boolean;
  holoZonesArcBuilt: boolean;
};
export class StoryError extends Error {
  constructor(public code: string) { super(code); }
}
/**
 * The Legends Cup (Pak, 2026-11-09) is dormant: shipped Lite and Unity builds reject tournamentsWon above 3, reject a
 * tournamentId they don't know, and require arenaArcBuilt === (tournamentsWon === 3). Flip this in code only after both have
 * shipped readers for a fourth cup (src/story/CUP_PRIZES.md). It is not an env flag; tests are the only other writer.
 */
export const STORY_CUPS = { legendsLive: false };
export const maxTournamentsWon = () => (STORY_CUPS.legendsLive ? 4 : 3);
export function readStoryFlags(raw: unknown): StoryFlags {
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) throw new StoryError('unavailable');
  const s = raw as Partial<StoryFlags> | undefined;
  const flags = {
    arenaGatheringSeen: s?.arenaGatheringSeen ?? false,
    tournamentsWon: s?.tournamentsWon ?? 0,
    arenaArcBuilt: s?.arenaArcBuilt ?? false,
    holoZonesArcBuilt: s?.holoZonesArcBuilt ?? false,
  };
  if (typeof flags.arenaGatheringSeen !== 'boolean' || typeof flags.arenaArcBuilt !== 'boolean'
    || typeof flags.holoZonesArcBuilt !== 'boolean' || !Number.isInteger(flags.tournamentsWon)
    || flags.tournamentsWon < 0 || flags.tournamentsWon > maxTournamentsWon()
    || flags.arenaArcBuilt !== (flags.tournamentsWon >= 3)
    || (s && Object.values(s).some(v => v === null))) throw new StoryError('unavailable');
  return flags;
}
