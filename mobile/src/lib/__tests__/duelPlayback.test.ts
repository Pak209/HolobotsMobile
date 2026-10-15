import { describe, expect, it } from 'vitest';
import { buildPlaybackCues, normalizeDuelReceipt, normalizeDuelRounds, normalizeDuelState, ROUND_DURATION_MS, ROUND_IMPACT_MS, type DuelRound } from '../bots/duelPlayback';
import { resolveClipName } from '../bots/animationClips';
import { DUEL_PREVIEW_RECEIPT } from '../../qa/duelFixture';
import { createActionCardFromTemplate } from '../battleCards/catalog';
import capturedHost from '../../../docs/qa/mobile-holocity-lite/w7/host80-mobile-replies.json';

describe('rival host receipt playback', () => {
  it('reads an actual issue shape without manufacturing rounds, resource snapshots or an outcome', () => {
    const parsed = normalizeDuelReceipt({ schemaVersion: 'rival-battle-3', battleId: 'rb_real', playerCombatants: [{ holobotId: 'ACE' }], encounter: { seed: 723, opponentSquad: [{ holobotId: 'WOLF' }] } });
    expect(parsed).toEqual({ battleId: 'rb_real', attackerBotId: 'ACE', defenderBotId: 'WOLF', didWin: null, holosGranted: null, rounds: [], roundCount: 0, initialState: null, commandCosts: null, synthetic: false, traceSource: 'none' });
  });
  it('uses host settlement and labels client trace independently', () => {
    const parsed = normalizeDuelReceipt({ data: { issue: { battleId: 'rb_real' }, settlement: { didWin: false, holosGranted: 25, alreadyProcessed: true } } }, [{ attacker: 'rival', evaded: false, damage: 21 }]);
    expect(parsed.didWin).toBe(false); expect(parsed.holosGranted).toBe(25); expect(parsed.traceSource).toBe('client'); expect(parsed.rounds).toHaveLength(1);
    expect(parsed.battleId).toBe('rb_real'); expect(parsed.synthetic).toBe(false);
  });
  it('keeps the captured #80 emulator issue and settlement result-only without a separate client trace', () => {
    const parsed = normalizeDuelReceipt({ issue: capturedHost.issue, settlement: capturedHost.settlement });
    expect(parsed.attackerBotId).toBe('ace'); expect(parsed.defenderBotId).toBe('kuma');
    expect(parsed.didWin).toBe(false); expect(parsed.holosGranted).toBe(25);
    expect(parsed.rounds).toEqual([]); expect(parsed.initialState).toBeNull(); expect(parsed.traceSource).toBe('none');
    expect(parsed.synthetic).toBe(false);
    const withTrace = normalizeDuelReceipt({ issue: capturedHost.issue, settlement: capturedHost.settlement }, normalizeDuelRounds(capturedHost.clientTrace));
    expect(withTrace.traceSource).toBe('client'); expect(withTrace.rounds[0].damage).toBe(14);
    expect(withTrace.didWin).toBe(parsed.didWin);
  });
  it('shows real settlements with no trace as results only', () => {
    const parsed = normalizeDuelReceipt({ schemaVersion: 'rival-battle-3', battleId: 'rb_real', didWin: true, holosGranted: 150 });
    expect(parsed.rounds).toEqual([]); expect(buildPlaybackCues(parsed.rounds)).toEqual([]);
    expect(parsed.didWin).toBe(true); expect(parsed.traceSource).toBe('none');
  });
  it('rejects malformed rounds and non-finite rewards without coercing truthy values', () => {
    expect(normalizeDuelReceipt({ didWin: 'false', holosGranted: Infinity }).didWin).toBe(null);
    expect(normalizeDuelReceipt({ holosGranted: Infinity }).holosGranted).toBe(null);
    expect(normalizeDuelRounds([null, {}, { attacker: 'enemy' }, { attacker: 'player', damage: -2, action: 'Kill', outcome: 'critical', roundNumber: 0, attackClip: '' }])).toEqual([{ attacker: 'player' }]);
    expect(normalizeDuelRounds(Array.from({ length: 201 }, () => ({ attacker: 'rival' })))).toHaveLength(200);
  });
  it('queues observed action then evade/hit, then idle', () => {
    const cues = buildPlaybackCues([{ attacker: 'player', evaded: true, attackClip: 'JabCross' }, { attacker: 'rival', damage: 12 }]);
    expect(cues[0]).toMatchObject({ side: 'player', atMs: 0, clip: 'JabCross' });
    expect(cues[1]).toMatchObject({ side: 'rival', atMs: ROUND_IMPACT_MS, clip: 'Evade', kind: 'evade' });
    expect(cues[4]).toMatchObject({ side: 'rival', atMs: ROUND_DURATION_MS }); expect(cues[5]).toMatchObject({ side: 'player', clip: 'HitLight', kind: 'hit' });
  });
  it('does not invent a hit when neither a resolution nor positive damage was recorded', () => {
    const cues = buildPlaybackCues([{ attacker: 'player' }, { attacker: 'rival', damage: 0 }]);
    expect(cues.filter(cue => ['hit', 'evade', 'miss'].includes(cue.kind))).toEqual([]);
  });
  it('distinguishes misses, evades and defense without fabricating damage or attack reactions', () => {
    const rounds: DuelRound[] = [
      { attacker: 'player', action: 'Strike', outcome: 'miss', damage: 0 },
      { attacker: 'rival', action: 'Heavy', outcome: 'evade', damage: 0 },
      { attacker: 'player', action: 'Defend', outcome: 'guard' },
    ];
    const cues = buildPlaybackCues(rounds);
    expect(cues.find(cue => cue.kind === 'miss')).toMatchObject({ side: 'rival', clip: 'Evade' });
    expect(cues.find(cue => cue.kind === 'evade')).toMatchObject({ side: 'player', clip: 'Evade' });
    expect(cues.filter(cue => cue.roundIndex === 2 && cue.kind !== 'idle')).toEqual([expect.objectContaining({ side: 'player', kind: 'guard', clip: 'Guard' })]);
    expect(cues.filter(cue => cue.kind === 'hit')).toEqual([]);
  });
  it('keeps distinct generic command aliases when a receipt supplies no exact take', () => {
    const cues = buildPlaybackCues([
      { attacker: 'player', action: 'Strike' }, { attacker: 'player', action: 'Heavy' },
      { attacker: 'player', action: 'Defend' }, { attacker: 'player', action: 'Finisher' },
    ]);
    expect(cues.filter(cue => cue.kind !== 'idle').map(cue => cue.clip)).toEqual(['Strike', 'Heavy', 'Guard', 'Finisher']);
  });
  it('rejects invalid resource snapshots rather than clamping or computing them', () => {
    const snapshot = DUEL_PREVIEW_RECEIPT.initialState;
    expect(normalizeDuelState(snapshot)).toEqual(snapshot);
    for (const hp of [-1, 41, NaN, Infinity]) expect(normalizeDuelState({ ...snapshot, player: { ...snapshot.player, hp } })).toBeNull();
    expect(normalizeDuelState({ ...snapshot, rival: { ...snapshot.rival, stamina: 8 } })).toBeNull();
    expect(normalizeDuelState({ player: snapshot.player })).toBeNull();
  });
});

