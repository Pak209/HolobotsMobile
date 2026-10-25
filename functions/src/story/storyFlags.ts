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

/**
 * host-crawl-fixes-1 (crawl host item 3): the DISPLAY read of the story flags. Never throws and never returns empty,
 * so one inconsistent legacy flag cannot blank the Home dashboard (desktopAccountSnapshot used to refuse the whole
 * snapshot as `unavailable`). `exact` is true only when the strict reader accepts the stored value; then `flags` is
 * exactly readStoryFlags(raw). Otherwise `flags` is a locked-side fallback for display only:
 *  - a non-boolean flag reads false; a tournamentsWon outside the integers 0..3 reads 0;
 *  - arenaArcBuilt reads true only when the stored value is true AND tournamentsWon is 3 (the invariant both
 *    writers keep), so a mismatch shows the arc as not built.
 * Callers must NOT persist a non-exact result, nor feed it to a writer or gate: every host writer keeps calling the
 * strict readStoryFlags and still refuses a malformed record (fail closed; a fallback tournamentsWon of 0 would
 * otherwise re-open won tournaments).
 */
export function readStoryFlagsTolerant(raw: unknown): { flags: StoryFlags; exact: boolean } {
  try { return { flags: readStoryFlags(raw), exact: true }; }
  catch (e) { if (!(e instanceof StoryError)) throw e; }
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const bool = (v: unknown) => v === true;
  const won = typeof s.tournamentsWon === 'number' && Number.isInteger(s.tournamentsWon) && s.tournamentsWon >= 0 && s.tournamentsWon <= 3 ? s.tournamentsWon : 0;
  return { exact: false, flags: {
    arenaGatheringSeen: bool(s.arenaGatheringSeen),
    tournamentsWon: won,
    arenaArcBuilt: bool(s.arenaArcBuilt) && won === 3,
    holoZonesArcBuilt: bool(s.holoZonesArcBuilt),
  } };
}
