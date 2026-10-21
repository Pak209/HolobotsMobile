import { Asset } from 'expo-asset';
import { Image, Platform } from 'react-native';
import * as THREE from 'three';
import { VFX_PACK, VFX_TEXTURE_ASSETS, type VfxTextureName } from '../../../assets/vfx';
import { flashAlphaAfter, hermite, hexRgb, linearAt, makeRandom, type FlashPulse } from './vfxCurves';

/**
 * lite-vfx-port-1 (DECISIONS #72.57): the HoloCity combat-VFX layers on the lite's three.js stage, played from the pack
 * HolobotsUnity's Tools/VFX/pack/export_pack.py writes (the same fxkit JSON Unity's FxKitBuilderRedo builds its prefabs
 * from). Presentation only: it reads a cue the caller derived from a battle action the engine / store already resolved.
 *
 * Draw model: one InstancedBufferGeometry quad batch per (texture, blend) pair, a fixed pool of VFX_MAX_LIVE particle slots
 * (struct of typed arrays, scheduled spawns included), debris as one InstancedMesh of cubes, and the CombatScreenFlash card
 * as one full-screen quad. Nothing is allocated per frame: update() only writes into preallocated arrays.
 */
export const VFX_MAX_LIVE = 200;
export type VfxAnchors = { feet: THREE.Vector3; chest: THREE.Vector3; hand: THREE.Vector3; facing: THREE.Vector3; height: number };
export type VfxPhase = 'windup' | 'landing';
export type VfxCue = {
  /** Lowercase holobot id of the kit to play (the attacker's). */
  kit: string;
  /** A kit effect (break_heavy | sky_launch | impactAccent | intercept) or 'guard' (the shared guard impact at the target). */
  effect: string;
  caster: VfxAnchors;
  target: VfxAnchors;
  /** Seconds from now to the contact (the landing phase). */
  impactS: number;
  phases: readonly VfxPhase[];
  flash: 'sky' | 'break' | null;
};
export type VfxStats = { live: number; peakLive: number; dropped: number; fired: number };

type Manifest = typeof VFX_PACK;
type PackLayer = { type: string; at: string; anchor?: string | null; delay?: number; lite: string; spec: Record<string, any>; params?: Record<string, any> };
type Kit = { tint: string; coreTint?: string; bodyHeight: number; effectiveHeightFloor: number; unityRedoBuilt: boolean; effects: Record<string, { layers: PackLayer[] }> };

const MODE_BILLBOARD = 0, MODE_GROUND = 1, MODE_VERTICAL = 2;
const BLEND_ADD = 0, BLEND_ALPHA = 1;
const CUBE_BATCH = -1;
const GRAVITY = 9.81;

const VERTEX = `
attribute vec4 aPos; attribute vec4 aShape; attribute vec4 aColor;
uniform vec3 uRight; uniform vec3 uUp;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec2 p = position.xy * aShape.xy;
  float c = cos(aPos.w), s = sin(aPos.w);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec3 w;
  if (aShape.z < 0.5) w = aPos.xyz + uRight * p.x + uUp * p.y;
  else if (aShape.z < 1.5) w = aPos.xyz + vec3(p.x, 0.0, -p.y);
  else w = aPos.xyz + normalize(vec3(uRight.x, 0.0, uRight.z)) * p.x + vec3(0.0, p.y, 0.0);
  vUv = uv; vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FRAGMENT = `
uniform sampler2D uMap; uniform float uFlip;
varying vec2 vUv; varying vec4 vColor;
void main() {
  float m = texture2D(uMap, vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlip))).a * vColor.a;
#ifdef VFX_ADDITIVE
  gl_FragColor = vec4(vColor.rgb * m, 0.0);
#else
  gl_FragColor = vec4(vColor.rgb, m);
