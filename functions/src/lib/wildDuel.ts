/**
 * buddy-capture-1 (owner ruling 2026-11-11, MOVE_LAB_AND_CAPTURE_PLAN.md B2): a wild Holobot joins the player through a LIVE DUEL
 * fought with a Buddy Unit in hand, instead of the plain "Link". The numbers and the roll live here; city/wildDuelHost.ts is the
 * callable and its Firestore state.
 *
 * - Chance on a VERIFIED live win: Light 25 %, Medium 45 %, Heavy 100 %.
 * - Every verified win that does not capture adds WILD_DUEL_PITY_STEP (20 points) for THAT wild Holobot (per player, per holobotId;
 *   any spot of that species counts). The WILD_DUEL_GUARANTEE_WIN-th win (the 4th) always captures, whatever the tier.
 * - The roll is HMAC(session secret, holobotId | battleId) (lib/buddyUnits.captureRoll01): the secret is the server-only
 *   wildEncounterSessions/{uid}.rollSeed and the battle id is minted by the host at issue, so the client chooses neither.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { BuddyTierKey, captureRoll01 } from './buddyUnits';

export const WILD_DUEL_SCHEMA = 'wild-duel-1';
/** Chance a verified win captures, by the Buddy Unit tier the fight was started with (no failed wins yet). */
export const WILD_DUEL_BASE_CHANCE: Readonly<Record<BuddyTierKey, number>> = Object.freeze({ light: 0.25, medium: 0.45, heavy: 1 });
/** Added per verified win that did not capture (for that wild Holobot). */
export const WILD_DUEL_PITY_STEP = 0.2;
/** This win always captures (3 failed wins before it). */
export const WILD_DUEL_GUARANTEE_WIN = 4;
/** The CPU rank tier fed to buildFightReplayIssue (fightRankForTier(2) = Starter, the plan's pick). */
export const WILD_DUEL_RANK_TIER = 2;
/** An open wild duel lives this long; past it, it closes as a loss (the Unit stays spent). */
export const WILD_DUEL_TTL_MS = 30 * 60 * 1000;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const failed = (n: unknown) => (typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0);

/** The chance a verified win captures, for this tier after `failedWins` earlier verified wins that did not. */
export function wildDuelChance01(tier: BuddyTierKey, failedWins: number): number {
  const f = failed(failedWins);
  if (f >= WILD_DUEL_GUARANTEE_WIN - 1) return 1;
  return round6(Math.min(1, Math.max(0, WILD_DUEL_BASE_CHANCE[tier] + WILD_DUEL_PITY_STEP * f)));
}

/** All three tiers' chances for the quote (what the phone shows before the fight). */
export function wildDuelChances(failedWins: number): Record<BuddyTierKey, number> {
  return { light: wildDuelChance01('light', failedWins), medium: wildDuelChance01('medium', failedWins), heavy: wildDuelChance01('heavy', failedWins) };
}

/** The deterministic roll in [0, 1) for a settled wild duel (captured iff roll < chance, so 100 % always captures). */
export function wildDuelRoll01(seed: string, holobotId: string, battleId: string): number {
  return captureRoll01(seed, `wild-duel|${holobotId}`, battleId);
}

/** The wild Holobot's level: the player's fielded Holobot's level (at least 1, at most 99). */
export function wildDuelLevel(playerLevel: unknown): number {
  const lv = typeof playerLevel === 'number' && Number.isSafeInteger(playerLevel) ? playerLevel : 1;
  return Math.max(1, Math.min(99, lv));
}

export type WildDuelProgressRow = { failedWins: number; lastBattleId: string; updatedAtMs: number };
/** users' per-wild-Holobot failed-win counters (server-only wildDuels/{uid}.progress). Malformed rows read as 0. */
export function readFailedWins(progress: unknown, holobotId: string): number {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return 0;
  const row = (progress as Record<string, unknown>)[holobotId];
  return row && typeof row === 'object' ? Math.min(WILD_DUEL_GUARANTEE_WIN - 1, failed((row as Record<string, unknown>).failedWins)) : 0;
}

/** The outcome of a verified win: joined or not, and the counter after it. */
export function wildDuelWinOutcome(tier: BuddyTierKey, failedWinsBefore: number, roll: number): { chance01: number; joined: boolean; failedWinsAfter: number; nextChance01: number } {
  const chance01 = wildDuelChance01(tier, failedWinsBefore);
  const joined = roll < chance01;
  const failedWinsAfter = joined ? 0 : Math.min(WILD_DUEL_GUARANTEE_WIN - 1, failed(failedWinsBefore) + 1);
  return { chance01, joined, failedWinsAfter, nextChance01: wildDuelChance01(tier, failedWinsAfter) };
}
