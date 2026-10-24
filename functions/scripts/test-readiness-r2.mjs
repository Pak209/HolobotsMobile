import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { manualReadinessStart, cpuStartSync, battleIqCpuRank, fightLearningAfterSettle, readinessStartEnabled, battleIqEnabled } = require('../lib/lib/readinessFight.js');
const { fadedReadinessMilli, readinessView } = require('../lib/lib/syncReadiness.js');
const { buildFightReplayIssue } = require('../lib/rival/fightReplayIssue.js');
const { combatant } = await import('./lib/fight-replay-helpers.mjs');
const now = 1_782_259_200_000;
const profile = { holobots: [{name:'ACE',level:10},{name:'KUMA',level:2}],
  syncReadiness: {ACE:{milli:80_000,atMs:now},KUMA:{milli:100_000,atMs:now}},
  syncMomentum: {ACE:2,KUMA:3}, battleIq:{ACE:100} };

test('both R2 flags are off by default; values are host bounded', () => {
  assert.equal(readinessStartEnabled({}), false); assert.equal(battleIqEnabled({}), false);
  assert.equal(readinessStartEnabled({HOLOCITY_READINESS_START:'1'}), true);
  assert.equal(battleIqEnabled({HOLOCITY_BATTLE_IQ:'1'}), true);
  assert.deepEqual(manualReadinessStart(profile,'ACE',now), {holobotId:'ACE',readiness:80,cap:50,startSync:50});
  assert.equal(manualReadinessStart(profile,'KUMA',now).startSync,50);
  assert.equal(manualReadinessStart({...profile,syncReadiness:{}},'ACE',now).startSync,10);
  assert.deepEqual(['Rookie','Starter','Champion','Rare','Elite','Legendary'].map(cpuStartSync),[0,6,12,18,24,30]);
  assert.equal(battleIqCpuRank(profile,'ACE'),'legendary');
  assert.equal(battleIqCpuRank(profile,'KUMA'),'rookie');
});

test('hidden IQ halves the daily fade at 100; wins teach more, stronger losses teach, replay caller does not invoke', () => {
  assert.equal(fadedReadinessMilli({milli:100_000,atMs:now},now+86_400_000,0),80_000);
  assert.equal(fadedReadinessMilli({milli:100_000,atMs:now},now+86_400_000,100),90_000);
  const prior=process.env.HOLOCITY_BATTLE_IQ;
  process.env.HOLOCITY_BATTLE_IQ='1';
  try { assert.equal(readinessView(profile,now+86_400_000).ACE.value,72); }
  finally { if (prior===undefined) delete process.env.HOLOCITY_BATTLE_IQ; else process.env.HOLOCITY_BATTLE_IQ=prior; }
  const win=fightLearningAfterSettle(profile,['ACE'],true,11);
  assert.equal(win.battleIq.ACE,100); assert.equal(win.syncMomentum.ACE,3);
  const loss=fightLearningAfterSettle({...profile,battleIq:{ACE:20}},['ACE'],false,11);
  assert.equal(loss.battleIq.ACE,22); assert.equal(loss.syncMomentum.ACE,0);
  assert.equal(fightLearningAfterSettle(profile,['KUMA'],false,1).battleIq.KUMA,0);
  assert.deepEqual(fightLearningAfterSettle(profile,['UNKNOWN'],true,30).syncMomentum,profile.syncMomentum);
});

test('issue is byte-identical when flag data absent; supplied startSync is pinned in hashed rules', () => {
  const base={battleId:'rb_fixture000000000000000000',seed:'0'.repeat(64),tier:2,mentor:false,
    player:[combatant('ace')],opponent:[combatant('wolf')]};
  const old=buildFightReplayIssue(base);
  assert.equal('readinessStart' in old,false);
  assert.equal(old.rules.fighters[0].startSync,0); assert.equal(old.rules.fighters[1].startSync,0);
  const row=manualReadinessStart(profile,'ACE',now);
  const next=buildFightReplayIssue({...base,playerStartSync:{ace:row.startSync},cpuStartSync:12,readinessStart:[{...row,holobotId:'ace'}]});
  assert.equal(next.rules.fighters[0].startSync,50); assert.equal(next.rules.fighters[1].startSync,12);
  assert.notEqual(next.rulesHash,old.rulesHash);
  assert.deepEqual(next.readinessStart,[{...row,holobotId:'ace'}]);
});
