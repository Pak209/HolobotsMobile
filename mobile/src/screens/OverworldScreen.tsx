import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View, type AppStateStatus } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { HomeCogButton } from "@/components/HomeCogButton";
import { Minimap, type MinimapMap, type MinimapPlayer } from "@/components/story/Minimap";
import { QuestBanner } from "@/components/story/QuestBanner";
import { StoryDialogueOverlay } from "@/components/story/StoryDialogueOverlay";
import { StoryUpdateRequiredCard } from "@/components/story/StoryUpdateRequiredCard";
import { getHolobotHeadshotImageSource } from "@/config/holobots";
import {
  getHttpOrigin,
  isAllowedOverworldOrigin,
  STORY_FLAG_GUIDE_MET,
  STORY_OVERWORLD_URL,
  STORY_PROTOCOL_VERSION,
  STORY_ZONE_DEFAULT,
} from "@/config/storyMode";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildAppEventMessage,
  buildDialogueStateMessage,
  buildRegionAccessMessage,
  buildStoryStateMessage,
  createStoryBridgeContext,
  decodeWalkableMask,
  interpretInbound,
  makeAck,
  parseInboundMessage,
  type StoryAck,
  type StoryEnvelope,
} from "@/lib/story/storyBridge";
import { shouldShowLoadingOverlay } from "@/lib/story/overlayVisibility";
import { createLocalStoryFlagStore, type StoryFlagStore } from "@/lib/story/storyFlags";
import type { RootTabs } from "../../App";

/**
 * Story Mode slice 0 host screen. Loads the Pixi overworld in a WebView and
 * speaks docs/STORY_BRIDGE_CONTRACT.md. Unlike WebSectionScreen this screen
 * NEVER injects the Firebase custom token — the overworld has no Firebase.
 */

const GUIDE_DIALOGUE = [
  "Pilot. You made it to the hangar district — the bays are quiet, but the bots aren't.",
  "Doors with a gold plate open into the old systems: the Gacha Hangar is just west of the plaza.",
  "I'll log that we've met. Come back when you've pulled something worth fighting with.",
];

// Injected before the page runs: a capability flag only. No secrets, no tokens.
const INJECTED_STORY_BRIDGE = `window.__HOLOBOTS_STORY_BRIDGE__={protocolVersion:${STORY_PROTOCOL_VERSION}};true;`;

type DialogueState = { npcId: string; speakerName: string; lines: string[] } | null;

// Stable identity while no dialogue is open — a fresh [] every render would
// churn the overlay's effect deps (Round E hooks-crash hardening).
const EMPTY_LINES: string[] = [];

