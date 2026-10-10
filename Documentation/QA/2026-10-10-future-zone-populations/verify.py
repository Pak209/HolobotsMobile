#!/usr/bin/env python3
"""Draft-only data check. No mutation, network, dependencies or runtime install."""
import copy,hashlib,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[3];draft=json.loads((root/'Documentation/DRAFTS/2026-10-10-future-zone-populations.json').read_text())
def inert(d):
 return d.get('runtimeEnabled') is False and d.get('approvedRuntimeZones')==['neonforest'] and [r.get('zoneId') for r in d.get('rows',[])]==['tide_hollow','sky_reach'] and all(r.get('approved') is False and r.get('state')=='NEEDS_TUNING' and all(r.get(k) is None for k in ['tier','beasts','spawnCount','respawn','boss','sceneName']) for r in d['rows'])
assert inert(draft),'draft must stay inert with unknown tuning';controls=0
for field,value in [('tier',0),('beasts',[{'beastId':'scrapling','count':3}]),('spawnCount',3),('respawn',{'delaySeconds':8}),('boss',{'bossId':'root_nexus'}),('sceneName','HoloZone_TideHollow')]:
 bad=copy.deepcopy(draft);bad['rows'][0][field]=value;assert not inert(bad),'KNOWN-BAD invented tuning must fail: '+field;controls+=1
for file,sha in [('functions/src/lib/holoZonePopulation.ts','63d45fec9c660cfcfd24937448b23d7066f6b2502fe4e94d0045df8d8d021ab0'),('functions/src/lib/holoZoneRuns.ts','2c8adec62d6159f18be6537b42dbff66d4e34894432b0ed182135f049f1c50c2')]:
 assert hashlib.sha256((root/file).read_bytes()).hexdigest()==sha,'runtime changed: '+file
text=(root/'functions/src/lib/holoZoneRuns.ts').read_text();table=text.split('HOLOZONE_ZONE_TIERS:')[1].split('});')[0]
assert 'tide_hollow' not in table and 'sky_reach' not in table,'unknown zones cannot enter the runtime table'
print('PASS: two inert draft rows, '+str(controls)+' invented-tuning controls, two runtime hashes unchanged; no future zone enabled')
