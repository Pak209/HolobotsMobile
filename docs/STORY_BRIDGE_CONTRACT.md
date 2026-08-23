# Story Mode — WebView ↔ Native Bridge Contract v1

**Status: DRAFT v1 — 2026-08-22, pending Pak review.**
Companion docs: `docs/STORY_MODE_PLAN.md` (slices, cuts, kill condition) · `docs/ART_STYLE_GUIDE.md` (art direction).
Scope: the typed `postMessage` contract between the Pixi overworld (root Vite preview, hosted in a WebView) and the
native app, for Story Mode slices 0–2. Anything marked **proposed** does not exist in the repo yet.

## 0. What already exists (verified in-repo)

| Surface | File | Fact |
|---|---|---|
| Bridge token | `mobile/src/lib/webAuthBridge.ts` | `getWebviewBridgeToken()` → callable `createWebviewBridgeToken`; `buildBridgeInjectionScript()` sets `window.__HOLOBOTS_NATIVE_BRIDGE__ = { customToken }` |
| Origin gate | `mobile/src/lib/security/bridgeOrigin.ts` | `ALLOWED_BRIDGE_HOSTS = ["holobots.fun"]`; `isAllowedBridgeOrigin()` is https-only, exact host or subdomain |
| Host screen | `mobile/src/screens/WebSectionScreen.tsx` | `injectedJavaScriptBeforeContentLoaded`, `source={{ uri }}`, `originWhitelist={["https://*"]}`, `onShouldStartLoadWithRequest` confined to allowed origins; error UI "Web Login Bridge Failed" |
| Arena handoff | `mobile/src/stores/arena-battle-store.ts` | `startBattle(player, opponent, config?)`, `isAnimating`, `battleResult { winnerId, rewards }` |
| Arena types | `mobile/src/types/arena.ts` | `ArenaFighter` (L73), `BattleState.config?: ArenaBattleConfig` |
| Backend | `functions/src/index.ts` | 28 exported functions; **no story callable exists** — `completeStoryEncounter` below is proposed |

## A. Principles / security invariants

1. **WebView is stateless about battle outcomes.** It emits `START_ENCOUNTER`; native runs the existing arena engine; the
   server writes the result; the WebView is re-hydrated via `STORY_STATE`. It never caches or infers who won.
2. **No inbound reward or combat verbs.** `GRANT_REWARD` is **never** an inbound message. Rewards exist only as side effects
   of the server callable `completeStoryEncounter` (**proposed**); the WebView only ever *receives* `REWARD_GRANTED`.
3. **Story flags live server-side** in `users/{uid}/story/{chapterId}` (**proposed** subcollection, bounded docs), written
   **only by callables**; the client is read-only. Reason: a growing flags map on the profile doc would re-open the
   Firestore-rules 1000-expression / fat-account-write problem already paid for once (see memory: rules eval budget).
4. **Fitness region gates are evaluated server-side** from the synced fitness ledger. The WebView receives only booleans
   (`regionsUnlocked[]`, `REGION_ACCESS`). Never from client step counts.
5. **Versioned hosting + handshake.** The Pixi build is served at `/overworld/v<N>/` on a host present in
   `ALLOWED_BRIDGE_HOSTS` (**proposed**: add the overworld host). The WebView opens with `BRIDGE_HELLO { protocolVersion }`;
   mismatch → friendly "update required" card, never a broken map. `file://` bundling is rejected (fails `isAllowedBridgeOrigin`).

## B. Envelope

Transport: inbound `window.ReactNativeWebView.postMessage(JSON)`; outbound `webViewRef.postMessage(JSON)`.

```jsonc
// every message, both directions
{ "v": 1, "id": "<uuid>", "type": "<VERB>", "payload": { /* per-verb */ } }
// native ACK for every inbound message
{ "v": 1, "replyTo": "<id>", "ok": true }            // or { "ok": false, "error": "<CODE>" }
```

