// Cold host-core sizing for R2. Does not write an account or change the simulator.
// Use `node scripts/sweep-readiness-r2.mjs [seed blocks]` after `npm run build`.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const published = process.argv[3] === 'published';
if (published) process.env.HOLOCITY_FIGHT_ATTRS = '1'; // #206: the published rules-5 progression table is flag-selected.
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const { buildFightReplayIssue } = require('../lib/rival/fightReplayIssue.js');
const { getHolobotBattleStats } = require('../lib/lib/progression.js');
const blocks = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(blocks) || blocks < 1 || blocks > 2000) throw Error('seed blocks must be 1..2000');
const seed = i => createHash('sha256').update(`astra-battle-scaling-1/seed/${i}`).digest('hex');
const bot = (holobotId,level) => {
  if (!published) return {holobotId,maxHealth:480,attack:90,defense:45};
  const s=getHolobotBattleStats(holobotId,level);
  return {holobotId,level,maxHealth:s.maxHP,attack:s.attack,defense:s.defense,speed:s.speed,intelligence:s.intelligence,statSource:'progression'};
};
const ids=['ace','wolf','gama','hare','ken','kuma','kurai','era','shadow','tora','tsuin','wake','jusan'];
const pairs = published ? ids.map(id=>[id,id]) : [['ace','wolf'],['wolf','ace']];
const rows=[];
const pairedBlocks=Array.from({length:blocks},()=>0);
for (const tier of (published ? [4] : [0,4,9])) for (const [playerId,cpuId] of pairs) {
  const wins={0:0,50:0}, draws={0:0,50:0};
  for (let i=0;i<blocks;i++) for (const start of [0,50]) {
    const issue=buildFightReplayIssue({battleId:'rb_fixture000000000000000000',seed:seed(i),tier,mentor:false,
      player:[bot(playerId,10)],opponent:[bot(cpuId,10)],chase:true,attrs:true,playerStartSync:{[playerId]:start},cpuStartSync:[0,12,30][[0,4,9].indexOf(tier)]});
    if (!issue) throw Error('issue failed');
    const {rules,chase,attrs}=F.rulesDocFromJson(issue.rules);
    const result=F.runFight(rules,issue.seed,
      {brain:new F.FightCoreBrain(),profile:F.issuedProfile(F.brainProfile(playerId)),skill:F.issuedSkill('Champion')},
      {brain:new F.FightCoreBrain(),profile:issue.cpu.profile,skill:issue.cpu.rank},
      {recordEvents:false,chase,attrs});
    wins[start]+=Number(result.winner===0); draws[start]+=Number(result.winner===2);
    pairedBlocks[i] += (start===50 ? 1 : -1) * Number(result.winner===0);
  }
  const row={tier,playerId,cpuId,blocks,source:published?'published-fight-rows-L10':'equal-stats',cpuStartSync:[0,12,30][[0,4,9].indexOf(tier)],wins,draws,edgePoints:100*(wins[50]-wins[0])/blocks};
  rows.push(row); console.log(JSON.stringify(row));
}
const mean = pairedBlocks.reduce((a,b)=>a+b,0)/blocks/rows.length*100;
const variance = pairedBlocks.reduce((a,b)=>a+Math.pow(b/rows.length*100-mean,2),0)/(blocks-1);
console.log(JSON.stringify({pooledEdgePoints:mean,pairedBlock95Ci:[mean-1.96*Math.sqrt(variance/blocks),mean+1.96*Math.sqrt(variance/blocks)],rows:rows.length,blocks}));
