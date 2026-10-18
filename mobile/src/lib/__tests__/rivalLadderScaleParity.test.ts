import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { getHolobotBattleStats } from "@/lib/progression";
import * as client from "@/lib/rivalTierStats";

import * as serverLadder from "../../../test-fixtures/host-pin/src/lib/rivalLadder";
import * as serverProgression from "../../../test-fixtures/host-pin/src/lib/progression";
import * as server from "../../../test-fixtures/host-pin/src/lib/rivalTierStats";
import { hostSourceFile } from "../../../test-fixtures/hostPin.mjs";

/**
 * DECISIONS #53 amendment 1 (Pak, 2026-10-06): rival tier t fields WOLF's own
 * battle stats at level 1 + 4t. The pure math is a byte-identical pair
 * (mobile/src/lib/rivalTierStats.ts ⇄ functions/src/lib/rivalTierStats.ts),
 * each side reading its own parity-tested getHolobotBattleStats. The rival
 * host serves it to rival-battle-3 only.
 */

const TIERS = Array.from({ length: 41 }, (_, tier) => tier);

describe("rival ladder rescale parity", () => {
  it("the pair is byte-identical, except the deployed host's known host-only addition", () => {
    const mobileCopy = readFileSync(path.join(__dirname, "..", "rivalTierStats.ts"), "utf8");
    const hostCopy = readFileSync(hostSourceFile("lib/rivalTierStats.ts"), "utf8");
    // KNOWN DRIFT (lite-test-parity-1): the deployed host appends RIVAL_NAMED_PROFILES (main 9e2f4eb, the
    // JUSAN story rival); this branch's client copy predates it. Everything else must stay byte-identical.
    // Syncing mobile/src/lib/rivalTierStats.ts from main is product work; once it lands, the suffix is
    // empty, this test fails, and the known-drift branch must be deleted.
    expect(hostCopy.startsWith(mobileCopy), "the shared part of rivalTierStats.ts differs from the deployed host").toBe(true);
    const hostOnly = ts.createSourceFile("suffix.ts", hostCopy.slice(mobileCopy.length), ts.ScriptTarget.Latest).statements;
    const declared = hostOnly.flatMap((statement) =>
      ts.isVariableStatement(statement) ? statement.declarationList.declarations.map((d) => (ts.isIdentifier(d.name) ? d.name.text : "<pattern>")) : ["<other>"],
    );
    expect(declared, "the deployed host's rivalTierStats.ts suffix beyond the client copy").toEqual(["RIVAL_NAMED_PROFILES"]);
    console.warn("[rivalLadderScaleParity] KNOWN DRIFT: the client rivalTierStats.ts lacks the deployed host's RIVAL_NAMED_PROFILES (main 9e2f4eb).");
  });

  it("client and server agree for tiers 0-40 and equal WOLF's getHolobotBattleStats at level 1 + 4t", () => {
    for (const tier of TIERS) {
      const level = Math.min(99, 1 + 4 * tier);
      const wolf = getHolobotBattleStats("WOLF", level, {});
      const serverWolf = serverProgression.getHolobotBattleStats("WOLF", level, {});
      const expected = {
        level,
        maxHealth: wolf.maxHP,
        attack: wolf.attack,
        defense: wolf.defense,
        speed: wolf.speed,
        intelligence: wolf.intelligence,
      };
      expect(client.rivalTierBattleStats(tier)).toEqual(expected);
      expect(server.rivalTierBattleStats(tier)).toEqual(expected);
      expect(serverWolf.maxHP).toBe(wolf.maxHP);
    }
  });

  it("tier 0 is a fresh L1 WOLF, tier 9 is L37, capped at L99", () => {
    expect(client.rivalTierBattleStats(0)).toEqual({
      attack: 50,
      defense: 50,
      intelligence: 40,
      level: 1,
      maxHealth: 175,
      speed: 50,
    });
    expect(client.rivalTierBattleStats(9).level).toBe(37);
    expect(client.rivalTierBattleStats(25).level).toBe(99);
    expect(client.rivalTierBattleStats(500).level).toBe(99);
  });

  it("invalid tiers throw on both sides", () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => client.rivalTierBattleStats(bad)).toThrow(RangeError);
      expect(() => server.rivalTierBattleStats(bad)).toThrow(RangeError);
    }
  });

  it("the rival host's rival-battle-3 opponents are exactly these stats; v2 keeps the #43 baseline", () => {
    for (const wins of [0, 9, 10, 35, 90, 250]) {
      const tier = serverLadder.tierForWins(wins);
      let n = 11;
      const random = () => (n = (n * 9301 + 49297) % 233280) / 233280;
      const v3 = serverLadder.issueRivalBattle({ rivalWins: wins }, 0, "rb_parity", random, [], "wolf-level-1-plus-4t");
      for (const combatant of v3.reply.encounter.opponentSquad) {
        expect({
          attack: combatant.attack,
          defense: combatant.defense,
          intelligence: combatant.intelligence,
          level: combatant.level,
          maxHealth: combatant.maxHealth,
          speed: combatant.speed,
        }).toEqual(client.rivalTierBattleStats(tier));
      }
      const row = serverLadder.getRivalTierRow(tier);
      const v2 = serverLadder.rivalReplyForVersion(
        serverLadder.issueRivalBattle({ rivalWins: wins }, 0, "rb_parity", random, [], "baseline-statscale").reply,
        "rival-battle-2",
      ) as { encounter: { opponentSquad: Array<Record<string, unknown>> } };
      for (const combatant of v2.encounter.opponentSquad) {
        expect(combatant.maxHealth).toBe(Math.round(285 * row.statScale));
        expect("speed" in combatant).toBe(false);
      }
    }
  });
});
