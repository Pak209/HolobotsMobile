import { HttpsError } from "firebase-functions/v2/https";
import { TimerError, type TimerErrorCode } from "../lib/progressionTimers";

/** Player-facing copy kept from the pre-hardening claim callables where the ruling already existed. */
const MESSAGES: Partial<Record<TimerErrorCode, string>> = {
  not_active: "That run is not active.",
  not_complete: "That run is not complete yet.",
  not_started_on_host: "That run was started by an older version of the app and can't be claimed. Start a new one.",
  not_enough_energy: "Not enough energy.",
  holobot_busy: "That Holobot is already on a quest.",
  quest_slots_full: "Complete or claim an active quest before sending another Holobot.",
  training_active: "A training session is already active.",
};

/** TimerError -> HttpsError with details.rejectionCode (the arena / zone convention). */
export function timerHttpsError(error: unknown): unknown {
  if (!(error instanceof TimerError)) return error;
  const code = error.code;
  const status = code === "invalid_request" || code === "unknown_quest" || code === "unknown_course" || code === "unknown_holobot"
    ? "invalid-argument" : code === "unavailable" ? "unavailable" : "failed-precondition";
  return new HttpsError(status, MESSAGES[code] ?? code, { rejectionCode: code });
}
