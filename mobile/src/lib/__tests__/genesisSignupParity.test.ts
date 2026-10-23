import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getGenesisStarterDeckGrants } from "@/lib/battleCards/catalog";
import { calculateExperience, getHolobotRank, normalizeUserHolobot } from "@/lib/progression";

import * as server from "../../../../functions/src/lib/genesisSignup";

/**
 * Mobile and HoloCity desktop sign-up both create the profile through the
 * createGenesisProfile callable (functions/src/lib/genesisSignup.ts) since
 * holobots-write-lockdown-1: firestore.rules no longer lets a client create
 * holobots, currency or cards. AuthContext.signup keeps an optimistic
 * localProfile for the first frame; this test pins that its starter holobot
 * and starter deck are the ones the host writes, and that the mobile source
 * never writes the profile itself.
 */

const srcDir = path.resolve(__dirname, "../..");

function balancedBlock(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const open = source.indexOf("{", at + marker.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced block after ${marker}`);
}

const authSource = readFileSync(path.join(srcDir, "contexts/AuthContext.tsx"), "utf8");
const holobotsSource = readFileSync(path.join(srcDir, "config/holobots.ts"), "utf8");

const starterFunction = balancedBlock(holobotsSource, "export function createGenesisStarterHolobot(");
const starterLiteral = balancedBlock(starterFunction, "return normalizeUserHolobot({");

function mobileStarterHolobot(name: string) {
  const createGenesisStarterHolobot = new Function(
    "name",
    "normalizeUserHolobot",
    "calculateExperience",
    "getHolobotRank",
    `return normalizeUserHolobot(${starterLiteral});`,
  );
  return createGenesisStarterHolobot(name, normalizeUserHolobot, calculateExperience, getHolobotRank);
}

describe("genesis sign-up client/server parity", () => {
  it("mobile sign-up creates the profile through createGenesisProfile and never writes users/{uid} itself", () => {
    expect(authSource).toContain("createGenesisProfileAuthoritative(starterHolobot, normalizedUsername)");
    expect(authSource).not.toContain("userRefData");
    expect(authSource).not.toMatch(/\bsetDoc\(/);
    expect(authSource).not.toMatch(/\bupdateDoc\(/);
  });

  it("the optimistic local starter holobot is the one the host writes", () => {
    for (const starter of server.GENESIS_STARTER_CHOICES) {
      expect(mobileStarterHolobot(starter)).toEqual(server.buildGenesisStarterHolobot(starter));
    }
  });

  it("the optimistic local starter deck is the one the host writes", () => {
    const desktop = server.buildGenesisSignupUserDoc("ACE", "PakPilot", null);
    expect(getGenesisStarterDeckGrants()).toEqual(desktop.battle_cards);
    expect(Object.keys(getGenesisStarterDeckGrants())).toEqual(desktop.arena_deck_template_ids);
  });

  it("starter choices match the mobile Genesis starters", () => {
    expect([...server.GENESIS_STARTER_CHOICES]).toEqual(["ACE", "KUMA", "SHADOW"]);
    expect(authSource).toContain('export type GenesisStarterChoice = "ACE" | "KUMA" | "SHADOW";');
  });

  it("host-only genesis grants (DECISIONS #72.5): one Repair Kit, added by the callable on top of the base doc", () => {
    expect(server.buildGenesisHostGrants()).toEqual({ itemStocks: { repair_kit: 1 } });
    expect(server.GENESIS_REPAIR_KIT_ITEM).toBe("item.repair_kit");
    for (const starter of server.GENESIS_STARTER_CHOICES) {
      expect(server.buildGenesisSignupUserDoc(starter, "PakPilot", null)).not.toHaveProperty("itemStocks");
    }
  });

  it("server validation follows the mobile form (trimmed username >= 3, Genesis starter only)", () => {
    expect(server.validateGenesisSignup("ACE", "ab")).toEqual({ ok: false, reason: "invalid-username" });
    expect(server.validateGenesisSignup("ACE", "   ab   ")).toEqual({ ok: false, reason: "invalid-username" });
    expect(server.validateGenesisSignup("ACE", "abc")).toEqual({ ok: true, starter: "ACE", username: "abc" });
    expect(server.validateGenesisSignup("HARE", "abc")).toEqual({ ok: false, reason: "invalid-starter" });
    expect(server.validateGenesisSignup("ace", "abc")).toEqual({ ok: false, reason: "invalid-starter" });
    expect(server.validateGenesisSignup("ACE", 42)).toEqual({ ok: false, reason: "invalid-username" });
    expect(server.validateGenesisSignup("ACE", "x".repeat(65))).toEqual({ ok: false, reason: "invalid-username" });
  });
});
