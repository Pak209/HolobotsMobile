import { Action, FightFighterView, FightInput, FightProfile, FightRng, FightSkill, Guard, idleInput, Loco, Press, State } from './contracts';
import { FightCore } from './core';
import { dist, div } from './math';
import { FightFighterDef, FightRules, TICK_HZ } from './rules';
import { BrainProfile, BrainSkill, brainFromIssued, profileIsValid, RANKS, skillFromIssued, SpecialPolicy } from './profiles';

/**
 * The in-core CPU, ported from HolobotsUnity `Sim/Ai/FightBrain.cs`, `FightCoreBrain.cs`, `FightAiSeam.cs` (fight-ai-1 +
 * fight-tune-1) and the `FightStubBrain` in `Sim/Fight/FightRunner.cs`. The host MUST run the same brain: its draws come from
 * the core's per-side FightRng, whose state + draw count are hashed. Every `rng` call below keeps the C# evaluation order
 * (short-circuit && / || included): one reordered draw diverges the hash trail.
 */

/** The brain's window into the core (FightView). */
export class FightView {
  constructor(readonly core: FightCore, readonly side: number) {}
  get tick(): number { return this.core.tick; }
  get rules(): FightRules { return this.core.rules; }
  get self(): FightFighterView { return this.core.snapshot(this.side, 0); }
  opponent(lag: number): FightFighterView { return this.core.snapshot(1 - this.side, lag); }
  get distanceMm(): number { return this.core.distanceMm; }
  get exchangeActive(): boolean { return this.core.exchangeActive; }
  get exchangeStartTick(): number { return this.core.exchangeStartTick; }
  get rangeRMm(): number { return this.core.rangeRMm; }
  get selfDef(): FightFighterDef { return this.core.activeDef(this.side); }
  get opponentDef(): FightFighterDef { return this.core.activeDef(1 - this.side); }
}

export interface FightBrainDriver {
  begin(side: number, profile: FightProfile | null, skill: FightSkill | null): void;
  decide(view: FightView, rng: FightRng): FightInput;
}

// ---------------------------------------------------------------- FightAiSeam

const Phase = { Out: 0, Edge: 1, Exchange: 2, Close: 3 } as const;
const Act = { Free: 0, Telegraph: 1, Recovery: 2, Step: 3, Burst: 4, Shove: 5, Stagger: 6, FeintRecovery: 7, Escape: 8 } as const;
const Strike = { None: 0, Light: 1, Heavy: 2, Special: 3, Charge: 4 } as const;
/** r3: Escape goes to the core as the double-tap (code 8) away from the rival; a ShoulderCharge is Step (sideways) then Strike. */
const AiPress = { None: 0, Strike: 1, Heavy: 2, Finisher: 3, Feint: 4, Step: 5, Shove: 6, Disengage: 7, Escape: 8 } as const;

type AiView = {
  x: number; z: number; hp: number; maxHp: number; stamina: number; sync: number; act: number; strike: number;
  actStartTick: number; contactTick: number; actEndTick: number; guardHeld: boolean; guardUp: boolean;
  punishable: boolean; punishableUntilTick: number; breaking: boolean; counterUntilTick: number;
};
type AiKit = { runMmPerTick: number; primaryReachMm: number; contactReachMm: number; lightLungeMm: number; heavyLungeMm: number; specialLungeMm: number;
  chargeReachMm: number; chargeLungeMm: number };
const lungeOf = (k: AiKit, s: number) => (s === Strike.Heavy ? k.heavyLungeMm : s === Strike.Special ? k.specialLungeMm : s === Strike.Charge ? k.chargeLungeMm : k.lightLungeMm);
const threat = (k: AiKit, s: number) => (s === Strike.Charge ? k.chargeReachMm : k.contactReachMm) + lungeOf(k, s);
type AiRules = {
  lightCost: number; heavyCost: number; specialCost: number; feintCost: number; stepCost: number; burstCost: number; shoveCost: number;
  openerTelegraphTicks: number; chainTelegraphTicks: number; feintWindowTicks: number; guardRaiseTicks: number; perfectGuardTicks: number;
  breakLine: number; closeRangeMm: number; edgeBandMm: number; minGapMm: number; stepMm: number; burstMm: number;
  escapeCost: number; chargeCost: number; chargeMaxStartMm: number; shoveOnHeavyInClose: boolean;
  /** duel-rules-5 SYNC spend policy: the half / full special SYNC costs (rules specialHalfSync / specialFullSync). */
  specialHalfSync?: number; specialFullSync?: number;
};
const costOf = (r: AiRules, s: number) => (s === Strike.Heavy ? r.heavyCost : s === Strike.Special ? r.specialCost : r.lightCost);
type AiObs = {
  tick: number; side: number; self: AiView; opponent: AiView; selfKit: AiKit; opponentKit: AiKit; phase: number;
  exchangeTicks: number; pairReachMm: number; ringRadiusMm: number; selfTagged: boolean;
  /** duel-rules-5 (#72.78): the SYNC spend policy is on (the core runs the attrs block). False/absent on duel-rules-3/-4, where the
   * brain is byte-for-byte today's (no extra draws). */
  syncSpend?: boolean;
};
type AiIntent = { moveX: number; moveZ: number; guard: boolean; press: number; stepX: number; stepZ: number };

