import { KoPresentationGate, type TerminalPresentation } from '../../lib/bots/koPresentation';
import { BattlePaceQueue, fightTiming, type FightTiming, type PresentationAcceptance } from '../../lib/bots/battlePace';
import type { ResolvedBattlePace } from '../../lib/bots/resolvedBattlePace';
import fightClipTiming from '../../lib/bots/fightClipTiming.json';
import { guardVisual } from '../../lib/bots/guardVisual';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, AppState, PixelRatio, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import Renderer from 'expo-three/build/Renderer';
import * as THREE from 'three';
import { theme } from '../../theme';
import { BOT_MANIFEST, type BotId } from '../../../assets/bots';
import { disposeBot, loadBot } from '../../lib/bots/loadBot';
import { resolveClipName } from '../../lib/bots/animationClips';
import { prepareBotMaterials, type BotMaterialQuality } from '../../lib/bots/materials';
import { knobSignature, PERF_ARM_MEASURE_MS, PERF_ARM_WARMUP_MS, resolveStageRender, summarizeArm, throttledMixerStep, type PerfArmSummary, type PerfFrame, type StagePerfKnobs, type StageRenderQuality } from '../../lib/bots/stagePerf';
import { probeGl, stageInventory } from '../../lib/bots/stageProbe';
import { VfxPlayer, type VfxAnchors } from '../../vfx/vfxPlayer';
import type { LiveDuelVfxCue } from '../../vfx/liveDuelVfx';
import { isSpecialCue, restartSpecialBeat, specialCameraPose, specialCameraWeight, specialEffectDurationS } from '../../vfx/specialCameraBeat';

export type BotMetrics = { botId: string; loadMs: number; fps: number; frames: number; assetBytes: number; platform: string; drawWidth: number; drawHeight: number; contextId: number; materialQuality: BotMaterialQuality; renderScale: number };
export type StageBot = { id: BotId; side: string };
export type BotStageHandle = { present(cue: ResolvedBattlePace): PresentationAcceptance; play(side: string, clipName: string): boolean; strike(side: string): void; hit(side: string): void; guard(side: string): void;
  /** lite-vfx-port-1: plays a HoloCity combat-VFX cue (presentation only). False when VFX are off, not loaded, or the kit is not in the pack. */
  fx(cue: LiveDuelVfxCue, impactMs: number): boolean };
export type PerfArmResult = { arm: string; knobs: StagePerfKnobs; contextId: number; drawWidth: number; drawHeight: number; loadMs: number; renderer: unknown; defaultFramebufferSamples: unknown; reactRendersPerSecond: number; glCallsByNamePerFrame: Record<string, number>; summary: PerfArmSummary };
/** Dev-only cost knobs (ignored outside __DEV__). Production callers never pass this. */
export type BotStagePerf = { arm: string; knobs: StagePerfKnobs; onArmDone?: (result: PerfArmResult) => void };
type Props = { bots: readonly StageBot[]; style?: StyleProp<ViewStyle>; variant?: 'viewer' | 'duelPortrait'; transparentBackdrop?: boolean; renderScale?: number; materialQuality?: BotMaterialQuality; active?: boolean; onReady?: () => void; onPresentationDrain?: () => void; terminal?: TerminalPresentation; onTerminalComplete?: (id: string) => void; onError?: (message: string) => void; onMetrics?: (metrics: BotMetrics) => void; showMetrics?: boolean; perf?: BotStagePerf;
  /** Production render settings (MSAA, buffer scale, mixer Hz). Omitted: production defaults. Dev `perf` knobs override it. */
  quality?: StageRenderQuality;
  /** lite-vfx-port-1: load the combat-VFX pack and accept fx() cues (duel stages only). Off: no VFX code runs. */
  vfx?: boolean;
  /** lite-2305-1: the portrait duel camera pulls back + widens for a special's played VFX (SKY / BREAK), then eases back. */
  specialCamera?: boolean;
  /** Dev QA only (ignored outside __DEV__): also play pack kits Unity has not built yet (WOLF). */
  vfxUnbuiltKits?: boolean };
type TimedStageCue = ResolvedBattlePace & { timing: FightTiming; clip: string };
type Actor = { paceAction?: THREE.AnimationAction; koAt?: number; freezeUntil?: number; flashMaterials: { material: THREE.MeshStandardMaterial; color: THREE.Color; intensity: number }[]; id: BotId; root: THREE.Group; mixer: THREE.AnimationMixer; animations: THREE.AnimationClip[]; current?: THREE.AnimationAction; hitAt?: number; guardAt?: number; base: THREE.Vector3; away: THREE.Vector3; guardRim?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; anchors?: VfxAnchors };

