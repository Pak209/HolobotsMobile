import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // matchmaking-race.test.ts imports mobile/src/lib/pvpMatchmaking.ts,
    // which imports "firebase/firestore". Without dedupe that would resolve
    // to mobile/node_modules while the tests use rules-tests/node_modules —
    // two SDK copies whose Firestore instances reject each other.
    dedupe: ["firebase", "@firebase/firestore", "@firebase/app", "@firebase/util"],
  },
  esbuild: {
    // Transforming mobile/src files makes vite discover mobile/tsconfig.json,
    // which extends "expo/tsconfig.base" — a package only installed in the
    // mobile CI job, so the rules CI job crashed on suite load. An inline
    // tsconfig skips tsconfig discovery entirely (plain TS transform is all
    // these tests need).
    tsconfigRaw: '{"compilerOptions":{}}',
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Multiple test files share a single running emulator instance and each
    // test clears Firestore data (env.clearFirestore()). Running files in
    // parallel would let one suite wipe another suite's in-flight data.
    fileParallelism: false,
  },
});
