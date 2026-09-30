# Contract-Change: direct desktop account transport (DECISIONS #41)

Existing acquisition-0, capture-world-1, travel-squad-1 and mint/rank callable payloads are unchanged. Desktop authenticates directly using Firebase Auth REST email/password, then sends POST `{data: payload}` with Firebase ID-token Bearer authorization to the existing callables. No phone runtime, custom token generator, administrative credential or local economy.

`DesktopWildTransport` maps the existing Unity command fields to the existing callable `intent` field. Declare/withdraw continue to be supplied by the host's provisioned encounter session via refresh; desktop does not create encounters or odds. Capture outcomes, auto-fill and duplicate grants are unchanged. Squad uses revision + request ID. Writes are not automatically retried; UI refreshes after uncertain delivery before another deliberate operation.

Additive read-only callable `desktopAccountSnapshot`: authenticated caller only, no input UID. Returns `{schemaVersion:"desktop-account-1", uid, holobots, blueprints, travelSquad, blueprintTiers}`. Holobots and blueprints are the existing mobile user-document fields; squad is validated through the existing reader; tiers come directly from server `BLUEPRINT_TIERS`. No second storage or migration. Both clients read the same `users/<authenticated uid>` document. Unity compares returned UID with the active account, accepts only the versioned shape, and never computes a mint/upgrade result.

Credentials and refresh tokens live only in process memory. Sign-out advances session generation; late login/call/refresh responses cannot repopulate the account. Refresh is serialized and must preserve UID. Reopening the game requires sign-in. Public project configuration is outside git in `Application.persistentDataPath/firebase-desktop.json` (apiKey, projectId, region). Passwords/tokens must never be placed there.

Local emulator factory is compiled only for editor/development/test builds and uses fixed loopback addresses plus demo-holobots-desktop. Release builds ignore the localEmulator flag and require production configuration; there is no silent emulator/mock fallback. In-game test account is visibly labelled MOCK ACCOUNT.

Firebase reference: https://firebase.google.com/docs/reference/rest/auth and https://firebase.google.com/docs/functions/callable-reference . No Firebase Unity desktop development SDK is installed.
