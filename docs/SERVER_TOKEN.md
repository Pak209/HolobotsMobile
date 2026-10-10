# Server token — how a headless Unity server settles on a player's behalf (spec + PR draft, no deploy)

DECISIONS #55 (HolobotsUnity `Documentation/DECISIONS.md`, 2026-10-08): the multiplayer arc runs the duel sim on an
authoritative **headless Unity server** per town instance (M2 live town, M3 server duels, M5 co-op zones); "the server is
the only thing that runs the duel sim and talks to HolobotsMobile for identity, squads, HP, XP, rewards — rule 1 holds:
clients present, the server decides, the host settles." Prerequisite named there: *a HolobotsMobile "server token" so the
headless server can settle on a player's behalf (a HolobotsMobile addition, Pak's approval)*. This document is that
design: the threat model, the minimal Cloud Function changes, the rollout. **Nothing here is deployed or wired; the code
below is a proposal in fenced blocks, not in `src/`.** Pak rules on the open questions at the end before any lane builds it.

## 1. Today

- A **player** signs in with Firebase Auth (email / password; the desktop client `DesktopFirebaseClient.cs` uses the
  identitytoolkit REST flow, refreshes the 1 h ID token, and calls the callables over HTTPS). Every host callable
  (`rivalBattleHost`, `holoZoneHost`, `desktopAccountSnapshot`, …) is `onCall` and takes the acting user from
  `request.auth.uid`; the uid is never a request field, so a foreign battleId / runId never resolves.
- Server-side authority already exists for **outcomes** (the host rules the amounts; the client only claims a win / a
  kill count / its health observations) but not for **who acts**: there is no principal other than the player.
- A headless server has no player. If it used a player's credentials it would hold their password or refresh token
  (unacceptable); if it used the Admin SDK it would bypass every rule and every callable (a full-trust key on a VPS).

## 2. Goal and non-goals

**Goal:** a server instance can call the existing settle paths (`rivalBattleHost settle`, `holoZoneHost settle`, later the
duel settle) **as a named player it is hosting**, with the host able to tell a server-settled record from a client-settled
one, and with the blast radius of a compromised server bounded to the players attached to it during a short window.

