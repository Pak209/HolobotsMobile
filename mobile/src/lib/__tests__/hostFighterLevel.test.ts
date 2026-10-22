import { describe, expect, it } from 'vitest';
import { hostFighterLevel, levelBadge, receiptIssue } from '../bots/hostFighterLevel';
import fixture from '../../qa/fixtures/duel-receipt-1.json';

describe('host-only fighter level badges', () => {
  it('reads both levels from the original host fixture input, not final receipt stats', () => {
    const issue = { duel: { mode: 'resolver', player: fixture.input.player, opponent: fixture.input.opponent } };
    expect(levelBadge(hostFighterLevel(issue, 'player', 'ACE'))).toBe(`LV ${fixture.input.player[0].level}`);
    expect(levelBadge(hostFighterLevel(issue, 'rival', 'WOLF'))).toBe(`LV ${fixture.input.opponent[0].level}`);
    expect(hostFighterLevel(fixture.receipt, 'player', 'ace')).toBeUndefined();
  });
  it('matches switched fighters by id rather than taking first squad level', () => {
    const issue = { duel: { mode: 'resolver', player: [{ holobotId: 'ace', level: 4 }, { holobotId: 'kuma', level: 11 }], opponent: [{ holobotId: 'wolf', level: 8 }] } };
    expect(hostFighterLevel(issue, 'player', 'kuma')).toBe(11);
    expect(hostFighterLevel(issue, 'rival', 'wolf')).toBe(8);
    expect(hostFighterLevel(issue, 'player', 'wolf')).toBeUndefined();
  });
  it('retains issued levels in the round and result envelope', () => {
    const issue = { duel: { mode: 'resolver', player: [{ holobotId: 'ace', level: 4 }], opponent: [{ holobotId: 'wolf', level: 8 }] } };
    const envelope = { issue, duelReceipt: fixture.receipt };
    expect(hostFighterLevel(receiptIssue(envelope), 'player', 'ace')).toBe(4);
    expect(hostFighterLevel(receiptIssue(envelope), 'rival', 'wolf')).toBe(8);
    expect(hostFighterLevel(receiptIssue(envelope), 'rival', 'ace')).toBeUndefined();
  });
  it('uses legacy issue fields and never computes from XP, rank or stats', () => {
    const issue = { playerCombatants: [{ holobotId: 'ace', level: 4 }], encounter: { opponentSquad: [{ holobotId: 'wolf', level: 8 }] } };
    expect(hostFighterLevel(issue, 'player', 'ace', { holobots: [{ name: 'ACE', level: 4 }] })).toBe(4);
    expect(hostFighterLevel(issue, 'rival', 'wolf')).toBe(8);
    // lite-2305-1: without an account snapshot the issue's own playerCombatants supply the player level (same issue as the rival's).
    expect(hostFighterLevel(issue, 'player', 'ace')).toBe(4);
    expect(hostFighterLevel(issue, 'player', 'kuma')).toBeUndefined();
    // The verified account snapshot still wins when it has the bot.
    expect(hostFighterLevel(issue, 'player', 'ace', { holobots: [{ name: 'ACE', level: 6 }] })).toBe(6);
    // A citizen issue (host omits playerCombatants) with no snapshot stays hidden; never the rival's squad.
    expect(hostFighterLevel({ encounter: { opponentSquad: [{ holobotId: 'ace', level: 8 }] } }, 'player', 'ace')).toBeUndefined();
    expect(hostFighterLevel({ playerCombatants: [{ holobotId: 'ace', experience: 10000, rank: 'Champion', speed: 99 }] }, 'player', 'ace')).toBeUndefined();
  });
  it('hides missing, invalid and ambiguous levels, including in a result card', () => {
    for (const value of [undefined, null, '4', 0, -1, 100, 1.5, NaN, Infinity]) expect(levelBadge(value)).toBeNull();
    expect(levelBadge(1)).toBe('LV 1'); expect(levelBadge(99)).toBe('LV 99');
    expect(hostFighterLevel({ duel: { mode: 'resolver', player: [{ holobotId: 'ace', level: 4 }, { holobotId: 'ace', level: 8 }] } }, 'player', 'ace')).toBeUndefined();
  });
});
