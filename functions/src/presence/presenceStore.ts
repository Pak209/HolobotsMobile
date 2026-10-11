import { Firestore } from 'firebase-admin/firestore';
import { EMOTE_TTL_MS, PresenceError, PRESENCE_SCHEMA, projectPresence, prunePresence, validatePresenceCommand } from './presenceDomain';

/** Transaction over the aggregate doc preserves simultaneous pilots and prunes expired rows. */
export async function transactPresence(db: Firestore, uid: string, raw: unknown, now = Date.now()) {
  const command = validatePresenceCommand(raw);
  return db.runTransaction(async tx => {
    const userRef = db.doc(`users/${uid}`), wardrobeRef = db.doc(`wardrobes/${uid}`), sceneRef = db.doc('presenceScenes/HoloCity_Main');
    const [user, wardrobe, scene] = await Promise.all([tx.get(userRef), tx.get(wardrobeRef), tx.get(sceneRef)]);
    const state = prunePresence(scene.exists ? scene.data() : undefined, now);
    const optedOut = user.data()?.presenceOptOut === true;
    if (command.operation === 'leave' || optedOut || !user.exists) delete state.pilots[uid];
    else if (command.operation === 'heartbeat') {
      const previous = state.pilots[uid];
      const row = projectPresence(uid, user.data()!, wardrobe.exists ? wardrobe.data() : undefined, command, now);
      if (previous?.emote === 'wave' && (previous.emoteExpiresAtMs ?? 0) > now) { row.emote = 'wave'; row.emoteExpiresAtMs = previous.emoteExpiresAtMs; }
      state.pilots[uid] = row;
    }
    else {
      const row = state.pilots[uid];
      if (!row) throw new PresenceError('invalid_request');
      row.emote = 'wave'; row.emoteExpiresAtMs = now + EMOTE_TTL_MS;
    }
    tx.set(sceneRef, state);
    return { schemaVersion: PRESENCE_SCHEMA, visible: !!state.pilots[uid], expiresAtMs: state.pilots[uid]?.expiresAtMs ?? 0 };
  });
}

/** Account deletion removes even an unexpired public row (no grace period for deleted identities). */
export async function removePresence(db: Firestore, uid: string): Promise<void> {
  await db.runTransaction(async tx => {
    const ref = db.doc('presenceScenes/HoloCity_Main'), snapshot = await tx.get(ref);
    if (!snapshot.exists) return;
    const state = prunePresence(snapshot.data(), Date.now());
    delete state.pilots[uid]; tx.set(ref, state);
  });
}
