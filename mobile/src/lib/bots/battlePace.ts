/** Local presentation clock and cue queue. No combat state, timers, networking, or random numbers. */
export type PresentationAcceptance = 'accepted' | 'backpressure' | 'skipped';
export type FightKind = 'light' | 'heavy' | 'special' | 'guard';
export type FightPhase = 'windup' | 'contact' | 'recover';
export type FightClipTiming = { duration: number; contact: number | null; speed: number };
export type FightTiming = { windupMs: number; stopMs: number; recoveryMs: number; contactSeconds: number; sourceSpeed: number; duration: number; lungeM: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** DamageFrame / state speed is authoritative for the visible contact. Unity's warp is clamped to 0.5–2x. */
export function fightTiming(kind: FightKind, clip: FightClipTiming, hit: boolean): FightTiming {
  const duration = Math.max(.001, clip.duration);
  const sourceSpeed = Math.max(.001, clip.speed);
  const contactSeconds = clamp(clip.contact ?? duration * .5, 0, duration);
  const desired = kind === 'light' ? 1 / 3 : .5;
  const warp = clamp(contactSeconds / sourceSpeed / desired, .5, 2);
  return {
    windupMs: kind === 'guard' ? 0 : contactSeconds / sourceSpeed / warp * 1000,
    stopMs: hit ? kind === 'special' ? 100 : kind === 'heavy' ? 67 : 33 : 0,
    recoveryMs: kind === 'guard' ? 400 : kind === 'special' ? 2000 / 3 : kind === 'heavy' ? 1400 / 3 : 800 / 3,
    contactSeconds, sourceSpeed: kind === 'guard' ? 0 : sourceSpeed, duration,
    lungeM: kind === 'guard' ? 0 : kind === 'special' ? .5 : kind === 'heavy' ? .3 : .15,
  };
}
export type TimedCue = { id: string; timing: FightTiming };
export type PaceEvent<T> = { type: 'start' | 'contact' | 'finish' | 'cancel'; cue: T };
export type PaceSample<T> = { cue: T; phase: FightPhase; clipSeconds: number; lungeM: number };
type Running<T> = { cue: T; start: number; contact: number | null };
const ease = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

/** FIFO bounded at 32 accepted cues. Overflow is explicit (false), never a silent drop or a combat delay.
 * Call advance only with foreground-active elapsed time. Contact is held from the actual rendered frame,
 * so a slow frame cannot skip the short hit-stop. Dedupe is generation-scoped and bounded at 256 IDs.
 */
export class BattlePaceQueue<T extends TimedCue> {
  private pending: T[] = [];
  private seen = new Set<string>();
  private running: Running<T> | null = null;
  clockMs = 0;
  enqueue(cue: T): boolean {
    if (this.seen.has(cue.id)) return false;
    if (this.pending.length + (this.running ? 1 : 0) >= 32) return false;
    this.seen.add(cue.id);
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    this.pending.push(cue);
    return true;
  }
  get idle(): boolean { return this.pending.length === 0 && this.running === null; }
  reset(): void { this.pending = []; this.running = null; this.seen.clear(); this.clockMs = 0; }
  advance(elapsedMs: number, canStart: (cue: T) => boolean = () => true): PaceEvent<T>[] {
    this.clockMs += Math.max(0, Math.min(1000, Number.isFinite(elapsedMs) ? elapsedMs : 0));
    const events: PaceEvent<T>[] = [];
    while (!this.running && this.pending.length) {
      const cue = this.pending.shift()!;
      if (!canStart(cue)) { events.push({ type: 'cancel', cue }); continue; }
      this.running = { cue, start: this.clockMs, contact: null };
      events.push({ type: 'start', cue });
    }
    const run = this.running;
    if (!run) return events;
    if (run.contact === null && this.clockMs - run.start >= run.cue.timing.windupMs) {
      run.contact = this.clockMs; events.push({ type: 'contact', cue: run.cue });
    }
    if (run.contact !== null && this.clockMs - run.contact >= run.cue.timing.stopMs + run.cue.timing.recoveryMs) {
      events.push({ type: 'finish', cue: run.cue }); this.running = null;
    }
    return events;
  }
  sample(): PaceSample<T> | null {
    const run = this.running;
    if (!run) return null;
    const timing = run.cue.timing;
    if (run.contact === null) {
      const fraction = timing.windupMs ? clamp((this.clockMs - run.start) / timing.windupMs, 0, 1) : 1;
      return { cue: run.cue, phase: 'windup', clipSeconds: timing.contactSeconds * fraction, lungeM: timing.lungeM * ease(fraction) };
    }
    const after = this.clockMs - run.contact;
    if (after <= timing.stopMs) return { cue: run.cue, phase: 'contact', clipSeconds: timing.contactSeconds, lungeM: timing.lungeM };
    const recovery = after - timing.stopMs;
    return { cue: run.cue, phase: 'recover', clipSeconds: Math.min(timing.duration, timing.contactSeconds + recovery / 1000 * timing.sourceSpeed), lungeM: timing.lungeM * (1 - ease(recovery / timing.recoveryMs)) };
  }
}

/** The source history is already retained by the caller. Keep completion IDs for that battle generation,
 * rather than evicting old IDs and accidentally replaying a long history. A full stage queue leaves a tail
 * unconsumed; the view calls consume again on its drain notification, even without a new host reply.
 */
export class PresentationCursor<T extends { id: string }> {
  private key: string | null = null;
  private completed = new Set<string>();
  hasPending(rows: readonly T[]): boolean { return rows.some(row => !this.completed.has(row.id)); }
  consume(key: string, rows: readonly T[], ready: boolean, accept: (row: T) => boolean | PresentationAcceptance): number {
    if (key !== this.key) { this.key = key; this.completed.clear(); ready = false; }
    if (!ready) { for (const row of rows) this.completed.add(row.id); return 0; }
    let count = 0;
    for (const row of rows) {
      if (this.completed.has(row.id)) continue;
      const result = accept(row);
      if (result === false || result === 'backpressure') break;
      this.completed.add(row.id); count++;
    }
    return count;
  }
}
