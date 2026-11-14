#!/usr/bin/env python3
"""Read-only local release inventory; never claims signing, privacy approval or upload readiness."""
import argparse
import json
import os
import plistlib
import re
import struct
import subprocess
from pathlib import Path

RELEASE_HOLDS = [
    'App Store Connect: confirm the highest uploaded build so the next build number is unused (pass it as --last-uploaded).',
    'Apple distribution signing/provisioning and Watch HealthKit capability match require account verification.',
    'App privacy/disclosure and export-compliance answers require owner approval; manifest syntax is not approval.',
    'Purchases are undeclared only while remote config/monetization.iapEnabled is false; declare Purchase History (manifest + ASC label) before it is ever turned on.',
    'Physical-device release acceptance, live citizen admission, native diagnostics and performance gates remain unresolved.',
]
GATE = 'EXPO_PUBLIC_HOLOCITY_LITE'
# Client flags the release build turns ON with the gate (2026-10-23 "turn on all of the switches"): each is the
# client twin of a host flag merged on main. key -> the exported function the bundle inlines it into.
# Unmerged features (signatures, Zell, expedition) and __DEV__-only QA flags (PREVIEW*, RECEIPT_QA) stay off.
RELEASE_CLIENT_FLAGS = {
    'EXPO_PUBLIC_HOLOCITY_FIGHT_ATTRS': 'progressionRules5Enabled',
    'EXPO_PUBLIC_HOLOCITY_READINESS': 'readinessUiEnabled',
}
BUNDLE_FUNCTIONS = {GATE: 'isLiteEnabled', **RELEASE_CLIENT_FLAGS}
# Versions already approved in App Store Connect; their trains are closed to new builds.
RELEASED_VERSIONS = ('1.0',)
# Order the "Bundle React Native code and images" phase sources them; later wins.
XCODE_ENV_FILES = ['ios/.xcode.env', 'ios/.xcode.env.local', 'ios/.xcode.env.updates', 'ios/.xcode.env.local']
# What @expo/env reads for a non-Debug export:embed (NODE_ENV=production); it skips keys already set.
EXPO_ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env']
HERMES_MAGIC = bytes.fromhex('c61fbc03c103191f')

def shell_assignments(text, key):
    """Values a sourced shell file exports for key, in order (None = unset).

    A plain `KEY=v` stays a shell variable and never reaches export:embed's
    environment unless the file also runs `export KEY`."""
    lines = [line.split('#', 1)[0].strip() for line in text.splitlines()]
    exported = any(re.match(rf'^export\s+(.*\s)?{key}(\s|$)', line) for line in lines)
    values = []
    for line in lines:
        if re.match(rf'^unset\s+(.*\s)?{key}(\s|$)', line):
            values.append(None)
        m = re.match(rf'^(export\s+)?{key}=(.*)$', line)
        if m and (m.group(1) or exported):
            values.append(m.group(2).strip().strip('"\''))
    return values

def bundle_flag(text, key, fn):
    """'1' / '0' for what the bundled fn() returns for flag key, or an error string."""
    if f'process.env.{key}' in text:
        return None, f'Bundle reads process.env.{key} at runtime (flag was not inlined)'
    patterns = [
        rf'{fn}\s*=\s*function\s*\(\)\s*\{{\s*return\s*(!0|!1|true|false)\b',
        rf'function\s+{fn}\s*\(\)\s*\{{\s*return\s*(!0|!1|true|false)\b',
    ]
    found = [m.group(1) for p in patterns for m in re.finditer(p, text)]
    for m in re.finditer(rf'\b{fn}\s*=\s*([A-Za-z_$][\w$]*)\b', text):
        # Minified exports alias a hoisted local (`e.fn=n` ... `function n(){return!0}`) that may sit
        # anywhere in the same Metro module, before or after the export.
        start = text.rfind('__d(', 0, m.start()); end = text.find('__d(', m.end())
        module = text[max(0, start):end if end != -1 else len(text)]
        d = re.search(rf'function\s+{re.escape(m.group(1))}\s*\(\)\s*\{{\s*return\s*(!0|!1|true|false)\b', module)
        if d: found.append(d.group(1))
    values = {'1' if v in ('!0', 'true') else '0' for v in found}
    if len(values) != 1:
        return None, f'Could not read {fn}() from the bundle (found {sorted(values) or "nothing"})'
    return values.pop(), None

