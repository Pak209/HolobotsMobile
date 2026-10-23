import {
  Action, ChaseEnd, checkInput, Deny, EVENT_NAMES, EventKind, FightAction, FightEventKind, FightFighterView, FightGuard, FightInput, FightLoco, FightMove,
  FightOutcome, FightPress, FightRng, FightState, Guard, Loco, Move, MOVE_NAMES, NO_PICK, Outcome, OUTCOME_NAMES, Press, State,
} from './contracts';
import { clamp, dist, div, hex, Int32Writer, mulDiv, rngSeedWord, seedBytes, sha256 } from './math';
import { CHASE_KEYS, cloneRules, FightChaseRules, FightFighterDef, FightRules, rosterOf, rulesHashBytes, validateChaseRules, validateRules } from './rules';
import { FightWitness } from './witness';

/**
 * duel-sim-3 fight core, a line-for-line port of HolobotsUnity `Sim/Fight/FightCore.cs` (fight-core-1 + fight-tune-1 r2 + fight-tune-2 r3
 * + fight-chase-1 #72.65 behind a duel-rules-4 chase block: `chase` null = today's core byte for byte).
 * Tick order (identical): 0 timers + pending forced Backstep, 1 inputs side 0 then side 1, 2 telegraph starts -> exchange clock,
 * 3 movement, 4+5 contacts (one frozen state, simultaneous contacts both land), 6 regen, 7 forced breaks, 7b KO forced swap,
 * 8 pair state + break exits + witness, 9 KO/timeout, 10 state hash. Integer only; see math.ts for the division rule.
 * Host authority (hard rule 1): the host re-runs this on the issued rules + seed + the client's duel-inputs-2 log and settles
 * what IT computed.
 */

export type FightEvent = { tick: number; side: number; kind: FightEventKind; move: FightMove; outcome: FightOutcome; counter: boolean; value: number };

/** C# FightEvent.ToString (the frozen vectors' event text). */
export function eventText(e: FightEvent): string {
  return e.tick + ' s' + e.side + ' ' + EVENT_NAMES[e.kind] + (e.move !== Move.None ? ' ' + MOVE_NAMES[e.move] : '')
    + (e.kind === EventKind.Contact ? ' ' + OUTCOME_NAMES[e.outcome] + (e.counter ? ' COUNTER' : '') : '') + ' ' + e.value;
}

/** Mutable per-fighter state; every field below `def` is hashed (WriteFighter order). */
export class FightFighter {
  x = 0; z = 0; hp = 0; sta = 0; sync = 0; regenAcc = 0; regenBlockedUntil = 0;
  action: FightAction = Action.Idle; actionUntil = 0;
  atkMove: FightMove = Move.None; atkStart = -1; atkContact = -1; atkFacingX = 0; atkFacingZ = 0; atkCost = 0; atkTier = 0; atkCounter = false;
  punishableUntil = 0;
  guard: FightGuard = Guard.Down; guardInput = false; guardEdgeTick = -1; guardRaiseStart = -1; guardLowerUntil = 0;
  counterWindowUntil = 0; chainCount = 0; lastReadyTick = -1000;
  bufPress: FightPress = Press.None; bufStepX = 0; bufStepZ = 0; bufTier = 0; bufExpiry = -1;
  moveX = 0; moveZ = 0; moveAcc = 0;
  stepKind: FightLoco = Loco.Still; stepDirX = 0; stepDirZ = 0; stepTotal = 0; stepTicks = 0; stepElapsed = 0; stepForced = false;
  pushDirX = 0; pushDirZ = 0; pushTotal = 0; pushTicks = 0; pushElapsed = 0;
  inBreak = false; breakForced = false; backstepPending = false; breakStart = -1; breakUntil = -1;
  lastSelfMoveTick = -1000;
  ko = false; loco: FightLoco = Loco.Still; state: FightState = State.OutOfRange;
  shieldUntil = 0;
  /** r3: tick the current/last quick escape started (-1 never). */
  escStart = -1;
  /** r3: the FIGHT max HP (issued maxHp x the pair HP scale; = def.maxHp when hpScaleLights is 0). Not hashed (a function of the rules). */
  maxHp: number;
  // identity (not hashed)
  constructor(readonly def: FightFighterDef, readonly rosterIndex: number) { this.maxHp = def.maxHp; }
  // per-tick transients (not hashed)
  staStart = 0; hardHitThisTick = false;
}

/** fight-chase-1 per-side chase state (C# FightChaseSide; hashed only with the chase rules on, CHASE_SIDE_FIELDS order). */
export class FightChaseSide {
  tagged = false; retreatStart = -1; retreatReadyAt = 0; chasedAt = -1; drainAcc = 0; escapedThisRetreat = false;
  caught = 0; retreats = 0; ringStops = 0; ringStopTick = -1;
  /** transient (not hashed): no forced Backstep after a caught hit */
  caughtThisTick = false;
}
export const CHASE_SIDE_FIELDS = ['tagged', 'retreatStart', 'retreatReadyAt', 'chasedAt', 'drainAcc', 'escapedThisRetreat', 'caught', 'retreats', 'ringStops', 'ringStopTick'] as const;

type Contact = { side: number; move: FightMove; outcome: FightOutcome; counter: boolean; hard: boolean; damage: number; drain: number };

const B = (b: boolean) => (b ? 1 : 0);

export const HISTORY_TICKS = 32;

export class FightCore {
  readonly rules: FightRules;
  readonly F: FightFighter[] = [];
  readonly roster: FightFighter[][] = [[], []];
  readonly active = [0, 0];
  readonly swapLockedUntil = [-1, -1];
  readonly switches = [0, 0];
  readonly forcedSwaps = [0, 0];
  readonly targetPick = [0, 0];
  readonly rng: FightRng[] = [];
  readonly witness = new FightWitness();
  readonly events: FightEvent[] = [];
  /** fight-chase-1: the issued duel-rules-4 chase block, or null = today's core exactly (events and state hash). */
  readonly chase: FightChaseRules | null;
  /** fight-chase-1: per-side chase state (null when `chase` is null). */
  readonly chaseState: FightChaseSide[] | null;
  tick = -1;
  exchangeActive = false;
  exchangeStartTick = -1;
  lastTelegraphTick = -1;
  lastContactTick = -1;
  exchangePresses = 0;
  railFired = false;
  pairState: FightState = State.OutOfRange;
  distanceMm = 0;
  rangeRMm = 0;
  /** -1 running, 0/1 winner side, 2 draw. */
  winner = -1;
  ended = false;
  endReason = 'running';
  private readonly rulesHashB: Buffer;
  private readonly seed: Buffer;
  private readonly history: FightFighterView[][] = [new Array(HISTORY_TICKS), new Array(HISTORY_TICKS)];
  private historyCount = 0;
  private telegraphStarts: { side: number; inReach: boolean }[] = [];
  /** Emit events? (the witness and hashes do not depend on it; replay skips the strings for speed only when asked). */
  recordEvents = true;

  constructor(rules: FightRules, seedHex: string, chase: FightChaseRules | null = null) {
    validateRules(rules);
    if (chase) { validateChaseRules(chase); this.chase = { ...chase }; this.chaseState = [new FightChaseSide(), new FightChaseSide()]; }
    else { this.chase = null; this.chaseState = null; }
    this.rules = cloneRules(rules);
    this.rulesHashB = rulesHashBytes(this.rules);
    this.seed = seedBytes(seedHex);
    const meanLightsMilli = this.rules.hpScaleLights > 0 ? meanLightsToKoMilli(this.rules) : 0;
    for (let s = 0; s < 2; s++) {
      const idx = rosterOf(this.rules, s);
      for (let i = 0; i < idx.length; i++) {
        const d = this.rules.fighters[idx[i]];
        const f = new FightFighter(d, i);
        let maxHp = d.maxHp, hp = d.hp;
        if (meanLightsMilli > 0) {
          maxHp = Math.max(1, Math.min(1000000000, div(d.maxHp * this.rules.hpScaleLights * 1000, meanLightsMilli)));
          hp = d.hp === d.maxHp ? maxHp : d.hp === 0 ? 0 : Math.max(1, div(d.hp * maxHp, d.maxHp));
        }
        f.maxHp = maxHp;
        f.x = d.startXMm; f.z = d.startZMm; f.hp = hp; f.sta = d.startStaminaPm; f.sync = Math.min(d.startSync, this.rules.maxSync);
        if (f.hp === 0) { f.ko = true; f.action = Action.Ko; }
        this.roster[s].push(f);
      }
      const first = this.roster[s].findIndex(m => !m.ko);
      if (first < 0) throw new RangeError('invalid_roster');
      this.active[s] = first; this.F[s] = this.roster[s][first];
      this.rng[s] = new FightRng(rngSeedWord(this.seed, s));
    }
    this.targetPick[0] = this.active[1]; this.targetPick[1] = this.active[0];
    this.rangeRMm = Math.max(this.F[0].def.primaryReachMm, this.F[1].def.primaryReachMm);
    this.updatePair(-1, false);
    this.pushHistory();
  }

