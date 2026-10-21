/** lite-vfx-port-1: pure curve / colour helpers for the VFX player (no three, no react-native: unit-testable).
 * Ports of Unity's AnimationCurve (Hermite keys), the FxKitBuilderRedo linear key tables and CombatScreenFlash.AlphaAfter. */

/** Unity AnimationCurve.Evaluate over [time, value, inTangent, outTangent] keys (missing tangents = 0, clamped ends). */
export function hermite(keys: readonly (readonly number[])[], t: number): number {
  const n = keys.length;
  if (n === 0) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t > b[0]) continue;
    const dt = b[0] - a[0];
    if (dt <= 0) return b[1];
    const s = (t - a[0]) / dt, s2 = s * s, s3 = s2 * s;
    const m0 = (a[3] ?? 0) * dt, m1 = (b[2] ?? 0) * dt;
    return (2 * s3 - 3 * s2 + 1) * a[1] + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * b[1] + (s3 - s2) * m1;
  }
  return keys[n - 1][1];
}

/** A linear key table flattened to [t0, v0, t1, v1, ...] (FxKitBuilderRedo.Keys / gradient alpha keys). */
export function linearAt(table: ArrayLike<number>, t: number): number {
  const n = table.length;
  if (n < 2) return 0;
  if (t <= table[0]) return table[1];
  for (let i = 2; i < n; i += 2) {
    if (t <= table[i]) {
      const t0 = table[i - 2], t1 = table[i];
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return table[i - 1] + (table[i + 1] - table[i - 1]) * u;
    }
  }
  return table[n - 1];
}

export type FlashPulse = { peak: number; upFrames: number; holdFrames: number; outFrames: number };

/** CombatScreenFlash.AlphaAfter: alpha k rendered frames after the fire frame (k = 0 is the hit frame). */
export function flashAlphaAfter(p: FlashPulse, k: number): number {
  if (k < 0) return 0;
  const up = Math.max(1, p.upFrames);
  if (k < up - 1) return p.peak * (k + 1) / up;
  const holdEnd = up - 1 + Math.max(0, p.holdFrames);
  if (k <= holdEnd) return p.peak;
  const o = k - holdEnd;
  if (o > p.outFrames) return 0;
  const u = 1 - o / Math.max(1, p.outFrames);
  return p.peak * u * u;
}

/** '#RRGGBB' -> linear-free sRGB 0..1 triple (the player works in display space, as Unity's gamma-space particle colours do). */
export function hexRgb(hex: string): [number, number, number] {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!v) return [1, 1, 1];
  const n = parseInt(v[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function mixRgb(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Deterministic [0, 1) stream (the lite's own seed; Unity's particle seeds are per-burst and not reproduced). */
export function makeRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s & 0xffffff) / 16777216; };
}
