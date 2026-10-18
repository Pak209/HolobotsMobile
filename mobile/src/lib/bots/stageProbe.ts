import * as THREE from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';

/** Dev-only GL feature probe. Every value is read from the live context; nothing is inferred. */
export function probeGl(gl: ExpoWebGLRenderingContext, renderer: THREE.WebGLRenderer, requestedMsaaSamples: number) {
  const read = (pname: number): unknown => { try { return gl.getParameter(pname); } catch (cause) { return `error: ${String(cause)}`; } };
  // GL_SAMPLES describes the bound draw framebuffer; null maps to Expo's default (its MSAA framebuffer).
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const caps = renderer.capabilities;
  return {
    renderer: read(gl.RENDERER), vendor: read(gl.VENDOR), version: read(gl.VERSION), glsl: read(gl.SHADING_LANGUAGE_VERSION),
    requestedMsaaSamples, defaultFramebufferSamples: read(gl.SAMPLES), defaultFramebufferSampleBuffers: read(gl.SAMPLE_BUFFERS), maxSamples: read(gl.MAX_SAMPLES),
    maxTextureSize: read(gl.MAX_TEXTURE_SIZE), maxVertexTextureImageUnits: read(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    contextAttributes: gl.getContextAttributes(),
    extensions: gl.getSupportedExtensions(),
    three: { revision: THREE.REVISION, isWebGL2: caps.isWebGL2, precision: caps.precision, vertexTextures: caps.vertexTextures, maxVertexTextures: caps.maxVertexTextures, maxSamples: caps.maxSamples, shadowMapEnabled: renderer.shadowMap.enabled, toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace, pixelRatio: renderer.getPixelRatio() },
  };
}

const textureSize = (texture: THREE.Texture | null | undefined): string | null => {
  if (!texture) return null;
  const image = texture.image as { width?: number; height?: number } | undefined;
  return `${image?.width ?? '?'}x${image?.height ?? '?'}`;
};

/** Dev-only per-context inventory of what one rendered frame contains. */
export function stageInventory(scene: THREE.Scene, renderer: THREE.WebGLRenderer, mixers: readonly { side: string; mixer: THREE.AnimationMixer; clips: number }[]) {
  const meshes: unknown[] = [];
  let lights = 0, shadowCasters = 0;
  scene.traverse(object => {
    if ((object as THREE.Light).isLight) { lights++; if (object.castShadow) shadowCasters++; }
    if (!(object instanceof THREE.Mesh)) return;
    let visible = object.visible;
    object.traverseAncestors(ancestor => { if (!ancestor.visible) visible = false; });
    const geometry = object.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position');
    const skinned = object instanceof THREE.SkinnedMesh;
    const materials = (Array.isArray(object.material) ? object.material : [object.material]) as THREE.Material[];
    meshes.push({
      name: object.name || object.type, visible, skinned, vertices: position?.count ?? 0,
      triangles: (geometry.index ? geometry.index.count : position?.count ?? 0) / 3,
      bones: skinned ? object.skeleton.bones.length : 0, boneTexture: skinned ? textureSize(object.skeleton.boneTexture) : null,
      materials: materials.map(material => ({ type: material.type, side: material.side === THREE.DoubleSide ? 'double' : material.side === THREE.BackSide ? 'back' : 'front', transparent: material.transparent, map: textureSize((material as THREE.MeshLambertMaterial).map), emissiveMap: textureSize((material as THREE.MeshLambertMaterial).emissiveMap) })),
    });
  });
  return {
    meshes, lights, shadowCasters, programs: renderer.info.programs?.length ?? null, memory: { ...renderer.info.memory },
    mixers: mixers.map(({ side, mixer, clips }) => ({ side, clips, tracksPerAction: (mixer as unknown as { _actions: THREE.AnimationAction[] })._actions?.filter(action => action.isRunning()).map(action => action.getClip().tracks.length) ?? null })),
  };
}
