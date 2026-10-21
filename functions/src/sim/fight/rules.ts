import { hex, Int32Writer, sha256 } from './math';

/**
 * duel-rules-3: the issued, immutable rules snapshot (HolobotsUnity `Schemas/duel-rules-3.json`, `Sim/Fight/FightRules.cs`).
 * Every number the core uses is here; none is a client constant. Canonical hash order = GLOBAL_KEYS then per fighter
 * FIGHTER_KEYS (the C# arrays, same order). Defaults = the C# field initialisers (brief picks + producer D1-D5).
 */
export const SIM_VERSION = 'duel-sim-3';
export const RULES_SCHEMA = 'duel-rules-3';
export const TICK_HZ = 30;
export const MAX_ROSTER_PER_SIDE = 3;

export const RULE_DEFAULTS = {
  maxTicks: 5400, ringRadiusMm: 6000, minGapMm: 1000, closeRangeMm: 1300, edgeBandMm: 1500, exchangeGapTicks: 30, exchangeMinPresses: 2,
  regenOutPmPerSec: 200, regenEdgePmPerSec: 80, regenExchangePmPerSec: 15, regenClosePmPerSec: 10, regenBreakPmPerSec: 200, breakRegenDelayTicks: 9,
  regenDelayTicks: 12, guardRegenPm: 500,
  costLightPm: 80, costHeavyPm: 180, costSpecialPm: 200, costFeintPm: 30, costStepPm: 60, costBurstPm: 100, costShovePm: 80, multBlockedPm: 1150,
  multWhiffPm: 1800, multEvadedPm: 2500, railTicks: 180, railMultPm: 1500,
  breakLinePm: 300, breakMinTicks: 30, breakMaxTicks: 75, gassedTelegraphTicks: 3, emptyTelegraphTicks: 6, gassedDamagePm: 700, emptyDamagePm: 500,
  gassedDrainPm: 1500,
  telegraphTicks: 15, chainTelegraphTicks: 9, chainGapTicks: 9, chainMax: 4, chainDecayTicks: 2, chainCostPm: 1200, recoveryLightTicks: 8,
  recoveryHeavyTicks: 14, recoverySpecialTicks: 20, whiffHeavyExtraTicks: 11, whiffLightExtraTicks: 8, blockedRecoveryMinTicks: 18,
  feintWindowTicks: 10, feintRecoveryTicks: 5, facingCosPm: 707, lungeLightMm: 150, lungeHeavyMm: 300, lungeSpecialMm: 500, bufferTicks: 6,
  closeKitReachMm: 1500, closeKitLungeMm: 1800, closeKitDamagePm: 1300,
  guardRaiseTicks: 3, guardLowerTicks: 2, guardMovePm: 600, chipPm: 300, chipSpecialPm: 500, drainLightPm: 40, drainHeavyPm: 100, drainSpecialPm: 160,
  guardBreakStaggerTicks: 15, heavyPushbackMm: 300, pushbackTicks: 6,
  perfectGuardTicks: 5, perfectRecoveryExtraTicks: 9, counterWindowTicks: 18, counterPm: 1500,
  hardHitHpPm: 120, hitStunLightMaxTicks: 12, hitStunHeavyMaxTicks: 24, knockbackMm: 1000, knockbackTicks: 9,
  scaleLightPm: 1000, scaleHeavyPm: 1550, scaleSpecialPm: 2000, specialHalfEffectPm: 500, specialFullEffectPm: 1000, specialHalfSync: 50,
  specialFullSync: 100, syncLight: 10, syncHeavy: 14, syncBlockedPm: 500, maxSync: 100,
  shoveTicks: 8, shovePushMm: 800, shovePushTicks: 8, swapLockoutTicks: 90, swapShieldTicks: 23,
  // duel-sim-3 r3 (fight-tune-2; DECISIONS #72.25-#72.29): fight HP scale, Shove = heavy in CLOSE, quick escape, ShoulderCharge
  hpScaleLights: 19, shoveOnHeavyInClose: 1, costEscapePm: 100, escapeTurnTicks: 8, escapeNoGuardTicks: 12, escapeRunTicks: 24, escapeTurnBackTicks: 6,
  chargeWindowTicks: 6, chargeTelegraphTicks: 10, chargeRecoveryTicks: 7, costChargeDashPm: 100, chargeDashMm: 2500, chargeReachMm: 1500, scaleChargePm: 1200, chargePushMm: 600,
  chargePushTicks: 6,
};
export type RuleKey = keyof typeof RULE_DEFAULTS;
/** FightRules.GlobalKeys, camelCased, in hash order. */
export const GLOBAL_KEYS = Object.keys(RULE_DEFAULTS) as RuleKey[];

