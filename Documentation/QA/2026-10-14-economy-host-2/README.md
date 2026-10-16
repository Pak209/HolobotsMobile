# economy-host-2 — zone ISSUE cooldown and CPU move tuning

2026-10-14; isolated branch `codex/economy-host-2`, based on main `5d57afa` (#79).
No deploy, real pilot account, Unity/editor operation, or production request.

## Outcome and contract

- The same zone cannot be issued for **180,000 ms (3 minutes)** after its last **first-time settle**, including wins, losses and reward-withheld settles. Admission is allowed at the exact boundary. Other zones have independent clocks. An issue alone does not start the clock.
- `holoZoneHost` `issue` throws `failed-precondition`, message `zone_cooldown`, details `{ rejectionCode: "zone_cooldown", retryAfterMs: <positive ms remaining> }`. This reuses the existing rival cooldown error envelope. The successful `holozone-run-1` and `holozone-run-2` reply fields and versions do not change. Status and receipt replay remain available. A rejected issue writes nothing and never closes an open run.
- `holoZoneRuns/{uid}.zoneLastSettledAtMs` is a server-only zone-id → first-time-settle timestamp map. Old ledgers derive existing timestamps from stored runs; the map survives bounded run-history pruning. Corrupt state fails closed. Replay does not reset the clock. Existing rules already deny client writes to the whole ledger.
- Newly issued `rival-battle-3` CPU `moves[].damageScale` uses the table below; player moves and `rival-battle-1` / `-2` numbers stay unchanged. Existing issued battle snapshots are not rewritten. No field or schema version is added. Holos remain **100 win / 25 loss / 0 under 20 seconds**, rival cooldown **5 minutes**, and the city's **40%** recovery is unchanged.

## Tuning basis and table

Source: HolobotsUnity `Documentation/QA/2026-10-13-feel-4/README.md` section 2 (the precise measurement, despite the earlier brief's directory guess). CPU output was **2098 → 1957 damage/min** (−6.721%, reported −7%); player output **1319 → 538** (−59.211%, reported −59%).

`targetRetained = 0.45 + 0.35 * min(tier, 9) / 9`; `CPU multiplier = targetRetained / (1957 / 2098)`. This compensates for the already-observed CPU cut-swing loss instead of applying it twice. There are **10** canonical rows, **0–9**; tiers **10+** retain tier 9's multiplier. Full precision is stored/calculated; this table rounds to six decimals.

| Tier | Label | WOLF level | CPU multiplier | Before: gap / heavy / intercept | After: gap / heavy / intercept | Modeled drop vs pre-cut |
|---|---|---:|---:|---|---|---:|
| 0 | rookie | 1 | 0.482422 | 1.35 / 1.55 / 0.45 | 0.651270 / 0.747754 / 0.217090 | 55.000% |
| 1 | rookie | 5 | 0.524113 | 1.35 / 1.55 / 0.45 | 0.707552 / 0.812375 / 0.235851 | 51.111% |
| 2 | challenger | 9 | 0.565804 | 1.35 / 1.55 / 0.45 | 0.763835 / 0.876996 / 0.254612 | 47.222% |
| 3 | challenger | 13 | 0.607494 | 1.35 / 1.55 / 0.45 | 0.820118 / 0.941616 / 0.273373 | 43.333% |
| 4 | elite | 17 | 0.649185 | 1.35 / 1.55 / 0.45 | 0.876400 / 1.006237 / 0.292133 | 39.444% |
| 5 | elite | 21 | 0.690876 | 1.35 / 1.55 / 0.45 | 0.932683 / 1.070858 / 0.310894 | 35.556% |
| 6 | elite | 25 | 0.732567 | 1.35 / 1.55 / 0.45 | 0.988965 / 1.135479 / 0.329655 | 31.667% |
| 7 | legend | 29 | 0.774258 | 1.35 / 1.55 / 0.45 | 1.045248 / 1.200099 / 0.348416 | 27.778% |
| 8 | legend | 33 | 0.815948 | 1.35 / 1.55 / 0.45 | 1.101530 / 1.264720 / 0.367177 | 23.889% |
| 9 | legend | 37 | 0.857639 | 1.35 / 1.55 / 0.45 | 1.157813 / 1.329341 / 0.385938 | 20.000% |

## HELD: aggregate damage/min and duel duration acceptance

The table is a **modeled named-move adjustment**, not a new measured CPU damage/min or duel-length result. Read-only Unity tracing found:

- `Assets/Battle/Scripts/Combat/Ace/AceCombatController.cs:800`, `:805`, `:814`: commanded gap/heavy/SKY strikes consume host `MoveSnapshot.damageScale`; `NpcPilotPolicy` queues those command slots.
- `AceCombatController.cs:66` and `:918`: autonomous `attack_light` instead consumes serialized `lightDamageScale = 0.55`; `Configure` does not overwrite it from the host.
- The existing damage TSV identifies the victim, not the move; `FeelTraceWitness.OnLanded` logs the selected player actor. These records cannot establish the CPU autonomous-poke share.

If fraction `f` of CPU damage comes from host-scaled moves, the linear Rookie output retention is `0.932793 - 0.482793*f`: between **45% and 93.279%**, before integer rounding and behavior changes. Therefore the whole-CPU **−55%** / top-tier **−20%** targets and restored Rookie duel length cannot be claimed from this host patch. They remain **HELD** pending a scoped Unity consumer change that takes autonomous-strike scaling from host data, and a fresh unpinned end-to-end witness. This lane did not alter Unity or invent an additional reply field.

## Validation

- Root `npm run build`: green (Vite 1.23 s; the first sandboxed invocation could not write the existing dependency cache, then completed with cache access).
- `npm --prefix functions run build`: green; `check:shared`: **3/3** byte-identical shared pairs.
- `npm --prefix functions test`: **148 passed, 1 skipped (149 total)**, including **4 new** table/cooldown unit tests.
- Mobile `rivalLadderScaleParity.test.ts`: **5/5 passed**.
- Local demo Firestore emulator (`demo-holobots-economy-host-2`, loopback **18086**, websocket **19186**, hub **14401**, logging **14501**, JVM **1 GB**): **59/59 passed**, including **7 new** cooldown tests and **52** economy/rival/zone regressions. All accounts were unique `econ2_*` or existing suite throwaway identifiers; no authentication to production.
- Attempt 1: **58/59**, **44.4 s**; one edited legacy fixture referenced its new clock before declaration. Corrected only that fixture. Attempt 2: **59/59**, **41.3 s**, emulator shut down cleanly. Two attempts total.
- New cases cover exact countdown/boundary, no writes on refusal, both wire versions' callable details, win/loss/withheld clocks, replay idempotency, old-ledger migration, history-prune resistance, independent zones, malformed state, concurrent settlements, every tuning row, tier cap, invalid tiers, player/legacy controls.

Logs for this local run: `/private/tmp/economy-host-2-units.log`, `/private/tmp/economy-host-2-emulator-1.log`, `/private/tmp/economy-host-2-emulator-2.log`.
