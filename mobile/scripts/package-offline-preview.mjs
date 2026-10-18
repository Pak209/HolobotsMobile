/** Embed the gated HoloCity lite offline preview (JS AND assets) in an already-built simulator .app. Never deploys. */
import { spawnSync } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clone = await realpath(resolve(mobile, '..'));
const app = await realpath(resolve(process.argv[2] ?? resolve(clone, '.work/DerivedData/Build/Products/Debug-iphonesimulator/HolobotsMobile.app')));
const location = relative(clone, app);
if (location.startsWith('..') || isAbsolute(location) || !app.endsWith('.app')) throw new Error('Use a built simulator .app inside this clone.');
const info = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :DTPlatformName', resolve(app, 'Info.plist')], { encoding: 'utf8' });
if (info.status !== 0 || info.stdout.trim() !== 'iphonesimulator') throw new Error('Only iOS simulator bundles are supported.');
const result = spawnSync(process.execPath, [resolve(mobile, 'node_modules/expo/bin/cli'), 'export:embed',
  '--entry-file', 'index.js', '--platform', 'ios', '--dev', 'true', '--minify', 'false',
  '--bundle-output', resolve(app, 'main.jsbundle'), '--assets-dest', app,
], { cwd: mobile, stdio: 'inherit', env: { ...process.env, EXPO_PUBLIC_HOLOCITY_LITE: '1', EXPO_PUBLIC_HOLOCITY_PREVIEW: '1', EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1' } });
if (result.status !== 0) process.exit(result.status ?? 1);
// These were missing when a dev bundle was run without its asset server.
for (const asset of ['main.jsbundle', 'assets/assets/figma/home/syncIcon.png', 'assets/assets/battle/holocity-park.jpg']) await access(resolve(app, asset));
console.log(`Offline preview packaged in ${app}. Install on a simulator; no Metro server is required. The native AppDelegate must prefer main.jsbundle when present.`);
