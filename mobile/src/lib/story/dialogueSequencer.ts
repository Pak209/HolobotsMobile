/**
 * Pure, hook-free typewriter state machine for the story dialogue overlay
 * (Round E hardening). The component owns exactly one interval that calls
 * tick(); all sequencing state lives here so the React surface stays a
 * fixed, minimal, unconditional hook set.
 */

export type DialogueTapResult = "revealed" | "advanced" | "finished" | "idle";

export type DialogueSequencerState = {
  index: number;
  revealed: number;
  blinkOn: boolean;
  isComplete: boolean;
  isLast: boolean;
};

export type DialogueSequencer = {
  reset(): void;
  /** Advance reveal/blink to `nowMs`; returns true when visible state changed. */
  tick(nowMs: number): boolean;
  tap(): DialogueTapResult;
  getState(): DialogueSequencerState;
};

export const DIALOGUE_CHAR_MS = 31;
export const DIALOGUE_BLINK_MS = 450;

export function createDialogueSequencer(
  lines: readonly string[],
  options: { charMs?: number; blinkMs?: number } = {},
): DialogueSequencer {
  const charMs = options.charMs ?? DIALOGUE_CHAR_MS;
  const blinkMs = options.blinkMs ?? DIALOGUE_BLINK_MS;

  let index = 0;
  let revealed = 0;
  let blinkOn = true;
  let lineStartMs: number | null = null;

  const lineLength = () => (lines[index] ?? "").length;
  const isComplete = () => revealed >= lineLength();
  const isLast = () => lines.length > 0 && index >= lines.length - 1;

  return {
    reset() {
      index = 0;
      revealed = 0;
      blinkOn = true;
      lineStartMs = null;
    },
    tick(nowMs) {
      let changed = false;
      if (lineStartMs === null) {
        lineStartMs = nowMs;
      }
      if (!isComplete()) {
        const next = Math.min(lineLength(), Math.floor((nowMs - lineStartMs) / charMs));
        if (next !== revealed) {
          revealed = next;
          changed = true;
        }
      }
      const nextBlink = Math.floor(nowMs / blinkMs) % 2 === 0;
      if (nextBlink !== blinkOn) {
        blinkOn = nextBlink;
        changed = true;
      }
      return changed;
    },
    tap() {
      if (lines.length === 0) {
        return "idle";
      }
      if (!isComplete()) {
        revealed = lineLength();
        return "revealed";
      }
      if (!isLast()) {
        index += 1;
        revealed = 0;
        lineStartMs = null;
        return "advanced";
      }
      return "finished";
    },
    getState() {
      return {
        blinkOn,
        index,
        isComplete: isComplete(),
        isLast: isLast(),
        revealed,
      };
    },
  };
}
