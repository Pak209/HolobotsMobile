// Offline fixture only. No Firebase imports, account access or production calls.
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {createArenaBracket}=require('../lib/story/arenaBracket');
const {gatheringRoster}=require('../lib/story/arenaGathering');
const {playerCombatant}=require('../lib/lib/rivalLadder');
const {duelFighterFromCombatant}=require('../lib/lib/duelResolver');
const fighter=(id,level)=>duelFighterFromCombatant({...playerCombatant(id,{name:id.toUpperCase(),level}),tier:0});
const matchId='am_'+'b'.repeat(32);
const entrants=[...gatheringRoster('fixture_bracket_level_only').map(row=>({entrantId:row.citizenId,pilotName:row.pilotName,holobotId:row.holobotId,isPlayer:false,fighter:fighter(row.holobotId,12)})),
 {entrantId:'player',pilotName:'You',holobotId:'ace',isPlayer:true,fighter:fighter('ace',21)}];
const bracket=createArenaBracket(matchId,'starter',12345,entrants);
writeFileSync(new URL('./fixtures/arena-bracket/levels-start.json',import.meta.url),JSON.stringify({
 provenance:'Offline host createArenaBracket + gatheringRoster + playerCombatant; deterministic fixture order, not admission randomization. Human level 21; admitted rookie opponent level 12. Emulator separately proves actual admission publication.',
 request:{schemaVersion:'arena-bracket-1',operation:'start',matchId},
 reply:{schemaVersion:'arena-bracket-1',matchId,alreadyProcessed:false,bracket,cancelled:false}},null,2)+'\n');