def bundle_flags(path, keys):
    """{key: value} plus errors; a Hermes bytecode bundle is one error for all keys."""
    data = path.read_bytes()
    if data[:8] == HERMES_MAGIC:
        return {k: None for k in keys}, ['Hermes bytecode bundle cannot be inspected; pass the JS bundle from `expo export:embed`']
    text = data.decode('utf-8', 'replace')
    values, errors = {}, []
    for key in keys:
        values[key], error = bundle_flag(text, key, BUNDLE_FUNCTIONS[key])
        if error: errors.append(error)
    return values, errors

def tracked(root, relative):
    """True/False for git-tracked, None outside a git work tree."""
    try:
        if subprocess.run(['git', 'rev-parse', '--is-inside-work-tree'], cwd=root, capture_output=True).returncode != 0:
            return None
        return subprocess.run(['git', 'ls-files', '--error-unmatch', relative], cwd=root, capture_output=True).returncode == 0
    except OSError:
        return None

def resolve_flag(root, project, key, env):
    """(effective value, sources) for one EXPO_PUBLIC_* key: every source that can reach the Release bundle, in precedence order."""
    sources, effective = [], env.get(key)
    sources.append({'source': f'process environment ({key})', 'values': [effective] if effective is not None else []})
    # Xcode: xcconfig values sit below the target's own build settings.
    for xc in (root / 'ios').glob('**/*.xcconfig'):
        if 'Pods' in xc.parts: continue
        values = [v.strip() for v in re.findall(rf'^\s*{key}\s*=\s*(.*)$', xc.read_text(), re.M)]
        sources.append({'source': str(xc.relative_to(root)), 'values': values, 'tracked': tracked(root, str(xc.relative_to(root)))})
        if values: effective = values[-1]
    settings = re.findall(rf'^\s*{key}\s*=\s*"?([^";\n]*)"?;\s*$', project, re.M)
    sources.append({'source': 'ios/HolobotsMobile.xcodeproj build settings', 'values': settings})
    if settings: effective = settings[-1]
    # Script phases that set it inline (shellScript bodies are escaped strings).
    inline = re.findall(rf'{key}=([^\\\s;"]*)', ' '.join(re.findall(r'shellScript = "((?:[^"\\]|\\.)*)";', project)))
    sources.append({'source': 'ios/HolobotsMobile.xcodeproj shellScript phases', 'values': inline})
    seen = set()
    for relative in XCODE_ENV_FILES:
        path = root / relative
        if not path.exists(): continue
        values = shell_assignments(path.read_text(), key)
        if relative not in seen:
            sources.append({'source': relative, 'values': values, 'tracked': tracked(root, relative)})
            seen.add(relative)
        if values: effective = values[-1]
    for relative in EXPO_ENV_FILES:
        path = root / relative
        if not path.exists(): continue
        values = re.findall(rf'^\s*(?:export\s+)?{key}\s*=\s*(.*)$', path.read_text(), re.M)
        values = [v.strip().strip('"\'') for v in values]
        sources.append({'source': f'{relative} (@expo/env, only if unset above)', 'values': values, 'tracked': tracked(root, relative)})
        if values and effective is None: effective = values[-1]
    return effective, sources

