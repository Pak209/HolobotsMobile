/** Host-owned per-bot workout readiness. Battle IQ can reduce the fade rate later. */
export const READINESS_MAX_MILLI = 100_000;
export const READINESS_FULL_SESSION_SECONDS = 300;
export const READINESS_BASE_FADE_FRACTION = 0.2;
const DAY_MS = 86_400_000;

export type ReadinessEntry = { milli: number; atMs: number };
export type ReadinessAward = { holobotName: string; before: number; gained: number; after: number };

export function readinessAccrualEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HOLOCITY_READINESS_ACCRUE === "1";
}

/** Reserved for a future hidden Battle IQ slowdown; R1 always returns the base rate. */
export function readinessFadeFractionPerDay(_battleIq?: number): number {
  return READINESS_BASE_FADE_FRACTION;
}

function finiteInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export function fadedReadinessMilli(entry: unknown, nowMs: number, battleIq?: number): number {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return 0;
  const row = entry as Record<string, unknown>;
  const milli = Math.max(0, Math.min(READINESS_MAX_MILLI, finiteInt(row.milli)));
  const atMs = Math.max(0, finiteInt(row.atMs, nowMs));
  const days = Math.max(0, nowMs - atMs) / DAY_MS;
  return Math.floor(milli * Math.pow(1 - readinessFadeFractionPerDay(battleIq), days));
}

function readinessMap(profile: Record<string, unknown>): Record<string, ReadinessEntry> {
  const raw = profile.syncReadiness;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, ReadinessEntry>
    : {};
}

export function readinessView(profile: Record<string, unknown>, nowMs: number): Record<string, { value: number; atMs: number; fadePerDay: number }> {
  const out: Record<string, { value: number; atMs: number; fadePerDay: number }> = {};
  const bots = Array.isArray(profile.holobots) ? profile.holobots : [];
  for (const bot of bots) {
    if (!bot || typeof bot !== "object" || typeof bot.name !== "string") continue;
    const name = bot.name.trim().toUpperCase();
    if (!name || out[name]) continue;
    out[name] = { value: Math.floor(fadedReadinessMilli(readinessMap(profile)[name], nowMs) / 1000), atMs: nowMs, fadePerDay: 20 };
  }
  return out;
}

/** No roster-index fallback. Returns null and no update for an untagged or unknown bot. */
export function applyReadinessGain(profile: Record<string, unknown>, holobotName: unknown, elapsedSeconds: unknown, nowMs: number): { update: Record<string, ReadinessEntry> | null; award: ReadinessAward | null } {
  if (typeof holobotName !== "string" || !holobotName.trim()) return { update: null, award: null };
  const name = holobotName.trim().toUpperCase();
  const bots = Array.isArray(profile.holobots) ? profile.holobots : [];
  if (!bots.some(bot => bot && typeof bot === "object" && typeof bot.name === "string" && bot.name.trim().toUpperCase() === name)) {
    return { update: null, award: null };
  }
  const elapsed = Math.max(0, Math.min(READINESS_FULL_SESSION_SECONDS, finiteInt(elapsedSeconds)));
  const gain = Math.floor(READINESS_MAX_MILLI * elapsed / READINESS_FULL_SESSION_SECONDS);
  const beforeMilli = fadedReadinessMilli(readinessMap(profile)[name], nowMs);
  const afterMilli = Math.min(READINESS_MAX_MILLI, beforeMilli + gain);
  return {
    update: { ...readinessMap(profile), [name]: { milli: afterMilli, atMs: nowMs } },
    award: { holobotName: name, before: Math.floor(beforeMilli / 1000), gained: Math.floor(afterMilli / 1000) - Math.floor(beforeMilli / 1000), after: Math.floor(afterMilli / 1000) },
  };
}

/** Shared phone/watch gate: an identified, newly counted session is the only earn event. */
export function accrueWorkoutReadiness(
  profile: Record<string, unknown>,
  options: { activityId: string; counted: boolean; holobotName: unknown; elapsedSeconds: unknown; nowMs: number },
  env: NodeJS.ProcessEnv = process.env,
): { update: Record<string, ReadinessEntry> | null; award: ReadinessAward | null } | null {
  if (!readinessAccrualEnabled(env) || !options.counted || !options.activityId.trim()) return null;
  return applyReadinessGain(profile, options.holobotName, options.elapsedSeconds, options.nowMs);
}
