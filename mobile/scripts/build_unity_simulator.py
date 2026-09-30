#!/usr/bin/env python3
"""Opt-in simulator framework attachment. All binary output stays outside the repository.
No framework argument = ordinary unchanged host build (unavailable Unity branch).
A real simulator UnityFramework with bundled Data is required for the embedded branch.
"""
from pathlib import Path
import argparse,plistlib,subprocess
p=argparse.ArgumentParser();p.add_argument('--framework',type=Path);p.add_argument('--derived-data',required=True,type=Path);a=p.parse_args()
mobile=Path(__file__).resolve().parents[1];repo=mobile.parent
out=a.derived_data.expanduser().resolve()
if out==repo or repo in out.parents:raise SystemExit('DerivedData must be outside the git checkout (use the vault).')
args=['xcodebuild','-workspace',str(mobile/'ios/HolobotsMobile.xcworkspace'),'-scheme','HolobotsMobile','-configuration','Debug','-destination','generic/platform=iOS Simulator','-sdk','iphonesimulator','-derivedDataPath',str(out),'CODE_SIGNING_ALLOWED=NO']
framework=None
if a.framework:
 framework=a.framework.expanduser().resolve()
 if repo==framework or repo in framework.parents:raise SystemExit('Keep exported UnityFramework binaries in the vault, outside git.')
 if framework.suffix!='.framework' or not (framework/'Headers/UnityFramework.h').is_file():raise SystemExit('Expected a real UnityFramework with public headers.')
 with (framework/'Info.plist').open('rb') as f:info=plistlib.load(f)
 binary=framework/info['CFBundleExecutable']
 probe=subprocess.run(['xcrun','vtool','-show-build',str(binary)],capture_output=True,text=True,check=True).stdout
 if 'IOSSIMULATOR' not in probe:raise SystemExit('This script requires a simulator-built UnityFramework; device frameworks cannot link into Simulator.')
 if not (framework/'Data/boot.config').is_file():raise SystemExit('UnityFramework must contain exported Data/boot.config (com.unity3d.framework data bundle).')
 args += [f'FRAMEWORK_SEARCH_PATHS=$(inherited) "{framework.parent}"','OTHER_LDFLAGS=$(inherited) -framework UnityFramework','LD_RUNPATH_SEARCH_PATHS=$(inherited) @executable_path/Frameworks']
subprocess.run(args+['build'],cwd=mobile,check=True)
app=out/'Build/Products/Debug-iphonesimulator/HolobotsMobile.app'
if framework:
 destination=app/'Frameworks/UnityFramework.framework'
 if destination.exists():raise SystemExit('Existing embedded framework found; use a fresh DerivedData directory to prevent mixed versions.')
 destination.parent.mkdir(parents=True,exist_ok=True)
 subprocess.run(['ditto',str(framework),str(destination)],check=True)
 # Ad-hoc signing only for simulator output; no developer identity/provisioning changes.
 subprocess.run(['codesign','--force','--sign','-',str(destination)],check=True)
 subprocess.run(['codesign','--force','--sign','-',str(app)],check=True)
print(app)
