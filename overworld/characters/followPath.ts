export type FollowPoint = { x: number; y: number; time: number };

type GridPlayer = {
  gridX: number;
  gridY: number;
  direction: "up" | "down" | "left" | "right";
};

const BEHIND: Record<GridPlayer["direction"], { x: number; y: number }> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};

export const computeCompanionSpawn = (
  player: GridPlayer,
  isWalkable: (x: number, y: number) => boolean,
): { x: number; y: number } => {
  const behind = BEHIND[player.direction];
  const candidates = [
    { x: player.gridX + behind.x, y: player.gridY + behind.y },
    { x: player.gridX + behind.y, y: player.gridY - behind.x },
    { x: player.gridX - behind.y, y: player.gridY + behind.x },
  ];
  return candidates.find(({ x, y }) => isWalkable(x, y)) ?? { x: player.gridX, y: player.gridY };
};

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
