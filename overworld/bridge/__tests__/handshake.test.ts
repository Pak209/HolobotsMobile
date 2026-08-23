import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHandshakeController, type HandshakeState } from "../handshake";

const timers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id),
};
const mismatch = (error: unknown) => error instanceof Error && error.message === "PROTOCOL_MISMATCH";

describe("story bridge handshake", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps input enabled through timeout retries and recovers", async () => {
    const sendHello = vi.fn()
      .mockRejectedValueOnce(new Error("BRIDGE_TIMEOUT"))
      .mockRejectedValueOnce(new Error("BRIDGE_TIMEOUT"))
      .mockRejectedValueOnce(new Error("BRIDGE_TIMEOUT"))
      .mockResolvedValueOnce(undefined);
    const states: HandshakeState[] = [];
    const controller = createHandshakeController({
      ...timers,
      sendHello,
      isMismatchError: mismatch,
      onStateChange: (state) => states.push(state),
    });

    controller.start();
    await vi.runAllTimersAsync();

    expect(sendHello).toHaveBeenCalledTimes(4);
    expect(states).toContain("reconnecting");
    expect(states.at(-1)).toBe("connected");
    expect(states.every((state) => state !== "mismatch")).toBe(true);
  });

  it("latches an explicit protocol mismatch without retrying", async () => {
    const sendHello = vi.fn().mockRejectedValue(new Error("PROTOCOL_MISMATCH"));
    const controller = createHandshakeController({
      ...timers, sendHello, isMismatchError: mismatch, onStateChange: vi.fn(),
    });
    controller.start();
    await vi.runAllTimersAsync();
    expect(controller.getState()).toBe("mismatch");
    expect(sendHello).toHaveBeenCalledTimes(1);
  });

  it("allows visibility resume to recover a mismatch", async () => {
    const sendHello = vi.fn()
      .mockRejectedValueOnce(new Error("PROTOCOL_MISMATCH"))
      .mockResolvedValueOnce(undefined);
    const controller = createHandshakeController({
      ...timers, sendHello, isMismatchError: mismatch, onStateChange: vi.fn(),
    });
    controller.start();
    await vi.runAllTimersAsync();
    controller.resume();
    await vi.runAllTimersAsync();
    expect(sendHello).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toBe("connected");
  });

  it("stops scheduled retries when disposed", async () => {
    const sendHello = vi.fn().mockRejectedValue(new Error("BRIDGE_TIMEOUT"));
    const controller = createHandshakeController({
      ...timers, sendHello, isMismatchError: mismatch, onStateChange: vi.fn(),
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendHello).toHaveBeenCalledTimes(1);
  });
});
