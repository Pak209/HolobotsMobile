# HolobotsMobile — Agent Instructions

<!-- BEGIN:pakos-human-action -->
## Human-only blockers → PakOS "Actions Needed"

When a task is blocked on something only Pak can do — credentials/API keys,
physical-device testing, PR or deploy approval, purchases, third-party
account access, legal acceptance, a subjective product/design call — file it
in PakOS's Actions Needed inbox instead of only mentioning it in your final
report. Never file work an agent could do with its current access; when in
doubt, try first and file only after you actually hit the wall.

```sh
node ~/Projects/PakOS/bin/pakos-action.js add \
  --project "HolobotsMobile" \
  --title "<what Pak must do>" \
  --why "<one line: why this needs a human>" \
  --step "<exact step: console path or URL>" \
  --step "<next step>" \
  --priority high \
  --source codex \
  --task "<board mission title this blocks, if any>"
```

Priorities: `critical` (other work is stopped now) · `high` (blocks the
current mission) · `medium`/`low`. `--source` is who you are: `codex`,
`claude`, or `fable`. Re-filing the same (project, title) updates the open
action instead of duplicating it — always safe to re-file. If this blocks a
`.pakos/board.md` mission, pass `--task` with its exact title so Pak's
"Send Back to Crew" button can move it back to Ready when he's done. End
your report with one line per action filed:
`⚑ filed action: <title> [priority]`.
Full rule: `~/Projects/PakOS/skills/pakos-human-action/SKILL.md`.
<!-- END:pakos-human-action -->
