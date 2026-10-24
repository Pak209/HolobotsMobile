#!/usr/bin/env python3
"""Read-only local release inventory; never claims signing, privacy approval or upload readiness."""
import argparse
import json
import plistlib
import re
import struct
from pathlib import Path

RELEASE_HOLDS = [
    'App Store Connect: confirm registered identifiers and next unused build number (37 is only repository parity).',
    'Apple distribution signing/provisioning and Watch HealthKit capability match require account verification.',
    'App privacy/disclosure and export-compliance answers require owner approval; manifest syntax is not approval.',
    'Physical-device release acceptance, live citizen admission, native diagnostics and performance gates remain unresolved.',
]

def inspect(root, expo_config=None):
    failures, inventory = [], {}
    def check(ok, message):
        if not ok: failures.append(message)
    def plist(path):
        try:
            with path.open('rb') as f: return plistlib.load(f)
        except (OSError, ValueError, plistlib.InvalidFileException):
            failures.append(f'Invalid/missing plist: {path.relative_to(root)}')
            return {}
    expo = json.loads((expo_config or root / 'app.json').read_text())['expo']
    project = (root / 'ios/HolobotsMobile.xcodeproj/project.pbxproj').read_text()
    builds = set(re.findall(r'CURRENT_PROJECT_VERSION = ([^;]+);', project))
    versions = set(re.findall(r'MARKETING_VERSION = ([^;]+);', project))
    check(builds == {expo['ios']['buildNumber']}, 'Expo/native build numbers differ')
    check(versions == {expo['version']}, 'Expo/native marketing versions differ')
    check(f"PRODUCT_BUNDLE_IDENTIFIER = {expo['ios']['bundleIdentifier']};" in project, 'Expo/native bundle identity differs')
    inventory['buildNumber'] = expo['ios']['buildNumber']
    inventory['bundleIdentifier'] = expo['ios']['bundleIdentifier']
    info = plist(root / 'ios/HolobotsMobile/Info.plist')
    check(info.get('CFBundleVersion') == '$(CURRENT_PROJECT_VERSION)', 'Info.plist does not use native build setting')
    for key in ['NSFaceIDUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSMotionUsageDescription']:
        check(bool(info.get(key)) and bool(expo['ios'].get('infoPlist', {}).get(key)), f'Missing usage description: {key}')
    phone = plist(root / 'ios/HolobotsMobile/HolobotsMobile.entitlements')
    watch = plist(root / 'ios/HolobotsWatch Watch App/HolobotsWatch Watch App.entitlements')
    check(watch.get('com.apple.developer.healthkit') is True, 'Watch HealthKit entitlement missing')
    inventory['phoneEntitlements'] = phone
    inventory['watchEntitlements'] = watch
    privacy = plist(root / 'ios/HolobotsMobile/PrivacyInfo.xcprivacy')
    check(isinstance(privacy.get('NSPrivacyTracking'), bool), 'Missing privacy tracking declaration')
    check(isinstance(privacy.get('NSPrivacyCollectedDataTypes'), list), 'Missing collected-data declaration array')
    accessed = privacy.get('NSPrivacyAccessedAPITypes')
    check(isinstance(accessed, list) and bool(accessed), 'Missing required-reason API declarations')
    for row in accessed if isinstance(accessed, list) else []:
        check(isinstance(row, dict) and bool(row.get('NSPrivacyAccessedAPIType')) and isinstance(row.get('NSPrivacyAccessedAPITypeReasons'), list) and bool(row.get('NSPrivacyAccessedAPITypeReasons')), 'Malformed required-reason API entry')
    inventory['privacyManifest'] = privacy
    icons = [root / expo['icon'], *sorted((root / 'ios').glob('**/AppIcon.appiconset/*.png'))]
    check(len(icons) >= 3, 'Missing phone or Watch app icon')
    inventory['icons'] = []
    for path in icons:
        data = path.read_bytes() if path.exists() else b''
        valid = len(data) >= 33 and data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR'
        check(valid, f'Invalid/missing PNG: {path.name}')
        if not valid: continue
        width, height = struct.unpack('>II', data[16:24])
        color_type = data[25]
        # Check channel format, not just whether the pixels happen to be opaque.
        pos, transparency = 8, False
        while pos + 12 <= len(data):
            size = int.from_bytes(data[pos:pos+4], 'big')
            transparency |= data[pos+4:pos+8] == b'tRNS'
            pos += size + 12
        check((width, height) == (1024, 1024), f'App icon must be 1024 square: {path.name}')
        check(color_type in (0, 2, 3) and not transparency, f'App icon has an alpha channel/transparency: {path.name}')
        inventory['icons'].append({'file': str(path.relative_to(root)), 'width': width, 'height': height, 'pngColorType': color_type, 'transparencyChunk': transparency})
    return {'localChecksPassed': not failures, 'uploadReady': False, 'localFailures': failures, 'releaseHolds': RELEASE_HOLDS, 'inventory': inventory}

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mobile-root', type=Path, default=Path(__file__).resolve().parents[1])
    p.add_argument('--expo-config', type=Path, help='Explicit config overlay for an isolated integration checkout')
    p.add_argument('--local-only', action='store_true', help='Exit success on local checks; uploadReady remains false')
    args = p.parse_args()
    report = inspect(args.mobile_root.resolve(), args.expo_config)
    print(json.dumps(report, indent=2))
    raise SystemExit(1 if report['localFailures'] else 0 if args.local_only else 2)
