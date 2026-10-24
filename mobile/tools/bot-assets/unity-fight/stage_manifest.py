"""Stage only accepted candidate bytes and provenance; HARE (budget hold) is intentionally excluded."""
import argparse,hashlib,json,pathlib,shutil
p=argparse.ArgumentParser();p.add_argument('--candidate',required=True);p.add_argument('--destination',required=True);p.add_argument('--source-manifest',required=True);a=p.parse_args();candidate=pathlib.Path(a.candidate);destination=pathlib.Path(a.destination)
source=json.load(open(candidate/'unity-fight-source.json'));manifest=json.load(open(destination/'manifest.json'));rows=json.load(open(candidate/'guarded-status.json'));accepted={row['bot']for row in rows if row['exit']==0};assert len(accepted)==11 and 'hare'not in accepted
proof={'unityCommit':source['unityCommit'],'originalMobileCommit':'cdf6318d961c532f43d9428e75c00154b5b4f8ad','bots':{},'held':{'hare':'2,011,580 bytes >2,000,000 cap after two attempts; original asset retained'}}
for bot in sorted(accepted):
 data=(candidate/'packed'/f'{bot}.glb').read_bytes();packed=json.load(open(candidate/'packed'/f'{bot}.glb.report.json'));pose=json.load(open(candidate/'packed'/f'{bot}.poses.json'));assert len(data)==packed['bytes']<=2_000_000 and hashlib.sha256(data).hexdigest()==packed['sha256'];assert pose['maxPositionMm']<=1 and pose['maxRotationDeg']<=.2
 conf=source['bots'][bot];clips=[{'name':name,'seconds':row['duration'],'unityClip':pathlib.Path(row['source']).stem}for name,row in conf['clips'].items()]
 proof['bots'][bot]={**conf,'clips':clips,'timing':conf['clips'],'maxWeights':2,'packedSha256':packed['sha256']};entry=manifest['bots'][bot];entry.update(bytes=packed['bytes'],sha256=packed['sha256'],triangles=packed['triangles'],fightClips=clips,validation={'errors':packed['errors'],'warnings':packed['warnings']})
 shutil.copyfile(candidate/'packed'/f'{bot}.glb',destination/f'{bot}.glb')
manifest['fightPort']={'unityCommit':source['unityCommit'],'acceptedBots':sorted(accepted),'heldBots':['hare'],'compression':'meshopt medium; source geometry/textures retained; top-two normalized skin; animation resample tolerance1e-7','rawToPackedMaxJointErrorMm':1,'rawToPackedMaxJointRotationDeg':.2}
(destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');pathlib.Path(a.source_manifest).write_text(json.dumps(proof,indent=2)+'\n')
