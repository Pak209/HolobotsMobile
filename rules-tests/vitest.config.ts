import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // matchmaking-race.test.ts imports mobile/src/lib/pvpMatchmaking.ts,
    // which imports "firebase/firestore". Without dedupe that would resolve
    // to mobile/node_modules while the tests use rules-tests/node_modules —
    // two SDK copies whose Firestore instances reject each other.
    dedupe: ["firebase", "@firebase/firestore", "@firebase/app", "@firebase/util"],
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
