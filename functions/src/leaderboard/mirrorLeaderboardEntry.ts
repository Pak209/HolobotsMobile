import { onDocumentWritten } from "firebase-functions/v2/firestore";

import { db } from "../admin";

/**
 * Public leaderboard projection (privacy hardening): /users documents are
 * owner-read-only, so the top-N query reads /leaderboard/{uid} instead —
 * a mirror of ONLY the public fields, maintained by this trigger on every
 * profile write. Rules keep the projection read-only for clients.
 */

type LeaderboardEntry = {
  username: string;
  leaderboardScore: number;
  wins: number;
  prestigeCount: number;
  highestHolobotLevel: number;
  syncRank: string;
  genesisBadge: boolean;
};

function projectEntry(uid: string, data: Record<string, unknown>): LeaderboardEntry {
  const holobots = Array.isArray(data.holobots) ? (data.holobots as Array<Record<string, unknown>>) : [];
  const highestHolobotLevel = holobots.reduce(
    (highest, holobot) => Math.max(highest, Number(holobot?.level || 0)),
    0,
  );

  return {
    username: String(data.username || `pilot_${uid.slice(0, 8)}`),
    leaderboardScore: Number(data.leaderboardScore || 0),
    wins: Number(data.wins || 0),
    prestigeCount: Number(data.prestigeCount || 0),
    highestHolobotLevel,
    syncRank: String(data.syncRank || "Rookie"),
    genesisBadge: Boolean(data.genesisBadge),
  };
}

export const mirrorLeaderboardEntry = onDocumentWritten("users/{uid}", async (event) => {
  const uid = event.params.uid;
  const entryRef = db.doc(`leaderboard/${uid}`);

  const after = event.data?.after;
  if (!after?.exists) {
    await entryRef.delete().catch(() => undefined);
    return;
  }

  const projected = projectEntry(uid, after.data() ?? {});

  // Skip no-op mirrors: most profile writes (energy ticks, quest state)
  // don't touch any public field.
  const before = event.data?.before;
  if (before?.exists) {
    const previous = projectEntry(uid, before.data() ?? {});
    if (JSON.stringify(previous) === JSON.stringify(projected)) {
      return;
    }
  }

  await entryRef.set(projected, { merge: false });
});
