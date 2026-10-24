import { battleIqEnabled, battleIqFor, fadedReadinessMilli } from './syncReadiness';

export const READINESS_START_FLAG = 'HOLOCITY_READINESS_START';
export const BATTLE_IQ_FLAG = 'HOLOCITY_BATTLE_IQ';
export const CPU_START_SYNC = { rookie: 0, starter: 6, champion: 12, rare: 18, elite: 24, legendary: 30 } as const;
export const MANUAL_SYNC_CAP = 50;

function integer(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

export function readinessStartEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[READINESS_START_FLAG] === '1';
}
export { battleIqEnabled };

export function momentumFor(profile: Record<string, unknown>, holobotId: string): number {
  const map = profile.syncMomentum;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 0;
  return Math.max(0, Math.min(3, integer((map as Record<string, unknown>)[holobotId.toUpperCase()])));
}

/** The issue reads only host-owned fields; the client cannot select a starting value. */
export function manualReadinessStart(profile: Record<string, unknown>, holobotId: string, nowMs: number): {holobotId: string; readiness: number; cap: number; startSync: number} {
  const name = holobotId.toUpperCase();
  const map = profile.syncReadiness;
  const entry = map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, unknown>)[name] : undefined;
  const readiness = Math.floor(fadedReadinessMilli(entry, nowMs, battleIqEnabled() ? battleIqFor(profile, name) : 0) / 1000);
  return { holobotId, readiness, cap: MANUAL_SYNC_CAP, startSync: Math.min(MANUAL_SYNC_CAP, readiness + 5 * momentumFor(profile, holobotId)) };
}

export function cpuStartSync(rank: string): number {
  return CPU_START_SYNC[rank.toLowerCase() as keyof typeof CPU_START_SYNC] ?? 0;
}

/** Reserved for a later expedition auto-send; manual fight decisions never read IQ. */
export function battleIqCpuRank(profile: Record<string, unknown>, holobotId: string): keyof typeof CPU_START_SYNC {
  const bands: (keyof typeof CPU_START_SYNC)[] = ['rookie','starter','champion','rare','elite','legendary'];
  return bands[Math.min(5, Math.floor(battleIqFor(profile, holobotId.toUpperCase()) / 20))];
}

/** Called only on a first authoritative settle, in the same user-doc transaction. */
export function fightLearningAfterSettle(profile: Record<string, unknown>, fielded: readonly string[], didWin: boolean, opponentLevel: number): {battleIq: Record<string, number>; syncMomentum: Record<string, number>} {
  const priorIq = profile.battleIq && typeof profile.battleIq === 'object' && !Array.isArray(profile.battleIq) ? profile.battleIq as Record<string, number> : {};
  const priorMomentum = profile.syncMomentum && typeof profile.syncMomentum === 'object' && !Array.isArray(profile.syncMomentum) ? profile.syncMomentum as Record<string, number> : {};
  const battleIq = { ...priorIq }, syncMomentum = { ...priorMomentum };
  const roster = Array.isArray(profile.holobots) ? profile.holobots : [];
  for (const raw of new Set(fielded)) {
    const name = raw.toUpperCase();
    const bot = roster.find(row => row && typeof row === 'object' && typeof row.name === 'string' && row.name.trim().toUpperCase() === name);
    if (!bot) continue;
    const level = Math.max(1, integer(bot.level));
    // A stronger opponent teaches even on a loss. An equal/lower loss does not farm IQ.
    const gain = didWin ? 4 : opponentLevel > level ? 2 : 0;
    battleIq[name] = Math.min(100, battleIqFor(profile, name) + gain);
    syncMomentum[name] = didWin ? Math.min(3, momentumFor(profile, name) + 1) : 0;
  }
  return { battleIq, syncMomentum };
}
