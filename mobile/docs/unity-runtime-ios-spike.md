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

## Session and manual entry follow-up

HomeScreen now has a manual ENTER HOLOCITY control and a visible unavailable dialog. No automatic launch occurs. The native Unity window has a safe-area top-trailing “Back to dashboard” button emitting `runtime-exit-1`; JavaScript follows the same acknowledged session-end path before removing its listener and pausing/closing.

`nativeUnitySession.ts` awaits real ready, then a matching attached acknowledgement, then authenticated travel-squad refresh. Readiness is bounded at fifteen seconds, including a stuck native open call. Close waits for ended acknowledgement with a two-second fallback. Concurrent close callers share completion; failed native close still clears the session guard. Foreign, malformed, closed-session, and wrong-account messages are discarded.

Executed mocked-native/auth suite: fourteen tests pass. Combined squad/session tests: thirty-three pass. Mobile TypeScript passes. Updated native unavailable branch recompiles to an arm64 simulator object without diagnostics. These are transport/lifecycle unit checks, not an embedded Unity or device-layout witness. The framework-present branch and actual navigation rendering remain pending the real export.

## Real installed-header check

After iOS support installation, both native branches compile with zero diagnostics against Unity 6000.5.4f1's real UnityFramework/UnityAppController/RenderPluginDelegate/LifeCycleListener headers. The obsolete `setExecuteHeader` call was removed because this exact header marks it “Not used anymore.” Reproduce with `python3 mobile/scripts/verify_unity_native_headers.py`; it copies unchanged real headers to a temporary include layout, emits two arm64 simulator objects and records source hashes. This proves Objective-C API compatibility, not framework link or runtime behavior.

Optional attachment helper: `python3 mobile/scripts/build_unity_simulator.py --derived-data <fresh-vault-output> --framework <vault/UnityFramework.framework>`. It requires a real simulator Mach-O framework with bundled Data, adds search/link flags only to that invocation, builds the host, copies the framework into the output app, and ad-hoc signs simulator output. Omitting `--framework` keeps the ordinary unavailable host build. It rejects binaries or DerivedData inside git. The helper's argument parsing was checked; no duplicate full app build was run while the main lane's build was active. Framework export, attachment and execution remain main-lane gates.

### Export build and SDK-scoped attachment helpers

Build a completed Unity Simulator export with `python3 scripts/build_unity_framework.py --export <vault>/UnityExport --derived-data <fresh-vault-directory>`. This builds only the real UnityFramework target with two jobs, verifies the framework bundle identifier, and copies the export's Data directory into the framework. This matches the native module's `com.unity3d.framework` data-bundle selection. It does not invoke Unity or modify the export.

Then use `build_unity_simulator.py --framework <built-framework> --derived-data <another-fresh-vault-directory>`. Its temporary configuration scopes framework search paths, linker flags and runtime search paths to `iphonesimulator*`; Watch targets do not inherit Unity linkage. Omitting `--framework` preserves the ordinary unavailable-runtime host build. Both helpers refuse checkout-local binaries and existing build-output directories. Device frameworks and missing runtime Data are rejected before host compilation.

Verification: `python3 scripts/test_unity_build_helpers.py` passes eleven isolated mocked-subprocess cases covering SDK-scoped flags, ordinary host behavior, exported Data copying, job count, bundle identity, device rejection, missing inputs, existing output and symlink checkout guards. Both command-line help paths pass. No app or framework build was launched for this helper change; actual linking and launch remain separate gates. Test framework placeholders exist only inside temporary test directories and never represent a usable runtime.
