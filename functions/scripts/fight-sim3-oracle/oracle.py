#!/usr/bin/env python3
"""fight-host-1 cold oracle: compile HolobotsUnity's C# duel-sim-3 core + fight-ai-1 brain + fight-input-1 codec at a pinned
ref with Unity's bundled .NET 8 Roslyn (no Unity process, no restore, no network) together with Oracle.cs, then run it.
It is the reference the TS twin (functions/src/sim/fight) is parity-pinned against:
  oracle.py vectors <dir>                      re-check the frozen Schemas/fixtures/duel-sim-3 vectors in C#
  oracle.py brain <out.json>                   regenerate scripts/fixtures/duel-sim-3-brain/brain-vectors.json
  oracle.py codes <fixture.json> <out.json>    the C# decoder's refusal code per duel-inputs-2 invalid case
  oracle.py state <doc.json> <tick> [name]     C# canonical state bytes (hex) at the end of <tick> (for fight-sim3-diff.mjs)
  oracle.py profiles | bench
Options: --unity-repo (default ~/Projects/HolobotsUnity) --ref (default 95e924186, claude/fight-tune-2 = duel-sim-3 r3 on #120 + #134)
         --unity (Unity.app, default 6000.5.4f1). Newtonsoft comes from the Unity repo's Library/PackageCache (read only)."""
import argparse, json, shutil, subprocess, sys, tempfile
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--unity-repo', type=Path, default=Path.home() / 'Projects/HolobotsUnity')
p.add_argument('--ref', default='95e924186')   # fight-tune-2: HolobotsUnity claude/fight-tune-2 (duel-sim-3 r3; stacks on #120 + #134)
p.add_argument('--unity', type=Path, default=Path('/Applications/Unity/Hub/Editor/6000.5.4f1/Unity.app'))
p.add_argument('args', nargs=argparse.REMAINDER)
a = p.parse_args()
here = Path(__file__).resolve().parent
sdk = a.unity / 'Contents/Resources/Scripting/DotNetSdk'
dotnet = sdk / 'dotnet'; csc = next(sdk.glob('sdk/*/Roslyn/bincore/csc.dll'))
refdir = next(sdk.glob('packs/Microsoft.NETCore.App.Ref/*/ref/net8.0')); version = next((sdk / 'shared/Microsoft.NETCore.App').iterdir()).name
newtonsoft = next(a.unity_repo.glob('Library/PackageCache/com.unity.nuget.newtonsoft-json@*/Runtime/Newtonsoft.Json.dll'))
SIM = 'Assets/Holobots/Shared/Scripts/Runtime/Sim'
with tempfile.TemporaryDirectory(prefix='fight-sim3-oracle-') as work:
    w = Path(work); src = []
    files = subprocess.run(['git', '-C', str(a.unity_repo), 'ls-tree', '-r', '--name-only', a.ref, '--', SIM + '/Fight', SIM + '/Ai'], check=True, capture_output=True, text=True).stdout.split()
    files += [SIM + '/FightInputs/FightInputLog.cs', SIM + '/FightInputs/FightTickRecord.cs', SIM + '/FightInputs/FightInputsBridge.cs']
    for f in files:
        if not f.endswith('.cs'): continue
        text = subprocess.run(['git', '-C', str(a.unity_repo), 'show', '%s:%s' % (a.ref, f)], check=True, capture_output=True, text=True).stdout
        if f.endswith('FightInputsBridge.cs'):   # FightQueueInputs needs the Unity-side FightTickQueue (Holobots.City): drop it
            i = text.index('    /// <summary>\n    /// The LIVE'); j = text.index('    /// <summary>The REPLAY'); text = text[:i] + text[j:]
        out = w / Path(f).name; out.write_text(text); src.append(out)
    src.append(here / 'Oracle.cs')
    dll = w / 'Oracle.dll'
    rsp = ['-nologo', '-target:exe', '-langversion:9.0', '-optimize+', '-nowarn:CS0436', '-out:"%s"' % dll] + ['-r:"%s"' % r for r in list(refdir.glob('*.dll')) + [newtonsoft]] + ['"%s"' % s for s in src]
    (w / 'compile.rsp').write_text('\n'.join(rsp))
    subprocess.run([str(dotnet), str(csc), '@' + str(w / 'compile.rsp')], check=True, timeout=300)
    shutil.copyfile(newtonsoft, w / newtonsoft.name)
    (w / 'Oracle.runtimeconfig.json').write_text(json.dumps({'runtimeOptions': {'tfm': 'net8.0', 'framework': {'name': 'Microsoft.NETCore.App', 'version': version}}}))
    sys.exit(subprocess.run([str(dotnet), str(dll)] + a.args, timeout=3600).returncode)
