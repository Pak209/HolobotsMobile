import { guardVisual } from '../../lib/bots/guardVisual';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, AppState, PixelRatio, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import Renderer from 'expo-three/build/Renderer';
import * as THREE from 'three';
import { theme } from '../../theme';
import { BOT_MANIFEST, type BotId } from '../../../../assets/bots';
import { disposeBot, loadBot } from '../../lib/bots/loadBot';
import { resolveClipName } from '../../lib/bots/animationClips';
import { prepareBotMaterials, type BotMaterialQuality } from '../../lib/bots/materials';

export type BotMetrics = { botId: string; loadMs: number; fps: number; frames: number; assetBytes: number; platform: string; drawWidth: number; drawHeight: number; contextId: number; materialQuality: BotMaterialQuality; renderScale: number };
export type StageBot = { id: BotId; side: string };
export type BotStageHandle = { play(side: string, clipName: string): boolean; strike(side: string): void; hit(side: string): void; guard(side: string): void };
type Props = { bots: readonly StageBot[]; style?: StyleProp<ViewStyle>; variant?: 'viewer' | 'duelPortrait'; transparentBackdrop?: boolean; renderScale?: number; materialQuality?: BotMaterialQuality; active?: boolean; onReady?: () => void; onError?: (message: string) => void; onMetrics?: (metrics: BotMetrics) => void; showMetrics?: boolean };
type Actor = { id: BotId; root: THREE.Group; mixer: THREE.AnimationMixer; animations: THREE.AnimationClip[]; current?: THREE.AnimationAction; hitAt?: number; guardAt?: number; base: THREE.Vector3; away: THREE.Vector3; guardRim?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> };

