/**
 * The City's HP ledger (`holobotVitals` on the account doc). Only the host writes it (arena / rival / zone settles); the
 * client reads it to warn BEFORE paying an entry the City would refuse with `holobot_ko` (critic F2). Display only: the
 * host still decides admission, and an unreadable or absent ledger means "unknown", never "KO" and never "healthy".
 */
export type HostVitals = Readonly<Record<string, Readonly<{ currentHealth: number; maxHealth: number }>>>;

/** Strict copy of the host ledger shape (functions/src/lib/rivalHealth.ts `ledger`). Malformed -> null (unknown). */
export function readHostVitals(raw: unknown): HostVitals | null {
    if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out: Record<string, { currentHealth: number; maxHealth: number }> = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        const v = value as Record<string, unknown> | null;
        if (!v || typeof v !== 'object' || typeof v.currentHealth !== 'number' || !Number.isFinite(v.currentHealth) || typeof v.maxHealth !== 'number'
            || !Number.isFinite(v.maxHealth) || v.maxHealth <= 0 || v.currentHealth < 0 || v.currentHealth > v.maxHealth) return null;
        out[id] = { currentHealth: v.currentHealth, maxHealth: v.maxHealth };
    }
    return out;
}
/** True only when the City's ledger says this Holobot is at 0 HP (the host's holobot_ko rule). Missing entry = fresh. */
export function hostKnockedOut(vitals: HostVitals | null | undefined, holobotId: string): boolean {
    return vitals?.[holobotId]?.currentHealth === 0;
}
