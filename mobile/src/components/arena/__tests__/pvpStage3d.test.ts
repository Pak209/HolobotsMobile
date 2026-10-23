import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pvpStageAction } from '../pvpStageAction';
import type { BattleAction } from '../../../types/arena';

/** lite-pvp-3d-1 (Pak 10-22: "PvP for the lite version still showed the 2d battle"): PvP 1v1 and 3v3 fight on the Arena
 * round's 3D stage behind the lite-hud-row-1 HUD. Source guards (no RN renderer here); the simulator sheet covers pixels. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), 'utf8');
const live = read('../PvpLiveBattle.tsx');
const view = read('../BattleArenaView.tsx');
const stage = read('../../duel/DuelBotStage.tsx');

describe('PvP renders the Arena round\'s 3D stage', () => {
  it('the live PvP body asks for the 3D stage; the 2D sprite floor is only the fallback', () => {
    expect(live).toMatch(/^\s*stage3d$/m);
    expect(view).toContain('const show3d = stage3d && !stageFailed && hasDuelBotStage(battle);');
    expect(view).toContain('<DuelBotStage battle={battle} action={lastAction} active={!team?.sendIn} onError={() => setStageFailed(true)} />');
    expect(view).toContain('{show3d ? <View pointerEvents="none" testID="pvp-stage-3d" style={styles.battleStageWrap} /> : <View style={styles.battleStageWrap}>');
  });
  it('known-bad: the pre-lane PvP body (no stage3d) would still draw the 2D sprites', () => {
    const before = live.replace(/\n\s*stage3d\n/, '\n');
    expect(before).not.toMatch(/^\s*stage3d$/m);
    expect(view).toContain('stage3d = false,');
  });
  it('the stage is the Arena round\'s: duelPortrait BotStage on the park plate, fast mix, pack VFX + SKY / BREAK camera beat', () => {
    expect(stage).toContain('<BotStage ref={stage} variant="duelPortrait" transparentBackdrop');
    expect(stage).toContain("require('../../../assets/battle/holocity-park.jpg')");
    expect(stage).toContain('renderQuality = FAST_RENDER_QUALITY, vfx = true, specialCamera = true');
    expect(stage).toContain('if (vfx) for (const cue of liveDuelVfxCues(action, battle, { player, rival })) stage.current?.fx(cue, IMPACT_MS);');
    expect(stage).toContain('const IMPACT_MS = 300;');
  });
  it('3v3: only the two active fighters are on stage (a switch swaps the model; never six at once)', () => {
    expect(stage).toContain("bots={[{ id: player, side: 'player' }, { id: rival, side: 'rival' }]}");
    expect(stage).toContain('useEffect(() => { setReady(false); }, [player, rival]);');
  });
  it('presentation only: the 3D layer is not touchable and the HUD presses are unchanged', () => {
    expect(view).toContain('{show3d ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: -stageBleedTop }]}>');
    expect(view).toContain('if (slot.signature) onSignaturePlay(finisherPower);');
    expect(stage).not.toMatch(/runTransaction|ArenaCombatEngine|useArenaStore|setDoc|updateDoc/);
  });
});

describe('pvpStageAction: the action in the viewer\'s frame (display only)', () => {
  const action = { id: 'a1', actorRole: 'player' } as BattleAction;
  it('p1 sees the room action as is', () => expect(pvpStageAction(action, 'p1')).toBe(action));
  it('p2 (fighters flipped for display) sees p1\'s move as the opponent\'s', () => {
    expect(pvpStageAction(action, 'p2')?.actorRole).toBe('opponent');
    expect(pvpStageAction({ ...action, actorRole: 'opponent' }, 'p2')?.actorRole).toBe('player');
    expect(action.actorRole).toBe('player');
  });
  it('no actorRole (resolved by actorId) and no action pass through', () => {
    const bare = { id: 'a2' } as BattleAction;
    expect(pvpStageAction(bare, 'p2')).toBe(bare);
    expect(pvpStageAction(null, 'p2')).toBeNull();
    expect(pvpStageAction(undefined, 'p1')).toBeNull();
  });
});
