const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();
const DAILY_WORKOUT_CAP = 4;

function getSyncRank(syncPoints) {
  const safePoints = Math.max(0, Number(syncPoints) || 0);
  if (safePoints >= 10000) return "Legend";
  if (safePoints >= 5000) return "Champion";
  if (safePoints >= 2500) return "Strider";
  if (safePoints >= 1000) return "Pilot";
  if (safePoints >= 250) return "Walker";
  return "Rookie";
}

function normalizeUserHolobot(rawHolobot) {
  if (!rawHolobot || typeof rawHolobot !== "object") {
    return {
      experience: 0,
      level: 1,
      name: "KUMA",
      nextLevelExp: 100,
    };
  }

  return {
    ...rawHolobot,
    experience: Math.max(0, Number(rawHolobot.experience || 0)),
    level: Math.max(1, Number(rawHolobot.level || 1)),
    name: typeof rawHolobot.name === "string" ? rawHolobot.name : "KUMA",
    nextLevelExp: Math.max(100, Number(rawHolobot.nextLevelExp || 100)),
  };
}

function applyHolobotExperience(rawHolobot, expAwarded) {
  const holobot = normalizeUserHolobot(rawHolobot);
  let level = holobot.level;
  let experience = holobot.experience + Math.max(0, Number(expAwarded || 0));
  let nextLevelExp = Math.max(100, Number(holobot.nextLevelExp || 100));

  while (experience >= nextLevelExp) {
    experience -= nextLevelExp;
    level += 1;
    nextLevelExp = Math.round(nextLevelExp * 1.18);
  }

  return {
    ...holobot,
    experience,
    level,
    nextLevelExp,
  };
}

function computeLeaderboardScore(profile) {
  const holobots = Array.isArray(profile?.holobots) ? profile.holobots : [];
  const prestigeCount = Math.max(0, Number(profile?.prestigeCount || 0));
  const seasonSyncPoints = Math.max(0, Number(profile?.seasonSyncPoints || 0));
  const wins = Math.max(0, Number(profile?.wins || 0));

  const holobotPower = holobots.reduce((total, holobot) => {
    const normalized = normalizeUserHolobot(holobot);
    return total + normalized.level * 12 + normalized.experience * 0.02;
  }, 0);

  return Math.round(holobotPower + prestigeCount * 250 + seasonSyncPoints * 0.4 + wins * 6);
}

