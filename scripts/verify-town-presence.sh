#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
# Known-bad compiler probe before the real build (scratch only).
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
printf 'const broken: number = "forged";\n' > "$T/bad.ts"
if functions/node_modules/.bin/tsc --noEmit --skipLibCheck "$T/bad.ts" >/dev/null 2>&1; then echo 'compiler control NOT caught'; exit 1; fi
npm --prefix functions run build
node --test functions/scripts/test-presence.mjs
# Local-only, no production project, timeout inherited from caller / emulators:exec.
python3 - "$ROOT" <<'PY'
import json,sys
from pathlib import Path
r=Path(sys.argv[1]); x=json.loads((r/'firebase.json').read_text());x.pop('functions',None);x['emulators']={'firestore':{'port':8781},'ui':{'enabled':False},'singleProjectMode':False};(r/'firebase.presence.local.json').write_text(json.dumps(x))
PY
PATH="$(/usr/libexec/java_home)/bin:$PATH" python3 - <<'PYTIMEOUT'
import os,signal,subprocess,sys
command=['rules-tests/node_modules/.bin/firebase','emulators:exec','--config','firebase.presence.local.json','--project','demo-holobots-presence','--only','firestore','GCLOUD_PROJECT=demo-holobots-presence node --test functions/scripts/test-presence-emulator.mjs && cd rules-tests && ./node_modules/.bin/vitest run tests/presence.test.ts']
p=subprocess.Popen(command,start_new_session=True)
try: sys.exit(p.wait(timeout=180))
except subprocess.TimeoutExpired:
 os.killpg(p.pid,signal.SIGTERM)
 try: p.wait(timeout=10)
 except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL)
 raise SystemExit('Local emulator timed out; stopped its process group')
PYTIMEOUT
