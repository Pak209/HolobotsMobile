# Move Lab Bottom Sections — Temporary Preview QA

- Source visual truth: `/var/folders/dp/hhhqq0ps54j6hk_gsdt8fscr0000gn/T/codex-clipboard-b99f6f9c-bb16-4a4b-bc2b-11d530c1d6ef.png`
- Implementation preview: `/Users/pak/Projects/HolobotsMobile/.tmp/move-lab-bottom-preview/move-lab-bottom-sections-preview.png`
- Combined comparison: `/Users/pak/Projects/HolobotsMobile/.tmp/move-lab-bottom-preview/move-lab-bottom-sections-comparison.png`
- Viewport represented: 390 px mobile width at 2× density
- State: Strike slot, Details tab, rank 0, filter All, ascending sort

## Findings

No actionable P0, P1, or P2 issues remain in the isolated preview. Both sections
preserve the reference hierarchy, icon prominence, compact metadata, angular
dark panels, red strike accents, yellow actions, and readable list density.

## Comparison history

- Earlier pass: tabs and the Upgrade/Preview actions still read as plain
  rectangles, while stat and list-row borders were too continuous.
- Fix: replaced those surfaces with clipped-corner frame components and added
  intentional rail gaps, stepped reconnects, split stat rules, and right-edge
  row ticks.
- Revised evidence: the current preview shows the same broken-line rhythm and
  chamfered action silhouettes visible in the focused reference uploads.
- AAA pass: tightened the list header-to-row rhythm, added loadout slot coding,
  tactical-profile hierarchy, active-tab energy markers, move indices, visible
  result count, and press/disabled accessibility states. The final preview
  keeps the reference density while improving scan order and interaction
  feedback for a production mobile combat menu.
- Mobile-width correction: removed the two fixed metadata columns that caused
  names and descriptions to truncate on-device. Cost, Rank, Type, and rank pips
  now share one compact telemetry rail inside the flexible content column,
  leaving only icon, content, and Equip as horizontal zones.

## Required fidelity surfaces

- Typography: heavy condensed hierarchy is preserved with system fallbacks.
- Spacing: mobile two-column detail anatomy and dense list rows match the source.
- Colors: black, yellow, red, gray, and white token roles match.
- Image quality: the production transparent Strike asset is used directly.
- Copy: the preview uses real catalog move names, costs, descriptions, and ranks.

## Follow-up polish

- P3: The production app's system font is slightly wider than the mockup font.
- P3: The preview intentionally displays the real three-rank progression instead
  of the five-rank value pictured in the concept.

final result: passed
