import 'fast-text-encoding';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { Image, Platform } from 'react-native';
import { fromByteArray, toByteArray } from 'base64-js';
import * as THREE from 'three';
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Hermes has no WebAssembly. This upstream JS decoder implements the same format.
import { MeshoptDecoder } from 'meshoptimizer/meshopt_decoder_reference.js';
import { BOT_ASSETS, BOT_MANIFEST, type BotId } from '../../../../assets/bots';
import { repairHareLocomotion } from './repairHareLocomotion';

const inFlightTextures = new Map<string, Promise<string>>();

async function nativeImageUri(parser: GLTFParser, sourceIndex: number, hash: string): Promise<string> {
  const source = parser.json.images[sourceIndex];
  if (source.bufferView === undefined) throw new Error('Bot texture must be embedded in its GLB.');
  const key = `${hash}-${sourceIndex}`;
  let pending = inFlightTextures.get(key);
  if (!pending) {
    pending = (async () => {
      if (!FileSystem.cacheDirectory) throw new Error('Texture cache is unavailable.');
      const directory = `${FileSystem.cacheDirectory}holobot-textures/`;
      const extension = source.mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const uri = `${directory}${key}.${extension}`;
      if ((await FileSystem.getInfoAsync(uri)).exists) return uri;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const bytes = new Uint8Array(await parser.getDependency('bufferView', source.bufferView));
      await FileSystem.writeAsStringAsync(uri, fromByteArray(bytes), { encoding: FileSystem.EncodingType.Base64 });
      return uri;
    })();
    inFlightTextures.set(key, pending);
    void pending.catch(() => inFlightTextures.delete(key));
  }
  return pending;
}

/** Bypass GLTFLoader's browser Blob/Image path on iOS/Android. */
function nativeTextures(parser: GLTFParser, hash: string) {
  return {
    name: 'HOLOBOTS_native_embedded_textures',
    async loadTexture(index: number) {
      const definition = parser.json.textures[index];
      const uri = await nativeImageUri(parser, definition.source, hash);
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
      const asset = Asset.fromURI(uri);
      asset.localUri = uri;
      asset.width = size.width;
      asset.height = size.height;
      const texture = new THREE.Texture();
      // Expo GL accepts the local asset in texImage2D's data argument.
      Object.assign(texture, { isDataTexture: true, image: { data: asset, ...size } });
      texture.flipY = false;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      const sampler = parser.json.samplers?.[definition.sampler];
      const wraps: Record<number, THREE.Wrapping> = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
      texture.wrapS = wraps[sampler?.wrapS] ?? THREE.RepeatWrapping;
      texture.wrapT = wraps[sampler?.wrapT] ?? THREE.RepeatWrapping;
      texture.needsUpdate = true;
      parser.associations.set(texture, { textures: index });
      return texture;
    },
  };
}

export async function loadBot(id: BotId, onPhase: (phase: string) => void = () => {}): Promise<GLTF> {
  onPhase('resolve asset');
  const asset = Asset.fromModule(BOT_ASSETS[id]);
  await asset.downloadAsync();
  onPhase('asset downloaded');
  const uri = asset.localUri ?? asset.uri;
  // Three's image-loader feature detection assumes a browser userAgent string.
  if (Platform.OS !== 'web' && typeof navigator !== 'undefined' && typeof navigator.userAgent !== 'string') {
    Object.defineProperty(navigator, 'userAgent', { value: 'ReactNative', configurable: true });
  }
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (Platform.OS === 'web') {
    const gltf = await loader.loadAsync(uri);
    gltf.animations = repairHareLocomotion(id, gltf.animations);
    return gltf;
  }
  loader.register(parser => nativeTextures(parser, BOT_MANIFEST[id].sha256));
  onPhase('read GLB');
  const data = toByteArray(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }));
  onPhase('parse GLB + textures');
  const gltf = await loader.parseAsync(data.buffer as ArrayBuffer, '');
  gltf.animations = repairHareLocomotion(id, gltf.animations);
  return gltf;
}

export function disposeBot(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
  });
  textures.forEach(texture => texture.dispose());
  skeletons.forEach(skeleton => skeleton.dispose());
}