// ---------------------------------------------------------------- FightBrain

const Mode = { Approach: 0, Stalk: 1, Engage: 2, Retreat: 3 } as const;
const HIST_LEN = 32, THINK_EVERY = 3, FEINT_AT_AGE = 7, NO_TICK = -2147483648;
export const EXCHANGE_PLAN_BASE_TICKS = 24, EXCHANGE_PLAN_PER_CHAIN_X10 = 12, EXCHANGE_PLAN_SPREAD_TICKS = 30, EXIT_MARGIN_MM = 600;
export const STRIKE_MARGIN_MM = 900;

const clampI = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** duel-rules-5 SYNC spend table by rank (Rookie .. Legendary; #72.78 producer pick, Pak tunes), FightBrain.SyncDiscipline /
 * SyncHalfRateBps / SyncFullRateBps. Discipline: 0 = any in-reach moment, 1 = + the target is not guarding, 2 = + not stepping /
 * bursting / escaping and the spend keeps it above the break line, prime windows at twice the rate; outside one the half tier is
 * spent only below SYNC_BANK_FROM (then x SYNC_OFF_PRIME_HALF_PM / 1000), 3 = discipline 2 at the top rates (#72.79 tune). */
export const SYNC_DISCIPLINE: readonly number[] = [0, 1, 1, 2, 3, 3];
export const SYNC_HALF_RATE_BPS: readonly number[] = [2500, 3500, 4500, 6000, 7500, 9000];
export const SYNC_FULL_RATE_BPS: readonly number[] = [3500, 4500, 6000, 8000, 10000, 10000];
/** FightBrain.SyncOffPrimeHalfPm / SyncBankFrom (#72.79). */
export const SYNC_OFF_PRIME_HALF_PM: readonly number[] = [1000, 1000, 1000, 1000, 1000, 1000];
export const SYNC_BANK_FROM: readonly number[] = [100, 100, 100, 80, 70, 70];
/** FightBrain.RankIndex: the issued rank's row in RANKS (case-insensitive); an unknown rank reads Champion. */
export function rankIndex(rank: string): number {
  const r = String(rank).toLowerCase();
  for (let i = 0; i < RANKS.length; i++) if (RANKS[i].toLowerCase() === r) return i;
  return 2;
}
const roll = (rng: FightRng, bps: number) => bps > 0 && (bps >= 10000 || rng.below(10000) < bps);

/** FightBrain.Isqrt: floor sqrt by Newton from above (a different iteration from FightMath.Isqrt; same floor value). */
export function brainIsqrt(n: number): number {
  if (n <= 0) return 0;
  let bits = 0; for (let m = n; m > 0; m = Math.floor(m / 2)) bits++;
  let x = 2 ** div(bits + 1, 2);
  for (;;) { const y = div(x + div(n, x), 2); if (y >= x) return x; x = y; }
}

export class FightBrain {
  private readonly hist: AiView[] = new Array(HIST_LEN);
  private histCount = 0;
  private mode: number = Mode.Approach;
  private chainLeft = 0;
  private nextKind: number = Strike.None;
  private openerFeint = false; private feintPending = false; private burstTried = false; private postChain = false; private shell = false;
  private feintPressTick = -1000;
  private lastSeenTele = NO_TICK; private lastSeenFeint = NO_TICK; private lastPunishKey = NO_TICK; private beatAgainst = NO_TICK;
  private guardFrom = -1; private guardUntil = -2;
  private circleDir = 1;
  private retreatTarget = 0;
  private lastOwnRecoveryEnd = -1000;
  private exchSeen = NO_TICK; private exchPlanEnd = 0; private exiting = false;
  private guardedContact = NO_TICK;
  private prevAct: number = Act.Free;
  private escapeTried = false; private chargeTried = false;   // r3: one quick-escape roll per retreat, one ShoulderCharge roll per chain
  private chargeFollowAt = -1;                                 // r3: the tick to press the Strike that turns its sidestep into the charge
  /** FightBrainStats subset: duel-rules-5 SYNC spend policy finishers pressed at the 50 / 100 tier (#72.78). */
  readonly stats = { halfSpends: 0, fullSpends: 0 };

  constructor(readonly profile: BrainProfile, readonly skill: BrainSkill, private readonly r: AiRules) {
    const why = profileIsValid(profile);
    if (why) throw new RangeError('invalid_profile:' + profile.id + ':' + why);
    if (skill.reactionTicks < 0 || skill.reactionTicks >= HIST_LEN) throw new RangeError('invalid_reaction');
  }

  private perceived(lag: number): AiView {
    const back = Math.min(lag, this.histCount - 1);
    return this.hist[(this.histCount - 1 - back) % HIST_LEN];
  }

  private affords(s: AiView, k: number): boolean { return s.stamina - costOf(this.r, k) >= this.r.breakLine + 1000; }

  private startChain(rng: FightRng, forced: number): void {
    this.burstTried = false; this.postChain = false; this.nextKind = Strike.None; this.chargeTried = false;
    if (forced >= 0) { this.chainLeft = forced; if (forced > 0) this.mode = Mode.Engage; return; }
    const P = this.profile;
    const a = div(P.chainMeanX10, 10);
    const b = rng.below(10) < P.chainMeanX10 % 10 ? 1 : 0;
    const c = rng.below(3);
    this.chainLeft = clampI(a + b + c - 1, 2, 6);
  }

  private pickKind(rng: FightRng, s: AiView, o: AiView, d: number, kit: AiKit): number {
    const P = this.profile, R = this.r;
    let special: boolean;
    switch (P.special) {
      case SpecialPolicy.HalfSync: special = s.sync >= 50; break;
      case SpecialPolicy.FullSync: special = s.sync >= 100; break;
      case SpecialPolicy.FullSyncOnBreak: special = s.sync >= 100 && o.breaking; break;
      default: special = false; break;
    }
    if (special && s.stamina >= R.specialCost) return Strike.Special;
    if (d > threat(kit, Strike.Light) && kit.heavyLungeMm > kit.lightLungeMm && s.stamina - div(R.heavyCost * 18, 10) >= R.breakLine + 2000
      && roll(rng, Math.max(P.heavyRatioBps, 5000))) return Strike.Heavy;
    if (s.stamina >= R.heavyCost && roll(rng, P.heavyRatioBps)) return Strike.Heavy;
    return Strike.Light;
  }

  think(obs: AiObs, rng: FightRng): AiIntent {
    const P = this.profile, K = this.skill, R = this.r;
    this.hist[this.histCount % HIST_LEN] = obs.opponent; this.histCount++;
    const o = this.perceived(Math.max(0, K.reactionTicks - 1));
    const s = obs.self;
    const t = obs.tick;
    const kit = obs.selfKit;

    if (this.prevAct === Act.Recovery && s.act !== Act.Recovery) this.lastOwnRecoveryEnd = t;
    if (s.act === Act.Stagger && this.mode !== Mode.Retreat) {
      this.shell = true; this.guardFrom = t; this.guardUntil = Math.max(this.guardUntil, s.actEndTick + 6); this.chainLeft = 0; this.nextKind = Strike.None;
      if (this.mode === Mode.Engage) this.mode = Mode.Stalk;
    }
    this.prevAct = s.act;

    const dxl = o.x - s.x, dzl = o.z - s.z;
    const d = brainIsqrt(dxl * dxl + dzl * dzl);
    const free = s.act === Act.Free && t >= s.actEndTick;
    const ownTele = s.act === Act.Telegraph;
    const buffering = s.act === Act.Recovery && s.actEndTick - t <= 6;
    const think = t % THINK_EVERY === 0;
    const edgeOuter = obs.pairReachMm + R.edgeBandMm;
    let press: number = AiPress.None;
    let stepX = 0, stepZ = 0;

    let ux = 0, uz = 127;
    if (d > 0) { ux = div(dxl * 127, d); uz = div(dzl * 127, d); }
    const px = -uz, pz = ux;

    // ---- r3: the second half of a ShoulderCharge (Step>Light) ----
    if (this.chargeFollowAt >= 0 && t >= this.chargeFollowAt) {
      const follow = t === this.chargeFollowAt && s.act === Act.Step;
      this.chargeFollowAt = -1;
      if (follow) press = AiPress.Strike;
    }

    // ---- A. a newly perceived telegraph: guard (perfect-timed by rank), step out, or beat it ----
    if (o.act === Act.Telegraph && o.actStartTick !== this.lastSeenTele) {
      this.lastSeenTele = o.actStartTick;
      if (d <= threat(obs.opponentKit, o.strike) + 300) {
        const remaining = o.contactTick - t;
        const myTele = (t - this.lastOwnRecoveryEnd <= 9 ? R.chainTelegraphTicks : R.openerTelegraphTicks) + (s.stamina < R.breakLine ? 3 : 0);
        const canBeat = free && !s.guardHeld && myTele < remaining && d <= threat(kit, Strike.Light) && this.affords(s, Strike.Light);
        if (canBeat && roll(rng, div(P.counterRateBps * P.beatShareBps, 10000))) {
          press = AiPress.Strike; this.beatAgainst = o.actStartTick;
        } else if (!ownTele) {
          if (roll(rng, P.guardRateBps) || !(free || s.guardHeld) || s.stamina < R.stepCost + 2000) {
            const pgAt = o.contactTick - (R.guardRaiseTicks + 1);
            if (pgAt >= t && roll(rng, K.perfectGuardBps)) this.guardFrom = pgAt;
            else this.guardFrom = t;
            this.guardUntil = o.contactTick + 3;
            this.shell = true; this.guardedContact = o.contactTick;
          } else {
            press = AiPress.Step;
            if (roll(rng, P.circleBiasBps)) { stepX = px * this.circleDir - div(ux, 3); stepZ = pz * this.circleDir - div(uz, 3); }
            else { stepX = -ux; stepZ = -uz; }
            this.guardUntil = -2; this.shell = false;
          }
        }
      }
    }

    // ---- A2. guard discipline ----
    if (this.shell) {
      const swinging = o.act === Act.Telegraph || (o.act === Act.Recovery && o.actEndTick - (t - K.reactionTicks) <= 12);
      if (swinging && !ownTele) {
        if (this.guardFrom < 0 || this.guardUntil < t) this.guardFrom = t;
        this.guardUntil = Math.max(this.guardUntil, t + 4);
      } else if (o.act !== Act.Telegraph && o.act !== Act.Recovery) this.shell = false;
    }

    // ---- B. a perceived feint cancel ----
    if (o.act === Act.FeintRecovery && o.actStartTick !== this.lastSeenFeint) {
      this.lastSeenFeint = o.actStartTick;
      const bitWithStrike = ownTele && this.beatAgainst !== NO_TICK && t - s.actStartTick <= R.feintWindowTicks;
      const bitWithGuard = this.guardUntil >= t;
      if (bitWithStrike || bitWithGuard) {
        if (roll(rng, K.feintReadBps)) {
          if (bitWithStrike && press === AiPress.None) press = AiPress.Feint;
          this.guardUntil = -2;
        }
      }
      if (free && press === AiPress.None && d <= threat(kit, Strike.Light) && this.affords(s, Strike.Light)) {
        if (roll(rng, P.counterRateBps)) { press = AiPress.Strike; this.startChain(rng, 1); }
      }
    }

    // ---- C. punish windows ----
    if (press === AiPress.None && (free || buffering)) {
      const ownWindow = s.counterUntilTick >= t;
      const key = ownWindow ? s.counterUntilTick * 2 + 1 : ((o.act === Act.Recovery || o.act === Act.Escape) && o.punishable ? o.actStartTick * 2 : NO_TICK);
      if (key !== NO_TICK && key !== this.lastPunishKey && d <= threat(kit, Strike.Heavy) && this.affords(s, Strike.Light)) {
        this.lastPunishKey = key;
        if (roll(rng, P.counterRateBps)) {
          const fin = (P.special === SpecialPolicy.FullAsCounter && s.sync >= 100) || (P.special === SpecialPolicy.HalfAfterPerfectGuard && ownWindow && s.sync >= 50);
          if (fin && d <= threat(kit, Strike.Special)) press = AiPress.Finisher;
          else if (this.affords(s, Strike.Heavy) && roll(rng, Math.max(P.heavyRatioBps, 3000))) press = AiPress.Heavy;
          else press = AiPress.Strike;
          this.startChain(rng, 0);
          this.guardUntil = -2;
        }
      }
    }

    // ---- C2. read punish ----
    if (press === AiPress.None && this.guardedContact !== NO_TICK && t === this.guardedContact + 1) {
      this.guardedContact = NO_TICK;
      if (s.guardHeld && !ownTele && d <= threat(kit, Strike.Light) && this.affords(s, Strike.Light)) {
        if (roll(rng, P.counterRateBps)) {
          press = this.affords(s, Strike.Heavy) && d <= threat(kit, Strike.Heavy) && roll(rng, Math.max(P.heavyRatioBps, 3000)) ? AiPress.Heavy : AiPress.Strike;
          this.startChain(rng, 0); this.guardUntil = -2; this.shell = false;
        }
      }
    } else if (this.guardedContact !== NO_TICK && t > this.guardedContact + 1) this.guardedContact = NO_TICK;

    // ---- D. my own planned feint ----
    if (this.feintPending && !ownTele && t > this.feintPressTick + 2) this.feintPending = false;
    if (press === AiPress.None && ownTele && this.feintPending && t - s.actStartTick >= FEINT_AT_AGE && t - s.actStartTick <= R.feintWindowTicks) {
      press = AiPress.Feint; this.feintPending = false;
      if (this.chainLeft === 0) { this.mode = Mode.Engage; this.chainLeft = 1; }
    }

    // ---- D2. the exchange plan ----
    const exStart = obs.exchangeTicks > 0 ? t - obs.exchangeTicks : NO_TICK;
    if (exStart === NO_TICK) this.exiting = false;
    else if (exStart !== this.exchSeen) {
      this.exchSeen = exStart; this.exiting = false;
      this.exchPlanEnd = exStart + EXCHANGE_PLAN_BASE_TICKS + div(P.chainMeanX10 * EXCHANGE_PLAN_PER_CHAIN_X10, 10) + rng.below(EXCHANGE_PLAN_SPREAD_TICKS);
    }
    if (exStart !== NO_TICK && !this.exiting && t >= this.exchPlanEnd && this.chainLeft === 0 && !ownTele && !this.feintPending) this.exiting = true;

    // ---- E. mode / break discipline ----
    let aggr = P.aggressionBps;
    if (s.hp * 100 < 35 * s.maxHp) aggr = Math.min(10000, div(aggr * P.lowHpRiskBps, 10000));

    if (this.mode !== Mode.Retreat) {
      const engagedish = obs.phase === Phase.Exchange || obs.phase === Phase.Close || d <= edgeOuter;
      if (s.breaking || (s.stamina < P.breakAtStamina && engagedish && !ownTele)) {
        if (!s.breaking && press === AiPress.None) press = AiPress.Disengage;
        this.mode = Mode.Retreat; this.chainLeft = 0; this.openerFeint = false; this.feintPending = false; this.nextKind = Strike.None; this.shell = false;
        this.retreatTarget = Math.min(100000, Math.max(P.engageMinStamina, P.breakAtStamina + 15000));
        this.escapeTried = false;
      }
    }
    // r3 quick escape (evasive profiles only: escapeBps 0 never draws): once per retreat, from the fighter's own BREAK
    if (this.mode === Mode.Retreat && !this.escapeTried && press === AiPress.None && free && s.breaking && d <= edgeOuter + 500) {
      this.escapeTried = true;
      if (P.escapeBps > 0 && s.stamina >= R.escapeCost + 5000 && roll(rng, P.escapeBps)) { press = AiPress.Escape; stepX = -ux; stepZ = -uz; }
    }
    if (this.mode === Mode.Retreat && !s.breaking && s.stamina >= this.retreatTarget) this.mode = d > edgeOuter ? Mode.Approach : Mode.Stalk;
    if (this.mode === Mode.Approach && d <= edgeOuter) this.mode = Mode.Stalk;
    if (this.mode === Mode.Stalk && d > edgeOuter + 1500) this.mode = Mode.Approach;

    const inExchange = obs.phase === Phase.Exchange || obs.phase === Phase.Close;
    const needSta = inExchange || o.breaking ? Math.min(P.engageMinStamina, Math.max(P.breakAtStamina, R.breakLine) + 12000) : P.engageMinStamina;
    if (think && (this.mode === Mode.Stalk || this.mode === Mode.Approach) && this.chainLeft === 0 && s.stamina >= needSta && !this.shell && !this.exiting) {
      let hazard = div(aggr, div(30, THINK_EVERY));
      if (o.breaking) hazard *= 2;
      if (this.mode === Mode.Approach) hazard = div(hazard, 2);
      if (inExchange) hazard *= 3;
      if (roll(rng, hazard)) {
        this.mode = Mode.Engage; this.startChain(rng, -1);
        this.openerFeint = roll(rng, P.feintRateBps);
      }
    }
    if (think && this.mode !== Mode.Retreat && roll(rng, 120)) this.circleDir = -this.circleDir;

    // ---- F. engage: walk / burst in, then chain strikes ----
    if (this.mode === Mode.Engage && press === AiPress.None) {
      // r3 ShoulderCharge: an opener out of neutral inside the dash reach may be the dash attack (a sidestep now, the light next tick)
      if (!this.chargeTried && free && !inExchange && !this.openerFeint && P.chargeShareBps > 0 && d > R.closeRangeMm + 200 && d <= R.chargeMaxStartMm - 100
        && s.stamina - R.chargeCost >= R.breakLine + 2000) {
        this.chargeTried = true;
        if (roll(rng, P.chargeShareBps)) {
          press = AiPress.Step; stepX = px * this.circleDir; stepZ = pz * this.circleDir; this.chargeFollowAt = t + 1;
          this.nextKind = Strike.None; this.guardUntil = -2;
          if (--this.chainLeft <= 0) { this.chainLeft = 0; this.mode = Mode.Stalk; this.postChain = true; }
        }
      }
    }
    if (this.mode === Mode.Engage && press === AiPress.None) {
      if (this.nextKind === Strike.None) this.nextKind = this.pickKind(rng, s, o, d, kit);
      const thr = threat(kit, this.nextKind) - (lungeOf(kit, this.nextKind) > 1000 ? 200 : STRIKE_MARGIN_MM);
      if (d > thr) {
        if (!this.burstTried && free && d > thr + 600 && d <= thr + R.burstMm + 400) {
          this.burstTried = true;
          if (s.stamina >= R.burstCost + costOf(R, this.nextKind) + R.breakLine && roll(rng, P.burstInBps)) { press = AiPress.Step; stepX = ux; stepZ = uz; }
        }
      } else if ((free || buffering) && !this.postChain) {
        const floor = P.breakAtStamina <= R.breakLine ? 0 : P.breakAtStamina - 5000;
        if (this.nextKind !== Strike.Light && s.stamina - div(costOf(R, this.nextKind) * 18, 10) < Math.max(floor, R.breakLine + 2000)) this.nextKind = Strike.Light;
        if (s.stamina - R.lightCost < floor) { this.chainLeft = 0; this.mode = Mode.Stalk; this.postChain = true; this.nextKind = Strike.None; }
        else {
          press = this.nextKind === Strike.Heavy ? AiPress.Heavy : this.nextKind === Strike.Special ? AiPress.Finisher : AiPress.Strike;
          if (this.openerFeint) { this.feintPending = true; this.feintPressTick = t; this.openerFeint = false; }
          this.nextKind = Strike.None;
          this.guardUntil = -2;
          if (--this.chainLeft <= 0) { this.chainLeft = 0; this.mode = Mode.Stalk; this.postChain = !this.feintPending; }
        }
      }
    }

    // ---- S. duel-rules-5 SYNC spend (#72.78): spend the 50 % tier (half special) and the 100 % tier (finisher) in good windows;
    // discipline (which windows qualify) and aggression (how often it takes one) rise with the issued rank ----
    if (obs.syncSpend && press === AiPress.None && think && free && !s.guardHeld && s.sync >= R.specialHalfSync! && s.stamina >= R.specialCost) {
      const rank = rankIndex(K.rank), disc = SYNC_DISCIPLINE[rank];
      const full = s.sync >= R.specialFullSync!;
      let window = d <= threat(kit, Strike.Special) - 300;
      if (disc >= 1) window = window && !o.guardHeld;
      if (disc >= 2) window = window && o.act !== Act.Step && o.act !== Act.Burst && o.act !== Act.Escape && s.stamina - R.specialCost >= R.breakLine;
      if (window) {
        let rate = full ? SYNC_FULL_RATE_BPS[rank] : SYNC_HALF_RATE_BPS[rank];
        if (disc >= 2) {
          // prime windows: punishable recovery, breaking, staggered, own counter window, target below 35 % HP
          const prime = (o.act === Act.Recovery && o.punishable) || o.breaking || o.act === Act.Stagger || s.counterUntilTick >= t || o.hp * 100 <= 35 * o.maxHp;
          if (prime) rate = Math.min(10000, rate * 2);
          else if (!full) rate = s.sync >= SYNC_BANK_FROM[rank] ? 0 : div(rate * SYNC_OFF_PRIME_HALF_PM[rank], 1000);
        }
        if (roll(rng, div(rate, div(30, THINK_EVERY)))) {
          press = AiPress.Finisher; if (full) this.stats.fullSpends++; else this.stats.halfSpends++;
          this.nextKind = Strike.None; this.guardUntil = -2;
        }
      }
    }

    // ---- G. CLOSE: shove-out ----
    if (press === AiPress.None && think && free && obs.phase === Phase.Close && s.stamina >= R.shoveCost + R.breakLine
      && roll(rng, div(P.shoveRateBps, div(30, THINK_EVERY)))) press = AiPress.Shove;

    // ---- H. chase a breaking opponent with a banked finisher ----
    if (press === AiPress.None && free && P.special === SpecialPolicy.FullSyncOnBreak && s.sync >= 100 && o.breaking
      && d <= threat(kit, Strike.Special) && s.stamina >= R.specialCost) press = AiPress.Finisher;

    // ---- I. after a chain: step back out ----
    if (this.postChain && free && press === AiPress.None) {
      this.postChain = false;
      if (s.stamina >= R.stepCost + P.breakAtStamina && d <= threat(kit, Strike.Light) && roll(rng, 10000 - aggr)) {
        press = AiPress.Step;
        if (roll(rng, P.circleBiasBps)) { stepX = px * this.circleDir - div(ux, 2); stepZ = pz * this.circleDir - div(uz, 2); }
        else { stepX = -ux; stepZ = -uz; }
      }
    }

    // A tagged runner cannot recover STA. Once the core's BREAK ends, use a legal
    // stationary guard to turn and clear the tag; the core still owns tag/regen rules.
    if (this.mode === Mode.Retreat && obs.selfTagged && !s.breaking && free && press === AiPress.None) {
      // Match the normal issued guard window, rather than flashing a one-tick tap.
      this.guardFrom = t;
      this.guardUntil = Math.max(this.guardUntil, t + R.guardRaiseTicks + R.perfectGuardTicks);
      return { moveX: 0, moveZ: 0, guard: true, press: AiPress.None, stepX: 0, stepZ: 0 };
    }

    // ---- J. the held stick ----
    let radial: number, tang: number, mag: number;
    let pd = P.prefersClose ? R.closeRangeMm - 200 : Math.max(R.minGapMm + 300, Math.min(edgeOuter - 100, obs.pairReachMm + 500 + P.bandOffsetMm));
    const oppThreat = threat(obs.opponentKit, Strike.Light);
    if (oppThreat > threat(kit, Strike.Light) + 300) pd = Math.max(pd, oppThreat + 400);
    switch (this.mode) {
      case Mode.Approach:
        radial = 127; tang = div(this.circleDir * 127 * P.circleBiasBps, 20000); mag = 127; break;
      case Mode.Stalk:
        if (s.stamina < needSta && !inExchange) pd = edgeOuter + 900;
        if (this.exiting) pd = Math.max(pd, Math.max(oppThreat, threat(kit, Strike.Light)) + EXIT_MARGIN_MM);
        radial = clampI(div((d - pd) * 127, 500), -127, 127); tang = div(this.circleDir * 127 * P.circleBiasBps, 10000);
        mag = Math.max(40, Math.min(127, Math.abs(radial) + div(Math.abs(tang), 2))); break;
      case Mode.Engage: {
        const k = this.nextKind === Strike.None ? Strike.Light : this.nextKind;
        const strikeAt = threat(kit, k) - (lungeOf(kit, k) > 1000 ? 200 : STRIKE_MARGIN_MM);
        const want = P.prefersClose ? R.closeRangeMm - 200 : Math.max(R.closeRangeMm + 150, Math.min(kit.contactReachMm - 300, strikeAt - 300));
        radial = clampI(div((d - want) * 127, 300), -127, 127); tang = div(this.circleDir * 127 * P.circleBiasBps, 40000); mag = 127; break;
      }
      default:
        radial = d > edgeOuter + 1200 ? clampI(div((edgeOuter + 1400 - d) * 127, 500), -127, 60) : -127;
        tang = div(this.circleDir * 127 * P.circleBiasBps, 10000); mag = 127; break;
    }
    const sx = s.x, sz = s.z;
    if (sx * sx + sz * sz > (obs.ringRadiusMm - 2000) * (obs.ringRadiusMm - 2000)) {
      const outward = sx * (radial * ux + tang * px) + sz * (radial * uz + tang * pz);
      if (outward > 0) {
        if ((sx * px + sz * pz) * this.circleDir > 0) this.circleDir = -this.circleDir;
        tang = this.circleDir * 127; if (radial < 0) radial = -20;
      }
    }
    let mx = div(radial * ux + tang * px, 127), mz = div(radial * uz + tang * pz, 127);
    const len = brainIsqrt(mx * mx + mz * mz);
    if (len > 0 && mag > 0) { mx = div(mx * mag, len); mz = div(mz * mag, len); } else { mx = 0; mz = 0; }

    const guard = this.guardFrom >= 0 && t >= this.guardFrom && t <= this.guardUntil && press === AiPress.None && !ownTele;
    if (press === AiPress.Heavy && R.shoveOnHeavyInClose && obs.phase === Phase.Close) press = AiPress.Strike;
    if (press === AiPress.Step && stepX === 0 && stepZ === 0) { stepX = -ux; stepZ = -uz; }
    return { moveX: clampI(mx, -127, 127), moveZ: clampI(mz, -127, 127), guard, press, stepX: clampI(stepX, -127, 127), stepZ: clampI(stepZ, -127, 127) };
  }
}

// ---------------------------------------------------------------- FightCoreBrain (the seam onto the core)

function kitOf(d: FightFighterDef, r: FightRules): AiKit {
  return {
    runMmPerTick: div(d.runMmPerSec, TICK_HZ), primaryReachMm: d.primaryReachMm, contactReachMm: d.reachLightMm,
    lightLungeMm: d.reachLightMm <= r.closeKitReachMm ? r.closeKitLungeMm : r.lungeLightMm,
    heavyLungeMm: Math.max(0, d.reachHeavyMm - d.reachLightMm) + r.lungeHeavyMm,
    specialLungeMm: Math.max(0, d.reachSpecialMm - d.reachLightMm) + r.lungeSpecialMm,
    chargeReachMm: r.chargeReachMm, chargeLungeMm: r.chargeDashMm,
  };
}

function mapView(v: FightFighterView): AiView {
  let act: number;
  switch (v.action) {
    case Action.Telegraph: act = Act.Telegraph; break;
    case Action.Recovery: act = Act.Recovery; break;
    case Action.Step: act = v.loco === Loco.ForwardJump ? Act.Burst : Act.Step; break;
    case Action.Shove: act = Act.Shove; break;
    case Action.FeintRecovery: act = Act.FeintRecovery; break;
    case Action.Escape: act = Act.Escape; break;
    case Action.Stun: case Action.Ko: act = Act.Stagger; break;
    default: act = Act.Free; break;
  }
  const tel = v.action === Action.Telegraph;
  return {
    x: v.xMm, z: v.zMm, hp: v.hp, maxHp: v.maxHp, stamina: v.staminaPm * 100, sync: v.sync, act, strike: v.move,
    actStartTick: tel ? v.telegraphStartTick : v.actionUntilTick, contactTick: tel ? v.contactTick : -1, actEndTick: v.actionUntilTick,
    guardHeld: v.guard === Guard.Raising || v.guard === Guard.Up, guardUp: v.guard === Guard.Up,
    punishable: (v.action === Action.Recovery || v.action === Action.Escape) && v.punishableUntil > v.tick, punishableUntilTick: v.punishableUntil,
    breaking: v.state === State.Break, counterUntilTick: v.counterWindowUntil - 1,
  };
}

const axis = (v: number) => (v < -127 ? -127 : v > 127 ? 127 : v);

/** The shipped CPU on the core seam: the issued profile's id selects the row; the issued fields win (FightCoreBrain). */
export class FightCoreBrain implements FightBrainDriver {
  private inner: FightBrain | null = null;
  private aiRules!: AiRules;
  private side = 0;
  private issuedProfile: FightProfile | null = null;
  private issuedSkill: FightSkill | null = null;
  /** The inner FightBrain (null until the first decide); its `stats` carry the SYNC spend counts. */
  get brain(): FightBrain | null { return this.inner; }

  begin(side: number, profile: FightProfile | null, skill: FightSkill | null): void {
    this.side = side; this.issuedProfile = profile; this.issuedSkill = skill; this.inner = null;
  }

  private init(v: FightView): void {
    const R = v.rules, me = v.selfDef;
    this.aiRules = {
      lightCost: R.costLightPm * 100, heavyCost: R.costHeavyPm * 100, specialCost: R.costSpecialPm * 100, feintCost: R.costFeintPm * 100,
      stepCost: R.costStepPm * 100, burstCost: R.costBurstPm * 100, shoveCost: R.costShovePm * 100,
      openerTelegraphTicks: R.telegraphTicks, chainTelegraphTicks: R.chainTelegraphTicks, feintWindowTicks: R.feintWindowTicks,
      guardRaiseTicks: R.guardRaiseTicks, perfectGuardTicks: R.perfectGuardTicks, breakLine: R.breakLinePm * 100,
      closeRangeMm: R.closeRangeMm, edgeBandMm: R.edgeBandMm, minGapMm: R.minGapMm, stepMm: me.backstepMm, burstMm: me.forwardJumpMm,
      escapeCost: R.costEscapePm * 100, chargeCost: (R.costLightPm + R.costChargeDashPm) * 100, chargeMaxStartMm: R.minGapMm + R.chargeDashMm,
      shoveOnHeavyInClose: R.shoveOnHeavyInClose !== 0, specialHalfSync: R.specialHalfSync, specialFullSync: R.specialFullSync,
    };
    if (!this.issuedProfile || !this.issuedSkill) throw new RangeError('brain_unissued');
    this.inner = new FightBrain(brainFromIssued(this.issuedProfile), skillFromIssued(this.issuedSkill), this.aiRules);
  }

  decide(v: FightView, rng: FightRng): FightInput {
    if (!this.inner) this.init(v);
    const self = v.self, opp = v.opponent(0);
    const t = v.tick + 1, d = v.distanceMm, R = v.rangeRMm, ar = this.aiRules;
    const phase = v.exchangeActive ? (d <= ar.closeRangeMm ? Phase.Close : Phase.Exchange)
      : d <= ar.closeRangeMm ? Phase.Close : d > R + ar.edgeBandMm ? Phase.Out : Phase.Edge;
    const obs: AiObs = {
      tick: t, side: this.side, self: mapView(self), opponent: mapView(opp), selfKit: kitOf(v.selfDef, v.rules), opponentKit: kitOf(v.opponentDef, v.rules),
      selfTagged: v.core.tagged(this.side), syncSpend: v.core.attrs !== null,
      phase, exchangeTicks: v.exchangeActive ? t - v.exchangeStartTick : 0, pairReachMm: R, ringRadiusMm: v.rules.ringRadiusMm,
    };
    const it = this.inner!.think(obs, rng);
    const inp = idleInput();
    inp.moveX = axis(it.moveX); inp.moveZ = axis(it.moveZ); inp.guard = it.guard;
    switch (it.press) {
      case AiPress.Strike: inp.press = Press.Light; break;
      case AiPress.Heavy: inp.press = Press.Heavy; break;
      case AiPress.Finisher: inp.press = Press.Special; inp.specialTier = self.sync >= v.rules.specialFullSync ? 2 : 1; break;
      case AiPress.Feint: inp.press = Press.Feint; break;
      case AiPress.Step: inp.press = Press.Step; inp.stepX = axis(it.stepX); inp.stepZ = axis(it.stepZ); break;
      case AiPress.Shove: inp.press = Press.Shove; break;
      case AiPress.Disengage: inp.press = Press.Disengage; break;
      case AiPress.Escape: inp.press = Press.DoubleTap; inp.stepX = axis(it.stepX); inp.stepZ = axis(it.stepZ); break;
    }
    return inp;
  }
}

/** FightStubBrain (fight-core-1's CPU-vs-CPU smoke brain; the frozen cpu-stub-smoke vectors drive it). */
export class FightStubBrain implements FightBrainDriver {
  private lag = 6; private guardHold = 0;
  begin(_side: number, _profile: FightProfile | null, skill: FightSkill | null): void {
    this.lag = skill && skill.reactionTicks > 0 ? skill.reactionTicks : 6; this.guardHold = 0;
  }
  decide(v: FightView, rng: FightRng): FightInput {
    const me = v.self, op = v.opponent(this.lag), def = v.selfDef;
    const inp = idleInput();
    const dx = op.xMm - me.xMm, dz = op.zMm - me.zMm, d = dist(dx, dz);
    const tx = d === 0 ? 0 : div(dx * 127, Math.max(1, d)), tz = d === 0 ? 0 : div(dz * 127, Math.max(1, d));
    if (me.action === Action.Ko) return inp;
    if (this.guardHold > 0) { this.guardHold--; inp.guard = true; return inp; }
    if (op.action === Action.Telegraph && me.action === Action.Idle && d <= 4500 && rng.chance(350)) {
      if (rng.chance(600)) { this.guardHold = 12; inp.guard = true; }
      else inp.press = Press.Step;
      return inp;
    }
    if (me.staminaPm < 350 && d < v.rangeRMm + 1500) { inp.moveX = -tx; inp.moveZ = -tz; return inp; }
    if (d > def.reachLightMm - 200) { inp.moveX = tx; inp.moveZ = tz; return inp; }
    if (me.action === Action.Idle && rng.chance(180)) {
      inp.press = rng.chance(250) ? Press.Heavy : Press.Light;
      if (me.sync >= 50 && rng.chance(200)) { inp.press = Press.Special; inp.specialTier = me.sync >= 100 ? 2 : 1; }
      return inp;
    }
    if (rng.chance(500)) { inp.moveX = -tz; inp.moveZ = tx; }
    return inp;
  }
}
