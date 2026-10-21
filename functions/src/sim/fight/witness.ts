import { EventKind, FightEventKind, FightOutcome, Outcome } from './contracts';

/**
 * Pure witness instruments (FightWitness.cs): exchange histogram, time-in-state, stamina samples, break counts/lengths,
 * per-side event counts. Measurements only; a function of the hashed state stream, so host and client agree.
 */
export const STAMINA_SAMPLE_TICKS = 15;
export const HISTOGRAM_EDGES_TICKS = [30, 60, 90, 120, 150, 180, 210];

export type WitnessSideJson = {
  ticksInState: number[]; forcedBreaks: number; voluntaryBreaks: number; lineCrossings: number; breakLengths: number[];
  telegraphs: number; feints: number; feintBaits: number; steps: number; shoves: number; hits: number; blocks: number;
  perfectGuards: number; guardBreaks: number; whiffs: number; evades: number; counters: number; hardHits: number;
  swaps: number; forcedSwaps: number; stamina: number[];
};
export type WitnessJson = {
  ticks: number; exchangeLengths: number[]; exchangeHistogram1s: number[]; exchangesIn2To5Pm: number; exchangeMedianTicks: number;
  probeLengths: number[]; trades: number; railFires: number; sides: WitnessSideJson[];
};

const two = () => [0, 0];

export class FightWitness {
  exchangeLengths: number[] = [];
  probeLengths: number[] = [];
  exchangeHistogram = new Array(HISTOGRAM_EDGES_TICKS.length + 1).fill(0);
  ticksInState = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
  stamina: number[][] = [[], []];
  breakLengths: number[][] = [[], []];
  forcedBreaks = two(); voluntaryBreaks = two(); lineCrossings = two();
  telegraphs = two(); feints = two(); feintBaits = two(); steps = two(); shoves = two();
  hits = two(); blocks = two(); perfectGuards = two(); guardBreaks = two(); whiffs = two(); evades = two();
  counters = two(); hardHits = two(); swaps = two(); forcedSwaps = two();
  trades = 0; railFires = 0; ticks = 0;
  private lastSta = [-1, -1];

  count(s: number, k: FightEventKind, trade = false): void {
    if (trade) { this.trades++; return; }
    switch (k) {
      case EventKind.Telegraph: this.telegraphs[s]++; break;
      case EventKind.Feint: this.feints[s]++; break;
      case EventKind.FeintBait: this.feintBaits[s]++; break;
      case EventKind.Step: this.steps[s]++; break;
      case EventKind.Shove: this.shoves[s]++; break;
      case EventKind.HardHit: this.hardHits[s]++; break;
    }
  }
  contact(s: number, o: FightOutcome, counter: boolean): void {
    switch (o) {
      case Outcome.Hit: this.hits[s]++; break;
      case Outcome.Blocked: this.blocks[s]++; break;
      case Outcome.Perfect: this.perfectGuards[1 - s]++; break;
      case Outcome.GuardBreak: this.guardBreaks[s]++; break;
      case Outcome.Whiffed: this.whiffs[s]++; break;
      case Outcome.Evaded: this.evades[1 - s]++; break;
    }
    if (counter && (o === Outcome.Hit || o === Outcome.GuardBreak)) this.counters[s]++;
  }
  breakStarted(s: number, forced: boolean): void { if (forced) this.forcedBreaks[s]++; else this.voluntaryBreaks[s]++; }
  breakEnded(s: number, len: number): void { this.breakLengths[s].push(len); }
  exchangeEnded(len: number): void {
    this.exchangeLengths.push(len);
    let b = 0; while (b < HISTOGRAM_EDGES_TICKS.length && len >= HISTOGRAM_EDGES_TICKS[b]) b++;
    this.exchangeHistogram[b]++;
  }
  probeEnded(len: number): void { this.probeLengths.push(len); }
  railFired(): void { this.railFires++; }
  swapped(s: number, forced: boolean): void { if (forced) this.forcedSwaps[s]++; else this.swaps[s]++; }
  sample(state: number, sta: number, breakLinePm: number, s: number, t: number): void {
    this.ticksInState[s][state]++;
    if (s === 1) this.ticks++;
    if (this.lastSta[s] >= breakLinePm && sta < breakLinePm) this.lineCrossings[s]++;
    this.lastSta[s] = sta;
    if (t % STAMINA_SAMPLE_TICKS === 0) this.stamina[s].push(sta);
  }

  exchangesIn2To5Pm(): number {
    if (this.exchangeLengths.length === 0) return 0;
    let n = 0; for (const l of this.exchangeLengths) if (l >= 60 && l <= 150) n++;
    return Math.trunc(n * 1000 / this.exchangeLengths.length);
  }
  static median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const a = [...xs].sort((x, y) => x - y); return a[Math.trunc(a.length / 2)];
  }

  toJson(): WitnessJson {
    const sides: WitnessSideJson[] = [0, 1].map(s => ({
      ticksInState: [...this.ticksInState[s]], forcedBreaks: this.forcedBreaks[s], voluntaryBreaks: this.voluntaryBreaks[s],
      lineCrossings: this.lineCrossings[s], breakLengths: [...this.breakLengths[s]], telegraphs: this.telegraphs[s], feints: this.feints[s],
      feintBaits: this.feintBaits[s], steps: this.steps[s], shoves: this.shoves[s], hits: this.hits[s], blocks: this.blocks[s],
      perfectGuards: this.perfectGuards[s], guardBreaks: this.guardBreaks[s], whiffs: this.whiffs[s], evades: this.evades[s],
      counters: this.counters[s], hardHits: this.hardHits[s], swaps: this.swaps[s], forcedSwaps: this.forcedSwaps[s], stamina: [...this.stamina[s]],
    }));
    return {
      ticks: this.ticks, exchangeLengths: [...this.exchangeLengths], exchangeHistogram1s: [...this.exchangeHistogram],
      exchangesIn2To5Pm: this.exchangesIn2To5Pm(), exchangeMedianTicks: FightWitness.median(this.exchangeLengths),
      probeLengths: [...this.probeLengths], trades: this.trades, railFires: this.railFires, sides,
    };
  }
}
