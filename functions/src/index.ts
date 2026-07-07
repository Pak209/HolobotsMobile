/**
 * Cloud Functions entry point. Keep this file to re-exports only — each
 * function lives in its own module, grouped by domain:
 *
 *   account/  — auth / account lifecycle
 *   fitness/  — watch + HealthKit workout reward syncing
 *   lib/      — shared server-side domain logic (progression, scoring)
 *   shared/   — modules kept byte-identical with the mobile app (see check:shared)
 */
export { deleteUserAccountV2 } from "./account/deleteUserAccount";
export { openGachaPack } from "./economy/openGachaPack";
export { purchaseMarketplaceBooster } from "./economy/purchaseMarketplaceBooster";
export { purchaseMarketplaceItem } from "./economy/purchaseMarketplaceItem";
export { syncFitnessActivity } from "./fitness/syncFitnessActivity";
export { syncWatchWorkoutRewards } from "./fitness/syncWatchWorkoutRewards";
