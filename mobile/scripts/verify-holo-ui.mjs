#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(mobile, 'assets/items');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
const partManifest = JSON.parse(await readFile(resolve(directory, 'part-holographic-manifest.json'), 'utf8'));
assert.equal(partManifest.packageVersion, 'parts-holographic-2');
const expectedPartIds = ['part.combatMask', 'part.voidMask', 'part.reinforcedChassis', 'part.alloyChassis',
  'part.boxerGloves', 'part.plasmaCannon', 'part.infernoClaws', 'part.energyCore', 'part.quantumCore'];
assert.deepEqual(Object.keys(partManifest.icons).sort(), expectedPartIds.sort());
const index = await readFile(resolve(directory, 'index.ts'), 'utf8');
const files = (await readdir(directory)).filter(name => name.endsWith('.png')).sort();
assert.deepEqual(files, manifest.icons.map(icon => icon.file).sort(), 'Source manifest and bundled PNGs differ');
assert.equal(files.length, manifest.actualCount);
assert.equal((index.match(/require\(/g) || []).length, files.length, 'Metro static require index is incomplete');
let total = 0;
for (const icon of manifest.icons) {
  const bytes = await readFile(resolve(directory, icon.file));
  assert.equal(bytes.length, icon.bytes, `Size changed: ${icon.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), icon.sha256, `Hash changed: ${icon.file}`);
  assert.ok(index.includes(`require("./${icon.file}")`), `Missing from index: ${icon.file}`);
  total += bytes.length;
}
for (const [id, spec] of Object.entries(partManifest.icons)) {
  const expected = spec.sha256_256;
  const itemBytes = await readFile(resolve(directory, `${id}.png`));
  assert.equal(createHash('sha256').update(itemBytes).digest('hex'), expected, `Lite Part drift: ${id}`);
}
const standardGameFiles = {
  'part.combatMask': 'HeadPartCombatMask.png',
  'part.voidMask': 'HeadPartVoidMask.png',
  'part.reinforcedChassis': 'TorsoPart.png',
  'part.alloyChassis': 'TorsoPartAlloy.png',
  'part.boxerGloves': 'ArmsPartBoxer.png',
  'part.plasmaCannon': 'ArmPartPlasmaCannon.png',
  'part.infernoClaws': 'ArmsPartInfernoClaws.png',
  'part.energyCore': 'CorePart.png',
  'part.quantumCore': 'CorePartQuantum.png',
};
for (const [id, file] of Object.entries(standardGameFiles)) {
  const bytes = await readFile(resolve(mobile, 'assets/game', file));
  const actual = createHash('sha256').update(bytes).digest('hex');
  assert.equal(actual, partManifest.icons[id].sha256_256, `Standard Mobile Part drift: ${id}`);
}
assert.equal(total, manifest.totalBytes);
const uniqueHashes = new Set(manifest.icons.map(icon => icon.sha256)).size;
console.log(`${files.length} indexed PNGs verified, ${uniqueHashes} distinct image hashes, ${total} bytes (${(total/1e6).toFixed(2)} MB).`);
console.log(`Source: ${manifest.sourceRepository} @ ${manifest.sourceCommit}`);
