#!/usr/bin/env python3
"""Opt-in simulator attachment; no framework argument preserves the ordinary host build."""
from pathlib import Path
import argparse,plistlib,subprocess,tempfile

def external(path,repo):
 path=Path(path).expanduser().resolve();repo=Path(repo).resolve()
 if path==repo or repo in path.parents:raise ValueError('Binary inputs and DerivedData must stay outside the git checkout.')
 return path

def build_host(framework,out,mobile,run=subprocess.run):
 mobile=Path(mobile).resolve();repo=mobile.parent;out=external(out,repo)
 if out.exists():raise ValueError('Use a fresh DerivedData directory; existing build output is not modified.')
 args=['xcodebuild','-workspace',str(mobile/'ios/HolobotsMobile.xcworkspace'),'-scheme','HolobotsMobile','-configuration','Debug','-destination','generic/platform=iOS Simulator','-sdk','iphonesimulator','-derivedDataPath',str(out),'-jobs','2','CODE_SIGNING_ALLOWED=NO']
 framework=external(framework,repo) if framework else None
 if framework:
  if framework.suffix!='.framework' or not (framework/'Headers/UnityFramework.h').is_file():raise ValueError('Expected a real UnityFramework with public headers.')
  with (framework/'Info.plist').open('rb') as f:info=plistlib.load(f)
  if info.get('CFBundleIdentifier')!='com.unity3d.framework':raise ValueError('Unity Data bundle must be com.unity3d.framework.')
  binary=framework/info['CFBundleExecutable']
  probe=run(['xcrun','vtool','-show-build',str(binary)],capture_output=True,text=True,check=True).stdout
  if 'IOSSIMULATOR' not in probe:raise ValueError('A device framework cannot link into Simulator.')
  if not (framework/'Data/boot.config').is_file():raise ValueError('UnityFramework must contain exported Data/boot.config.')
 with tempfile.TemporaryDirectory(prefix='hb-unity-link-') as tmp:
  if framework:
   # No unqualified OTHER_LDFLAGS: the workspace also builds watchOS targets.
   # Conditional settings leave all Watch SDKs and ordinary no-framework builds alone.
   config=Path(tmp)/'UnitySimulator.xcconfig'
   config.write_text(f'FRAMEWORK_SEARCH_PATHS[sdk=iphonesimulator*] = $(inherited) "{framework.parent}"\nOTHER_LDFLAGS[sdk=iphonesimulator*] = $(inherited) -framework UnityFramework\nLD_RUNPATH_SEARCH_PATHS[sdk=iphonesimulator*] = $(inherited) @executable_path/Frameworks\n')
   args+=['-xcconfig',str(config)]
  run(args+['build'],cwd=mobile,check=True)
 app=out/'Build/Products/Debug-iphonesimulator/HolobotsMobile.app'
 if framework:
  destination=app/'Frameworks/UnityFramework.framework'
  if destination.exists():raise ValueError('Unexpected existing embedded framework; refusing mixed versions.')
  destination.parent.mkdir(parents=True,exist_ok=True)
  run(['ditto',str(framework),str(destination)],check=True)
  run(['codesign','--force','--sign','-',str(destination)],check=True)
  run(['codesign','--force','--sign','-',str(app)],check=True)
 return app

def main():
 p=argparse.ArgumentParser();p.add_argument('--framework',type=Path);p.add_argument('--derived-data',required=True,type=Path);a=p.parse_args()
 print(build_host(a.framework,a.derived_data,Path(__file__).resolve().parents[1]))
if __name__=='__main__':main()
