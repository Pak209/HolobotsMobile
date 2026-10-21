import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/config/holobots', () => ({ getHolobotFullImageSource: () => 1 }));
import { arenaHostBattle } from '@/lite/lib/arenaHostBattle';
import { readArenaReply } from '@/lite/lib/arenaMatchFlow';
import type { HoloCityCommand } from '@/lite/components/HoloCityCommandBar';
import type { BattleState } from '@/lite/types/arena';
import {
  CHIP_HEIGHT, MIN_TAP, PLATE_POSITION, READINESS_TEXT, commandPlateLayout, fighterPanelPoints, hexPoints, insetPolygon, rectsOverlap, roundPlatePoints,
  type Point, type Rect,
} from '../commandPlateLayout';
import { HOLO_COMMAND_GLYPHS, glyphLayerPoints } from '../holoCommandGlyphs';
import { finisherReadiness, liveDuelCommands } from '../liveDuelCommands';
import fixture from '../../../qa/fixtures/arena-admitted-lifecycle.json';

/** lite-battle-ui-1 (DECISIONS #72.56): the HoloCity battle HUD replaces the square command cards. No RN renderer runs
 * here, so the plate geometry is tested on the same pure layout the bar renders from, the glyphs against Unity's own
 * point lists, the readiness chip against the real engine, and the wiring at its source lines. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), 'utf8');
const bar = read('../../HoloCityCommandBar.tsx');
const art = read('../HoloHudArt.tsx');
const stage = read('../LiveDuelStage.tsx');
const playback = read('../../../screens/EnabledDuelPlaybackScreen.tsx');
const PLATES: HoloCityCommand[] = [{ id: 'strike', label: 'STRIKE' }, { id: 'heavy', label: 'HEAVY' }, { id: 'defend', label: 'DEFEND' }, { id: 'finisher', label: 'FINISHER' }];
const match = readArenaReply(fixture.steps.find(s => s.request.operation === 'start')!.reply).match!;

/** The bar's width on a phone: LiveDuelStage and DuelPlaybackScreen both inset it 14 pt each side. */
const barWidth = (screenWidth: number) => screenWidth - 28;
const inside = (p: Point, r: Rect) => p[0] >= r.x - 1e-6 && p[0] <= r.x + r.width + 1e-6 && p[1] >= r.y - 1e-6 && p[1] <= r.y + r.height + 1e-6;
/** Twice the signed area: positive = clockwise in screen space (y down). */
const area2 = (points: readonly Point[]) => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
const isSimple = (points: readonly Point[]) => points.every((a, i) => points.every((c, j) => {
  const n = points.length; if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1) || (j === 0 && i === n - 1)) return true;
  return !segmentsCross(a, points[(i + 1) % n], c, points[(j + 1) % n]);
}));

