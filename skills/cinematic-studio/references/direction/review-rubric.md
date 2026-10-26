# Review rubric

How a still, a contact sheet and a finished delivery are judged. The measurable checks run first and are authoritative; the vision rubric runs on what passes them. A reviewer who has not named three faults has not looked.

## Measurable checks (automatic, before any opinion)

| Check | Tool | Pass |
| --- | --- | --- |
| subject inside action safe, anchor on the grid, text inside title safe, no text over the subject | the composition solver | every rule in composition/rules.md |
| text height and line length | the solver | floors and maxima in typography/system.md |
| contrast behind every text box | `qa` text-contrast on the finished frame | 4.5:1 or higher |
| exposure | `qa` exposure (signalstats YAVG) | inside the look's `qa.yavgMin` to `yavgMax`; neighbours within 40 unless a transition separates them |
| black or frozen frames | `qa` black-frames, frozen-frames | none outside a fade-black |
| pops | `qa` pops (adjacent-frame SSIM) | none away from a planned cut |
| hero frame equals the approved still | `qa` hero-still-match | SSIM 0.98 or higher |
| loudness and true peak | `qa` loudness, true-peak | within 1 LU of the target; peak at or below −1 dBTP |
| dimensions, fps, duration | `qa` against the plan | exact |

A still or delivery that fails any of these goes back to the spec, not to the rubric.

## The vision rubric (Claude reads the contact sheet and 100 percent crops)

Score each item 0 (fails), 1 (acceptable), 2 (strong). Read the full frame first, then the 100 percent crops of every text box and of the subject; small text, aliasing, z-fighting and clipped letters are invisible at sheet size.

| # | Item | 0 looks like | 2 looks like |
| --- | --- | --- | --- |
| 1 | Focal point | the eye wanders; no subject | the eye lands on the subject within a second |
| 2 | Composition | the subject floats; headroom or lead room wrong | anchor, headroom and lead room read as intended |
| 3 | Light direction | flat ambient; no shadow shape | a key with direction, a readable fill ratio, a rim that separates |
| 4 | Materials | plastic-looking, uniform roughness | speculars shaped by the softbox, roughness variation, believable glass or metal |
| 5 | Depth cues | a flat card | focus falloff, haze, parallax or overlap |
| 6 | Typography | small, low contrast, system font, orphans | clear hierarchy, legible at 100 percent, balanced lines |
| 7 | Palette | stock blue, gray void, colours off the look | every colour from the look's tokens |
| 8 | Nothing default | a default backdrop, font or light | every default replaced by a choice |
| 9 | Continuity | lens, light or grade changes between neighbours | one film |
| 10 | Artifacts | aliasing, banding, z-fighting, clipped highlights, clipped text | none at 100 percent |

Pass: 16 or more of 20, with no 0 on items 1, 6 and 10. Before a pass, name three faults (there are always three); fix the ones that cost less than a re-render of the shot. Retry cap: two re-renders per shot; after that, change the shot's design (size, lane, lighting), not its parameters.

## Writing the review

For each shot: `s03 — 17/20 — faults: cap highlight clips (10), label 26 px is at the floor (6), rim too strong on the left (3) — pass`. The rounds go into the `qa-report` rubric with the scores and faults; the next round's still must address the named faults or say why not.

## What not to do

- Do not approve from the sheet alone; open the crops.
- Do not call a render photoreal; describe what the materials and light do.
- Do not score continuity on one shot; it needs the neighbours on the same sheet.
- Do not fix a 0 on focal point with a text change; it is a composition or lighting problem.
