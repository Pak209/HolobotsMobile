/** Host-owned, optional local-practice presentation profile. No rewards or persistent battle outcome change. */
export function desktopPracticeCommands(botId: string) {
  return {
    version: 1, maxStamina: 7, staminaRegen: 0.5, strikeCost: 1, comboCost: 2,
    defendThreshold: 1, defendRestore: 2, halfCost: 2, fullCost: 4,
    halfSync: 50, fullSync: 100, halfEffect: 0.5, fullEffect: 1,
    guardSeconds: 2.5, guardCooldown: 6, braceSeconds: 1.5, guardReduction: 0.5,
    stackReduction: 0.15, maxGuardStacks: 2, guardCharges: botId.toLowerCase() === 'hare' ? 2 : 1,
    strikeSync: 10, comboSync: 14, blockedSyncScale: 0.5, guardSync: 6,
    syncFloor: botId.toLowerCase() === 'era' ? 25 : 0, comboExpiry: 4, regenPause: 1,
  };
}
