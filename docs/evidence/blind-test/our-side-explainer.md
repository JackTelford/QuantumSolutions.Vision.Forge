# Blind test, our side: the explainer

The record of one side of the comparison `docs/blind-test.md` defines, for the second piece. The other side is the owner's to produce with the comparison tool from the same prompt; the scoring sheet at the end stays blank until the owner has judged both sides in the same player, at the same size, in a random order. This is a single-owner judgment on one piece and nothing more.

## The prompt, verbatim

> A 45-second narrated explainer that teaches what a content hash is and why it makes renders resumable. Clean, friendly, diagram-led. Captions on screen.

Given to the skill as the brief's `prompt` field, unedited. The treatment gate was passed on the owner's standing permission for this run ("full permission to complete this as you see fit"), not on a yes to the treatment page; the owner's own run through Claude Code will stop there.

## Tool versions

| Tool | Version |
| --- | --- |
| Node | v24.13.0 |
| ffmpeg and ffprobe | 9.0.2-full_build-www.gyan.dev |
| Microsoft Edge | 156.0.4314.50 (WebGL2 hardware, ANGLE D3D11 on an NVIDIA GeForce RTX 2060, driver 610.88) |
| Narration | kokoro-js 1.2.1, Kokoro-82M v1.0 q8 weights, voice `af_heart`, CPU; DirectML.dll not mapped |
| playwright-core | 1.64.1 |
| Repository | commit 89469e6 (v0.1.0) plus the working tree of this run: the four fixes in `docs/evidence/explainer/README.md` |
| Machine | Windows 11 Pro 10.0.26300, Intel Core i7-9700K, RTX 2060, interactive session |

## The files

| File | What it is |
| --- | --- |
| `skills/cinematic-studio/examples/explainer/{brief,treatment,shot-spec,look}.json`, `narration-script.txt` | the documents the skill wrote from the prompt; the shot spec as it stood after the still loop |
| `<out>/62fedd4e/62fedd4e.mp4`, `.srt` | the delivery: 1920x1080, 30 fps, H.264, 1350 frames (45.0 s), AAC narration at −16 LUFS, captions burnt in, 6.1 MB; the SRT beside it |
| `<out>/62fedd4e/stills/s0*-r1.png` | the seven approved stills with their gate reports beside them |
| `<out>/62fedd4e/narration/` | the WAV, the SRT and `narration.json` with the sentence frames |
| `<out>/62fedd4e/assembly-plan.json`, `grade.cube` | the plan `assemble --job` built and the grade it baked |
| `<out>/62fedd4e/qa/62fedd4e.qa.json` | the QA report |
| `docs/evidence/explainer/` | the command log, timings, sheets and crops |

`<out>` is `C:\Code\QuantumSolutions.Vision.Forge\out` for this run; the delivery is not committed (binary). Copy it beside the comparison tool's output for the judging.

## How long it took

25 minutes of wall clock from `doctor` to the first passing `qa` (09:32 to 09:57 on 2026-10-30), of which about 7 minutes inside the commands: 152 s for the 1350 html frames (109 to 118 ms per frame), 5 s per still, 40 s per narration synthesis, 20 s to assemble, 15 s for qa. Four planning rounds: three still rounds (exposure, then type sizes, then pass) and one prose correction of the treatment that changed no shot and produced a byte-identical delivery. The four pipeline fixes made on the way are in `docs/evidence/explainer/README.md`.

## The QA outcome

Every one of the 17 checks passes: dimensions, fps, duration (1350 frames), no black frames, no frozen frames outside the planned holds (every shot breathes on a 2.5D stage, so each clip holds by design), no pops (lowest adjacent-frame SSIM 0.976 at frame 2, seven planned cuts excluded), exposure drift 5 YAVG, text contrast 8.47:1 at worst across 40 text boxes, integrated loudness −16 LUFS, true peak −4.8 dBTP against the −1.5 ceiling, and seven hero comparisons at SSIM 1.0 (each shot's approved raw still against frame k of its render). The run's first `qa` had failed `frozen-frames` because the check did not know a planned hold; the check now does, and a frozen run outside one still fails.

## Known defects in the piece

Criterion 5 scores artifacts, so they are listed here rather than left for the judge to find:

1. **The diagram is typographic.** "Diagram-led" became one labelled card per step: a dark slate rectangle on a paper stage with the words, the counter, the hash rows and the file names as type. No arrows, no icons, no boxes joined by lines. The treatment says so as a substitution; the judge may still find it thin.
2. **The card is a plain slate stand-in** with no content of its own; it is the html lane's subject primitive, lit and shadowed, and it never changes between beats.
3. **The hash rows** of the third beat render in the lower-third style (a white chip with an orange bar), which is the role's look rather than a diagram's; readable at 100 percent (`hash-rows-frame-0420-crop-100.png`), and more decorative than meant.
4. **The captions duplicate the headlines' sense.** They are the narration's own sentences, so a viewer reads the caption and the card's headline at once; the headlines say less than the voice on purpose, but at frame 0 the voice begins before the title has risen.
5. The second and fifth beats run 5.5 and 7.3 s against the dynamic tempo's 3.5 s ceiling, because the cuts follow the sentences, as the pacing table asks for narration.

## What was not automated

Everything after the four documents ran through the CLI with no hand edit of any generated file. These steps were done by hand, as the skill does them, and are listed because each is a judgment, not a command:

1. Writing the narration script and, from its sentence frames, the four documents (the questionnaire, the treatment, the shot list, the look choice).
2. The still review: looking at every still and its 100 percent crops, naming the faults, and editing the shot spec between rounds (three still rounds; the edits are listed in `docs/evidence/explainer/README.md`).
3. Making the reductions and the 100 percent crops under `docs/evidence/explainer/` with ffmpeg directly, for this record only; nothing of the delivery was touched.

Nothing was edited after `render`: the delivery is `assemble --job`'s output as `qa --job` measured it.

## Scoring sheet (blank: the owner fills it after viewing both sides)

| Criterion | Our side (1 to 5) | Comparison side (1 to 5) | Notes |
| --- | --- | --- | --- |
| 1. Looks professionally made at first glance | | | |
| 2. Clarity of subject and message | | | |
| 3. Craft of type, light and composition | | | |
| 4. Coherence across shots (lens, light, palette, pacing) | | | |
| 5. Absence of artifacts (aliasing, banding, pops, clipped text, timing errors) | | | |

Pass for the piece: our side wins or ties on at least three of the five. Stills are judged at 100 percent crops of the text and the subject as well as the full frame (`docs/evidence/explainer/` has the crops of our side).
