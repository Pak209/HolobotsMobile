/**
 * desktopAccountSnapshot reply builder (pure: no firebase imports, safe to import from tests —
 * functions/scripts/test-desktop-account.mjs, mobile/src/lib/__tests__/desktopAccountParity.test.ts).
 *
 * desktop-account-1 / -2: exactly the deployed shapes (holobots verbatim).
 * desktop-account-3 (DECISIONS #53 amendment 1 + 2): every holobot is normalised with the mobile defaults
 * (normalizeUserHolobot: level, experience, nextLevelExp, attributePoints, rank; boostedAttributes {}) and
 * carries
 *   battleStats   {attack, defense, maxHP, speed, intelligence} = getPlayerBattleStats — the combat scale:
 *                 getHolobotBattleStats + the sync modifiers, as arenaConfig.buildPlayerFighter and the
 *                 rival-battle-3 playerCombatants; equipped parts NOT included;
 *   displayStats  {attack, defense, hp, speed, special} = getHolobotDisplayStats — the mobile display scale
 *                 (TrainingScreen): floor(base x levelBonus) + boost, no x10, no sync, no parts.
 * buddyUnits is the {light, medium, heavy} map from v2 on.
 */
import { readTravelSquad } from '../acquisition/captureOwnership';
import { BuddyInventory, totalBuddyUnits } from '../lib/buddyUnits';
import { BLUEPRINT_TIERS } from '../lib/mintingEconomy';
import { getHolobotDisplayStats, HolobotDisplayStats, normalizeUserHolobot } from '../lib/progression';
import { getPlayerBattleStats } from '../lib/progressionEconomy';

/** Deployed 2026-09-30: buddyUnits is an int. Still served to clients that don't ask for a later version. */
export const DESKTOP_ACCOUNT_V1 = 'desktop-account-1';
/** DECISIONS #44: buddyUnits is {light, medium, heavy}. */
export const DESKTOP_ACCOUNT_V2 = 'desktop-account-2';
/** DECISIONS #53 amendment 1 + 2: normalised holobots with battleStats + displayStats (v2 otherwise). */
export const DESKTOP_ACCOUNT_V3 = 'desktop-account-3';
export type DesktopAccountVersion = typeof DESKTOP_ACCOUNT_V1 | typeof DESKTOP_ACCOUNT_V2 | typeof DESKTOP_ACCOUNT_V3;

/** Request `{schemaVersion?}`: missing / v1 → v1; v2; v3; anything else → null (the callable answers invalid-argument). */
export function desktopAccountVersionOf(data: unknown): DesktopAccountVersion | null {
  const requested = data && typeof data === 'object' ? (data as Record<string, unknown>).schemaVersion : undefined;
  if (requested === undefined || requested === DESKTOP_ACCOUNT_V1) return DESKTOP_ACCOUNT_V1;
  if (requested === DESKTOP_ACCOUNT_V2) return DESKTOP_ACCOUNT_V2;
  if (requested === DESKTOP_ACCOUNT_V3) return DESKTOP_ACCOUNT_V3;
  return null;
}

export type HolobotBattleStatsView = { attack: number; defense: number; maxHP: number; speed: number; intelligence: number };

/**
 * One desktop-account-3 holobot: the stored record (every extra key kept) with the mobile defaults filled in,
 * plus battleStats and displayStats.
 */
export function desktopHolobotV3(raw: Record<string, unknown>): Record<string, unknown> & { battleStats: HolobotBattleStatsView; displayStats: HolobotDisplayStats } {
  const holobot = normalizeUserHolobot(raw);
  const boostedAttributes = holobot.boostedAttributes && typeof holobot.boostedAttributes === 'object' && !Array.isArray(holobot.boostedAttributes) ? holobot.boostedAttributes : {};
  const battle = getPlayerBattleStats({ ...holobot, boostedAttributes });
  return {
    ...holobot,
    boostedAttributes,
    battleStats: { attack: battle.attack, defense: battle.defense, maxHP: battle.maxHP, speed: battle.speed, intelligence: battle.intelligence },
    displayStats: getHolobotDisplayStats(holobot.name, holobot.level || 1, boostedAttributes),
  };
}

/**
 * The reply for `version`. `units` is the read Buddy Unit inventory (readBuddyInventory; the callable persists
 * its starter / migration updates). v1 / v2 are the deployed shapes byte for byte (key order included).
 * v3 maps only object entries with a string name (anything else cannot be shown or battled).
 */
export function buildDesktopAccountReply(profile: Record<string, unknown>, uid: string, version: DesktopAccountVersion, units: BuddyInventory): Record<string, unknown> {
  const stored: unknown[] = Array.isArray(profile.holobots) ? profile.holobots : [];
  const holobots = version === DESKTOP_ACCOUNT_V3
    ? stored.filter((h): h is Record<string, unknown> => !!h && typeof h === 'object' && !Array.isArray(h) && typeof (h as { name?: unknown }).name === 'string').map(desktopHolobotV3)
    : stored;
  return {
    schemaVersion: version,
    uid,
    holobots,
    blueprints: profile.blueprints ?? {},
    travelSquad: readTravelSquad(profile),
    blueprintTiers: BLUEPRINT_TIERS,
    buddyUnits: version === DESKTOP_ACCOUNT_V1 ? totalBuddyUnits(units) : units,
  };
}