async function persistWatchWorkoutReward(uid, workout) {
  const activityId = typeof workout.workoutId === "string" ? workout.workoutId.trim() : "";
  const date = typeof workout.date === "string" && workout.date ? workout.date : new Date().toISOString().slice(0, 10);
  const dailyRef = db.doc(`users/${uid}/fitness_daily/${date}`);
  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, dailySnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(dailyRef),
    ]);

    if (!userSnapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = userSnapshot.data() || {};
    const dailyData = dailySnapshot.data() || {};
    const processedActivityIds = dailyData.processedActivityIds || {};
    const processedWorkoutEvents = dailyData.processedWorkoutEvents || {};

    if (activityId && (processedActivityIds[activityId] || processedWorkoutEvents[activityId])) {
      return {
        alreadyProcessed: true,
        totalSyncPoints: Number(userData.syncPoints || 0),
        workoutSessionsCompleted: Math.max(0, Number(dailyData.workoutSessionsCompleted || 0)),
      };
    }

    const awardedSyncPoints = Math.max(0, Math.floor(Number(workout.syncPointsEarned || 0)));
    const awardedHolos = Math.max(0, Math.floor(Number(workout.holosEarned || 0)));
    const awardedExp = Math.max(0, Math.floor(Number(workout.expEarned || 0)));
    const previousSessionsCompleted = Math.max(0, Number(dailyData.workoutSessionsCompleted || 0));
    const nextSessionsCompleted = Math.min(DAILY_WORKOUT_CAP, previousSessionsCompleted + 1);

    const currentHolobots = Array.isArray(userData.holobots) ? userData.holobots : [];
    const normalizedTargetName = typeof workout.holobotName === "string" ? workout.holobotName.trim().toUpperCase() : "";
    let nextHolobots = currentHolobots;

    if (awardedExp > 0 && currentHolobots.length > 0) {
      const targetIndex = currentHolobots.findIndex((rawHolobot) => {
        const holobotName = typeof rawHolobot?.name === "string" ? rawHolobot.name : "";
        return holobotName.trim().toUpperCase() === normalizedTargetName;
      });
      const safeTargetIndex = targetIndex >= 0 ? targetIndex : 0;

      nextHolobots = currentHolobots.map((rawHolobot, index) => {
        if (index !== safeTargetIndex) {
          return rawHolobot;
        }
        return applyHolobotExperience(rawHolobot, awardedExp);
      });
    }

    const nextSyncPoints = Math.max(0, Number(userData.syncPoints || 0)) + awardedSyncPoints;
    const nextLifetimeSyncPoints = Math.max(0, Number(userData.lifetimeSyncPoints || 0)) + awardedSyncPoints;
    const nextSeasonSyncPoints = Math.max(0, Number(userData.seasonSyncPoints || 0)) + awardedSyncPoints;
    const nextHolosTokens = Math.max(0, Number(userData.holosTokens || 0)) + awardedHolos;

    transaction.set(dailyRef, {
      date,
      distanceMeters: Math.max(0, Math.round(Number(workout.distanceMeters || 0))),
      lastSampleAt: admin.firestore.FieldValue.serverTimestamp(),
      processedActivityIds: activityId
        ? { ...processedActivityIds, [activityId]: true }
        : processedActivityIds,
      processedWorkoutEvents: activityId
        ? { ...processedWorkoutEvents, [activityId]: true }
        : processedWorkoutEvents,
      source: "watch",
      stepsTotal: Math.max(
        Math.max(0, Number(dailyData.stepsTotal || 0)),
        Math.max(0, Math.floor(Number(workout.stepCount || 0))),
      ),
      syncPointsAwarded: Number(dailyData.syncPointsAwarded || 0) + awardedSyncPoints,
      workoutMinutes: Math.max(0, Math.round(Number(workout.elapsedSeconds || 0) / 60)),
      workoutSessionsCompleted: nextSessionsCompleted,
    }, { merge: true });

    transaction.set(userRef, {
      fitnessSource: "watch",
      holobots: nextHolobots,
      holosTokens: nextHolosTokens,
      lastFitnessSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      lastStepSync: admin.firestore.FieldValue.serverTimestamp(),
      leaderboardScore: computeLeaderboardScore({
        holobots: nextHolobots,
        prestigeCount: Number(userData.prestigeCount || 0),
        seasonSyncPoints: nextSeasonSyncPoints,
        wins: Number(userData.wins || 0),
      }),
      lifetimeSyncPoints: nextLifetimeSyncPoints,
      seasonSyncPoints: nextSeasonSyncPoints,
      syncPoints: nextSyncPoints,
      syncRank: getSyncRank(nextLifetimeSyncPoints),
      todaySteps: Math.max(0, Math.floor(Number(workout.stepCount || 0))),
    }, { merge: true });

    return {
      alreadyProcessed: false,
      totalSyncPoints: nextSyncPoints,
      workoutSessionsCompleted: nextSessionsCompleted,
    };
  });
}

async function clearUserPresence(uid) {
  await db.doc(`users/${uid}`).set(
    {
      pvpPresence: null,
    },
    { merge: true },
  ).catch(() => undefined);
}

async function handleDeleteUserAccount(request) {
  let uid = request.auth?.uid;

  if (!uid) {
    const idToken = typeof request.data?.idToken === "string" ? request.data.idToken : "";
    if (!idToken) {
      throw new HttpsError("unauthenticated", "You must be signed in to delete your account.");
    }

    try {
      const decoded = await auth.verifyIdToken(idToken);
      uid = decoded.uid;
    } catch (error) {
      throw new HttpsError("unauthenticated", "Your session could not be verified. Please sign in again.");
    }
  }

  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to delete your account.");
  }

  const userDocRef = db.doc(`users/${uid}`);

  await clearUserPresence(uid);

  try {
    await db.recursiveDelete(userDocRef);
  } catch (error) {
    throw new HttpsError("internal", "Failed to remove Firestore profile data.");
  }

  try {
    await auth.deleteUser(uid);
  } catch (error) {
    throw new HttpsError("internal", "Failed to remove the Firebase Authentication account.");
  }

  return { success: true };
}

exports.deleteUserAccountV2 = onCall({ region: "us-central1", invoker: "public" }, handleDeleteUserAccount);

exports.syncWatchWorkoutRewards = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to sync watch rewards.");
  }

  const workouts = Array.isArray(request.data?.workouts) ? request.data.workouts : [];
  if (!workouts.length) {
    return {
      processedCount: 0,
      sessionsCompleted: 0,
      sessionsRemaining: DAILY_WORKOUT_CAP,
      totalSyncPoints: 0,
    };
  }

  let latestResult = {
    totalSyncPoints: 0,
    workoutSessionsCompleted: 0,
  };
  let processedCount = 0;

  for (const workout of workouts) {
    const result = await persistWatchWorkoutReward(uid, workout);
    latestResult = result;
    if (!result.alreadyProcessed) {
      processedCount += 1;
    }
  }

  return {
    processedCount,
    sessionsCompleted: latestResult.workoutSessionsCompleted,
    sessionsRemaining: Math.max(0, DAILY_WORKOUT_CAP - latestResult.workoutSessionsCompleted),
    totalSyncPoints: latestResult.totalSyncPoints,
  };
});
