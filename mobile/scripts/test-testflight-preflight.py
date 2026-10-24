import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('preflight', Path(__file__).with_name('testflight-preflight.py'))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)
SOURCE = Path(__file__).resolve().parents[1]

class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        paths = ['app.json', 'assets/icon.png', 'ios/HolobotsMobile.xcodeproj/project.pbxproj', 'ios/HolobotsMobile/Info.plist', 'ios/HolobotsMobile/HolobotsMobile.entitlements', 'ios/HolobotsMobile/PrivacyInfo.xcprivacy', 'ios/HolobotsWatch Watch App/HolobotsWatch Watch App.entitlements']
        paths += [str(p.relative_to(SOURCE)) for p in (SOURCE/'ios').glob('**/AppIcon.appiconset/*.png')]
        for relative in paths:
            dest = self.root/relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE/relative, dest)
    def test_known_bad_original_expo_build_two_is_rejected(self):
        p = self.root/'app.json'
        data = json.loads(p.read_text()); data['expo']['ios']['buildNumber'] = '2'; p.write_text(json.dumps(data))
        self.assertIn('Expo/native build numbers differ', preflight.inspect(self.root)['localFailures'])
    def test_local_pass_never_claims_upload_ready(self):
        report = preflight.inspect(self.root)
        self.assertTrue(report['localChecksPassed']); self.assertFalse(report['uploadReady']); self.assertTrue(report['releaseHolds'])
    def test_opaque_rgba_format_still_rejected(self):
        p = self.root/'assets/icon.png'; data = bytearray(p.read_bytes()); data[25] = 6; p.write_bytes(data)
        self.assertTrue(any('alpha channel' in x for x in preflight.inspect(self.root)['localFailures']))
    def test_missing_watch_capability_rejected(self):
        (self.root/'ios/HolobotsWatch Watch App/HolobotsWatch Watch App.entitlements').unlink()
        self.assertIn('Watch HealthKit entitlement missing', preflight.inspect(self.root)['localFailures'])
    def test_malformed_privacy_manifest_rejected(self):
        (self.root/'ios/HolobotsMobile/PrivacyInfo.xcprivacy').write_text('not a plist')
        self.assertFalse(preflight.inspect(self.root)['localChecksPassed'])
    def test_missing_phone_icon_rejected(self):
        (self.root/'assets/icon.png').unlink()
        self.assertFalse(preflight.inspect(self.root)['localChecksPassed'])

if __name__ == '__main__': unittest.main()
