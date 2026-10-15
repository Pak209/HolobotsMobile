import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'meshoptimizer/meshopt_decoder_reference.js';
import { repairHareLocomotion } from '../bots/repairHareLocomotion';

let gltf: GLTF;
beforeAll(async () => {
  const data = await readFile(new URL('../../../assets/bots/hare.glb', import.meta.url));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Pose checks need the actual mesh/skeleton/animation, without decoding image pixels in Node.
  loader.register(() => ({ name: 'test_no_textures', loadTexture: async () => new THREE.Texture() }));
  gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
});
function headOffset(clip: THREE.AnimationClip) {
  const scene = clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(clip).play(); mixer.update(0.12); scene.updateMatrixWorld(true);
  const head = scene.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3());
  const hips = scene.getObjectByName('Hips')!.getWorldPosition(new THREE.Vector3());
  mixer.stopAllAction(); mixer.uncacheRoot(scene);
  return head.sub(hips);
}
describe('documented HARE locomotion axis repair', () => {
  it('makes the actual bundled Idle/Walk/Run upright with the Unity +90° X premultiply', () => {
    const repaired = repairHareLocomotion('hare', gltf.animations);
    for (const name of ['Idle', 'Walk', 'Run']) {
      const before = headOffset(gltf.animations.find(clip => clip.name === name)!);
      const after = headOffset(repaired.find(clip => clip.name === name)!);
      expect(Math.abs(before.y)).toBeLessThan(0.03); expect(before.z).toBeLessThan(-0.38);
      expect(after.y).toBeGreaterThan(0.38); expect(Math.abs(after.z)).toBeLessThan(0.03);
    }
  });
  it('does not mutate source tracks, attack takes, other bots, or already-corrected locomotion', () => {
    const before = gltf.animations.map(clip => THREE.AnimationClip.toJSON(clip));
    const repaired = repairHareLocomotion('hare', gltf.animations);
    for (const source of gltf.animations) {
      const output = repaired.find(clip => clip.name === source.name)!;
      if (!['Idle', 'Walk', 'Run'].includes(source.name)) expect(output).toBe(source);
      else expect(output.tracks.filter(track => track.name !== 'Hips.quaternion').map(track => Array.from(track.values))).toEqual(source.tracks.filter(track => track.name !== 'Hips.quaternion').map(track => Array.from(track.values)));
    }
    expect(gltf.animations.map(clip => THREE.AnimationClip.toJSON(clip))).toEqual(before);
    expect(repairHareLocomotion('wolf', gltf.animations)).toEqual(gltf.animations);
    const twice = repairHareLocomotion('hare', repaired);
    twice.forEach((clip, index) => expect(clip).toBe(repaired[index]));
    expect(headOffset(repaired.find(clip => clip.name === 'SnapKick')!).y).toBeGreaterThan(0.4);
  });
});