export const BotStage = forwardRef<BotStageHandle, Props>(function BotStage({ bots, style, variant = 'viewer', transparentBackdrop = false, renderScale = Platform.OS === 'web' ? 1 : 1 / PixelRatio.get(), materialQuality = 'balanced', active = true, onReady, onPresentationDrain, terminal, onTerminalComplete, onError, onMetrics, showMetrics = false, perf, quality, vfx = false, vfxUnbuiltKits = false, specialCamera = false }, ref) {
  const perfRun = __DEV__ ? perf : undefined;
  const renderSettings = resolveStageRender(quality, perfRun?.knobs);
  const scale = Math.max(0.25, Math.min(1, renderScale)) * renderSettings.resolution;
  const signature = `${variant}:${transparentBackdrop}:${scale}:${materialQuality}:m${renderSettings.msaaSamples}a${renderSettings.animHz}:${vfx ? 'fx' + (vfxUnbuiltKits ? '+' : '') + ':' : ''}` + bots.map(bot => `${bot.side}:${bot.id}`).join('|') + (perfRun ? `:perf:${perfRun.arm}:${knobSignature(perfRun.knobs)}` : '');
  const renderRef = useRef(renderSettings);
  renderRef.current = renderSettings;
  const perfRef = useRef(perfRun);
  perfRef.current = perfRun;
  const renderCount = useRef(0);
  if (perfRun) renderCount.current++;
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const drawSize = useRef({ width: 1, height: 1 });
  drawSize.current = { width: Math.max(1, Math.round(layout.width * scale * PixelRatio.get())), height: Math.max(1, Math.round(layout.height * scale * PixelRatio.get())) };
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [metrics, setMetrics] = useState<BotMetrics | null>(null);
  const actors = useRef(new Map<string, Actor>());
  const pace = useRef(new BattlePaceQueue<TimedStageCue>());
  const terminalRef = useRef(terminal); terminalRef.current = terminal;
  const koGate = useRef(new KoPresentationGate());
  const activeRef = useRef(active);
  const callbacks = useRef({ onReady, onPresentationDrain, onTerminalComplete, onError, onMetrics });
  callbacks.current = { onReady, onPresentationDrain, onTerminalComplete, onError, onMetrics };
  const disposeRef = useRef<() => void>(() => {});
  const generation = useRef(0);
  const mounted = useRef(true);
  const cameraCue = useRef<{ strikeAt: number; shakeFrames: number; beat?: { startS: number; holdEndS: number } | null }>({ strikeAt: -Infinity, shakeFrames: 0 });
  const specialCameraRef = useRef(specialCamera);
  specialCameraRef.current = specialCamera;
  const vfxRef = useRef<{ player: VfxPlayer; camera: THREE.Camera; size: () => { width: number; height: number } } | null>(null);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; disposeRef.current(); };
  }, []);

  const play = useCallback((side: string, clipName: string) => {
    const actor = actors.current.get(side);
    if (!actor || (actor.koAt !== undefined && clipName !== 'FightKO')) return false;
    const resolved = resolveClipName(clipName, actor.animations.map(clip => clip.name), BOT_MANIFEST[actor.id].idleClip, actor.id);
    const clip = actor.animations.find(candidate => candidate.name === resolved);
    if (!clip) return false;
    const next = actor.mixer.clipAction(clip);
    if (actor.current === next && next.isRunning()) return true;
    const loop = resolved === BOT_MANIFEST[actor.id].idleClip || /^(Walk|Run|FightIdle|FightRun)$/i.test(resolved ?? '');
    next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    const fade = clipName.startsWith('Fight') ? .08 : .14;
    actor.current?.fadeOut(fade);
    next.fadeIn(fade);
    actor.paceAction = undefined;
    actor.current = next;
    return true;
  }, []);
  const fireFx = useCallback((cue: LiveDuelVfxCue, impactMs: number) => {
      const vfxStage = vfxRef.current;
      const caster = actors.current.get(cue.caster)?.anchors, target = actors.current.get(cue.target)?.anchors;
      if (!vfxStage || !caster || !target || (cue.kit === null && cue.effect !== 'guard')) return false;
      const now = pace.current.clockMs / 1000;
      const played = vfxStage.player.fire({ kit: cue.kit ?? '', effect: cue.effect, caster, target, impactS: impactMs / 1000, phases: cue.phases, flash: cue.flash }, now);
      // lite-2305-1: a played special holds the pulled-back camera for the effect's own manifest duration (presentation only).
      const beatS = played && specialCameraRef.current && isSpecialCue(cue) ? specialEffectDurationS(cue.kit, cue.effect, cue.phases, impactMs / 1000) : null;
      if (beatS !== null) {
        cameraCue.current.beat = restartSpecialBeat(now, cameraCue.current.beat ?? null, beatS);
        if (__DEV__) console.info('[HolobotVfx:beat] ' + JSON.stringify({ effect: cue.effect, firedAtMs: Math.round(now * 1000), holdS: Math.round(beatS * 1000) / 1000, holdEndMs: Math.round(cameraCue.current.beat.holdEndS * 1000) }));
      }
      if (__DEV__ && played) {
        // QA log for the impact-lift gate: the impact point P (SKY: the landing floor; else the struck chest) and the caster's
        // standing height projected at P's depth, as fractions of the stage view.
        const point = (cue.effect === 'sky_launch' ? target.feet : target.chest).clone();
        const top = point.clone().add(new THREE.Vector3(0, caster.height, 0));
        point.project(vfxStage.camera); top.project(vfxStage.camera);
        console.info('[HolobotVfx:fire] ' + JSON.stringify({ kit: cue.kit, effect: cue.effect, flash: cue.flash, phases: cue.phases, firedAtMs: Math.round(now * 1000), impactAtMs: Math.round(now * 1000 + impactMs), pointFrac: [Math.round((point.x + 1) / 2 * 1e4) / 1e4, Math.round((1 - point.y) / 2 * 1e4) / 1e4], hFrac: Math.round(Math.abs(top.y - point.y) / 2 * 1e4) / 1e4, stats: vfxStage.player.stats }));
      }
      return played;
  }, []);
  useImperativeHandle(ref, () => ({
    present(cue) {
      const actor = actors.current.get(cue.attacker);
      if (!actor) return 'skipped';
      const family = cue.kind === 'light' ? 'FightLight' : cue.kind === 'heavy' ? 'FightHeavy' : cue.kind === 'special' ? 'FightSpecial' : 'FightGuard';
      const fallback = cue.kind === 'light' ? 'Strike' : cue.kind === 'heavy' ? 'Heavy' : cue.kind === 'special' ? 'Finisher' : 'InterceptGuard';
      const clip = actor.animations.find(c => c.name === family) ?? actor.animations.find(c => c.name === resolveClipName(fallback, actor.animations.map(c => c.name), BOT_MANIFEST[actor.id].idleClip, actor.id))
        ?? (cue.kind === 'guard' ? actor.animations.find(c => c.name === BOT_MANIFEST[actor.id].idleClip) : undefined);
      if (!clip) return 'skipped';
      const source = clip.name === family ? fightClipTiming.clips[actor.id][family] : { duration: clip.duration, contact: clip.duration / 2, speed: 1 };
      return pace.current.enqueue({ ...cue, clip: clip.name, timing: fightTiming(cue.kind, source, cue.damaged !== null) }) ? 'accepted' : 'backpressure';
    },
    play,
    strike(side) { if (actors.current.has(side)) cameraCue.current.strikeAt = pace.current.clockMs; },
    hit(side) {
      const actor = actors.current.get(side);
      if (!actor) return;
      if (!play(side, 'FightHitLight')) play(side, 'Idle'); actor.hitAt = pace.current.clockMs; cameraCue.current.shakeFrames = 2;
    },
    guard(side) {
      const actor = actors.current.get(side);
      if (!actor) return;
      if (!play(side, 'FightGuard') && !play(side, 'InterceptGuard') && !play(side, 'Guard')) play(side, 'Idle');
      actor.guardAt = pace.current.clockMs;
    },
    fx: fireFx,
  }), [play, fireFx]);

  const createContext = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    disposeRef.current();
    setError(null); setLoaded(false); setMetrics(null);
    const ticket = ++generation.current;
    const start = performance.now();
    let alive = true;
    let frameId = 0;
    let renderer: Renderer | null = null;
    let phase = 'renderer';
    let lastFrame = performance.now();
    let appActive = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    // Dev-only: captured once per context; any knob change changes the signature and remounts the GLView.
    const perfArm = perfRef.current;
    const knobs = perfArm?.knobs;
    // Production quality or the dev arm, captured once per context (the signature remounts the GLView on change).
    const animHz = renderRef.current.animHz;
    let glCalls = 0;
    const glCallNames: Record<string, number> = {};
    let mixerPendingMs = 0;
    const scene = new THREE.Scene();
    scene.background = transparentBackdrop ? null : new THREE.Color(theme.colors.carbon);
    const camera = new THREE.PerspectiveCamera(35, drawSize.current.width / drawSize.current.height, 0.05, 50);
    const isDuel = bots.length > 1;
    const portrait = variant === 'duelPortrait' && isDuel;
    camera.position.set(isDuel ? 0 : 0.35, isDuel ? 1.8 : 1.25, isDuel ? 4.8 : 3.3);
    camera.lookAt(0, 0.8, 0);
    if (portrait) { camera.setFocalLength(35); camera.position.set(0, 0.9, 4); camera.lookAt(0, 0.9, 0); }
    const localActors = new Map<string, Actor>();
    const ownedRoots: THREE.Object3D[] = [];
    const appSubscription = AppState.addEventListener('change', state => { appActive = state === 'active'; lastFrame = performance.now(); });
    const dispose = () => {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(frameId);
      pace.current.reset(); koGate.current.reset();
      appSubscription.remove();
      localActors.forEach(actor => { actor.mixer.stopAllAction(); actor.mixer.uncacheRoot(actor.root); });
      ownedRoots.forEach(disposeBot);
      if (actors.current === localActors) actors.current = new Map();
      vfxRef.current?.player.dispose(); vfxRef.current = null;
      renderer?.dispose();
      scene.clear();
      if (Platform.OS !== 'web') void GLView.destroyContextAsync(gl).catch(cause => { if (__DEV__) console.warn('[HolobotViewer:dispose] ' + String(cause)); });
    };
    disposeRef.current = dispose;
    try {
      // Expo GL ignores these browser-only unpack hints; avoid a native warning on every bone-texture update.
      if (Platform.OS !== 'web') {
        const pixelStore = gl.pixelStorei.bind(gl);
        gl.pixelStorei = (parameter, value) => {
          if (parameter === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL || parameter === gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) return;
          pixelStore(parameter, value);
        };
      }
      if (knobs) {
        // Count JS->GL bridge calls. Methods live on the shared prototype, so shadow them on this context only.
        for (const name in gl) {
          const method = (gl as unknown as Record<string, unknown>)[name];
          if (typeof method !== 'function' || name.startsWith('__')) continue;
          (gl as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => { glCalls++; glCallNames[name] = (glCallNames[name] ?? 0) + 1; return (method as (...values: unknown[]) => unknown).apply(gl, args); };
        }
      }
      renderer = new Renderer({ gl, antialias: true, alpha: transparentBackdrop });
      phase = 'renderer configuration';
      // Expo's drawingBuffer dimensions are initial values, not live layout getters.
      let renderWidth = drawSize.current.width, renderHeight = drawSize.current.height;
      renderer.setSize(renderWidth, renderHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(theme.colors.carbon, transparentBackdrop ? 0 : 1);
      renderer.debug.onShaderError = (context, program, vertex, fragment) => { if (__DEV__) console.warn('[HolobotViewer:shader] ' + JSON.stringify({ program: context.getProgramInfoLog(program), vertex: context.getShaderInfoLog(vertex), fragment: context.getShaderInfoLog(fragment) })); };
      if (knobs?.shadowsOff) renderer.shadowMap.enabled = false;
      const probe = knobs ? probeGl(gl, renderer, knobs.msaaSamples) : null;
      if (probe) console.info('[HolobotViewer:probe] ' + JSON.stringify({ arm: perfArm!.arm, contextId: gl.contextId, ...probe }));
      scene.add(new THREE.HemisphereLight('#D9F9FF', '#182330', 2.5));
      const key = new THREE.DirectionalLight('#FFFFFF', 3);
      key.position.set(2, 4, 4); scene.add(key);
      const rim = new THREE.DirectionalLight(theme.colors.accent, 2); rim.position.set(-3, 2, -2); scene.add(rim);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(isDuel ? 2.1 : 0.85, 64), new THREE.MeshStandardMaterial({ color: theme.plates.raised, roughness: 1 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -0.015; scene.add(floor); ownedRoots.push(floor);
      const grid = new THREE.GridHelper(4, 16, '#27555F', '#1B303A');
      grid.position.y = -0.01; scene.add(grid);
      // Portrait uses the composited park plate for its grass and painted cyan ring.
      if (portrait && transparentBackdrop) { floor.visible = false; grid.visible = false; }
      const disposeFloor = disposeRef.current;
      disposeRef.current = () => { if (!alive) return; grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); disposeFloor(); };
      phase = 'load asset';
      // lite-vfx-port-1: the pack's textures load alongside the bots; a failure leaves the fight without VFX, never without a stage.
      const vfxLoad = vfx && isDuel ? VfxPlayer.create(scene, camera, { allowUnbuilt: __DEV__ && vfxUnbuiltKits }).catch(cause => { if (__DEV__) console.warn('[HolobotVfx:load] ' + String(cause)); return null; }) : null;
      await Promise.all(bots.map(async (bot, index) => {
        const gltf = await loadBot(bot.id, nextPhase => { phase = `${bot.id}: ${nextPhase}`; });
        if (!alive || ticket !== generation.current || !mounted.current) { disposeBot(gltf.scene); return; }
        prepareBotMaterials(gltf.scene, materialQuality);
        if (knobs?.cullBack) gltf.scene.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.side = THREE.FrontSide; material.needsUpdate = true; }
        });
        // Outer wrapper is deliberately separate: ACE animates its Armature scale.
        const root = new THREE.Group(); root.add(gltf.scene);
        root.position.x = isDuel ? index === 0 ? -0.9 : 0.9 : 0;
        root.rotation.y = isDuel ? index === 0 ? Math.PI / 2 : -Math.PI / 2 : -0.15;
        if (portrait) {
          // Diagonal staging preserves 1.8 m between actor origins, with the player nearer camera.
          root.position.set(index === 0 ? -0.5 : 0.5, 0, index === 0 ? Math.sqrt(0.56) : -Math.sqrt(0.56));
          root.rotation.y = index === 0 ? Math.atan2(1, -2 * Math.sqrt(0.56)) : Math.atan2(-1, 2 * Math.sqrt(0.56));
        }
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const flashMaterials: Actor['flashMaterials'] = [];
        gltf.scene.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material instanceof THREE.MeshStandardMaterial && !flashMaterials.some(row => row.material === material)) flashMaterials.push({ material, color: material.emissive.clone(), intensity: material.emissiveIntensity });
        });
        const actor: Actor = { id: bot.id, root, mixer, animations: gltf.animations, flashMaterials, base: root.position.clone(), away: new THREE.Vector3(root.position.x, 0, root.position.z).normalize() };
        localActors.set(bot.side, actor); scene.add(root); ownedRoots.push(root);
        if (knobs?.hideRival && bot.side === 'rival') root.visible = false;
        mixer.addEventListener('finished', event => { if (event.action === actor.current && actor.koAt === undefined && !actor.paceAction) play(bot.side, actor.animations.some(c => c.name === 'FightIdle') && isDuel ? 'FightIdle' : 'Idle'); });
      }));
      if (!alive || ticket !== generation.current || !mounted.current) return;
      phase = 'animation setup';
      actors.current = localActors;
      cameraCue.current = { strikeAt: -Infinity, shakeFrames: 0 };
      bots.forEach(bot => { if (!isDuel || !play(bot.side, 'FightIdle')) play(bot.side, 'Idle'); });
      if (portrait) {
        localActors.forEach(actor => {
          actor.mixer.update(0.12); actor.root.updateMatrixWorld(true);
          actor.root.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.update(); });
          const bounds = new THREE.Box3().setFromObject(actor.root, true);
          // Uniform presentation height makes source rigs with different export scales comparable.
          // Geometry, bones and animation are unchanged; this is only the outer scene transform.
          const scale = 1.45 / Math.max(0.1, bounds.max.y - bounds.min.y);
          actor.root.scale.setScalar(scale); actor.root.position.y = -bounds.min.y * scale;
          actor.base.copy(actor.root.position);
          const shield = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 12), new THREE.MeshBasicMaterial({ color: theme.colors.accent, transparent: true, opacity: 0, wireframe: true, depthWrite: false }));
          shield.position.copy(actor.base); shield.position.y = 0.75; shield.scale.set(0.8, 1.1, 0.8);
          // Retain the transparent first draw to warm its shader before the first defend pulse.
          scene.add(shield); ownedRoots.push(shield); actor.guardRim = shield;
        });
      }
      if (vfxLoad) {
        const player = await vfxLoad;
        if (!alive || ticket !== generation.current || !mounted.current) { player?.dispose(); return; }
        if (player) {
          // Anchors on the presented bodies: feet on the floor, chest at 0.62 H, the striking hand 0.3 H toward the rival.
          const list = [...localActors.values()];
          list.forEach((actor, index) => {
            const other = list[1 - index] ?? actor;
            const height = portrait ? 1.45 : 1.45 * actor.root.scale.y;
            const facing = new THREE.Vector3(other.base.x - actor.base.x, 0, other.base.z - actor.base.z);
            if (facing.lengthSq() < 1e-6) facing.set(1, 0, 0);
            facing.normalize();
            const feet = actor.base.clone(); feet.y = 0;
            const chest = feet.clone().add(new THREE.Vector3(0, 0.62 * height, 0));
            actor.anchors = { feet, chest, hand: chest.clone().addScaledVector(facing, 0.3 * height), facing, height };
          });
          vfxRef.current = { player, camera, size: () => drawSize.current };
        }
      }
      if (!isDuel) {
        const actor = localActors.values().next().value as Actor;
        // Sample the idle pose before fitting: ACE begins hovering after its grounded first frame.
        actor.mixer.update(0.12);
        actor.root.updateMatrixWorld(true);
        actor.root.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.update(); });
        const bounds = new THREE.Box3().setFromObject(actor.root, true);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        // Some corrected source rigs place feet slightly below the export origin.
        // Lower the presentation floor instead of clipping those feet or moving the animation.
        floor.position.y = Math.min(0, bounds.min.y) - 0.025;
        grid.position.y = floor.position.y + 0.005;
        const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const distance = Math.max(size.y / (2 * verticalTangent), size.x / (2 * verticalTangent * camera.aspect)) * 1.32 + size.z * 0.5;
        camera.position.set(center.x + 0.12, center.y + size.y * 0.12, center.z + distance);
        camera.lookAt(center);
      }
      let frames = 0;
      let sampleFrames = 0;
      let sampleStart = performance.now();
      const perfFrames: PerfFrame[] = [];
      const perfWindow = { start: Infinity, end: Infinity, renders: 0, names: {} as Record<string, number>, armed: false, done: false };

      let loadMs = 0;
      const whiteFlash = new THREE.Color('#FFFFFF');
      const cameraHome = camera.position.clone();
      const cameraFovHome = camera.fov;
      let cameraFov = camera.fov;
      const assetBytes = bots.reduce((sum, bot) => sum + BOT_MANIFEST[bot.id].bytes, 0);
      const emit = (fps: number) => {
        const sample: BotMetrics = { botId: bots.map(bot => bot.id).join('+'), loadMs, fps: Math.round(fps * 10) / 10, frames, assetBytes, platform: Platform.OS, drawWidth: renderWidth, drawHeight: renderHeight, contextId: gl.contextId, materialQuality, renderScale: scale };
        if (showMetrics) setMetrics(sample);
        callbacks.current.onMetrics?.(sample);
        if (__DEV__) console.info('[HolobotViewer:metrics] ' + JSON.stringify(sample));
      };
      const render = () => {
        if (!alive) return;
        frameId = requestAnimationFrame(render);
        const now = performance.now();
        const elapsed = Math.min(now - lastFrame, 1000);
        lastFrame = now;
        if (!activeRef.current || !appActive) { sampleStart = now; sampleFrames = 0; return; }
        const dimensions = drawSize.current;
        if (dimensions.width !== renderWidth || dimensions.height !== renderHeight) {
          renderWidth = dimensions.width; renderHeight = dimensions.height;
          renderer!.setSize(renderWidth, renderHeight);
          camera.aspect = renderWidth / renderHeight; camera.updateProjectionMatrix();
        }
        const glCallsAtFrame = glCalls;
        const step = animHz ? throttledMixerStep(mixerPendingMs, elapsed, animHz) : null;
        if (step) mixerPendingMs = step.pendingMs;
        const events = pace.current.advance(elapsed, cue => localActors.has(cue.attacker) && localActors.get(cue.attacker)!.koAt === undefined);
        const poseNow = pace.current.clockMs;
        for (const event of events) {
          const cue = event.cue, actor = localActors.get(cue.attacker);
          if (!actor) continue;
          if (event.type === 'cancel') continue;
          if (event.type === 'start') {
            if (play(cue.attacker, cue.clip)) { actor.paceAction = actor.current; actor.current!.setEffectiveTimeScale(0); }
            if (cue.kind === 'guard') { actor.guardAt = poseNow; if (__DEV__) console.info('[HolobotPace:guard] ' + JSON.stringify({ id: cue.id, bot: actor.id, clip: cue.clip, phase: 'start', clockMs: poseNow, utc: new Date().toISOString() })); }
            else cameraCue.current.strikeAt = poseNow;
            for (const effect of cue.effects ?? []) fireFx(effect, cue.timing.windupMs);
          } else if (event.type === 'contact') {
            if (cue.damaged) {
              const struck = localActors.get(cue.damaged);
              if (struck && struck.koAt === undefined) {
                const reaction = cue.ko === cue.damaged ? 'FightKO' : cue.kind === 'light' ? 'FightHitLight' : 'FightHitHeavy';
                if (!play(cue.damaged, reaction) && cue.ko !== cue.damaged) play(cue.damaged, 'Idle');
                if (cue.ko === cue.damaged && !struck.animations.some(c => c.name === 'FightKO') && struck.current) struck.current.paused = true;
                if (cue.ko === cue.damaged) struck.koAt = poseNow;
                struck.hitAt = poseNow; struck.freezeUntil = poseNow + cue.timing.stopMs;
                cameraCue.current.shakeFrames = 2;
              }
            } else if (cue.evade) play(cue.target, 'Evade');
            if (__DEV__) console.info('[HolobotPace:contact] ' + JSON.stringify({ id: cue.id, bot: actor.id, clip: cue.clip, contactSeconds: cue.timing.contactSeconds, windupMs: cue.timing.windupMs, clockMs: poseNow, ko: cue.ko }));
          } else if (actor.paceAction && actor.current === actor.paceAction && actor.koAt === undefined) {
            actor.paceAction = undefined;
            if (cue.kind === 'guard' && __DEV__) console.info('[HolobotPace:guard] ' + JSON.stringify({ id: cue.id, bot: actor.id, clip: cue.clip, phase: 'idle', clockMs: poseNow, utc: new Date().toISOString() }));
            if (!play(cue.attacker, 'FightIdle')) play(cue.attacker, 'Idle');
          }
        }
        if (events.some(event => event.type === 'finish' || event.type === 'cancel')) callbacks.current.onPresentationDrain?.();
        const terminalNow = terminalRef.current;
        if (terminalNow && pace.current.idle) for (const side of terminalNow.defeated) {
          const actor = localActors.get(side);
          if (actor && actor.koAt === undefined) {
            const hasKo = play(side, 'FightKO');
            if (!hasKo && actor.current) actor.current.paused = true; // legacy bundle: hold the visible pose, never fake a KO clip
            actor.koAt = poseNow;
          }
        }
        const pose = pace.current.sample();
        localActors.forEach((actor, side) => {
          const ownsAttack = pose?.cue.attacker === side && actor.paceAction === actor.current && actor.koAt === undefined;
          if (ownsAttack && actor.current) actor.current.time = pose.clipSeconds;
          else if (actor.current) actor.current.setEffectiveTimeScale(poseNow < (actor.freezeUntil ?? 0) ? 0 : 1);
          if (!step) actor.mixer.update(elapsed / 1000);
          else if (step.applyMs !== null) actor.mixer.update(step.applyMs / 1000);
          else if (events.length) actor.mixer.update(0); // never skip the first contact pose at low mixer Hz
          const hitElapsed = actor.hitAt === undefined ? Infinity : poseNow - actor.hitAt;
          actor.root.position.copy(actor.base)
            .addScaledVector(actor.away, ownsAttack ? -pose.lungeM : 0)
            .addScaledVector(actor.away, hitElapsed < 180 ? Math.sin(hitElapsed / 180 * Math.PI) * .06 : 0);
          for (const row of actor.flashMaterials) {
            row.material.emissive.copy(row.color);
            row.material.emissiveIntensity = row.intensity;
            if (hitElapsed < 50) { row.material.emissive.lerp(whiteFlash, .55); row.material.emissiveIntensity = Math.max(.6, row.intensity); }
          }
          if (actor.guardRim) {
            const guard = guardVisual(poseNow, actor.guardAt);
            actor.guardRim.material.opacity = guard.opacity;
            actor.guardRim.visible = guard.visible;
          }
        });
        camera.position.copy(cameraHome);
        if (portrait) {
          // lite-2305-1 special beat; at weight 0 this is exactly the home pose (same position, aim and FOV as before).
          const beat = cameraCue.current.beat;
          const weight = beat ? specialCameraWeight(poseNow / 1000, beat.startS, beat.holdEndS) : 0;
          if (beat && weight === 0 && poseNow / 1000 > beat.holdEndS) cameraCue.current.beat = null;
          const pose = specialCameraPose(weight, { y: cameraHome.y, z: cameraHome.z, aimY: 0.9, fovDeg: cameraFovHome });
          camera.position.y = pose.y; camera.position.z = pose.z;
          camera.lookAt(0, pose.aimY, 0);
          if (pose.fovDeg !== cameraFov) { cameraFov = pose.fovDeg; camera.fov = cameraFov; camera.updateProjectionMatrix(); }
        }
        const strikeElapsed = poseNow - cameraCue.current.strikeAt;
        if (portrait && strikeElapsed < 700) camera.position.z -= 0.18 * Math.sin(strikeElapsed / 700 * Math.PI);
        if (cameraCue.current.shakeFrames > 0) { camera.position.x += cameraCue.current.shakeFrames === 2 ? 0.012 : -0.012; cameraCue.current.shakeFrames--; }
        // Expo's native presentation can leave another framebuffer bound between frames.
        // Three caches its null binding, so restore Expo's current default explicitly.
        camera.updateMatrixWorld();
        vfxRef.current?.player.update(poseNow / 1000);
        const prepEnd = knobs ? performance.now() : 0;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        renderer!.render(scene, camera);
        const renderEnd = knobs ? performance.now() : 0;
        // Bound native work to one frame. endFrameEXP alone queues asynchronously,
        // which can report 60 JS fps while a software GPU builds an unbounded backlog.
        if (Platform.OS !== 'web') gl.finish();
        gl.endFrameEXP();
        if (Platform.OS !== 'web') gl.flushEXP();
        const koReady = !!terminalNow && pace.current.idle && terminalNow.defeated.every(side => {
          const actor = localActors.get(side);
          return !actor || (actor.koAt !== undefined && (!actor.animations.some(c => c.name === 'FightKO') || !actor.current || actor.current.time >= actor.current.getClip().duration - 0.0001));
        });
        const hadEndpoint = koGate.current.finalPoseSince !== null;
        const terminalDone = koGate.current.advance(terminalNow?.id ?? null, poseNow, koReady);
        if (__DEV__ && !hadEndpoint && koGate.current.finalPoseSince !== null) console.info('[HolobotPace:ko-endpoint] ' + JSON.stringify({ id: terminalNow?.id, clockMs: poseNow, utc: new Date().toISOString() }));
        if (terminalDone) {
          if (__DEV__) console.info('[HolobotPace:terminal] ' + JSON.stringify({ id: terminalNow!.id, clockMs: poseNow, finalPoseHoldMs: 2000, utc: new Date().toISOString() }));
          callbacks.current.onTerminalComplete?.(terminalNow!.id);
        }
        frames++; sampleFrames++;
        if (knobs && !perfWindow.done) {
          const completed = performance.now();
          perfFrames.push({ atMs: completed, prepMs: prepEnd - now, renderMs: renderEnd - prepEnd, barrierMs: completed - renderEnd, drawCalls: renderer!.info.render.calls, triangles: renderer!.info.render.triangles, glCalls: glCalls - glCallsAtFrame });
          if (!perfWindow.armed && completed >= perfWindow.start) { perfWindow.armed = true; perfWindow.renders = renderCount.current; perfWindow.names = { ...glCallNames }; }
          if (completed >= perfWindow.end) {
            perfWindow.done = true;
            const summary = summarizeArm(perfFrames, perfWindow.start, perfWindow.end);
            const perFrame: Record<string, number> = {};
            for (const [name, count] of Object.entries(glCallNames)) { const delta = count - (perfWindow.names[name] ?? 0); if (delta > 0 && summary.frames) perFrame[name] = Math.round(delta / summary.frames * 10) / 10; }
            const result: PerfArmResult = { arm: perfArm!.arm, knobs: knobs, contextId: gl.contextId, drawWidth: renderWidth, drawHeight: renderHeight, loadMs, renderer: probe?.renderer, defaultFramebufferSamples: probe?.defaultFramebufferSamples, reactRendersPerSecond: Math.round((renderCount.current - perfWindow.renders) / (PERF_ARM_MEASURE_MS / 1000) * 10) / 10, glCallsByNamePerFrame: perFrame, summary };
            console.info('[HolobotViewer:perfArm] ' + JSON.stringify(result));
            perfRef.current?.onArmDone?.(result);
          }
        }
        if (now - sampleStart >= 2000) { emit(sampleFrames * 1000 / (now - sampleStart)); sampleFrames = 0; sampleStart = now; }
      };
      phase = 'first render';
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      renderer.render(scene, camera);
      if (Platform.OS !== 'web') gl.finish();
      gl.endFrameEXP();
      if (Platform.OS !== 'web') gl.flushEXP();
      loadMs = Math.round(performance.now() - start);
      if (knobs) {
        console.info('[HolobotViewer:inventory] ' + JSON.stringify({ arm: perfArm!.arm, contextId: gl.contextId, drawWidth: renderWidth, drawHeight: renderHeight, loadMs, ...stageInventory(scene, renderer, [...localActors].map(([side, actor]) => ({ side, mixer: actor.mixer, clips: actor.animations.length }))) }));
        perfWindow.start = performance.now() + PERF_ARM_WARMUP_MS; perfWindow.end = perfWindow.start + PERF_ARM_MEASURE_MS;
      }
      setLoaded(true); callbacks.current.onReady?.(); emit(0);
      sampleStart = lastFrame = performance.now(); frameId = requestAnimationFrame(render);
    } catch (cause) {
      if (!alive || ticket !== generation.current || !mounted.current) return;
      const message = `${phase}: ${cause instanceof Error ? cause.message || cause.name : String(cause)}`;
      disposeRef.current();
      setError(message); callbacks.current.onError?.(message);
      if (__DEV__) console.warn('[HolobotViewer:error] ' + JSON.stringify({ phase, message, stack: cause instanceof Error ? cause.stack : String(cause) }));
    }
  }, [signature, play, fireFx, showMetrics, vfx, vfxUnbuiltKits]);

  return <View collapsable={false} onLayout={({ nativeEvent }) => { const { width, height } = nativeEvent.layout; if (width > 0 && height > 0) setLayout(current => current.width === width && current.height === height ? current : { width, height }); }} style={[styles.container, transparentBackdrop && { backgroundColor: 'transparent' }, StyleSheet.flatten(style)?.position !== 'absolute' && { height: 260 }, style]} accessibilityLabel={bots.map(bot => bot.id.toUpperCase()).join(' versus ') + ' 3D Holobot viewer'}>
    {layout.width > 0 && layout.height > 0 && <GLView key={signature} collapsable={false} style={{ position: 'absolute', width: layout.width * scale, height: layout.height * scale, left: layout.width * (1 - scale) / 2, top: layout.height * (1 - scale) / 2, transform: [{ scale: 1 / scale }] }} onContextCreate={createContext} msaaSamples={renderSettings.msaaSamples} />}
    {!loaded && !error && <View style={styles.overlay}><ActivityIndicator color={theme.colors.accent} /><Text style={styles.loading} numberOfLines={2}>LOADING</Text></View>}
    {error && <View style={styles.overlay}><Text style={styles.error}>3D preview unavailable</Text><Text style={styles.errorDetail}>{showMetrics ? error : 'Try opening this preview again.'}</Text></View>}
    {showMetrics && metrics && <Text style={styles.metrics}>{metrics.loadMs} ms · {metrics.fps ? `${metrics.fps} fps` : 'warming up'} · {(metrics.assetBytes / 1e6).toFixed(2)} MB</Text>}
  </View>;
});
const styles = StyleSheet.create({ container: { overflow: 'hidden', backgroundColor: theme.colors.carbon, borderRadius: 14 }, overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 8, backgroundColor: theme.colors.carbon }, loading: { textAlign: 'center', color: theme.colors.muted, fontSize: 10, letterSpacing: 2, marginTop: 12 }, error: { color: theme.colors.orange, fontWeight: '700' }, errorDetail: { color: theme.colors.subtle, fontSize: 11, marginTop: 8, textAlign: 'center' }, metrics: { position: 'absolute', bottom: 8, left: 10, color: theme.colors.muted, fontSize: 10, backgroundColor: '#101318CC', padding: 4 } });
