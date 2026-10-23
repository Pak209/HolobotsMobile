import { onDocumentWritten } from "firebase-functions/v2/firestore";

import { db } from "../admin";
import { projectLeaderboardEntry as projectEntry } from "../lib/leaderboardProjection";

/**
 * Public leaderboard projection (privacy hardening): /users documents are
 * owner-read-only, so the top-N query reads /leaderboard/{uid} instead —
 * a mirror of ONLY the public fields, maintained by this trigger on every
 * profile write. Rules keep the projection read-only for clients.
 */

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
