# Blind side-by-side protocol

Success for this project is a blind comparison judged by the owner on three use cases. This document fixes the briefs, the outputs and the scoring before any milestone optimizes against them. It never claims parity with any commercial tool; it records one owner's judgment on three pieces.

## The three pieces

| Piece | Brief given to both sides, verbatim | Deliverable |
| --- | --- | --- |
| Product shot | "A 15-second studio product film of a frosted-glass cosmetic bottle with a brushed-metal cap on a dark backdrop. Macro details, a slow hero reveal, and the product name on screen at the end. Loopable. 16:9." | 1920x1080, 30 fps, H.264, 15 s, plus one 4K hero still |
| Explainer | "A 45-second narrated explainer that teaches what a content hash is and why it makes renders resumable. Clean, friendly, diagram-led. Captions on screen." | 1920x1080, 30 fps, H.264, 45 s, narration and captions |
| Title sequence | "A 12-second cinematic title sequence for a documentary called 'Deep Field'. Dark, atmospheric, a light sweep revealing the title, a tagline, fade to black." | 1920x1080, 30 fps, H.264, 12 s |

The same prompt text is given to the comparison tool. Neither side gets manual edits after generation. Our side runs from one English prompt through the skill with the QA loop enabled and no hand-edited files.

## Scoring sheet

Each piece is scored per side, 1 (poor) to 5 (excellent), on:

1. Looks professionally made at first glance.
2. Clarity of subject and message.
3. Craft of type, light and composition.
4. Coherence across shots (lens, light, palette, pacing).
5. Absence of artifacts (aliasing, banding, pops, clipped text, timing errors).

Pass for a piece: our side wins or ties on at least three of the five criteria. The three pieces are judged independently; the project is not "done" until all three pass or the owner accepts the result with the shortfall written into `docs/handoff.md`.

## Rules

- The judge views both sides at the same size, in the same player, in a random order per piece.
- Stills are judged at 100 % crops of text and the subject in addition to the full frame.
- Results, the exact prompts used and the tool versions on both sides are recorded in `docs/evidence/blind-test/`.
- The write-up states the comparison is a single-owner judgment on three pieces and nothing more.
