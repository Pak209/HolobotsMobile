import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Source guards for the lite-arena-polish-1 UX rows (critic L1-L21, DECISIONS #71). There is no RN renderer in this
 * test environment, so each row is pinned at the line that fixes it; the simulator witness covers the pixels. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), 'utf8');
const screen = read('../../../screens/ArenaScreen.tsx');
const view = read('../BattleArenaView.tsx');
const modal = read('../BattleResultsModal.tsx');
const interstitial = read('../ArenaInterstitial.tsx');
const menu = read('../ArenaPrebattleMenu.tsx');

describe('lite Arena UX rows', () => {
    it('L1: non-fight states render through the framed interstitial; no raw error text or inline link-style buttons', () => {
        expect(screen).toContain('<ArenaInterstitial');
        expect(screen).not.toMatch(/String\(e\.message|e instanceof Error \? e\.message|\{error\}/);
        expect(screen).not.toMatch(/RETRY SAME ADMISSION|CONTINUE SAME MATCH|LOST CHECKPOINT COUNTS AS KO|RETRY SAME SETTLEMENT/);
        expect(interstitial).toContain('<GameDialogFrame');
    });
    it('L2: no CPU PRACTICE / EXTRAS UNAVAILABLE banner, and ability panels only for real passives', () => {
        expect(screen).not.toMatch(/CPU PRACTICE|EXTRAS UNAVAILABLE/);
        expect(view).not.toContain('EXTRAS UNAVAILABLE');
        expect(view).toContain('abilitySides.length > 0 ?');
    });
    it('L3: safe-area insets, no hardcoded 45/70/90/64 top padding', () => {
        for (const src of [screen, view, menu]) expect(src).not.toMatch(/paddingTop:\s*(45|50|64|70|90)\b/);
        expect(screen).toContain('useSafeAreaInsets()');
        expect(menu).toContain('paddingTop: insets.top + 14');
    });
    it('L5: the Arena battle has a stage backdrop again (the park), under a token scrim', () => {
        expect(view).toContain('require("../../../assets/battle/holocity-park.jpg")');
        expect(view).toContain('<Image source={ARENA_STAGE}');
    });
    it('L7: no empty ghost move cards', () => {
        expect(view).not.toMatch(/cardSlotEmpty|emptyCardCore|undefined as never/);
        expect(view).toContain('if (!battle.hostSnapshot) slots.push(');
    });
    it('L8 (lite-hud-row-1): the PvP command block is the park duel\'s: 14 pt inset, a ≥ 44 pt hint line, one plate row', () => {
        expect(view).toMatch(/commandDock: \{[^}]*marginHorizontal: 14/);
        expect(view).toMatch(/hint: \{[^}]*minHeight: 44/);
        expect(view).toContain('<HoloCityCommandBar compact commands={commands}');
        expect(view).not.toMatch(/BayFrame|cardBay|arena-moves/);
    });
    it('L18: no fake progress rail, and reward rows draw real glyphs', () => {
        expect(modal).not.toMatch(/headerRailFill|width: '62%'/);
        expect(modal).toContain('REWARD_GLYPHS[row.glyph]');
        expect(modal).toContain("blueprint: require('../../../assets/game/Blueprint.png')");
    });
    it('L21: theme tokens only (no raw hex or rgba) in the Arena screen, interstitial, results modal, battle view and picker', () => {
        for (const src of [screen, interstitial, modal, view, menu]) expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]|rgba\(/);
    });
    it('DECISIONS #71: the admitted fighter cards carry the LV badge as a lower-left corner tab, only when a level exists', () => {
        expect(interstitial).toMatch(/levelTab: \{[^}]*bottom: 0, left: 0[^}]*position: 'absolute'/);
        expect(interstitial).toContain('{lv ? <View style={[styles.levelTab');
        expect(screen).toContain('<ArenaFighterCard snapshot={match.entrant} side="entrant"/>');
    });
});
