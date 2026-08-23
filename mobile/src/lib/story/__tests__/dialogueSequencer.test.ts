import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createDialogueSequencer } from "@/lib/story/dialogueSequencer";

const LINES = ["Hello pilot.", "Second line.", "Bye."];

describe("dialogue sequencer lifecycle (hidden → visible → hidden, no state bleed)", () => {
  it("reveals by tick, completes on tap, advances, finishes, and resets cleanly", () => {
    const sequencer = createDialogueSequencer(LINES, { blinkMs: 450, charMs: 31 });

    // open #1: reveal a few chars, then tap-complete the line
    sequencer.tick(0);
    sequencer.tick(31 * 4);
    expect(sequencer.getState()).toMatchObject({ index: 0, isComplete: false, revealed: 4 });
    expect(sequencer.tap()).toBe("revealed");
    expect(sequencer.getState().isComplete).toBe(true);

    // advance through the remaining lines
    expect(sequencer.tap()).toBe("advanced");
    expect(sequencer.getState()).toMatchObject({ index: 1, revealed: 0 });
    sequencer.tick(10_000);
    sequencer.tick(10_000 + 31 * LINES[1].length);
    expect(sequencer.getState().isComplete).toBe(true);
    expect(sequencer.tap()).toBe("advanced");
    sequencer.tick(20_000);
    sequencer.tick(20_000 + 31 * LINES[2].length);
    expect(sequencer.getState()).toMatchObject({ index: 2, isComplete: true, isLast: true });
    expect(sequencer.tap()).toBe("finished");

    // hide → reopen (reset): no bleed from the first run
    sequencer.reset();
    expect(sequencer.getState()).toMatchObject({ index: 0, isComplete: false, isLast: false, revealed: 0 });
    sequencer.tick(99_000);
    sequencer.tick(99_000 + 31 * 2);
    expect(sequencer.getState().revealed).toBe(2);
  });

  it("blinks on the blink interval and reports change only when state moved", () => {
    const sequencer = createDialogueSequencer(["Hi"], { blinkMs: 450, charMs: 31 });
    sequencer.tick(0);
    sequencer.tap(); // complete the line
    expect(sequencer.tick(100)).toBe(false); // nothing changed
    expect(sequencer.tick(500)).toBe(true); // blink flipped
    expect(sequencer.getState().blinkOn).toBe(false);
  });

  it("is inert on empty lines", () => {
    const sequencer = createDialogueSequencer([]);
    expect(sequencer.tap()).toBe("idle");
    expect(sequencer.tick(1_000)).toBe(false);
    expect(sequencer.getState()).toMatchObject({ index: 0, isLast: false, revealed: 0 });
  });
});

describe("StoryDialogueOverlay hook-order source guard", () => {
  // A true mount/unmount render test needs jsdom or react-test-renderer —
  // neither is installed. This structural guard plus the pure sequencer test
  // above stand in: the component must call exactly ONE hook (the custom
  // useDialogueOverlayState) and no `return` may precede it.
  it("component calls exactly one hook, before any return statement", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../components/story/StoryDialogueOverlay.tsx", import.meta.url)),
      "utf8",
    );
    const componentStart = source.indexOf("export function StoryDialogueOverlay");
    const componentEnd = source.indexOf("const styles = StyleSheet.create");
    expect(componentStart).toBeGreaterThan(-1);
    expect(componentEnd).toBeGreaterThan(componentStart);
    const component = source.slice(componentStart, componentEnd);

    const hookCalls = component.match(/\buse[A-Z]\w*\(/g) ?? [];
    expect(hookCalls).toEqual(["useDialogueOverlayState("]);

    const hookIndex = component.indexOf("useDialogueOverlayState(");
    const firstReturn = component.indexOf("return");
    expect(hookIndex).toBeGreaterThan(-1);
    expect(firstReturn).toBeGreaterThan(hookIndex);
  });
});
