# Approved production deployment

Pak explicitly approved item inventory backend deployment on 2026-10-10.
Firebase project: holobots-24046. Successful deployment of desktopItemsHost, rivalBattleHost, openGachaPack, deleteUserAccountV2 and Firestore rules. Follow-up desktopItemsHost update blocks repairs during active zone runs; ten emulator tests pass. Production unauthenticated inventory request returns UNAUTHENTICATED, without touching account data. No authenticated production user was exercised.

Rival health code: 19c1d2a. Zone repair restriction: 9745e16. Repairs restore a quarter of host maximum between encounters. Rival issue recovers forty percent only at zero. Existing client-observed result trust boundary remains: this is not server combat replay; reports can omit damage. HoloZone damage carry is not implemented here. The Mac application still needs the matching Unity client packaged.
