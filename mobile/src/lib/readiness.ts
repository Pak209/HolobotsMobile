/** Read-only companion projection of the host's protected per-bot readiness. */
export type ReadinessEntry = Readonly<{ milli: number; atMs: number }>;
export type ReadinessAward = Readonly<{ holobotName: string; before: number; gained: number; after: number }>;
const DAY_MS = 86_400_000;

export function readinessUiEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HOLOCITY_READINESS === "1";
}

export function readSyncReadiness(raw: unknown): Readonly<Record<string, ReadinessEntry>> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, ReadinessEntry> = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.milli !== "number" || !Number.isInteger(row.milli) || row.milli < 0 || row.milli > 100_000
      || typeof row.atMs !== "number" || !Number.isInteger(row.atMs) || row.atMs < 0) return null;
    out[name] = { milli: row.milli, atMs: row.atMs };
  }
  return out;
}

/** Display projection only; the host recomputes live readiness before every authoritative use. */
export function readinessDisplayValue(entry: ReadinessEntry | undefined, nowMs: number): number {
  if (!entry) return 0;
  const days = Math.max(0, nowMs - entry.atMs) / DAY_MS;
  return Math.floor(Math.floor(entry.milli * Math.pow(0.8, days)) / 1000);
}

export function readinessResultCopy(award: ReadinessAward | null | undefined, persisted: boolean): string {
  if (!persisted) return "Readiness needs a connection. Collect to retry.";
  if (award === undefined) return "SYNC readiness is not active yet.";
  if (!award) return "No new readiness (already synced or no tagged Holobot).";
  return `+${award.gained} SYNC READINESS → ${award.holobotName} (${award.after}/100)`;
}
