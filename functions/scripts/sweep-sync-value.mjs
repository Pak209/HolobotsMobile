// Cold, paired rules-5 sizing on the published #72.80 rows. No account or deploy.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

process.env.HOLOCITY_FIGHT_ATTRS = '1';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const { buildFightReplayIssue } = require('../lib/rival/fightReplayIssue.js');
const { getHolobotBattleStats } = require('../lib/lib/progression.js');
const blocks = Number(process.argv[2] ?? 1000);
const levels = (process.argv[3] ?? '2,10,21').split(',').map(Number);
const specialPlus = Number(process.argv[4] ?? 0);
const openPm = Number(process.argv[5] ?? 5000);
const finisherCut = Number(process.argv[6] ?? 6);
const focusSide = Number(process.argv[7] ?? 0);
if (!Number.isSafeInteger(blocks) || blocks < 1 || blocks > 2000 || levels.some(x => !Number.isSafeInteger(x) || x < 1 || x > 99) || ![0,10].includes(specialPlus) || !Number.isSafeInteger(openPm) || openPm < 1000 || openPm > 5000 || !Number.isSafeInteger(finisherCut) || finisherCut < 0 || finisherCut > 10 || ![0,1].includes(focusSide)) throw Error('invalid sweep bounds');
const ids = ['ace','wolf','gama','hare','ken','kuma','kurai','era','shadow','tora','tsuin','wake','jusan'];
const seed = i => createHash('sha256').update(`astra-battle-scaling-1/seed/${i}`).digest('hex');
const bot = (holobotId, level) => {
  const s = getHolobotBattleStats(holobotId, level);
  return { holobotId, level, maxHealth:s.maxHP, attack:s.attack, defense:s.defense,
    speed:s.speed, intelligence:s.intelligence, statSource:'progression' };
};
const median = xs => { const a=[...xs].sort((x,y)=>x-y); return (a[(a.length-1)>>1]+a[a.length>>1])/2; };
for (const level of levels) {
  const groups = {0:{wins:0,durations:[],specials:0,lands:0,guarded:0,full:0,fullLands:0,earlyFull:0},50:{wins:0,durations:[],specials:0,lands:0,guarded:0,full:0,fullLands:0,earlyFull:0}};
  const paired = Array.from({length:blocks},()=>0);
  for (const id of ids) for (let i=0;i<blocks;i++) for (const startSync of [0,50]) {
    const issue = buildFightReplayIssue({battleId:'rb_fixture000000000000000000',seed:seed(i),tier:4,mentor:false,
      player:[{...bot(id,level),intelligence:bot(id,level).intelligence+specialPlus}],opponent:[bot(id,level)],chase:true,attrs:true,playerStartSync:{[id]:startSync},cpuStartSync:12});
    if (!issue) throw Error('issue failed');
    issue.rules.attrs.specialOpenPm = openPm;
    issue.rules.attrs.finisherTempoCutTicks = finisherCut;
    if (focusSide === 1) {
      issue.rules.fighters[0].startSync = 12;
      issue.rules.fighters[1].startSync = startSync;
      issue.rules.fighters[1].special += specialPlus;
      issue.rules.fighters[0].special -= specialPlus;
    }
    const {rules,chase,attrs} = F.rulesDocFromJson(issue.rules);
    const fullTicks = new Set(), g=groups[startSync];
    let seen=0;
    const champion = {brain:new F.FightCoreBrain(),profile:F.issuedProfile(F.brainProfile(id)),skill:F.issuedSkill('Champion')};
    const tierCpu = {brain:new F.FightCoreBrain(),profile:issue.cpu.profile,skill:issue.cpu.rank};
    const result = F.runFight(rules,issue.seed,
      focusSide === 0 ? champion : tierCpu,
      focusSide === 0 ? tierCpu : champion,
      {recordEvents:true,chase,attrs,onTick:(tick,inputs,core)=>{
        for (const e of core.events.slice(seen)) {
          if (e.side===focusSide && e.kind===F.EventKind.Telegraph && e.move===F.Move.Special && core.F[focusSide].atkTier===2) {
            fullTicks.add(e.value); if (tick<30) g.earlyFull++;
          }
        }
        seen=core.events.length;
      }});
    const win=Number(result.winner===focusSide);
    g.wins+=win; paired[i]+=(startSync===50?1:-1)*win;
    g.durations.push((result.endTick+1)/30);
    for (const e of result.events) if (e.side===focusSide && e.kind===F.EventKind.Contact && e.move===F.Move.Special) {
      g.specials++;
      if (e.outcome===F.Outcome.Hit || e.outcome===F.Outcome.GuardBreak) g.lands++;
      if (e.outcome===F.Outcome.Blocked || e.outcome===F.Outcome.Perfect || e.outcome===F.Outcome.GuardBreak) g.guarded++;
      if (fullTicks.has(e.tick)) { g.full++; if (e.outcome===F.Outcome.Hit || e.outcome===F.Outcome.GuardBreak) g.fullLands++; if (e.tick<30) g.earlyFull++; }
    }
  }
  const n=ids.length*blocks, edge=100*(groups[50].wins-groups[0].wins)/n;
  const mean=paired.reduce((a,b)=>a+b,0)/blocks/ids.length*100;
  const variance=paired.reduce((a,b)=>a+((b/ids.length*100)-mean)**2,0)/(blocks-1);
  const summarize=g=>({winPct:100*g.wins/n,medianSeconds:median(g.durations),specialLandPct:g.specials?100*g.lands/g.specials:0,specialGuardPct:g.specials?100*g.guarded/g.specials:0,fullLandPct:g.full?100*g.fullLands/g.full:0,fullContacts:g.full,firstSecondFull:g.earlyFull});
  console.log(JSON.stringify({level,blocks,bots:ids.length,specialPlus,openPm,finisherCut,focusSide,edgePoints:edge,ci95:[mean-1.96*Math.sqrt(variance/blocks),mean+1.96*Math.sqrt(variance/blocks)],start0:summarize(groups[0]),start50:summarize(groups[50])}));
}
