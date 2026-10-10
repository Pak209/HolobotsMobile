# Knockout repair policy — focused proof passes, broad regression held

Knocked-out account Holobots stay knocked out when a new rival battle or zone run starts. An accepted Emergency Patch is the existing route back. What it means for Pak: this review branch removes the free recovery; it is not deployed.

| Item | Result | Evidence |
|---|---|---|
| Build/shared parity | zero errors, parity passes | compile.txt, parity.txt |
| Existing plus new pure host tests | 128 pass | unit2.txt |
| Item pure rules | 11 pass | items-pure.txt |
| Focused real Firestore transactions | 7 pass | emulator.txt |
| Existing rival-health transactions | 3 pass | rival-regression.txt |
| Client health/stock/receipt writes | 14 denied; weakened-ledger control fires | rules.txt |
| Same-class old behavior | zero becomes nonzero; tests catch it | known-bad-pure.txt, known-bad-emulator.txt |
| Broad item regression | HELD after two runs; no third | items-emulator-regression.txt, items-emulator-regression2.txt |

Focused transactions prove KO across rival/zone issues, accepted repair carrying forward, active-run refusals, exact retry identity, parallel stock consumption, authenticated callable guard and client spoof refusals. Signed-out practice remains Unity's existing interim; this host policy never governs that path. No payload shape or repair amount changed. The present repair fraction remains the existing host default.

Broad regression attempt one passed eight tests and failed two rules tests at hard-coded port 18080. The test now requires/reads the explicit loopback address. Attempt two passed six tests and failed four because the suite reused fixed user ids and existing receipts from attempt one; no stock is consumed on an idempotent replay. The test/session isolation still needs repair in a later session; no third run here. Fresh dynamic ids in the focused tests passed.

No deployment, real account, credentials or downloads. Cached Firestore JAR ran on loopback 8097, demo projects, then was stopped. Production behavior remains unchanged until a separately approved merge/deploy.
