export type DuelSide = 'player' | 'rival';
export type DuelAction = 'Strike' | 'Heavy' | 'Defend' | 'Finisher';
export type DuelOutcome = 'hit' | 'miss' | 'evade' | 'guard';
export type DuelFighterState = { hp: number; maxHp: number; stamina: number; maxStamina: number };
export type DuelState = { player: DuelFighterState; rival: DuelFighterState };
export type DuelRound = {
  attacker: DuelSide;
  action?: DuelAction;
  roundNumber?: number;
  attackClip?: string;
  outcome?: DuelOutcome;
  evaded?: boolean;
  missed?: boolean;
  damage?: number;
  label?: string;
  before?: DuelState;
  after?: DuelState;
};
export type DuelReceipt = {
  battleId: string | null;
  didWin: boolean | null;
  holosGranted: number | null;
  attackerBotId: string | null;
  defenderBotId: string | null;
  rounds: DuelRound[];
  roundCount: number;
  initialState: DuelState | null;
  commandCosts: Record<DuelAction, number> | null;
  synthetic: boolean;
  traceSource: 'host' | 'client' | 'none';
};
export const DUEL_PREVIEW_SCHEMA = 'holocity-duel-preview-1';
const ACTIONS: readonly DuelAction[] = ['Strike', 'Heavy', 'Defend', 'Finisher'];
const OUTCOMES: readonly DuelOutcome[] = ['hit', 'miss', 'evade', 'guard'];
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 180) : null; }
function firstBot(value: unknown): string | null { return Array.isArray(value) ? text(record(value[0]).holobotId) : null; }
function fighterState(value: unknown): DuelFighterState | null {
  const row = record(value);
  if (!nonnegative(row.hp) || !nonnegative(row.maxHp) || row.maxHp === 0 || row.hp > row.maxHp ||
      !nonnegative(row.stamina) || !nonnegative(row.maxStamina) || row.maxStamina === 0 || row.stamina > row.maxStamina) return null;
  return { hp: row.hp, maxHp: row.maxHp, stamina: row.stamina, maxStamina: row.maxStamina };
}
export function normalizeDuelState(value: unknown): DuelState | null {
  const row = record(value), player = fighterState(row.player), rival = fighterState(row.rival);
  return player && rival ? { player, rival } : null;
}
function commandCosts(value: unknown): Record<DuelAction, number> | null {
  const row = record(value);
  if (!ACTIONS.every(action => nonnegative(row[action]))) return null;
  return { Strike: Number(row.Strike), Heavy: Number(row.Heavy), Defend: Number(row.Defend), Finisher: Number(row.Finisher) };
}
export function normalizeDuelRounds(value: unknown): DuelRound[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap(raw => {
    const row = record(raw);
    if (row.attacker !== 'player' && row.attacker !== 'rival') return [];
    const action = ACTIONS.find(action => action === row.action);
    const outcome = OUTCOMES.find(outcome => outcome === row.outcome);
    const before = normalizeDuelState(row.before), after = normalizeDuelState(row.after);
    const attackClip = text(row.attackClip), label = text(row.label);
    return [{
      attacker: row.attacker,
      ...(action ? { action } : {}), ...(outcome ? { outcome } : {}),
      ...(typeof row.roundNumber === 'number' && Number.isSafeInteger(row.roundNumber) && row.roundNumber > 0 ? { roundNumber: row.roundNumber } : {}),
      ...(attackClip ? { attackClip } : {}), ...(label ? { label } : {}),
      ...(typeof row.evaded === 'boolean' ? { evaded: row.evaded } : {}),
      ...(typeof row.missed === 'boolean' ? { missed: row.missed } : {}),
      ...(nonnegative(row.damage) ? { damage: row.damage } : {}),
      ...(before ? { before } : {}), ...(after ? { after } : {}),
    }];
  });
}
/** Actual rival-battle-1/-2/-3 replies have admission/settlement, never turns.
 * This adapter only copies recorded values. HP, stamina, hits and the winner are never resolved here.
 * holocity-duel-preview-1 is our explicitly synthetic QA format, not a deployed host contract.
 */