  // ================================================================ observation

  snapshot(side: number, lag: number): FightFighterView {
    if (lag < 0) lag = 0;
    if (lag > HISTORY_TICKS - 1) lag = HISTORY_TICKS - 1;
    if (lag > this.historyCount - 1) lag = this.historyCount - 1;
    const idx = (((this.historyCount - 1 - lag) % HISTORY_TICKS) + HISTORY_TICKS) % HISTORY_TICKS;
    return this.history[side][idx];
  }
  activeDef(side: number): FightFighterDef { return this.F[side].def; }
  memberView(side: number, index: number): FightFighterView { return this.makeView(this.roster[side][index]); }

  private pushHistory(): void {
    const idx = this.historyCount % HISTORY_TICKS;
    for (let s = 0; s < 2; s++) this.history[s][idx] = this.makeView(this.F[s]);
    this.historyCount++;
  }
  private makeView(f: FightFighter): FightFighterView {
    const tel = f.action === Action.Telegraph;
    return {
      tick: this.tick, xMm: f.x, zMm: f.z, hp: f.hp, maxHp: f.maxHp, staminaPm: f.sta, sync: f.sync, state: f.state, action: f.action,
      guard: f.guard, move: f.action === Action.Telegraph || f.action === Action.Recovery ? f.atkMove : Move.None,
      telegraphStartTick: tel ? f.atkStart : -1, contactTick: tel ? f.atkContact : -1, actionUntilTick: f.actionUntil,
      counterWindowUntil: f.counterWindowUntil, chainCount: f.chainCount, gassed: f.sta < this.rules.breakLinePm, loco: f.loco,
      rosterIndex: f.rosterIndex, shieldUntil: f.shieldUntil, punishableUntil: f.punishableUntil, breakUntil: f.inBreak ? f.breakUntil : -1,
    };
  }

  // ================================================================ tick

  step(in0: FightInput, in1: FightInput): void {
    if (this.ended) throw new RangeError('fight_ended');
    const t = ++this.tick;
    const R = this.rules;
    const railAtStart = this.exchangeActive && t - this.exchangeStartTick >= R.railTicks;
    const pairAtStart = this.pairState;
    this.telegraphStarts = [];
    for (let s = 0; s < 2; s++) { this.F[s].staStart = this.F[s].sta; this.F[s].hardHitThisTick = false; }

    // 0. timers + the pending forced Backstep (D2)
    for (let s = 0; s < 2; s++) {
      const f = this.F[s]; if (f.ko) continue;
      if ((f.action === Action.Recovery || f.action === Action.Step || f.action === Action.Stun || f.action === Action.Shove || f.action === Action.FeintRecovery
        || f.action === Action.Escape) && t >= f.actionUntil) {
        if (f.action === Action.Recovery) f.atkMove = Move.None;
        if (f.action === Action.Step || f.action === Action.Escape) { f.stepKind = Loco.Still; f.stepForced = false; }
        f.action = Action.Idle;
      }
      if (f.guard === Guard.Raising && t - f.guardRaiseStart >= R.guardRaiseTicks) f.guard = Guard.Up;
      if (f.guard === Guard.Lowering && t >= f.guardLowerUntil) f.guard = Guard.Down;
      if (f.bufExpiry >= 0 && f.bufExpiry < t) clearBuffer(f);
      if (f.backstepPending && f.action === Action.Idle) {
        f.backstepPending = false;
        if (f.guard === Guard.Down && !f.guardInput) this.startStep(s, 0, 0, true, railAtStart);
      }
    }

    // 1. inputs
    this.applyInput(0, in0, railAtStart, pairAtStart);
    this.applyInput(1, in1, railAtStart, pairAtStart);

    // 2. telegraph starts -> exchange clock
    for (const { side, inReach } of this.telegraphStarts) {
      if (!inReach) continue;
      if (this.exchangeActive) { this.lastTelegraphTick = t; this.exchangePresses++; }
      else {
        this.exchangeActive = true; this.exchangeStartTick = t; this.lastTelegraphTick = t; this.lastContactTick = -1; this.exchangePresses = 1; this.railFired = false;
        this.emit(side, EventKind.ExchangeStart, Move.None, 0);
      }
    }

    // 3. movement
    this.move(t);
    // 4 + 5. contacts
    this.contacts(t);
    // 6. regen
    for (let s = 0; s < 2; s++) this.regen(s, t);
    // 7. forced breaks
    for (let s = 0; s < 2; s++) {
      const f = this.F[s]; if (f.ko) continue;
      const crossed = this.exchangeActive && f.staStart >= R.breakLinePm && f.sta < R.breakLinePm;
      if (crossed || f.hardHitThisTick) this.enterBreak(s, true);
      if (this.chaseState && this.chaseState[s].caughtThisTick) { f.backstepPending = false; this.chaseState[s].caughtThisTick = false; }   // #72.65 (3)
    }
    // 7b. a KO forces the bench swap to the next standing member (wrapping), regardless of the lockout
    for (let s = 0; s < 2; s++) {
      if (!this.F[s].ko) continue;
      this.emit(s, EventKind.Ko, Move.None, this.active[s]);
      const next = this.nextStanding(s);
      if (next >= 0) this.switchTo(s, next, true);
    }
    // 8. pair state, break exits, witness
    this.updatePair(t, true);
    if (this.chase) this.chaseTags(t);
    // 9. KO / timeout
    const ko0 = this.F[0].ko, ko1 = this.F[1].ko;
    if (ko0 || ko1) { this.ended = true; this.endReason = 'ko'; this.winner = ko0 && ko1 ? 2 : ko0 ? 1 : 0; }
    else if (t >= R.maxTicks - 1) {
      this.ended = true; this.endReason = 'timeout';
      const a = this.sideHpPm(0), b = this.sideHpPm(1);
      this.winner = a === b ? 2 : a > b ? 0 : 1;
      this.emit(0, EventKind.Timeout, Move.None, this.winner);
    }
    this.pushHistory();
  }

  // ================================================================ bench swap + lock-on

  private sideHpPm(s: number): number { let sum = 0; for (const m of this.roster[s]) sum += div(m.hp * 1000, m.maxHp); return sum; }

  private nextStanding(s: number): number {
    const n = this.roster[s].length;
    for (let k = 1; k <= n; k++) { const i = (this.active[s] + k) % n; if (!this.roster[s][i].ko && this.roster[s][i].hp > 0) return i; }
    return -1;
  }

  private switchRefusal(s: number, to: number): number {
    if (to < 0 || to >= this.roster[s].length) return Deny.NoSuchSlot;
    if (to === this.active[s]) return Deny.SameSlot;
    if (this.roster[s][to].ko || this.roster[s][to].hp === 0) return Deny.KnockedOut;
    if (this.tick < this.swapLockedUntil[s]) return Deny.Lockout;
    return 0;
  }

  private switchTo(s: number, to: number, forced: boolean): void {
    const outgoing = this.F[s], incoming = this.roster[s][to];
    if (this.chase) this.endTag(s, ChaseEnd.Benched);
    incoming.x = outgoing.x; incoming.z = outgoing.z;
    bench(outgoing); bench(incoming);
    incoming.shieldUntil = this.tick + this.rules.swapShieldTicks; incoming.state = this.pairState;
    this.active[s] = to; this.F[s] = incoming; this.swapLockedUntil[s] = this.tick + this.rules.swapLockoutTicks;
    if (forced) this.forcedSwaps[s]++; else this.switches[s]++;
    this.targetPick[1 - s] = to;
    this.rangeRMm = Math.max(this.F[0].def.primaryReachMm, this.F[1].def.primaryReachMm);
    this.emit(s, forced ? EventKind.ForcedSwap : EventKind.Swap, Move.None, to);
    this.witness.swapped(s, forced);
  }

  // ================================================================ 1. inputs

  private free(f: FightFighter): boolean { return f.action === Action.Idle && f.guard === Guard.Down && !f.ko; }

