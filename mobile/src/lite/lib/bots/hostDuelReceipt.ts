import type { DuelReceipt, DuelRound, DuelSide, ObservedDuelState } from './duelPlayback';
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(v);
const moves = ['strike', 'heavy', 'defend', 'finisher'];
const refusals = ['insufficient_stamina', 'sync_not_ready', 'knocked_out'];
type Fighter = { holobotId: string; currentHealth: number; maxHealth: number; stamina: number; maxStamina: number };
function team(raw: unknown): Fighter[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) return null;
  const seen = new Set();
  for (const v of raw) {
    const x = object(v);
    if (!id(x.holobotId) || seen.has(x.holobotId) || !finite(x.currentHealth) || !finite(x.maxHealth) || !x.maxHealth || x.currentHealth > x.maxHealth || !finite(x.stamina) || !finite(x.maxStamina) || !x.maxStamina || x.stamina > x.maxStamina) return null;
    seen.add(x.holobotId);
  }
  return raw.map(v => ({ ...v }));
}
/** Presentation projection only. Never subtract damage, regenerate STA, or resolve a winner.
 * Without an issue snapshot, resources stay unknown until explicitly observed in a row.
 * A recognized but invalid host receipt fails closed; it never falls back to client rounds/didWin.
 */
export function readHostDuelReceipt(raw: unknown, issue: Record<string, unknown>, base: DuelReceipt): DuelReceipt {
  const receipt = object(raw), player = team(receipt.playerFinal), opponent = team(receipt.opponentFinal);
  const invalid = (): DuelReceipt => ({ ...base, rounds: [], roundCount: 0, initialState: null, didWin: null, holosGranted: null, traceSource: 'none', receiptError: 'Invalid host duel receipt' });
  if (receipt.schemaVersion !== 'duel-receipt-1' || !['player', 'opponent'].includes(String(receipt.winner)) || !['knockout', 'round_limit'].includes(String(receipt.reason)) || !Number.isSafeInteger(receipt.seed) || Number(receipt.seed) < 0 || Number(receipt.seed) > 0xffffffff || !player || !opponent || !Array.isArray(receipt.rounds) || receipt.rounds.length < 1 || receipt.rounds.length > 240) return invalid();
  const teams = { player, rival: opponent };
  const observed = { player: new Map<string, ObservedDuelState['player']>(), rival: new Map<string, ObservedDuelState['rival']>() };
  const admission = object(issue.duel);
  for (const side of ['player', 'rival'] as const) {
    const source = admission[side === 'player' ? 'player' : 'opponent'];
    for (const f of teams[side]) {
      const pin = Array.isArray(source) ? source.map(object).find(x => x.holobotId === f.holobotId) : undefined;
      const hp = pin?.currentHealth ?? pin?.maxHealth;
      // Initial HP is an issue snapshot; no assumed full health for receipt-only replay.
      observed[side].set(f.holobotId, { maxHp: f.maxHealth, maxStamina: f.maxStamina, ...(finite(hp) && hp <= f.maxHealth ? { hp } : {}) });
    }
  }
  const rounds: DuelRound[] = [];
  let previousRound = 0;
  const seenSides = new Set<string>();
  for (const rawRow of receipt.rounds) {
    const row = object(rawRow);
    if (row.side !== 'player' && row.side !== 'opponent') return invalid();
    const side: DuelSide = row.side === 'player' ? 'player' : 'rival', other = side === 'player' ? 'rival' : 'player';
    const actor = teams[side].find(f => f.holobotId === row.attacker), defender = teams[other].find(f => f.holobotId === row.defender);
    if (!actor || !defender || !Number.isSafeInteger(row.round) || Number(row.round) < 1 || Number(row.round) > 120 || Number(row.round) < previousRound || Number(row.round) > previousRound + 1 || !moves.includes(String(row.requested)) || ![...moves, 'wait'].includes(String(row.move)) || typeof row.hit !== 'boolean' || !finite(row.damage) || !finite(row.defenderHpAfter) || row.defenderHpAfter > defender.maxHealth || !finite(row.staAfter) || row.staAfter > actor.maxStamina || !finite(row.syncAfter) || row.syncAfter > 100 || typeof row.moveId !== 'string' || row.moveId.length > 128 || (row.refusal !== undefined && !refusals.includes(String(row.refusal)))) return invalid();
    if (seenSides.has(`${row.round}:${side}`) || row.hit !== (row.damage > 0) || (['wait','defend'].includes(String(row.move)) && (row.hit || row.damage !== 0)) || (row.move === 'wait') !== (row.refusal !== undefined)) return invalid();
    seenSides.add(`${row.round}:${side}`); previousRound = Number(row.round);
    const actors = side === 'player' ? { player: actor.holobotId, rival: defender.holobotId } : { player: defender.holobotId, rival: actor.holobotId };
    observed[side].set(actor.holobotId, { ...observed[side].get(actor.holobotId)!, stamina: row.staAfter });
    observed[other].set(defender.holobotId, { ...observed[other].get(defender.holobotId)!, hp: row.defenderHpAfter });
    const action = row.move === 'wait' ? undefined : ({ strike: 'Strike', heavy: 'Heavy', defend: 'Defend', finisher: 'Finisher' } as const)[row.move as 'strike'];
    rounds.push({ attacker: side, actors, roundNumber: Number(row.round), action, wait: row.move === 'wait',
      outcome: row.move === 'defend' ? 'guard' : row.move === 'wait' ? undefined : row.hit ? 'hit' : 'miss', damage: row.damage,
      label: row.move === 'wait' ? `${actor.holobotId.toUpperCase()} · WAIT · ${String(row.refusal).replaceAll('_',' ').toUpperCase()}` : `${actor.holobotId.toUpperCase()} · ${String(row.move).toUpperCase()} · ${row.damage} DMG`,
      observedState: { player: { ...observed.player.get(actors.player)! }, rival: { ...observed.rival.get(actors.rival)! } },
    });
  }
  if (rounds.length !== previousRound * 2) return invalid();
  const first = rounds[0].actors!, last = rounds.at(-1)!.actors!;
  const final = (side: DuelSide) => { const f = teams[side].find(f => f.holobotId === last[side])!; return { hp: f.currentHealth, maxHp: f.maxHealth, stamina: f.stamina, maxStamina: f.maxStamina }; };
  return { ...base, attackerBotId: first.player, defenderBotId: first.rival, rounds, roundCount: previousRound, initialState: null,
    didWin: receipt.winner === 'player', traceSource: 'host', synthetic: false, finalState: { player: final('player'), rival: final('rival') } };
}
