import { FighterState, MovementRule } from './types';

export const RANGE_TIERS_MM = Object.freeze({ Close: 1500, Mid: 4000, Long: 8000 });
/** Provisional producer SpeedTable.DefaultEntries, 2026-10-17. Not a live balance table. */
export const MOVEMENT_SPEEDS = Object.freeze({
    ace: 3200, wolf: 3000, hare: 3200, shadow: 3000, ken: 2600, tsuin: 2600,
    wake: 2400, jusan: 2400, kurai: 2400, era: 2200, gama: 2000, kuma: 1600, tora: 1600,
});
export const MOVEMENT_PREFERRED_RANGE = Object.freeze({
    ace: 4000, wolf: 1500, hare: 1500, shadow: 1500, ken: 1500, tsuin: 1500,
    wake: 4000, jusan: 1500, kurai: 4000, era: 4000, gama: 1500, kuma: 1500, tora: 1500,
});
/** Ceiling prevents a faster-than-promised cooldown at fractional tick boundaries. */
export const dashCooldownTicks = (speedMmPerSecond: number) => Math.ceil(360000 / speedMmPerSecond);
export function sqrtCeil(n: bigint): bigint {
    if (n <= 1n) return n;
    let x = n, next = (x + 1n) / 2n;
    while (next < x) { x = next; next = (x + n / x) / 2n; }
    return x * x === n ? x : x + 1n;
}
const distance = (x: number, z: number) => Number(sqrtCeil(BigInt(x) ** 2n + BigInt(z) ** 2n));
const scaled = (x: number, n: number, d: number) => Number(BigInt(x) * BigInt(n) / BigInt(d));
/** Conservative radial projection: no square-corner leakage, integer-only geometry. */
export function clampToRing(f: FighterState, radiusMm: number): void {
    const length = distance(f.x, f.z), radius = 12000 - radiusMm;
    if (length > radius) { f.x = scaled(f.x, radius, length); f.z = scaled(f.z, radius, length); }
}
/** Autonomous movement is evaluated from a shared pre-movement position snapshot. */
export function moveFighter(f: FighterState, rule: MovementRule, tick: number,
    target: {x: number; z: number} | null, desiredDistance: number, radiusMm: number,
    emitDash: () => void): void {
    const state = f.movement!;
    let dx = 0, dz = 0, gap = 0;
    if (target) {
        const x = target.x - f.x, z = target.z - f.z, length = distance(x, z);
        gap = Math.abs(length - desiredDistance);
        const sign = length > desiredDistance ? 1 : -1;
        dx = x * sign || 0; dz = z * sign || 0;
        // Exact coincidence can only occur with a defeated/benched target, handled by caller.
    } else if (f.moveX || f.moveZ) {
        dx = f.moveX; dz = f.moveZ; gap = 4000;
    }
    if (state.dashTicks === 0 && gap >= 4000 && (dx || dz) && tick >= state.dashReadyTick && f.stamina >= 1) {
        state.dashTicks = 9;
        state.dashX = dx; state.dashZ = dz;
        state.dashReadyTick = tick + dashCooldownTicks(rule.speedMmPerSecond);
        f.stamina--;
        emitDash();
    }
    if (state.dashTicks > 0) {
        // Cumulative displacement avoids dropping the four remainder millimetres.
        const elapsed = 9 - state.dashTicks, length = distance(state.dashX, state.dashZ);
        const before = Math.floor(4000 * elapsed / 9), after = Math.floor(4000 * (elapsed + 1) / 9);
        f.x += scaled(state.dashX, after, length) - scaled(state.dashX, before, length);
        f.z += scaled(state.dashZ, after, length) - scaled(state.dashZ, before, length);
        dx = state.dashX; dz = state.dashZ;
        state.dashTicks--;
        if (state.dashTicks === 0) state.dashX = state.dashZ = 0;
    } else if ((dx || dz) && gap > 0) {
        const budget = rule.speedMmPerSecond + state.runRemainder;
        const step = Math.min(gap, Math.floor(budget / 30));
        state.runRemainder = budget % 30;
        const length = distance(dx, dz);
        f.x += scaled(dx, step, length); f.z += scaled(dz, step, length);
    }
    if (dx || dz) { f.facingX = Math.sign(dx); f.facingZ = Math.sign(dz); }
    clampToRing(f, radiusMm);
}
