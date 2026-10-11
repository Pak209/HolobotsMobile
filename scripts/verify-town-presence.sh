#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
# Known-bad compiler probe before the real build (scratch only).
T=$(mktemp -d)
trap 'rm -rf "$T" "$ROOT/firebase.presence.local.json"' EXIT
printf 'const broken: number = "forged";\n' > "$T/bad.ts"
if functions/node_modules/.bin/tsc --noEmit --skipLibCheck "$T/bad.ts" >/dev/null 2>&1; then echo 'compiler control NOT caught'; exit 1; fi
npm --prefix functions run build
node --test functions/scripts/test-presence.mjs
# Local-only, no production project, timeout inherited from caller / emulators:exec.
# PRESENCE_EMULATOR_PORT lets a parallel lane pick its own port (default 8781).
PORT="${PRESENCE_EMULATOR_PORT:-8781}"
python3 - "$ROOT" "$PORT" <<'PY'
import json,sys
from pathlib import Path
r=Path(sys.argv[1]); x=json.loads((r/'firebase.json').read_text());x.pop('functions',None);x['emulators']={'firestore':{'port':int(sys.argv[2])},'ui':{'enabled':False},'singleProjectMode':False};(r/'firebase.presence.local.json').write_text(json.dumps(x))
PY
# macOS: the JDK java_home reports; elsewhere (Linux CI / cloud): the java already on PATH.
if [ -x /usr/libexec/java_home ] && JAVA_HOME_DIR=$(/usr/libexec/java_home 2>/dev/null); then PATH="$JAVA_HOME_DIR/bin:$PATH"; fi
command -v java >/dev/null || { echo 'java not found (no /usr/libexec/java_home, none on PATH)'; exit 1; }
python3 - <<'PYTIMEOUT'
import os,signal,subprocess,sys
command=['rules-tests/node_modules/.bin/firebase','emulators:exec','--config','firebase.presence.local.json','--project','demo-holobots-presence','--only','firestore','GCLOUD_PROJECT=demo-holobots-presence node --test functions/scripts/test-presence-emulator.mjs functions/scripts/test-presence-expiry-emulator.mjs && cd rules-tests && ./node_modules/.bin/vitest run --no-cache --configLoader runner tests/presence.test.ts tests/presence-write-paths.test.ts']
p=subprocess.Popen(command,start_new_session=True)
try: sys.exit(p.wait(timeout=180))
except subprocess.TimeoutExpired:
 os.killpg(p.pid,signal.SIGTERM)
 try: p.wait(timeout=10)
 except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL)
 raise SystemExit('Local emulator timed out; stopped its process group')
PYTIMEOUT
