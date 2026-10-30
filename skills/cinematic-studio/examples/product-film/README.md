# Example: the product film

The first shipped example: the four documents the planner takes for the product brief of `docs/blind-test.md`, exactly as the skill wrote them from the prompt, and the commands that turned them into the delivery recorded in `docs/evidence/m7/`.

## The prompt

> A 15-second studio product film of a frosted-glass cosmetic bottle with a brushed-metal cap on a dark backdrop. Macro details, a slow hero reveal, and the product name on screen at the end. Loopable. 16:9.

The prompt names no product, so the title reads "Vela", a placeholder: replace it in `brief.json` (`mustHaveText`) and in `shot-spec.json` (shot `s04`, text `t1`).

## The documents

| File | What it holds |
| --- | --- |
| `brief.json` | the director's questionnaire filled from the prompt: product-shot, 15 s, 1080p30, calm, quiet confidence, the limits acknowledged |
| `treatment.json` | the logline, four beats (open, macro, hero reveal, name) on the blender lane, five substitutions from the steering table, the risks |
| `shot-spec.json` | four shots: MS push-in, CU light sweep, MS arc, MS breathe with the title; 105 + 120 + 120 + 120 frames minus a 15-frame dissolve = 450 |
| `look.json` | the `obsidian` preset unchanged: low-key rig, Space Grotesk over Inter, AgX, the QA band 30 to 60 |

The loop: `s04` ends on the base pose of the eye-level MS (`breathe` returns to where it started and the title has faded out by the last frame) and `s01` starts from the same pose, so the last frame cuts to the first.

## The commands

Every command runs through `node scripts/cli.ts <command> --data-dir <data> --out <out>`; the run under `docs/evidence/m7/README.md` records each one with its timing and result.

```
doctor
assets --fetch hdri:studio_small_03-1k,hdri:studio_small_03-2k
plan --brief brief.json --treatment treatment.json --shot-spec shot-spec.json --look look.json
still --job <out>/<jobId> --shot s01        (and s02, s03, s04; at most three rounds each)
still --job <out>/<jobId> --shot s03 --scale 2
still --job <out>/<jobId> --shot s01 --approve   (and s02, s03, s04)
render --job <out>/<jobId>
assemble --job <out>/<jobId>
qa --job <out>/<jobId>
sheet --frames <out>/<jobId>/stills
```

The job id is the content hash of the four documents, so a still-loop edit to the shot spec plans into a new job folder; the earlier folders keep their rounds. The documents here are those of the sixth planning round: the fifth produced the delivery, and a review then found four sentences in the treatment that still described earlier rounds (a low arc, a close-up from above, a three-lane plate, a tempo reason that contradicted the 3.5 s opening shot). Correcting the prose changed no shot, so the sixth `plan` reused every rendered frame and `assemble --job` wrote a byte-identical delivery (job `88f8e97b`, recorded in `docs/evidence/m7/`).