export const FIGHTER_DEFAULTS = {
  side: 0, maxHp: 1000, hp: 1000, attack: 100, defense: 50, startStaminaPm: 1000, startSync: 0, startXMm: 0, startZMm: 0, radiusMm: 300,
  primaryReachMm: 1500, reachLightMm: 1500, reachHeavyMm: 4000, reachSpecialMm: 4000, runMmPerSec: 3000, strafeMmPerSec: 600, backMmPerSec: 600,
  backstepMm: 600, backstepTicks: 22, sidestepMm: 600, sidestepTicks: 22, forwardJumpMm: 900, forwardJumpTicks: 31, hitLightTicks: 14, hitHeavyTicks: 29,
};
export type FighterKey = keyof typeof FIGHTER_DEFAULTS;
/** FightFighterDef.Keys, camelCased, in hash order. */
export const FIGHTER_KEYS = Object.keys(FIGHTER_DEFAULTS) as FighterKey[];

export type FightFighterDef = { id: string } & { [K in FighterKey]: number };
export type FightRulesValues = { [K in RuleKey]: number };
export type FightRules = FightRulesValues & { fighters: FightFighterDef[] };
/** The duel-rules-3 JSON document (the issued snapshot). */
export type DuelRules3Doc = {
  schemaVersion: typeof RULES_SCHEMA; simVersion: typeof SIM_VERSION; tickHz: typeof TICK_HZ;
  rules: FightRulesValues; fighters: FightFighterDef[];
};

export class FightRulesError extends RangeError {}
const fail = (code: string): never => { throw new FightRulesError(code); };

export function newFighter(id = 'a', side = 0): FightFighterDef {
  return { id, ...FIGHTER_DEFAULTS, side };
}
export function defaultRulesValues(): FightRulesValues {
  return { ...RULE_DEFAULTS };
}
export function cloneRules(r: FightRules): FightRules {
  return { ...r, fighters: r.fighters.map(f => ({ ...f })) };
}

/** FightKitDefaults rows (fallback per-bot kit + movement; the host issues them). Stats stay placeholders. */
const C = 1500, M = 4000, L = 8000;
//              id        light heavy special primary run   strafe back  bsMm bsT fjMm fjT hitL hitH
const KIT_ROWS: [string, number, number, number, number, number, number, number, number, number, number, number, number, number][] = [
  ['ace', C, M, L, M, 3200, 600, 600, 750, 17, 900, 31, 14, 29],
  ['wolf', M, M, M, C, 3000, 617, 610, 676, 22, 1242, 31, 13, 27],
  ['gama', M, M, M, C, 2000, 654, 654, 508, 22, 817, 31, 14, 29],
  ['hare', C, M, M, C, 3200, 735, 735, 479, 22, 784, 31, 14, 32],
  ['ken', M, M, M, C, 2600, 417, 417, 718, 22, 900, 31, 17, 35],
  ['kuma', C, M, M, C, 1600, 518, 518, 655, 25, 1092, 31, 23, 47],
  ['kurai', M, M, M, M, 2400, 745, 745, 649, 22, 900, 31, 15, 31],
  ['era', M, M, M, M, 2200, 314, 314, 358, 22, 732, 31, 14, 29],
  ['shadow', M, M, M, C, 3000, 696, 696, 670, 25, 773, 31, 15, 31],
  ['tora', M, M, M, C, 1600, 477, 477, 599, 22, 1078, 31, 23, 41],
  ['tsuin', M, M, M, C, 2600, 651, 651, 616, 22, 900, 31, 11, 26],
  ['wake', C, M, M, M, 2400, 894, 894, 520, 22, 975, 31, 20, 44],
  ['jusan', M, M, M, C, 2400, 625, 625, 750, 22, 900, 31, 24, 36],
];
export const KIT_IDS: readonly string[] = KIT_ROWS.map(r => r[0]);

