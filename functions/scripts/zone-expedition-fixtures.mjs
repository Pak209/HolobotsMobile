import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Z=require('../lib/holozone/expedition.js');
export const T=Date.UTC(2026,9,14,23,59,59);
// Deliberately TEST-ONLY tuning. No production values are approved by these fixtures.
export const CONFIG={version:'zone-config-test-only',energyCapacity:100,energyPackUnits:50,energyPackPrice:100,sectorEnergyCost:5,fightEnergyCost:10,extractionChargePrice:100,bandLevels:[1,11,21],cacheFragments:1,bulkySalvageUnits:1,rareBlueprintChanceBasisPoints:10000};
export const profile=(extra={})=>({holosTokens:10000,holobots:['ACE','KUMA','SHADOW'].map(name=>({name,level:99})),travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace','kuma','shadow']},storyFlags:{arenaGatheringSeen:true,tournamentsWon:3,arenaArcBuilt:true,holoZonesArcBuilt:false},itemStocks:{repair_kit:5,blueprint_fragment:10},expeditionSupplies:{energy:100,extractionCharges:2},...extra});
export function issued(p=profile(),seed=1){return Z.issueExpedition(p,{repairKits:2,carryExtractionCharge:true},'test_run',seed,T,CONFIG);}
