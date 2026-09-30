# Contract-Change: native runtime session transport

In-process only. Fixed Unity object `HoloMobileBridge`, method `Receive(string)`. No deep link, web origin or auth token transport. iOS plugin notification `HolobotsUnityMessage`, userInfo `json`, becomes RN `UnityMessage` with `{json}`.

- Unity -> RN `{schemaVersion:"runtime-ready-1"}` only after runtime receiver starts.
- RN -> Unity `{schemaVersion:"native-session-1",sessionId,operation:"begin"|"end"}`. Nonce is 1–128 ASCII alphanumeric/underscore/hyphen. Repeated same begin is harmless. End must match current nonce.
- Unity -> RN matching native-session-1 operation `attached` after world host attaches; `ended` after disposal.
- Existing wild-bridge-1 request/reply JSON remains unchanged and correlated by sessionId/requestId. Unknown or prior sessions ignored; message bound 262144 characters in Unity and bytes in native iOS.
- RN -> Unity `{schemaVersion:"native-squad-1",sessionId,travelSquad:{schemaVersion:"travel-squad-1",revision,holobotIds}}`. Only authenticated host replies are published. Unity validates max three canonical distinct IDs, monotonic revision and same-revision identity before deployment.
- Native navigation -> RN `{schemaVersion:"runtime-exit-1"}` requests normal acknowledged session shutdown.

Battle payload contracts remain unchanged; a production battle host adapter is not supplied by the wild provider. Missing host fails closed. No new combat outcomes, persistence or economy in Unity.
