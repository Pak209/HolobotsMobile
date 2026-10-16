import { describe, expect, it } from 'vitest';
import fixture from '../../qa/fixtures/duel-receipt-1.json';
import { readLiveRivalPlayback, rivalIssueMode } from '../bots/liveRivalPlayback';
const battleId = 'rb_0123456789abcdef01234567';
const issue = () => ({ schemaVersion: 'rival-battle-3', battleId, duel: { mode: 'resolver', schemaVersion: 'duel-receipt-1', maxRounds: 120, player: fixture.input.player, opponent: fixture.input.opponent } });
const settle = () => ({ schemaVersion: 'rival-battle-3', battleId, didWin: true, alreadyProcessed: false, holosGranted: 100, status: { tier: 0, tierLabel: 'Rookie', rivalWins: 1, winsToNextTier: 9 }, duelReceipt: structuredClone(fixture.receipt) });
describe('live issued-mode receipt playback', () => {
  it('known-bad first: legacy result has zero rounds despite resolver trace or synthetic fields', () => {
    const result = readLiveRivalPlayback({ ...issue(), duel: { mode: 'legacy' } }, { ...settle(), didWin: false, rounds: fixture.receipt.rounds, synthetic: true });
    expect(result.didWin).toBe(false); expect(result.rounds).toEqual([]); expect(result.traceSource).toBe('none'); expect(result.synthetic).toBe(false);
  });
  it('plays receipt winner and all host rounds without playerCombatants', () => {
    const result = readLiveRivalPlayback(issue(), settle());
    expect(result.receiptError).toBeUndefined(); expect(result.rounds).toHaveLength(16); expect(result.roundCount).toBe(8); expect(result.didWin).toBe(true); expect(result.holosGranted).toBe(100);
  });
  it('pre-migration missing duel is legacy; unknown explicit modes fail closed', () => {
    const { duel: _, ...old } = issue(); expect(rivalIssueMode(old)).toBe('legacy');
    for (const duel of [null, {}, { mode: 'future' }, { mode: 'resolver', schemaVersion: 'future' }]) expect(readLiveRivalPlayback({ ...issue(), duel }, settle()).receiptError).toBeTruthy();
  });
  it('never downgrades resolver on missing or corrupt receipt', () => {
    for (const duelReceipt of [undefined, null, {}, { ...fixture.receipt, schemaVersion: 'duel-receipt-2' }]) {
      const result = readLiveRivalPlayback(issue(), { ...settle(), duelReceipt }); expect(result.receiptError).toBeTruthy(); expect(result.didWin).toBeNull(); expect(result.holosGranted).toBeNull(); expect(result.rounds).toEqual([]);
    }
  });
  it('rejects another battle or squad and malformed settlement', () => {
    for (const reply of [{ ...settle(), battleId: 'rb_ffffffffffffffffffffffff' }, { ...settle(), status: {} }, { ...settle(), schemaVersion: 'future' }]) expect(readLiveRivalPlayback(issue(), reply).receiptError).toBeTruthy();
    const other = issue(); other.duel.player = [{ ...other.duel.player[0], holobotId: 'kuma' }];
    expect(readLiveRivalPlayback(other, settle()).receiptError).toBeTruthy();
  });
  it('rejects a result that contradicts the authoritative receipt winner', () => {
    expect(readLiveRivalPlayback(issue(), { ...settle(), didWin: false }).receiptError).toBeTruthy();
  });
  it('replay preserves identical host result and mode', () => {
    expect(readLiveRivalPlayback(issue(), { ...settle(), alreadyProcessed: true })).toEqual(readLiveRivalPlayback(issue(), settle()));
  });
});
