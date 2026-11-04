import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../admin';

/**
 * HoloCity desktop telemetry (ship-readiness items 2 + 3, Pak 2026-11-04): the game's own free analytics and crash
 * reporter. The desktop client batches small events and exception reports; this callable stores them under the
 * signed-in player, caps every size, and never reads them back. Nothing here changes gameplay state.
 *
 *   { kind: 'events', sessionId, build, items: [{ n, t, a? }] }      -> telemetry/{uid}/sessions/{sessionId}/batches/{auto}
 *   { kind: 'crash',  sessionId, build, items: [{ m, s, scene, up, log }] } -> telemetry/{uid}/crashes/{auto}
 */
export const TELEMETRY_MAX_ITEMS = 50;
export const TELEMETRY_MAX_ITEM_CHARS = 4000;
export const TELEMETRY_MAX_BATCH_CHARS = 64_000;

type Item = Record<string, unknown>;

export function validateTelemetry(data: unknown): { kind: 'events' | 'crash'; sessionId: string; build: string; items: Item[] } {
  const d = data as Record<string, unknown> | undefined;
  const bad = (why: string) => new HttpsError('invalid-argument', why, { rejectionCode: 'invalid_request' });
  if (!d || typeof d !== 'object') throw bad('invalid_request');
  const kind = d.kind;
  if (kind !== 'events' && kind !== 'crash') throw bad('invalid_kind');
  const sessionId = typeof d.sessionId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(d.sessionId) ? d.sessionId : null;
  if (!sessionId) throw bad('invalid_session');
  const build = typeof d.build === 'string' && d.build.length <= 64 ? d.build : 'unknown';
  if (!Array.isArray(d.items) || d.items.length === 0 || d.items.length > TELEMETRY_MAX_ITEMS) throw bad('invalid_items');
  let total = 0;
  const items: Item[] = [];
  for (const raw of d.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('invalid_item');
    const text = JSON.stringify(raw);
    if (text.length > TELEMETRY_MAX_ITEM_CHARS) throw bad('item_too_large');
    total += text.length;
    if (total > TELEMETRY_MAX_BATCH_CHARS) throw bad('batch_too_large');
    items.push(raw as Item);
  }
  return { kind, sessionId, build, items };
}

export const desktopTelemetry = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { kind, sessionId, build, items } = validateTelemetry(request.data);
  const receivedAt = FieldValue.serverTimestamp();
  if (kind === 'events') {
    const session = db.doc(`telemetry/${uid}/sessions/${sessionId}`);
    const batch = db.batch();
    batch.set(session, { build, lastAt: receivedAt, batches: FieldValue.increment(1), events: FieldValue.increment(items.length) }, { merge: true });
    batch.set(session.collection('batches').doc(), { build, receivedAt, items });
    await batch.commit();
    return { ok: true, stored: items.length };
  }
  const crashes = db.collection(`telemetry/${uid}/crashes`);
  const batch = db.batch();
  for (const item of items) batch.set(crashes.doc(), { build, sessionId, receivedAt, ...item });
  await batch.commit();
  return { ok: true, stored: items.length };
});