  private applyInput(s: number, inp: FightInput, rail: boolean, pairAtStart: FightState): void {
    checkInput(inp);
    const f = this.F[s], R = this.rules, t = this.tick;
    if (f.ko) return;
    if (inp.target !== NO_PICK) {
      const to = inp.target;
      if (to >= this.roster[1 - s].length) this.deny(s, Deny.NoSuchSlot);
      else if (to !== this.active[1 - s]) this.deny(s, Deny.TargetNotFielded);
      else { this.targetPick[s] = to; this.emit(s, EventKind.TargetLock, Move.None, to); }
    }
    if (inp.deploy !== NO_PICK) {
      const refusal = this.switchRefusal(s, inp.deploy);
      if (refusal !== 0) this.deny(s, refusal);
      else {
        this.switchTo(s, inp.deploy, false);
        const g = this.F[s]; g.guardInput = inp.guard; g.moveX = clamp127(inp.moveX); g.moveZ = clamp127(inp.moveZ);
        return;
      }
    }
    const edgeDown = inp.guard && !f.guardInput, edgeUp = !inp.guard && f.guardInput;
    f.guardInput = inp.guard;
    f.moveX = clamp127(inp.moveX); f.moveZ = clamp127(inp.moveZ);
    let press: FightPress = inp.press;
    // r3 (#72.26 P5): the heavy press inside CLOSE is the shove (the pair state at the start of the tick decides)
    if (press === Press.Heavy && R.shoveOnHeavyInClose !== 0 && pairAtStart === State.CloseRange) press = Press.Shove;
    // r3 quick escape: after the no-guard window a guard press ends the escape early
    const turnPress = this.chase !== null && (press === Press.Light || press === Press.Heavy || press === Press.Special || press === Press.Step || press === Press.Shove);
    if (f.action === Action.Escape && (edgeDown || turnPress) && t - f.escStart >= R.escapeNoGuardTicks) {
      f.action = Action.Idle; f.actionUntil = t; f.stepKind = Loco.Still; f.stepElapsed = 0; f.stepTicks = 0; f.stepTotal = 0; f.stepDirX = 0; f.stepDirZ = 0;
    }

    if (f.action === Action.Telegraph && f.atkMove !== Move.Charge && (edgeDown || press === Press.Feint)) {
      if (t - f.atkStart <= R.feintWindowTicks) { this.feint(s, rail); if (edgeDown) f.guardEdgeTick = t; this.raiseGuardIfHeld(f, t); return; }
      if (press === Press.Feint) { this.deny(s, Deny.FeintWindow); press = Press.None; }
    } else if (press === Press.Feint) { this.deny(s, Deny.FeintWindow); press = Press.None; }

    if (edgeDown) { f.guardEdgeTick = t; clearBuffer(f); press = Press.None; }
    if (edgeUp && (f.guard === Guard.Raising || f.guard === Guard.Up)) {
      f.guard = Guard.Lowering; f.guardLowerUntil = t + R.guardLowerTicks; this.emit(s, EventKind.GuardLower, Move.None, 0);
    }

    let executed = false;
    if (press === Press.Disengage) {
      if (!this.chase) { if (!f.inBreak) this.enterBreak(s, false); executed = true; }
      else if (!f.inBreak) {
        // #72.65 (2): a retreat costs stamina and has a cooldown
        const cs = this.chaseState![s];
        if (t < cs.retreatReadyAt) this.deny(s, Deny.RetreatCooldown);
        else { this.spend(f, this.rail(this.chase.retreatCostPm, rail)); this.enterBreak(s, false); this.startTag(s, t); executed = true; }
      } else executed = true;
    } else if (press === Press.Shove) {
      if (pairAtStart !== State.CloseRange) this.deny(s, Deny.NotClose);
      else if (!this.free(f) || inp.guard) this.deny(s, Deny.Busy);
      else { this.shove(s, rail); executed = true; }
    } else if (press === Press.DoubleTap && !this.away(s, inp.stepX, inp.stepZ)) {
      // a double-tap that is not away from the rival has no rule (accepted, ignored)
    } else if (press === Press.DoubleTap && f.action === Action.Idle) {
      executed = this.execute(s, press, inp.stepX, inp.stepZ, 0, rail);
    } else if (press === Press.Light && !inp.guard && this.chargeReady(s, t)) {
      executed = this.startStrike(s, Move.Charge, 0, rail);
    } else if (press === Press.Light || press === Press.Heavy || press === Press.Special || press === Press.Step || press === Press.DoubleTap) {
      if (inp.guard && press !== Press.DoubleTap) this.deny(s, Deny.Guarding);
      else if (this.free(f)) executed = this.execute(s, press, inp.stepX, inp.stepZ, inp.specialTier, rail);
      else if ((press === Press.Step || press === Press.DoubleTap) && f.action === Action.Step && f.stepForced) { executed = this.execute(s, press, inp.stepX, inp.stepZ, 0, rail); }
      else if (f.action === Action.Telegraph || f.action === Action.Recovery || f.action === Action.Step || f.action === Action.Stun
        || f.action === Action.Shove || f.action === Action.FeintRecovery || f.action === Action.Escape || f.guard === Guard.Lowering) {
        f.bufPress = press; f.bufStepX = inp.stepX; f.bufStepZ = inp.stepZ; f.bufTier = inp.specialTier; f.bufExpiry = t + R.bufferTicks;
        this.emit(s, EventKind.Buffered, moveOf(press), 0);
      }
    }

    this.raiseGuardIfHeld(f, t);

    if (!executed && press === Press.None && f.bufExpiry >= t && this.free(f) && !inp.guard) {
      const p = f.bufPress, sx = f.bufStepX, sz = f.bufStepZ, tier = f.bufTier;
      clearBuffer(f);
      this.execute(s, p, sx, sz, tier, rail);
    }
  }

  private raiseGuardIfHeld(f: FightFighter, t: number): void {
    if (!f.guardInput) return;
    if (f.action === Action.Step && f.stepForced) { f.action = Action.Idle; f.stepKind = Loco.Still; f.stepForced = false; }
    if ((f.guard === Guard.Down || f.guard === Guard.Lowering) && (f.action === Action.Idle || f.action === Action.FeintRecovery)) {
      f.guard = Guard.Raising; f.guardRaiseStart = t; clearBuffer(f);
      this.emit(this.F.indexOf(f), EventKind.GuardRaise, Move.None, 0);
    }
  }

  private execute(s: number, p: FightPress, sx: number, sz: number, tier: number, rail: boolean): boolean {
    if (p === Press.Step) { this.startStep(s, sx, sz, false, rail); return true; }
    if (p === Press.DoubleTap) return this.startEscape(s, sx, sz, rail);
    return this.startStrike(s, moveOf(p), tier, rail);
  }

  private rail(cost: number, rail: boolean): number { return rail ? mulDiv(cost, this.rules.railMultPm, 1000) : cost; }

  private spend(f: FightFighter, amount: number): void {
    if (amount <= 0) return;
    f.sta = Math.max(0, f.sta - amount); f.regenBlockedUntil = this.tick + this.rules.regenDelayTicks; f.regenAcc = 0;
  }

  private startStrike(s: number, move: FightMove, tier: number, rail: boolean): boolean {
    const f = this.F[s], o = this.F[1 - s], R = this.rules, t = this.tick;
    let syncNeed = 0;
    let dashTopUp = 0;
    if (move === Move.Charge) {
      const stepPaid = f.stepKind === Loco.ForwardJump ? R.costBurstPm : R.costStepPm;
      dashTopUp = Math.max(0, this.rail(R.costChargeDashPm, rail) - this.rail(stepPaid, rail));
      f.stepKind = Loco.Still; f.stepDirX = 0; f.stepDirZ = 0; f.stepTotal = 0; f.stepTicks = 0; f.stepElapsed = 0; f.stepForced = false;
      clearBuffer(f);
    }
    if (move === Move.Special) {
      tier = tier === 2 ? 2 : 1;
      syncNeed = tier === 2 ? R.specialFullSync : R.specialHalfSync;
      if (f.sync < syncNeed) { this.deny(s, Deny.Sync); return false; }
    }
    const inChain = f.chainCount >= 1 && f.chainCount < R.chainMax && t <= f.lastReadyTick + R.chainGapTicks;
    const shortTel = move === Move.Light && inChain;
    f.chainCount = inChain ? f.chainCount + 1 : 1;
    let tel = move === Move.Charge ? R.chargeTelegraphTicks : shortTel ? R.chainTelegraphTicks + R.chainDecayTicks * (f.chainCount - 2) : R.telegraphTicks;
    tel += f.sta === 0 ? R.emptyTelegraphTicks : f.sta < R.breakLinePm ? R.gassedTelegraphTicks : 0;
    let baseCost = move === Move.Light || move === Move.Charge ? R.costLightPm : move === Move.Heavy ? R.costHeavyPm : R.costSpecialPm;
    if (shortTel) for (let k = 1; k < f.chainCount; k++) baseCost = mulDiv(baseCost, R.chainCostPm, 1000);
    const cost = this.rail(baseCost, rail);
    this.spend(f, cost + dashTopUp);
    f.sync -= syncNeed;
    const [ux, uz] = unit(o.x - f.x, o.z - f.z, s);
    f.action = Action.Telegraph; f.atkMove = move; f.atkStart = t; f.atkContact = t + tel; f.atkFacingX = ux; f.atkFacingZ = uz;
    f.atkCost = cost; f.atkTier = move === Move.Special ? tier : 0; f.atkCounter = t < f.counterWindowUntil; f.actionUntil = f.atkContact;
    const d = dist(o.x - f.x, o.z - f.z);
    this.telegraphStarts.push({ side: s, inReach: d <= this.reach(s, move) + this.lunge(f, move) });
    this.emit(s, EventKind.Telegraph, move, f.atkContact);
    this.witness.count(s, EventKind.Telegraph);
    if (move === Move.Charge) this.witness.charged(s);
    return true;
  }

