// rules-brain-guard-1 (early-progression-1 item 6): writes scripts/fixtures/brain-fingerprint-rules8-input.json, the FROZEN input of
// the duel-rules-8 brain fingerprint (scripts/test-rules-brain-guard.mjs; the phone pins the same fingerprint from a verbatim copy).
// Two real live duel-rules-8 issues (an Arena-style ACE vs HARE and the Guild Court beast) supply the rules documents; the CPU rows are
// the issued profiles at fixture time. Freezing them means a later tuning of the rules defaults or a profile table row (which travel
// in the issue, so an old phone still replays them) never moves the fingerprint; only a change to the core / brain CODE does.
// Run once: node scripts/write-brain-fingerprint-fixture.mjs (after npm run build). Never re-run to "fix" a failing guard.
import { writeFileSync } from 'node:fs';
import { F, buildFightReplayIssue } from './lib/fight-replay-helpers.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { courtLiveIssue } = require('../lib/lib/holoZoneCourtLive.js');
const { buildPlayerCombatants } = require('../lib/lib/rivalLadder.js');

const seed = 'b7'.repeat(32);
const ace = buildPlayerCombatants({ holobots: [{ name: 'ACE', level: 6 }] }, ['ace'])[0];
const arena = buildFightReplayIssue({ battleId: 'am_' + '0'.repeat(32), seed, tier: 2, mentor: false,
  player: [{ ...ace, currentHealth: ace.maxHealth }], opponent: [{ holobotId: 'hare', level: 6, maxHealth: 190, attack: 50, defense: 50, speed: 40, statSource: 'progression' }],
  chase: true, attrs: true, tempo: true, live: true, guardHold: true, staminaWind: true });
const court = courtLiveIssue({ fighter: { ...ace, currentHealth: ace.maxHealth }, gear: { attack: 0, defense: 0, health: 0, speed: 0, special: 0 }, zoneId: 'guild_court', tier: 0, runId: 'run_fp', seed,
  chase: true, attrs: true, tempo: true, guardHold: true, staminaWind: true });
for (const i of [arena, court]) if (!i || !String(i.rulesId).startsWith('duel-rules-8:')) throw Error('not a duel-rules-8 issue');
const ids = ['ace', 'wolf', 'gama', 'kuma', 'hare', 'ken', 'shadow', 'tora', 'kurai', 'era', 'tsuin', 'wake', 'jusan'];
const fixture = {
  schemaVersion: 'brain-fingerprint-input-1', rulesSchema: 'duel-rules-8',
  rulesDocs: { arena: arena.rules, court: court.rules },
  profiles: Object.fromEntries([...ids.map(id => [id, F.issuedProfile(F.brainProfile(id))]), ['beast_bruiser', court.cpu.profile], ['arena_cpu', arena.cpu.profile]]),
};
writeFileSync(new URL('./fixtures/brain-fingerprint-rules8-input.json', import.meta.url), JSON.stringify(fixture, null, 1) + '\n');
console.log('wrote fixture', Object.keys(fixture.profiles).length, 'profiles');
