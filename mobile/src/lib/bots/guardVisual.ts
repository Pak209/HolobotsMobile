/** Fully transparent guard rims have no colour or depth contribution.
 * Keep them out of the draw list until their existing 700ms fade is visible.
 */
export function guardVisual(now: number, startedAt: number | undefined): { opacity: number; visible: boolean } {
  const elapsed = startedAt === undefined ? Infinity : now - startedAt;
  const opacity = elapsed >= 0 && elapsed < 700 ? 0.28 * (1 - elapsed / 700) : 0;
  return { opacity, visible: opacity > 0 };
}
