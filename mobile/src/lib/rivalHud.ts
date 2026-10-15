export type RivalHudStatus = { tier: number; tierLabel: string; rivalWins: number; winsToNextTier: number };
export type RivalCooldown = { pilotId: string; endsAtMs: number };

/** The nearest observed rival cooldown, never a global restriction on all rivals. */
export function nextRivalCooldown(cooldowns: readonly RivalCooldown[], nowMs: number): RivalCooldown | null {
  return cooldowns.filter(c => c.pilotId && Number.isFinite(c.endsAtMs) && c.endsAtMs > nowMs)
    .sort((a,b) => a.endsAtMs - b.endsAtMs)[0] ?? null;
}
export function formatRivalCountdown(endsAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