  private feint(s: number, rail: boolean): void {
    const f = this.F[s], o = this.F[1 - s], R = this.rules, t = this.tick;
    const refund = f.atkCost, feintCost = this.rail(R.costFeintPm, rail);
    f.sta = Math.min(1000, f.sta + refund); this.spend(f, feintCost);
    if (f.atkMove === Move.Special) f.sync = Math.min(R.maxSync, f.sync + (f.atkTier === 2 ? R.specialFullSync : R.specialHalfSync));
    const move = f.atkMove, start = f.atkStart;
    f.action = Action.FeintRecovery; f.actionUntil = t + R.feintRecoveryTicks; f.atkMove = Move.None; f.atkStart = -1; f.atkContact = -1;
    f.chainCount = 0;
    this.emit(s, EventKind.Feint, move, 0); this.witness.count(s, EventKind.Feint);
    const bait = o.guardEdgeTick >= start && (o.guard === Guard.Raising || o.guard === Guard.Up) ? 1
      : o.action === Action.Telegraph && o.atkStart >= start ? 2 : 0;
    if (bait !== 0) { this.emit(s, EventKind.FeintBait, move, bait); this.witness.count(s, EventKind.FeintBait); }
  }

  private startStep(s: number, sx: number, sz: number, forced: boolean, rail: boolean): void {
    const f = this.F[s], o = this.F[1 - s], R = this.rules, d = f.def;
    const [ux, uz] = unit(o.x - f.x, o.z - f.z, s);
    let kind: FightLoco, dx: number, dz: number, total: number, ticks: number, cost: number;
    const fwd = sx * ux + sz * uz, cross = ux * sz - uz * sx, lat = cross < 0 ? -cross : cross;
    if ((sx === 0 && sz === 0) || -fwd > lat) { kind = Loco.Backstep; dx = -ux; dz = -uz; total = d.backstepMm; ticks = d.backstepTicks; cost = R.costStepPm; }
    else if (fwd > lat) { kind = Loco.ForwardJump; dx = ux; dz = uz; total = d.forwardJumpMm; ticks = d.forwardJumpTicks; cost = R.costBurstPm; }
    else if (cross > 0) { kind = Loco.SidestepL; dx = -uz; dz = ux; total = d.sidestepMm; ticks = d.sidestepTicks; cost = R.costStepPm; }
    else { kind = Loco.SidestepR; dx = uz; dz = -ux; total = d.sidestepMm; ticks = d.sidestepTicks; cost = R.costStepPm; }
    if (!forced) this.spend(f, this.rail(cost, rail));
    f.action = Action.Step; f.actionUntil = this.tick + ticks; f.stepKind = kind; f.stepDirX = dx; f.stepDirZ = dz; f.stepTotal = total; f.stepTicks = ticks;
    f.stepElapsed = 0; f.stepForced = forced; f.chainCount = 0;
    this.emit(s, EventKind.Step, Move.None, kind); this.witness.count(s, EventKind.Step);
  }

  /** r3 quick escape (FightCore.StartEscape): from EDGE or the fighter's own BREAK; burst cost, guard given up, voluntary
   * BREAK, TurnAway (0 travel) -> Run straight away -> TurnBack; a strike landing inside escapeNoGuardTicks is a counter. */
  private startEscape(s: number, sx: number, sz: number, rail: boolean): boolean {
    const f = this.F[s], o = this.F[1 - s], R = this.rules, d = f.def, t = this.tick;
    if (!this.away(s, sx, sz)) return false;
    if (this.pairState !== State.EdgeOfRange && !f.inBreak) { this.deny(s, Deny.NotEdgeOrBreak); return false; }
    // #72.65 (2): a new retreat waits for the cooldown; the one escape out of a Disengage retreat continues that retreat
    const cs = this.chaseState ? this.chaseState[s] : null;
    const continues = cs !== null && cs.tagged && !cs.escapedThisRetreat;
    if (cs && !continues && t < cs.retreatReadyAt) { this.deny(s, Deny.RetreatCooldown); return false; }
    this.spend(f, this.rail(R.costEscapePm, rail));
    if (f.guard !== Guard.Down) { f.guard = Guard.Down; this.emit(s, EventKind.GuardLower, Move.None, 0); }
    const [ux, uz] = unit(o.x - f.x, o.z - f.z, s);
    f.action = Action.Escape; f.escStart = t; f.actionUntil = t + R.escapeTurnTicks + R.escapeRunTicks + R.escapeTurnBackTicks;
    f.stepKind = Loco.EscapeRun; f.stepDirX = -ux; f.stepDirZ = -uz; f.stepTicks = R.escapeRunTicks; f.stepElapsed = 0; f.stepForced = false;
    f.stepTotal = div(d.runMmPerSec * R.escapeRunTicks, 30);
    f.chainCount = 0; clearBuffer(f);
    f.punishableUntil = Math.max(f.punishableUntil, t + R.escapeNoGuardTicks);
    if (!f.inBreak) this.enterBreak(s, false);
    this.emit(s, EventKind.Escape, Move.None, f.stepTotal); this.witness.count(s, EventKind.Escape);
    if (cs) { if (!continues) this.startTag(s, t); cs.escapedThisRetreat = true; }
    return true;
  }

  private shove(s: number, rail: boolean): void {
    const f = this.F[s], o = this.F[1 - s], R = this.rules;
    this.spend(f, this.rail(R.costShovePm, rail));
    f.action = Action.Shove; f.actionUntil = this.tick + R.shoveTicks; f.chainCount = 0;
    const [ux, uz] = unit(o.x - f.x, o.z - f.z, s);
    push(o, ux, uz, R.shovePushMm, R.shovePushTicks);
    this.emit(s, EventKind.Shove, Move.None, 0); this.witness.count(s, EventKind.Shove);
  }

  private enterBreak(s: number, forced: boolean): void {
    const f = this.F[s];
    const was = f.inBreak;
    f.inBreak = true; f.breakStart = this.tick; f.breakForced = forced;
    f.breakUntil = this.tick + this.breakLength(f.sta);
    if (forced) f.backstepPending = true;
    if (!was) { this.emit(s, EventKind.BreakStart, Move.None, forced ? 1 : 0); this.witness.breakStarted(s, forced); }
  }

  private breakLength(sta: number): number {
    const R = this.rules, line = Math.max(1, R.breakLinePm), below = Math.max(0, line - Math.min(sta, line));
    return R.breakMinTicks + div((R.breakMaxTicks - R.breakMinTicks) * below, line);
  }

