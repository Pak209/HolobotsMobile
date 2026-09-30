# iOS full-screen Unity runtime spike

Native module: `HolobotsUnityRuntime` (`RCTEventEmitter`). Only one retained UnityFramework runtime is loaded per process. Full-screen only; close pauses and hides its window, restoring the React host window. It does not quit or unload the engine. Reopen reuses it.

## Wire

Subscribe to `UnityMessage` **before** calling `open()`. Event body is `{ json: string }`. Unity's native C plugin posts `HolobotsUnityMessage` through NSNotificationCenter with `userInfo = @{ @"json": jsonString }`; notifications are marshalled to the main thread. Only bounded JSON objects are forwarded.

All five methods return Promises: `open()`, `pause()`, `resume()`, `close()`, `send(json)`.

`send` has a fixed destination, GameObject `HoloMobileBridge`, method `Receive`. It cannot target arbitrary Unity objects or methods. Resolve means native enqueue, not gameplay acknowledgement. The receiver must persist across scene loads.

`open` loads/shows only. It never creates host state or claims the scene is ready. JavaScript waits for an actual Unity `{"schemaVersion":"runtime-ready-1"}` before sending the session begin. Native caches only this real ready message for reopening the retained runtime. JavaScript owns session nonces and rejects messages from previous sessions; the native cache carries no session or authority.

Main lane's session contract: `native-session-1` with `sessionId` and `operation: begin|end`, attached acknowledgement before requests. Await Unity's end acknowledgement (with bounded timeout) before close; `send(end)` alone may still be queued when pause stops the engine.

## Lifecycle

App resign-active pauses the engine. Returning active resumes only an open view that was not manually paused. Removing the last RN listener or invalidating the module removes notification observation, pauses Unity and restores the host window. Closed/invalidated modules drop callbacks. No tokens, rolls, inventory, squad authority, or fabricated mock runtime live here.

## Validation performed

- Existing bare Expo/React Native project source registration: four explicit pbxproj lines; `plutil -lint` passes.
- Actual module compiled to arm64 iOS Simulator Mach-O object using installed iOS 26.5 SDK and installed React-Core headers: zero errors/warnings.
- `__has_include(<UnityFramework/UnityFramework.h>)` is false in the current host. In that configuration open/pause/resume/send reject `unavailable`; close remains safe and idempotent. No fake headers/runtime were substituted.

## Remaining installation and gates

No UnityFramework export/header exists yet, so framework-present compilation, full app link, device execution, full-screen window transition, actual runtime-ready handshake, background/foreground, end/close/reopen and logout-in-flight are NOT proven. This is a native host spike, not an embedded Unity acceptance claim.

Once the real Unity export is available, embed/sign UnityFramework in the app and expose its public headers to this target. Its Data must belong to the `com.unity3d.framework` bundle (or adjust the explicit data bundle id). Compile and run the real framework branch; never satisfy it with placeholder headers. Preserve existing RN and Watch targets. Framework binaries stay out of this source checkpoint.

API basis: https://docs.unity.com/en-us/engine/6000.0/manual/platform-specific/iphone/ios-developing/unityasa-library-ios
