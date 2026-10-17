#!/usr/bin/env python3
"""Fail-closed application to the exact clean isolated lite baseline."""
import argparse, hashlib, json, subprocess
from pathlib import Path
p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--check',action='store_true');g.add_argument('--apply',action='store_true');p.add_argument('checkout');a=p.parse_args()
root=Path(a.checkout).resolve();package=Path(__file__).resolve().parent;m=json.loads((package/'manifest.json').read_text());patch=package/'lite-hud-levels.patch'
def git(*args):return subprocess.check_output(['git','-C',str(root),*args],text=True,timeout=60).strip()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
if git('rev-parse','HEAD')!=m['base']:raise SystemExit('HELD: checkout HEAD is not pinned lite baseline')
if git('status','--porcelain'):raise SystemExit('HELD: checkout must be clean, including untracked files')
if sha(patch)!=m['patchSha256']:raise SystemExit('HELD: patch checksum mismatch')
for f in m['files']:
 if sha(root/f['path'])!=f['beforeSha256']:raise SystemExit('HELD: before checksum mismatch: '+f['path'])
subprocess.run(['git','-C',str(root),'apply','--check',str(patch)],check=True,timeout=60)
if a.apply:
 subprocess.run(['git','-C',str(root),'apply',str(patch)],check=True,timeout=60)
 for f in m['files']:
  if sha(root/f['path'])!=f['afterSha256']:raise SystemExit('HELD: output mismatch: '+f['path'])
print('PASS: '+('applied and verified all output bytes' if a.apply else 'exact baseline, inputs and apply check'))
