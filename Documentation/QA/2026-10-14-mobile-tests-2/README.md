# W12 — Arena grid timeout correction

PR #83 follow-up, 2026-10-14. No runtime code or timeout change.

## Known bad first

The unchanged Arena full-grid parity test reproduced the existing 5000 ms timeout at **13642 ms**, with 7 other tests passing. Command: `cd mobile && npm test -- src/lib/__tests__/battleSettlementParity.test.ts --maxWorkers=1 --reporter=verbose`. Process wall time 47.406 s; 180 s cap. See `grid-before.txt`.

## Cause and correction

One deadline enclosed **18,496 inputs / 36,992 deep comparisons** (4 tiers × 17 defense values × 17 combo values × (15 winning opponent strings + 1 loss opponent)). Splitting only the tier/defense outer dimensions bounds each test to **272 inputs / 544 comparisons**, preserving every win/loss, bad numeric count, opponent and unknown-tier refusal. All **68 batches** retain the default **5000 ms** limit. No skip, increased timeout, sampling or production formula change.

Narrow replay: **76/76 passed**; max batch **905.523 ms**, cumulative Arena batches **6401.717 ms**. That cumulative work still exceeds one 5000 ms budget even though no batch approaches it. Host contention may explain timing variability but is not claimed as measured root cause; total work under one deadline is proven.

Full bounded validation: **575 passed / 0 failed / 1 existing skipped (576 total)**, 51 files, **48.950 s** wall time; typecheck passed at **51.175 s** cumulative wall time. Commands: `cd mobile && npm test -- --maxWorkers=1 --reporter=json --outputFile=/private/tmp/w12-full-after.json`, then `npm run typecheck`; each capped at 300 s. Machine-readable counts and batch maximum in `timeout-results.json`.

The earlier 68 additions remain green. This supersedes #83's timeout hold only; no deploy, emulator, editor, account or shared dirty files used. Missing production consumers are the next W12 PR. Other holds remain.
