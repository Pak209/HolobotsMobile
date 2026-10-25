import { HOLOZONE_ZONE_TIERS } from '../lib/holoZoneRuns';
import { readStoryFlagsTolerant } from '../story/storyFlags';

/** Dashboard catalog mirrored from Unity db265127c dashboard-preview.json; not its fabricated pilot data.
 * zoneId is the stable destination identity. PortalTravel routes by sceneName and has no separate portal ID.
 * These are destination availability flags, never permission to issue a run or bypass its host gates.
 * A non-town zone is open only when its tier is configured (HOLOZONE_ZONE_TIERS) AND the account's host-owned
 * storyFlags.holoZonesArcBuilt is true (critic review 2026-10-17 top #1; DECISIONS #59 am. 1: the HoloZones portal
 * stays shut until the arc is built). A closed row carries sceneName null (not travelable). Malformed or
 * inconsistent story flags fail closed here (every non-town zone closed); the snapshot still answers.
 */
export function desktopDashboardFields(profile: Record<string, unknown>) {
  // host-crawl-fixes-1: never throws; a non-exact (malformed / inconsistent) record shows every zone closed, matching
  // the HoloZone gates, which read the flags strictly and refuse it.
  const story = readStoryFlagsTolerant(profile.storyFlags);
  const holoZonesArcBuilt = story.exact && story.flags.holoZonesArcBuilt;
  const open = (id: string) => holoZonesArcBuilt && Object.prototype.hasOwnProperty.call(HOLOZONE_ZONE_TIERS, id);
  return {
    username: typeof profile.username === 'string' && profile.username.trim().length > 0 ? profile.username : null,
    // Wardrobe recipes are not portrait/colourway IDs. No authoritative catalog currently supplies these.
    pilotPortraitId: null,
    pilotColourwayId: null,
    syncPoints: typeof profile.syncPoints === 'number' && Number.isSafeInteger(profile.syncPoints) && profile.syncPoints >= 0 ? profile.syncPoints : null,
    zones: [
      { zoneId: 'holocity', displayName: 'HoloCity', statusLabel: 'OPEN', isOpen: true, cardImageId: 'holocity', sceneName: 'HoloCity_Main' },
      { zoneId: 'neonforest', displayName: 'Neon Forest', statusLabel: open('neonforest') ? 'OPEN' : 'NOT YET AVAILABLE', isOpen: open('neonforest'), cardImageId: 'neonforest', sceneName: open('neonforest') ? 'HoloZone_NeonForest' : null },
      { zoneId: 'tide_hollow', displayName: 'Tide Hollow', statusLabel: 'NOT YET AVAILABLE', isOpen: false, cardImageId: 'tide_hollow', sceneName: null },
      { zoneId: 'sky_reach', displayName: 'Sky Reach', statusLabel: 'NOT YET AVAILABLE', isOpen: false, cardImageId: 'sky_reach', sceneName: null },
    ],
  };
}