/** FightKitDefaults.Fighter: the bot's kit row (unknown bot = unknown_bot). */
export function kitFighter(botId: string): FightFighterDef {
  const r = KIT_ROWS.find(x => x[0] === botId);
  if (!r) throw new FightRulesError('unknown_bot');
  return {
    ...newFighter(botId, 0), reachLightMm: r[1], reachHeavyMm: r[2], reachSpecialMm: r[3], primaryReachMm: r[4],
    runMmPerSec: r[5], strafeMmPerSec: r[6], backMmPerSec: r[7], backstepMm: r[8], backstepTicks: r[9], sidestepMm: r[8], sidestepTicks: r[9],
    forwardJumpMm: r[10], forwardJumpTicks: r[11], hitLightTicks: r[12], hitHeavyTicks: r[13],
  };
}

/** FightRules.Default: two kit fighters, side 0 at x = -gap/2. */
export function defaultRules(side0 = 'ace', side1 = 'wolf', startGapMm = 7000): FightRules {
  const a = kitFighter(side0), b = kitFighter(side1);
  b.side = 1;
  a.startXMm = -Math.trunc(startGapMm / 2); b.startXMm = startGapMm - Math.trunc(startGapMm / 2);
  return { ...defaultRulesValues(), fighters: [a, b] };
}

/** FightRules.Squad: up to 3 per side; every member starts at its side's spot. */
export function squadRules(side0: string[], side1: string[], startGapMm = 7000): FightRules {
  const fighters: FightFighterDef[] = [];
  for (const id of side0) { const f = kitFighter(id); f.side = 0; f.startXMm = -Math.trunc(startGapMm / 2); fighters.push(f); }
  for (const id of side1) { const f = kitFighter(id); f.side = 1; f.startXMm = startGapMm - Math.trunc(startGapMm / 2); fighters.push(f); }
  return { ...defaultRulesValues(), fighters };
}

/** Indices into rules.fighters of side `side`'s roster, in roster order. */
export function rosterOf(r: FightRules, side: number): number[] {
  const out: number[] = [];
  r.fighters.forEach((f, i) => { if (f.side === side) out.push(i); });
  return out;
}

const ID = /^[a-z0-9_-]{1,64}(?![\s\S])/;

export function validateFighter(f: FightFighterDef): void {
  if (typeof f.id !== 'string' || f.id.length < 1 || f.id.length > 64 || !ID.test(f.id)) fail('invalid_id');
  if (f.side < 0 || f.side > 1) fail('invalid_side');
  if (f.maxHp < 1 || f.hp < 0 || f.hp > f.maxHp || f.attack < 0 || f.defense < 0 || f.startStaminaPm > 1000 || f.radiusMm < 1) fail('invalid_fighter_stats');
  if (f.backstepTicks < 1 || f.sidestepTicks < 1 || f.forwardJumpTicks < 1 || f.hitLightTicks < 1 || f.hitHeavyTicks < 1) fail('invalid_fighter_ticks');
  if (Math.abs(f.startXMm) > 12000 || Math.abs(f.startZMm) > 12000) fail('invalid_fighter_start');
}

