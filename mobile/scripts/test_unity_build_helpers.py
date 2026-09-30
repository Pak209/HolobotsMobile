import plistlib
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from build_unity_simulator import build_host, external
from build_unity_framework import build_framework

class BuildHelpers(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name);self.repo=self.root/'repo';self.mobile=self.repo/'mobile';self.mobile.mkdir(parents=True)
  self.calls=[];self.config=''
 def framework(self):
  f=self.root/'UnityFramework.framework';(f/'Headers').mkdir(parents=True);(f/'Headers/UnityFramework.h').write_text('// TEST FIXTURE ONLY')
  (f/'Data').mkdir();(f/'Data/boot.config').write_text('fixture');(f/'UnityFramework').write_text('fixture')
  self.plist(f);return f
 def plist(self,f,identifier='com.unity3d.framework'):
  (f/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':identifier,'CFBundleExecutable':'UnityFramework'}))
 def fake_run(self,args,**kwargs):
  self.calls.append(args)
  if '-xcconfig' in args:self.config=Path(args[args.index('-xcconfig')+1]).read_text()
  if args[0]=='ditto':shutil.copytree(args[1],args[2],dirs_exist_ok=True)
  return SimpleNamespace(stdout='platform IOSSIMULATOR')
 def test_plain_host_does_not_link_or_embed(self):
  build_host(None,self.root/'out',self.mobile,self.fake_run)
  self.assertEqual(len(self.calls),1);self.assertNotIn('-xcconfig',self.calls[0]);self.assertIn('2',self.calls[0]);self.assertEqual(self.config,'')
 def test_sdk_scoped_link_and_data_embedding(self):
  f=self.framework();app=build_host(f,self.root/'out',self.mobile,self.fake_run)
  self.assertTrue((app/'Frameworks/UnityFramework.framework/Data/boot.config').is_file())
  for line in self.config.splitlines():self.assertIn('[sdk=iphonesimulator*]',line)
  self.assertIn('-framework UnityFramework',self.config)
  self.assertEqual(sum(c[0]=='codesign' for c in self.calls),2)
 def test_repo_and_symlink_rejected(self):
  link=self.root/'alias';link.symlink_to(self.repo,target_is_directory=True)
  for path in [self.repo,self.mobile/'out',link/'out']:
   with self.assertRaises(ValueError):external(path,self.repo)
 def test_existing_output_rejected_without_build(self):
  with self.assertRaises(ValueError):build_host(None,self.root,self.mobile,self.fake_run)
  self.assertEqual(self.calls,[])
 def test_device_framework_rejected(self):
  with self.assertRaises(ValueError):build_host(self.framework(),self.root/'out',self.mobile,lambda *a,**k:SimpleNamespace(stdout='platform IOS'))
 def test_missing_data_rejected(self):
  f=self.framework();(f/'Data/boot.config').unlink()
  with self.assertRaises(ValueError):build_host(f,self.root/'out',self.mobile,self.fake_run)
  self.assertFalse(any(c[0]=='xcodebuild' for c in self.calls))
 def test_wrong_bundle_rejected(self):
  f=self.framework();self.plist(f,'wrong')
  with self.assertRaises(ValueError):build_host(f,self.root/'out',self.mobile,self.fake_run)
  self.assertEqual(self.calls,[])
 def test_missing_headers_rejected(self):
  f=self.framework();(f/'Headers/UnityFramework.h').unlink()
  with self.assertRaises(ValueError):build_host(f,self.root/'out',self.mobile,self.fake_run)
 def test_framework_build_jobs_and_exported_data(self):
  export=self.root/'export';(export/'Unity-iPhone.xcodeproj').mkdir(parents=True);(export/'Unity-iPhone.xcodeproj/project.pbxproj').write_text('TEST FIXTURE')
  (export/'Data').mkdir();(export/'Data/boot.config').write_text('exported fixture')
  out=self.root/'out'
  def run(args,**kwargs):
   if args[0]=='xcodebuild':
    f=out/'Build/Products/Release-iphonesimulator/UnityFramework.framework';f.mkdir(parents=True);self.plist(f)
   return self.fake_run(args,**kwargs)
  f=build_framework(export,out,self.repo,run)
  self.assertEqual((f/'Data/boot.config').read_text(),'exported fixture')
  args=self.calls[0];self.assertEqual(args[args.index('-jobs')+1],'2');self.assertEqual(args[args.index('-scheme')+1],'UnityFramework')
 def test_incomplete_export_rejected(self):
  with self.assertRaises(ValueError):build_framework(self.root/'missing',self.root/'out',self.repo,self.fake_run)
  self.assertEqual(self.calls,[])
 def test_framework_existing_output_rejected(self):
  with self.assertRaises(ValueError):build_framework(self.root/'missing',self.root,self.repo,self.fake_run)
  self.assertEqual(self.calls,[])
if __name__=='__main__':unittest.main()
