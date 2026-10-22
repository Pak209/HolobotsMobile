import importlib.util
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('preflight', Path(__file__).with_name('testflight-preflight.py'))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)
SOURCE = Path(__file__).resolve().parents[1]
GATE_ON = 'export EXPO_PUBLIC_HOLOCITY_LITE=1\n'
EXPO_GL_LOCK = '\nPODS:\n  - ExpoGL (15.1.7):\n\nSPEC CHECKSUMS:\n  ExpoGL: e21f853b0359861f49eb7f69f97d92f1cb8445d4\n'

class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        paths = ['app.json', 'package.json', 'assets/icon.png', 'ios/Podfile.lock', 'ios/HolobotsMobile.xcodeproj/project.pbxproj', 'ios/HolobotsMobile/Info.plist', 'ios/HolobotsMobile/HolobotsMobile.entitlements', 'ios/HolobotsMobile/PrivacyInfo.xcprivacy', 'ios/HolobotsWatch Watch App/HolobotsWatch Watch App.entitlements']
        paths += [str(p.relative_to(SOURCE)) for p in (SOURCE/'ios').glob('**/AppIcon.appiconset/*.png')]
        for relative in paths:
            dest = self.root/relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE/relative, dest)
        # The base fixture is gate-off with ExpoGL locked; tests opt into the rest.
        (self.root/'ios/.xcode.env').write_text('export NODE_BINARY=$(command -v node)\n')
        with (self.root/'ios/Podfile.lock').open('a') as f: f.write(EXPO_GL_LOCK)
    def run_preflight(self, **kw):
        kw.setdefault('environ', {})
        return preflight.inspect(self.root, **kw)
    def set_expo(self, **ios):
        p = self.root/'app.json'
        data = json.loads(p.read_text()); data['expo']['ios'].update(ios); p.write_text(json.dumps(data))
    def bundle(self, text):
        p = self.root/'main.jsbundle'; p.write_bytes(text if isinstance(text, bytes) else text.encode()); return p

    def test_known_bad_original_expo_build_two_is_rejected(self):
        self.set_expo(buildNumber='2')
        self.assertIn('Expo/native build numbers differ', self.run_preflight()['localFailures'])
    def test_local_pass_never_claims_upload_ready(self):
        report = self.run_preflight()
        self.assertTrue(report['localChecksPassed'], report['localFailures']); self.assertFalse(report['uploadReady']); self.assertTrue(report['releaseHolds'])
    def test_opaque_rgba_format_still_rejected(self):
        p = self.root/'assets/icon.png'; data = bytearray(p.read_bytes()); data[25] = 6; p.write_bytes(data)
        self.assertTrue(any('alpha channel' in x for x in self.run_preflight()['localFailures']))
    def test_missing_watch_capability_rejected(self):
        (self.root/'ios/HolobotsWatch Watch App/HolobotsWatch Watch App.entitlements').unlink()
        self.assertIn('Watch HealthKit entitlement missing', self.run_preflight()['localFailures'])
    def test_malformed_privacy_manifest_rejected(self):
        (self.root/'ios/HolobotsMobile/PrivacyInfo.xcprivacy').write_text('not a plist')
        self.assertFalse(self.run_preflight()['localChecksPassed'])
    def test_missing_phone_icon_rejected(self):
        (self.root/'assets/icon.png').unlink()
        self.assertFalse(self.run_preflight()['localChecksPassed'])

    def test_released_marketing_version_rejected(self):
        self.assertTrue(self.run_preflight(released_versions=(json.loads((self.root/'app.json').read_text())['expo']['version'],))['localFailures'])
    def test_build_must_exceed_last_uploaded(self):
        build = int(json.loads((self.root/'app.json').read_text())['expo']['ios']['buildNumber'])
        self.assertTrue(self.run_preflight(last_uploaded=build - 1)['localChecksPassed'])
        self.assertTrue(any('not greater than the last uploaded' in x for x in self.run_preflight(last_uploaded=build)['localFailures']))
    def test_phone_healthkit_string_in_app_json_rejected(self):
        p = self.root/'app.json'; data = json.loads(p.read_text())
        data['expo']['ios']['infoPlist']['NSHealthShareUsageDescription'] = 'x'; p.write_text(json.dumps(data))
        self.assertIn('Phone declares HealthKit usage string: NSHealthShareUsageDescription', self.run_preflight()['localFailures'])
    def test_missing_expo_gl_lock_rejected(self):
        # Strip every locked ExpoGL pod/checksum line: the real lock now carries ExpoGL too, not just the fixture.
        lock = (self.root/'ios/Podfile.lock').read_text()
        (self.root/'ios/Podfile.lock').write_text(re.sub(r'^  (- ExpoGL \(|ExpoGL: [0-9a-f]+$).*\n', '', lock, flags=re.M))
        self.assertTrue(any('ExpoGL is not in ios/Podfile.lock' in x for x in self.run_preflight()['localFailures']))

    def test_gate_on_from_xcode_env(self):
        (self.root/'ios/.xcode.env').write_text(GATE_ON)
        report = self.run_preflight(expect_lite='on')
        self.assertTrue(report['localChecksPassed'], report['localFailures']); self.assertEqual(report['inventory']['liteGate']['effective'], '1')
    def test_gate_on_expected_but_absent(self):
        self.assertTrue(any('expected "1"' in x for x in self.run_preflight(expect_lite='on')['localFailures']))
    def test_gate_on_must_come_from_versioned_xcode_env(self):
        (self.root/'ios/.xcode.env.local').write_text(GATE_ON)
        self.assertIn('Lite gate must come from the versioned ios/.xcode.env (D6)', self.run_preflight(expect_lite='on')['localFailures'])
    def test_local_override_turning_gate_off_rejected(self):
        (self.root/'ios/.xcode.env').write_text(GATE_ON)
        (self.root/'ios/.xcode.env.local').write_text('export EXPO_PUBLIC_HOLOCITY_LITE=0\n')
        report = self.run_preflight(expect_lite='on')
        self.assertEqual(report['inventory']['liteGate']['effective'], '0'); self.assertFalse(report['localChecksPassed'])
    def test_disagreeing_expo_env_file_reported(self):
        (self.root/'ios/.xcode.env').write_text(GATE_ON)
        (self.root/'.env.production').write_text('EXPO_PUBLIC_HOLOCITY_LITE=0\n')
        self.assertTrue(any('.env.production' in x for x in self.run_preflight(expect_lite='on')['localFailures']))
    def test_expo_env_file_applies_only_when_unset(self):
        (self.root/'.env').write_text('EXPO_PUBLIC_HOLOCITY_LITE=1\n')
        self.assertEqual(self.run_preflight()['inventory']['liteGate']['effective'], '1')
        self.assertEqual(self.run_preflight(environ={'EXPO_PUBLIC_HOLOCITY_LITE': '0'})['inventory']['liteGate']['effective'], '0')
    def test_gate_off_expected_but_any_source_on(self):
        for name in ['ios/.xcode.env', 'ios/.xcode.env.local', '.env.production']:
            with self.subTest(name=name):
                (self.root/name).write_text(GATE_ON if name.startswith('ios') else 'EXPO_PUBLIC_HOLOCITY_LITE=1\n')
                self.assertFalse(self.run_preflight(expect_lite='off')['localChecksPassed'])
                (self.root/name).write_text('')
    def test_gate_in_xcode_build_settings_seen(self):
        p = self.root/'ios/HolobotsMobile.xcodeproj/project.pbxproj'
        p.write_text(p.read_text().replace('MARKETING_VERSION =', 'EXPO_PUBLIC_HOLOCITY_LITE = 1;\n\t\t\t\tMARKETING_VERSION =', 1))
        self.assertFalse(self.run_preflight(expect_lite='off')['localChecksPassed'])
    def test_process_environment_seen(self):
        self.assertFalse(self.run_preflight(expect_lite='off', environ={'EXPO_PUBLIC_HOLOCITY_LITE': '1'})['localChecksPassed'])
    def test_unexported_assignment_does_not_count(self):
        (self.root/'ios/.xcode.env').write_text('EXPO_PUBLIC_HOLOCITY_LITE=1\n')
        self.assertFalse(self.run_preflight(expect_lite='on')['localChecksPassed'])
        (self.root/'ios/.xcode.env').write_text('EXPO_PUBLIC_HOLOCITY_LITE=1\nexport EXPO_PUBLIC_HOLOCITY_LITE\n')
        self.assertTrue(self.run_preflight(expect_lite='on')['localChecksPassed'])
    def test_gate_in_shell_script_phase_seen(self):
        p = self.root/'ios/HolobotsMobile.xcodeproj/project.pbxproj'
        p.write_text(p.read_text().replace('shellScript = "', 'shellScript = "export EXPO_PUBLIC_HOLOCITY_LITE=1\\n', 1))
        report = self.run_preflight(expect_lite='off')
        self.assertFalse(report['localChecksPassed']); self.assertIn('Lite gate source turns lite on: ios/HolobotsMobile.xcodeproj shellScript phases', report['localFailures'])
    def test_unset_in_local_env_clears_gate(self):
        (self.root/'ios/.xcode.env').write_text(GATE_ON)
        (self.root/'ios/.xcode.env.local').write_text('unset EXPO_PUBLIC_HOLOCITY_LITE\n')
        self.assertIsNone(self.run_preflight()['inventory']['liteGate']['effective'])

    def test_bundle_gate_minified(self):
        on = '__d(function(g,r,i,a,m,e,d){function n(){return!0}Object.defineProperty(e,"__esModule",{value:!0}),e.isLiteEnabled=n,e.isLitePreviewEnabled=function(){return!1}},565,[]);'
        (self.root/'ios/.xcode.env').write_text(GATE_ON)
        self.assertTrue(self.run_preflight(expect_lite='on', bundle=self.bundle(on))['localChecksPassed'])
        report = self.run_preflight(expect_lite='on', bundle=self.bundle(on.replace('return!0', 'return!1')))
        self.assertIn('Bundle isLiteEnabled() returns 0, expected lite on', report['localFailures'])
    def test_bundle_gate_unminified(self):
        report = self.run_preflight(expect_lite='off', bundle=self.bundle('function isLiteEnabled() {\n  return false;\n}\n'))
        self.assertEqual(report['inventory']['bundleLiteGate'], '0'); self.assertTrue(report['localChecksPassed'], report['localFailures'])
    def test_bundle_hermes_bytecode_rejected(self):
        self.assertTrue(any('Hermes bytecode' in x for x in self.run_preflight(bundle=self.bundle(preflight.HERMES_MAGIC + b'\0' * 64))['localFailures']))
    def test_bundle_runtime_env_read_rejected(self):
        self.assertTrue(any('not inlined' in x for x in self.run_preflight(bundle=self.bundle('function isLiteEnabled(){return process.env.EXPO_PUBLIC_HOLOCITY_LITE==="1"}'))['localFailures']))

if __name__ == '__main__': unittest.main()
