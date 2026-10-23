import { collapse, FightInput, FightProfile, FightSkill, idleInput, NO_PICK, Press } from './contracts';
import { FightBrainDriver, FightView } from './brain';
import { FightCore, FightEvent } from './core';
import { FightAttrRules, FightChaseRules, FightRules, rulesHash } from './rules';
import { WitnessJson } from './witness';

/** One side's driver: a replayed/scripted input source, or an in-core brain (FightDriver). */
export type FightInputs = { read(tick: number, side: number): FightInput };
export type FightDriver = { inputs: FightInputs } | { brain: FightBrainDriver; profile: FightProfile | null; skill: FightSkill | null };

export type FightRunOptions = {
  /** Every tick's full state hash (parity / diff); off = only the ticks in `hashAt` (+ the final). */
  tickHashes?: boolean;
  /** Ticks whose full state hash is kept when tickHashes is off (the duel-inputs-2 sample ticks). */
  hashAt?: (tick: number) => boolean;
  /** Stop after this many ticks even if the fight is still running (a short log; the caller rejects). */
  maxTicks?: number;
  /** Called after every tick with the tick and the side-1 (or side-0) input the brain produced (CPU stream check). */
  onTick?: (tick: number, inputs: [FightInput, FightInput]) => void;
  recordEvents?: boolean;
  /** duel-rules-4: the issued chase block (null / absent = duel-rules-3, today's core). rulesHash is then duel-rules-4's. */
  chase?: FightChaseRules | null;
  /** duel-rules-5: the issued attrs block (needs `chase`; null / absent = duel-rules-3/-4). rulesHash is then duel-rules-5's. */
  attrs?: FightAttrRules | null;
};

export type FightResult = {
  rulesHash: string; initialHash: string; finalHash: string;
  /** tick -> full state hash: every tick when tickHashes, else only the requested sample ticks. */
  tickHashes: Map<number, string>;
  winner: number; endTick: number; reason: string; ended: boolean;
  witness: WitnessJson; events: FightEvent[]; core: FightCore;
};

function read(d: FightDriver, view: FightView, core: FightCore, t: number, s: number): FightInput {
  if ('brain' in d) return d.brain.decide(view, core.rng[s]);
  return d.inputs.read(t, s);
}

/** FightRunner.Run: per tick, side 0 then side 1 produce inputs (brains see the end of the previous tick), then Step. */
export function runFight(rules: FightRules, seed: string, d0: FightDriver, d1: FightDriver, opts: FightRunOptions = {}): FightResult {
  const core = new FightCore(rules, seed, opts.chase ?? null, opts.attrs ?? null);
  core.recordEvents = opts.recordEvents !== false;
  const res = { rulesHash: rulesHash(core.rules, core.chase, core.attrs), initialHash: core.stateHash(), tickHashes: new Map<number, string>() } as FightResult;
  const drivers = [d0, d1];
  const views = [new FightView(core, 0), new FightView(core, 1)];
  for (let s = 0; s < 2; s++) { const d = drivers[s]; if ('brain' in d) d.brain.begin(s, d.profile, d.skill); }
  const cap = opts.maxTicks ?? Number.MAX_SAFE_INTEGER;
  while (!core.ended && core.tick + 1 < cap) {
    const t = core.tick + 1;
    const a = read(drivers[0], views[0], core, t, 0);
    const b = read(drivers[1], views[1], core, t, 1);
    core.step(a, b);
    opts.onTick?.(t, [a, b]);
    if (opts.tickHashes || opts.hashAt?.(t)) res.tickHashes.set(t, core.stateHash());
  }
  res.finalHash = res.tickHashes.get(core.tick) ?? core.stateHash();
  res.winner = core.winner; res.reason = core.endReason; res.endTick = core.tick; res.ended = core.ended;
  res.witness = core.witness.toJson(); res.events = core.events; res.core = core;
  return res;
}

/** Fixture key (Schemas/fixtures/duel-sim-3 `script`): {t, s, move?, guard?, press?, step?, tier?, deploy?, target?}. */
export type ScriptKey = { t: number; s: number; move?: [number, number]; guard?: boolean; press?: string; step?: [number, number]; tier?: number; deploy?: number; target?: number };

const PRESS_BY_NAME: Record<string, number> = { light: Press.Light, heavy: Press.Heavy, special: Press.Special, feint: Press.Feint, step: Press.Step, shove: Press.Shove, disengage: Press.Disengage, doubletap: Press.DoubleTap };

/** FightScript: held values fold from every key at or before the tick; presses/picks only from keys AT the tick. */
export class FightScript implements FightInputs {
  private readonly list: { t: number; s: number; hasMove: boolean; mx: number; mz: number; hasGuard: boolean; guard: boolean; press: number; sx: number; sz: number; tier: number; deploy: number; target: number }[] = [];

  static fromJson(keys: ScriptKey[]): FightScript {
    const sc = new FightScript();
    for (const k of keys) sc.add(k);
    return sc;
  }
  add(k: ScriptKey): this {
    const key = { t: k.t, s: k.s, hasMove: false, mx: 0, mz: 0, hasGuard: false, guard: false, press: Press.None as number, sx: 0, sz: 0, tier: 0, deploy: NO_PICK, target: NO_PICK };
    if (k.deploy !== undefined) key.deploy = k.deploy;
    if (k.target !== undefined) key.target = k.target;
    if (Array.isArray(k.move)) { key.hasMove = true; key.mx = k.move[0]; key.mz = k.move[1]; }
    if (k.guard !== undefined) { key.hasGuard = true; key.guard = k.guard; }
    if (k.press !== undefined) { const p = PRESS_BY_NAME[k.press]; if (p === undefined) throw new RangeError('invalid_press ' + k.press); key.press = p; }
    if (Array.isArray(k.step)) { key.sx = k.step[0]; key.sz = k.step[1]; }
    if (k.tier !== undefined) key.tier = k.tier;
    if (key.t < 0 || key.s < 0 || key.s > 1) throw new RangeError('invalid_key');
    let at = this.list.length;
    while (at > 0 && (this.list[at - 1].t > key.t || (this.list[at - 1].t === key.t && this.list[at - 1].s > key.s))) at--;
    this.list.splice(at, 0, key);
    return this;
  }
  read(tick: number, side: number): FightInput {
    const inp = idleInput();
    for (const k of this.list) {
      if (k.t > tick) break;
      if (k.s !== side) continue;
      if (k.hasMove) { inp.moveX = k.mx; inp.moveZ = k.mz; }
      if (k.hasGuard) inp.guard = k.guard;
      if (k.t === tick && k.press !== Press.None && collapse(inp.press, k.press as never) === k.press) {
        inp.press = k.press as never; inp.stepX = k.sx; inp.stepZ = k.sz; inp.specialTier = k.tier;
      }
      if (k.t === tick && k.deploy !== NO_PICK) inp.deploy = k.deploy;
      if (k.t === tick && k.target !== NO_PICK) inp.target = k.target;
    }
    return inp;
  }
}