  private closeKit(f: FightFighter): boolean { return f.def.reachLightMm <= this.rules.closeKitReachMm; }
  /** r3: a double-tap direction is away from the rival when its backward component beats its lateral one (FightCore.Away). */
  private away(s: number, sx: number, sz: number): boolean {
    const f = this.F[s], o = this.F[1 - s];
    const [ux, uz] = unit(o.x - f.x, o.z - f.z, s);
    const fwd = sx * ux + sz * uz, cross = ux * sz - uz * sx, lat = cross < 0 ? -cross : cross;
    return (sx !== 0 || sz !== 0) && -fwd > lat;
  }
  /** r3 ShoulderCharge window (FightCore.ChargeReady). */
  private chargeReady(s: number, t: number): boolean {
    const f = this.F[s], o = this.F[1 - s], R = this.rules;
    if (f.action !== Action.Step || f.stepForced) return false;
    if (f.stepKind !== Loco.SidestepL && f.stepKind !== Loco.SidestepR && f.stepKind !== Loco.ForwardJump) return false;
    if (t - (f.actionUntil - f.stepTicks) > R.chargeWindowTicks) return false;
    if (this.pairState !== State.EdgeOfRange && this.pairState !== State.OutOfRange) return false;
    return dist(o.x - f.x, o.z - f.z) - R.minGapMm <= R.chargeDashMm;
  }
  private deny(s: number, reason: number): void { this.emit(s, EventKind.Denied, Move.None, reason); }
  private reach(s: number, m: FightMove): number {
    const d = this.F[s].def; return m === Move.Light ? d.reachLightMm : m === Move.Heavy ? d.reachHeavyMm : m === Move.Charge ? this.rules.chargeReachMm : d.reachSpecialMm;
  }
  private lunge(f: FightFighter, m: FightMove): number {
    return m === Move.Light ? (this.closeKit(f) ? this.rules.closeKitLungeMm : this.rules.lungeLightMm) : m === Move.Heavy ? this.rules.lungeHeavyMm
      : m === Move.Charge ? this.rules.chargeDashMm : this.rules.lungeSpecialMm;
  }

  // ================================================================ 3. movement

  private move(t: number): void {
    const R = this.rules;
    const x0 = this.F[0].x, z0 = this.F[0].z, x1 = this.F[1].x, z1 = this.F[1].z;
    const d0 = dist(x1 - x0, z1 - z0);
    const dx = [0, 0], dz = [0, 0];
    for (let s = 0; s < 2; s++) {
      const f = this.F[s], def = f.def; f.loco = Loco.Still;
      if (f.ko) continue;
      const ox = s === 0 ? x1 : x0, oz = s === 0 ? z1 : z0;
      const [ux, uz] = unit(ox - f.x, oz - f.z, s);
      if (f.action === Action.Step && f.stepElapsed < f.stepTicks) {
        const k = f.stepElapsed;
        dx[s] += profile(f.stepDirX, f.stepTotal, k + 1, f.stepTicks) - profile(f.stepDirX, f.stepTotal, k, f.stepTicks);
        dz[s] += profile(f.stepDirZ, f.stepTotal, k + 1, f.stepTicks) - profile(f.stepDirZ, f.stepTotal, k, f.stepTicks);
        f.stepElapsed++; f.lastSelfMoveTick = t; f.loco = f.stepKind;
      } else if (f.action === Action.Escape) {
        const k = t - f.escStart;
        if (k < R.escapeTurnTicks) f.loco = Loco.TurnAway;
        else if (f.stepElapsed < f.stepTicks) {
          const e = f.stepElapsed;
          dx[s] += profile(f.stepDirX, f.stepTotal, e + 1, f.stepTicks) - profile(f.stepDirX, f.stepTotal, e, f.stepTicks);
          dz[s] += profile(f.stepDirZ, f.stepTotal, e + 1, f.stepTicks) - profile(f.stepDirZ, f.stepTotal, e, f.stepTicks);
          f.stepElapsed++; f.lastSelfMoveTick = t; f.loco = Loco.EscapeRun;
        } else f.loco = Loco.TurnBack;
      } else if (f.action === Action.Telegraph) {
        const tel = f.atkContact - f.atkStart, k = t - f.atkStart;
        if (k < tel && d0 > R.closeRangeMm) {
          const lunge = this.lunge(f, f.atkMove);
          dx[s] += profile(f.atkFacingX, lunge, k + 1, tel) - profile(f.atkFacingX, lunge, k, tel);
          dz[s] += profile(f.atkFacingZ, lunge, k + 1, tel) - profile(f.atkFacingZ, lunge, k, tel);
          f.loco = Loco.Lunge;
        }
      } else if (f.action === Action.Idle) {
        let mx = f.moveX, mz = f.moveZ;
        if (mx === 0 && mz === 0 && f.inBreak && !f.breakForced) { mx = div(-ux * 127, 1024); mz = div(-uz * 127, 1024); }
        if (mx !== 0 || mz !== 0) {
          const fwd = mx * ux + mz * uz, cross = ux * mz - uz * mx, lat = cross < 0 ? -cross : cross;
          let speed: number, loco: FightLoco;
          if (fwd > lat) { speed = def.runMmPerSec; loco = Loco.Forward; }
          else if (-fwd > lat) { speed = def.backMmPerSec; loco = Loco.Backpedal; }
          else { speed = def.strafeMmPerSec; loco = cross > 0 ? Loco.StrafeL : Loco.StrafeR; }
          if (f.guard !== Guard.Down) speed = mulDiv(speed, R.guardMovePm, 1000);
          if (this.chase && loco === Loco.Forward && this.chaseState![1 - s].tagged) {
            // #72.65 (2): the chaser's slight edge, paid for (a spend: its regen waits like after any spend)
            speed = mulDiv(speed, this.chase.chaserSpeedPm, 1000);
            const cs = this.chaseState![s]; cs.drainAcc += this.chase.chaseDrainPmPerSec;
            const drain = div(cs.drainAcc, 30); cs.drainAcc %= 30;
            if (drain > 0) this.spend(f, drain);
          }
          const len = dist(mx, mz), mag = Math.min(127, len);
          const acc = f.moveAcc + speed * mag;
          const stepMm = div(acc, 127 * 30); f.moveAcc = acc % (127 * 30);
          if (stepMm > 0) {
            dx[s] += div(mx * stepMm, len); dz[s] += div(mz * stepMm, len);
            f.lastSelfMoveTick = t; f.loco = loco;
          }
        } else f.moveAcc = 0;
      }
      if (f.pushTicks > 0 && f.pushElapsed < f.pushTicks) {
        const k = f.pushElapsed;
        dx[s] += profile(f.pushDirX, f.pushTotal, k + 1, f.pushTicks) - profile(f.pushDirX, f.pushTotal, k, f.pushTicks);
        dz[s] += profile(f.pushDirZ, f.pushTotal, k + 1, f.pushTicks) - profile(f.pushDirZ, f.pushTotal, k, f.pushTicks);
        f.pushElapsed++;
        if (f.pushElapsed >= f.pushTicks) { f.pushTicks = 0; f.pushElapsed = 0; f.pushTotal = 0; f.pushDirX = 0; f.pushDirZ = 0; }
        if (f.loco === Loco.Still) f.loco = Loco.Pushed;
      }
    }
    for (let s = 0; s < 2; s++) {
      if (this.chase && this.chase.ringStop !== 0 && this.chaseState![s].tagged && this.ringStop(s, dx[s], dz[s])) continue;
      this.F[s].x += dx[s]; this.F[s].z += dz[s]; this.clampRing(s);
    }
    this.separate();
    for (let s = 0; s < 2; s++) this.clampRing(s);
  }

  /** fight-chase-1 #72.65 (6) (FightCore.RingStop): a tagged runner whose move would leave the ring stops where its path meets
   * it (the largest k/1024 of the move that stays inside, integer bisection; no slide) and its escape run ends. */
  private ringStop(s: number, dx: number, dz: number): boolean {
    const f = this.F[s], radius = this.rules.ringRadiusMm - f.def.radiusMm;
    if (dist(f.x + dx, f.z + dz) <= radius) return false;
    let lo = 0, hi = 1024;
    if (dist(f.x, f.z) > radius) lo = hi = 0;
    while (lo < hi) {
      const mid = div(lo + hi + 1, 2);
      if (dist(f.x + div(dx * mid, 1024), f.z + div(dz * mid, 1024)) <= radius) lo = mid; else hi = mid - 1;
    }
    f.x += div(dx * lo, 1024); f.z += div(dz * lo, 1024); this.clampRing(s);
    f.moveAcc = 0;
    if (f.action === Action.Escape) f.stepElapsed = f.stepTicks;
    if (f.action === Action.Step) f.stepElapsed = f.stepTicks;
    const cs = this.chaseState![s];
    if (cs.ringStopTick < cs.retreatStart) this.emit(s, EventKind.RingStop, Move.None, this.rules.ringRadiusMm);   // once per retreat
    cs.ringStopTick = this.tick; cs.ringStops++;
    return true;
  }

  private clampRing(s: number): void {
    const f = this.F[s], radius = this.rules.ringRadiusMm - f.def.radiusMm;
    const len = dist(f.x, f.z);
    if (len > radius) { f.x = div(f.x * radius, len); f.z = div(f.z * radius, len); }
  }

