# Pinned host snapshot (test-only, generated)

`src/` is a verbatim copy of the deployed host's `functions/src` files that the client parity tests import, at the sha in `HOST_PIN.json`. Do not edit it: `src/lib/__tests__/hostPin.test.ts` fails on any byte that differs from the manifest. After a host deploy, re-pin with `node scripts/pin-host.mjs --sha <deployed sha> --note "<deploy>"`; `--check <rev>` reports drift. See `test-fixtures/hostPin.mjs` and `Documentation/QA/2026-10-17-lite-test-parity-1/README.md`.
