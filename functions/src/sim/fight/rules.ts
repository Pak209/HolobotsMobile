import { div, hex, Int32Writer, sha256 } from './math';

/**
 * duel-rules-3: the issued, immutable rules snapshot (HolobotsUnity `Schemas/duel-rules-3.json`, `Sim/Fight/FightRules.cs`).
 * Every number the core uses is here; none is a client constant. Canonical hash order = GLOBAL_KEYS then per fighter
 * FIGHTER_KEYS (the C# arrays, same order). Defaults = the C# field initialisers (brief picks + producer D1-D5).
 */
export const SIM_VERSION = 'duel-sim-3';
export const RULES_SCHEMA = 'duel-rules-3';
/** duel-rules-4 (HolobotsUnity duel-rules-4-1, DECISIONS #72.65): duel-rules-3 + the fight-chase-1 `chase` block. Same core. */
export const RULES_SCHEMA_4 = 'duel-rules-4';
/** duel-rules-5 (HolobotsUnity lane speed-special-p2-1, DECISIONS #72.77/#72.78; Contract-Change approved): duel-rules-4 + the
 * `attrs` block + per-fighter `speed` / `special`; simVersion duel-sim-4 (the state hash prefix). */
export const RULES_SCHEMA_5 = 'duel-rules-5';
export const SIM_VERSION_4 = 'duel-sim-4';
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

/** FightChaseRules field initialisers (fight-chase-1 #72.65), in FightChaseRules.Keys (= hash) order. */
export const CHASE_DEFAULTS = {
  chaserSpeedPm: 1100, chaseDrainPmPerSec: 30, retreatCostPm: 60, retreatCooldownTicks: 45, chaseLapseTicks: 15,
  caughtStaggerTicks: 15, caughtGapMm: 1300, caughtPullMm: 3000, caughtPullTicks: 9, ringStop: 1,
};
export type ChaseKey = keyof typeof CHASE_DEFAULTS;
/** FightChaseRules.Keys, camelCased, in hash order. */
export const CHASE_KEYS = Object.keys(CHASE_DEFAULTS) as ChaseKey[];
/** The issued chase block (duel-rules-4); null everywhere = duel-rules-3 = today's core. */
export type FightChaseRules = { [K in ChaseKey]: number };
export function defaultChaseRules(): FightChaseRules { return { ...CHASE_DEFAULTS }; }

/** FightAttrRules field initialisers (duel-rules-5 `attrs`, Pak's approved v3 numbers #72.78), in FightAttrRules.Keys (= hash) order. */
export const ATTR_DEFAULTS = {
  moveEdgePm: 600, moveMinPm: 940, moveMaxPm: 1060, chaseParity: 1, evadeBasePm: 0, evadeEdgePm: 1000, evadeMaxPm: 100, evadeWide: 1, evadeSpecials: 0,
  initiativeMinEdgePm: 47, tempoMaxTicks: 2, tempoFullEdgePm: 150, syncEdgePm: 2000, syncMinPm: 750, syncMaxPm: 1400, specialDmgEdgePm: 2000, specialDmgMaxPm: 1300,
  retreatChainMax: 3,
};
export type AttrKey = keyof typeof ATTR_DEFAULTS;
/** FightAttrRules.Keys, camelCased, in hash order. */
export const ATTR_KEYS = Object.keys(ATTR_DEFAULTS) as AttrKey[];
/** The issued attrs block (duel-rules-5); null everywhere = duel-rules-3/-4 exactly. */
export type FightAttrRules = { [K in AttrKey]: number };
export function defaultAttrRules(): FightAttrRules { return { ...ATTR_DEFAULTS }; }

/** duel-rules-5 only: the issued battle SPEED / SPECIAL (progression speed / intelligence). Serialized and hashed only in a
 * duel-rules-5 snapshot; duel-rules-3/-4 neither read nor write them (absent = 0 there, as C#'s default). */
export type FightFighterDef = { id: string } & { [K in FighterKey]: number } & { speed?: number; special?: number };
export type FightRulesValues = { [K in RuleKey]: number };
export type FightRules = FightRulesValues & { fighters: FightFighterDef[] };
/** The duel-rules-3 JSON document (the issued snapshot). */
export type DuelRules3Doc = {
  schemaVersion: typeof RULES_SCHEMA; simVersion: typeof SIM_VERSION; tickHz: typeof TICK_HZ;
  rules: FightRulesValues; fighters: FightFighterDef[];
};