export function normalizeDuelReceipt(raw: unknown, clientRounds?: readonly DuelRound[]): DuelReceipt {
  const outer = record(raw);
  const reply = Object.keys(record(outer.data)).length ? record(outer.data) : outer;
  const issue = Object.keys(record(reply.issue)).length ? record(reply.issue) : reply;
  const settlement = Object.keys(record(reply.settlement)).length ? record(reply.settlement) : reply;
  const encounter = record(issue.encounter);
  const synthetic = reply.schemaVersion === DUEL_PREVIEW_SCHEMA && reply.synthetic === true;
  const embedded = normalizeDuelRounds(reply.rounds);
  const rounds = clientRounds ? normalizeDuelRounds(clientRounds) : embedded;
  const combatants = synthetic ? record(reply.combatants) : {};
  return {
    battleId: text(reply.battleId) ?? text(issue.battleId),
    didWin: typeof settlement.didWin === 'boolean' ? settlement.didWin : null,
    holosGranted: synthetic ? null : nonnegative(settlement.holosGranted) ? settlement.holosGranted : null,
    attackerBotId: firstBot(issue.playerCombatants) ?? text(record(combatants.player).holobotId),
    defenderBotId: firstBot(encounter.opponentSquad) ?? text(record(combatants.rival).holobotId),
    rounds,
    roundCount: Number.isSafeInteger(reply.roundCount) && typeof reply.roundCount === 'number' && reply.roundCount >= rounds.length && reply.roundCount <= 200 ? reply.roundCount : rounds.length,
    initialState: normalizeDuelState(reply.initialState),
    commandCosts: commandCosts(reply.commandCosts),
    synthetic,
    traceSource: rounds.length ? clientRounds ? 'client' : 'host' : 'none',
  };
}
export type PlaybackCue = {
  atMs: number;
  side: DuelSide;
  clip: string;
  kind: 'attack' | 'evade' | 'hit' | 'guard' | 'miss' | 'idle' | 'state';
  roundIndex: number;
  roundNumber: number;
  action?: DuelAction;
  outcome?: DuelOutcome;
  snapshot?: DuelState;
};
export const ROUND_DURATION_MS = 3200;
export const ROUND_IMPACT_MS = 900;
function recordedOutcome(round: DuelRound): DuelOutcome | undefined {
  if (round.outcome) return round.outcome;
  if (round.evaded === true) return 'evade';
  if (round.missed === true) return 'miss';
  // Legacy client traces carry the observed damage/evade flag but no outcome string.
  if (round.damage !== undefined && round.damage > 0) return 'hit';
  return undefined;
}
const ACTION_CLIPS: Record<DuelAction, string> = { Strike: 'Strike', Heavy: 'Heavy', Defend: 'Guard', Finisher: 'Finisher' };
export function buildPlaybackCues(rounds: readonly DuelRound[]): PlaybackCue[] {
  return rounds.flatMap((round, roundIndex) => {
    const defender: DuelSide = round.attacker === 'player' ? 'rival' : 'player';
    const start = roundIndex * ROUND_DURATION_MS;
    const outcome = recordedOutcome(round);
    const shared = { roundIndex, roundNumber: round.roundNumber ?? roundIndex + 1, action: round.action, outcome };
    const cues: PlaybackCue[] = [];
    if (round.before) cues.push({ ...shared, atMs: start, side: round.attacker, clip: 'Idle', kind: 'state', snapshot: round.before });
    cues.push({ ...shared, atMs: start, side: round.attacker, clip: round.attackClip ?? (round.action ? ACTION_CLIPS[round.action] : 'AttackBasic'), kind: round.action === 'Defend' ? 'guard' : 'attack' });
    if (round.action !== 'Defend' && outcome) {
      cues.push({ ...shared, atMs: start + ROUND_IMPACT_MS, side: defender, clip: outcome === 'evade' ? 'Evade' : outcome === 'hit' ? 'HitLight' : outcome === 'guard' ? 'Guard' : 'Evade', kind: outcome });
    }
    if (round.after) cues.push({ ...shared, atMs: start + ROUND_IMPACT_MS, side: round.attacker, clip: 'Idle', kind: 'state', snapshot: round.after });
    cues.push({ ...shared, atMs: start + 3000, side: round.attacker, clip: 'Idle', kind: 'idle' }, { ...shared, atMs: start + 3000, side: defender, clip: 'Idle', kind: 'idle' });
    return cues;
  });
}
