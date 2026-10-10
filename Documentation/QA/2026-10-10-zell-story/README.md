# Zell host story — review branch, feature off

The existing rival host can issue Zell as a named rival. The first accepted win on a host-stamped Zell fight marks him as an ally; a loss keeps him a rival. WOLF is the temporary partner. These defaults await Pak's call, and `HOLOCITY_ZELL_STORY` defaults off.

| Check | Result | Evidence |
|---|---|---|
| TypeScript + shared files | zero errors, parity passes | compile.txt, parity.txt |
| Pure host rules | 131 tests pass | unit.txt |
| Real Firestore story transactions | 11 pass, including concurrent duplicate wins and account deletion | emulator.txt |
| Existing rival/progression/health/deletion transactions | 24 pass | regression.txt |
| Client story access | 24 owner/foreign/anonymous denials; weakened-rule control fires | rules.txt |
| Transaction model | 11 pass; supplementary | transaction-model.txt |

Emulator ran from the already-cached Firestore JAR on loopback with demo projects. No downloads, credentials, live account or production deploy. Callable tests use `.run` with test authentication, not a deployed HTTP transport.

The optional `zell-story-1` response is additive over `rival-battle-3`. Ordinary replies stay unchanged; the companion Unity reader must land before activation. Existing client-reported battle settlements remain bounded by current host checks; this does not create a server combat simulation.

Pak calls: **WOLF** recommended for the temporary partner; **WIN** recommended for the first-win ally turn. No extra rewards or activation. Publication was rejected by automatic approval review, which still sees an earlier no-push instruction; root has the later direct approval and will handle publication.
