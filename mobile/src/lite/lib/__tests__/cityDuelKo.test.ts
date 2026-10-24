import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CITY_KO_HOLD_MS, cityBattleRounds, cityCombatantFighter, cityDuelPhase, cityObservedActions, readCityRivalIssue, type CityObservedAction } from "../cityRivalBattle";
import { buildPlaybackCues, normalizeDuelReceipt, ROUND_DURATION_MS } from "../bots/duelPlayback";
import { ArenaCombatEngine } from "../../features/arena/combatEngine";
import { resolveCombatKit } from "../../../features/arena/moveKits";
import type { BattleState } from "../../types/arena";

/** lite-ko-continue-bug-1 (Pak, sim): "after the HP ran out the Battle still continued". The offline City duel ended at
 * its KO, then auto-played a 28-round client-trace replay from ROUND 01 with empty HP bars (no observed state), which
 * read as the fight continuing. The fight must stop at the KO round, hold the 2 s KO beat, and open on the result. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), "utf8");
const citizen = "CV1_HB_CITIZEN1_LineCyan_06";
const bot = { holobotId: "ace", level: 2, maxHealth: 150, attack: 38, defense: 22, speed: 20, intelligence: 18, commandRules: { version: 1, maxStamina: 7, staminaRegen: 0.5 } };
const reply = { schemaVersion: "rival-battle-3", battleId: "rb_0123456789abcdef01234567", expiresAtMs: 99_000, playerCombatants: [bot], encounter: { encounterId: "rb_0123456789abcdef01234567", seed: 1, opponentPilot: { pilotId: citizen }, opponentSquad: [{ ...bot, holobotId: "tsuin", attack: 31, defense: 18 }] } };
const moves = [...resolveCombatKit({ idPrefix: "city" }).slots];

/** Mirrors CityRivalBattle's commit(): every committed state records what it observed around new actions. */
function fightToKo() {
  // The engine gates actions on wall-clock cooldowns; step a fake clock like the component's 180 ms loop.
  vi.useFakeTimers(); vi.setSystemTime(1_000_000);
  const issue = readCityRivalIssue(reply, citizen, "tsuin", 1);
  let battle: BattleState = ArenaCombatEngine.initializeBattle(cityCombatantFighter(issue.player, "player", "uid"), cityCombatantFighter(issue.opponent, "rival", "uid"), { battleType: "pve", allowPlayerControl: true, potentialRewards: { exp: 0, syncPoints: 0 } });
  let observed: CityObservedAction[] = [];
  const commit = (next: BattleState) => { observed = [...observed, ...cityObservedActions(battle, next)]; battle = next; };
  for (let tick = 0; tick < 2000 && battle.status === "active"; tick++) {
    vi.setSystemTime(1_000_000 + tick * 1000);
    commit(ArenaCombatEngine.regenerateStamina(battle));
    const command = ArenaCombatEngine.selectAICommand(battle, moves);
    if (!command) continue;
    commit(command.kind === "signature" ? ArenaCombatEngine.resolveSignatureFinisher(battle, battle.opponent.holobotId) : ArenaCombatEngine.resolveAction(battle, command.card, battle.opponent.holobotId));
  }
  return { battle, observed };
}

describe("lite-ko-continue-bug-1 · the City duel stops at the KO round", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("the client trace ends on the KO action and carries the engine's observed HP (bars are not empty)", () => {
    const { battle, observed } = fightToKo();
    expect(battle.status).toBe("completed");
    expect(Math.min(battle.player.currentHP, battle.opponent.currentHP)).toBeLessThanOrEqual(0);
    const rounds = cityBattleRounds(battle.actionHistory, observed);
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.every((round) => round.before && round.after)).toBe(true);
    const ko = rounds.at(-1)!.after!;
    expect(Math.min(ko.player.hp, ko.rival.hp)).toBe(0);
    // No round after the KO: every earlier round still had both fighters standing.
    expect(rounds.slice(0, -1).every((round) => round.after!.player.hp > 0 && round.after!.rival.hp > 0)).toBe(true);
    const receipt = normalizeDuelReceipt({ issue: reply, settlement: { battleId: "offline-city-duel", didWin: false } }, rounds);
    expect(receipt.traceSource).toBe("client");
    expect(receipt.roundCount).toBe(rounds.length);
    expect(receipt.rounds.every((round) => round.before && round.after)).toBe(true);
    const lastState = buildPlaybackCues(receipt.rounds).filter((cue) => cue.kind === "state").at(-1)!;
    expect(lastState.atMs).toBeLessThan(receipt.rounds.length * ROUND_DURATION_MS);
    expect(Math.min(lastState.snapshot!.player.hp!, lastState.snapshot!.rival.hp!)).toBe(0);
  });

  it("holds the 2 s KO beat, then the result; never back to fighting", () => {
    expect(CITY_KO_HOLD_MS).toBe(2000);
    expect(cityDuelPhase("active", null, 0)).toBe("fight");
    expect(cityDuelPhase("completed", null, 0)).toBe("ko");
    expect(cityDuelPhase("completed", 10_000, 10_000 + CITY_KO_HOLD_MS - 1)).toBe("ko");
    expect(cityDuelPhase("completed", 10_000, 10_000 + CITY_KO_HOLD_MS)).toBe("result");
  });

  it("the preview settles after the KO beat and the playback opens on the result card, not ROUND 01", () => {
    const battle = read("../../components/city/CityRivalBattle.tsx");
    expect(battle).toContain('if (preview ? phase === "result" :');
    expect(battle).toContain('(preview && battle?.status === "completed" && !receipt)) return <CityLiveBattleView');
    expect(battle).toContain("startAtResult={preview}");
    expect(battle).toContain("cityBattleRounds(battle?.actionHistory ?? [], observedActions.current)");
    const playback = read("../../screens/EnabledDuelPlaybackScreen.tsx");
    expect(playback).toContain("useState(() => startAtResult ? duration : 0)");
    expect(playback).toContain("const atResult = startAtResult && replay === 0;");
  });
});