  private separate(): void {
    const a = this.F[0], b = this.F[1], gap = this.rules.minGapMm;
    const vx = b.x - a.x, vz = b.z - a.z, d = dist(vx, vz);
    if (d >= gap) return;
    const overlap = gap - d, ha = div(overlap, 2), hb = overlap - ha;
    if (d === 0) { a.x -= ha; b.x += hb; return; }
    a.x -= div(vx * ha, d); a.z -= div(vz * ha, d);
    b.x += div(vx * hb, d); b.z += div(vz * hb, d);
  }

  // ================================================================ 4 + 5. contacts

  private contacts(t: number): void {
    const R = this.rules;
    const list: Contact[] = [];
    for (let s = 0; s < 2; s++) {
      const f = this.F[s];
      if (f.ko || f.action !== Action.Telegraph || f.atkContact !== t) continue;
      list.push(this.resolve(s, t));
    }
    if (list.length === 0) return;
    if (list.length === 2) this.witness.count(0, EventKind.Contact, true);
    for (const c of list) {
      const f = this.F[c.side], m = c.move;
      let rec = m === Move.Light ? R.recoveryLightTicks : m === Move.Heavy ? R.recoveryHeavyTicks : m === Move.Charge ? R.chargeRecoveryTicks : R.recoverySpecialTicks;
      const whiff = c.outcome === Outcome.Whiffed || c.outcome === Outcome.Evaded, blocked = c.outcome === Outcome.Blocked || c.outcome === Outcome.Perfect;
      if (whiff) rec += lightClass(m) ? R.whiffLightExtraTicks : R.whiffHeavyExtraTicks;
      if (c.outcome === Outcome.Perfect) rec += R.perfectRecoveryExtraTicks;
      if (blocked) rec = Math.max(rec, R.blockedRecoveryMinTicks);
      f.action = Action.Recovery; f.actionUntil = t + 1 + rec; f.lastReadyTick = f.actionUntil;
      f.atkStart = -1; f.atkContact = -1;
      if (whiff || blocked) f.punishableUntil = f.actionUntil;
      const mult = c.outcome === Outcome.Whiffed ? R.multWhiffPm : c.outcome === Outcome.Evaded ? R.multEvadedPm
        : c.outcome === Outcome.Blocked || c.outcome === Outcome.Perfect || c.outcome === Outcome.GuardBreak ? R.multBlockedPm : 1000;
      if (mult > 1000) this.spend(f, mulDiv(f.atkCost, mult - 1000, 1000));
      f.atkCost = 0;
    }
    for (const c of list) {
      const f = this.F[c.side], o = this.F[1 - c.side], od = o.def;
      const gain = lightClass(c.move) ? R.syncLight : c.move === Move.Heavy ? R.syncHeavy : 0;
      switch (c.outcome) {
        case Outcome.Hit:
        case Outcome.GuardBreak: {
          o.hp = Math.max(0, o.hp - c.damage);
          f.sync = Math.min(R.maxSync, f.sync + gain);
          if (c.outcome === Outcome.GuardBreak) { this.spend(o, c.drain); o.guard = Guard.Down; }
          let stun = c.hard ? Math.min(od.hitHeavyTicks, R.hitStunHeavyMaxTicks) : Math.min(od.hitLightTicks, R.hitStunLightMaxTicks);
          if (c.outcome === Outcome.GuardBreak) stun = Math.max(stun, R.guardBreakStaggerTicks);
          interrupt(o);
          const caught = this.chase !== null && this.chaseState![1 - c.side].tagged && o.hp > c.damage;   // (post-damage HP, as C#)
          if (caught) stun = Math.max(stun, this.chase!.caughtStaggerTicks);
          o.action = Action.Stun; o.actionUntil = t + 1 + stun;
          if (o.guard !== Guard.Down) o.guard = Guard.Down;
          if (caught) {
            // #72.65 (3): the caught runner is pulled back toward the hitter (replaces the knockback / charge push)
            const ch = this.chase!;
            const dd = dist(o.x - f.x, o.z - f.z), pull = Math.max(0, Math.min(ch.caughtPullMm, dd - ch.caughtGapMm));
            const [px, pz] = unit(f.x - o.x, f.z - o.z, 1 - c.side);
            push(o, px, pz, pull, ch.caughtPullTicks);
            if (c.hard) { o.hardHitThisTick = true; this.emit(1 - c.side, EventKind.HardHit, c.move, c.damage); this.witness.count(c.side, EventKind.HardHit); }
            const cs = this.chaseState![1 - c.side]; cs.caught++; cs.caughtThisTick = true;
            this.emit(1 - c.side, EventKind.Caught, c.move, pull);
            this.endTag(1 - c.side, ChaseEnd.Caught);
          } else if (c.hard) {
            const [ux, uz] = unit(o.x - f.x, o.z - f.z, c.side);
            push(o, ux, uz, R.knockbackMm, R.knockbackTicks);
            o.hardHitThisTick = true;
            this.emit(1 - c.side, EventKind.HardHit, c.move, c.damage); this.witness.count(c.side, EventKind.HardHit);
          } else if (c.move === Move.Charge) { const [ux, uz] = unit(o.x - f.x, o.z - f.z, c.side); push(o, ux, uz, R.chargePushMm, R.chargePushTicks); }
          break;
        }
        case Outcome.Blocked:
          o.hp = Math.max(0, o.hp - c.damage);
          this.spend(o, c.drain);
          f.sync = Math.min(R.maxSync, f.sync + mulDiv(gain, R.syncBlockedPm, 1000));
          if (c.move === Move.Charge) { const [ux, uz] = unit(o.x - f.x, o.z - f.z, c.side); push(o, ux, uz, R.chargePushMm, R.chargePushTicks); }
          else if (c.move !== Move.Light) { const [ux, uz] = unit(o.x - f.x, o.z - f.z, c.side); push(o, ux, uz, R.heavyPushbackMm, R.pushbackTicks); }
          break;
        case Outcome.Perfect:
          o.counterWindowUntil = t + 1 + R.counterWindowTicks;
          break;
      }
      if (o.hp === 0 && !o.ko) { o.ko = true; interrupt(o); o.action = Action.Ko; o.guard = Guard.Down; }
      if (this.exchangeActive && (c.outcome === Outcome.Hit || c.outcome === Outcome.Blocked || c.outcome === Outcome.Perfect || c.outcome === Outcome.GuardBreak)) this.lastContactTick = t;
      this.emit(c.side, EventKind.Contact, c.move, c.damage, c.outcome, c.counter);
      this.witness.contact(c.side, c.outcome, c.counter);
    }
  }

  private resolve(s: number, t: number): Contact {
    const R = this.rules, f = this.F[s], o = this.F[1 - s], m = f.atkMove;
    const c: Contact = { side: s, move: m, outcome: Outcome.Hit, counter: false, hard: false, damage: 0, drain: 0 };
    const vx = o.x - f.x, vz = o.z - f.z, d = dist(vx, vz);
    const inReach = d <= this.reach(s, m);
    const dot = f.atkFacingX * vx + f.atkFacingZ * vz;
    const facing = d === 0 || dot * 1000 >= R.facingCosPm * 1024 * d;
    if (!o.ko && t < o.shieldUntil) { c.outcome = Outcome.Shielded; return c; }
    if (o.ko || !inReach || !facing) { c.outcome = o.lastSelfMoveTick >= f.atkStart ? Outcome.Evaded : Outcome.Whiffed; return c; }
    const guarding = o.guard === Guard.Raising || o.guard === Guard.Up;
    if (guarding && o.guardEdgeTick >= 0 && t - o.guardEdgeTick <= R.perfectGuardTicks) { c.outcome = Outcome.Perfect; return c; }
    c.counter = f.atkCounter || (o.action === Action.Telegraph && o.atkContact > t) || t < o.punishableUntil;
    if (o.guard === Guard.Up) {
      let drain = lightClass(m) ? R.drainLightPm : m === Move.Heavy ? R.drainHeavyPm : R.drainSpecialPm;
      if (o.sta < R.breakLinePm) drain = mulDiv(drain, R.gassedDrainPm, 1000);
      c.drain = drain;
      if (o.sta === 0 || drain > o.sta) { c.outcome = Outcome.GuardBreak; c.damage = this.damage(s, m, c.counter, 1000, d); c.hard = true; return c; }
      c.outcome = Outcome.Blocked; c.counter = false;
      c.damage = this.damage(s, m, false, m === Move.Special ? R.chipSpecialPm : R.chipPm, d);
      return c;
    }
    c.outcome = Outcome.Hit;
    c.damage = this.damage(s, m, c.counter, 1000, d);
    c.hard = c.damage * 1000 >= R.hardHitHpPm * o.maxHp || (c.counter && !lightClass(m));
    return c;
  }

