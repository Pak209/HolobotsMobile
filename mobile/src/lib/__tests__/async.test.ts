import { describe, expect, it, vi } from "vitest";

import { withTimeout } from "@/lib/async";

describe("withTimeout", () => {
  it("passes through a resolution that beats the deadline", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "too slow")).resolves.toBe(42);
  });

  it("passes through a rejection untouched", async () => {
    const boom = new Error("server said no");
    await expect(withTimeout(Promise.reject(boom), 1000, "too slow")).rejects.toBe(boom);
  });

  it("rejects with the readable message once the deadline passes", async () => {
    vi.useFakeTimers();
    const never = new Promise(() => undefined);
    const wrapped = withTimeout(never, 15_000, "Signup timed out.");
    const assertion = expect(wrapped).rejects.toThrow("Signup timed out.");
    vi.advanceTimersByTime(15_001);
    await assertion;
    vi.useRealTimers();
  });

  it("does not fire the timeout after an early resolution", async () => {
    vi.useFakeTimers();
    const wrapped = withTimeout(Promise.resolve("ok"), 5000, "too slow");
    await expect(wrapped).resolves.toBe("ok");
    vi.advanceTimersByTime(10_000);
    vi.useRealTimers();
  });
});