/** FightRules.Validate (same checks, same order, same codes). */
export function validateRules(r: FightRules): void {
  for (const k of GLOBAL_KEYS) if (!Number.isSafeInteger(r[k]) || r[k] < 0) fail('invalid_' + k);
  if (r.maxTicks < 1 || r.maxTicks > 7200 || r.telegraphTicks < 1 || r.chainTelegraphTicks < 1 || r.breakLinePm > 1000 || r.chainMax < 1) fail('invalid_rules');
  if (r.shoveOnHeavyInClose > 1 || r.chargeTelegraphTicks < 1 || r.escapeTurnTicks + r.escapeRunTicks + r.escapeTurnBackTicks < 1 || r.hpScaleLights > 1000) fail('invalid_rules');
  if (!Array.isArray(r.fighters) || r.fighters.length < 2 || r.fighters.length > 2 * MAX_ROSTER_PER_SIDE) fail('invalid_fighters');
  for (const f of r.fighters) validateFighter(f);
  for (let i = 0; i < r.fighters.length; i++) for (let j = i + 1; j < r.fighters.length; j++) if (r.fighters[i].id === r.fighters[j].id) fail('duplicate_fighter');
  for (let s = 0; s < 2; s++) { const n = rosterOf(r, s).length; if (n < 1 || n > MAX_ROSTER_PER_SIDE) fail('invalid_roster'); }
}

function exact(o: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(o).length !== keys.length) fail('invalid_fields');
  for (const k of keys) if (!Object.prototype.hasOwnProperty.call(o, k)) fail('missing_' + k);
}
function int32(v: unknown, k: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail('invalid_' + k);
  const n = v as number;
  if (n < -2147483648 || n > 2147483647) fail('invalid_' + k);
  return n;
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function fighterFromJson(o: unknown): FightFighterDef {
  if (!isObj(o)) return fail('invalid_fighter');
  exact(o, ['id', ...FIGHTER_KEYS]);
  if (typeof o.id !== 'string') fail('invalid_id');
  const f = { id: o.id as string } as FightFighterDef;
  for (const k of FIGHTER_KEYS) f[k] = int32(o[k], k);
  return f;
}

/** FightRules.FromJson: strict (every key, integers only, nothing extra), then Validate. Admission shape, not authorization. */
export function rulesFromJson(o: unknown): FightRules {
  if (!isObj(o)) return fail('invalid_rules');
  exact(o, ['schemaVersion', 'simVersion', 'tickHz', 'rules', 'fighters']);
  if (o.schemaVersion !== RULES_SCHEMA || o.simVersion !== SIM_VERSION) fail('invalid_version');
  if (int32(o.tickHz, 'tickHz') !== TICK_HZ) fail('invalid_tickHz');
  const g = o.rules;
  if (!isObj(g)) return fail('invalid_rules');
  exact(g, GLOBAL_KEYS);
  const values = {} as FightRulesValues;
  for (const k of GLOBAL_KEYS) values[k] = int32(g[k], k);
  const fs = o.fighters;
  if (!Array.isArray(fs) || fs.length < 2 || fs.length > 2 * MAX_ROSTER_PER_SIDE) fail('invalid_fighters');
  const r: FightRules = { ...values, fighters: (fs as unknown[]).map(fighterFromJson) };
  validateRules(r);
  return r;
}

/** FightRules.ToJson (key order = hash order; JSON key order is not significant to the hash). */
export function rulesToJson(r: FightRules): DuelRules3Doc {
  const rules = {} as FightRulesValues;
  for (const k of GLOBAL_KEYS) rules[k] = r[k];
  const fighters = r.fighters.map(f => { const o = { id: f.id } as FightFighterDef; for (const k of FIGHTER_KEYS) o[k] = f[k]; return o; });
  return { schemaVersion: RULES_SCHEMA, simVersion: SIM_VERSION, tickHz: TICK_HZ, rules, fighters };
}

/** "duel-rules-3" ASCII, every global int32 LE, fighter count, then per fighter: id length + ASCII id + every FIGHTER_KEYS int32. */
export function rulesCanonicalBytes(r: FightRules): Buffer {
  const w = new Int32Writer(512).ascii(RULES_SCHEMA);
  for (const k of GLOBAL_KEYS) w.int(r[k]);
  w.int(r.fighters.length);
  for (const f of r.fighters) {
    const id = Buffer.from(f.id, 'ascii');
    w.int(id.length).bytes(id);
    for (const k of FIGHTER_KEYS) w.int(f[k]);
  }
  return w.done();
}
export function rulesHashBytes(r: FightRules): Buffer { return sha256(rulesCanonicalBytes(r)); }
export function rulesHash(r: FightRules): string { return hex(rulesHashBytes(r)); }
