import { describe, expect, it } from 'vitest';
import { buildDesktopAccountReply } from '../../../../functions/src/desktop/desktopAccountReply';

// Host-backed contract tests only: mobile has no desktop-account transport/store consumer yet.
const versions = ['desktop-account-1', 'desktop-account-2', 'desktop-account-3'] as const;
const defaults = { arenaGatheringSeen: false, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false };
const units = { light: 1, medium: 0, heavy: 2 };

describe('desktop account host storyFlags contract available to mobile', () => {
  it.each(versions)('%s defaults all four fields without mutating the source profile', version => {
    const profile = { holobots: [], blueprints: { ace: 1 } };
    const before = structuredClone(profile);
    const reply = buildDesktopAccountReply(profile, 'throwaway-desktop', version, units);
    expect(reply).toMatchObject({ schemaVersion: version, uid: 'throwaway-desktop', storyFlags: defaults });
    expect(reply.buddyUnits).toEqual(version === 'desktop-account-1' ? 3 : units);
    expect(profile).toEqual(before);
  });

  it.each(versions)('%s preserves boolean gates and numeric tournament counts at every stage', version => {
    for (const tournamentsWon of [0, 1, 2, 3]) {
      const storyFlags = { ...defaults, arenaGatheringSeen: true, tournamentsWon, arenaArcBuilt: tournamentsWon === 3 };
      const reply = buildDesktopAccountReply({ storyFlags }, 'throwaway-desktop', version, units);
      expect(reply.storyFlags).toEqual(storyFlags);
      expect(reply.storyFlags).not.toBe(storyFlags);
    }
  });

  it('fills missing fields while preserving gathered progress instead of resetting the account', () => {
    const storyFlags = { arenaGatheringSeen: true };
    const reply = buildDesktopAccountReply({ storyFlags }, 'throwaway-desktop', 'desktop-account-3', units);
    expect(reply.storyFlags).toEqual({ ...defaults, arenaGatheringSeen: true });
    expect(storyFlags).toEqual({ arenaGatheringSeen: true });
  });

  it.each([
    null, [], 'flags',
    { tournamentsWon: -1 }, { tournamentsWon: 4 }, { tournamentsWon: 1.5 },
    { tournamentsWon: '2' }, { tournamentsWon: true }, { tournamentsWon: null },
    { arenaGatheringSeen: 1 }, { arenaArcBuilt: true }, { tournamentsWon: 3, arenaArcBuilt: false },
    { holoZonesArcBuilt: 'false' },
  ])('refuses malformed host state rather than coercing it into mobile defaults: %j', storyFlags => {
    for (const version of versions) {
      expect(() => buildDesktopAccountReply({ storyFlags }, 'throwaway-desktop', version, units)).toThrow('unavailable');
    }
  });
});
