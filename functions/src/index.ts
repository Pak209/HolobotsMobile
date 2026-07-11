/**
 * Cloud Functions entry point. Keep this file to re-exports only — each
 * function lives in its own module, grouped by domain:
 *
 *   account/  — auth / account lifecycle
 *   fitness/  — watch + HealthKit workout reward syncing
 *   lib/      — shared server-side domain logic (progression, scoring)
 *   shared/   — modules kept byte-identical with the mobile app (see check:shared)
 */
export { chargeArenaEntry } from "./arena/chargeArenaEntry";
export { claimQuestRun } from "./progression/claimQuestRun";
export { claimTrainingSession } from "./progression/claimTrainingSession";
export { clearWorkoutCooldown } from "./fitness/clearWorkoutCooldown";
export { deleteUserAccountV2 } from "./account/deleteUserAccount";
export { mintHolobot } from "./progression/mintHolobot";
export { openGachaPack } from "./economy/openGachaPack";
export { purchaseMarketplaceBooster } from "./economy/purchaseMarketplaceBooster";
export { purchaseMarketplaceItem } from "./economy/purchaseMarketplaceItem";
export { purchaseMarketplacePart } from "./economy/purchaseMarketplacePart";
export { saveHolobotCombatKit } from "./progression/saveHolobotCombatKit";
export { settleArenaBattle } from "./arena/settleArenaBattle";
export { syncFitnessActivity } from "./fitness/syncFitnessActivity";
export { syncWatchWorkoutRewards } from "./fitness/syncWatchWorkoutRewards";
export { upgradeHolobotRank } from "./progression/upgradeHolobotRank";
export { upgradeHolobotMove } from "./progression/upgradeHolobotMove";
export { upgradeSyncStat } from "./progression/upgradeSyncStat";
export { useEnergyRefill } from "./economy/useEnergyRefill";
