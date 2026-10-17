# Dormant Rival input-log verification — W66

This is the replay portion of lane S3, narrowed to an **internal preparation seam**. No issue creates `duel.mode="input-log"`, no callable accepts a replacement assembled log at finish, and no new settlement or reward path is activated. Legacy default and existing resolver handlers/flags are unchanged.

## Trusted inputs and result

`rivalBattleStore.ts` re-exports `verifyRivalInputLog(issuedProjection, acceptedLog)` from `rivalInputVerification.ts`. Both arguments must eventually come from authenticated, server-owned durable records, outside the Firestore transaction:

```ts
issuedProjection = {
  battleId: "rb_...",
  duel: {
    mode: "input-log",
    seed: "<32-byte lowercase hex>",
    rulesHash: "<canonical SHA-256 of rules sorted by fighter instance ID>",
    rules: /* immutable duel-sim-1 / 30 Hz RulesSnapshot */
  }
};
acceptedLog = {schemaVersion: "duel-inputs-1", events: [/* server-accepted commands */]};
```

The projection has exactly these keys, not a full battle document/client envelope. The helper checks mode, snapshot validity and rules hash, then validates the log against the snapshot and runs the existing core. A hash is a consistency check, not authentication: this helper cannot establish durable provenance. Client-provided rules/seed or a replacement finish-time log must never be passed here.

Internal result (not a callable reply or legacy `duel-receipt-1`):

```ts
{
  schemaVersion: "duel-sim-receipt-1", battleId,
  initialHash, inputHash,
  ticks: [{tick, hash, events}],
  finalState, finalHash
}
```

Tick events and finalState are unchanged `SimResult` fields from `functions/src/sim/types.ts`. Final state includes simVersion, rulesHash, seed, tick, winner (`0`, `1`, or `null`), terminal reason (`ko` or `timeout`) and fighter states. Draws stay null; no payout policy or mapping to legacy round rows is invented. Public publication needs its own reviewed contract and Unity mirror.

Internal errors, not callable refusals: `unsupported_mode`, `invalid_snapshot`, `invalid_log`, `replay_failed`. Repeat verification returns identical receipt data without mutating inputs. There are no grants or writes; this is deterministic replay, not durable settlement idempotency.

## Bounds and future gates

Core structural limits: **7200 ticks, 8192 events, four commands per tick, two to six fighters**, plus snapshot numeric limits. Validation runs before replay. Finite counts are not a hard CPU or memory SLA. Interruptible worker execution, CPU/memory budgets, receipt size/storage strategy, accepted-log sealing/provenance, session fencing and exactly-once settlement remain future work. Do not invoke inside a retryable Firestore transaction.

Also outstanding: host stat/instance-to-Holobot mapping, capability-gated admission, snapshot storage, append/resume transport and conflict checks, elapsed-time sealing, public response, durable receipt fence, rewards/vitals integration, rollout and rollback. No callable reaches this helper; full S3 is not complete.

## Verification

- `npm run build` passed; `check:shared`: **three** shared files in sync.
- `npm run test:rival-input-verification`: **31/31 passed**. All **24 frozen bouts / 555 tick hashes**, initial/final hashes, winners/reasons, immutable inputs and repeat-identical receipts are checked.
- Seven additional groups cover mode/snapshot/version/hash/seed errors; injected damage/outcome/rules; sequence/tick/per-tick/total limits; CPU/foreign actor/target spoofing; draw preservation; static source tripwire confirming no callable routing or issuance branch. That source tripwire is not a runtime integration proof.
- Full `npm test`: **259 passed / 1 existing skipped / 0 failed** (260 total), after refreshing to main `335deae`.
- Core and original vectors unchanged. No editor/emulator/deploy or account use. Emulator unnecessary for this internal helper with no persistence or callable path changes.
