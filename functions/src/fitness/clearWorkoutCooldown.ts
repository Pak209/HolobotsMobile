import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { DAILY_WORKOUT_CAP } from "../lib/fitnessSyncOutcome";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type ClearCooldownResponse = {
  cooldownEndsAt: null;
  sessionsCompleted: number;
};

/**
 * Server-authoritative Quick Refill: clears the workout cooldown on the
 * daily fitness doc. Free by design (matches the legacy client mechanic);
 * refuses once the daily session cap is reached, so it cannot be used to
 * push past the cap.
 */
export const clearWorkoutCooldown = onCall(async (request): Promise<ClearCooldownResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to use Quick Refill.");
  }

  const date = (request.data as { date?: unknown } | undefined)?.date;
  if (typeof date !== "string" || !DATE_KEY_PATTERN.test(date)) {
    throw new HttpsError("invalid-argument", "A yyyy-mm-dd date is required.");
  }

  const dailyRef = db.doc(`users/${uid}/fitness_daily/${date}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(dailyRef);
    const dailyData = snapshot.data() ?? {};
    const sessionsCompleted = Math.min(
      DAILY_WORKOUT_CAP,
      Math.max(0, Number(dailyData.workoutSessionsCompleted ?? 0)),
    );

    if (sessionsCompleted >= DAILY_WORKOUT_CAP) {
      throw new HttpsError("failed-precondition", "Daily workout limit reached.");
    }

    transaction.set(
      dailyRef,
      {
        lastSampleAt: FieldValue.serverTimestamp(),
        workoutCooldownEndsAt: null,
      },
      { merge: true },
    );

    return { cooldownEndsAt: null, sessionsCompleted };
  });
});
