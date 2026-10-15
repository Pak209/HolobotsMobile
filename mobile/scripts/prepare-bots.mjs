/** Rebuild the pinned source fleet. See mobile/docs/bot-asset-pack.md. */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'mobile/tools/bot-assets/package.json'));
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { dedup, weld, simplify, resample, prune, textureCompress, meshopt } = require('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = require('meshoptimizer');
const sharp = require('sharp');
const validator = require('gltf-validator');
const { values } = parseArgs({ options: { 'source-dir': { type: 'string' }, 'output-dir': { type: 'string' } } });
if (!values['source-dir']) throw new Error('--source-dir must point to the pinned source clone');
const sourceDir = resolve(values['source-dir']);
const outputDir = resolve(values['output-dir'] ?? resolve(root, 'mobile/assets/bots'));
const pinned = JSON.parse(await readFile(resolve(root, 'mobile/tools/bot-assets/source-manifest.json'), 'utf8'));
await mkdir(outputDir, { recursive: true });
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const sourceCommit = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(sourceCommit, pinned.commit, 'Unexpected source commit');
const sourceManifestBytes = await readFile(resolve(sourceDir, 'manifest.json'));
assert.equal(createHash('sha256').update(sourceManifestBytes).digest('hex'), pinned.manifestSha256, 'Source manifest changed');
const sourceManifest = JSON.parse(sourceManifestBytes);
assert.deepEqual(Object.keys(sourceManifest.bots), Object.keys(pinned.bots));
const bots = {};
for (const [id, source] of Object.entries(sourceManifest.bots)) {
  const original = await readFile(resolve(sourceDir, source.file));
  assert.equal(createHash('sha256').update(original).digest('hex'), pinned.bots[id].sha256, `${id}: source bytes changed`);
  assert.equal(original.length, source.bytes);
  const document = await io.read(resolve(sourceDir, source.file));
  const expectedNames = source.clips.map(clip => clip.name).sort();
  assert.deepEqual(document.getRoot().listAnimations().map(clip => clip.getName()).sort(), expectedNames, `${id}: source manifest clips`);
  await document.transform(
    dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.25, error: 0.001, lockBorder: true }),
    resample({ tolerance: 0.0001 }), prune(),
    textureCompress({ encoder: sharp, resize: [1024, 1024], targetFormat: 'jpeg', quality: 85, slots: /^(baseColorTexture|emissiveTexture)$/ }),
    textureCompress({ encoder: sharp, resize: [512, 512], targetFormat: 'png', slots: /^(normalTexture|occlusionTexture|metallicRoughnessTexture)$/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  assert.deepEqual(document.getRoot().listAnimations().map(clip => clip.getName()).sort(), expectedNames, `${id}: transformed clips`);
  await io.write(resolve(outputDir, source.file), document);
  const bytes = await readFile(resolve(outputDir, source.file));
  const validation = await validator.validateBytes(new Uint8Array(bytes), { uri: source.file, maxIssues: 30 });
  if (validation.issues.numErrors) throw new Error(`${id}: ${JSON.stringify(validation.issues)}`);
  if (bytes.length > 2_000_000) throw new Error(`${id}: ${(bytes.length/1e6).toFixed(3)} MB exceeds 2 MB budget`);
  const triangles = document.getRoot().listMeshes().reduce((n, mesh) => n + mesh.listPrimitives().reduce((m,p) => m + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3,0),0);
  bots[id] = { file: source.file, bytes: bytes.length, originalBytes: original.length, heightM: source.heightM, triangles, idleClip: id === 'ace' ? 'FableHover' : id === 'wolf' ? 'HoverIdle' : 'Idle', clips: source.clips.map(({name, seconds, unityClip})=>({name,seconds,unityClip})), sha256: createHash('sha256').update(bytes).digest('hex'), validation: { errors: validation.issues.numErrors, warnings: validation.issues.numWarnings } };
  console.log(`${id.padEnd(6)} ${(original.length/1e6).toFixed(3)} -> ${(bytes.length/1e6).toFixed(3)} MB | ${triangles} triangles | ${bots[id].clips.length} clips`);
}
await writeFile(resolve(outputDir,'manifest.json'),JSON.stringify({ source: 'https://github.com/Pak209/holocity-promo-glb', compression: 'meshopt medium; 25% triangle target, max error 0.001; 1024px base/emissive JPEG85; 512px normal/ORM PNG', units: 'metres, Y-up', maxBotBytes: 2_000_000, bots, sourceCommit },null,2)+'\n');
await writeFile(resolve(outputDir,'index.ts'),`// Generated by mobile/scripts/prepare-bots.mjs. Metro requires static asset references.\nimport manifest from './manifest.json';\nexport const BOT_ASSETS = {\n${Object.keys(bots).map(id=>`  ${id}: require('./${id}.glb') as number,`).join('\n')}\n} as const;\nexport type BotId = keyof typeof BOT_ASSETS;\nexport const BOT_MANIFEST = manifest.bots;\nexport function resolveBotId(value: string): BotId | null {\n  const key = value.trim().toLowerCase().replace(/^holobot[_-]?/, '');\n  return Object.prototype.hasOwnProperty.call(BOT_ASSETS, key) ? key as BotId : null;\n}\n`);
console.log(`Total ${(Object.values(bots).reduce((n,b)=>n+b.bytes,0)/1e6).toFixed(3)} MB`);
