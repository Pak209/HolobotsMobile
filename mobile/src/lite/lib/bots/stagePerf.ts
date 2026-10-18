/** Dev-only 3D stage cost knobs and their measurement summary.
 * Presentation cost only: nothing here reads or changes duel outcomes.
 * Production BotStage never receives knobs; `PRODUCTION_KNOBS` documents what it does today.
 */
export type StagePerfKnobs = {
  /** expo-gl iOS default-framebuffer sample request. Production requests 1. */
  msaaSamples: 0 | 1;
  /** Multiplier on BotStage's clamped render scale. 0.5 halves both drawing-buffer axes. */
  resolution: 1 | 0.5;
  /** Mixer update cap in Hz. 0 updates on every rendered frame, as production does. */
  animHz: 0 | 30;
  /** Forces renderer.shadowMap off. Production never enables it, so this arm is a null control. */
  shadowsOff: boolean;
  /** BotStage has no post pass to skip. Null control: no code path changes. */
  postOff: boolean;
  /** Measurement only: FrontSide culling on the bot materials, which are authored double-sided. Changes the look. */
  cullBack: boolean;
  /** Measurement only: hides the rival actor, a triangle-count probe. Not a LOD; no decimated GLB exists. */
  hideRival: boolean;
};

export const PRODUCTION_KNOBS: StagePerfKnobs = { msaaSamples: 1, resolution: 1, animHz: 0, shadowsOff: false, postOff: false, cullBack: false, hideRival: false };

export type PerfArm = { id: string; knobs: StagePerfKnobs; cues: 'hold' | 'run'; note: string };

const arm = (id: string, change: Partial<StagePerfKnobs>, note: string, cues: PerfArm['cues'] = 'hold'): PerfArm => ({ id, knobs: { ...PRODUCTION_KNOBS, ...change }, cues, note });
const SHIPPABLE: Partial<StagePerfKnobs> = { msaaSamples: 0, resolution: 0.5, animHz: 30 };

/** Baseline first and again near the end, so drift across context reloads is visible. */
export const PERF_SWEEP_ARMS: readonly PerfArm[] = [
  arm('baseline', {}, 'production knobs'),
  arm('shadowOff', { shadowsOff: true }, 'null control: shadowMap already off'),
  arm('postOff', { postOff: true }, 'null control: no post pass exists'),
  arm('msaa0', { msaaSamples: 0 }, 'msaaSamples 1 -> 0'),
  arm('halfRes', { resolution: 0.5 }, 'drawing buffer 1/2 per axis'),
  arm('anim30', { animHz: 30 }, 'mixer capped at 30 Hz'),
  arm('cullBack', { cullBack: true }, 'measurement only, look-changing'),
  arm('combo', SHIPPABLE, 'msaa0 + halfRes + anim30'),
  arm('comboHideRival', { ...SHIPPABLE, hideRival: true }, 'combo with WOLF hidden (triangle probe)'),
  arm('baselineEnd', {}, 'drift control'),
  arm('baselineLive', {}, 'production knobs, cue runner running', 'run'),
];

export const PERF_ARM_WARMUP_MS = 1000;
export const PERF_ARM_MEASURE_MS = 5000;

export function knobSignature(knobs: StagePerfKnobs): string {
  return `m${knobs.msaaSamples}r${knobs.resolution}a${knobs.animHz}s${+knobs.shadowsOff}p${+knobs.postOff}c${+knobs.cullBack}h${+knobs.hideRival}`;
}

/** One completed frame: timestamps are taken after the native completion barrier. */
export type PerfFrame = { atMs: number; prepMs: number; renderMs: number; barrierMs: number; drawCalls: number; triangles: number; glCalls: number };

export type PerfArmSummary = {
  frames: number; windowMs: number; fps: number;
  fps1s: { median: number; min: number; max: number; count: number };
  prepMs: number; renderMs: number; barrierMs: number; frameMs: number;
  drawCalls: number[]; triangles: number[]; glCallsPerFrame: number;
};

const round = (value: number, places = 3) => { const k = 10 ** places; return Math.round(value * k) / k; };
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Completed frames in [startMs, endMs), with whole one-second sub-windows for spread. */
export function summarizeArm(frames: readonly PerfFrame[], startMs: number, endMs: number): PerfArmSummary {
  const inWindow = frames.filter(frame => frame.atMs >= startMs && frame.atMs < endMs);
  const windowMs = endMs - startMs;
  const perSecond: number[] = [];
  for (let at = startMs; at + 1000 <= endMs; at += 1000) perSecond.push(inWindow.filter(frame => frame.atMs >= at && frame.atMs < at + 1000).length);
  const prep = inWindow.map(frame => frame.prepMs), render = inWindow.map(frame => frame.renderMs), barrier = inWindow.map(frame => frame.barrierMs);
  return {
    frames: inWindow.length, windowMs: round(windowMs, 1), fps: windowMs > 0 ? round(inWindow.length * 1000 / windowMs, 2) : 0,
    fps1s: { median: median(perSecond), min: perSecond.length ? Math.min(...perSecond) : 0, max: perSecond.length ? Math.max(...perSecond) : 0, count: perSecond.length },
    prepMs: round(mean(prep)), renderMs: round(mean(render)), barrierMs: round(mean(barrier)), frameMs: round(mean(prep) + mean(render) + mean(barrier)),
    drawCalls: [...new Set(inWindow.map(frame => frame.drawCalls))].sort((a, b) => a - b),
    triangles: [...new Set(inWindow.map(frame => frame.triangles))].sort((a, b) => a - b),
    glCallsPerFrame: round(mean(inWindow.map(frame => frame.glCalls)), 1),
  };
}

/** Mixer cap. Returns the delta to apply this frame, or null to skip the update. */
export function throttledMixerStep(pendingMs: number, elapsedMs: number, animHz: number): { applyMs: number | null; pendingMs: number } {
  const total = pendingMs + elapsedMs;
  if (!animHz) return { applyMs: total, pendingMs: 0 };
  return total + 1e-6 >= 1000 / animHz ? { applyMs: total, pendingMs: 0 } : { applyMs: null, pendingMs: total };
}
