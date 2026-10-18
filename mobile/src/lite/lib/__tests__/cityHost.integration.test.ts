import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { cityDistrictAccess, readArenaGathering, record } from "../cityHub";
import { cityBattleRounds, cityCombatantFighter, readCityRivalIssue, readCityRivalSettlement } from "../cityRivalBattle";
import { normalizeDuelReceipt } from "../bots/duelPlayback";
import { ArenaCombatEngine } from "../../features/arena/combatEngine";
import { resolveCombatKit } from "../../../features/arena/moveKits";

// Optional integration lane; the regular mobile suite needs no server credentials or emulator.
const hostRoot = process.env.HOLOCITY_TEST_HOST_ROOT;
type EmulatorDocument = { set(value: unknown): Promise<unknown>; get(): Promise<{ data(): Record<string, unknown> | undefined }> };
type EmulatorDb = { doc(path: string): EmulatorDocument; recursiveDelete(document: EmulatorDocument): Promise<unknown>; terminate(): Promise<unknown> };
describe.skipIf(!hostRoot)("HoloCity mobile against #80 host + loopback Firestore", () => {
  let host: ReturnType<typeof createRequire>;
  let db: EmulatorDb;
  let uid: string;
  const captures: Record<string, unknown> = {};
  beforeAll(async () => {
    if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !process.env.GCLOUD_PROJECT?.startsWith("demo-")) throw new Error("Loopback demo emulator only. Production is forbidden.");
    host = createRequire(path.join(hostRoot!, "package.json"));
    db = host("./lib/admin.js").db;
    uid = `mobile_city_throwaway_${Date.now()}`;
    await db.doc(`users/${uid}`).set({
      holobots: [{ name: "ACE", level: 2, experience: 0, nextLevelExp: 120, attributePoints: 0, boostedAttributes: {} }],
      travelSquad: { schemaVersion: "travel-squad-1", revision: 1, holobotIds: ["ace"] },
      buddyUnits: { light: 0, medium: 0, heavy: 0 }, holosTokens: 1000, arenaPassses: 2, syncPoints: 0, wins: 0, losses: 0,
      emergencyPatches: 1, itemStocks: { blueprint_fragment: 3 },
    });
  }, 30_000);
  afterAll(async () => {
    if (!db || !uid) return;
    if (process.env.HOLOCITY_CAPTURE_DIR) {
      mkdirSync(process.env.HOLOCITY_CAPTURE_DIR, { recursive: true });
      writeFileSync(path.join(process.env.HOLOCITY_CAPTURE_DIR, "host80-mobile-replies.json"), JSON.stringify({ project: process.env.GCLOUD_PROJECT, account: "throwaway local emulator", ...captures }, null, 2) + "\n");
    }
    for (const collection of ["users", "rivalBattles", "workshopHeals", "workshopCrafts"]) await db.recursiveDelete(db.doc(`${collection}/${uid}`));
    await db.terminate();
  });
  it("parses the real callable gathering, unlocks Arena and keeps Zone hidden", async () => {
    const { arenaGatheringHost } = host("./lib/story/arenaGatheringHost.js");
    const raw = await arenaGatheringHost.run({ auth: { uid }, data: { schemaVersion: "arena-gathering-1" } });
    const reply = readArenaGathering(raw); captures.gathering = raw;
    expect(reply.roster).toHaveLength(8);
    expect(cityDistrictAccess("arena", reply.storyFlags)).toBe("open");
    expect(cityDistrictAccess("zone", reply.storyFlags)).toBe("hidden");
    expect(await arenaGatheringHost.run({ auth: { uid }, data: { schemaVersion: "arena-gathering-1" } })).toEqual(raw);
  }, 20_000);
  it("plays every assigned citizen from real issue stats and parses settlement/replay/cooldown replies", async () => {
    const { transactRivalBattle } = host("./lib/rival/rivalBattleStore.js");
    const roster = readArenaGathering(captures.gathering).roster;
    const now = Date.now();
    const roundsByPilot = [];
    for (const [i, rival] of roster.entries()) {
      const issueRaw = await transactRivalBattle(db, uid, { schemaVersion: "rival-battle-3", operation: "issue", storySchema: "arena-gathering-1", rivalId: rival.citizenId }, now + i * 1000, () => 0.5);
      const issue = readCityRivalIssue(issueRaw, rival.citizenId, rival.holobotId, now);
      const player = cityCombatantFighter(issue.player, "player", uid), opponent = cityCombatantFighter(issue.opponent, "rival", uid);
      const initial = ArenaCombatEngine.initializeBattle(player, opponent);
      const observed = ArenaCombatEngine.resolveAction(initial, resolveCombatKit({ idPrefix: "integration" }).slots[0], player.holobotId);
      const rounds = cityBattleRounds(observed.actionHistory);
      expect(rounds.length).toBe(1); expect(rounds[0].damage).toBeGreaterThan(0);
      // Test the real idempotent loss receipt at a controlled host clock, never invent a client win.
      const command = { schemaVersion: "rival-battle-3", operation: "settle", battleId: issue.battleId, didWin: false, fielded: [issue.player.holobotId] };
      const settlementRaw = await transactRivalBattle(db, uid, command, now + i * 1000 + 20_000, () => 0.5);
      const settlement = readCityRivalSettlement(settlementRaw, issue.battleId);
      expect(settlement.didWin).toBe(false); expect(settlementRaw.holosGranted).toBe(25);
      const normalized = normalizeDuelReceipt({ issue: issueRaw, settlement }, rounds);
      expect(normalized.traceSource).toBe("client"); expect(normalized.didWin).toBe(false); expect(normalized.rounds).toHaveLength(1);
      const replay = await transactRivalBattle(db, uid, command, now + i * 1000 + 21_000, () => 0.5);
      expect(readCityRivalSettlement(replay, issue.battleId).alreadyProcessed).toBe(true);
      await expect(transactRivalBattle(db, uid, { schemaVersion: "rival-battle-3", operation: "issue", storySchema: "arena-gathering-1", rivalId: rival.citizenId }, now + i * 1000 + 21_000, () => 0.5)).rejects.toMatchObject({ code: "rival_cooldown", retryAfterMs: 299_000 });
      roundsByPilot.push({ citizenId: rival.citizenId, assignedBot: rival.holobotId, ringColor: rival.ringColor, playerBot: issue.player.holobotId, observedDamage: rounds[0].damage, receiptHolos: settlementRaw.holosGranted });
      if (i === 0) { captures.issue = issueRaw; captures.settlement = settlementRaw; captures.settlementReplay = replay; captures.clientTrace = rounds; }
    }
    captures.citizenIntegration = roundsByPilot;
    expect((await db.doc(`users/${uid}`).get()).data()?.holosTokens).toBe(1200);
  }, 40_000);
  it("heals and crafts through the actual workshop hosts without duplicate grants", async () => {
    const { workshopHealHost } = host("./lib/workshop/workshopHealHost.js");
    const { workshopCraftHost } = host("./lib/workshop/workshopCraftHost.js");
    const heal = await workshopHealHost.run({ auth: { uid }, data: { schemaVersion: "healing-workshop-1", operation: "heal", requestId: "mobile_city_heal" } });
    expect(heal.cost).toBe(0); expect(heal.holobotIds).toEqual(["ace"]); captures.heal = heal;
    const command = { auth: { uid }, data: { schemaVersion: "healing-workshop-1", operation: "craft", itemId: "item.repair_kit", requestId: "mobile_city_craft" } };
    const craft = await workshopCraftHost.run(command); captures.craft = craft;
    expect(craft.quantity).toBe(1); expect(craft.fragmentsSpent).toBe(3);
    const replay = await workshopCraftHost.run(command); expect(replay.alreadyProcessed).toBe(true);
    const profile = (await db.doc(`users/${uid}`).get()).data();
    expect(record(profile?.itemStocks)?.repair_kit).toBe(1); expect(record(profile?.itemStocks)?.blueprint_fragment).toBe(0); expect(profile?.emergencyPatches).toBe(0);
  }, 20_000);
});
