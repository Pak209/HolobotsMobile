import manifest from '../../../assets/vfx/pack_manifest.json';
import type { LiveDuelVfxCue } from './liveDuelVfx';

/** lite-2305-1 (DECISIONS #72.63): the "special" camera beat on the portrait duel stage. Pure (no three, no RN).
 * On a signature / BREAK-class special (the lite's FINISHER = SKYBREAKER `sky_launch`, HEAVY = BREAK `break_heavy`) the
 * stage camera pulls back, rises and widens so the caster, the target and the effect's ground rings / residue sit above the
 * command block for the effect's own duration (read from the pack manifest), then eases back. Presentation only: it reads
 * the cue the stage already plays and never touches combat timing, damage or outcomes. */
export const SPECIAL_EFFECTS: readonly string[] = ['sky_launch', 'break_heavy'];

/** Authored numbers (Pak judges). Home = the portrait duel camera: (0, 0.9, 4) looking at (0, 0.9, 0), 35 mm (53.13° v-FOV). */
export const SPECIAL_CAMERA = {
  easeInS: 0.25,
  easeOutS: 0.4,
  /** Dolly back along +z (m). */
  dollyM: 1.6,
  /** Camera rise (m). */
  liftM: 0.7,
  /** The aim point drops by this much (m): the floor, where the rings land, comes up out from under the HUD. */
  aimDropM: 0.75,
  /** Vertical FOV at the full beat (degrees). */
  fovDeg: 62,
} as const;

type Layer = { type: string; at?: string; delay?: number; lite?: string; params?: { life?: number | number[]; lead?: number; fade?: number }; spec?: { elementLife?: number; stagger?: number; count?: number } };
type Kits = Record<string, { effects: Record<string, { layers: Layer[] }> }>;

export function isSpecialCue(cue: Pick<LiveDuelVfxCue, 'effect' | 'kit'>): boolean {
  return cue.kit !== null && SPECIAL_EFFECTS.includes(cue.effect);
}

/** Seconds from the cue's fire to the end of its last played layer, for the phases it plays (landing layers start at
 * impactS), exactly as the VFX player schedules them; null when the kit / effect is not in the pack. */
export function specialEffectDurationS(kit: string | null, effect: string, phases: readonly ('windup' | 'landing')[], impactS: number, kits: Kits = manifest.kits as unknown as Kits): number | null {
  const layers = kit ? kits[kit]?.effects[effect]?.layers : undefined;
  if (!layers) return null;
  let end = 0;
  for (const layer of layers) {
    if (layer.lite !== 'play') continue;
    const phase = layer.at === 'landing' ? 'landing' : 'windup';
    if (!phases.includes(phase)) continue;
    const t0 = (phase === 'landing' ? Math.max(0, impactS) : 0) + (layer.delay ?? 0);
    const q = layer.params ?? {}, e = layer.spec ?? {};
    let life: number;
    if (layer.type === 'element') life = (e.elementLife ?? 0.9) + Math.max(0, Math.min(8, e.count ?? 1) - 1) * (e.stagger ?? 0);
    else if (layer.type === 'skyColumn') life = (q.fade ?? 0);   // fired `lead` s before the contact; it ends `fade` after
    else life = Array.isArray(q.life) ? Math.max(...q.life) : q.life ?? 0.7;
    end = Math.max(end, t0 + life);
  }
  return end;
}

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** The beat's weight (0 = home, 1 = full pull-back) at `nowS` for a beat started at `startS` whose hold ends at `holdEndS`:
 * eased in over easeInS from the start, held, eased out over easeOutS after holdEndS. */
export function specialCameraWeight(nowS: number, startS: number, holdEndS: number, timing: { easeInS: number; easeOutS: number } = SPECIAL_CAMERA): number {
  if (!(nowS >= startS)) return 0;
  const easeIn = smooth((nowS - startS) / timing.easeInS);
  if (nowS <= holdEndS) return easeIn;
  return easeIn * (1 - smooth((nowS - holdEndS) / timing.easeOutS));
}

/** A new special during a running beat continues from the current weight (no snap): the start moves back so the ease-in
 * resumes at that weight, and the hold extends to the later end. */
export function restartSpecialBeat(nowS: number, current: { startS: number; holdEndS: number } | null, durationS: number): { startS: number; holdEndS: number } {
  const w = current ? specialCameraWeight(nowS, current.startS, current.holdEndS) : 0;
  // Invert the smoothstep (monotone on [0, 1]) by bisection; cheap and allocation-free.
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (smooth(mid) < w) lo = mid; else hi = mid; }
  return { startS: nowS - lo * SPECIAL_CAMERA.easeInS, holdEndS: Math.max(nowS + durationS, current?.holdEndS ?? -Infinity) };
}

/** The portrait camera pose at weight w (home at w = 0, exactly today's pose). */
export function specialCameraPose(w: number, home: { y: number; z: number; aimY: number; fovDeg: number }) {
  return { y: home.y + SPECIAL_CAMERA.liftM * w, z: home.z + SPECIAL_CAMERA.dollyM * w, aimY: home.aimY - SPECIAL_CAMERA.aimDropM * w, fovDeg: home.fovDeg + (SPECIAL_CAMERA.fovDeg - home.fovDeg) * w };
}
