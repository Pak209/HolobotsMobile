export type FollowPoint = { x: number; y: number; time: number };

export const sampleDelayed = (history: readonly FollowPoint[], nowMs: number, delayMs: number): FollowPoint | null => {
  if (!history.length) return null;
  const target = nowMs - delayMs;
  if (target <= history[0].time) return history[0];
  for (let index = 1; index < history.length; index += 1) {
    const next = history[index];
    if (next.time < target) continue;
    const previous = history[index - 1];
    const span = next.time - previous.time || 1;
    const amount = Math.max(0, Math.min(1, (target - previous.time) / span));
    return { x: previous.x + (next.x - previous.x) * amount, y: previous.y + (next.y - previous.y) * amount, time: target };
  }
  return history[history.length - 1];
};
