import { FightProfile, FightSkill, State } from './contracts';

/**
 * fight-ai-1 personalities + rank skill rows, ported from HolobotsUnity `Sim/Ai/FightProfile.cs` (fight-tune-1 re-tune).
 * The brain-side row is basis points / milli-percent; the ISSUED (host-served) row is the duel-sim-3 FightProfile in
 * per-mille. Style only: nothing here touches stats, damage, rewards or outcomes (rule 1).
 */
export const SpecialPolicy = { Never: 0, HalfSync: 1, FullSyncOnBreak: 2, FullAsCounter: 3, HalfAfterPerfectGuard: 4, FullSync: 5 } as const;

/** Brain-side profile (FightAi FightProfile). */
export type BrainProfile = {
  id: string; style: string; aggressionBps: number; engageMinStamina: number; bandOffsetMm: number; prefersClose: boolean;
  chainMeanX10: number; heavyRatioBps: number; feintRateBps: number; guardRateBps: number; counterRateBps: number; beatShareBps: number;
  breakAtStamina: number; circleBiasBps: number; shoveRateBps: number; burstInBps: number; lowHpRiskBps: number; special: number;
};

export const PROFILES_VERSION = 1;
export const PROFILE_ROSTER_IDS = ['ace', 'wolf', 'gama', 'hare', 'ken', 'kuma', 'kurai', 'era', 'shadow', 'tora', 'tsuin', 'wake', 'jusan'] as const;

function P(id: string, style: string, aggr: number, engageMin: number, band: number, close: boolean, chain: number, heavy: number, feint: number,
  guard: number, counter: number, beat: number, breakAt: number, circle: number, shove: number, burst: number, lowHp: number, sp: number): BrainProfile {
  return { id, style, aggressionBps: aggr, engageMinStamina: engageMin, bandOffsetMm: band, prefersClose: close, chainMeanX10: chain, heavyRatioBps: heavy,
    feintRateBps: feint, guardRateBps: guard, counterRateBps: counter, beatShareBps: beat, breakAtStamina: breakAt, circleBiasBps: circle,
    shoveRateBps: shove, burstInBps: burst, lowHpRiskBps: lowHp, special: sp };
}
const S = SpecialPolicy;

/** FightProfiles.All(), in PROFILE_ROSTER_IDS order (literal copy; parity-pinned against the C# oracle dump). */
export function allBrainProfiles(): BrainProfile[] {
  return [
    //  id        style                        aggr  engMin band close chain heavy feint guard ctr  beat  break  circle shove burst lowHp special
    P('ace', 'hover-boxer', 5500, 70000, 0, false, 30, 3000, 1500, 5000, 4000, 2500, 40000, 6500, 1000, 5500, 10000, S.FullSync),
    P('wolf', 'pressure / swarmer', 7000, 65000, -300, false, 35, 2500, 1500, 4500, 3000, 3000, 30000, 7000, 2000, 6000, 12000, S.HalfSync),
    P('gama', 'grappler-ish plate-shield', 5500, 65000, -800, false, 25, 3500, 2500, 5000, 4500, 1000, 35000, 3000, 5000, 4000, 10000, S.HalfAfterPerfectGuard),
    P('hare', 'out-fighter / darter', 7000, 65000, 300, false, 20, 2000, 1500, 5000, 4500, 2000, 40000, 9000, 0, 9500, 9000, S.HalfSync),
    P('ken', 'counter striker', 5500, 70000, 200, false, 20, 3500, 2000, 5000, 7000, 1500, 50000, 4000, 1000, 2500, 9000, S.HalfAfterPerfectGuard),
    P('kuma', 'brawler / tank', 5000, 60000, 0, true, 30, 4500, 500, 5000, 2500, 1000, 35000, 2000, 3000, 3000, 13000, S.FullSyncOnBreak),
    P('kurai', 'darter swordsman', 6500, 70000, 600, false, 15, 3000, 2000, 4500, 5000, 3000, 45000, 8000, 0, 7000, 8500, S.HalfSync),
    P('era', 'zoner', 5500, 65000, 900, false, 20, 4000, 1500, 4500, 4000, 2000, 42000, 8500, 0, 5000, 9000, S.FullSync),
    P('shadow', 'iaido counter', 4800, 65000, 800, false, 15, 5000, 3500, 3500, 8000, 7000, 45000, 5000, 0, 2000, 8000, S.FullAsCounter),
    P('tora', 'pouncer', 5500, 70000, 0, false, 20, 6500, 500, 5000, 3000, 1000, 40000, 3000, 2500, 8500, 12000, S.FullSync),
    P('tsuin', 'twin-blade rhythm', 5500, 70000, -200, false, 40, 1000, 1000, 5000, 3000, 2500, 35000, 6000, 1000, 4500, 11000, S.HalfSync),
    P('wake', 'heavyweight', 5000, 65000, 0, true, 30, 4500, 500, 4500, 3500, 1500, 35000, 3000, 3000, 1500, 11000, S.FullSyncOnBreak),
    P('jusan', 'blade-knight (Zell)', 6000, 70000, 0, false, 30, 3500, 2000, 5000, 5000, 2500, 40000, 5500, 2000, 5000, 10000, S.FullSync),
  ];
}

export function brainProfile(id: string): BrainProfile {
  const p = allBrainProfiles().find(x => x.id === id);
  if (!p) throw new RangeError('unknown_profile:' + id);
  return p;
}

