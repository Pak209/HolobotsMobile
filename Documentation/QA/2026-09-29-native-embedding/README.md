# Native mobile connection — implementation plan and spike

Status: OFF-EDITOR preparation. No device or simulator round trip claimed.

## Architecture

Use the existing React Native bare iOS application (Expo development build, not Expo Go). Present Unity's window full-screen; do not place Unity in a small React Native view. One Unity runtime per process. Export Objective-C Xcode project with Unity 6000.5.4f1, build UnityFramework, embed/sign it in HolobotsMobile, with its Data folder in the framework bundle. Keep the host's Firebase authentication in React Native; never send tokens to Unity.

Native port: Unity C# -> iOS C callback -> RCTEventEmitter -> connectFirebaseWildBridge -> authenticated wildEncounterHost callable -> same session/correlation JSON -> UnityFramework.sendMessageToGOWithName -> JsonWildHostTransport. Native receiver is a persistent runtime object, not a scene hierarchy edit. Subscribe before attaching; ready handshake precedes refresh. Close or auth change invalidates session and pending replies. Late old-session messages are discarded. Shipping missing runtime/host fails Unavailable.

Travel squad: dashboard calls authenticated travelSquadHost, publishes a uid-tagged snapshot, native bridge forwards the snapshot under the current session. Unity validates revision and copies IDs into the existing presentation deployment seam; it never chooses ownership or grants anything. Capture auto-fill comes from the same backend stored snapshot. Battle request/results use existing MOBILE_BRIDGE DTOs; native transport does not simulate outcomes. Battle provider attachment requires an actual host implementation, not a capture adapter masquerading as battle authority.

Lifecycle: background pauses Unity; foreground resumes only if its full-screen presentation remains active. Returning to RN pauses and restores the host window. Logout closes transport before hiding. Avoid quitApplication (cannot restart Unity in the same process); unload requires a new session and ready handshake. Reopening must not retain listeners or stale requests.

## Build sequence

1. Install iOS Build Support for **6000.5.4f1** in Unity Hub. No package/version upgrade.
2. Under an editor claim, reload HoloCity_Main from disk, export Objective-C UnityFramework into the vault. Simulator export and device export are separate outputs; never mix their frameworks.
3. Add exported Xcode project to the existing HolobotsMobile workspace. Build UnityFramework for the matching destination; embed and sign it in HolobotsMobile, include Data in UnityFramework. Keep generated output outside git.
4. Build HolobotsMobile for an iOS simulator, launch with the native module, exercise session-ready/refresh, Meet HARE, throw/refusal/retry, ownership result and squad redeploy. Capture actual UI and correlate request IDs with emulator receipts. No service-account data in Unity.
5. Device proof requires Pak's physical iPhone and signing team. Store provisioning is only required for distribution, not the simulator.
6. Android follows the proven iOS contract: export unityLibrary, include as Gradle module in the bare app, full-screen Unity activity, AndroidJavaProxy/native callback to RN, same JSON envelopes and lifecycle/disposal tests. No Android support or proof claimed before that export exists.

## Measured environment

| Check | Result |
|---|---|
| Unity installed modules | MacStandaloneSupport, WebGLSupport only; iOS and Android absent |
| Simulator runtimes | iOS 26.5 and watchOS 26.5 installed |
| Available simulator devices | none configured |
| Free disk | 37 GiB at inspection |

The sandbox's initial simulator query incorrectly returned a service failure; the authorized native query confirmed the runtimes above. Missing Unity platform support is an agent setup task, not a request for Pak to fix it.

## Sources

[Unity 6000.5 native iOS integration](https://docs.unity3d.com/6000.5/Documentation/Manual/UnityasaLibrary-iOS.html) specifies Objective-C export, UnityFramework integration, full-screen rendering and lifecycle APIs. [Expo native module guide](https://docs.expo.dev/modules/get-started/) describes native customization; this project already has committed bare native projects.
