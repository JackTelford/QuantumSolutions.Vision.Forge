# Blind test, our side: the product shot

The record of one side of the comparison `docs/blind-test.md` defines, for the first piece. The other side is the owner's to produce with the comparison tool from the same prompt; the scoring sheet at the end stays blank until the owner has judged both sides in the same player, at the same size, in a random order. This is a single-owner judgment on one piece and nothing more.

## The prompt, verbatim

> A 15-second studio product film of a frosted-glass cosmetic bottle with a brushed-metal cap on a dark backdrop. Macro details, a slow hero reveal, and the product name on screen at the end. Loopable. 16:9.

Given to the skill as the brief's `prompt` field, unedited. The prompt names no product, so the title reads "Vela", a placeholder chosen by the skill and recorded in the brief's `limitsAcknowledged`.

## Tool versions

| Tool | Version |
| --- | --- |
| Node | v24.13.0 |
| ffmpeg and ffprobe | 9.0.2-full_build-www.gyan.dev |
| Microsoft Edge | 156.0.4314.50 (WebGL2 hardware, ANGLE D3D11 on an NVIDIA GeForce RTX 2060, driver 610.88) |
| Blender | 5.2.3 LTS (EEVEE on OpenGL for every shot; devices CUDA, OptiX, CPU available) |
| three | 0.186.1 (the three lane rendered three still rounds of the macro, none of which is in the delivery) |
| playwright-core | 1.64.1 |
| Repository | commit 5c42ec6 (M6) plus the M7 working tree: text plates, `assemble --job`, `qa --job` |
| Machine | Windows 11 Pro 10.0.26300, Intel Core i7-9700K, RTX 2060, interactive session |

## The files

| File | What it is |
| --- | --- |
| `skills/cinematic-studio/examples/product-film/{brief,treatment,shot-spec,look}.json` | the four documents the skill wrote from the prompt; the shot spec as it stood after the still loop |
| `<out>/88f8e97b/88f8e97b.mp4` | the delivery: 1920x1080, 30 fps, H.264, 450 frames (15.0 s), no audio, 13.7 MB (byte-identical to the fifth round's `559117d6.mp4`; see below) |
| `<out>/88f8e97b/stills/s03-r2-2x.png` | the 4K hero still (3840x2160) of the hero arc at its end frame |
| `<out>/88f8e97b/stills/s0*-r1.png`, `s03-r2.png` | the approved stills with their gate reports beside them |
| `<out>/88f8e97b/assembly-plan.json`, `grade.cube` | the plan `assemble --job` built and the grade it baked |
| `<out>/88f8e97b/qa/88f8e97b.qa.json` | the QA report |
| `docs/evidence/m7/` | the command log, timings, sheets, reductions and the viewing notes |

`<out>` is the scratch output directory of the run (`C:\Users\wipke\AppData\Local\Temp\claude\C--Code-QuantumSolutions-Vision-Forge\2dd853b9-562e-4520-a6e6-3a673d83950f\scratchpad\module-c\out`); the delivery and the 4K still are not committed (binary, 13.7 MB and 6.8 MB). Copy them beside the comparison tool's output for the judging.

## How long it took

31 minutes of wall clock from `doctor` to the `qa` of the fifth round (20:14 to 20:45 on 2026-10-29), of which 21.7 minutes inside the commands: 687 s for the first full render of 465 blender frames at 1080p (1.3 to 1.8 s per frame, EEVEE on OpenGL), 165 s for the fix pass's render (three shots reused from the cache), 63 s per 4K still, 7 to 9 s per 1080p still, 22 s to assemble, 12 s for qa. A sixth round after the review took 2.5 minutes more (21:02 to 21:05, 135 s inside the commands): four sentences of the treatment that still described earlier rounds were corrected, which changed the job id but no shot, so `render` reused all 465 frames and the delivery came out byte-identical. Six planning rounds in all: three still rounds, one design change (the macro's lane moved from three to blender, as the rubric prescribes after the third round), one timing fix after viewing the delivery (the title's exit), one prose correction of the treatment. The timings per command are in `docs/evidence/m7/README.md`.

## The QA outcome

Every check passes after the integration pass: dimensions, fps, duration, black and frozen frames, pops (lowest adjacent-frame SSIM 0.979 at the cross-fade's last frame), exposure drift, text contrast 9.98:1 at worst, loudness and true peak skipped without audio, and the four hero comparisons (1.0, 0.9997, 0.9999, 1.0: each shot's approved raw still against frame k of its render). The slice's own run had ended `failed` on `hero-still-match` because the check then compared the still with the delivery frame after grain and x264 (0.94, 0.85, 0.92 against 0.98 on dark gradients, while the still and the render agreed to 0.99997); the check now makes the comparison ADR 0006 decision 7 names, and the job is `delivered`. The piece is submitted with the QA loop honoured and no failing check.

## Known defects in the piece

Criterion 5 scores artifacts, so they are listed here rather than left for the judge to find:

1. The dissolve (frames 330 to 344) was a per-pixel noise dissolve in the slice's own run (ffmpeg's xfade `dissolve`, mapped from the grammar's word); the integration pass mapped it to the linear cross-fade and re-assembled the job from the same frames, so the piece as submitted has a soft cross-fade there (`docs/evidence/m7/dissolve-frame-0337-crop-100.png`).
2. **A notch where the neck meets the cap**, visible at 100 percent in the 4K still and in the close-up: the two primitives' faces coincided. The primitive now overlaps them, but this piece was not re-rendered after that change, so the notch is in the submitted file.
3. The frosted glass and the brushed metal of the prompt are not shown, only suggested (an opaque coated body, a satin cap); this is a stated limit of the lanes, not an artifact, and the treatment says so.

## What was not automated

Everything after the four documents ran through the CLI with no hand edit of any generated file. These steps were done by hand, as the skill does them, and are listed because each is a judgment, not a command:

1. Writing the four documents from the prompt (the questionnaire, the treatment, the shot list, the look choice). This is the skill's directing step by design, not a failure of the slice.
2. The still review: looking at every still and its 100 percent crops, naming the faults, and editing the shot spec between rounds (four plan runs; the edits are listed in `docs/evidence/m7/README.md`).
3. Choosing the placeholder product name.
4. Making the 640 px reductions and the 100 percent crops under `docs/evidence/m7/` with ffmpeg directly, for this record only; nothing of the delivery was touched.
5. Extracting every fifteenth delivery frame with ffmpeg directly for the delivery contact sheet (the `sheet` command takes PNGs, not a video); a `sheet --video <file> --every <n>` option would close this.

Nothing was edited after `render`: the delivery is `assemble --job`'s output as `qa --job` measured it.

## Scoring sheet (blank: the owner fills it after viewing both sides)

| Criterion | Our side (1 to 5) | Comparison side (1 to 5) | Notes |
| --- | --- | --- | --- |
| 1. Looks professionally made at first glance | | | |
| 2. Clarity of subject and message | | | |
| 3. Craft of type, light and composition | | | |
| 4. Coherence across shots (lens, light, palette, pacing) | | | |
| 5. Absence of artifacts (aliasing, banding, pops, clipped text, timing errors) | | | |

Pass for the piece: our side wins or ties on at least three of the five. Stills are judged at 100 percent crops of the text and the subject as well as the full frame (`docs/evidence/m7/` has the crops of our side).
