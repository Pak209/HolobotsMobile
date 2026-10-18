import { normalizeDuelReceipt, type DuelReceipt } from './duelPlayback';
import { record } from '../cityHub';
import { readCityRivalSettlement } from '../cityRivalBattle';

/** Admission pins the mode for the battle's lifetime, including after a server rollback. */
export function rivalIssueMode(raw: unknown): 'legacy' | 'resolver' {
  const issue = record(raw), duel = record(issue?.duel);
  if (issue?.schemaVersion !== 'rival-battle-3' || typeof issue.battleId !== 'string' || !/^rb_[a-f0-9]{24}$/.test(issue.battleId)) throw new Error('Invalid rival admission');
  if (issue.duel === undefined) return 'legacy'; // Deployed pre-migration admission.
  if (duel?.mode === 'legacy') return 'legacy';
  if (duel?.mode === 'resolver' && duel.schemaVersion === 'duel-receipt-1' && duel.maxRounds === 120 &&
      [duel.player, duel.opponent].every(team => Array.isArray(team) && team.length > 0 && team.length <= 3 && team.every(bot => typeof record(bot)?.holobotId === 'string'))) return 'resolver';
  throw new Error('Unsupported rival admission mode');
}

/** Live replies never inherit client traces or the synthetic preview format. */
export function readLiveRivalPlayback(rawIssue: unknown, rawSettlement: unknown): DuelReceipt {
  // Player-visible receiptError copy: PLACEHOLDER until Lex (DECISIONS #71, "the City").
  const invalid = (message: string): DuelReceipt => ({ ...normalizeDuelReceipt({}), receiptError: message });
  try {
    const mode = rivalIssueMode(rawIssue), issue = record(rawIssue)!;
    const settlement = readCityRivalSettlement(rawSettlement, String(issue.battleId));
    if (mode === 'legacy') {
      // Explicitly project result fields: do not accept incidental rounds, duelReceipt or QA metadata.
      return normalizeDuelReceipt({ issue: { battleId: issue.battleId, playerCombatants: issue.playerCombatants, encounter: issue.encounter }, settlement: { didWin: settlement.didWin, holosGranted: settlement.holosGranted } });
    }
    if (!Object.hasOwn(settlement, 'duelReceipt')) return invalid('This result is missing its City receipt. Retry the same battle.');
    const receipt = record(settlement.duelReceipt), duel = record(issue.duel)!;
    if (receipt && (receipt.winner === 'player' || receipt.winner === 'opponent') && settlement.didWin !== (receipt.winner === 'player')) return invalid('The City result conflicts with its receipt. Retry the same battle.');
    for (const [initial, final] of [[duel.player, receipt?.playerFinal], [duel.opponent, receipt?.opponentFinal]]) {
      if (!Array.isArray(initial) || !Array.isArray(final) || initial.length !== final.length || initial.some((bot, i) => record(bot)?.holobotId !== record(final[i])?.holobotId)) return invalid('The receipt squad does not match this admission.');
    }
    return normalizeDuelReceipt({ issue, settlement });
  } catch (error) { return invalid(error instanceof Error ? error.message : 'Unverified rival settlement'); }
}
