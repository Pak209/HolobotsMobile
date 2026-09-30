#!/usr/bin/env python3
"""Build a real exported UnityFramework for Simulator, then bundle its exported Data. No Unity editor."""
from pathlib import Path
import argparse,plistlib,subprocess
from build_unity_simulator import external

def build_framework(export,out,repo,run=subprocess.run):
 export=external(export,repo);out=external(out,repo)
 if out.exists():raise ValueError('Use fresh DerivedData; do not overlap an active build.')
 project=export/'Unity-iPhone.xcodeproj';data=export/'Data'
 if not (project/'project.pbxproj').is_file() or not (data/'boot.config').is_file():raise ValueError('Expected a complete real UnityExport with project and Data/boot.config.')
 run(['xcodebuild','-project',str(project),'-scheme','UnityFramework','-configuration','Release','-destination','generic/platform=iOS Simulator','-sdk','iphonesimulator','-derivedDataPath',str(out),'-jobs','2','CODE_SIGNING_ALLOWED=NO','build'],check=True)
 framework=out/'Build/Products/Release-iphonesimulator/UnityFramework.framework'
 with (framework/'Info.plist').open('rb') as f:info=plistlib.load(f)
 if info.get('CFBundleIdentifier')!='com.unity3d.framework':raise ValueError('Framework bundle id does not match native data-bundle selection.')
 run(['ditto',str(data),str(framework/'Data')],check=True)
 if not (framework/'Data/boot.config').is_file():raise ValueError('Exported Data was not embedded.')
 print('Framework and Data ready; attach with build_unity_simulator.py. No binaries belong in git.')
 return framework

def main():
 p=argparse.ArgumentParser();p.add_argument('--export',required=True,type=Path);p.add_argument('--derived-data',required=True,type=Path);a=p.parse_args()
 print(build_framework(a.export,a.derived_data,Path(__file__).resolve().parents[2]))
if __name__=='__main__':main()
