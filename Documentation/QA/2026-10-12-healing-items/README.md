# DECISIONS #57 / item P — six review PRs, no deploy

| Step | PR | Own verification | Status |
|---|---|---|---|
| 1 catalog | https://github.com/Pak209/HolobotsMobile/pull/71 | known-bad first; emulator 1/1, domain 19/19, build/shared | review ready |
| 2 item use / Arena / duel settle | https://github.com/Pak209/HolobotsMobile/pull/74 | known-bad first; approved extra emulator 21/23; healing cases5/5; build/shared | HELD / draft, two missing-dependency loads in approved extra run |
| 3 Workshop free heal | https://github.com/Pak209/HolobotsMobile/pull/75 | known-bad first; second emulator 4/4, build/shared | draft behind 2 |
| 4 boss / rank grants | https://github.com/Pak209/HolobotsMobile/pull/72 | known-bad first; emulator 14/14 plus route expansion 4/4, build/shared | draft behind 3 |
| 5 Workshop craft | https://github.com/Pak209/HolobotsMobile/pull/73 | known-bad first; emulator 2/2, build/shared | draft behind 4 |
| 6 contract / parity | https://github.com/Pak209/HolobotsMobile/pull/76 | known-bad first; emulator 1/1; six mobile parity keys, final build/shared | draft behind 5 |

All target main. Merge order 71 -> 74 -> 75 -> 72 -> 73 -> 76; import/export conflicts are resolved on the dependent branches. Earlier step README dependency notes describe their original baseline; current PR bodies and this index are the final merge graph. Final integrated branch codex/healing-6-contract includes all source and evidence. Never merge/deploy held steps until their gates are cleared.

Step 2: second attempt's new live-zone fixture leaves KUMA at 0 HP. Portal issue correctly refuses holobot_ko, so the test never reaches live-zone heal. The other 22 cases pass, including existing paid mid-zone repair. No third attempt or fixture edit after the cap. Actions Needed: Authorize one healing step-2 fixture retry [high], id 3e9643b2-8fdc-4228-9d05-b402d93723b4. Proposed correction makes KUMA positive before issue, then one demo-emulator retry; requires Pak authorization.

All numbers are in PR bodies: 25/50/100%, 100/250/600 Holos; item count 1, squad max 3, duel lockout 3000 ms; Workshop cost 0 and full 100%; boss/rank Kit 1, boss minimum 20000 ms; rank levels 1/11/21/31/41 (owned Legendary crossing four grants four); recipes 3/5 fragments plus one lower tier for one output; city issue 40% unchanged. Full has no reward grants; approved crafting is the exception to vendor-only.

Arena matchId forwarding and local-duel client accounting hookup remain rollout gates; headless sim/server-token/multiplayer and unrelated holds remain closed. No deploy, production calls, real workout, Pak account or Unity editor operation. Work occurred only in isolated worktrees; shared Mobile dirty paths remain the original board/four fixtures/handoff. Symlinked dependency directories were never staged. Media/generated binaries are absent from commits.

Final source review resolved import/export integration without changing runtime policy; merge-conflict-build.log retains the failed compile before marker removal, final-build.log confirms clean shared/TypeScript compile. No second or third step-2 emulator rerun was hidden in contract validation.

## Latest approved retry checkpoint
Pak approved the minimal host lifecycle and the KUMA fixture correction plus one additional bounded retry. Correction committed on step2 (efadc63) and propagated to dependent branches. All five new healing cases pass, including the previously blocked live-zone test. Selected batch 21/23: two unchanged rules tests could not load dependencies because the second worktree lacked rules-tests/node_modules. This agent setup omission is fixed; dependency-preflight.log confirms both modules load. Those cases passed previously, but latest full batch is not green. No second extra run. Earlier 22/23 and spent-limit notes above are historical. Current action: Authorize healing rules dependency retry [high], 652ea618-fc08-4084-bff8-8c831d4ea5dd; one targeted rules-only run, two cases, 300-second limit proposed. Previous fixture-retry action completed. Draft/deploy/client rollout holds preserved.
