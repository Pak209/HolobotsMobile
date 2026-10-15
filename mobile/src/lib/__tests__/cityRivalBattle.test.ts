import { describe, expect, it } from "vitest";
import { cityBattleRounds, cityCombatantFighter, readCityRivalIssue } from "../cityRivalBattle";
import { ArenaCombatEngine } from "../../features/arena/combatEngine";
import { resolveCombatKit } from "../../features/arena/moveKits";
const citizen = "CV1_HB_CITIZEN1_LineCyan_06";
const bot = { holobotId: "ace", level: 2, maxHealth: 180, attack: 38, defense: 20, speed: 19, intelligence: 17, commandRules: { version: 1, maxStamina: 7, staminaRegen: 0.5 } };
const reply = { schemaVersion: "rival-battle-3", battleId: "rb_0123456789abcdef01234567", expiresAtMs: 99_000, playerCombatants: [bot], encounter: { encounterId: "rb_0123456789abcdef01234567", seed: 1, opponentPilot: { pilotId: citizen }, opponentSquad: [bot] } };

describe("host admission to mobile rival combat", () => {
  it("copies host stats and disambiguates mirror bot identities", () => {
    const issue = readCityRivalIssue(reply, citizen, "ace", 1);
    const player = cityCombatantFighter(issue.player, "player", "uid");
    const rival = cityCombatantFighter(issue.opponent, "rival", "uid");
    expect(player.attack).toBe(38); expect(player.maxHP).toBe(180);
    expect(player.holobotId).not.toBe(rival.holobotId);
    const battle = ArenaCombatEngine.initializeBattle(player, rival);
    const strike = resolveCombatKit({ idPrefix: "test" }).slots[0];
    const next = ArenaCombatEngine.resolveAction(battle, strike, rival.holobotId);
    expect(next.player.currentHP).toBeLessThan(player.maxHP);
    expect(next.opponent.currentHP).toBe(rival.maxHP);
    const rounds = cityBattleRounds(next.actionHistory);
    expect(rounds[0].attacker).toBe("rival");
    expect(rounds[0].damage).toBe(player.maxHP - next.player.currentHP);
  });
  it("rejects a different rival, bot, expired issue or future combat profile", () => {
    expect(() => readCityRivalIssue(reply, "wrong", "ace", 1)).toThrow();
    expect(() => readCityRivalIssue(reply, citizen, "hare", 1)).toThrow();
    expect(() => readCityRivalIssue(reply, citizen, "ace", 100_000)).toThrow();
    expect(() => readCityRivalIssue({ ...reply, playerCombatants: [] }, citizen, "ace", 1)).toThrow();
    expect(() => readCityRivalIssue({ ...reply, playerCombatants: [{ ...bot, attack: NaN }] }, citizen, "ace", 1)).toThrow();
    expect(() => readCityRivalIssue({ ...reply, playerCombatants: [{ ...bot, commandRules: { ...bot.commandRules, version: 2 } }] }, citizen, "ace", 1)).toThrow();
  });
  it("does not invent rounds when the host has no trace", () => { expect(cityBattleRounds([])).toEqual([]); });
});
