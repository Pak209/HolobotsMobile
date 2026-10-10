/**
 * holoZoneHost wire versions (DECISIONS #54 plan §P1 item 2). Every rule in lib/holoZoneRuns.ts produces the v1 reply
 * (holozone-run-1, deployed 2026-10-06 — byte-identical, JSON key order included, for a client that did not ask for
 * v2: the shipped Unity build). A request carrying `schemaVersion: "holozone-run-2"` gets the v1 reply plus:
 *   issue  → `population` (lib/holoZonePopulation.ts for the issued run's zone and tier; null when the table has no row)
 *   status → `population` (the open run's, or null when there is no open run / no row)
 *   settle → the v1 reply under the v2 version (nothing added)
 * Rulings are identical in both versions; `population` is presentation data (what Unity places), never a ruling.
 *
 * Pure module: no firebase imports, safe to import from tests (functions/scripts/test-holozone-population.mjs).
 */
import { holoZonePopulation, HoloZonePopulation } from "./holoZonePopulation";
import { HOLOZONE_SCHEMA_V1, HOLOZONE_SCHEMA_V2, HoloZoneIssueReply, HoloZoneSettleReply, HoloZoneStatusReply, HoloZoneWireVersion } from "./holoZoneRuns";

export { HOLOZONE_SCHEMA_V1, HOLOZONE_SCHEMA_V2 };
export type { HoloZoneWireVersion };

/** The fields holozone-run-2 adds; a v1 reply never carries them. */
export const HOLOZONE_V2_REPLY_FIELDS = ["population"] as const;

export type HoloZoneStatusReplyV2 = Omit<HoloZoneStatusReply, "schemaVersion"> & { schemaVersion: typeof HOLOZONE_SCHEMA_V2; population: HoloZonePopulation | null };
export type HoloZoneIssueReplyV2 = Omit<HoloZoneIssueReply, "schemaVersion"> & { schemaVersion: typeof HOLOZONE_SCHEMA_V2; population: HoloZonePopulation | null };
export type HoloZoneSettleReplyV2 = Omit<HoloZoneSettleReply, "schemaVersion"> & { schemaVersion: typeof HOLOZONE_SCHEMA_V2 };

/** status: v1 unchanged; v2 adds the open run's population (null when none is open or the table has no row). */
export function holoZoneStatusReplyForVersion(reply: HoloZoneStatusReply, version: HoloZoneWireVersion): HoloZoneStatusReply | HoloZoneStatusReplyV2 {
  if (version !== HOLOZONE_SCHEMA_V2) return reply;
  return { ...reply, schemaVersion: HOLOZONE_SCHEMA_V2, population: reply.run ? holoZonePopulation(reply.run.zoneId, reply.run.tier) : null };
}

/** issue: v1 unchanged; v2 adds the issued run's population. */
export function holoZoneIssueReplyForVersion(reply: HoloZoneIssueReply, version: HoloZoneWireVersion): HoloZoneIssueReply | HoloZoneIssueReplyV2 {
  if (version !== HOLOZONE_SCHEMA_V2) return reply;
  return { ...reply, schemaVersion: HOLOZONE_SCHEMA_V2, population: holoZonePopulation(reply.zoneId, reply.tier) };
}

/** settle: v1 unchanged; v2 is the same reply under the v2 version. */
export function holoZoneSettleReplyForVersion(reply: HoloZoneSettleReply, version: HoloZoneWireVersion): HoloZoneSettleReply | HoloZoneSettleReplyV2 {
  if (version !== HOLOZONE_SCHEMA_V2) return reply;
  return { ...reply, schemaVersion: HOLOZONE_SCHEMA_V2 };
}
