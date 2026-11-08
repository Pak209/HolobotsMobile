// One-off (Pak, 2026-11-08: "Yes, backfill"): pay the one-time cup prize to pilots who won cups before prizes existed.
// Same applyCupPrize and cupPrizes/{uid} ledger as a live win, so it pays each cup once and is safe to re-run.
// Usage: node scripts/backfill-cup-prizes.mjs [--project holobots-24046] [--apply]   (default: dry run)
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CUP_IDS, applyCupPrize, readCupPrizeLedger } from '../lib/lib/cupRewards.js';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
const projectId = arg('--project', 'holobots-24046'), apply = process.argv.includes('--apply');
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(), now = Date.now(), rows = [];
const users = await db.collection('users').where('storyFlags.tournamentsWon', '>', 0).get();
for (const u of users.docs) {
  const uid = u.id, won = Math.min(CUP_IDS.length, Number(u.data().storyFlags?.tournamentsWon) || 0);
  const brackets = await db.collection(`arenaBrackets/${uid}/brackets`).get();
  for (const cupId of CUP_IDS.slice(0, won)) {
    const row = brackets.docs.map(d => ({ id: d.id, ...d.data() })).find(b => b.tournamentId === cupId);
    const holobotId = String(row?.entrant?.holobotId ?? row?.holobotId ?? u.data().holobots?.[0]?.name ?? '').toLowerCase();
    const matchId = row?.id ?? `backfill_${cupId}`;
    const result = await db.runTransaction(async tx => {
      const userRef = db.doc(`users/${uid}`), ledgerRef = db.doc(`cupPrizes/${uid}`);
      const [snap, ledgerSnap] = [await tx.get(userRef), await tx.get(ledgerRef)];
      const ledger = readCupPrizeLedger(ledgerSnap.exists ? ledgerSnap.data() : undefined);
      if (!ledger) return 'bad-ledger';
      if (ledger.prizes[cupId]) return 'already-paid';
      if (!holobotId) return 'no-holobot';
      const fresh = applyCupPrize(snap.data(), cupId, holobotId, matchId, now);
      if (!fresh) return 'unreadable-profile';
      if (apply) { tx.update(userRef, fresh.userUpdates); tx.set(ledgerRef, { schemaVersion: ledger.schemaVersion, prizes: { ...ledger.prizes, [cupId]: fresh.receipt } }); }
      return apply ? 'paid' : 'would-pay';
    });
    rows.push({ uid: uid.slice(0, 6) + '…', cupId, holobotId, result });
  }
}
console.log(JSON.stringify({ projectId, apply, pilots: users.size, rows }, null, 1));
