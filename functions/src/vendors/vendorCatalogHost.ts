import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { VendorError } from '../lib/vendors';
import { readVendorCatalog, transactBuddyUnitPurchase } from './vendorStore';

function rethrow(error: unknown): never {
  if (error instanceof VendorError) {
    if (error.code === 'not_enough_holos') throw new HttpsError('failed-precondition', 'Not enough Holos.', { rejectionCode: error.code });
    const code = error.code === 'invalid_request' ? 'invalid-argument' : error.code === 'sequence_conflict' ? 'already-exists' : 'unavailable';
    throw new HttpsError(code, error.code, { rejectionCode: error.code });
  }
  throw error;
}

/** DECISIONS #47 read callable: catalog{vendorId: "marketplace" | "workshop"} → listings with server prices, Holos and inventory. */
export const vendorCatalogHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to browse vendors.');
  try {
    return await readVendorCatalog(db, uid, request.data);
  } catch (error) {
    rethrow(error);
  }
});

/** DECISIONS #47: buy one Medium or Heavy Buddy Unit. Request {tierId, requestId}; idempotent per requestId. */
export const purchaseBuddyUnit = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in to make purchases.');
  try {
    return await transactBuddyUnitPurchase(db, uid, request.data);
  } catch (error) {
    rethrow(error);
  }
});