  private damage(s: number, m: FightMove, counter: boolean, chipPm: number, d: number): number {
    const R = this.rules, f = this.F[s], df = f.def, od = this.F[1 - s].def;
    const scale = m === Move.Light ? R.scaleLightPm : m === Move.Heavy ? R.scaleHeavyPm : m === Move.Charge ? R.scaleChargePm : R.scaleSpecialPm;
    let dmg = mulDiv(df.attack, scale, 1000);
    dmg = mulDiv(dmg, 100, 100 + od.defense);
    if (m === Move.Special) dmg = mulDiv(dmg, f.atkTier === 2 ? R.specialFullEffectPm : R.specialHalfEffectPm, 1000);
    if (counter) dmg = mulDiv(dmg, R.counterPm, 1000);
    if (m === Move.Light && this.closeKit(f) && d <= R.closeKitReachMm && R.closeKitDamagePm !== 1000) dmg = mulDiv(dmg, R.closeKitDamagePm, 1000);
    if (f.sta === 0) dmg = mulDiv(dmg, R.emptyDamagePm, 1000);
    else if (f.sta < R.breakLinePm) dmg = mulDiv(dmg, R.gassedDamagePm, 1000);
    if (chipPm !== 1000) dmg = mulDiv(dmg, chipPm, 1000);
    return dmg;
  }

  // ================================================================ 6. regen

  private regen(s: number, t: number): void {
    const R = this.rules, f = this.F[s];
    if (f.ko || t < f.regenBlockedUntil || f.sta >= 1000) return;
    if (this.chaseState && this.chaseState[s].tagged) return;   // #72.65 (1): no regen while retreating / chased
    let rate: number;
    if (f.inBreak) rate = t - f.breakStart < R.breakRegenDelayTicks ? 0 : R.regenBreakPmPerSec;
    else switch (f.state) {
      case State.OutOfRange: rate = R.regenOutPmPerSec; break;
      case State.EdgeOfRange: rate = R.regenEdgePmPerSec; break;
      case State.Exchange: rate = R.regenExchangePmPerSec; break;
      case State.CloseRange: rate = R.regenClosePmPerSec; break;
      default: rate = R.regenBreakPmPerSec; break;
    }
    if (rate === 0) return;
    const mult = f.guard === Guard.Raising || f.guard === Guard.Up ? R.guardRegenPm : 1000;
    const acc = f.regenAcc + rate * mult;
    const gain = div(acc, 30000); f.regenAcc = acc % 30000;
    f.sta = Math.min(1000, f.sta + gain);
  }

  // ================================================================ 8. pair state

  private updatePair(t: number, count: boolean): void {
    const R = this.rules;
    this.distanceMm = dist(this.F[1].x - this.F[0].x, this.F[1].z - this.F[0].z);
    if (count && this.exchangeActive && t - Math.max(this.lastTelegraphTick, this.lastContactTick) >= R.exchangeGapTicks) {
      this.exchangeActive = false; const len = t - this.exchangeStartTick;
      if (this.exchangePresses >= R.exchangeMinPresses) { this.emit(0, EventKind.ExchangeEnd, Move.None, len); this.witness.exchangeEnded(len); }
      else { this.emit(0, EventKind.ProbeEnd, Move.None, len); this.witness.probeEnded(len); }
    }
    if (count && this.exchangeActive && !this.railFired && t - this.exchangeStartTick >= R.railTicks) {
      this.railFired = true; this.emit(0, EventKind.Rail, Move.None, t - this.exchangeStartTick); this.witness.railFired();
    }
    this.pairState = this.distanceMm <= R.closeRangeMm ? State.CloseRange : this.exchangeActive ? State.Exchange
      : this.distanceMm <= this.rangeRMm + R.edgeBandMm ? State.EdgeOfRange : State.OutOfRange;
    for (let s = 0; s < 2; s++) {
      const f = this.F[s];
      if (count && f.inBreak && !f.ko) {
        const age = t - f.breakStart;
        if (t >= f.breakUntil || (age >= R.breakMinTicks && this.distanceMm > this.rangeRMm + R.edgeBandMm)) {
          f.inBreak = false; f.breakForced = false;
          this.emit(s, EventKind.BreakEnd, Move.None, age); this.witness.breakEnded(s, age);
        }
      }
      f.state = f.inBreak ? State.Break : this.pairState;
      if (count) this.witness.sample(f.state, f.sta, R.breakLinePm, s, t);
    }
  }

  // ================================================================ fight-chase-1 tags (#72.65)

  /** True while `side`'s fielded bot is a tagged runner (always false with the chase rules off). */
  tagged(side: number): boolean { return this.chaseState !== null && this.chaseState[side].tagged; }

  private startTag(s: number, t: number): void {
    const cs = this.chaseState![s];
    cs.tagged = true; cs.retreatStart = t; cs.chasedAt = t; cs.escapedThisRetreat = false; cs.retreats++;
    cs.retreatReadyAt = t + this.chase!.retreatCooldownTicks;
    this.emit(s, EventKind.Retreat, Move.None, cs.retreatReadyAt);
  }

  private endTag(s: number, reason: number): void {
    const cs = this.chaseState![s];
    if (!cs.tagged) return;
    cs.tagged = false; cs.escapedThisRetreat = false;
    this.emit(s, EventKind.ChaseEnd, Move.None, reason);
  }

  /** After the pair update (FightCore.ChaseTags): the opponent advancing keeps a tag alive; turning to fight, CLOSE, a KO, or
   * (retreat motion over) no advance for chaseLapseTicks ends it. The start tick never ends it. */
  private chaseTags(t: number): void {
    for (let s = 0; s < 2; s++) {
      const cs = this.chaseState![s]; if (!cs.tagged) continue;
      const f = this.F[s], o = this.F[1 - s];
      if (o.loco === Loco.Forward || o.loco === Loco.ForwardJump || o.loco === Loco.Lunge) cs.chasedAt = t;
      if (f.ko) { this.endTag(s, ChaseEnd.Ko); continue; }
      if (t === cs.retreatStart) continue;
      const turned = f.action === Action.Telegraph || f.action === Action.Shove || f.guard === Guard.Raising || f.guard === Guard.Up
        || f.loco === Loco.Forward || f.loco === Loco.ForwardJump;
      if (turned) { this.endTag(s, ChaseEnd.Turned); continue; }
      if (this.distanceMm <= this.rules.closeRangeMm) { this.endTag(s, ChaseEnd.Closed); continue; }
      const moving = f.action === Action.Escape || (f.inBreak && !f.breakForced);
      if (!moving && t - cs.chasedAt >= this.chase!.chaseLapseTicks) this.endTag(s, ChaseEnd.Lapsed);
    }
  }

  private emit(side: number, kind: FightEventKind, move: FightMove, value: number, outcome: FightOutcome = Outcome.Hit, counter = false): void {
    if (this.recordEvents) this.events.push({ tick: this.tick, side, kind, move, value, outcome, counter });
  }

  // ================================================================ 10. hash

  /**
   * Canonical state bytes (FightCore.StateBytes): ASCII "duel-sim-3", rules hash (32 B), seed (32 B), then int32 LE: tick,
   * exchange active, exchange start, last in-reach telegraph, last contact, exchange presses, rail fired, pair state, distance,
   * R, winner, ended; per side: active, swap lockout, switches, forced swaps, target pick, rng state, rng draws; then every
   * roster member in rules array order (STATE_FIGHTER_FIELDS).
   */
  stateBytes(): Buffer {
    const w = new Int32Writer(1024).ascii('duel-sim-3').bytes(this.rulesHashB).bytes(this.seed);
    w.int(this.tick).int(B(this.exchangeActive)).int(this.exchangeStartTick).int(this.lastTelegraphTick).int(this.lastContactTick)
      .int(this.exchangePresses).int(B(this.railFired)).int(this.pairState).int(this.distanceMm).int(this.rangeRMm).int(this.winner).int(B(this.ended));
    for (let s = 0; s < 2; s++) {
      w.int(this.active[s]).int(this.swapLockedUntil[s]).int(this.switches[s]).int(this.forcedSwaps[s]).int(this.targetPick[s])
        .int(this.rng[s].state).int(this.rng[s].draws);
    }
    const cursor = [0, 0];
    for (const d of this.rules.fighters) writeFighter(w, this.roster[d.side][cursor[d.side]++]);
    // fight-chase-1: only with the chase rules on (off = today's bytes exactly): 'fight-chase-1', the rules, then side 0, side 1
    if (this.chase) {
      w.ascii('fight-chase-1');
      for (const k of CHASE_KEYS) w.int(this.chase[k]);
      for (const cs of this.chaseState!) writeChaseSide(w, cs);
    }
    return w.done();
  }
  stateHash(): string { return hex(sha256(this.stateBytes())); }
}