def inspect(root, expo_config=None, *, expect_lite=None, last_uploaded=None, released_versions=RELEASED_VERSIONS, bundle=None, environ=None):
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
    check(expo['version'] not in released_versions, f"Marketing version {expo['version']} is already released; its train is closed")
    if last_uploaded is not None:
        check(expo['ios']['buildNumber'].isdigit() and int(expo['ios']['buildNumber']) > last_uploaded, f"Build {expo['ios']['buildNumber']} is not greater than the last uploaded build {last_uploaded}")
    inventory['marketingVersion'] = expo['version']
    inventory['buildNumber'] = expo['ios']['buildNumber']
    inventory['lastUploadedBuild'] = last_uploaded
    inventory['bundleIdentifier'] = expo['ios']['bundleIdentifier']
    info = plist(root / 'ios/HolobotsMobile/Info.plist')
    check(info.get('CFBundleVersion') == '$(CURRENT_PROJECT_VERSION)', 'Info.plist does not use native build setting')
    for key in ['NSFaceIDUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSMotionUsageDescription']:
        check(bool(info.get(key)) and bool(expo['ios'].get('infoPlist', {}).get(key)), f'Missing usage description: {key}')
    # #53 removed HealthKit from the phone (Guideline 2.5.1); app.json must not bring it back on a prebuild.
    for key in ['NSHealthShareUsageDescription', 'NSHealthUpdateUsageDescription']:
        check(key not in info and key not in expo['ios'].get('infoPlist', {}), f'Phone declares HealthKit usage string: {key}')
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

    env = os.environ if environ is None else environ
    effective, sources = resolve_flag(root, project, GATE, env)
    inventory['liteGate'] = {'effective': effective, 'sources': sources}
    if expect_lite == 'on':
        check(effective == '1', f'Lite gate resolves to {effective!r}, expected "1"')
        for s in sources:
            check(all(v == '1' for v in s['values']), f"Lite gate source disagrees: {s['source']} sets {s['values']}")
        xcode_env = next((s for s in sources if s['source'] == 'ios/.xcode.env'), None)
        check(bool(xcode_env and xcode_env['values'] and xcode_env.get('tracked') is not False), 'Lite gate must come from the versioned ios/.xcode.env (D6)')
    elif expect_lite == 'off':
        check(effective != '1', 'Lite gate resolves ON in a build expected to be gate-off')
        for s in sources:
            check('1' not in s['values'], f"Lite gate source turns lite on: {s['source']}")
    # Client flags the release build turns on with the gate; same sources, same D6 rule.
    flags = {}
    for key in RELEASE_CLIENT_FLAGS:
        flag_effective, flag_sources = resolve_flag(root, project, key, env)
        flags[key] = {'effective': flag_effective, 'sources': flag_sources}
        if expect_lite == 'on':
            check(flag_effective == '1', f'Client flag {key} resolves to {flag_effective!r}, expected "1"')
            for s in flag_sources:
                check(all(v == '1' for v in s['values']), f"Client flag {key} source disagrees: {s['source']} sets {s['values']}")
            xcode_env = next((s for s in flag_sources if s['source'] == 'ios/.xcode.env'), None)
            check(bool(xcode_env and xcode_env['values'] and xcode_env.get('tracked') is not False), f'Client flag {key} must come from the versioned ios/.xcode.env (D6)')
    inventory['clientFlags'] = flags
    if bundle is not None:
        keys = [GATE, *RELEASE_CLIENT_FLAGS] if expect_lite == 'on' else [GATE]
        values, errors = bundle_flags(Path(bundle), keys)
        value = values[GATE]
        inventory['bundleLiteGate'] = value
        inventory['bundleClientFlags'] = {k: v for k, v in values.items() if k != GATE}
        for error in errors: check(False, error)
        if value is not None and expect_lite is not None:
            check(value == ('1' if expect_lite == 'on' else '0'), f'Bundle isLiteEnabled() returns {value}, expected lite {expect_lite}')
        for key, v in inventory['bundleClientFlags'].items():
            if v is not None:
                check(v == '1', f'Bundle {BUNDLE_FUNCTIONS[key]}() returns {v}, expected client flag {key} on')

    # The lite renderer needs ExpoGL linked natively; a JS dependency alone is not enough.
    package = json.loads((root / 'package.json').read_text()) if (root / 'package.json').exists() else {}
    if 'expo-gl' in package.get('dependencies', {}):
        lock = (root / 'ios/Podfile.lock').read_text() if (root / 'ios/Podfile.lock').exists() else ''
        locked = bool(re.search(r'^  - ExpoGL \(', lock, re.M)) and bool(re.search(r'^  ExpoGL: [0-9a-f]+$', lock, re.M))
        inventory['expoGLLocked'] = locked
        check(locked, 'expo-gl is a dependency but ExpoGL is not in ios/Podfile.lock (run pod install)')

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
    p.add_argument('--expect-lite', choices=['on', 'off'], help='Assert the lite gate value from every source (and --bundle); on also asserts every RELEASE_CLIENT_FLAGS key ON')
    p.add_argument('--last-uploaded', type=int, help='Highest build number already in App Store Connect; the build must exceed it')
    p.add_argument('--released-version', action='append', help=f'Marketing version already released (default: {", ".join(RELEASED_VERSIONS)})')
    p.add_argument('--bundle', type=Path, help='JS bundle from `expo export:embed` to check isLiteEnabled() in')
    p.add_argument('--local-only', action='store_true', help='Exit success on local checks; uploadReady remains false')
    args = p.parse_args()
    report = inspect(args.mobile_root.resolve(), args.expo_config, expect_lite=args.expect_lite, last_uploaded=args.last_uploaded,
                     released_versions=tuple(args.released_version or RELEASED_VERSIONS), bundle=args.bundle)
    print(json.dumps(report, indent=2))
    raise SystemExit(1 if report['localFailures'] else 0 if args.local_only else 2)