export const BotStage = forwardRef<BotStageHandle, Props>(function BotStage({ bots, style, variant = 'viewer', transparentBackdrop = false, renderScale = Platform.OS === 'web' ? 1 : 1 / PixelRatio.get(), materialQuality = 'balanced', active = true, onReady, onError, onMetrics, showMetrics = false }, ref) {
  const scale = Math.max(0.25, Math.min(1, renderScale));
  const signature = `${variant}:${transparentBackdrop}:${scale}:${materialQuality}:` + bots.map(bot => `${bot.side}:${bot.id}`).join('|');
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const drawSize = useRef({ width: 1, height: 1 });
  drawSize.current = { width: Math.max(1, Math.round(layout.width * scale * PixelRatio.get())), height: Math.max(1, Math.round(layout.height * scale * PixelRatio.get())) };
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [metrics, setMetrics] = useState<BotMetrics | null>(null);
  const actors = useRef(new Map<string, Actor>());
  const activeRef = useRef(active);
  const callbacks = useRef({ onReady, onError, onMetrics });
  callbacks.current = { onReady, onError, onMetrics };
  const disposeRef = useRef<() => void>(() => {});
  const generation = useRef(0);
  const mounted = useRef(true);
  const cameraCue = useRef({ strikeAt: -Infinity, shakeFrames: 0 });

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; disposeRef.current(); };
  }, []);

  const play = useCallback((side: string, clipName: string) => {
    const actor = actors.current.get(side);
    if (!actor) return false;
    const resolved = resolveClipName(clipName, actor.animations.map(clip => clip.name), BOT_MANIFEST[actor.id].idleClip, actor.id);
    const clip = actor.animations.find(candidate => candidate.name === resolved);
    if (!clip) return false;
    const next = actor.mixer.clipAction(clip);
    if (actor.current === next && next.isRunning()) return true;
    const loop = resolved === BOT_MANIFEST[actor.id].idleClip || /^(Walk|Run)$/i.test(resolved ?? '');
    next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    actor.current?.fadeOut(0.14);
    next.fadeIn(0.14);
    actor.current = next;
    return true;
  }, []);
  useImperativeHandle(ref, () => ({
    play,
    strike(side) { if (actors.current.has(side)) cameraCue.current.strikeAt = performance.now(); },
    hit(side) {
      const actor = actors.current.get(side);
      if (!actor) return;
      play(side, 'Idle'); actor.hitAt = performance.now(); cameraCue.current.shakeFrames = 2;
    },
    guard(side) {
      const actor = actors.current.get(side);
      if (!actor) return;
      if (!play(side, 'InterceptGuard') && !play(side, 'Guard')) play(side, 'Idle');
      actor.guardAt = performance.now();
    },
  }), [play]);

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
      appSubscription.remove();
      localActors.forEach(actor => { actor.mixer.stopAllAction(); actor.mixer.uncacheRoot(actor.root); });
      ownedRoots.forEach(disposeBot);
      if (actors.current === localActors) actors.current = new Map();
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
      renderer = new Renderer({ gl, antialias: true, alpha: transparentBackdrop });
      phase = 'renderer configuration';
      // Expo's drawingBuffer dimensions are initial values, not live layout getters.
      let renderWidth = drawSize.current.width, renderHeight = drawSize.current.height;
      renderer.setSize(renderWidth, renderHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(theme.colors.carbon, transparentBackdrop ? 0 : 1);
      renderer.debug.onShaderError = (context, program, vertex, fragment) => { if (__DEV__) console.warn('[HolobotViewer:shader] ' + JSON.stringify({ program: context.getProgramInfoLog(program), vertex: context.getShaderInfoLog(vertex), fragment: context.getShaderInfoLog(fragment) })); };
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
      await Promise.all(bots.map(async (bot, index) => {
        const gltf = await loadBot(bot.id, nextPhase => { phase = `${bot.id}: ${nextPhase}`; });
        if (!alive || ticket !== generation.current || !mounted.current) { disposeBot(gltf.scene); return; }
        prepareBotMaterials(gltf.scene, materialQuality);
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
        const actor: Actor = { id: bot.id, root, mixer, animations: gltf.animations, base: root.position.clone(), away: new THREE.Vector3(root.position.x, 0, root.position.z).normalize() };
        localActors.set(bot.side, actor); scene.add(root); ownedRoots.push(root);
        mixer.addEventListener('finished', event => { if (event.action === actor.current) play(bot.side, 'Idle'); });
      }));
      if (!alive || ticket !== generation.current || !mounted.current) return;
      phase = 'animation setup';
      actors.current = localActors;
      cameraCue.current = { strikeAt: -Infinity, shakeFrames: 0 };
      bots.forEach(bot => play(bot.side, 'Idle'));
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

      let loadMs = 0;
      const cameraHome = camera.position.clone();
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
        localActors.forEach(actor => {
          actor.mixer.update(elapsed / 1000);
          const hitElapsed = actor.hitAt === undefined ? Infinity : now - actor.hitAt;
          // The source fleet has no HitLight take; a short additive recoil is presentation only.
          actor.root.position.copy(actor.base).addScaledVector(actor.away, hitElapsed < 280 ? Math.sin(hitElapsed / 280 * Math.PI) * 0.08 : 0);
          if (actor.guardRim) {
            const guard = guardVisual(now, actor.guardAt);
            actor.guardRim.material.opacity = guard.opacity;
            actor.guardRim.visible = guard.visible;
          }
        });
        camera.position.copy(cameraHome);
        const strikeElapsed = now - cameraCue.current.strikeAt;
        if (portrait && strikeElapsed < 700) camera.position.z -= 0.18 * Math.sin(strikeElapsed / 700 * Math.PI);
        if (cameraCue.current.shakeFrames > 0) { camera.position.x += cameraCue.current.shakeFrames === 2 ? 0.012 : -0.012; cameraCue.current.shakeFrames--; }
        // Expo's native presentation can leave another framebuffer bound between frames.
        // Three caches its null binding, so restore Expo's current default explicitly.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        renderer!.render(scene, camera);
        // Bound native work to one frame. endFrameEXP alone queues asynchronously,
        // which can report 60 JS fps while a software GPU builds an unbounded backlog.
        if (Platform.OS !== 'web') gl.finish();
        gl.endFrameEXP();
        if (Platform.OS !== 'web') gl.flushEXP();
        frames++; sampleFrames++;
        if (now - sampleStart >= 2000) { emit(sampleFrames * 1000 / (now - sampleStart)); sampleFrames = 0; sampleStart = now; }
      };
      phase = 'first render';
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      renderer.render(scene, camera);
      if (Platform.OS !== 'web') gl.finish();
      gl.endFrameEXP();
      if (Platform.OS !== 'web') gl.flushEXP();
      loadMs = Math.round(performance.now() - start);
      setLoaded(true); callbacks.current.onReady?.(); emit(0);
      sampleStart = lastFrame = performance.now(); frameId = requestAnimationFrame(render);
    } catch (cause) {
      if (!alive || ticket !== generation.current || !mounted.current) return;
      const message = `${phase}: ${cause instanceof Error ? cause.message || cause.name : String(cause)}`;
      disposeRef.current();
      setError(message); callbacks.current.onError?.(message);
      if (__DEV__) console.warn('[HolobotViewer:error] ' + JSON.stringify({ phase, message, stack: cause instanceof Error ? cause.stack : String(cause) }));
    }
  }, [signature, play, showMetrics]);

  return <View collapsable={false} onLayout={({ nativeEvent }) => { const { width, height } = nativeEvent.layout; if (width > 0 && height > 0) setLayout(current => current.width === width && current.height === height ? current : { width, height }); }} style={[styles.container, transparentBackdrop && { backgroundColor: 'transparent' }, StyleSheet.flatten(style)?.position !== 'absolute' && { height: 260 }, style]} accessibilityLabel={bots.map(bot => bot.id.toUpperCase()).join(' versus ') + ' 3D Holobot viewer'}>
    {layout.width > 0 && layout.height > 0 && <GLView key={signature} collapsable={false} style={{ position: 'absolute', width: layout.width * scale, height: layout.height * scale, left: layout.width * (1 - scale) / 2, top: layout.height * (1 - scale) / 2, transform: [{ scale: 1 / scale }] }} onContextCreate={createContext} msaaSamples={1} />}
    {!loaded && !error && <View style={styles.overlay}><ActivityIndicator color={theme.colors.accent} /><Text style={styles.loading} numberOfLines={2}>LOADING</Text></View>}
    {error && <View style={styles.overlay}><Text style={styles.error}>3D preview unavailable</Text><Text style={styles.errorDetail}>{showMetrics ? error : 'Try opening this preview again.'}</Text></View>}
    {showMetrics && metrics && <Text style={styles.metrics}>{metrics.loadMs} ms · {metrics.fps ? `${metrics.fps} fps` : 'warming up'} · {(metrics.assetBytes / 1e6).toFixed(2)} MB</Text>}
  </View>;
});
const styles = StyleSheet.create({ container: { overflow: 'hidden', backgroundColor: theme.colors.carbon, borderRadius: 14 }, overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 8, backgroundColor: theme.colors.carbon }, loading: { textAlign: 'center', color: theme.colors.muted, fontSize: 10, letterSpacing: 2, marginTop: 12 }, error: { color: theme.colors.orange, fontWeight: '700' }, errorDetail: { color: theme.colors.subtle, fontSize: 11, marginTop: 8, textAlign: 'center' }, metrics: { position: 'absolute', bottom: 8, left: 10, color: theme.colors.muted, fontSize: 10, backgroundColor: '#101318CC', padding: 4 } });