describe('synthetic ACE/WOLF recorded preview', () => {
  it('exposes its synthetic provenance, three actions, exact bot names and no spendable rewards', () => {
    const parsed = normalizeDuelReceipt(DUEL_PREVIEW_RECEIPT);
    expect(parsed.synthetic).toBe(true); expect(parsed.attackerBotId).toBe('ACE'); expect(parsed.defenderBotId).toBe('WOLF');
    expect(parsed.roundCount).toBe(3); expect(parsed.rounds.map(round => round.action)).toEqual(['Strike', 'Heavy', 'Finisher']);
    expect(parsed.rounds.map(round => round.damage)).toEqual([9, 0, 21]);
    expect(parsed.didWin).toBe(true); expect(parsed.holosGranted).toBeNull();
    expect(normalizeDuelReceipt({ ...DUEL_PREVIEW_RECEIPT, settlement: { didWin: true, holosGranted: 999 } }).holosGranted).toBeNull();
  });
  it('uses the authored snapshot chain and command costs from the seven-stamina mobile catalog', () => {
    const parsed = normalizeDuelReceipt(DUEL_PREVIEW_RECEIPT);
    expect(parsed.rounds[0].before).toEqual(parsed.initialState);
    expect(parsed.rounds[1].before).toEqual(parsed.rounds[0].after);
    expect(parsed.rounds[2].before).toEqual(parsed.rounds[1].after);
    expect(parsed.rounds[0].after?.rival.hp).toBe(21);
    expect(parsed.rounds[1].after?.player.hp).toBe(40);
    expect(parsed.rounds[2].after?.rival.hp).toBe(0);
    expect(parsed.rounds[2].after?.player.stamina).toBe(2);
    const catalog = ['strike.quickJab', 'strike.tempoThrust', 'defense.guardUp', 'finisher.tacticalOverride'].map(id => createActionCardFromTemplate(id, id)?.staminaCost);
    expect(Object.values(parsed.commandCosts!)).toEqual(catalog);
  });
  it('applies before snapshots at action start and after snapshots only at the impact cue', () => {
    const cues = buildPlaybackCues(normalizeDuelReceipt(DUEL_PREVIEW_RECEIPT).rounds);
    for (let index = 0; index < 3; index++) {
      const states = cues.filter(cue => cue.roundIndex === index && cue.kind === 'state');
      expect(states.map(cue => cue.atMs)).toEqual([index * ROUND_DURATION_MS, index * ROUND_DURATION_MS + ROUND_IMPACT_MS]);
      expect(states[0].snapshot).toEqual(DUEL_PREVIEW_RECEIPT.rounds[index].before);
      expect(states[1].snapshot).toEqual(DUEL_PREVIEW_RECEIPT.rounds[index].after);
    }
    expect(cues.filter(cue => cue.kind === 'attack').map(cue => cue.clip)).toEqual(['Skybreaker', 'LowRoundhouse', 'MeteorHammer']);
    expect(cues.filter(cue => cue.roundIndex === 1 && cue.kind === 'hit')).toEqual([]);
  });
  it('never decides a winner from zero HP and preserves a recorded result independently of animation', () => {
    const withoutResult = normalizeDuelReceipt({ ...DUEL_PREVIEW_RECEIPT, settlement: {} });
    expect(withoutResult.rounds[2].after?.rival.hp).toBe(0); expect(withoutResult.didWin).toBeNull();
    const before = JSON.stringify(DUEL_PREVIEW_RECEIPT);
    buildPlaybackCues(normalizeDuelReceipt(DUEL_PREVIEW_RECEIPT).rounds);
    expect(JSON.stringify(DUEL_PREVIEW_RECEIPT)).toBe(before);
    expect(normalizeDuelReceipt({ ...DUEL_PREVIEW_RECEIPT, settlement: { didWin: false } }).didWin).toBe(false);
  });
});

describe('manifest clip mapping', () => {
  it('loops ACE FableHover / WOLF HoverIdle on an Idle request', () => {
    expect(resolveClipName('Idle', ['Evade', 'FableHover', 'JabCross'], 'FableHover')).toBe('FableHover'); expect(resolveClipName('Idle', ['HoverIdle', 'StepCross'], 'HoverIdle')).toBe('HoverIdle');
  });
  it('accepts exact Unity take names and rejects absent hit clips', () => {
    expect(resolveClipName('HB_WOLF_Mixar_SupermanPunch', ['HoverIdle', 'SupermanPunch'], 'HoverIdle')).toBe('SupermanPunch'); expect(resolveClipName('HitLight', ['Idle', 'Evade'], 'Idle')).toBeNull();
  });
});