describe('HoloCity command plates: layout', () => {
  it.each([[375, 812], [402, 874], [430, 932]])('at %i×%i the four plates never overlap and every tap target is ≥ 44 pt', (width) => {
    const layout = commandPlateLayout(barWidth(width), { compact: true });
    expect(layout.slots).toHaveLength(4);
    for (const [i, a] of layout.slots.entries()) {
      // The pressable is the slot: the hex plate plus the chip that hangs below it.
      expect(a.width).toBeGreaterThanOrEqual(MIN_TAP);
      expect(a.height).toBeGreaterThanOrEqual(MIN_TAP);
      expect(a.plate.height).toBeGreaterThanOrEqual(MIN_TAP);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(layout.width + 1e-6);
      expect(a.y + a.height).toBeLessThanOrEqual(layout.height + 1e-6);
      // The hex and the chip both stay inside their own slot, so nothing drawn reaches a neighbour.
      for (const p of a.hex) expect(inside(p, a)).toBe(true);
      expect(inside([a.chip.x, a.chip.y], a) && inside([a.chip.x + a.chip.width, a.chip.y + a.chip.height], a)).toBe(true);
      for (const b of layout.slots.slice(i + 1)) {
        expect(rectsOverlap(a, b)).toBe(false);
        expect(rectsOverlap(a.chip, b.plate)).toBe(false);
      }
    }
  });

  it('the bar leaves the 3D stage visible at 375×812 (smallest supported portrait phone)', () => {
    // Top: inset 47 + toolbar 44 + 8 + fighter card 72. Bottom: inset 34 + action strip 38 + hint line 44 + 8 + the bar.
    const top = 47 + 44 + 8 + 72, bottom = 34 + 38 + 44 + 8 + commandPlateLayout(barWidth(375), { compact: true }).height;
    expect(812 - top - bottom).toBeGreaterThanOrEqual(240);
  });

  it("places the plates as Pak's concept: STRIKE / DEFEND on top, HEAVY (the concept's COMBO) / FINISHER below", () => {
    const order = PLATES.map(p => p.id).sort((a, b) => PLATE_POSITION[a] - PLATE_POSITION[b]);
    expect(order).toEqual(['strike', 'defend', 'heavy', 'finisher']);
    expect(bar).toContain('.sort((a, b) => a.position - b.position)');
    expect(bar).toContain('const slot = layout.slots[slotIndex];');
  });

  it('hex, chip, fighter-card and counter frames are convex, clockwise and insettable (the bevel trace)', () => {
    for (const points of [hexPoints(183, 84), hexPoints(80, CHIP_HEIGHT, 7), fighterPanelPoints(160, 72, 52), fighterPanelPoints(160, 72, 52, true), roundPlatePoints(56, 72)]) {
      expect(area2(points)).toBeGreaterThan(0);
      expect(isSimple(points)).toBe(true);
      const trace = insetPolygon(points, 5);
      expect(Math.abs(area2(trace))).toBeLessThan(Math.abs(area2(points)));
      expect(area2(trace)).toBeGreaterThan(0);
    }
    // The rival card mirrors the player's: the portrait end swaps sides.
    expect(fighterPanelPoints(160, 72, 52)[0]).toEqual([26, 0]);
    expect(fighterPanelPoints(160, 72, 52, true).some(([x, y]) => x === 134 && y === 0)).toBe(true);
  });
});

describe('HoloCity command glyphs: ported from Unity', () => {
  it('every glyph layer is a simple polygon inside its icon box; FINISHER reuses the BREAK icon (Pak 2026-09-26)', () => {
    for (const glyph of Object.values(HOLO_COMMAND_GLYPHS)) for (const layer of glyph.layers) {
      expect(isSimple(layer.points)).toBe(true);
      for (const p of glyphLayerPoints(layer, 100, 100)) expect(p.every(v => v >= 0 && v <= 100)).toBe(true);
    }
    expect(HOLO_COMMAND_GLYPHS.finisher.layers.map(l => l.points)).toEqual(HOLO_COMMAND_GLYPHS.heavy.layers.map(l => l.points));
    expect(HOLO_COMMAND_GLYPHS.finisher.accent).toBe('heavy');
  });

  // Local witness only: the Unity project is not in CI. HOLOBOTS_UNITY_ROOT overrides the default checkout path.
  const unity = resolve(process.env.HOLOBOTS_UNITY_ROOT ?? resolve(homedir(), 'Projects/HolobotsUnity'), 'Assets/UI/Foundation/Runtime/HoloCombatCommandGraphic.cs');
  it.skipIf(!existsSync(unity))('the point lists equal HoloCombatCommandGraphic.Icon() verbatim (FAST, BREAK, INTERCEPT)', () => {
    const source = readFileSync(unity, 'utf8');
    const icon = source.slice(source.indexOf('void Icon('), source.indexOf('static void ChainLink('));
    const branch = (from: string, to: string) => icon.slice(icon.indexOf(from), icon.indexOf(to));
    const lists = (code: string) => [...code.matchAll(/Points\(([^)]*)\)/g)].map(m => m[1].split(',').map(v => Number(v.trim().replace(/f$/, ''))));
    const ours = (id: keyof typeof HOLO_COMMAND_GLYPHS) => HOLO_COMMAND_GLYPHS[id].layers.filter(l => !l.inset).map(l => l.points.flat());
    expect(ours('strike')).toEqual(lists(branch('Command==CombatHudCommand.Fast', '// SKYBREAKER reuses')));
    expect(ours('heavy')).toEqual(lists(branch('Command==CombatHudCommand.Break||', 'else if(Command==CombatHudCommand.Intercept)')));
    expect(ours('defend')).toEqual(lists(branch('else if(Command==CombatHudCommand.Intercept)', 'else if(Command==CombatHudCommand.Link)')));
    // Unity: Fill(v, Inset(r,7), p, …) on BREAK's body.
    expect(icon).toContain('Fill(v,Inset(r,7),p,new Color32(255,218,139,255));');
  });
});