export function profileIsValid(p: BrainProfile): string | null {
  const bps = (v: number) => v >= 0 && v <= 10000;
  if (!p.id || p.id !== p.id.toLowerCase()) return 'id';
  if (![p.aggressionBps, p.heavyRatioBps, p.feintRateBps, p.guardRateBps, p.counterRateBps, p.beatShareBps, p.circleBiasBps, p.shoveRateBps, p.burstInBps].every(bps)) return 'bps';
  if (p.breakAtStamina < 30000 || p.breakAtStamina > 90000) return 'breakAt';
  if (p.engageMinStamina < 30000 || p.engageMinStamina > 100000) return 'engageMin';
  if (p.chainMeanX10 < 10 || p.chainMeanX10 > 60) return 'chain';
  if (p.lowHpRiskBps < 2000 || p.lowHpRiskBps > 20000) return 'lowHp';
  return null;
}

/** FightProfiles.ToIssued: the host-served per-mille row (integer division, as C#). */
export function issuedProfile(p: BrainProfile): FightProfile {
  const t = Math.trunc;
  return {
    id: p.id, aggressionPmPerSec: t(p.aggressionBps / 10), engageMinStaminaPm: t(p.engageMinStamina / 100),
    preferredBand: p.prefersClose ? State.CloseRange : State.EdgeOfRange, preferredBandOffsetMm: p.bandOffsetMm,
    chainMeanMilli: p.chainMeanX10 * 100, heavyRatioPm: t(p.heavyRatioBps / 10), feintRatePm: t(p.feintRateBps / 10), guardRatePm: t(p.guardRateBps / 10),
    counterRatePm: t(p.counterRateBps / 10), breakAtStaminaPm: t(p.breakAtStamina / 100), circleBiasPm: t(p.circleBiasBps / 10), shoveRatePm: t(p.shoveRateBps / 10),
    specialPolicy: p.special, beatSharePm: t(p.beatShareBps / 10), burstInPm: t(p.burstInBps / 10), lowHpRiskPm: t(p.lowHpRiskBps / 10),
  };
}

/** FightProfiles.FromIssued: every issued field as served; the table row for its id supplies only Style. Unknown id throws. */
export function brainFromIssued(c: FightProfile): BrainProfile {
  const p = { ...brainProfile(c.id) };
  p.aggressionBps = c.aggressionPmPerSec * 10; p.engageMinStamina = c.engageMinStaminaPm * 100;
  p.prefersClose = c.preferredBand === State.CloseRange; p.bandOffsetMm = c.preferredBandOffsetMm;
  p.chainMeanX10 = Math.trunc(c.chainMeanMilli / 100); p.heavyRatioBps = c.heavyRatioPm * 10; p.feintRateBps = c.feintRatePm * 10; p.guardRateBps = c.guardRatePm * 10;
  p.counterRateBps = c.counterRatePm * 10; p.breakAtStamina = c.breakAtStaminaPm * 100; p.circleBiasBps = c.circleBiasPm * 10; p.shoveRateBps = c.shoveRatePm * 10;
  p.special = c.specialPolicy;
  p.beatShareBps = c.beatSharePm * 10; p.burstInBps = c.burstInPm * 10; p.lowHpRiskBps = c.lowHpRiskPm * 10;
  return p;
}

/** FightRankSkill.Table (linear across the six Mobile ranks; producer pick, Pak tunes). */
export const RANKS = ['Rookie', 'Starter', 'Champion', 'Rare', 'Elite', 'Legendary'] as const;
type RankRow = { rank: string; reactionTicks: number; feintReadBps: number; perfectGuardBps: number };
const RANK_TABLE: RankRow[] = [
  { rank: 'Rookie', reactionTicks: 15, feintReadBps: 3000, perfectGuardBps: 500 },
  { rank: 'Starter', reactionTicks: 13, feintReadBps: 4000, perfectGuardBps: 1100 },
  { rank: 'Champion', reactionTicks: 11, feintReadBps: 5000, perfectGuardBps: 1700 },
  { rank: 'Rare', reactionTicks: 9, feintReadBps: 6000, perfectGuardBps: 2300 },
  { rank: 'Elite', reactionTicks: 7, feintReadBps: 7000, perfectGuardBps: 2900 },
  { rank: 'Legendary', reactionTicks: 6, feintReadBps: 8000, perfectGuardBps: 3500 },
];

/** FightRankSkill.ToIssued(Get(rank)): case-insensitive rank -> the issued per-mille row (rank lowercased). */
export function issuedSkill(rank: string): FightSkill {
  const r = RANK_TABLE.find(x => x.rank.toLowerCase() === String(rank).toLowerCase());
  if (!r) throw new RangeError('unknown_rank:' + rank);
  return { rank: r.rank.toLowerCase(), reactionTicks: r.reactionTicks, feintReadPm: Math.trunc(r.feintReadBps / 10), perfectGuardPm: Math.trunc(r.perfectGuardBps / 10) };
}
export type BrainSkill = { rank: string; reactionTicks: number; feintReadBps: number; perfectGuardBps: number };
export function skillFromIssued(c: FightSkill): BrainSkill {
  return { rank: c.rank, reactionTicks: c.reactionTicks, feintReadBps: c.feintReadPm * 10, perfectGuardBps: c.perfectGuardPm * 10 };
}
