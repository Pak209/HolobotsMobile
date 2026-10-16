import { auth, functions, httpsCallable } from "@/config/firebase";
import { GATHERING_SCHEMA, readArenaGathering, readCityStoryFlags, record, type ArenaCitizen } from "./cityHub";
import type { CityHubFixture } from "./cityHubFixtures";
import { CALLABLE_TIMEOUT_MS, withTimeout } from "./async";
import { readCityRivalSettlement } from "./cityRivalBattle";

/** Captures the session across each call so a delayed response cannot cross accounts. */
async function cityCall(uid: string, name: string, request: Record<string, unknown>): Promise<unknown> {
  if (!uid || auth.currentUser?.uid !== uid) throw { code: "unauthenticated" };
  const reply = await withTimeout(httpsCallable<Record<string, unknown>, unknown>(functions, name)(request), CALLABLE_TIMEOUT_MS,
    name === "rivalBattleHost" && request.operation === "issue"
      ? "The rival host did not confirm admission. It may still be processing; do not start another challenge yet."
      : "The city host is taking too long. Retry to check the same request.");
  if (auth.currentUser?.uid !== uid) throw { code: "unauthenticated" };
  return reply.data;
}
export async function meetCityPilots(uid: string) {
  return readArenaGathering(await cityCall(uid, "arenaGatheringHost", { schemaVersion: GATHERING_SCHEMA }));
}
export const CITY_LIVE_DUEL_HOLD = "Live citizen duels aren’t available in this build. You can still meet the pilots.";
/** #94 omits playerCombatants. Never open a battle this legacy client would auto-forfeit. */
export async function issueCityRival(_uid: string, _rival: ArenaCitizen): Promise<unknown> {
  throw new Error(CITY_LIVE_DUEL_HOLD);
}
export async function settleCityRival(uid: string, battleId: string, didWin: boolean, fielded: string[]) {
  const reply = await cityCall(uid, "rivalBattleHost", { schemaVersion: "rival-battle-3", operation: "settle", battleId, didWin, fielded });
  return readCityRivalSettlement(reply, battleId);
}
export type WorkshopCraftItem = "item.repair_kit" | "item.full_restore";
export async function healCitySquad(uid: string, requestId: string) {
  const reply = record(await cityCall(uid, "workshopHealHost", { schemaVersion: "healing-workshop-1", operation: "heal", requestId }));
  if (reply?.schemaVersion !== "healing-workshop-1" || reply.operation !== "heal" || reply.cost !== 0 || !Array.isArray(reply.holobotIds) || !reply.holobotIds.every((id) => typeof id === "string" && id.length > 0)) throw new Error("The workshop reply could not be verified. Retry the same action.");
  return reply;
}
export async function craftCityItem(uid: string, itemId: WorkshopCraftItem, requestId: string) {
  const reply = record(await cityCall(uid, "workshopCraftHost", { schemaVersion: "healing-workshop-1", operation: "craft", itemId, requestId }));
  if (reply?.schemaVersion !== "healing-workshop-1" || reply.operation !== "craft" || reply.itemId !== itemId || reply.quantity !== 1) throw new Error("The workshop reply could not be verified. Retry the same action.");
  return reply;
}
export function cityRequestId(): string {
  return `mobile_city_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Read the host account before fetching a seen gathering; opening the hub never joins it implicitly. */
export async function loadCityHub(uid: string, fixture?: CityHubFixture) {
  if (fixture) return { storyFlags: fixture.storyFlags, roster: fixture.roster };
  const reply = record(await cityCall(uid, "desktopAccountSnapshot", { schemaVersion: "desktop-account-3" }));
  if (reply?.schemaVersion !== "desktop-account-3" || reply.uid !== uid) throw new Error("The city account could not be verified. Refresh to retry.");
  const storyFlags = readCityStoryFlags(reply.storyFlags);
  if (!storyFlags.arenaGatheringSeen) return { storyFlags, roster: [] as ArenaCitizen[] };
  const gathering = await meetCityPilots(uid);
  return { storyFlags: gathering.storyFlags, roster: gathering.roster };
}
