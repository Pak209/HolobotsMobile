/**
 * DECISIONS #53-1 (Pak, 2026-10-06): Holobot XP for a settled battle. The one
 * battle table (battleSettlement.ts) applied through applyHolobotExperience to
 * every FIELDED Holobot (bench: none), EXP Booster honoured. Server-only: the
 * rival settle uses it today and a HoloZone/beast claim will (kind "beast");
 * the arena keeps its own write path (arenaEconomy.ts, same table).
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { applyExpBooster, computeBattleSettlement, getBattleBaseRewards, type BattleSettlementInput } from "./battleSettlement";
import { toHolobotKey } from "./mintingEconomy";
import { applyHolobotExperience, getHolobotRank, normalizeUserHolobot } from "./progression";

/** One row per fielded Holobot in a settle reply (`progression[]`). Values are AFTER the award. */
export type HolobotProgressionEntry = {
  holobotId: string;
  expGained: number;
  levelBefore: number;
  levelAfter: number;
  attributePoints: number;
  experience: number;
  nextLevelExp: number;
  rank: string;
};

/** Opt-in value of `progressionSchema` where a strict Unity reader rejects unknown keys (tournament bracket / result replies). */
export const BATTLE_PROGRESSION_SCHEMA = "battle-progression-1";

export type BattleExperienceAward = {
  /** EXP each fielded Holobot received (0 when withheld). */
  expPerHolobot: number;
  /** The profile's holobots array with the awards applied (unchanged entries are the stored objects). */
  holobots: unknown[];
  progression: HolobotProgressionEntry[];
  /** The table EXP after the live-win cap, before the first-win and EXP Booster multipliers. */
  tableExp: number;
};

const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

/** The one `progression[]` row shape (rival settle, zone settle, arena settle, tournament results). */
export function holobotProgressionRow(
  holobotId: string,
  expGained: number,
  before: { level: unknown },
  after: { level: unknown; attributePoints?: unknown; experience?: unknown; nextLevelExp?: unknown; rank?: unknown },
): HolobotProgressionEntry {
  return {
    holobotId,
    expGained,
    levelBefore: whole(before.level),
    levelAfter: whole(after.level),
    attributePoints: whole(after.attributePoints),
    experience: whole(after.experience),
    nextLevelExp: whole(after.nextLevelExp),
    rank: typeof after.rank === "string" && after.rank ? after.rank : getHolobotRank(Number(after.level)),
  };
}

/**
 * `holobotIds` are lowercase stable ids (travel-squad ids), distinct. Each must
 * name a Holobot on the profile (toHolobotKey(name) === id), else null so the
 * caller fails closed. `withheld` reports every row with expGained 0 and
 * leaves the holobots untouched (the settle still happens).
 */
export function awardBattleExperienceRaw(
  userData: Record<string, unknown>,
  holobotIds: readonly string[],
  input: BattleSettlementInput,
  nowMs: number,
  options: { withheld?: boolean; bonusCap?: number; expMultiplier?: number } = {},
): BattleExperienceAward | null {
  const settlement = computeBattleSettlement(input);
  if (!settlement) return null;

  // early-progression-1 (lib/liveWinRewards.ts): a live win's multiplier is capped (bonusCap), then the first win of the day
  // multiplies (expMultiplier), then the EXP Booster. A loss is the table's 0.3 rule, untouched by the cap.
  const tableExp = input.didWin && options.bonusCap !== undefined
    ? Math.floor(getBattleBaseRewards(settlement.tier).exp * Math.min(settlement.performanceBonus, options.bonusCap))
    : settlement.exp;
  const holobots: unknown[] = Array.isArray(userData.holobots) ? [...userData.holobots] : [];
  const exp = options.withheld ? 0 : applyExpBooster(tableExp * Math.max(1, Math.floor(options.expMultiplier ?? 1)), userData.expBoosterActiveUntil, nowMs);
  const progression: HolobotProgressionEntry[] = [];

  for (const holobotId of holobotIds) {
    const index = holobots.findIndex((holobot) => {
      const name = holobot && typeof holobot === "object" ? (holobot as { name?: unknown }).name : undefined;
      return typeof name === "string" && toHolobotKey(name) === holobotId;
    });
    if (index < 0) return null;

    const before = normalizeUserHolobot(holobots[index]);
    const after = exp > 0 ? applyHolobotExperience(holobots[index], exp) : before;
    if (exp > 0) holobots[index] = after;

    progression.push(holobotProgressionRow(holobotId, exp, before, after));
  }

  return { expPerHolobot: exp, holobots, progression, tableExp };
}
