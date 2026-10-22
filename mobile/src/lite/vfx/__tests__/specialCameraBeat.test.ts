import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isSpecialCue, restartSpecialBeat, SPECIAL_CAMERA, specialCameraPose, specialCameraWeight, specialEffectDurationS } from '../specialCameraBeat';

/** lite-2305-1 (DECISIONS #72.63): the special camera beat on the portrait duel stage. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), 'utf8');
const HOME = { y: 0.9, z: 4, aimY: 0.9, fovDeg: 2 * Math.atan(17.5 / 35) * 180 / Math.PI };

describe('special camera beat', () => {
  it('runs only on the SKY / BREAK specials of a kit in the pack', () => {
    expect(isSpecialCue({ kit: 'ace', effect: 'sky_launch' })).toBe(true);
    expect(isSpecialCue({ kit: 'ace', effect: 'break_heavy' })).toBe(true);
    for (const effect of ['impactAccent', 'intercept', 'guard']) expect(isSpecialCue({ kit: 'ace', effect })).toBe(false);
    expect(isSpecialCue({ kit: null, effect: 'sky_launch' })).toBe(false);
  });
  it('holds for the effect duration the manifest schedules (ACE SKY: residue 0.25 + 3.0 s after the 0.3 s contact)', () => {
    expect(specialEffectDurationS('ace', 'sky_launch', ['windup', 'landing'], 0.3)).toBeCloseTo(3.55, 6);
    const breakS = specialEffectDurationS('ace', 'break_heavy', ['windup', 'landing'], 0.3)!;
    expect(breakS).toBeGreaterThan(0.3);
    // A whiff plays the wind-up only: shorter than the hit.
    expect(specialEffectDurationS('ace', 'break_heavy', ['windup'], 0.3)!).toBeLessThan(breakS);
    expect(specialEffectDurationS('hare', 'sky_launch', ['landing'], 0.3)).toBeNull();
    // Known-bad arm: a layer with a longer life moves the hold.
    const kits = { x: { effects: { sky_launch: { layers: [{ type: 'residue', at: 'landing', lite: 'play', delay: 0.25, params: { life: 5 } }, { type: 'flash', at: 'landing', lite: 'skip', params: { life: 99 } }] } } } };
    expect(specialEffectDurationS('x', 'sky_launch', ['landing'], 0.3, kits)).toBeCloseTo(5.55, 6);
  });
  it('eases in over 0.25 s, holds, eases out over 0.4 s, and is exactly home outside the beat', () => {
    expect(SPECIAL_CAMERA.easeInS).toBe(0.25); expect(SPECIAL_CAMERA.easeOutS).toBe(0.4);
    expect(specialCameraWeight(9.99, 10, 13)).toBe(0);
    expect(specialCameraWeight(10.125, 10, 13)).toBeCloseTo(0.5, 6);
    expect(specialCameraWeight(10.25, 10, 13)).toBe(1);
    expect(specialCameraWeight(13, 10, 13)).toBe(1);
    expect(specialCameraWeight(13.2, 10, 13)).toBeCloseTo(0.5, 6);
    expect(specialCameraWeight(13.4, 10, 13)).toBe(0);
    expect(specialCameraPose(0, HOME)).toEqual(HOME);
    const wide = specialCameraPose(1, HOME);
    expect(wide.z).toBeGreaterThan(HOME.z); expect(wide.fovDeg).toBeGreaterThan(HOME.fovDeg); expect(wide.aimY).toBeLessThan(HOME.aimY);
  });
  it('a second special mid-beat continues from the current weight (no snap) and extends the hold', () => {
    const first = { startS: 10, holdEndS: 13 };
    const at = 13.1, before = specialCameraWeight(at, first.startS, first.holdEndS);
    const next = restartSpecialBeat(at, first, 3.55);
    expect(specialCameraWeight(at, next.startS, next.holdEndS)).toBeCloseTo(before, 4);
    expect(next.holdEndS).toBeCloseTo(at + 3.55, 6);
  });
  it('the wide pose brings the target floor above the command block in portrait (SKY rings)', () => {
    // Project the rival's feet (portrait staging) at the home and wide poses: 1206 x 2622 view, aim along the y-z plane.
    const feetFrac = (pose: { y: number; z: number; aimY: number; fovDeg: number }) => {
      const p = [0, -pose.y, -0.748 - pose.z], f = [0, pose.aimY - pose.y, -pose.z], n = Math.hypot(f[1], f[2]);
      const fw = [0, f[1] / n, f[2] / n], up = [0, -fw[2], fw[1]];
      const d = p[1] * fw[1] + p[2] * fw[2], v = p[1] * up[1] + p[2] * up[2];
      return 0.5 - v / d / Math.tan(pose.fovDeg * Math.PI / 360) / 2;
    };
    expect(feetFrac(HOME)).toBeCloseTo(0.69, 2);        // today: under the command block (top ≈ 0.54)
    expect(feetFrac(specialCameraPose(1, HOME))).toBeLessThan(0.52);
  });
  it('wiring: BotStage starts the beat only for a played special, and LiveDuelStage passes it (default on)', () => {
    const stage = read('../../components/bots/BotStage.tsx');
    expect(stage).toContain('played && specialCameraRef.current && isSpecialCue(cue)');
    expect(stage).toContain('specialCamera = false');
    const live = read('../../components/duel/LiveDuelStage.tsx');
    expect(live).toContain('specialCamera = true');
    expect(live).toContain('specialCamera={specialCamera}');
  });
});
