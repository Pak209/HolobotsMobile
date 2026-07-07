# Reviewing server-side clamps on client-claimed values

- **Domain:** any change that caps/validates a client-reported reward, score, or quantity before persisting it (anti-cheat clamps, sanity limits, rate caps).
- **Source:** live-harvest, `feat/security-hardening-rebase` commit `4461ce3` (2026-07-06).
- **Test status:** defined, not yet run (see Stress-test).
- **Reader:** mid-tier model reviewing or writing a clamp. Follow the branch points; do not improvise past them.

## The core failure mode

A clamp has **two** correctness conditions and reviewers reliably check only the first:

1. **Security:** an attacker cannot exceed the ceiling. (Everyone checks this.)
2. **Economics:** an honest client's legitimate maximum fits *under* the ceiling. (Almost nobody checks this.)

A clamp that fails #2 ships green: tests pass, the exploit is blocked, types are clean — and every honest user is silently robbed. Nothing errors. You find out from players, weeks later.

## Worked example (real, from this repo)

The watch-reward clamp capped sync points at:

```ts
// BAD — shipped on the original security branch
const syncPointsCeiling = Math.min(Math.floor(steps / 1000), 50);
```

`steps/1000` is the *passive* step-conversion rate (1 SP per 1,000 steps, from the daily-total path). But watch **sessions** are paid by a different formula — `RewardCalculator` in `WorkoutPayload.swift` and `calculateRewards` in `mobile/src/hooks/useWorkout.ts`:

```
sessionSP = 225 × progress + floor(steps / 25) + 100 × floor(km)
```

An honest 5-minute walk (500 steps, 0.4 km) legitimately earns **~245 SP**; the clamp would pay **0**. The fix mirrors the actual payout formula and moves the paranoia into an absolute cap:

```ts
// GOOD — ceiling derived from the formula that generates the claim
const syncPointsCeiling = Math.min(
  BASE_SESSION_SYNC_POINTS +                      // 225
    Math.floor(steps / SESSION_STEP_BONUS_DIVISOR) + // steps/25
    Math.floor(distanceKm) * SYNC_POINTS_PER_KM_MILESTONE, // 100/km
  MAX_SESSION_SYNC_POINTS,                        // 2000 absolute cap
);
```

Three annotated differences: (a) the ceiling is computed by the *same formula the client uses to earn*, so honest ≤ ceiling by construction; (b) the constants are named and documented as mirrors of the reward code, so a rebalance can't silently desync them; (c) the "attacker" bound lives in one absolute cap, separate from the honesty bound.

Why the bad version happened: the branch also contained a *different* rule that really is 1 SP/1,000 steps (the passive daily path). The author pattern-matched the wrong faucet. **Multiple reward formulas for the same currency is the precondition — when you see it, alarm bells.**

## Review checklist (all binary; any NO = block)

1. Did you locate the **exact code that generates the honest claim** (client reward formula), not just the code that consumes it? Name the file in your review.
2. Compute the honest maximum for a *typical* session by hand and for a *best-plausible* session (e.g., 5-min sprint). Are both ≤ the ceiling?
3. Compute the honest maximum for a *minimal* session (smallest legitimate use). Is it > 0 after clamping, if the client would display > 0?
4. Does the test suite contain at least one **honest-input passes unclamped** case with realistic numbers taken from the generating formula? (A suite that only tests attack inputs is testing half the clamp.)
5. If the currency has multiple earn paths (passive vs session vs quest), does the clamp name which path it bounds, and does its formula match *that* path?
6. Are the clamp's constants co-located or cross-referenced with the reward constants they mirror (comment naming both files, or a parity check)?
7. Does display-side code show the same number the clamp will pay? (A UI promising 245 while the server pays 0 is a trust bug even if both are "working as coded.")

## Calibration triggers — stop and verify when

- The clamp formula and the reward formula live in **different languages or repos** (Swift watch ↔ TS functions here). Assume drift until you've read both.
- You're about to reuse a conversion constant (e.g., `X per 1000 steps`) found elsewhere in the codebase. Verify it belongs to *this* earn path.
- Tests for the clamp were written from the clamp's own constants rather than from the generating formula. That's circular; recompute from the source.
- You cannot find the generating formula. Do not guess a ceiling — escalate with: "clamp needs the honest-max formula; found consumers but not the generator."

## Stress-test

Give a mid-tier model the original (bad) `workoutRewardLimits.ts`, the `RewardCalculator` excerpt from `WorkoutPayload.swift`, and the prompt "review this clamp before merge." **Pass:** it flags that an honest ~245-SP session clamps to ≤1 and identifies the formula mismatch as the cause. **Fail:** it approves, or only comments on attack-input handling. Run with and without this artifact; record delta here.