/** The duel-rules-4 JSON document: duel-rules-3 + `chase`. */
export type DuelRules4Doc = Omit<DuelRules3Doc, 'schemaVersion'> & { schemaVersion: typeof RULES_SCHEMA_4; chase: FightChaseRules };
/** The duel-rules-5 JSON document: duel-rules-4 (simVersion duel-sim-4) + `attrs`, every fighter + `speed` / `special`. */
export type DuelRules5Doc = Omit<DuelRules4Doc, 'schemaVersion' | 'simVersion' | 'fighters'> & {
  schemaVersion: typeof RULES_SCHEMA_5; simVersion: typeof SIM_VERSION_4; fighters: (FightFighterDef & { speed: number; special: number })[]; attrs: FightAttrRules;
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
  const speed = f.speed ?? 0, special = f.special ?? 0;
  if (!Number.isSafeInteger(speed) || !Number.isSafeInteger(special) || speed < 0 || special < 0 || speed > 100000 || special > 100000) fail('invalid_fighter_attrs');
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

/** FightChaseRules.Validate (same checks, same order, same codes). */
export function validateChaseRules(c: FightChaseRules): void {
  for (const k of CHASE_KEYS) if (!Number.isSafeInteger(c[k]) || c[k] < 0) fail('invalid_chase_' + k);
  if (c.ringStop > 1 || c.chaserSpeedPm < 1000 || c.chaserSpeedPm > 2000 || c.caughtPullTicks < 1) fail('invalid_chase_rules');
}

/** FightChaseRules.FromJson: strict (every key, integers only, nothing extra), then validateChaseRules. */
export function chaseFromJson(o: unknown): FightChaseRules {
  if (!isObj(o)) return fail('invalid_chase');
  exact(o, CHASE_KEYS);
  const c = {} as FightChaseRules;
  for (const k of CHASE_KEYS) c[k] = int32(o[k], k);
  validateChaseRules(c);
  return c;
}

/** FightRules.FromJsonAny(o, out chase): duel-rules-3 (chase null, today's core) or duel-rules-4 (the same document + a strict chase block). */
function rulesDoc34FromJson(o: unknown): { rules: FightRules; chase: FightChaseRules | null } {
  if (isObj(o) && o.schemaVersion === RULES_SCHEMA_4) {
    exact(o, ['schemaVersion', 'simVersion', 'tickHz', 'rules', 'fighters', 'chase']);
    const { chase, ...rest } = o;
    const rules = rulesFromJson({ ...rest, schemaVersion: RULES_SCHEMA });
    return { rules, chase: chaseFromJson(chase) };
  }
  return { rules: rulesFromJson(o), chase: null };
}

/** FightRules.FromJsonAny(o, out chase, out attrs): duel-rules-3 (chase + attrs null), duel-rules-4 (attrs null) or duel-rules-5
 * (duel-rules-4 with simVersion duel-sim-4 + a strict attrs block + per-fighter speed / special). Same checks, order and codes as C#. */
export function rulesDocFromJson(o: unknown): { rules: FightRules; chase: FightChaseRules | null; attrs: FightAttrRules | null } {
  if (isObj(o) && o.schemaVersion === RULES_SCHEMA_5) {
    exact(o, ['schemaVersion', 'simVersion', 'tickHz', 'rules', 'fighters', 'chase', 'attrs']);
    if (o.simVersion !== SIM_VERSION_4) fail('invalid_version');
    const fs = o.fighters;
    if (!Array.isArray(fs) || fs.length < 2 || fs.length > 2 * MAX_ROSTER_PER_SIDE) return fail('invalid_fighters');
    const speeds: number[] = [], specials: number[] = [], fs4: unknown[] = [];
    for (const f of fs as unknown[]) {
      if (!isObj(f)) return fail('invalid_fighter');
      if (!Object.prototype.hasOwnProperty.call(f, 'speed')) fail('missing_speed');
      if (!Object.prototype.hasOwnProperty.call(f, 'special')) fail('missing_special');
      speeds.push(int32(f.speed, 'speed')); specials.push(int32(f.special, 'special'));
      const { speed: _s, special: _p, ...c } = f; fs4.push(c);
    }
    const { attrs, ...rest } = o;
    const four = rulesDoc34FromJson({ ...rest, schemaVersion: RULES_SCHEMA_4, simVersion: SIM_VERSION, fighters: fs4 });
    if (!four.chase) fail('invalid_chase');
    four.rules.fighters.forEach((f, i) => { f.speed = speeds[i]; f.special = specials[i]; });
    validateRules(four.rules);
    return { rules: four.rules, chase: four.chase, attrs: attrsFromJson(attrs) };
  }
  return { ...rulesDoc34FromJson(o), attrs: null };
}

/** FightAttrRules.Validate (same checks, same order, same codes). */
export function validateAttrRules(a: FightAttrRules): void {
  for (const k of ATTR_KEYS) if (!Number.isSafeInteger(a[k]) || a[k] < 0) fail('invalid_attrs_' + k);
  if (a.moveMinPm > 1000 || a.moveMaxPm < 1000 || a.moveMaxPm > 2000 || a.moveEdgePm > 2000 || a.evadeMaxPm > 1000 || a.evadeBasePm > 1000 || a.evadeEdgePm > 5000
    || a.syncMinPm > 1000 || a.syncMaxPm < 1000 || a.syncMaxPm > 3000 || a.syncEdgePm > 10000 || a.specialDmgMaxPm < 1000 || a.specialDmgMaxPm > 2000 || a.specialDmgEdgePm > 10000
    || a.chaseParity > 1 || a.evadeWide > 1 || a.evadeSpecials > 1 || a.tempoMaxTicks > 10 || a.initiativeMinEdgePm > 1000 || a.retreatChainMax > 100) fail('invalid_attrs_rules');
}

/** FightAttrRules.FromJson: strict (every key, integers only, nothing extra), then validateAttrRules. */
export function attrsFromJson(o: unknown): FightAttrRules {
  if (!isObj(o)) return fail('invalid_attrs');
  exact(o, ATTR_KEYS);
  const a = {} as FightAttrRules;
  for (const k of ATTR_KEYS) a[k] = int32(o[k], k);
  validateAttrRules(a);
  return a;
}

// ---------------------------------------------------------------- duel-rules-5 curves (FightAttrRules; C# long math, truncating)

const clampL = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** The pair-relative edge of `own` over `opp`, per-mille (truncating; 0 when both are 0). */
export function attrEdge(own: number, opp: number): number { return own + opp <= 0 ? 0 : div((own - opp) * 1000, own + opp); }
export function moveMul(a: FightAttrRules, e: number): number { return clampL(1000 + div(a.moveEdgePm * e, 1000), a.moveMinPm, a.moveMaxPm); }
export function evadeChance(a: FightAttrRules, e: number): number { return clampL(a.evadeBasePm + div(a.evadeEdgePm * e, 1000), 0, a.evadeMaxPm); }
export function tempoTicks(a: FightAttrRules, e: number): number {
  // #72.80: the faster wind-up needs the same clear speed gap as the trade win (FightAttrRules.TempoTicks)
  return e <= 0 || a.tempoFullEdgePm <= 0 || (a.initiativeMinEdgePm > 0 && e < a.initiativeMinEdgePm) ? 0 : clampL(div(a.tempoMaxTicks * e, a.tempoFullEdgePm), 0, a.tempoMaxTicks);
}
export function syncMul(a: FightAttrRules, e: number): number { return clampL(1000 + div(a.syncEdgePm * e, 1000), a.syncMinPm, a.syncMaxPm); }
export function specialDmgMul(a: FightAttrRules, e: number): number {
  return clampL(1000 + div(a.specialDmgEdgePm * e, 1000), 2000 - a.specialDmgMaxPm, a.specialDmgMaxPm);
}

/** The evade stream's seed word: LE u32 of the first 4 bytes of SHA-256(ASCII "duel-sim-4/evade" || 32 seed bytes). */
export function evadeWord(seed: Uint8Array): number {
  return sha256(Buffer.concat([Buffer.from('duel-sim-4/evade', 'ascii'), Buffer.from(seed)])).readUInt32LE(0);
}

/** murmur3 fmix32 over (word, attacker side, attacker's roll index) -> 0..999 by multiply-shift (uint32 via Math.imul + >>> 0;
 * x * 1000 < 2^42 is exact in a double, so the floor of / 2^32 is C#'s (ulong) x * 1000 >> 32). */
export function rollPm(word: number, side: number, index: number): number {
  let x = ((word >>> 0) ^ Math.imul(side + 1, 0x85ebca6b) ^ Math.imul(index, 0x9e3779b1)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x85ebca6b) >>> 0; x = (x ^ (x >>> 13)) >>> 0; x = Math.imul(x, 0xc2b2ae35) >>> 0; x = (x ^ (x >>> 16)) >>> 0;
  return Math.floor((x * 1000) / 4294967296);
}

/** FightRules.ToJson (key order = hash order; JSON key order is not significant to the hash). */
export function rulesToJson(r: FightRules): DuelRules3Doc {
  const rules = {} as FightRulesValues;
  for (const k of GLOBAL_KEYS) rules[k] = r[k];
  const fighters = r.fighters.map(f => { const o = { id: f.id } as FightFighterDef; for (const k of FIGHTER_KEYS) o[k] = f[k]; return o; });
  return { schemaVersion: RULES_SCHEMA, simVersion: SIM_VERSION, tickHz: TICK_HZ, rules, fighters };
}

/** FightRules.ToJson(chase): duel-rules-4 when chase is set (keys after `fighters`, as Newtonsoft writes them), else duel-rules-3. */
export function rulesDocToJson(r: FightRules, chase: FightChaseRules | null): DuelRules3Doc | DuelRules4Doc {
  const doc = rulesToJson(r);
  if (!chase) return doc;
  const c = {} as FightChaseRules;
  for (const k of CHASE_KEYS) c[k] = chase[k];
  return { ...doc, schemaVersion: RULES_SCHEMA_4, chase: c };
}

/** FightRules.ToJson(chase, attrs): duel-rules-5 when attrs is set (needs chase): the duel-rules-4 document with simVersion
 * duel-sim-4, `attrs` after `chase`, every fighter + speed / special (the C# key order); attrs null = rulesDocToJson(r, chase). */
export function rulesDocToJson5(r: FightRules, chase: FightChaseRules | null, attrs: FightAttrRules | null): DuelRules3Doc | DuelRules4Doc | DuelRules5Doc {
  if (!attrs) return rulesDocToJson(r, chase);
  if (!chase) return fail('invalid_attrs_without_chase');
  const four = rulesDocToJson(r, chase) as DuelRules4Doc;
  const a = {} as FightAttrRules;
  for (const k of ATTR_KEYS) a[k] = attrs[k];
  const fighters = four.fighters.map((f, i) => ({ ...f, speed: r.fighters[i].speed ?? 0, special: r.fighters[i].special ?? 0 }));
  return { ...four, schemaVersion: RULES_SCHEMA_5, simVersion: SIM_VERSION_4, attrs: a, fighters };
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
/** duel-rules-4 (chase set): "duel-rules-4" ASCII, every global int32 LE, every CHASE_KEYS int32 LE, then the fighter count
 * and the fighters exactly as duel-rules-3. Chase null = rulesCanonicalBytes (duel-rules-3, byte for byte). */
export function rulesCanonicalBytes4(r: FightRules, chase: FightChaseRules | null): Buffer {
  if (!chase) return rulesCanonicalBytes(r);
  const w = new Int32Writer(512).ascii(RULES_SCHEMA_4);
  for (const k of GLOBAL_KEYS) w.int(r[k]);
  for (const k of CHASE_KEYS) w.int(chase[k]);
  w.int(r.fighters.length);
  for (const f of r.fighters) {
    const id = Buffer.from(f.id, 'ascii');
    w.int(id.length).bytes(id);
    for (const k of FIGHTER_KEYS) w.int(f[k]);
  }
  return w.done();
}
/** duel-rules-5 (attrs set; needs chase): "duel-rules-5" ASCII, every global int32 LE, every CHASE_KEYS, every ATTR_KEYS, the
 * fighter count, then per fighter the duel-rules-3 bytes + speed + special (int32 LE). Attrs null = rulesCanonicalBytes4. */
export function rulesCanonicalBytes5(r: FightRules, chase: FightChaseRules | null, attrs: FightAttrRules | null): Buffer {
  if (!attrs) return rulesCanonicalBytes4(r, chase);
  if (!chase) return fail('invalid_attrs_without_chase');
  const w = new Int32Writer(640).ascii(RULES_SCHEMA_5);
  for (const k of GLOBAL_KEYS) w.int(r[k]);
  for (const k of CHASE_KEYS) w.int(chase[k]);
  for (const k of ATTR_KEYS) w.int(attrs[k]);
  w.int(r.fighters.length);
  for (const f of r.fighters) {
    const id = Buffer.from(f.id, 'ascii');
    w.int(id.length).bytes(id);
    for (const k of FIGHTER_KEYS) w.int(f[k]);
    w.int(f.speed ?? 0).int(f.special ?? 0);
  }
  return w.done();
}
export function rulesHashBytes(r: FightRules): Buffer { return sha256(rulesCanonicalBytes(r)); }
/** The issued snapshot's hash: duel-rules-5's when `attrs` is set (needs chase), duel-rules-4's when only `chase` is set, else
 * duel-rules-3's (the one-argument form). */
export function rulesHash(r: FightRules, chase: FightChaseRules | null = null, attrs: FightAttrRules | null = null): string {
  return hex(sha256(rulesCanonicalBytes5(r, chase, attrs)));
}