export function OverworldScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { user } = useAuth();
  const webViewRef = useRef<WebView>(null);
  const bridgeContext = useRef(createStoryBridgeContext());
  const storeRef = useRef<StoryFlagStore | null>(null);
  const helloReceived = useRef(false);

  const [storeReady, setStoreReady] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogue, setDialogue] = useState<DialogueState>(null);
  const [mismatch, setMismatch] = useState<{ webProtocolVersion: number } | null>(null);
  // Round D overlays: map descriptor from BRIDGE_HELLO, throttled PLAYER_POS, objective from the flag store.
  const [mapInfo, setMapInfo] = useState<MinimapMap | null>(null);
  const [playerPos, setPlayerPos] = useState<(MinimapPlayer & { zone: string }) | null>(null);
  const [objectiveText, setObjectiveText] = useState<string | null>(null);

  const uriIsTrusted = useMemo(() => isAllowedOverworldOrigin(STORY_OVERWORLD_URL), []);
  const originWhitelist = useMemo(() => {
    const list = ["https://*"];
    const devOrigin = getHttpOrigin(STORY_OVERWORLD_URL);
    if (__DEV__ && devOrigin) list.push(devOrigin);
    return list;
  }, []);
  const guidePortrait = useMemo(() => getHolobotHeadshotImageSource("ACE"), []);

  // Local flag store, keyed by the signed-in uid. Loaded before the WebView mounts.
  useEffect(() => {
    let active = true;
    setStoreReady(false);
    if (!user?.uid) {
      storeRef.current = null;
      return () => {
        active = false;
      };
    }
    const store = createLocalStoryFlagStore(user.uid);
    storeRef.current = store;
    const syncObjective = () => {
      if (active) setObjectiveText(store.getObjective()?.text ?? null);
    };
    const unsubscribe = store.subscribe(syncObjective);
    void store.load().finally(() => {
      if (active) {
        syncObjective();
        setStoreReady(true);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user?.uid]);

  const postToWeb = useCallback((message: StoryEnvelope | StoryAck) => {
    webViewRef.current?.postMessage(JSON.stringify(message));
  }, []);

  const pushStoryState = useCallback(() => {
    const store = storeRef.current;
    if (!store || !helloReceived.current) return;
    postToWeb(
      buildStoryStateMessage({
        checkpoint: store.getCheckpoint(),
        currentObjective: store.getObjective(),
        flags: store.getFlags(),
        regionsUnlocked: [],
      }),
    );
  }, [postToWeb]);

  // Re-hydrate the overworld on focus and on app foreground (contract §D/§E).
  useFocusEffect(
    useCallback(() => {
      pushStoryState();
    }, [pushStoryState]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (!helloReceived.current) return;
      if (status === "active") {
        postToWeb(buildAppEventMessage("foreground"));
        pushStoryState();
      } else if (status === "background" || status === "inactive") {
        postToWeb(buildAppEventMessage("background"));
      }
    });
    return () => subscription.remove();
  }, [postToWeb, pushStoryState]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const context = bridgeContext.current;
      context.now = Date.now();
      const parsed = parseInboundMessage(event.nativeEvent.data, context);
      if (!parsed.ok) {
        // No trustworthy id to reply to; log and drop (contract §B: never throw).
        if (__DEV__) console.warn("[story-bridge] dropped inbound:", parsed.error);
        return;
      }

      const { envelope } = parsed;
      const interpreted = interpretInbound(envelope);
      if (!interpreted.ok) {
        postToWeb(makeAck(envelope.id, false, interpreted.error));
        if (interpreted.error === "PROTOCOL_MISMATCH" && envelope.type === "BRIDGE_HELLO") {
          const payload = envelope.payload as { protocolVersion?: unknown };
          setMismatch({
            webProtocolVersion: typeof payload.protocolVersion === "number" ? payload.protocolVersion : 0,
          });
        }
        return;
      }

      const store = storeRef.current;
      const { command } = interpreted;
      switch (command.type) {
        case "BRIDGE_HELLO":
          helloReceived.current = true;
          // A HELLO proves the page JS is alive — drop the opaque loading
          // overlay even if react-native-webview never delivered onLoadEnd.
          setPageLoading(false);
          setMismatch(null);
          if (command.map) {
            const { width, height, walkable, pois } = command.map;
            setMapInfo({ height, pois, walkable: decodeWalkableMask(walkable, width, height), width });
          }
          postToWeb(makeAck(envelope.id, true));
          pushStoryState();
          return;
        case "PLAYER_POS":
          postToWeb(makeAck(envelope.id, true));
          setPlayerPos((previous) =>
            previous &&
            previous.x === command.x &&
            previous.y === command.y &&
            previous.facing === command.facing &&
            previous.zone === command.zone
              ? previous
              : { facing: command.facing, x: command.x, y: command.y, zone: command.zone },
          );
          return;
        case "TALK_NPC":
          postToWeb(makeAck(envelope.id, true));
          setDialogue({ lines: GUIDE_DIALOGUE, npcId: command.npcId, speakerName: "Guide" });
          // Round C: let the overworld lock movement / hide controls while the overlay is open.
          postToWeb(buildDialogueStateMessage(true, command.npcId));
          return;
        case "ENTER_BUILDING":
          postToWeb(makeAck(envelope.id, true));
          navigation.navigate("Gacha");
          return;
        case "SET_STORY_FLAG":
          postToWeb(makeAck(envelope.id, true));
          void store?.setFlag(command.flag, command.value).then(pushStoryState);
          return;
        case "SAVE_CHECKPOINT":
          postToWeb(makeAck(envelope.id, true));
          void store?.setCheckpoint(command.checkpoint);
          return;
        case "REQUEST_REGION_ACCESS":
          postToWeb(makeAck(envelope.id, true));
          postToWeb(buildRegionAccessMessage(command.regionId, false, "NOT_IN_SLICE_0"));
          return;
        case "START_ENCOUNTER":
          // interpretInbound already answers LOCKED in slice 0; unreachable, kept for exhaustiveness.
          postToWeb(makeAck(envelope.id, false, "LOCKED"));
          return;
        default:
          return;
      }
    },
    [navigation, postToWeb, pushStoryState],
  );

  const handleDialogueFinished = useCallback(() => {
    const finished = dialogue;
    setDialogue(null);
    if (!finished) return;
    // Unlock the overworld first, then commit the native-authored progression flag
    // (never from the WebView) and re-hydrate via STORY_STATE.
    postToWeb(buildDialogueStateMessage(false, finished.npcId));
    void storeRef.current?.setFlag(STORY_FLAG_GUIDE_MET, true).then(pushStoryState);
  }, [dialogue, postToWeb, pushStoryState]);

  const showBlockedOverlay = !uriIsTrusted;
  const showLoading = shouldShowLoadingOverlay({
    blocked: showBlockedOverlay,
    helloReceived: helloReceived.current,
    loadError: loadError !== null,
    pageLoading,
    storeReady,
  });

  return (
    <View style={styles.page}>
      <HomeCogButton />
      {showBlockedOverlay ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Overworld Blocked</Text>
          <Text style={styles.errorCopy}>{`The overworld address is not on the allowed origin list.\n${STORY_OVERWORLD_URL}`}</Text>
        </View>
      ) : null}
      {loadError ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Overworld Failed To Load</Text>
          <Text style={styles.errorCopy}>{loadError}</Text>
          {__DEV__ ? <Text style={styles.errorCopy}>{`Is the Vite dev server running at ${STORY_OVERWORLD_URL}?`}</Text> : null}
        </View>
      ) : null}
      {showLoading ? (
        <View style={styles.overlay}>
          <ActivityIndicator color="#f0bf14" size="large" />
          <Text style={styles.overlayText}>Powering up the hangar district…</Text>
        </View>
      ) : null}
      {!showBlockedOverlay && storeReady ? (
        <WebView
          ref={webViewRef}
          allowsInlineMediaPlayback
          // Touch hygiene (iOS 14.5+): the game canvas has no text — disable WKWebView text
          // interaction so long-presses on the D-pad never raise the loupe / Copy-Look Up menu,
          // and drop link previews. Android selection is covered by the web-side CSS
          // (user-select / -webkit-touch-callout: none); no Android-only prop this round.
          allowsLinkPreview={false}
          textInteractionEnabled={false}
          injectedJavaScriptBeforeContentLoaded={INJECTED_STORY_BRIDGE}
          javaScriptCanOpenWindowsAutomatically={false}
          onError={(event) => setLoadError(event.nativeEvent.description || "Unknown WebView error.")}
          onHttpError={(event) => setLoadError(`HTTP ${event.nativeEvent.statusCode} from the overworld host.`)}
          onLoadEnd={() => setPageLoading(false)}
          onLoadStart={() => {
            helloReceived.current = false;
            setPageLoading(true);
            setLoadError(null);
            setPlayerPos(null);
          }}
          onMessage={handleMessage}
          onShouldStartLoadWithRequest={(request) => isAllowedOverworldOrigin(request.url)}
          originWhitelist={originWhitelist}
          setSupportMultipleWindows={false}
          source={{ uri: STORY_OVERWORLD_URL }}
          style={styles.webview}
        />
      ) : null}
      {!showBlockedOverlay && storeReady && !mismatch ? (
        <>
          <QuestBanner objective={objectiveText} zone={playerPos?.zone ?? STORY_ZONE_DEFAULT} />
          <Minimap map={mapInfo} player={playerPos} />
        </>
      ) : null}
      <StoryDialogueOverlay
        lines={dialogue?.lines ?? EMPTY_LINES}
        onFinished={handleDialogueFinished}
        portrait={guidePortrait}
        speakerName={dialogue?.speakerName ?? ""}
        visible={dialogue !== null}
      />
      {mismatch ? (
        <StoryUpdateRequiredCard
          appProtocolVersion={STORY_PROTOCOL_VERSION}
          onBack={() => navigation.navigate("Home")}
          webProtocolVersion={mismatch.webProtocolVersion}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  errorCopy: {
    color: "#f5e9ca",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  errorTitle: {
    color: "#ff8269",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "#050606",
    justifyContent: "center",
    paddingHorizontal: 24,
    zIndex: 5,
  },
  overlayText: {
    color: "#fef1e0",
    fontSize: 15,
    marginTop: 12,
  },
  page: {
    backgroundColor: "#050606",
    flex: 1,
  },
  webview: {
    backgroundColor: "#1d1d1d",
    flex: 1,
  },
});
