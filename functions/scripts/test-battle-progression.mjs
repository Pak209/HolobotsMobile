// DECISIONS #53-1: awardBattleExperienceRaw — the shared Holobot-XP step every battle kind settles through
// (rival today; a HoloZone/beast claim calls it with kind "beast" and the zone tier once that claim exists).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../lib/lib/battleProgression.js');
const B = require('../lib/lib/battleSettlement.js');
const P = require('../lib/lib/progression.js');
const NOW = Date.UTC(2026, 9, 6, 18, 0, 0);
const profile = (extra = {}) => ({ holobots: [{ name: 'ACE', level: 1, experience: 300, nextLevelExp: 400 }, { name: 'TSUIN', level: 9, experience: 8200, nextLevelExp: 10000, attributePoints: 2 }], ...extra });

test('beast kind: same table, zone tier, every listed bot, booster honoured', () => {
  for (const tier of [0, 1, 3, 6]) {
    const exp = B.computeBattleSettlement({ kind: 'beast', tier, didWin: true }).exp;
    assert.equal(exp, B.computeBattleSettlement({ kind: 'arena', tier, didWin: true }).exp);
    const a = G.awardBattleExperienceRaw(profile(), ['ace', 'tsuin'], { kind: 'beast', tier, didWin: true }, NOW);
    assert.equal(a.expPerHolobot, exp);
    assert.deepEqual(a.holobots[0], P.applyHolobotExperience(profile().holobots[0], exp));
    assert.deepEqual(a.progression.map(r => r.holobotId), ['ace', 'tsuin']);
  }
  const boosted = G.awardBattleExperienceRaw(profile({ expBoosterActiveUntil: NOW + 1 }), ['ace'], { kind: 'beast', tier: 1, didWin: false }, NOW);
  assert.equal(boosted.expPerHolobot, 82); // floor(137 x 0.3) x 2
});

test('progression rows report the after-state; level-ups grant +1 point each', () => {
  const a = G.awardBattleExperienceRaw(profile(), ['ace'], { kind: 'beast', tier: 9, didWin: true, combosCompleted: 3 }, NOW);
  const row = a.progression[0];
  assert.equal(row.expGained, Math.floor(479 * 1.3));
  assert.equal(row.levelBefore, 1); assert.ok(row.levelAfter >= 2);
  assert.equal(row.attributePoints, 1 + (row.levelAfter - 1), 'legacy record: level points + one per level gained');
  assert.equal(row.rank, P.getHolobotRank(row.levelAfter)); assert.equal(row.nextLevelExp, P.calculateExperience(row.levelAfter + 1));
});

test('fails closed on an unknown id or kind; withheld reports zeros and leaves holobots untouched', () => {
  assert.equal(G.awardBattleExperienceRaw(profile(), ['wolf'], { kind: 'beast', tier: 0, didWin: true }, NOW), null);
  assert.equal(G.awardBattleExperienceRaw(profile(), ['ace'], { kind: 'pvp', tier: 0, didWin: true }, NOW), null);
  const p = profile();
  const w = G.awardBattleExperienceRaw(p, ['ace'], { kind: 'beast', tier: 2, didWin: false }, NOW, { withheld: true });
  assert.equal(w.expPerHolobot, 0); assert.equal(w.progression[0].expGained, 0); assert.deepEqual(w.holobots, p.holobots);
  assert.deepEqual(G.awardBattleExperienceRaw(p, [], { kind: 'beast', tier: 2, didWin: true }, NOW).progression, []);
});
