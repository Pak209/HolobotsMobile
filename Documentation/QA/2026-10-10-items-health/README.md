# Approved inventory deployment — host health addition

Pak approved inventory backend deployment on 2026-10-10. `rival-health-1` is an additive, explicitly negotiated extension to rival-battle-3; older request/reply projections remain unchanged. Inventory stays desktop-items-2.

Issue derives maximum health from the owned travel squad's existing host stats. A missing ledger initializes once at that maximum; surviving health persists, even when maximum health rises. At zero, the next host issue recovers forty percent (existing recovery magnitude moved to the backend; Pak's zero-recovery ruling). A health-enabled issue refuses any other open rival battle to prevent overlapping snapshots. The record captures issued vitals.

Settlement accepts raw remaining-health observations for issued bots, bounded at the issued health; the ledger only decreases. It is atomic with the existing settlement and reward receipt. Duplicate settles never reapply health or grants. Repairs remain between battles, consume once, and restore a quarter of the host maximum. Foreign targets, client health increases, nonfinite values and foreign/expired battle IDs refuse. Rules deny client health/stock writes; account deletion removes the containing user record.

Trust limitation: this retains the existing desktop battle service's client-observed outcome model. Remaining health, like didWin, is reported by the game; this is not server simulation or verified combat replay. A modified client can omit damage. Clients cannot use this endpoint to increase persisted health. This deployment does not claim stronger anti-cheat.

Verification: host build and full existing unit suite (110) pass; affected item/rival/progression suite (37) passes; 32 local emulator transaction/regression cases pass. The issue → damage → reconnect → repair → next issue witness proves carry-over and once-only consumption. An allowed profile edit is the control for protected-field denial. Native Unity health/retry/progression tests (139) pass. Media stays in the vault. No credentials recorded.

Scope: rival battles and repairs. HoloZone health integration is not included in this checkpoint and must not be represented as complete. Test-produced fixture changes outside the pathspec are preserved; cleanup was rejected by automatic approval review.
