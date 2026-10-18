import { CITY_BOT_IDS, record } from "./cityHub";
import type { ArenaFighter, BattleAction } from "@/lite/types/arena";
import type { DuelRound } from "./bots/duelPlayback";

export type CityCombatant = {
  holobotId: string; level: number; maxHealth: number; currentHealth: number; attack: number; defense: number; speed: number; intelligence: number;
  commandRules: { version: 1; maxStamina: number; staminaRegen: number };
};
export type CityRivalIssue = {
  battleId: string; expiresAtMs: number; player: CityCombatant; opponent: CityCombatant; raw: unknown;
};
export function readCityRivalSettlement(reply: unknown, battleId: string) {
  const data = record(reply), status = record(data?.status);
  if (data?.schemaVersion !== "rival-battle-3" || data.battleId !== battleId || typeof data.didWin !== "boolean" || typeof data.alreadyProcessed !== "boolean" ||
      !status || typeof status.tierLabel !== "string" || !["tier", "rivalWins", "winsToNextTier"].every((key) => typeof status[key] === "number" && Number.isSafeInteger(status[key]) && Number(status[key]) >= 0)) throw new Error("The host settlement could not be verified. Retry the same battle.");
  return { ...data, holosGranted: data.holosGranted, duelReceipt: data.duelReceipt, alreadyProcessed: data.alreadyProcessed, didWin: data.didWin, battleId: data.battleId, status: { tier: Number(status.tier), tierLabel: status.tierLabel, rivalWins: Number(status.rivalWins), winsToNextTier: Number(status.winsToNextTier) } };
}
function combatant(value: unknown): CityCombatant {
  const row = record(value), rules = record(row?.commandRules);
  if (!row || typeof row.holobotId !== "string" || !(CITY_BOT_IDS as readonly string[]).includes(row.holobotId) ||
      !["level", "maxHealth", "attack", "defense", "speed", "intelligence"].every((k) => typeof row[k] === "number" && Number.isFinite(row[k]) && Number(row[k]) > 0) ||
      rules?.version !== 1 || rules.maxStamina !== 7 || rules.staminaRegen !== 0.5 ||
      (row.currentHealth !== undefined && (typeof row.currentHealth !== "number" || !Number.isFinite(row.currentHealth) || row.currentHealth <= 0 || row.currentHealth > Number(row.maxHealth)))) throw new Error("This rival uses a combat version or health state the mobile app cannot play yet.");
  return {
    holobotId: row.holobotId, level: Number(row.level), maxHealth: Number(row.maxHealth), currentHealth: Number(row.currentHealth ?? row.maxHealth), attack: Number(row.attack), defense: Number(row.defense), speed: Number(row.speed), intelligence: Number(row.intelligence),
    commandRules: { version: 1, maxStamina: 7, staminaRegen: 0.5 },
  };
}
/** #80 issues one citizen bot. Use the first host-issued travel-squad bot as the entrant. */
export function readCityRivalIssue(raw: unknown, citizenId: string, expectedBotId: string, now = Date.now()): CityRivalIssue {
  const reply = record(raw), encounter = record(reply?.encounter), pilot = record(encounter?.opponentPilot);
  if (reply?.schemaVersion !== "rival-battle-3" || typeof reply.battleId !== "string" || !/^rb_[a-f0-9]{24}$/.test(reply.battleId) ||
      typeof reply.expiresAtMs !== "number" || !Number.isFinite(reply.expiresAtMs) || reply.expiresAtMs <= now ||
      encounter?.encounterId !== reply.battleId || pilot?.pilotId !== citizenId || !Array.isArray(encounter?.opponentSquad) || encounter.opponentSquad.length !== 1 ||
      !Array.isArray(reply.playerCombatants) || reply.playerCombatants.length === 0) throw new Error("The rival host did not return a playable squad. Check your travel squad and try again.");
  const player = combatant(reply.playerCombatants[0]), opponent = combatant(encounter.opponentSquad[0]);
  if (opponent.holobotId !== expectedBotId) throw new Error("The rival’s Holobot changed. Refresh the gathering first.");
  return { battleId: reply.battleId, expiresAtMs: reply.expiresAtMs, player, opponent, raw };
}

/** Copy combat stats from admission; never recalculate them from the displayed profile. */
export function cityCombatantFighter(bot: CityCombatant, side: "player" | "rival", uid: string): ArenaFighter {
  return {
    holobotId: `${side}-${bot.holobotId}`, ownerUserId: side === "player" ? uid : "city-rival", name: bot.holobotId.toUpperCase(), avatar: "",
    maxHP: bot.maxHealth, currentHP: bot.currentHealth, attack: bot.attack, defense: bot.defense, speed: bot.speed, intelligence: bot.intelligence,
    stamina: bot.commandRules.maxStamina, maxStamina: bot.commandRules.maxStamina, specialMeter: 0, staminaState: "fresh", isInDefenseMode: false,
    comboCounter: 0, lastActionTime: 0, staminaEfficiency: 1, defenseTimingWindow: 500, counterDamageBonus: 1.25,
    archetype: "balanced", level: bot.level, statusEffects: [],
  };
}
/** Defense setup is omitted; only observed attack resolutions become playback cues. */
export function cityBattleRounds(actions: readonly BattleAction[]): DuelRound[] {
  return actions.filter((action) => action.card.type !== "defense").map((action) => ({
    attacker: action.actorRole === "player" || (action.actorRole === undefined && action.actorId.startsWith("player-")) ? "player" : "rival",
    evaded: action.outcome === "dodged" || action.outcome === "missed" || action.outcome === "perfect_defense",
    damage: Math.max(0, action.actualDamage ?? action.damageDealt), label: action.card.name,
  }));
}
