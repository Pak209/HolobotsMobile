import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/config/holobots', () => ({ getHolobotFullImageSource: () => 1 }));
import { arenaHostBattle } from '@/lib/arenaHostBattle';
import { ArenaCombatEngine } from '@/features/arena/combatEngine';
import type { BattleAction, BattleState, CardType, ActionOutcome } from '@/types/arena';
import { flashAlphaAfter, hermite, hexRgb, linearAt } from '../vfxCurves';
import { liveDuelVfxCues } from '../liveDuelVfx';
import { readArenaReply } from '@/lib/arenaMatchFlow';
import fixture from '../../qa/fixtures/arena-admitted-lifecycle.json';
import manifest from '../../../assets/vfx/pack_manifest.json';

/**
 * lite-vfx-port-1 (DECISIONS #72.57): the HoloCity combat-VFX pack and its player. The pack is HolobotsUnity's
 * Tools/VFX/pack/export_pack.py output; these pins keep the app copy whole, inside its budget and faithful to the Unity
 * numbers it was exported from, and keep the player inside its pool and off the per-frame allocator.
 */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url) as unknown as string);
const read = (path: string) => readFileSync(here(path), 'utf8');
const ASSETS = '../../../assets/vfx/';

describe('the pack in the app', () => {
  it('every texture the manifest lists is shipped and required by the asset index (and nothing else is)', () => {
    const index = read(ASSETS + 'index.ts');
    const required = [...index.matchAll(/require\('\.\/([^']+)'\)/g)].map(m => m[1]).sort();
    const listed = Object.values(manifest.textures).map(t => t.file).sort();
    expect(required).toEqual(listed);
    for (const file of listed) expect(statSync(here(ASSETS + file)).size).toBe((manifest.textures as Record<string, { file: string; bytes: number }>)[file.split('/')[1].replace('.png', '')].bytes);
  });
  it('stays under the 2 MB app budget (manifest + textures)', () => {
    const total = statSync(here(ASSETS + 'pack_manifest.json')).size + Object.values(manifest.textures).reduce((sum, t) => sum + t.bytes, 0);
    expect(total).toBeLessThan(2 * 1024 * 1024);
    expect(total).toBeGreaterThan(50_000);
  });
  it('ships ACE (Unity redo built) and WOLF (pack only: no Unity redo prefab yet, so the app holds it back)', () => {
    expect(Object.keys(manifest.kits).sort()).toEqual(['ace', 'wolf']);
    expect(manifest.kits.ace.unityRedoBuilt).toBe(true);
    expect(manifest.kits.wolf.unityRedoBuilt).toBe(false);
    const player = read('../vfxPlayer.ts');
    expect(player).toContain('k.unityRedoBuilt || (__DEV__ && this.allowUnbuilt)');
  });
  it('carries ACE BREAK attempt 3 and SKYBREAKER as Unity builds them (layers, colours, sizes, timings)', () => {
    const brk = manifest.kits.ace.effects.break_heavy.layers.map(l => l.type);
    expect(brk).toEqual(['element', 'element', 'element', 'charge', 'flash', 'groundLight', 'debris', 'dust', 'residue']);
    const flash = manifest.kits.ace.effects.break_heavy.layers.find(l => l.type === 'flash')!.params!;
    expect(flash).toMatchObject({ sizeH: 2.5, intensity: 2, life: 0.5, streak: 0.4, fringe: '#FF8DA4', atChest: true });
    const sky = manifest.kits.ace.effects.sky_launch.layers;
    expect(sky.filter(l => l.lite === 'skip').map(l => l.type)).toEqual(['hovl', 'trail']);
    expect(sky.find(l => l.type === 'residue')!.params).toMatchObject({ mode: 'decal', mask: 'ring', sizeH: 2.2, life: 3, color: '#FF8DA4' });
    expect(manifest.kits.wolf.effects.sky_launch.layers.find(l => l.type === 'skyColumn')!.params).toMatchObject({ heightH: 6, lead: 0.1, fade: 0.25, life: 0.35 });
  });
});

describe('curves and the screen flash (ports)', () => {
  it('Hermite keys evaluate as Unity AnimationCurve does at the keys and stay monotone on ring_expand', () => {
    const ring = manifest.curves.scale.ring_expand;
    expect(hermite(ring, 0)).toBeCloseTo(0.35, 6); expect(hermite(ring, 1)).toBeCloseTo(1, 6);
    let last = 0; for (let t = 0; t <= 1.0001; t += 0.05) { const v = hermite(ring, t); expect(v).toBeGreaterThanOrEqual(last - 1e-9); last = v; }
    expect(hermite(manifest.curves.dissolve.late, 0.5)).toBeCloseTo(0, 6);
    expect(hermite(manifest.curves.dissolve.late, 1)).toBeCloseTo(1, 6);
  });
  it('linear key tables interpolate and clamp', () => {
    const t = new Float32Array([0, 0, 0.5, 1, 1, 0]);
    expect(linearAt(t, -1)).toBe(0); expect(linearAt(t, 0.25)).toBeCloseTo(0.5); expect(linearAt(t, 0.75)).toBeCloseTo(0.5); expect(linearAt(t, 2)).toBe(0);
  });
  it('CombatScreenFlash pulses: SKY 0.14 held 1 frame out over 8, BREAK 0.10 out over 6 (frame-timed, ease-out)', () => {
    const { sky, break: brk } = manifest.screenFlash;
    expect([0, 1, 2, 3, 9, 10].map(k => +flashAlphaAfter(sky, k).toFixed(4))).toEqual([0.14, 0.14, 0.1072, 0.0788, 0, 0]);
    expect([0, 1, 6, 7].map(k => +flashAlphaAfter(brk, k).toFixed(4))).toEqual([0.1, 0.0694, 0, 0]);
    expect(manifest.screenFlash.rateLimitSeconds).toBe(0.5);
  });
  it('known-bad: a one-frame-longer SKY hold is caught', () => {
    expect(flashAlphaAfter({ ...manifest.screenFlash.sky, holdFrames: 2 }, 2)).not.toBeCloseTo(flashAlphaAfter(manifest.screenFlash.sky, 2), 4);
  });
  it('local witness: the pack pulses equal CombatScreenFlash.cs (skipped in CI, where the Unity repo is absent)', () => {
    const cs = resolve(process.env.HOLOBOTS_UNITY_ROOT ?? resolve(homedir(), 'Projects/HolobotsUnity'), 'Assets/Battle/Scripts/Combat/Fx/CombatScreenFlash.cs');
    if (!existsSync(cs)) return;
    const src = readFileSync(cs, 'utf8');
    const pulse = (name: string) => { const m = new RegExp(`Pulse ${name} = new Pulse\\(([\\d.]+)f, (\\d+), (\\d+), (\\d+)\\)`).exec(src)!; return { peak: +m[1], upFrames: +m[2], holdFrames: +m[3], outFrames: +m[4] }; };
    expect(pulse('Sky')).toEqual({ peak: 0.14, upFrames: 1, holdFrames: 1, outFrames: 8 });
    expect(pulse('Break')).toEqual({ peak: manifest.screenFlash.break.peak, upFrames: 1, holdFrames: 0, outFrames: 6 });
  });
  it('hex colours parse', () => { expect(hexRgb('#FF8DA4').map(v => Math.round(v * 255))).toEqual([255, 141, 164]); });
});

describe('which effect a resolved action shows (presentation of the engine / store result only)', () => {
  const prepared = arenaHostBattle(readArenaReply(fixture.steps.find(s => s.request.operation === 'start')!.reply).match!, 'offline-fixture');
  const battle: BattleState = prepared.battle;
  const act = (type: CardType, outcome: ActionOutcome, damage: number, role: 'player' | 'opponent' = 'player'): BattleAction => ({
    id: 'a', turnNumber: 1, actorId: role === 'player' ? battle.player.holobotId : battle.opponent.holobotId, actorRole: role, targetId: '', card: { ...prepared.playerMoves[0], type },
    actionType: type, timestamp: 0, outcome, damageDealt: damage, actualDamage: damage, staminaChange: 0, specialMeterChange: 0, wasCountered: false, triggeredCombo: false, perfectDefense: false });
  const kits = { player: 'ace', rival: 'hare' } as const;
  it.each([
    ['combo', 'hit', 20, [{ kit: 'ace', effect: 'break_heavy', caster: 'player', target: 'rival', phases: ['windup', 'landing'], flash: 'break' }]],
    ['finisher', 'hit', 30, [{ kit: 'ace', effect: 'sky_launch', caster: 'player', target: 'rival', phases: ['windup', 'landing'], flash: 'sky' }]],
    ['strike', 'hit', 10, [{ kit: 'ace', effect: 'impactAccent', caster: 'player', target: 'rival', phases: ['windup', 'landing'], flash: null }]],
    ['combo', 'countered', 12, [{ kit: 'hare', effect: 'impactAccent', caster: 'rival', target: 'player', phases: ['landing'], flash: 'sky' }]],
    ['combo', 'blocked', 0, [{ kit: 'ace', effect: 'break_heavy', caster: 'player', target: 'rival', phases: ['windup'], flash: null }, { kit: null, effect: 'guard', caster: 'player', target: 'rival', phases: ['landing'], flash: null }]],
    ['combo', 'dodged', 0, [{ kit: 'ace', effect: 'break_heavy', caster: 'player', target: 'rival', phases: ['windup'], flash: null }]],
    ['strike', 'missed', 0, []],
    ['defense', 'hit', 0, [{ kit: 'ace', effect: 'intercept', caster: 'player', target: 'player', phases: ['windup'], flash: null }]],
  ] as const)('%s %s (%d dmg)', (type, outcome, damage, cues) => {
    expect(liveDuelVfxCues(act(type, outcome, damage), battle, kits)).toEqual(cues);
  });
  it('the CPU side plays its own kit', () => {
    expect(liveDuelVfxCues(act('combo', 'hit', 20, 'opponent'), battle, kits)[0]).toMatchObject({ kit: 'hare', caster: 'rival', target: 'player' });
  });
  it('FINISHER on the Arena round stays the engine signature (no listed move): the witness route builds it the same way', () => {
    expect(ArenaCombatEngine.buildSignatureCard(battle.player, 'full').type).toBe('finisher');
  });
});

describe('wiring pins', () => {
  const player = read('../vfxPlayer.ts');
  it('the pool is 200 live particles, scheduled spawns included, and a full pool drops (counted) instead of growing', () => {
    expect(player).toContain('export const VFX_MAX_LIVE = 200;');
    expect(player).toContain("if (this.freeTop === 0) { this.stats.dropped++; return -1; }");
  });
  it('update() allocates nothing: no new / array or object literals / closures inside it', () => {
    const body = player.slice(player.indexOf('  update(nowS: number) {'), player.indexOf('  /** The current screen-flash alpha'));
    expect(body.length).toBeGreaterThan(2000);
    expect(body).not.toMatch(/\bnew\s|=>|\[\s*\]|\{\s*\}|\.map\(|\.filter\(|\.slice\(|\.\.\./);
  });
  it('known-bad control for the allocation pin: an allocating line is caught', () => {
    expect('const v = new THREE.Vector3();').toMatch(/\bnew\s|=>|\[\s*\]|\{\s*\}|\.map\(|\.filter\(|\.slice\(|\.\.\./);
  });
  it('the stage fires from the action effect that presents the store update, at the hit recoil beat; VFX are opt-in', () => {
    const stage = read('../../components/duel/LiveDuelStage.tsx');
    expect(stage).toContain('if (vfx) for (const cue of liveDuelVfxCues(action, battle, { player, rival })) stage.current?.fx(cue, IMPACT_MS);');
    expect(stage).toContain('vfx = false');
    expect(read('../../components/bots/BotStage.tsx')).toContain('vfx = false, vfxUnbuiltKits = false');
    expect(read('../../screens/ArenaScreen.tsx')).toContain('vfx={preview?.vfx ?? true}');
  });
  it('lite-2305-1: the city duel plays the VFX by default (Pak 23:05); the duel playback still does not', () => {
    const city = read('../../components/city/CityLiveBattleView.tsx');
    expect(city).toContain('vfx = true, specialCamera = true');
    expect(city).toContain('vfx={vfx} specialCamera={specialCamera}');
    expect(read('../../components/city/CityRivalBattle.tsx')).not.toMatch(/\bvfx=/);
    expect(read('../../screens/DuelPlaybackScreen.tsx')).not.toMatch(/\bvfx\b/);
  });
});
