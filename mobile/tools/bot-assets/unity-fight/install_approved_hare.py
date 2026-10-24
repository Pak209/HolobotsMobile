"""Stage Pak's byte-pinned strict HARE pack after the historical 11-bot port.

python3 install_approved_hare.py --candidate <hare-r2.glb> --pose-report
    <hare-r2.poses.json> --source <unity-fight-source.json> --mobile-root mobile
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser()
for name in ('candidate', 'pose-report', 'source', 'mobile-root'):
    parser.add_argument('--' + name, required=True)
args = parser.parse_args()
candidate = Path(args.candidate)
pose_path = Path(args.pose_report)
source_path = Path(args.source)
root = Path(args.mobile_root)
assets = root / 'assets/bots'
fight_source_path = root / 'tools/bot-assets/fight-source-manifest.json'
manifest_path = assets / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
fight_source = json.loads(fight_source_path.read_text())
source = json.loads(source_path.read_text())
pose = json.loads(pose_path.read_text())
data = candidate.read_bytes()
digest = hashlib.sha256(data).hexdigest()
assert len(data) == 2_210_316, len(data)
assert digest == '58d8505b9cdfbab3a9656e0f92a0c9ed92dca14dd38e82298e07b6a3732c9f5e', digest
assert pose['bot'] == 'hare'
assert pose['maxPositionMm'] <= 1 and pose['maxRotationDeg'] <= .2
assert source['unityCommit'] == fight_source['unityCommit'] == manifest['fightPort']['unityCommit']
conf = source['bots']['hare']
clips = [{'name': name, 'seconds': row['duration'], 'unityClip': Path(row['source']).stem}
         for name, row in conf['clips'].items()]
assert len(clips) == 9
fight_source['bots']['hare'] = {**conf, 'clips': clips, 'timing': conf['clips'],
                                'maxWeights': 2, 'packedSha256': digest,
                                'poseMaxPositionMm': pose['maxPositionMm'],
                                'poseMaxRotationDeg': pose['maxRotationDeg']}
fight_source.get('held', {}).pop('hare', None)
entry = manifest['bots']['hare']
entry.update(bytes=len(data), sha256=digest, fightClips=clips,
             validation={'errors': 0, 'warnings': 2})
manifest['maxBotBytesByBot'] = {'hare': len(data)}
manifest['fightPort']['acceptedBots'] = sorted(set(manifest['fightPort']['acceptedBots']) | {'hare'})
manifest['fightPort']['heldBots'] = []
shutil.copyfile(candidate, assets / 'hare.glb')
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
fight_source_path.write_text(json.dumps(fight_source, indent=2) + '\n')
print(json.dumps({'hareBytes': len(data), 'sha256': digest, 'fightClips': len(clips),
                  'poseMaxPositionMm': pose['maxPositionMm'],
                  'poseMaxRotationDeg': pose['maxRotationDeg']}, indent=2))
