/**
 * What Home's info card may say about the pilot's roster (L20). Only a failed profile read claims a
 * failure and offers RETRY (it re-subscribes). A read that answered "no profile document" says it could
 * not load the roster but offers no retry: the live listener picks the document up if it appears. A
 * loaded profile with no Holobots says so plainly. A retry in flight shows LOADING (App.tsx keeps Home
 * mounted; only a first read gets the app's loading screen, and AuthContext starts that read in the
 * same update as the sign-in).
 */
export type HomeRosterState = "ready" | "loading" | "empty" | "unavailable" | "missing";

export function homeRosterState(input: {
  signedIn: boolean;
  ownsHolobot: boolean;
  profileLoaded: boolean;
  profileLoading: boolean;
  profileError: string | null;
}): HomeRosterState {
  if (!input.signedIn || input.ownsHolobot) return "ready";
  if (input.profileLoaded) return "empty";
  if (input.profileLoading) return "loading";
  return input.profileError !== null ? "unavailable" : "missing";
}

// PLACEHOLDER copy (Lex, DECISIONS #71).
export const HOME_ROSTER_COPY = {
  unavailable: "CAN'T LOAD YOUR ROSTER",
  missing: "CAN'T LOAD YOUR ROSTER",
  retry: "RETRY",
  empty: "NO HOLOBOTS YET",
  loading: "LOADING ROSTER…",
} as const;