| Rule | Behavior |
|---|---|
| Unknown `type` or `v` ≠ 1 | reject + log; **never throw / never crash the screen** |
| Payload size | ≤ 4 KB, else `TOO_LARGE` |
| Rate | ≤ 20 inbound msg/s per session, else `RATE_LIMITED` (dropped, not queued) |
| Replay | duplicate `id` within a session is dropped silently |
| Idempotency | every server write carries the `encounterId` / `flag` id; retries are safe |
| Validation | hand-rolled type guards per verb; **no new dependencies** |

## C. Inbound verbs (WebView → native)

| Verb | Payload | Validation | Error codes |
|---|---|---|---|
| `BRIDGE_HELLO` | `{ protocolVersion: number, buildHash: string }` | first message of a session; native replies with `STORY_STATE` | `PROTOCOL_MISMATCH` |
| `ENTER_BUILDING` | `{ buildingId: string }` | allowlisted against the **server-delivered** building list | `UNKNOWN_BUILDING` |
| `START_ENCOUNTER` | `{ encounterId: string }` | opponent `ArenaFighter` + `ArenaBattleConfig` resolved from a **server-fetched** encounter table — never WebView-supplied stats; refused while a battle is live or `isAnimating`; refused if a prerequisite flag is unset server-side | `BUSY`, `LOCKED`, `UNKNOWN_ENCOUNTER` |
| `SET_STORY_FLAG` | `{ flag: string, value: boolean }` | only flags on an explicit **client-writable cosmetic allowlist**; progression flags rejected | `SERVER_ONLY`, `UNKNOWN_FLAG` |
| `SAVE_CHECKPOINT` | `{ mapId: string, x: number, y: number, facing: "up"\|"down"\|"left"\|"right" }` | ranges validated against the map; debounced ≥ 2 s | `INVALID_CHECKPOINT` |
| `REQUEST_REGION_ACCESS` | `{ regionId: string }` | native replies `REGION_ACCESS` (server-evaluated) | `UNKNOWN_REGION` |

Deliberately **absent** inbound: `GRANT_REWARD`, any combat verb (`PLAY_CARD`, `USE_MOVE`, …), any economy verb
(`PURCHASE_*`, `OPEN_PACK`, …), any stat/HP payload. Their absence is the structural guard against JRPG creep.

## D. Outbound verbs (native → WebView)

| Verb | Payload | When |
|---|---|---|
| `STORY_STATE` | `{ flags: Record<string, boolean>, regionsUnlocked: string[], checkpoint: {...} \| null, protocolVersion: number }` | on load (after `BRIDGE_HELLO`) and after **every** server write |
| `ENCOUNTER_RESULT` | `{ encounterId: string, outcome: "win" \| "loss" \| "abandon" }` | after `completeStoryEncounter` (**proposed**) returns |
| `REWARD_GRANTED` | `{ encounterId: string, rewards: {...} }` | display-only; economy already committed server-side |
| `REGION_ACCESS` | `{ regionId: string, unlocked: boolean, reason?: string }` | reply to `REQUEST_REGION_ACCESS` |
| `APP_EVENT` | `{ kind: "background" \| "foreground" }` | app lifecycle, so the WebView can pause/resume |

## E. Failure modes

| Failure | Behavior |
|---|---|
| WebView load fails / untrusted URI | existing `WebSectionScreen` error UI ("Web Login Bridge Failed" pattern); no bridge |
| `completeStoryEncounter` fails mid-encounter | battle result still shown natively; reward marked **pending**; retried on next `STORY_STATE` (idempotent by `encounterId`) |
| Protocol mismatch on `BRIDGE_HELLO` | blocking "update required" card; map not shown |
| Origin mismatch at runtime | bridge silently disabled + telemetry event; page still renders but cannot act |
| iOS WebView memory kill / backgrounded mid-dialogue | overworld position + dialogue cursor persisted by the WebView to `localStorage` **and** echoed via `SAVE_CHECKPOINT`; resume is idempotent from either source |
| Battle abandoned (app killed during arena) | store already handles `abandon`; `ENCOUNTER_RESULT { outcome: "abandon" }` on next load, no reward |

