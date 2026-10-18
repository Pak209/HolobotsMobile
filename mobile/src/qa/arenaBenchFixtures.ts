/** Offline QA data for the 3v3 bench preview. No host calls, charge or account. */
import { canonicalArenaValue, type Arena3v3IntentStorage } from '@/lib/arenaMatchFlow';
import type { Arena3v3Swap } from '@/lib/arenaMatch3v3';
import { applyBenchRegen, createTeamBattle, type TeamBattle } from '@/features/arena/teamBattle';
import type { ArenaFighter } from '@/types/arena';
import fixture from './fixtures/arena-match-3v3-lifecycle.json';

/** Verbatim copy of functions/scripts/fixtures/arena-match-3v3/lifecycle.json (HolobotsMobile #134, commit 240ef83). */
export const ARENA_3V3_FIXTURE_SHA256 = '05490d02a2efb6fcd42cbae07aa437815bed95872273141f9450c467727734ec';
/** Known-bad calibration first, then host cells. */
export const ARENA_BENCH_PREVIEW_ROUTES = ['ArenaBenchKnownBad', 'ArenaBenchCommand', 'ArenaBenchRefused', 'ArenaBenchSendIn', 'ArenaBenchSettled'] as const;
type Refusal = { code: string; message: string; details: { rejectionCode: string } };
export type ArenaBenchFixtureStep = { name: string; nowMs: number; request: Record<string, unknown>; reply?: unknown; refusal?: Refusal; knownBad?: boolean; note?: string };
export const ARENA_3V3_FIXTURE_STEPS = fixture.steps as unknown as ArenaBenchFixtureStep[];
export const benchStep = (name: string): ArenaBenchFixtureStep => {
    const step = ARENA_3V3_FIXTURE_STEPS.find(s => s.name === name);
    if (!step) throw Error(`missing 3v3 fixture step ${name}`);
    return step;
};
/** A callable-shaped error, as firebase/functions raises for an HttpsError. */
export const fixtureRefusal = (refusal: Refusal) => Object.assign(Error(refusal.message), { code: `functions/${refusal.code}`, details: refusal.details });
/** Offline stand-in for arenaMatchHost. resume answers with the chosen step's projection; any other request must
 * equal a fixture request exactly (intentId included), or it is refused as unavailable. */
export function fixtureBenchHost(resumeAt: string) {
    return async (request: Record<string, unknown>): Promise<unknown> => {
        if (request.operation === 'resume') return structuredClone(benchStep(resumeAt).reply);
        const step = ARENA_3V3_FIXTURE_STEPS.find(s => canonicalArenaValue(s.request) === canonicalArenaValue(request));
        if (!step) throw fixtureRefusal({ code: 'unavailable', message: 'unavailable', details: { rejectionCode: 'unavailable' } });
        if (step.refusal) throw fixtureRefusal(step.refusal);
        return structuredClone(step.reply);
    };
}
/** In-memory stand-in for the per-account AsyncStorage intent key. */
export function memoryIntents(seed: Arena3v3Swap | null = null): Arena3v3IntentStorage & { peek(): Arena3v3Swap | null } {
    let value = seed;
    return { get: async () => value, set: async v => { value = v; }, peek: () => value };
}
/** The exact persisted body of a fixture swap, so a QA cell retries it byte for byte. */
export const fixtureSwap = (name: string) => benchStep(name).request as Arena3v3Swap;

const legacyFighter = (holobotId: string, maxHP: number, currentHP: number): ArenaFighter => ({
    holobotId, ownerUserId: 'offline-fixture', name: holobotId.toUpperCase(), avatar: 'qa://legacy', archetype: 'balanced', level: 1,
    maxHP, currentHP, attack: 40, defense: 30, speed: 25, intelligence: 25, stamina: 4, maxStamina: 7, specialMeter: 0, staminaState: 'fresh',
    isInDefenseMode: false, comboCounter: 0, lastActionTime: 0, statusEffects: [], staminaEfficiency: 1, defenseTimingWindow: 500,
    counterDamageBonus: 1.25, damageMultiplier: 1, speedBonus: 0, totalDamageDealt: 0, abilityRuntime: { firedCount: 0 },
});
/** KNOWN BAD: the legacy LOCAL-authority 3v3 (features/arena/teamBattle). The client decides bench STA by
 * regenerating it on its own clock. It must never reach the bench cards; the strict reader refuses it. */
export function legacyLocalTeam(ticks = 3): { before: TeamBattle; after: TeamBattle } {
    const side = (ids: [string, number, number][]) => ids.map(([id, max, hp]) => ({ fighter: legacyFighter(id, max, hp), moves: [] }));
    const before = createTeamBattle(side([['ace', 172, 172], ['kuma', 220, 205], ['shadow', 150, 150]]), side([['hare', 248, 248], ['wake', 236, 236], ['gama', 262, 262]]));
    let after = before;
    for (let i = 0; i < ticks; i++) after = applyBenchRegen(after);
    return { before, after };
}
