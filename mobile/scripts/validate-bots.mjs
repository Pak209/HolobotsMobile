/** Verify bundled bytes independently against the pinned source inventory. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { DEFAULT_BOT_MAX_BYTES, HARE_STRICT_MAX_BYTES, botMaxBytes } from '../tools/bot-assets/hare-budget.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(process.env.BOT_TOOLS_PACKAGE ?? resolve(root, 'mobile/tools/bot-assets/package.json'));
const { MeshoptDecoder: WasmDecoder } = require('meshoptimizer');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const sharp = require('sharp');
const validator = require('gltf-validator');
const { MeshoptDecoder: NativeDecoder } = await import(pathToFileURL(resolve(dirname(require.resolve('meshoptimizer')), 'meshopt_decoder_reference.js')));
const { values } = parseArgs({ options: { directory: { type: 'string' }, report: { type: 'string' }, 'comparison-dir': { type: 'string' } } });
const directory = resolve(values.directory ?? resolve(root, 'mobile/assets/bots'));
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
const source = JSON.parse(await readFile(resolve(root, 'mobile/tools/bot-assets/source-manifest.json'), 'utf8'));
const fightSource = manifest.fightPort ? JSON.parse(await readFile(resolve(root, 'mobile/tools/bot-assets/fight-source-manifest.json'), 'utf8')) : null;
if(fightSource) assert.equal(manifest.fightPort.unityCommit, fightSource.unityCommit);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(manifest.sourceCommit, source.commit);
assert.deepEqual(Object.keys(manifest.bots).sort(), Object.keys(source.bots).sort());
assert.equal(Object.keys(manifest.bots).length, 12);
await WasmDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': NativeDecoder });
assert.equal(manifest.maxBotBytes, DEFAULT_BOT_MAX_BYTES);
assert.deepEqual(manifest.maxBotBytesByBot ?? {}, { hare: HARE_STRICT_MAX_BYTES });
const report = { sourceCommit: source.commit, maxBotBytes: DEFAULT_BOT_MAX_BYTES, maxBotBytesByBot: manifest.maxBotBytesByBot, maxTextureDimension: 1024, bots: [] };
for (const [id, entry] of Object.entries(manifest.bots)) {
  const expected = source.bots[id];
  const fight = fightSource?.bots[id];
  assert.deepEqual(entry.fightClips ?? [], fight?.clips ?? [], `${id}: additional take provenance`);
  assert.equal(entry.file, expected.file);
  assert.deepEqual(entry.clips, expected.clips, `${id}: manifest cannot redefine source takes`);
  const bytes = await readFile(resolve(directory, entry.file));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.length, entry.bytes);
  assert.ok(bytes.length <= botMaxBytes(id), `${id}: exceeds its approved bot-byte budget`);
  assert.equal(hash(bytes), entry.sha256);
  assert.equal(entry.originalBytes, expected.bytes);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const bin = bytes.subarray(28 + jsonLength);
  assert.ok(json.extensionsRequired?.includes('EXT_meshopt_compression'));
  let views = 0;
  for (const view of json.bufferViews ?? []) {
    const compressed = view.extensions?.EXT_meshopt_compression;
    if (!compressed) continue;
    const sourceBytes = new Uint8Array(bin.subarray(compressed.byteOffset ?? 0, (compressed.byteOffset ?? 0) + compressed.byteLength));
    const reference = new Uint8Array(compressed.count * compressed.byteStride);
    const wasm = new Uint8Array(reference.length);
    NativeDecoder.decodeGltfBuffer(reference, compressed.count, compressed.byteStride, sourceBytes, compressed.mode, compressed.filter);
    WasmDecoder.decodeGltfBuffer(wasm, compressed.count, compressed.byteStride, sourceBytes, compressed.mode, compressed.filter);
    assert.deepEqual(reference, wasm, `${id}: native and WASM decode mismatch`);
    views++;
  }
  assert.ok(views > 0);
  const document = await io.read(resolve(directory, entry.file));
  const animations = document.getRoot().listAnimations();
  const clips = animations.map(clip => clip.getName());
  assert.deepEqual([...clips].sort(), [...expected.clips,...(fight?.clips ?? [])].map(clip => clip.name).sort());
  assert.ok(clips.includes(entry.idleClip));
  assert.ok(document.getRoot().listSkins().length >= 1);
  for (const animation of animations) {
    assert.ok(animation.listChannels().length > 0, `${id}/${animation.getName()}: empty take`);
    let firstKeySeconds = Infinity, lastKeySeconds = -Infinity;
    for (const sampler of animation.listSamplers()) {
      for (const time of sampler.getInput().getArray()) {
        firstKeySeconds = Math.min(firstKeySeconds, time);
        lastKeySeconds = Math.max(lastKeySeconds, time);
      }
    }
    const fightClip = fight?.clips.find(clip => clip.name === animation.getName());
    const expectedTimeline = fightClip ? {firstKeySeconds:0,lastKeySeconds:fightClip.seconds} : expected.animationTimelines[animation.getName()];
    assert.ok(Math.abs(firstKeySeconds - expectedTimeline.firstKeySeconds) <= 0.00001, `${id}/${animation.getName()}: first key changed`);
    assert.ok(Math.abs(lastKeySeconds - expectedTimeline.lastKeySeconds) <= 0.00001, `${id}/${animation.getName()}: last key changed`);
    // The source manifest measures last-first, not the absolute final key time.
    const expectedDuration = (fightClip ?? expected.clips.find(clip => clip.name === animation.getName())).seconds;
    assert.ok(Math.abs(lastKeySeconds - firstKeySeconds - expectedDuration) <= 0.001, `${id}/${animation.getName()}: source clip span changed`);
  }
  if(fight) for(const mesh of document.getRoot().listMeshes()) for(const primitive of mesh.listPrimitives()){
    assert.ok(!primitive.getAttribute('WEIGHTS_1'), `${id}: extra influences`);
    const weights=primitive.getAttribute('WEIGHTS_0')?.getArray();
    if(weights)for(let i=0;i<weights.length;i+=4)assert.ok(Array.from(weights.slice(i,i+4)).filter(n=>n>1e-6).length<=2, `${id}: >2 skin influences`);
  }
  const textures = [];
  for (const texture of document.getRoot().listTextures()) {
    const size = await sharp(texture.getImage()).metadata();
    assert.ok(size.width > 0 && size.height > 0 && size.width <= 1024 && size.height <= 1024, `${id}: ${size.width}x${size.height}`);
    textures.push({ width: size.width, height: size.height, format: size.format });
  }
  const validation = await validator.validateBytes(new Uint8Array(bytes), { uri: entry.file, maxIssues: 100 });
  assert.equal(validation.issues.numErrors, 0, `${id}: ${JSON.stringify(validation.issues)}`);
  const row = { id, sourceBytes: expected.bytes, bytes: bytes.length, sha256: hash(bytes), clips, decodedBufferViews: views, textures, errors: validation.issues.numErrors, warnings: validation.issues.numWarnings };
  if (values['comparison-dir']) row.identicalToW6 = hash(await readFile(resolve(values['comparison-dir'], entry.file))) === row.sha256;
  report.bots.push(row);
  console.log(`${id}: ${row.bytes} bytes, ${clips.length} clips, ${views} JS/WASM-identical buffers, skin/textures/durations OK, ${row.errors} validation errors`);
}
report.totalBytes = report.bots.reduce((n,b)=>n+b.bytes,0);
report.sourceBytes = report.bots.reduce((n,b)=>n+b.sourceBytes,0);
report.totalClips = report.bots.reduce((n,b)=>n+b.clips.length,0);
report.totalDecodedBufferViews = report.bots.reduce((n,b)=>n+b.decodedBufferViews,0);
assert.equal(report.totalClips, 86 + (fightSource ? Object.values(fightSource.bots).reduce((n,b)=>n+b.clips.length,0) : 0));
if (values.report) await writeFile(resolve(values.report), JSON.stringify(report,null,2)+'\n');
console.log(`PASS: 12 bots, ${report.totalClips} clips, ${report.totalDecodedBufferViews} identical JS/WASM buffers, ${report.totalBytes} bytes total`);
