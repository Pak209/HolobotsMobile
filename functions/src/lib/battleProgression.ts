/**
 * DECISIONS #53-1 (Pak, 2026-10-06): Holobot XP for a settled battle. The one
 * battle table (battleSettlement.ts) applied through applyHolobotExperience to
 * every FIELDED Holobot (bench: none), EXP Booster honoured. Server-only: the
 * rival settle uses it today and a HoloZone/beast claim will (kind "beast");
 * the arena keeps its own write path (arenaEconomy.ts, same table).
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { applyExpBooster, computeBattleSettlement, type BattleSettlementInput } from "./battleSettlement";
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

export type BattleExperienceAward = {
  /** EXP each fielded Holobot received (0 when withheld). */
  expPerHolobot: number;
  /** The profile's holobots array with the awards applied (unchanged entries are the stored objects). */
  holobots: unknown[];
  progression: HolobotProgressionEntry[];
};

const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

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
  options: { withheld?: boolean } = {},
): BattleExperienceAward | null {
  const settlement = computeBattleSettlement(input);
  if (!settlement) return null;

  const holobots: unknown[] = Array.isArray(userData.holobots) ? [...userData.holobots] : [];
  const exp = options.withheld ? 0 : applyExpBooster(settlement.exp, userData.expBoosterActiveUntil, nowMs);
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

    progression.push({
      holobotId,
      expGained: exp,
      levelBefore: whole(before.level),
      levelAfter: whole(after.level),
      attributePoints: whole(after.attributePoints),
      experience: whole(after.experience),
      nextLevelExp: whole(after.nextLevelExp),
      rank: typeof after.rank === "string" && after.rank ? after.rank : getHolobotRank(after.level),
    });
  }

  return { expPerHolobot: exp, holobots, progression };
}
