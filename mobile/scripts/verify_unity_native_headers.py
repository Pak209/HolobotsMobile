#!/usr/bin/env python3
"""Compile both native-host branches against real installed SDK/Unity/RN headers; no app build."""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--unity',default='/Applications/Unity/Hub/Editor/6000.5.4f1/PlaybackEngines/iOSSupport/Trampoline');a=p.parse_args()
mobile=Path(__file__).resolve().parents[1];unity=Path(a.unity);work=Path(tempfile.mkdtemp(prefix='hb-real-unity-native-'));inc=work/'headers/UnityFramework';inc.mkdir(parents=True)
sources=[unity/'UnityFramework/UnityFramework.h',unity/'Classes/UnityAppController.h',unity/'Classes/PluginBase/RenderPluginDelegate.h',unity/'Classes/PluginBase/LifeCycleListener.h']
for source in sources:shutil.copyfile(source,inc/source.name)
sdk=subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-path'],text=True).strip()
base=['xcrun','clang','-c','-fobjc-arc','-fmodules','-fmodules-cache-path='+str(work/'modules'),'-target','arm64-apple-ios15.1-simulator','-isysroot',sdk,'-I',str(mobile/'ios/Pods/Headers/Public/React-Core'),'-I',str(mobile/'ios/Pods/Headers/Public'),str(mobile/'ios/HolobotsMobile/HolobotsUnityRuntime.m')]
results=[]
for label,extra in [('unavailable',[]),('real-unity-headers',['-I',str(inc.parent)])]:
 r=subprocess.run(base+extra+['-o',str(work/(label+'.o'))],text=True,capture_output=True)
 results.append(dict(branch=label,exit=r.returncode,diagnostics=r.stdout+r.stderr));print(label,r.returncode,r.stdout+r.stderr)
report=dict(directory=str(work),sdk=sdk,headers=[dict(path=str(s),sha256=hashlib.sha256(s.read_bytes()).hexdigest()) for s in sources],results=results,linkedOrExecuted=False)
(work/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(work/'result.json');raise SystemExit(any(x['exit'] for x in results))