## F. Appendix — Risk register R1–R7

| # | Risk | Why it's real here | Mitigation |
|---|---|---|---|
| R1 | Two truths for battle state | `BattleArenaView` is shared by 1v1 / 3v3 / PvP; a WebView that caches outcomes will drift from the store | WebView stateless; native + server own outcomes; re-hydrate via `STORY_STATE` |
| R2 | Reward injection via bridge | economy is server-authoritative (28 fns, frozen fields in `firestore.rules`); any inbound grant is a client-trust hole | no inbound `GRANT_REWARD`; rewards only as callable side effects |
| R3 | Hosting / origin + version skew of the Pixi build | `file://` fails `isAllowedBridgeOrigin`; a hosted build can drift from the app binary | versioned path `/overworld/v<N>/` on an allowed host; `BRIDGE_HELLO` handshake |
| R4 | Story-flag write amplification vs. rules budget | fat profile docs previously bricked writes under the 1000-expression limit | `users/{uid}/story/{chapterId}` subcollection; callables-only writes |
| R5 | Fitness-gate spoofing | same class as the watch-reward desync bug; client step counts are trivially forged | gate evaluated server-side from the synced ledger; WebView gets booleans |
| R6 | iOS WebView lifecycle (memory kills, background mid-dialogue, `expo-video` / WKWebView contention) | arena already runs video/sheet animation on the same screen stack | `SAVE_CHECKPOINT` + `localStorage`; idempotent resume; `APP_EVENT` pause |
| R7 | JRPG scope creep (inventory UI in WebView, second combat engine) | Pak decision (2): one engine in slice 1 | verb list has no combat/economy inbound — enforced structurally, not by review |

## G. Architecture kill signal

If slice 0 needs **more than 2 inbound verbs beyond §C**, or **any** inbound reward/combat verb is proposed, the
"not a JRPG" premise is already failing — stop and re-plan before building further.

## H. Amendments

- **2026-08-22 (slice 0 build)** — Adds inbound `TALK_NPC { npcId: string }` (allowlisted npcIds, slice 0: `guide`;
  native opens the dialogue overlay; the resulting progression flag `npc.guide.met` is **native-authored**, never
  WebView-authored). This consumes **1 of the 2** extra inbound verbs permitted by §G. `START_ENCOUNTER` and
  `REQUEST_REGION_ACCESS` are accepted in slice 0 but answer `LOCKED` / `unlocked:false, reason:'NOT_IN_SLICE_0'`.
  Native implementation: `mobile/src/lib/story/storyBridge.ts` (pure core + vitest), `mobile/src/config/storyMode.ts`
  (protocol version, dev-origin gate), `mobile/src/screens/OverworldScreen.tsx` (host; injects only
  `window.__HOLOBOTS_STORY_BRIDGE__={protocolVersion}` — no auth token).
- **2026-08-23 — Touch hygiene (slice 0 hardening).** The overworld WebView assumes no text interaction: native sets
  `textInteractionEnabled={false}` + `allowsLinkPreview={false}` (iOS, react-native-webview 13.13.5); web sets
  `touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none` on canvas + controls and
  preventDefaults touchstart/contextmenu on control surfaces. Bridge/scroll semantics unchanged. Handshake: a HELLO
  timeout is recoverable (retry/backoff, "RECONNECTING…" banner); only a `PROTOCOL_MISMATCH` reply or `STORY_STATE`
  `protocolVersion≠1` latches the update-required state; HELLO is re-sent on WebView resume (visibilitychange).
- **2026-08-23 — Round C.** Adds OUTBOUND `DIALOGUE_STATE { open: boolean, npcId: string }` (native→web) so the overworld
  can lock movement / hide controls while the native dialogue overlay is open; it is outbound-only (no new inbound verb;
  §G unaffected). Web tolerates its absence (no lock) and auto-unlocks after 90 s if a close is never received.
  Native builder: `buildDialogueStateMessage()` in `mobile/src/lib/story/storyBridge.ts`; sent on overlay open/finish.