#endif
}`;

// Curve tables: [t, v, ...] linear (FxKitBuilderRedo's Keys / alpha gradients). "N" = over normalised life, "S" = seconds.
const T = (...v: number[]) => new Float32Array(v);
const FLASH_ALPHA_N = T(0, 0, 0.033 / 0.7, 1, 0.067 / 0.7, 1, 0.10 / 0.7, 0.85, 0.167 / 0.7, 0.62, 0.333 / 0.7, 0.28, 0.5 / 0.7, 0.12, 1, 0);
const FLASH_SIZE_N = T(0, 0.6, 0.07, 1, 1, 1.15);
const GROUND_ALPHA_S = T(0, 0, 0.033, 0.9, 0.2, 0.7, 0.6, 0);
const GROUND_SIZE_N = T(0, 0.7, 0.1, 1, 1, 1.1);
const DEBRIS_SIZE_N = T(0, 1, 0.85, 1, 1, 0);
const DUST_ALPHA_N = T(0, 0, 0.1, 0.6, 0.5, 0.4, 1, 0);
const DUST_SIZE_N = T(0, 1 / 2.2, 1, 1);
const RESIDUE_ALPHA_N = T(0, 0, 0.08, 0.9, 0.6, 0.7, 1, 0);
const MOTE_ALPHA_N = T(0, 0, 0.1, 1, 0.7, 0.6, 1, 0);
const CHARGE_ALPHA_N = T(0, 0, 0.6, 0.8, 1, 0);
const CHARGE_SIZE_N = T(0, 0.5, 1, 1);
const CHARGE_MOTE_ALPHA_N = T(0, 0, 0.2, 1, 0.85, 1, 1, 0);
const HEAD_ALPHA_N = T(0, 0, 0.2, 1, 1, 1);
const FLAT = T(0, 1, 1, 1);

/** One interleaved instance buffer per batch (aPos | aShape | aColor, 12 floats): one upload per batch per frame. */
type Batch = { texture: VfxTextureName; blend: number; mesh: THREE.Mesh; geometry: THREE.InstancedBufferGeometry; buffer: THREE.InstancedInterleavedBuffer; data: Float32Array; count: number };
const STRIDE = 12;

async function loadTexture(name: VfxTextureName): Promise<{ texture: THREE.Texture; flip: number }> {
  const asset = Asset.fromModule(VFX_TEXTURE_ASSETS[name]);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (Platform.OS === 'web') {
    const texture = await new THREE.TextureLoader().loadAsync(uri);
    texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    return { texture, flip: 0 };
  }
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
  asset.localUri = uri; asset.width = size.width; asset.height = size.height;
  const texture = new THREE.Texture();
  // Expo GL takes the local asset in texImage2D's data argument (the GLB texture path in lib/bots/loadBot.ts).
  Object.assign(texture, { isDataTexture: true, image: { data: asset, ...size } });
  texture.flipY = false; texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  // flipY false: texel row 0 is the image's top row, so the quad samples v' = 1 - v (the masks are authored v-up).
  return { texture, flip: 1 };
}

/** The textures every playable layer of the pack uses. */
export function packTextures(): VfxTextureName[] { return Object.keys(VFX_TEXTURE_ASSETS) as VfxTextureName[]; }

export class VfxPlayer {
  readonly stats: VfxStats = { live: 0, peakLive: 0, dropped: 0, fired: 0 };
  private readonly root = new THREE.Group();
  private readonly batches: Batch[] = [];
  private readonly batchIndex = new Map<string, number>();
  private cubes: THREE.InstancedMesh | null = null;
  private flashMesh: THREE.Mesh | null = null;
  private flashUniforms = { uAlpha: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) } };
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();
  private readonly camAway = new THREE.Vector3();
  private readonly random = makeRandom(0x5eed);
  private frame = 0;
  private warm = 2;
  private lastNow = -1;
  private flashPulse: FlashPulse | null = null;
  private flashFireFrame = -1000;
  private flashAt = Infinity;
  private flashQueued: FlashPulse | null = null;
  private lastFlashS = -Infinity;
  private reduceFlashing = false;
  private disposed = false;
  // Particle slots (struct of arrays). born / life in seconds on the caller's clock.
  private readonly free = new Int16Array(VFX_MAX_LIVE);
  private freeTop = 0;
  private readonly active = new Uint8Array(VFX_MAX_LIVE);
  private readonly batchOf = new Int16Array(VFX_MAX_LIVE);
  private readonly born = new Float64Array(VFX_MAX_LIVE);
  private readonly life = new Float32Array(VFX_MAX_LIVE);
  private readonly p = new Float32Array(VFX_MAX_LIVE * 3);
  private readonly v = new Float32Array(VFX_MAX_LIVE * 3);
  private readonly gravity = new Float32Array(VFX_MAX_LIVE);
  private readonly limit = new Float32Array(VFX_MAX_LIVE);
  private readonly size = new Float32Array(VFX_MAX_LIVE * 2);
  private readonly rgb = new Float32Array(VFX_MAX_LIVE * 3);
  private readonly rgb2 = new Float32Array(VFX_MAX_LIVE * 3);
  private readonly alphaMul = new Float32Array(VFX_MAX_LIVE);
  private readonly rot = new Float32Array(VFX_MAX_LIVE * 3);
  private readonly rotVel = new Float32Array(VFX_MAX_LIVE * 3);
  private readonly mode = new Uint8Array(VFX_MAX_LIVE);
  private readonly alphaCurve: (Float32Array | null)[] = new Array(VFX_MAX_LIVE).fill(null);
  private readonly alphaSeconds = new Uint8Array(VFX_MAX_LIVE);
  private readonly sizeCurve: (Float32Array | null)[] = new Array(VFX_MAX_LIVE).fill(null);
  /** Element sprites: Hermite scale / dissolve keys, punch (linear seconds), glow fade share; null = an energy particle. */
  private readonly elScale: (number[][] | null)[] = new Array(VFX_MAX_LIVE).fill(null);
  private readonly elDissolve: (number[][] | null)[] = new Array(VFX_MAX_LIVE).fill(null);
  private readonly elPunch: (Float32Array | null)[] = new Array(VFX_MAX_LIVE).fill(null);
  private readonly elFade = new Float32Array(VFX_MAX_LIVE);

  private constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.Camera, private readonly allowUnbuilt: boolean) {
    for (let i = 0; i < VFX_MAX_LIVE; i++) this.free[this.freeTop++] = VFX_MAX_LIVE - 1 - i;
    this.root.name = 'HolobotVfx';
    scene.add(this.root);
  }

  /** Loads the pack's textures and builds the batches (the GL programs compile on the next two rendered frames). */
  static async create(scene: THREE.Scene, camera: THREE.Camera, options: { allowUnbuilt?: boolean } = {}): Promise<VfxPlayer> {
    const player = new VfxPlayer(scene, camera, !!options.allowUnbuilt);
    const loaded = await Promise.all(packTextures().map(async name => [name, await loadTexture(name)] as const));
    for (const [name, { texture, flip }] of loaded) {
      for (const blend of [BLEND_ADD, BLEND_ALPHA]) player.addBatch(name, blend, texture, flip);
    }
    player.addCubes();
    player.addFlash();
    return player;
  }

  /** Kits the player will play: Unity-built redo kits (+ the rest in dev QA when allowUnbuilt). */
  hasKit(kit: string): boolean {
    const k = (VFX_PACK as Manifest).kits[kit as keyof Manifest['kits']] as unknown as Kit | undefined;
    return !!k && (k.unityRedoBuilt || (__DEV__ && this.allowUnbuilt));
  }

  setReduceFlashing(value: boolean) { this.reduceFlashing = value; }

  private addBatch(name: VfxTextureName, blend: number, map: THREE.Texture, flip: number) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index; geometry.setAttribute('position', plane.getAttribute('position')); geometry.setAttribute('uv', plane.getAttribute('uv'));
    const data = new Float32Array(VFX_MAX_LIVE * STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPos', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aShape', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.setAttribute('aColor', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      defines: blend === BLEND_ADD ? { VFX_ADDITIVE: 1 } : {},
      uniforms: { uMap: { value: map }, uFlip: { value: flip }, uRight: { value: this.right }, uUp: { value: this.up } },
      // Additive light over the transparent backdrop: colour ONE + ONE, destination alpha kept (the compositor adds it over the park plate).
      ...(blend === BLEND_ADD ? { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } : { blending: THREE.NormalBlending }),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; mesh.renderOrder = blend === BLEND_ADD ? 20 : 10;
    this.root.add(mesh);
    this.batchIndex.set(name + ':' + blend, this.batches.length);
    this.batches.push({ texture: name, blend, mesh, geometry, buffer, data, count: 0 });
  }

  private addCubes() {
    const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), 64);
    cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cubes.setColorAt(0, this.tmpC.set('#ffffff'));
    cubes.count = 0; cubes.frustumCulled = false; cubes.renderOrder = 5;
    this.cubes = cubes; this.root.add(cubes);
  }

  private addFlash() {
    const material = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform float uAlpha; uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, uAlpha); }',
      uniforms: this.flashUniforms, transparent: true, depthTest: false, depthWrite: false, blending: THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false; mesh.renderOrder = 1000;
    this.flashMesh = mesh; this.root.add(mesh);
  }

  // ---- spawning ----------------------------------------------------------------------------------------------------

  private slot(batch: number, bornS: number, life: number): number {
    if (this.freeTop === 0) { this.stats.dropped++; return -1; }
    const i = this.free[--this.freeTop];
    this.active[i] = 1; this.batchOf[i] = batch; this.born[i] = bornS; this.life[i] = Math.max(0.02, life);
    this.p[i * 3] = this.p[i * 3 + 1] = this.p[i * 3 + 2] = 0; this.v[i * 3] = this.v[i * 3 + 1] = this.v[i * 3 + 2] = 0;
    this.gravity[i] = 0; this.limit[i] = 0; this.alphaMul[i] = 1; this.mode[i] = MODE_BILLBOARD;
    this.rot[i * 3] = this.rot[i * 3 + 1] = this.rot[i * 3 + 2] = 0; this.rotVel[i * 3] = this.rotVel[i * 3 + 1] = this.rotVel[i * 3 + 2] = 0;
    this.alphaCurve[i] = FLAT; this.alphaSeconds[i] = 0; this.sizeCurve[i] = FLAT;
    this.elScale[i] = null; this.elDissolve[i] = null; this.elPunch[i] = null; this.elFade[i] = 0.6;
    this.rgb2[i * 3] = -1;
    const live = VFX_MAX_LIVE - this.freeTop;
    if (live > this.stats.peakLive) this.stats.peakLive = live;
    return i;
  }

  private batch(name: VfxTextureName, blend: number) { return this.batchIndex.get(name + ':' + blend) ?? -2; }

  private sprite(name: VfxTextureName, blend: number, bornS: number, life: number, at: THREE.Vector3, sx: number, sy: number, rgb: readonly number[], gain: number, alpha: Float32Array, sizeCurve: Float32Array, mode = MODE_BILLBOARD): number {
    const b = this.batch(name, blend);
    if (b < 0) return -1;
    const i = this.slot(b, bornS, life);
    if (i < 0) return -1;
    this.p[i * 3] = at.x; this.p[i * 3 + 1] = at.y; this.p[i * 3 + 2] = at.z;
    this.size[i * 2] = sx; this.size[i * 2 + 1] = sy;
    this.rgb[i * 3] = rgb[0] * gain; this.rgb[i * 3 + 1] = rgb[1] * gain; this.rgb[i * 3 + 2] = rgb[2] * gain;
    this.alphaCurve[i] = alpha; this.sizeCurve[i] = sizeCurve; this.mode[i] = mode;
    return i;
  }

  private rand(a: number, b: number) { return a + (b - a) * this.random(); }

  /** Plays a cue. Presentation only; returns false when the kit / effect is not in the pack (or not Unity-built). */
  fire(cue: VfxCue, nowS: number): boolean {
    if (this.disposed) return false;
    const impact = nowS + Math.max(0, cue.impactS);
    if (cue.effect === 'guard') { this.guardImpact(cue.target, impact); this.stats.fired++; return true; }
    // A kit Unity has not built yet plays nothing, its screen pulse included (Unity: the flash card is a redo-kit layer).
    if (!this.hasKit(cue.kit)) return false;
    const kit = (VFX_PACK as Manifest).kits[cue.kit as keyof Manifest['kits']] as unknown as Kit;
    const effect = kit.effects[cue.effect];
    if (!effect) return false;
    if (cue.flash) this.queueFlash(cue.flash, impact);
    const s = cue.target.height / Math.max(0.1, kit.bodyHeight);
    const H = kit.bodyHeight * s, He = Math.max(kit.bodyHeight, kit.effectiveHeightFloor || 0) * s;
    for (const layer of effect.layers) {
      if (layer.lite !== 'play') continue;
      const phase: VfxPhase = layer.at === 'landing' ? 'landing' : 'windup';
      if (!cue.phases.includes(phase)) continue;
      const t0 = (phase === 'landing' ? impact : nowS) + (layer.delay ?? 0);
      if (layer.type === 'element') this.element(layer, kit, cue, phase, t0, s);
      else this.energy(layer, kit, cue, phase, t0, s, H, He);
    }
    this.stats.fired++;
    return true;
  }

  private anchorOf(name: string | null | undefined, cue: VfxCue, phase: VfxPhase, out: THREE.Vector3): THREE.Vector3 {
    const who = phase === 'windup' ? cue.caster : cue.target;
    switch (name) {
      case 'chest': return out.copy(who.chest);
      case 'right_hand': case 'left_hand':
        // At the contact the fist is at the struck body: the target's chest, a fifth of a body toward the caster.
        return phase === 'windup' ? out.copy(cue.caster.hand) : out.copy(cue.target.chest).addScaledVector(cue.target.facing, 0.2 * cue.target.height);
      case 'feet': return out.copy(who.feet);
      default: return out.copy(cue.target.feet);   // landing_point / unset: the contact on the floor
    }
  }

  private element(layer: PackLayer, kit: Kit, cue: VfxCue, phase: VfxPhase, t0: number, s: number) {
    const e = layer.spec;
    const at = this.anchorOf(layer.anchor ?? e.anchor, cue, phase, this.tmpP);
    const ground = !!e.ground;
    if (ground) at.y = cue.target.feet.y + 0.01;
    const mode = ground ? MODE_GROUND : e.elementFaceCamera ? MODE_BILLBOARD : Array.isArray(e.elementEuler) && Math.abs(e.elementEuler[0]) > 45 ? MODE_VERTICAL : MODE_GROUND;
    const base = (typeof e.elementSize === 'number' ? e.elementSize : typeof e.matchRadius === 'number' ? e.matchRadius * 2 : 1) * s;
    const count = Math.max(1, Math.min(8, e.count ?? 1));
    const scales: number[] = Array.isArray(e.instanceScales) ? e.instanceScales : [];
    const tint = hexRgb(e.elementTint ?? kit.tint), core = hexRgb(kit.coreTint ?? '#FFFFFF');
    const emission = e.emission ?? 1, coreI = e.coreIntensity ?? 0.5, haloI = e.haloIntensity ?? 1;
    const coreRgb = [tint[0] * emission * 0.8 + core[0] * coreI * 0.6, tint[1] * emission * 0.8 + core[1] * coreI * 0.6, tint[2] * emission * 0.8 + core[2] * coreI * 0.6];
    const scaleKeys = this.curveKeys('scale', e.elementScaleCurve ?? 'hold'), dissolveKeys = this.curveKeys('dissolve', e.elementDissolveCurve ?? 'late');
    const punch = Array.isArray(e.punch) ? T(...(e.punch as number[][]).flat()) : null;
    const life = e.elementLife ?? 0.9;
    for (let n = 0; n < count; n++) {
      const k = (scales[n] ?? 1) * base * 1.35, born = t0 + n * (e.stagger ?? 0), rot = count > 1 && e.fanDegrees ? (n - (count - 1) / 2) * e.fanDegrees * Math.PI / 180 : 0;
      for (const [tex, rgb, fade] of [['RingCore', coreRgb, 0.6], ['RingHalo', tint.map(c => c * haloI * 0.55), 0.85]] as const) {
        const i = this.sprite(tex, BLEND_ADD, born, life, at, k, k, rgb, 1, FLAT, FLAT, mode);
        if (i < 0) continue;
        this.rot[i * 3] = rot; this.elScale[i] = scaleKeys; this.elDissolve[i] = dissolveKeys; this.elPunch[i] = punch; this.elFade[i] = fade;
      }
    }
  }

  private curveKeys(kind: 'scale' | 'dissolve', value: unknown): number[][] {
    const presets = (VFX_PACK as Manifest).curves[kind] as Record<string, number[][]>;
    if (typeof value === 'string') return presets[value] ?? presets[kind === 'scale' ? 'hold' : 'late'];
    if (Array.isArray(value)) return (value as number[][]).map(k => k.length === 4 ? k : [k[0], k[1], 0, 0]);
    return presets[kind === 'scale' ? 'hold' : 'late'];
  }

  private energy(layer: PackLayer, kit: Kit, cue: VfxCue, phase: VfxPhase, t0: number, s: number, H: number, He: number) {
    const q = layer.params ?? {};
    const P = this.tmpP;
    const target = cue.target;
    const floorY = target.feet.y;
    switch (layer.type) {
      case 'flash': {
        const life = q.life ?? 0.7, size = q.sizeH * He;
        this.anchorOf(q.atChest ? 'chest' : 'landing_point', cue, 'landing', P);
        if (!q.atChest) P.y += 0.5 * He;
        const gain = this.reduceFlashing ? 0.5 : 1;
        this.sprite('FlashCore', BLEND_ADD, t0, life, P, size * 0.62, size * 0.62, [1, 1, 1], q.intensity * gain, FLASH_ALPHA_N, FLASH_SIZE_N);
        this.sprite('SoftGauss35', BLEND_ADD, t0, life, P, size, size, hexRgb(q.fringe), gain, FLASH_ALPHA_N, FLASH_SIZE_N);
        if (q.streak > 0) this.sprite('SoftGauss35', BLEND_ADD, t0, life, P, 3 * He, 0.08 * He * (1 + q.streak), [1, 1, 1], q.intensity * 0.5 * gain, FLASH_ALPHA_N, FLASH_SIZE_N);
        return;
      }
      case 'groundLight': {
        const c = hexRgb(q.color);
        P.copy(target.feet); P.y = floorY + 0.005;
        const i = this.sprite('SoftGauss32', BLEND_ADD, t0, q.life, P, q.sizeH * He, q.sizeH * He, [c[0] + (1 - c[0]) * 0.4, c[1] + (1 - c[1]) * 0.4, c[2] + (1 - c[2]) * 0.4], q.intensity, GROUND_ALPHA_S, GROUND_SIZE_N, MODE_GROUND);
        if (i >= 0) this.alphaSeconds[i] = 1;
        return;
      }
      case 'debris': {
        this.anchorOf(q.atChest ? 'chest' : 'landing_point', cue, 'landing', P);
        const a = hexRgb(q.color), b = hexRgb(q.edge);
        const cam = this.camera.matrixWorld.elements;
        this.camAway.set(cam[12] - P.x, 0, cam[14] - P.z);
        if (this.camAway.lengthSq() > 1e-6) this.camAway.normalize();
        for (let n = 0; n < q.count; n++) {
          const i = this.slot(CUBE_BATCH, t0 + 0.03, this.rand(q.life[0], q.life[1]));
          if (i < 0) break;
          const ang = this.random() * Math.PI * 2, cone = this.random() * 55 * Math.PI / 180, r = this.random() * 0.3 * H, speed = this.rand(q.speed[0], q.speed[1]) * s;
          this.p[i * 3] = P.x + Math.cos(ang) * r; this.p[i * 3 + 1] = P.y; this.p[i * 3 + 2] = P.z + Math.sin(ang) * r;
          let vx = Math.cos(ang) * Math.sin(cone) * speed, vz = Math.sin(ang) * Math.sin(cone) * speed;
          // The lite's portrait camera sits ~2.5 bodies away (Unity's duel camera is much further back): a chip thrown toward
          // it fills the screen, so the horizontal part is mirrored away from the camera (same spread, same speeds).
          const toward = vx * this.camAway.x + vz * this.camAway.z;
          if (toward > 0) { vx -= 2 * toward * this.camAway.x; vz -= 2 * toward * this.camAway.z; }
          this.v[i * 3] = vx; this.v[i * 3 + 1] = Math.cos(cone) * speed; this.v[i * 3 + 2] = vz;
          this.gravity[i] = q.gravity * GRAVITY * s;
          const sz = this.rand(q.sizeM[0], q.sizeM[1]) * s, mix = this.random();
          this.size[i * 2] = sz; this.size[i * 2 + 1] = sz;
          this.rgb[i * 3] = a[0] + (b[0] - a[0]) * mix; this.rgb[i * 3 + 1] = a[1] + (b[1] - a[1]) * mix; this.rgb[i * 3 + 2] = a[2] + (b[2] - a[2]) * mix;
          for (let k = 0; k < 3; k++) { this.rot[i * 3 + k] = this.random() * Math.PI * 2; this.rotVel[i * 3 + k] = this.rand(-2 * Math.PI, 2 * Math.PI); }
          this.sizeCurve[i] = DEBRIS_SIZE_N; this.limit[i] = -1;   // -1 = bounce on the floor (collision bounce 0.2, dampen 0.6)
        }
        return;
      }
      case 'dust': {
        P.copy(target.feet); P.y = floorY + 0.05 * s;
        const c = hexRgb(q.color), first = Math.min(24, q.count), rest = q.count - first, per = Math.ceil(rest / 6);
        for (let n = 0; n < q.count; n++) {
          const born = t0 + (n < first ? 0.05 : 0.10 + Math.floor((n - first) / Math.max(1, per)) * 0.05);
          const sz = this.rand(q.sizeH[0], q.sizeH[1]) * H * 2.2;
          const i = this.sprite('SoftDust', BLEND_ALPHA, born, this.rand(q.life[0], q.life[1]), P, sz, sz, c, 1, DUST_ALPHA_N, DUST_SIZE_N);
          if (i < 0) break;
          const ang = this.random() * Math.PI * 2, el = Math.asin(this.random()), r = this.random() * 0.3 * H, speed = this.rand(q.speed[0], q.speed[1]) * s;
          this.p[i * 3] += Math.cos(ang) * r; this.p[i * 3 + 2] += Math.sin(ang) * r;
          this.v[i * 3] = Math.cos(ang) * Math.cos(el) * speed; this.v[i * 3 + 1] = Math.sin(el) * speed; this.v[i * 3 + 2] = Math.sin(ang) * Math.cos(el) * speed;
          this.limit[i] = 0.35 * s; this.rot[i * 3] = this.random() * Math.PI * 2; this.rotVel[i * 3] = this.rand(-0.6, 0.6);
        }
        return;
      }
      case 'residue': {
        const size = q.sizeH * H, c = hexRgb(q.color);
        if (q.mode === 'decal') {
          P.copy(target.feet); P.y = floorY + 0.004;
          const mask = ('Residue_' + q.mask) as VfxTextureName;
          const dark = this.sprite(mask, BLEND_ALPHA, t0, q.life, P, size, size, [0.114, 0.125, 0.149], 1, RESIDUE_ALPHA_N, FLAT, MODE_GROUND);
          if (dark >= 0) this.alphaMul[dark] = 0.9;
          P.y = floorY + 0.006;
          this.sprite(mask, BLEND_ADD, t0, q.life, P, size, size, c, 0.8, RESIDUE_ALPHA_N, FLAT, MODE_GROUND);
        }
        if (q.motes > 0) {
          this.anchorOf(q.atChest ? 'chest' : 'landing_point', cue, 'landing', P); P.y += 0.1 * s;
          const radius = Math.max(0.2 * s, 0.4 * size);
          for (let n = 0; n < q.motes; n++) {
            const sz = this.rand(0.03, 0.07) * s;
            const i = this.sprite('Mote', BLEND_ADD, t0, this.rand(q.life * 0.5, q.life), P, sz, sz, c, 1.2, MOTE_ALPHA_N, FLAT);
            if (i < 0) break;
            const ang = this.random() * Math.PI * 2, el = Math.asin(this.random()), r = this.random() * radius, speed = this.rand(0.1, 0.4) * s;
            this.p[i * 3] += Math.cos(ang) * Math.cos(el) * r; this.p[i * 3 + 1] += Math.sin(el) * r; this.p[i * 3 + 2] += Math.sin(ang) * Math.cos(el) * r;
            this.v[i * 3] = Math.cos(ang) * Math.cos(el) * speed + this.rand(-0.15, 0.15) * s; this.v[i * 3 + 1] = Math.sin(el) * speed; this.v[i * 3 + 2] = Math.sin(ang) * Math.cos(el) * speed;
          }
        }
        return;
      }
      case 'charge': {
        P.copy(cue.caster.chest);
        const c = hexRgb(q.color);
        this.sprite('SoftGauss35', BLEND_ADD, t0, q.life, P, q.sizeH * H, q.sizeH * H, c, 0.9, CHARGE_ALPHA_N, CHARGE_SIZE_N);
        for (let n = 0; n < q.motes; n++) {
          const sz = this.rand(0.04, 0.1) * s;
          const i = this.sprite('Mote', BLEND_ADD, t0, q.life, P, sz, sz, [1, 1, 1], 1.5, CHARGE_MOTE_ALPHA_N, FLAT);
          if (i < 0) break;
          // On a 0.8 H sphere shell, moving inward at 2.7 H / s (Unity: startSpeed -2.7 H), white -> the charge colour.
          const u = this.random() * 2 - 1, ang = this.random() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
          const dx = rr * Math.cos(ang), dy = u, dz = rr * Math.sin(ang);
          this.p[i * 3] += dx * 0.8 * H; this.p[i * 3 + 1] += dy * 0.8 * H; this.p[i * 3 + 2] += dz * 0.8 * H;
          this.v[i * 3] = -dx * 2.7 * H; this.v[i * 3 + 1] = -dy * 2.7 * H; this.v[i * 3 + 2] = -dz * 2.7 * H;
          this.rgb2[i * 3] = c[0] * 1.5; this.rgb2[i * 3 + 1] = c[1] * 1.5; this.rgb2[i * 3 + 2] = c[2] * 1.5;
        }
        return;
      }
      case 'skyColumn': {
        const height = q.heightH * H, width = q.widthH * H, life = q.lead + q.fade, c = Math.min(1, Math.max(0, q.lead / Math.max(1e-3, life)));
        const alpha = T(0, 0, Math.min(0.033 / life, Math.max(0.01, c * 0.5)), 1, Math.max(c, 0.02), 1, c + (1 - c) * 0.3, 0.45, 1, 0);
        const start = t0 - q.lead;   // fired 'lead' s before the contact, as CombatFxSystem does off the DamageFrame estimate
        P.copy(target.feet); P.y = floorY + height * 0.5;
        this.sprite('Column', BLEND_ADD, start, life, P, width * 0.4, height, [1, 1, 1], q.intensity, alpha, FLAT, MODE_VERTICAL);
        this.sprite('Column', BLEND_ADD, start, life, P, width, height, hexRgb(q.color), 1, alpha, FLAT, MODE_VERTICAL);
        if (q.lead > 0) {
          P.y = floorY + height;
          const i = this.sprite('Mote', BLEND_ADD, start, q.lead, P, width * 2.5, width * 2.5, [1, 1, 1], q.intensity, HEAD_ALPHA_N, FLAT);
          if (i >= 0) this.v[i * 3 + 1] = -height / q.lead;
        }
        return;
      }
    }
  }

  /** GuardImpactFxBuilder's guard impact at the struck guard (pack.guardImpact), in the shield plane facing the camera. */
  private guardImpact(target: VfxAnchors, t0: number) {
    const g = (VFX_PACK as Manifest).guardImpact as unknown as { cyan: string; layers: Record<string, any>[] };
    const cyan = hexRgb(g.cyan), white = [1, 1, 1];
    const P = this.tmpP.copy(target.chest).addScaledVector(target.facing, 0.25 * target.height);
    const s = target.height / 1.45;
    for (const L of g.layers) {
      const delays: number[] = Array.isArray(L.delay) ? L.delay : [L.delay];
      const life = Array.isArray(L.life) ? L.life : [L.life, L.life];
      const sizes = Array.isArray(L.size) ? L.size : [L.size, L.size];
      const rgb = L.color.length > 1 && L.color[0][1] === '#FFFFFF' && L.color[L.color.length - 1][1] === 'cyan' ? cyan.map((c, k) => (c + white[k]) / 2) : cyan;
      const alpha = T(...(L.alpha as number[][]).flat());
      const sizeCurve = L.sizeCurve ? T(...(L.sizeCurve as number[][]).flat()) : FLAT;
      const tex = L.texture as VfxTextureName;
      for (const delay of delays) for (let n = 0; n < (L.count ?? 1) / delays.length; n++) {
        const lf = this.rand(life[0], life[1]);
        if (L.name === 'VerticalLine') { this.sprite(tex, BLEND_ADD, t0 + delay, lf, P, sizes[0] * s * 2, sizes[1] * s, rgb, L.gain, alpha, FLAT); continue; }
        const shield = L.mode === 'shield';
        const sz = this.rand(sizes[0], sizes[1]) * s * (shield ? 1 : 1);
        const i = this.sprite(tex, BLEND_ADD, t0 + delay, lf, P, sz, shield ? sz * 1.25 : sz, rgb, L.gain, alpha, sizeCurve);
        if (i < 0) break;
        if (L.speed) {
          const ang = this.random() * Math.PI * 2, speed = this.rand(L.speed[0], L.speed[1]) * s;
          this.v[i * 3] = this.right.x * Math.cos(ang) * speed + this.up.x * Math.sin(ang) * speed;
          this.v[i * 3 + 1] = this.right.y * Math.cos(ang) * speed + this.up.y * Math.sin(ang) * speed;
          this.v[i * 3 + 2] = this.right.z * Math.cos(ang) * speed + this.up.z * Math.sin(ang) * speed;
          this.rot[i * 3] = ang; if (L.mode === 'stretch') { this.size[i * 2] = sz * (L.lengthScale ?? 4); }
          if (L.gravity) this.gravity[i] = L.gravity * GRAVITY * s;
        }
      }
    }
  }

  private queueFlash(kind: 'sky' | 'break', atS: number) {
    const f = (VFX_PACK as Manifest).screenFlash;
    this.flashQueued = kind === 'sky' ? f.sky : f.break; this.flashAt = atS;
  }

  // ---- per frame ---------------------------------------------------------------------------------------------------

  /** Call once per rendered frame, before renderer.render. No allocation. */
  update(nowS: number) {
    if (this.disposed) return;
    this.frame++;
    const dt = this.lastNow < 0 ? 0 : Math.min(0.1, Math.max(0, nowS - this.lastNow));
    this.lastNow = nowS;
    const m = this.camera.matrixWorld.elements;
    this.right.set(m[0], m[1], m[2]).normalize(); this.up.set(m[4], m[5], m[6]).normalize();
    for (let b = 0; b < this.batches.length; b++) this.batches[b].count = 0;
    let cubes = 0, live = 0;
    const cubeMesh = this.cubes!;
    for (let i = 0; i < VFX_MAX_LIVE; i++) {
      if (!this.active[i]) continue;
      const age = nowS - this.born[i];
      if (age < 0) { live++; continue; }
      const life = this.life[i];
      if (age >= life) { this.active[i] = 0; this.free[this.freeTop++] = i; continue; }
      live++;
      const t = age / life, i3 = i * 3;
      // motion
      const g = this.gravity[i];
      if (g !== 0) this.v[i3 + 1] -= g * dt;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      const lim = this.limit[i];
      if (lim > 0) {
        const sp = Math.hypot(this.v[i3], this.v[i3 + 1], this.v[i3 + 2]);
        if (sp > lim) { const k = Math.max(lim / sp, 1 - 0.08 * dt * 30); this.v[i3] *= k; this.v[i3 + 1] *= k; this.v[i3 + 2] *= k; }
      } else if (lim < 0 && this.p[i3 + 1] < 0 && this.v[i3 + 1] < 0) {
        this.p[i3 + 1] = 0; this.v[i3 + 1] *= -0.2; this.v[i3] *= 0.4; this.v[i3 + 2] *= 0.4;
      }
      this.rot[i3] += this.rotVel[i3] * dt; this.rot[i3 + 1] += this.rotVel[i3 + 1] * dt; this.rot[i3 + 2] += this.rotVel[i3 + 2] * dt;
      const sc = linearAt(this.sizeCurve[i]!, t);
      const b = this.batchOf[i];
      if (b === CUBE_BATCH) {
        if (cubes >= cubeMesh.instanceMatrix.count) continue;
        const sz = this.size[i * 2] * sc;
        this.tmpQ.setFromEuler(this.tmpE.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]));
        this.tmpM.compose(this.tmpS.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]), this.tmpQ, this.tmpP.set(sz, sz, sz));
        cubeMesh.setMatrixAt(cubes, this.tmpM);
        cubeMesh.setColorAt(cubes, this.tmpC.setRGB(this.rgb[i3], this.rgb[i3 + 1], this.rgb[i3 + 2], THREE.SRGBColorSpace));
        cubes++;
        continue;
      }
      let alpha = (this.alphaSeconds[i] ? linearAt(this.alphaCurve[i]!, age) : linearAt(this.alphaCurve[i]!, t)) * this.alphaMul[i];
      let sx = this.size[i * 2] * sc, sy = this.size[i * 2 + 1] * sc, gain = 1;
      const scaleKeys = this.elScale[i];
      if (scaleKeys) {
        const k = hermite(scaleKeys, t);
        sx = this.size[i * 2] * k; sy = this.size[i * 2 + 1] * k;
        const d = Math.min(1, Math.max(0, hermite(this.elDissolve[i]!, t)));
        const fade = 1 - smooth01(d / this.elFade[i]);
        alpha = fade * Math.min(1, age / 0.04);
        const punch = this.elPunch[i];
        if (punch) gain = linearAt(punch, age);
      }
      const batch = this.batches[b];
      const n = batch.count++;
      const d = batch.data, o = n * STRIDE;
      d[o] = this.p[i3]; d[o + 1] = this.p[i3 + 1]; d[o + 2] = this.p[i3 + 2]; d[o + 3] = this.rot[i3];
      d[o + 4] = sx; d[o + 5] = sy; d[o + 6] = this.mode[i]; d[o + 7] = 0;
      if (this.rgb2[i3] >= 0) {
        d[o + 8] = (this.rgb[i3] + (this.rgb2[i3] - this.rgb[i3]) * t) * gain; d[o + 9] = (this.rgb[i3 + 1] + (this.rgb2[i3 + 1] - this.rgb[i3 + 1]) * t) * gain; d[o + 10] = (this.rgb[i3 + 2] + (this.rgb2[i3 + 2] - this.rgb[i3 + 2]) * t) * gain;
      } else { d[o + 8] = this.rgb[i3] * gain; d[o + 9] = this.rgb[i3 + 1] * gain; d[o + 10] = this.rgb[i3 + 2] * gain; }
      d[o + 11] = alpha;
    }
    this.stats.live = live;
    const warm = this.warm > 0;
    if (warm) this.warm--;
    for (let b = 0; b < this.batches.length; b++) {
      const batch = this.batches[b];
      batch.geometry.instanceCount = batch.count;
      batch.mesh.visible = warm || batch.count > 0;
      if (batch.count > 0) batch.buffer.needsUpdate = true;   // full 9.6 KB upload: expo-gl's WebGL2 bufferSubData(srcOffset, length) overload is not relied on
    }
    cubeMesh.count = cubes; cubeMesh.visible = warm || cubes > 0;
    if (cubes > 0) { cubeMesh.instanceMatrix.needsUpdate = true; if (cubeMesh.instanceColor) cubeMesh.instanceColor.needsUpdate = true; }
    this.updateFlash(nowS, warm);
  }

  private updateFlash(nowS: number, warm: boolean) {
    const mesh = this.flashMesh!;
    if (this.flashQueued && nowS >= this.flashAt) {
      // CombatScreenFlash.Fire: one per 0.5 s; reduce flashing removes it.
      if (!this.reduceFlashing && nowS - this.lastFlashS >= (VFX_PACK as Manifest).screenFlash.rateLimitSeconds) {
        this.flashPulse = this.flashQueued; this.flashFireFrame = this.frame; this.lastFlashS = nowS;
      }
      this.flashQueued = null; this.flashAt = Infinity;
    }
    const a = this.flashPulse ? flashAlphaAfter(this.flashPulse, this.frame - this.flashFireFrame) : 0;
    if (this.flashPulse && a <= 0 && this.frame - this.flashFireFrame > 0) this.flashPulse = null;
    this.flashUniforms.uAlpha.value = a;
    mesh.visible = warm || a > 0;
  }

  /** The current screen-flash alpha (QA log / tests). */
  get flashAlpha() { return this.flashUniforms.uAlpha.value; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const material = object.material as THREE.Material & { uniforms?: Record<string, { value: unknown }> };
      const map = material.uniforms?.uMap?.value;
      if (map instanceof THREE.Texture) map.dispose();
      material.dispose();
    });
    this.scene.remove(this.root);
  }
}

function smooth01(x: number) { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }
