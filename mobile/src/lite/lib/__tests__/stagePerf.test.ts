import { describe, expect, it } from 'vitest';
import { PERF_SWEEP_ARMS, PRODUCTION_KNOBS, knobSignature, summarizeArm, throttledMixerStep, type PerfFrame } from '../bots/stagePerf';

const frame = (atMs: number, extra: Partial<PerfFrame> = {}): PerfFrame => ({ atMs, prepMs: 0.3, renderMs: 0.6, barrierMs: 120, drawCalls: 2, triangles: 56250, glCalls: 90, ...extra });

describe('stage perf knobs', () => {
  it('documents production as the default and gives every arm a unique signature', () => {
    expect(PRODUCTION_KNOBS).toEqual({ msaaSamples: 1, resolution: 1, animHz: 0, shadowsOff: false, postOff: false, cullBack: false, hideRival: false });
    const ids = PERF_SWEEP_ARMS.map(arm => arm.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PERF_SWEEP_ARMS[0]).toMatchObject({ id: 'baseline', knobs: PRODUCTION_KNOBS, cues: 'hold' });
    expect(PERF_SWEEP_ARMS.find(arm => arm.id === 'baselineEnd')?.knobs).toEqual(PRODUCTION_KNOBS);
  });
  it('changes exactly one knob in each single-knob arm', () => {
    for (const id of ['shadowOff', 'postOff', 'msaa0', 'halfRes', 'anim30', 'cullBack']) {
      const knobs = PERF_SWEEP_ARMS.find(arm => arm.id === id)!.knobs;
      const changed = Object.keys(knobs).filter(key => knobs[key as keyof typeof knobs] !== PRODUCTION_KNOBS[key as keyof typeof knobs]);
      expect(changed, id).toHaveLength(1);
    }
  });
  it('encodes every knob in the signature', () => {
    expect(knobSignature(PRODUCTION_KNOBS)).toBe('m1r1a0s0p0c0h0');
    expect(knobSignature({ ...PRODUCTION_KNOBS, msaaSamples: 0, resolution: 0.5, hideRival: true })).toBe('m0r0.5a0s0p0c0h1');
  });
});

describe('summarizeArm', () => {
  it('counts completed frames inside the half-open window only', () => {
    const frames = [frame(999), ...Array.from({ length: 40 }, (_, i) => frame(1000 + i * 125)), frame(6000)];
    const summary = summarizeArm(frames, 1000, 6000);
    expect(summary.frames).toBe(40);
    expect(summary.fps).toBe(8);
    expect(summary.fps1s).toEqual({ median: 8, min: 8, max: 8, count: 5 });
    expect(summary.drawCalls).toEqual([2]);
    expect(summary.frameMs).toBeCloseTo(120.9, 3);
  });
  it('reports zero rather than NaN for an empty window', () => {
    expect(summarizeArm([], 0, 5000)).toMatchObject({ frames: 0, fps: 0, prepMs: 0, glCallsPerFrame: 0, fps1s: { median: 0, count: 5 } });
  });
});

describe('throttledMixerStep', () => {
  it('passes every frame through when uncapped', () => {
    expect(throttledMixerStep(0, 16.7, 0)).toEqual({ applyMs: 16.7, pendingMs: 0 });
  });
  it('accumulates below the cap and applies the whole accumulated delta at it', () => {
    const first = throttledMixerStep(0, 16.7, 30);
    expect(first).toEqual({ applyMs: null, pendingMs: 16.7 });
    const second = throttledMixerStep(first.pendingMs, 16.7, 30);
    expect(second.applyMs).toBeCloseTo(33.4, 6);
    expect(second.pendingMs).toBe(0);
  });
  it('is a no-op cap when frames are already slower than 30 Hz', () => {
    expect(throttledMixerStep(0, 130, 30)).toEqual({ applyMs: 130, pendingMs: 0 });
  });
});
