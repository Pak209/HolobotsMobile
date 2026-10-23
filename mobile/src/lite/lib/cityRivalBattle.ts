import { CITY_BOT_IDS, record } from "./cityHub";
import type { ArenaFighter, BattleAction, BattleState } from "@/lite/types/arena";
import type { DuelRound, DuelState } from "./bots/duelPlayback";

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
      !status || typeof status.tierLabel !== "string" || !["tier", "rivalWins", "winsToNextTier"].every((key) => typeof status[key] === "number" && Number.isSafeInteger(status[key]) && Number(status[key]) >= 0)) throw new Error("The City's result could not be verified. Retry the same battle." /* PLACEHOLDER copy (Lex, DECISIONS #71) */);
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
      !Array.isArray(reply.playerCombatants) || reply.playerCombatants.length === 0) throw new Error("The City did not return a playable squad. Check your travel squad and try again." /* PLACEHOLDER copy (Lex, DECISIONS #71) */);
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
/** Engine state observed around one action (copied from the committed BattleState, never recalculated). */
export type CityObservedAction = { before: DuelState; after: DuelState };
function observedFighter(fighter: ArenaFighter): DuelState["player"] {
  return { hp: Math.max(0, Math.min(fighter.maxHP, fighter.currentHP)), maxHp: fighter.maxHP, stamina: Math.max(0, Math.min(fighter.maxStamina, fighter.stamina)), maxStamina: fighter.maxStamina };
}
export function cityObservedState(battle: Pick<BattleState, "player" | "opponent">): DuelState {
  return { player: observedFighter(battle.player), rival: observedFighter(battle.opponent) };
}
/** lite-ko-continue-bug-1: one observed before/after pair per action that `next` appended to `previous`'s history. */
export function cityObservedActions(previous: BattleState | null, next: BattleState): CityObservedAction[] {
  const added = next.actionHistory.length - (previous?.actionHistory.length ?? 0);
  if (added <= 0) return [];
  const before = cityObservedState(previous ?? next), after = cityObservedState(next);
  return Array.from({ length: added }, () => ({ before, after }));
}
/** The offline preview's client trace. Rounds end with the KO action: the trace is the engine's own history, and each
 * round carries the engine HP/stamina observed around it so the replay's bars show real values (they read empty before). */
export function cityBattleRounds(actions: readonly BattleAction[], observed: readonly CityObservedAction[] = []): DuelRound[] {
  return actions.flatMap((action, index) => action.card.type === "defense" ? [] : [{
    attacker: action.actorRole === "player" || (action.actorRole === undefined && action.actorId.startsWith("player-")) ? "player" as const : "rival" as const,
    evaded: action.outcome === "dodged" || action.outcome === "missed" || action.outcome === "perfect_defense",
    damage: Math.max(0, action.actualDamage ?? action.damageDealt), label: action.card.name,
    ...(observed[index] ? { before: observed[index].before, after: observed[index].after } : {}),
  }]);
}

/** lite-ko-continue-bug-1: the KO beat before the city duel's result. Same 2 s as the Arena round's KO_RESULT_HOLD_MS
 * (lite-battle-pace #199); presentation only, the completed battle state is not touched. */
export const CITY_KO_HOLD_MS = 2000;
export type CityDuelPhase = "fight" | "ko" | "result";
/** fight while the engine says active; a 2 s KO beat on the live stage once it completes; then the result. The result is
 * never a fresh fight: the playback screen opens on the recorded result card (REPLAY is the player's choice). */
export function cityDuelPhase(status: BattleState["status"] | undefined, completedAtMs: number | null, nowMs: number): CityDuelPhase {
  if (status !== "completed") return "fight";
  if (completedAtMs === null || nowMs - completedAtMs < CITY_KO_HOLD_MS) return "ko";
  return "result";
}