**Non-goals (later arcs):** server-side combat replay / anti-cheat of the sim itself (M3 makes the server the sim, so the
host's existing bounds are the check); matchmaking; Multiplay allocation hooks (the principal model below carries over);
anything the player's own client can already do with its own token (squads, snapshots, boosts stay client calls).

## 3. Threat model

| # | threat | mitigation in this design |
|---|---|---|
| T1 | A leaked server credential lets an attacker settle for **any** player | the server principal can act only for players holding a **live grant to that instance** (§4.2); grants expire; one instance = one principal, revocable on its own |
| T2 | A server settles for a player who never joined it | the grant is minted by the **player's own** call (their ID token), bound to `instanceId`; the server cannot mint grants |
| T3 | Replay of a settle (double XP / double health write) | unchanged: settles are once per battleId / runId; grants carry a `grantId` nonce; expired grants refuse |
| T4 | A player's client claims the server role | the role is a Firebase **custom claim** only an admin script sets; clients can neither set claims nor sign in as the principal (no password; custom-token sign-in only) |
| T5 | A rogue / compromised server (VPS) | no Admin SDK on the server; it holds a custom token for ONE principal; the host still applies every bound it applies to clients (time floors, 25-kill cap, tier at issue, fielded ⊆ squad); every server-settled record is stamped `settledBy` for audit; revocation = one admin action (§4.5) |
| T6 | Secrets in git / on the client | the principal's custom token is minted out of band by Pak's admin script with a service account that never enters either repo; the server reads it from its environment; nothing in `functions/` holds a secret for this (unlike `revenuecatWebhook`, no shared header secret) |
| T7 | Privilege creep: the principal used for reads it should not have | the helper allows `onBehalfOf` only on the callables listed in §4.3; everything else refuses a principal (`permission-denied`) |
| T8 | Dev / emulator confusion | principals are minted per project; the emulator uses `demo-` projects and a local mint script; production principals never run locally |

The trust boundary after this change: **the player trusts the server instance they joined for the duration of the grant**
(the same trust a Netcode client already extends to the server that moves its character); the host trusts the server
only for the players who granted it, and only within the host's own rules.

## 4. Design (minimal)

### 4.1 The server principal = a Firebase Auth user with a custom claim

- One Firebase Auth user per server instance, uid `srv_<instanceId>` (no email, no password, disabled sign-in methods).
  Custom claims: `{ "holoServer": true, "instanceId": "<instanceId>" }`.
- Pak's admin script (out of repo, service account) mints it and a **custom token** (`admin.auth().createCustomToken(uid)`,
  the same primitive `createWebviewBridgeToken` already uses for the app's WebView). The headless server exchanges it
  for an ID token (`accounts:signInWithCustomToken`, the identitytoolkit REST call next to the one
  `DesktopFirebaseClient.cs` makes) and refreshes it like the desktop client does. Custom tokens live 1 h; the admin
  script re-mints on restart (or the server is given a long-lived refresh token from the first exchange — Pak's call).
- Why not a shared secret header over `onRequest` (the `revenuecatWebhook` pattern)? No per-instance identity, no
  revocation granularity, and a second auth path in the codebase. Why not the Admin SDK on the server? Full trust on a
  $5 VPS. The custom-claim principal rides the auth the callables already check.

### 4.2 The grant: a player binds itself to one instance

New callable **`serverSessionHost`** (player-called, `onCall`, `request.auth.uid` = the player):

```json
{ "schemaVersion": "server-session-1", "operation": "grant", "instanceId": "town-a1" }
→ { "schemaVersion": "server-session-1", "instanceId": "town-a1", "grantId": "sg_<24 hex>", "expiresAtMs": 1791316800000 }
{ "operation": "heartbeat", "instanceId": "town-a1", "grantId": "sg_…" } → the same shape, expiresAtMs extended
{ "operation": "revoke", "instanceId": "town-a1" } → { "revoked": true }
```

- Stored at `serverSessions/{instanceId}/players/{uid}` = `{ grantId, grantedAtMs, expiresAtMs }` (server-only, default
  deny + explicit block). TTL: 30 min sliding on heartbeat (the Netcode client heartbeats while connected), hard cap 6 h.
  A player holds one grant at a time (a new grant to another instance replaces it). Per-instance cap 64 grants.
- The client hands `grantId` to the server over the game transport after connecting; the server keeps it per player.

### 4.3 Acting on behalf: one helper, two call sites

`functions/src/lib/serverPrincipal.ts` (pure rules) + `functions/src/account/serverPrincipal.ts` (the Firestore read):

```ts
// proposal — not in src/
export type ActingUser = { uid: string; settledBy: { server: string } | null };

export async function resolveActingUser(db: Firestore, request: CallableRequest, raw: unknown, allowServer: boolean): Promise<ActingUser> {
  const auth = request.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in.");
  const claim = auth.token as { holoServer?: unknown; instanceId?: unknown };
  const onBehalfOf = (raw as { onBehalfOf?: unknown } | null)?.onBehalfOf;
  if (claim.holoServer !== true) {
    if (onBehalfOf !== undefined) throw new HttpsError("invalid-argument", "invalid_request", { rejectionCode: "invalid_request" });
    return { uid: auth.uid, settledBy: null };                       // today's path, untouched
  }
  if (!allowServer) throw new HttpsError("permission-denied", "server_not_allowed", { rejectionCode: "server_not_allowed" });
  const grant = validateOnBehalfOf(onBehalfOf);                        // { uid, grantId } shapes, else invalid_request
  if (typeof claim.instanceId !== "string" || auth.uid !== `srv_${claim.instanceId}`) throw new HttpsError("permission-denied", "bad_principal");
  const doc = (await db.doc(`serverSessions/${claim.instanceId}/players/${grant.uid}`).get()).data();
  if (!validGrant(doc, grant.grantId, Date.now())) throw new HttpsError("permission-denied", "no_grant", { rejectionCode: "no_grant" });
  if ((await db.doc(`serverPrincipals/${auth.uid}`).get()).data()?.revoked === true) throw new HttpsError("permission-denied", "revoked");
  return { uid: grant.uid, settledBy: { server: claim.instanceId } };
}
```

Call sites (the whole change to the existing hosts):

```ts
// rivalBattleHost.ts — proposal
export const rivalBattleHost = onCall(async request => {
  const acting = await resolveActingUser(db, request, request.data, /* allowServer */ true);
  try { return await transactRivalBattle(db, acting.uid, stripOnBehalfOf(request.data), Date.now(), undefined, acting.settledBy); }
  …
// holoZoneHost.ts — the same two lines.
// Every other callable: resolveActingUser(db, request, request.data, false) — a principal is refused.
```

- The store passes `settledBy` down; the pure settle functions stamp it on the record's settlement
  (`settlement.settledBy = { server: instanceId }`) — **additive, replies unchanged**. Issues stay client-called for now
  (the player's client issues the battle / run on entering; M3 may move issue to the server too — the same helper).
- `onBehalfOf` is stripped before validation so the existing `validate*Command` shapes see exactly today's bodies.

### 4.4 Rules and deletion

- `serverSessions/{instanceId}/{document=**}` and `serverPrincipals/{uid}` : `allow read, write: if false` (explicit, the
  repo convention). `deleteUserAccountV2`: delete the player's grants (a collection-group query on `players` by uid, or
  the single doc if the one-grant rule is kept as `serverSessionsByUid/{uid}` — producer pick: keep ONE doc per player at
  `serverSessions/{instanceId}/players/{uid}` plus a pointer `users/{uid}` never touched; deletion runs the group query).

### 4.5 Revocation and rotation

- Immediate: `serverPrincipals/{srv_uid}.revoked = true` (admin script) — refused on the next call; delete the instance's
  grants. Rotation: mint a new custom token (claims unchanged); tokens expire in 1 h anyway. Decommission: delete the
  Auth user.

### 4.6 What stays exactly as it is

Every ruling (amounts, caps, once-per-id, time floors, the health bound) and every reply shape. A record settled by a
server differs from a client-settled one by one additive field. The shipped Unity client never sends `onBehalfOf` and is
unaffected.

## 5. Tests to write with the implementation (every gate with its control)

- pure: `validateOnBehalfOf` shapes; `validGrant` (expired, wrong grantId, missing) — known-bad each; a principal uid that
  does not match its claim's instance.
- emulator: a principal with a live grant settles for the player (XP written to the player, `settledBy` stamped); the
  same principal for a player with no grant → `permission-denied`, nothing written; an expired grant → refused; a player
  token carrying `onBehalfOf` → `invalid-argument`; a principal on a non-listed callable → `permission-denied`;
  revocation takes effect on the next call; `deleteUserData` removes the grants. Custom claims are set on the emulator's
  Auth with the Admin SDK in the test (no production script).
- rules: every client read / write of `serverSessions/**` and `serverPrincipals/**` denied.
- the existing suites unchanged (no reply changes): the byte-identity controls run as for PRs #61 / #62.

## 6. Rollout (when Pak opens the arc)

1. Land the helper + `serverSessionHost` + the two call-site lines behind the claim (no behaviour change for players).
2. Pak's admin script mints the first principal for the dev Mac / VPS instance (`srv_dev-1`).
3. The headless server (HolobotsUnity, after the authority seam) signs in with the custom token, receives grants over
   Netcode, settles with `onBehalfOf`.
4. Deploy list: `functions:serverSessionHost` (new), `functions:rivalBattleHost`, `functions:holoZoneHost`,
   `functions:deleteUserAccountV2`, the rules.

## 7. Pak's calls (rule before a lane builds this)

1. **Principal lifecycle:** per instance (`srv_<instanceId>`, this doc) or per deployment (one principal, `instanceId` in
   the grant only)? Per instance is the smaller blast radius; per deployment is fewer mints. Producer pick: per instance.
2. **Grant TTL** (30 min sliding / 6 h cap) and the per-instance cap (64).
3. **Who issues in M3:** the player's client (today) or the server — the helper serves both; issue-by-server needs the
   server to read the player's snapshot on their behalf (`desktopAccountSnapshot` added to the allow list).
4. **Where the mint script lives:** out of repo (producer pick) or `scripts/` with the service-account path as an env var.
