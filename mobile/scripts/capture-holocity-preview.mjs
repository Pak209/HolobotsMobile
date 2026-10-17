/** Capture the opt-in offline preview in a running iOS Simulator. No account is used. */
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const simulator = process.env.HOLOCITY_SIMULATOR ?? 'booted';
const output = resolve(root, 'Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots');
const screens = process.argv.slice(2);
if (!screens.length) throw new Error('Pass offline route names, for example CityDay CityNight Fitness.');
await mkdir(output, { recursive: true });
function simctl(...args) {
  const result = spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'simctl failed');
}
for (const screen of screens) {
  if (!/^[A-Za-z0-9-]+$/.test(screen)) throw new Error(`Invalid preview route ${screen}`);
  // Let an outgoing native Modal finish dismissing before presenting another one.
  // Back-to-back Modal routes otherwise race UIKit and can capture an empty root.
  if (screen !== 'Login') {
    simctl('openurl', simulator, 'holobotsmobile://qa/Login');
    await new Promise(resolve => setTimeout(resolve, 650));
  }
  simctl('openurl', simulator, `holobotsmobile://qa/${screen}`);
  await new Promise(resolve => setTimeout(resolve, Number(process.env.HOLOCITY_CAPTURE_WAIT_MS ?? 1800)));
  simctl('io', simulator, 'screenshot', resolve(output, `${screen}.png`));
  console.log(`${screen}.png`);
}
