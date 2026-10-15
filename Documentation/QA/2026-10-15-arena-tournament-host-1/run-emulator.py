"""Run only the W11 throwaway-pilot suite, on loopback demo Firestore, bounded to300s."""
import json, os, signal, subprocess, tempfile, time
from pathlib import Path
root=Path(__file__).resolve().parents[3]
config={'firestore':{'rules':str(root/'firestore.rules'),'indexes':str(root/'firestore.indexes.json')},
 'emulators':{'firestore':{'host':'127.0.0.1','port':18087,'websocketPort':19187},
 'hub':{'host':'127.0.0.1','port':14402},'logging':{'host':'127.0.0.1','port':14502},'ui':{'enabled':False},'singleProjectMode':True}}
with tempfile.NamedTemporaryFile(mode='w',suffix='.json') as cfg:
 json.dump(config,cfg);cfg.flush()
 command=[str(root/'rules-tests/node_modules/.bin/firebase'),'emulators:exec','--config',cfg.name,
  '--project','demo-holobots-bracket-20261015','--only','firestore','node --test --test-concurrency=1 scripts/test-arena-bracket-emulator.mjs scripts/test-arena-gathering-emulator.mjs scripts/test-delete-user-data-emulator.mjs scripts/test-arena-match-emulator.mjs']
 start=time.monotonic();process=subprocess.Popen(command,cwd=root/'functions',start_new_session=True)
 timed_out=False
 try:exit_code=process.wait(timeout=300)
 except subprocess.TimeoutExpired:
  timed_out=True;os.killpg(process.pid,signal.SIGTERM)
  try:exit_code=process.wait(timeout=8)
  except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);exit_code=process.wait()
 print(json.dumps({'exitCode':exit_code,'timedOut':timed_out,'wallSeconds':round(time.monotonic()-start,3),'limitSeconds':300}))
 raise SystemExit(exit_code if not timed_out else 124)
