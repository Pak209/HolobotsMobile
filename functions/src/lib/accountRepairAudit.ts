import { Firestore, Transaction } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

/**
 * host-crawl-fixes-1: durable audit of a host-side legacy-data repair (holobot progression self-heal,
 * economy-field sanitizer). Server-only `accountRepairs/{uid}/entries/{autoId}` (firestore.rules catch-all
 * denies every client read/write; deleteUserData removes the tree). One entry per committed repair pass, plus
 * a structured Cloud Logging line. A pass that changes nothing writes nothing.
 */
export const ACCOUNT_REPAIR_SCHEMA = "account-repair-1" as const;
export type RepairChange = { path: string; before: unknown; after: unknown };

/** Firestore-safe, bounded description of an arbitrary stored value (undefined, NaN, Timestamps, maps). */
export function describeRepairValue(value: unknown): string {
  let text: string;
  if (value === undefined) text = "undefined";
  else if (typeof value === "number") text = `number:${String(value)}`;
  else if (typeof value === "string") text = `string:${JSON.stringify(value)}`;
  else {
    try { text = `${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}:${JSON.stringify(value)}`; }
    catch { text = typeof value; }
  }
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

export function auditRows(changes: readonly RepairChange[]) {
  return changes.map((c) => ({ path: c.path, before: describeRepairValue(c.before), after: describeRepairValue(c.after) }));
}

/** Writes one audit entry inside the caller's transaction (no-op for an empty change list). */
export function recordAccountRepair(firestore: Firestore, tx: Transaction, uid: string, source: string, changes: readonly RepairChange[], nowMs: number): void {
  if (!changes.length) return;
  const rows = auditRows(changes);
  tx.create(firestore.collection(`accountRepairs/${uid}/entries`).doc(), { schemaVersion: ACCOUNT_REPAIR_SCHEMA, source, atMs: nowMs, changes: rows });
  logger.info("accountRepair", { uid, source, changes: rows });
}
