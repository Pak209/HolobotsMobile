import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARTBOARD_HEIGHT, fitArtboard, homeCompactFactor, HOME_REFERENCE_SCALE } from '../../config/homeLayout';
import { getHolobotDisplayStats, HOLOBOT_BASE_STATS } from '../../../lib/progression';

/** lite-sim-fixes-1: the "should fix" presentation items from the lite 1.1.0 (39) simulator smoke (lite-sim-smoke-1).
 * Source guards plus layout arithmetic (no RN renderer here); the simulator before/after sheet covers pixels. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), 'utf8');
const styleBlock = (source: string, name: string) => {
  const start = source.indexOf(`  ${name}: {`);
  expect(start, name).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('},', start));
};

describe('1 · city duel and duel playback render with the Arena round\'s fast mix', () => {
  it('the playback stage passes FAST_RENDER_QUALITY (the city duel is guarded in arenaLiveStage.test)', () => {
    const playback = read('../../screens/EnabledDuelPlaybackScreen.tsx');
    expect(playback).toContain("import { FAST_RENDER_QUALITY } from '../lib/bots/stagePerf';");
    expect(playback).toContain('style={styles.stage} quality={FAST_RENDER_QUALITY} active={!paused}');
  });
});

describe('2 · the holobot detail modal has an opaque backing', () => {
  const modal = read('../HolobotStatsModal.tsx');
  it('draws the navy dialog plate behind the scrolled content, like the other dialogs', () => {
    const plate = modal.indexOf('<GameDialogFrame accent={theme.colors.accent} fill={theme.plates.navy} />');
    expect(plate).toBeGreaterThan(-1);
    expect(plate).toBeLessThan(modal.indexOf('<ScrollView contentContainerStyle={styles.scrollContent}'));
    // The card itself stays transparent; the plate is what makes it opaque.
    expect(styleBlock(modal, 'card')).toContain('backgroundColor: "transparent"');
  });
});

describe("3 · a KO'd PvP teammate chip keeps its HUD plate", () => {
  const view = read('../arena/BattleArenaView.tsx');
  it('known-bad: opacity on the chip faded its navy plate with it; now only the contents dim', () => {
    for (const name of ['switchChipKo', 'benchChipKo']) {
      const block = styleBlock(view, name);
      expect(block, name).not.toContain('opacity');
      expect(block, name).toContain('backgroundColor: theme.plates.navy');
    }
    expect(styleBlock(view, 'koDim')).toContain('opacity');
    expect(view).toContain('chip.isKnockedOut ? styles.switchChipMetaKo : null');
  });
});

describe('4 · Home at 375 pt', () => {
  // The rail: four 52 pt circles, 10 pt gaps, from 14.5 % down; the CHANGE HOLOBOT bar starts at artboard y 1878.
  const railBottom = (frame: { scale: number; height: number }) => 0.145 * frame.height + (4 * 52 + 3 * 10) * homeCompactFactor(frame.scale);
  const changeBarTop = (frame: { scale: number }) => 1878 * frame.scale;
  it('is unchanged at 402 and 430 pt (factor 1)', () => {
    expect(HOME_REFERENCE_SCALE).toBeCloseTo(402 / 1800);
    expect(homeCompactFactor(fitArtboard(402, 874 - 62 - 34 - 20).scale)).toBe(1);
    expect(homeCompactFactor(fitArtboard(430, 932 - 62 - 34 - 20).scale)).toBe(1);
    expect(homeCompactFactor(0)).toBe(1);
  });
  it('shrinks the rail on a 375 x 667 phone so the gear clears the CHANGE HOLOBOT bar', () => {
    for (const height of [667 - 20 - 20, 532]) { // the SE page, and the SE page inside the QA harness frame
      const frame = fitArtboard(375, height);
      expect(frame.height).toBeLessThanOrEqual(ARTBOARD_HEIGHT);
      expect(homeCompactFactor(frame.scale)).toBeLessThan(1);
      expect(railBottom(frame)).toBeLessThan(changeBarTop(frame));
    }
    // Known-bad: the old fixed 52 pt rail overlapped the bar in the harness-sized SE frame (the smoke sheet's SE cell 01).
    const frame = fitArtboard(375, 532);
    expect(0.145 * frame.height + 4 * 52 + 3 * 10).toBeGreaterThan(changeBarTop(frame));
  });
  it('the rail, the ZONES / TRAVEL SQUAD text and the city entry label are compact-aware', () => {
    const home = read('../../screens/HomeScreen.tsx');
    expect(home).toContain('<HomeUtilityRail>');
    expect(home).not.toContain('<View style={styles.utilityStack}>');
    for (const panel of ['../dashboard/TravelSquadPanel.tsx', '../dashboard/DashboardZonesPanel.tsx']) {
      const source = read(panel);
      expect(source, panel).toContain('const fit = useCompactText();');
      expect(source, panel).toContain('fit(styles.entryTitle)');
    }
    expect(read('../dashboard/UnityLaunchButton.tsx')).toContain('numberOfLines={compact ? 1 : undefined} adjustsFontSizeToFit={compact}');
    expect(home).toContain('<HomeCityEntry />');
    expect(home).toContain('height: Math.round(HOME_NATIVE_CITY_ENTRY.heightPt * k)');
  });
});

describe('6 · the loading screen does not touch the alias fonts while they register', () => {
  it('LiteApp shows the system-face loading screen until useFonts settles', () => {
    expect(read('../../../../LiteApp.tsx')).toContain('{!fontsReady && !fontError ? <AppLoadingScreen fontsPending /> :');
    const loading = read('../AppLoadingScreen.tsx');
    expect(styleBlock(loading, 'systemFace')).toContain('fontFamily: "System"');
    for (const style of ['title', 'subtitle', 'progressLabel', 'progressValue']) expect(loading).toContain(`<Text style={[styles.${style}, face]}>`);
  });
});

describe('7 · holobot detail stats are on the host displayStats scale', () => {
  it('LV 12 ACE: the detail rows match Training (232 / 12 / 9 / 9), not the LV 1 profile (150 / 8 / 6 / 6)', () => {
    // DECISIONS #72.78 (2): ACE base speed 7 -> 6, so LV 12 speed floor(6 x 1.55) = 9 (was 10).
    const scaled = getHolobotDisplayStats('ACE', 12);
    expect({ hp: scaled.hp, attack: scaled.attack, defense: scaled.defense, speed: scaled.speed }).toEqual({ hp: 232, attack: 12, defense: 9, speed: 9 });
    // Known-bad: the old rows printed the base profile.
    const base = HOLOBOT_BASE_STATS.ACE;
    expect([base.hp, base.attack]).toEqual([150, 8]);
    const modal = read('../HolobotStatsModal.tsx');
    expect(modal).toContain('const levelBase = getHolobotDisplayStats(holobot.name, normalizedOwnedHolobot?.level ?? holobot.level ?? 1);');
    expect(modal).toContain('{ baseValue: levelBase.hp, bonus: boosts.health || 0');
    expect(modal).not.toContain('baseValue: base.hp');
  });
});
