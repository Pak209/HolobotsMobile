import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue as AdminFieldValue } from "firebase-admin/firestore";

import {
  EXTRA_REFERRAL_WILDCARDS,
  GENESIS_REFERRALS_REQUIRED,
  REFERRAL_MILESTONE_GACHA_TICKETS,
  REFERRAL_MILESTONE_QUALIFIED,
  REFERRAL_WELCOME_HOLOS,
  REFERRAL_WELCOME_WILDCARDS,
} from "../lib/referrals";

import { db } from "../admin";
import {
  computeFitnessSyncOutcome,
  sanitizeFitnessSyncRequest,
  type SyncFitnessActivityRequest,
  type SyncFitnessActivityResponse,
} from "../lib/fitnessSyncOutcome";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseRequest(data: unknown): SyncFitnessActivityRequest {
  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const date = typeof raw.date === "string" ? raw.date : "";

  if (!DATE_KEY_PATTERN.test(date)) {
    throw new HttpsError("invalid-argument", "A yyyy-mm-dd date is required.");
  }

  const optionalNumber = (value: unknown): number | undefined => {
    if (value === undefined || value === null) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    activityId: typeof raw.activityId === "string" ? raw.activityId : undefined,
    date,
    distanceMeters: optionalNumber(raw.distanceMeters),
    eventId: typeof raw.eventId === "string" ? raw.eventId : undefined,
    expAwarded: optionalNumber(raw.expAwarded),
    holobotName: typeof raw.holobotName === "string" ? raw.holobotName : undefined,
    holosAwarded: optionalNumber(raw.holosAwarded),
    sessionIncrement: optionalNumber(raw.sessionIncrement),
    stepsTotal: optionalNumber(raw.stepsTotal) ?? 0,
    syncPointsAwarded: optionalNumber(raw.syncPointsAwarded),
    workoutMinutes: optionalNumber(raw.workoutMinutes),
    // cooldownEndsAt is deliberately NOT read from the client — the sanitizer
    // computes it server-side.
  };
}

/**
 * Server-authoritative phone fitness sync. Same award math as the client's
 * legacy transaction (see lib/fitnessSyncOutcome parity contract), but the
 * uid comes from the auth token, claimed rewards are clamped to the session
 * formula, the daily session cap actually gates awards, and the workout
 * cooldown is server-computed.
 */
export const syncFitnessActivity = onCall(async (request): Promise<SyncFitnessActivityResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to sync fitness activity.");
  }

  const parsed = parseRequest(request.data);
  const userRef = db.doc(`users/${uid}`);
  const dailyRef = db.doc(`users/${uid}/fitness_daily/${parsed.date}`);

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, dailySnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(dailyRef),
    ]);

    if (!userSnapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = userSnapshot.data() ?? {};
    const dailyData = dailySnapshot.data() ?? {};
    const sanitized = sanitizeFitnessSyncRequest(dailyData, parsed, new Date());
    const outcome = computeFitnessSyncOutcome(userData, dailyData, sanitized);

    if (outcome.alreadyProcessed || !outcome.userUpdates) {
      return outcome.response;
    }

    // Referral qualification (genesis-squad-monetization-plan.md): the
    // invited player's FIRST settled workout is what makes their referral
    // count — a physical act, hard to bot. All reads must precede writes in
    // a Firestore transaction, so resolve the referrer snapshot up front.
    const completedWorkout =
      Number((outcome.dailyUpdates as Record<string, unknown>)?.workoutSessionsCompleted || 0) >= 1;
    const shouldQualify =
      completedWorkout && typeof userData.referredBy === "string" && !userData.referralQualified;
    let referrerUpdate: { ref: FirebaseFirestore.DocumentReference; qualified: number } | null = null;
    if (shouldQualify) {
      const referrerRef = db.doc(`users/${String(userData.referredBy)}`);
      const referrerSnapshot = await transaction.get(referrerRef);
      if (referrerSnapshot.exists) {
        const referrals = (referrerSnapshot.data()?.referrals ?? {}) as { qualified?: number };
        referrerUpdate = { ref: referrerRef, qualified: Number(referrals.qualified || 0) + 1 };
      }
    }

    transaction.set(
      dailyRef,
      {
        ...outcome.dailyUpdates,
        lastSampleAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const welcomeUpdates = shouldQualify && referrerUpdate
      ? {
          referralQualified: true,
          wildcardBlueprints:
            Number(userData.wildcardBlueprints || 0) +
            Number((outcome.userUpdates as Record<string, unknown>).wildcardBlueprints || 0) +
            REFERRAL_WELCOME_WILDCARDS,
          holosTokens:
            Number(
              (outcome.userUpdates as Record<string, unknown>).holosTokens ??
                userData.holosTokens ??
                0,
            ) + REFERRAL_WELCOME_HOLOS,
        }
      : {};

    transaction.set(
      userRef,
      {
        ...outcome.userUpdates,
        ...welcomeUpdates,
        lastFitnessSyncAt: FieldValue.serverTimestamp(),
        lastStepSync: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (referrerUpdate) {
      // No referral cap: every qualified referral past the Genesis Squad
      // threshold pays wildcards instead — and the 10th recruit lands a
      // one-time Elite-pack's worth of gacha tickets as a thank-you.
      const extras = {
        ...(referrerUpdate.qualified > GENESIS_REFERRALS_REQUIRED
          ? { wildcardBlueprints: AdminFieldValue.increment(EXTRA_REFERRAL_WILDCARDS) }
          : {}),
        ...(referrerUpdate.qualified === REFERRAL_MILESTONE_QUALIFIED
          ? { gachaTickets: AdminFieldValue.increment(REFERRAL_MILESTONE_GACHA_TICKETS) }
          : {}),
      };
      transaction.set(
        referrerUpdate.ref,
        {
          referrals: {
            qualified: referrerUpdate.qualified,
            pending: AdminFieldValue.increment(-1),
          },
          ...extras,
        },
        { merge: true },
      );
    }

    return outcome.response;
  });
});
