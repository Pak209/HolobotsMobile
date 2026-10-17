/** Dev-preview routing only; no production navigation or host calls. */
export const ARENA_CAPTURE_ROUTES = [
  { name: "ArenaAdmittedKnownBad", label: "KNOWN BAD" },
  { name: "ArenaAdmittedRound", label: "ROUND 1" },
  { name: "ArenaAdmittedResult", label: "RESULT" },
] as const;

export function previewInitialScreen(requested: string | undefined, screens: Record<string, unknown>): string {
  return requested && Object.prototype.hasOwnProperty.call(screens, requested) ? requested : "Home";
}
