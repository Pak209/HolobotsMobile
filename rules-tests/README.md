# rules-tests

Firestore security-rules tests run against the local emulator.

## Prerequisites

- Node 22+
- A JRE available via `/usr/libexec/java_home` (no system Java required on PATH; the
  emulator script prepends `$(/usr/libexec/java_home)/bin` itself).

## Setup

```
npm --prefix rules-tests install
```

## Run

```
npm run test:rules
```

(from repo root) — downloads the Firestore emulator on first run, starts it,
runs `vitest run` against it, then shuts it down.

To run tests against an emulator you're already running elsewhere, use
`npm --prefix rules-tests run test` instead.
