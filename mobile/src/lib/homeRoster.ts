/**
 * What Home's info card may say about the pilot's roster (L20). Only a failed or missing profile read
 * claims a failure and offers RETRY; a loaded profile with no Holobots says so plainly, without a retry
 * that could never succeed.
 */
export type HomeRosterState = "ready" | "loading" | "empty" | "unavailable";

export function homeRosterState(input: {
  signedIn: boolean;
  ownsHolobot: boolean;
  profileLoaded: boolean;
  profileLoading: boolean;
  profileError: string | null;
}): HomeRosterState {
  if (!input.signedIn || input.ownsHolobot) return "ready";
  if (input.profileLoaded) return "empty";
  if (input.profileError !== null) return "unavailable";
  return input.profileLoading ? "loading" : "unavailable";
}

// PLACEHOLDER copy (Lex, DECISIONS #71).
export const HOME_ROSTER_COPY = {
  unavailable: "CAN'T LOAD YOUR ROSTER",
  retry: "RETRY",
  empty: "NO HOLOBOTS YET",
  loading: "LOADING ROSTER…",
} as const;