/** WriteFighter field order (names for the diff tool; each is one int32). */
export const STATE_FIGHTER_FIELDS = [
  'x', 'z', 'hp', 'sta', 'sync', 'regenAcc', 'regenBlockedUntil', 'action', 'actionUntil',
  'atkMove', 'atkStart', 'atkContact', 'atkFacingX', 'atkFacingZ', 'atkCost', 'atkTier', 'atkCounter', 'punishableUntil',
  'guard', 'guardInput', 'guardEdgeTick', 'guardRaiseStart', 'guardLowerUntil', 'counterWindowUntil', 'chainCount', 'lastReadyTick',
  'bufPress', 'bufStepX', 'bufStepZ', 'bufTier', 'bufExpiry', 'moveX', 'moveZ', 'moveAcc',
  'stepKind', 'stepDirX', 'stepDirZ', 'stepTotal', 'stepTicks', 'stepElapsed', 'stepForced',
  'pushDirX', 'pushDirZ', 'pushTotal', 'pushTicks', 'pushElapsed',
  'inBreak', 'breakForced', 'backstepPending', 'breakStart', 'breakUntil', 'lastSelfMoveTick', 'ko', 'loco', 'state', 'shieldUntil',
  'escStart',
] as const;
export const STATE_HEADER_FIELDS = ['tick', 'exchangeActive', 'exchangeStartTick', 'lastTelegraphTick', 'lastContactTick', 'exchangePresses',
  'railFired', 'pairState', 'distanceMm', 'rangeRMm', 'winner', 'ended'] as const;
export const STATE_SIDE_FIELDS = ['active', 'swapLockedUntil', 'switches', 'forcedSwaps', 'targetPick', 'rngState', 'rngDraws'] as const;

function writeFighter(w: Int32Writer, f: FightFighter): void {
  w.int(f.x).int(f.z).int(f.hp).int(f.sta).int(f.sync).int(f.regenAcc).int(f.regenBlockedUntil).int(f.action).int(f.actionUntil)
    .int(f.atkMove).int(f.atkStart).int(f.atkContact).int(f.atkFacingX).int(f.atkFacingZ).int(f.atkCost).int(f.atkTier).int(B(f.atkCounter)).int(f.punishableUntil)
    .int(f.guard).int(B(f.guardInput)).int(f.guardEdgeTick).int(f.guardRaiseStart).int(f.guardLowerUntil).int(f.counterWindowUntil).int(f.chainCount).int(f.lastReadyTick)
    .int(f.bufPress).int(f.bufStepX).int(f.bufStepZ).int(f.bufTier).int(f.bufExpiry).int(f.moveX).int(f.moveZ).int(f.moveAcc)
    .int(f.stepKind).int(f.stepDirX).int(f.stepDirZ).int(f.stepTotal).int(f.stepTicks).int(f.stepElapsed).int(B(f.stepForced))
    .int(f.pushDirX).int(f.pushDirZ).int(f.pushTotal).int(f.pushTicks).int(f.pushElapsed)
    .int(B(f.inBreak)).int(B(f.breakForced)).int(B(f.backstepPending)).int(f.breakStart).int(f.breakUntil).int(f.lastSelfMoveTick).int(B(f.ko)).int(f.loco).int(f.state).int(f.shieldUntil)
    .int(f.escStart);
}

function writeChaseSide(w: Int32Writer, cs: FightChaseSide): void {
  w.int(B(cs.tagged)).int(cs.retreatStart).int(cs.retreatReadyAt).int(cs.chasedAt).int(cs.drainAcc).int(B(cs.escapedThisRetreat))
    .int(cs.caught).int(cs.retreats).int(cs.ringStops).int(cs.ringStopTick);
}

function clamp127(v: number): number { return v < -127 ? -127 : v > 127 ? 127 : v; }

function clearBuffer(f: FightFighter): void { f.bufPress = Press.None; f.bufStepX = 0; f.bufStepZ = 0; f.bufTier = 0; f.bufExpiry = -1; }

function moveOf(p: FightPress): FightMove {
  return p === Press.Light ? Move.Light : p === Press.Heavy ? Move.Heavy : p === Press.Special ? Move.Special : Move.None;
}
function lightClass(m: FightMove): boolean { return m === Move.Light || m === Move.Charge; }

/** r3 HP scale (FightCore.MeanLightsToKoMilli): the roster-average count (x1000) of clean lights to KO each member at its issued
 * HP, hit by the opposing side's mean attack (light scale, own defense; at least 1 per hit). Rules-array order, truncating. */
export function meanLightsToKoMilli(r: FightRules): number {
  const atkSum = [0, 0], n = [0, 0];
  for (const d of r.fighters) { atkSum[d.side] += d.attack; n[d.side]++; }
  let sum = 0, count = 0;
  for (const d of r.fighters) {
    const oppAtk = div(atkSum[1 - d.side], Math.max(1, n[1 - d.side]));
    let dmg = mulDiv(mulDiv(oppAtk, r.scaleLightPm, 1000), 100, 100 + d.defense);
    if (dmg < 1) dmg = 1;
    sum += div(d.maxHp * 1000, dmg); count++;
  }
  return Math.max(1, div(sum, Math.max(1, count)));
}

/** r3 FightCore.TownHp: a fight HP back in issued (town) units for the settle; 0 stays 0, standing >= 1, full stays full. */
export function townHp(m: FightFighter): number {
  if (m.hp <= 0) return 0;
  if (m.hp >= m.maxHp) return m.def.maxHp;
  return Math.max(1, div(m.hp * m.def.maxHp, m.maxHp));
}

/** Unit vector (length 1024, truncated); a zero delta faces side 0 to +X and side 1 to -X. */
function unit(dx: number, dz: number, side: number): [number, number] {
  const len = dist(dx, dz);
  if (len === 0) return [side === 0 ? 1024 : -1024, 0];
  return [div(dx * 1024, len), div(dz * 1024, len)];
}

function profile(dir: number, total: number, k: number, ticks: number): number { return div(dir * total * k, ticks * 1024); }

function push(f: FightFighter, ux: number, uz: number, total: number, ticks: number): void {
  f.pushDirX = ux; f.pushDirZ = uz; f.pushTotal = total; f.pushTicks = ticks; f.pushElapsed = 0;
}

function interrupt(o: FightFighter): void {
  o.atkMove = Move.None; o.atkStart = -1; o.atkContact = -1; o.atkCost = 0; o.atkTier = 0; o.atkCounter = false;
  o.stepKind = Loco.Still; o.stepElapsed = 0; o.stepTicks = 0; o.stepTotal = 0; o.stepDirX = 0; o.stepDirZ = 0; o.stepForced = false;
  o.chainCount = 0; clearBuffer(o);
}

/** Clears everything but identity, position, HP, stamina, SYNC and KO. */
function bench(f: FightFighter): void {
  if (!f.ko) f.action = Action.Idle;
  f.actionUntil = 0; f.regenAcc = 0; f.regenBlockedUntil = 0;
  f.atkMove = Move.None; f.atkStart = -1; f.atkContact = -1; f.atkFacingX = 0; f.atkFacingZ = 0; f.atkCost = 0; f.atkTier = 0; f.atkCounter = false;
  f.punishableUntil = 0; f.guard = Guard.Down; f.guardInput = false; f.guardEdgeTick = -1; f.guardRaiseStart = -1; f.guardLowerUntil = 0;
  f.counterWindowUntil = 0; f.chainCount = 0; f.lastReadyTick = -1000; clearBuffer(f); f.moveX = 0; f.moveZ = 0; f.moveAcc = 0;
  f.stepKind = Loco.Still; f.stepDirX = 0; f.stepDirZ = 0; f.stepTotal = 0; f.stepTicks = 0; f.stepElapsed = 0; f.stepForced = false;
  f.pushDirX = 0; f.pushDirZ = 0; f.pushTotal = 0; f.pushTicks = 0; f.pushElapsed = 0;
  f.inBreak = false; f.breakForced = false; f.backstepPending = false; f.breakStart = -1; f.breakUntil = -1; f.lastSelfMoveTick = -1000; f.loco = Loco.Still; f.shieldUntil = 0; f.escStart = -1;
}
