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
    || flags.tournamentsWon < 0 || flags.tournamentsWon > 3
    || flags.arenaArcBuilt !== (flags.tournamentsWon === 3)
    || (s && Object.values(s).some(v => v === null))) throw new StoryError('unavailable');
  return flags;
}
