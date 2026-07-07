import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Multiple test files share a single running emulator instance and each
    // test clears Firestore data (env.clearFirestore()). Running files in
    // parallel would let one suite wipe another suite's in-flight data.
    fileParallelism: false,
  },
});