describe('FINISHER readiness chip (LOCKED / HALF READY / FULL READY) reads the engine', () => {
  const battleWith = (stamina: number, sync: number): BattleState => {
    const { battle } = arenaHostBattle(match, 'offline-fixture');
    return { ...battle, status: 'active', player: { ...battle.player, stamina, specialMeter: sync, actionLockUntil: 0 } };
  };
  it('maps the engine signature availability at each power; no signature for the match reads LOCKED', () => {
    expect(finisherReadiness(battleWith(7, 100), false)).toBe('locked');
    expect(finisherReadiness(battleWith(7, 0), true)).toBe('locked');
    expect(finisherReadiness(battleWith(7, 50), true)).toBe('half');
    expect(finisherReadiness(battleWith(3, 100), true)).toBe('half');
    expect(finisherReadiness(battleWith(7, 100), true)).toBe('full');
    expect(finisherReadiness({ ...battleWith(7, 100), player: { ...battleWith(7, 100).player, actionLockUntil: Date.now() + 60_000 } }, true)).toBe('locked');
    expect(READINESS_TEXT).toEqual({ locked: 'LOCKED', half: 'HALF READY', full: 'FULL READY' });
  });
  it('only the FINISHER plate carries readiness; the command rows the stage reads are otherwise unchanged', () => {
    const { battle, playerMoves } = arenaHostBattle(match, 'offline-fixture');
    const commands = liveDuelCommands(PLATES, { battle, moves: playerMoves, power: 'half', signature: !battle.hostSnapshot, playableIds: playerMoves.map(m => m.id), blocked: false });
    expect(commands.map(c => c.readiness)).toEqual([undefined, undefined, undefined, 'locked']);
    expect(stage).toContain("const finisherReadiness = commands.find(command => command.id === 'finisher')?.readiness;");
    expect(stage).toContain('{finisherReadiness ? <FinisherReadinessChip readiness={finisherReadiness} /> : null}');
  });
});

describe('the HUD wiring (presentation only)', () => {
  it('LiveDuelStage keeps its press mapping; the round counter, action strip and hint line use the shared HUD art', () => {
    expect(stage).toContain("if (id === 'finisher') onSignature(power);");
    expect(stage).toContain('else { const card = liveDuelCommandMove(id, moves); if (card) onPlay(card.id); }');
    expect(stage).toContain('<HudRoundPlate testID="live-duel-turn" label="TURN"');
    expect(stage).toContain('<HudActionStrip testID="live-duel-log"');
    expect(stage).toContain('`COMBO ×${battle.player.comboCounter} · ${Math.round(battle.player.specialMeter)}% SYNC`');
    expect(stage).toMatch(/hint: \{[^}]*minHeight: 44/);
  });
  it('the fighter card keeps the DECISIONS #71 LV tab and the green-you / red-rival HP', () => {
    expect(playback).toContain('{badge && levelTab ? <View testID={`fighter-level-tab-${name.toLowerCase()}`} style={styles.levelTab}>');
    expect(playback).toContain('const hp = rival ? theme.hud.hpRival : theme.hud.hpPlayer;');
    expect(playback).toContain('<HudRoundPlate label=');
  });
  it('unavailable plates dim their contents (0.45, as before) and stay unpressable; the carbon face stays solid', () => {
    expect(bar).toContain('disabled={!!blocked}');
    expect(bar).toContain('const dim = !!blocked && !active;');
    expect(bar).toMatch(/disabled: \{ opacity: 0\.45 \}/);
    expect(art).toContain('strokeOpacity={dim ? 0.4 : 1}');
  });
  it('no bitmap ships for the HUD: plates, frames and glyphs are vector; arena-moves stays with PvP and the Move Lab', () => {
    for (const src of [bar, art]) expect(src).not.toMatch(/require\(|arena-moves/);
  });
  it('L21: theme tokens only (no raw hex or rgba) in the new HUD files', () => {
    for (const src of [bar, art, read('../commandPlateLayout.ts'), read('../holoCommandGlyphs.ts')]) expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]|rgba\(/);
  });
});
