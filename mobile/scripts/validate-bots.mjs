import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, '.work/asset-tools/package.json'));
const { MeshoptDecoder: WasmDecoder } = require('meshoptimizer');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const sharp = require('sharp');
const { MeshoptDecoder: NativeDecoder } = await import(pathToFileURL(resolve(root, 'mobile/node_modules/meshoptimizer/meshopt_decoder_reference.js')));
await WasmDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': NativeDecoder });
const directory = resolve(root, 'mobile/assets/bots');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
assert.equal(Object.keys(manifest.bots).length, 12);
let total = 0, totalViews = 0;
for (const [id, entry] of Object.entries(manifest.bots)) {
  const bytes = await readFile(resolve(directory, entry.file));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.length, entry.bytes); assert.ok(bytes.length <= 2_000_000);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const bin = bytes.subarray(28 + jsonLength);
  let views = 0;
  for (const view of json.bufferViews ?? []) {
    const compressed = view.extensions?.EXT_meshopt_compression;
    if (!compressed) continue;
    const source = new Uint8Array(bin.subarray(compressed.byteOffset ?? 0, (compressed.byteOffset ?? 0) + compressed.byteLength));
    const reference = new Uint8Array(compressed.count * compressed.byteStride);
    const wasm = new Uint8Array(reference.length);
    NativeDecoder.decodeGltfBuffer(reference, compressed.count, compressed.byteStride, source, compressed.mode, compressed.filter);
    WasmDecoder.decodeGltfBuffer(wasm, compressed.count, compressed.byteStride, source, compressed.mode, compressed.filter);
    assert.deepEqual(reference, wasm, `${id}: native and wasm decode mismatch`); views++;
  }
  assert.ok(views > 0);
  const document = await io.read(resolve(directory, entry.file));
  const clips = document.getRoot().listAnimations().map(clip => clip.getName());
  assert.deepEqual(clips.sort(), entry.clips.map(clip => clip.name).sort());
  assert.ok(clips.includes(entry.idleClip)); assert.ok(document.getRoot().listSkins().length >= 1);
  for (const texture of document.getRoot().listTextures()) {
    const size = await sharp(texture.getImage()).metadata();
    assert.ok(size.width <= 1024 && size.height <= 1024, `${id}: ${size.width}x${size.height}`);
  }
  total += bytes.length; totalViews += views;
  console.log(`${id}: ${(bytes.length / 1e6).toFixed(3)} MB, ${clips.length} clips, ${views} native-decoded buffers, skin+textures OK`);
}
console.log(`PASS: 12 bots, ${totalViews} identical pure-JS/WASM buffers, ${(total/1e6).toFixed(3)} MB total`);
