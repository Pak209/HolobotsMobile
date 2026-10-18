import { HOLOZONE_ZONE_TIERS } from '../lib/holoZoneRuns';

/** Dashboard catalog mirrored from Unity db265127c dashboard-preview.json; not its fabricated pilot data.
 * zoneId is the stable destination identity. PortalTravel routes by sceneName and has no separate portal ID.
 * These are destination availability flags, never permission to issue a run or bypass its host gates.
 */
export function desktopDashboardFields(profile: Record<string, unknown>) {
  const available = (id: string) => Object.prototype.hasOwnProperty.call(HOLOZONE_ZONE_TIERS, id);
  return {
    username: typeof profile.username === 'string' && profile.username.trim().length > 0 ? profile.username : null,
    // Wardrobe recipes are not portrait/colourway IDs. No authoritative catalog currently supplies these.
    pilotPortraitId: null,
    pilotColourwayId: null,
    syncPoints: typeof profile.syncPoints === 'number' && Number.isSafeInteger(profile.syncPoints) && profile.syncPoints >= 0 ? profile.syncPoints : null,
    zones: [
      { zoneId: 'holocity', displayName: 'HoloCity', statusLabel: 'OPEN', isOpen: true, cardImageId: 'holocity', sceneName: 'HoloCity_Main' },
      { zoneId: 'neonforest', displayName: 'Neon Forest', statusLabel: available('neonforest') ? 'OPEN' : 'NOT YET AVAILABLE', isOpen: available('neonforest'), cardImageId: 'neonforest', sceneName: available('neonforest') ? 'HoloZone_NeonForest' : null },
      { zoneId: 'tide_hollow', displayName: 'Tide Hollow', statusLabel: 'NOT YET AVAILABLE', isOpen: false, cardImageId: 'tide_hollow', sceneName: null },
      { zoneId: 'sky_reach', displayName: 'Sky Reach', statusLabel: 'NOT YET AVAILABLE', isOpen: false, cardImageId: 'sky_reach', sceneName: null },
    ],
  };
}
