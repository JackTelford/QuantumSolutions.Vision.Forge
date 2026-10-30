# M7 evidence: the product film from the blind-test brief, end to end

The vertical slice: the first piece of `docs/blind-test.md` made from its prompt through the commands only, with no hand edit of any generated file. The four documents the skill wrote are `skills/cinematic-studio/examples/product-film/`; the write-up for the comparison is `docs/evidence/blind-test/our-side-product.md`. Every number here is from one run on 2026-10-29 on the owner's machine (Windows 11, i7-9700K, RTX 2060, Edge 156, ffmpeg 9.0.2, Blender 5.2.3; `doctor` reported every lane). The scratch data and output directories are under the session's scratchpad (`<scratch>` below); nothing was committed from them except the reductions and sheets in this folder.

## What came out

- The delivery `<scratch>/out/88f8e97b/88f8e97b.mp4`: 1920x1080, 30 fps, H.264 (CRF 16), 450 frames, 15.00 s, BT.709, no audio. The slice's own run wrote it at 13,672,678 bytes with ffmpeg's noise dissolve at the hero-to-name join (the defect described under the viewing notes); after the integration pass mapped the grammar's dissolve to the linear cross-fade, `assemble --job` wrote it again from the same 465 frames at 13,159,792 bytes (MD5 0951d7af…), and that is the file the sheets and crops here show. Every frame outside the 330 to 344 overlap is the same picture; the join is now a cross-fade.
- The 4K hero still `<scratch>/out/88f8e97b/stills/s03-r2-2x.png`: 3840x2160, the hero arc's end frame; `hero-still-s03-4k-640.png` and `hero-still-s03-4k-crop-100.png` (a 960x540 crop at 100 percent, at 1480,300) here. Against the fifth round's 4K still it measures SSIM 0.99999 and PSNR 81 dB: EEVEE re-renders a 4K still to a few pixels, not to the byte.
- The loop: `frame-0000-640.png` and `frame-0449-640.png` are the first and last frames; measured against each other in planar RGB they give PSNR 47.0 dB and SSIM 0.974. For scale, two consecutive frames of the s04 hold with no text (441 to 449) measure 0.992 to 0.994 and the push-in of s01 0.992 to 0.994 (adjacent-frame SSIM over the whole file, measured with ffmpeg for this record), so the join is a little rougher than a held frame step: frame 449 is the end of the breathe and frame 0 the start of the push-in, a sub-pixel of framing apart, plus the grain. The `pops` check's own lowest figure, 0.969 at frame 345, is the last frame of the dissolve, not a held shot. The last frame cuts to the first without a seam a viewer would see.
- The stills: `stills-sheet.png` (every PNG under `<job>/stills/`: the four finished stills, their raw frames, the title plate of s04, the 4K still), `still-rounds-sheet.png` (the first still of every shot in each of the six planning rounds), `title-s04-crop-100.png` (the title box on the finished still at 100 percent) and `title-frame-0360-crop-100.png` (the same box in the delivery, with the grain).
- The delivery contact sheet `delivery-sheet.png`: every fifteenth frame (of the fifth round's file, which is the same file).
- `dissolve-frame-0337-crop-100.png`: frame 337, the middle of the one dissolve, at 100 percent (960x540 at 480,150): the known artifact described under the viewing notes.

## The command log

Every command ran as `node scripts/cli.ts <command> ... --data-dir <scratch>/data --out <scratch>/out` from the repository root; the four documents were passed from `skills/cinematic-studio/examples/product-film/`. Exit codes and wall-clock seconds are from the logger that wrapped each call; the summary is read from the result JSON on standard output. The job id is the content hash of the four documents, so every edit to the documents during the still loop planned into a new folder (210ecfb3, 3a2a13d3, 521e31ba, 99e9af87, 559117d6, and 88f8e97b for the treatment's prose correction after the review).

| Command | Exit | Seconds | Result |
| --- | --- | --- | --- |
| `doctor` | 0 | 4.1 | lanes html true, three true, blender true, audio true; problems 0 |
| `assets --fetch hdri:studio_small_03-1k,hdri:studio_small_03-2k` | 0 | 2.4 | hdri:studio_small_03-1k downloaded, hdri:studio_small_03-2k downloaded |
| `plan --brief brief.json --treatment treatment.json --shot-spec shot-spec.json --look look.json` | 0 | 1.0 | job 210ecfb3, 450 frames, warnings: 0 |
| `still --job <scratch>/out/210ecfb3 --shot s02` | 1 | 5.5 | still-gate: The still of shot "s02" failed the gate: exposure: average luma 66.7 YAVG outside the look's band 30 to 60 |
| `still --job <scratch>/out/210ecfb3 --shot s01` | 0 | 7.4 | frame 94, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 37.8 |
| `still --job <scratch>/out/210ecfb3 --shot s03` | 1 | 83.5 | blender-render: Blender did not render <scratch>/out/210ecfb3/stills/.work-s03-r1/blender/cycles-CPU/scene/cycles-CPU/109-109/scene.json: the first frame is black (YAVG 16.3); the scene rendered nothing (every rung of the ladder, EEVEE OpenGL to Cycles CPU) |
| `still --job <scratch>/out/210ecfb3 --shot s04` | 0 | 9.0 | frame 26, eevee/opengl, gate passed: composition 0, text-contrast 11.72, exposure 37.6 |
| `plan --brief brief.json --treatment treatment.json --shot-spec shot-spec.json --look look.json` | 0 | 1.0 | job 3a2a13d3, 450 frames, warnings: 0 |
| `still --job <scratch>/out/3a2a13d3 --shot s02` | 0 | 5.4 | frame 109, chromium/d3d11, gate passed: composition 0, text-contrast no text, exposure 43.4 |
| `still --job <scratch>/out/3a2a13d3 --shot s01` | 0 | 7.1 | frame 94, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 40 |
| `still --job <scratch>/out/3a2a13d3 --shot s03` | 0 | 7.1 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 37 |
| `still --job <scratch>/out/3a2a13d3 --shot s04` | 0 | 9.1 | frame 26, eevee/opengl, gate passed: composition 0, text-contrast 9.85, exposure 39.8 |
| `plan --brief brief.json --treatment treatment.json --shot-spec shot-spec.json --look look.json` | 0 | 1.0 | job 521e31ba, 450 frames, warnings: 0 |
| `still --job <scratch>/out/521e31ba --shot s02` | 0 | 5.4 | frame 109, chromium/d3d11, gate passed: composition 0, text-contrast no text, exposure 47.2 |
| `still --job <scratch>/out/521e31ba --shot s01` | 0 | 7.2 | frame 94, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 40.6 |
| `still --job <scratch>/out/521e31ba --shot s03` | 0 | 7.2 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 38 |
| `still --job <scratch>/out/521e31ba --shot s04` | 0 | 8.9 | frame 26, eevee/opengl, gate passed: composition 0, text-contrast 9.72, exposure 40.2 |
| `plan --brief brief.json --treatment treatment.json --shot-spec shot-spec.json --look look.json` | 0 | 1.0 | job 99e9af87, 450 frames, warnings: 0 |
| `still --job <scratch>/out/99e9af87 --shot s02` | 0 | 7.0 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 36.1 |
| `still --job <scratch>/out/99e9af87 --shot s01` | 0 | 7.2 | frame 94, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 40.6 |
| `still --job <scratch>/out/99e9af87 --shot s03` | 0 | 7.1 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 38 |
| `still --job <scratch>/out/99e9af87 --shot s04` | 0 | 8.4 | frame 26, eevee/opengl, gate passed: composition 0, text-contrast 9.72, exposure 40.2 |
| `still --job <scratch>/out/99e9af87 --shot s03 --scale 2` | 0 | 62.7 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 38; 4K still written |
| `still --job <scratch>/out/99e9af87 --shot s01 --approve` | 0 | 1.0 | s01 still-approved |
| `still --job <scratch>/out/99e9af87 --shot s02 --approve` | 0 | 1.0 | s02 still-approved |
| `still --job <scratch>/out/99e9af87 --shot s03 --approve` | 0 | 1.0 | s03 still-approved |
| `still --job <scratch>/out/99e9af87 --shot s04 --approve` | 0 | 1.0 | s04 still-approved |
| `sheet --frames <scratch>/out/99e9af87/stills --output <scratch>/out/sheets/stills.png --columns 4 --thumb-width 400` | 0 | 3.2 | 13 frames, 4x4 |
| `sheet --frames <scratch>/rounds/list.json --output <scratch>/out/sheets/rounds.png --columns 4 --thumb-width 400` | 0 | 3.2 | 15 frames, 4x4 |
| `render --job <scratch>/out/99e9af87` | 0 | 687.4 | 465 frames in 687 s; s01 105 f at 1345.4 ms/f, s02 120 f at 1839.2 ms/f, s03 120 f at 1336.3 ms/f, s04 120 f at 1295.6 ms/f + text plate |
| `assemble --job <scratch>/out/99e9af87` | 0 | 21.9 | 450 frames 1920x1080 30 fps, h264 |
| `qa --job <scratch>/out/99e9af87` | 1 | 12.1 | qa-failed: QA failed 1 check(s): hero-still-match. |
| `sheet --frames <scratch>/delivery-frames/list.json --output <scratch>/out/sheets/delivery.png --columns 6 --thumb-width 300` | 0 | 2.3 | 30 frames, 6x5 |
| `plan --brief brief.json --treatment treatment.json --shot-spec shot-spec.json --look look.json` | 0 | 1.0 | job 559117d6, 450 frames, warnings: 0 |
| `still --job <scratch>/out/559117d6 --shot s01` | 0 | 7.3 | frame 94, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 40.6 |
| `still --job <scratch>/out/559117d6 --shot s02` | 0 | 6.9 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 36.1 |
| `still --job <scratch>/out/559117d6 --shot s03` | 0 | 7.1 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 38 |
| `still --job <scratch>/out/559117d6 --shot s04` | 0 | 9.0 | frame 26, eevee/opengl, gate passed: composition 0, text-contrast 9.72, exposure 40.2 |
| `still --job <scratch>/out/559117d6 --shot s03 --scale 2` | 0 | 62.8 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 38; 4K still written |
| `still --job <scratch>/out/559117d6 --shot s01 --approve` | 0 | 1.0 | s01 still-approved |
| `still --job <scratch>/out/559117d6 --shot s02 --approve` | 0 | 1.0 | s02 still-approved |
| `still --job <scratch>/out/559117d6 --shot s03 --approve` | 0 | 1.0 | s03 still-approved |
| `still --job <scratch>/out/559117d6 --shot s04 --approve` | 0 | 1.0 | s04 still-approved |
| `render --job <scratch>/out/559117d6` | 0 | 165.4 | 465 frames in 165 s; s01 105 f at 0 ms/f, s02 120 f at 0 ms/f, s03 120 f at 0 ms/f, s04 120 f at 1298.7 ms/f + text plate |
| `assemble --job <scratch>/out/559117d6` | 0 | 21.8 | 450 frames 1920x1080 30 fps, h264 |
| `qa --job <scratch>/out/559117d6` | 1 | 12.1 | qa-failed: QA failed 1 check(s): hero-still-match. |
| `sheet --frames <scratch>/delivery-frames/list.json --output <scratch>/out/sheets/delivery.png --columns 6 --thumb-width 300` | 0 | 2.3 | 30 frames, 6x5 |
| `sheet --frames <scratch>/out/559117d6/stills --output <scratch>/out/sheets/stills.png --columns 4 --thumb-width 400` | 0 | 1.8 | 13 frames, 4x4 |
| `sheet --frames <scratch>/rounds/list.json --output <scratch>/out/sheets/rounds.png --columns 4 --thumb-width 400` | 0 | 2.0 | 19 frames, 4x5 |
| `plan --brief brief.json --treatment treatment.json --shot-spec shot-spec.json --look look.json` | 0 | 0.9 | job 88f8e97b, 450 frames, warnings: 0 |
| `still --job <scratch>/out/88f8e97b --shot s01` | 0 | 7.2 | frame 94, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 40.6 |
| `still --job <scratch>/out/88f8e97b --shot s02` | 0 | 6.9 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 36.1 |
| `still --job <scratch>/out/88f8e97b --shot s03` | 0 | 7.0 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 38 |
| `still --job <scratch>/out/88f8e97b --shot s04` | 0 | 8.4 | frame 26, eevee/opengl, gate passed: composition 0, text-contrast 9.72, exposure 40.2 |
| `still --job <scratch>/out/88f8e97b --shot s03 --scale 2` | 0 | 62.0 | frame 109, eevee/opengl, gate passed: composition 0, text-contrast no text, exposure 38; 4K still written |
| `still --job <scratch>/out/88f8e97b --shot s01 --approve` | 0 | 1.0 | s01 still-approved |
| `still --job <scratch>/out/88f8e97b --shot s02 --approve` | 0 | 1.0 | s02 still-approved |
| `still --job <scratch>/out/88f8e97b --shot s03 --approve` | 0 | 1.0 | s03 still-approved |
| `still --job <scratch>/out/88f8e97b --shot s04 --approve` | 0 | 1.0 | s04 still-approved |
| `render --job <scratch>/out/88f8e97b` | 0 | 1.1 | 465 frames in 0 s; s01 105 f at 0 ms/f, s02 120 f at 0 ms/f, s03 120 f at 0 ms/f, s04 120 f at 0 ms/f + text plate (every frame and the plate reused) |
| `assemble --job <scratch>/out/88f8e97b` | 0 | 21.7 | 450 frames 1920x1080 30 fps, h264 |
| `qa --job <scratch>/out/88f8e97b` | 1 | 12.1 | qa-failed: QA failed 1 check(s): hero-still-match. |
| `sheet --frames <scratch>/out/88f8e97b/stills --output <scratch>/out/sheets/stills.png --columns 4 --thumb-width 400` | 0 | 1.7 | 13 frames, 4x4 |
| `sheet --frames <scratch>/rounds/list.json --output <scratch>/out/sheets/rounds.png --columns 4 --thumb-width 400` | 0 | 2.3 | 23 frames, 4x6 |

The rows from the second `plan` into 88f8e97b on are the sixth round, run after the review (21:02 to 21:05): the delivery sheet was not remade because the delivery file did not change. The `doctor` row was timed by hand (the logger's clock was missing on the first call); the first `still --shot s03` ran every rung of the Blender ladder before failing, which is where its 83.5 s went.

## Timings

| What | Measured |
| --- | --- |
| The whole run, wall clock, `doctor` to the `qa` of the fifth round | 31 minutes (20:14 to 20:45), of which 1303 s (21.7 min) inside the commands and the rest reading stills, naming faults and editing the shot spec |
| The sixth round after the review (the treatment's prose corrected: plan, four stills, the 4K still, four approvals, render with every frame reused, assemble, qa) | 2.5 minutes (21:02 to 21:05), 135 s inside the commands; 1439 s inside the commands over all six rounds |
| The first full pass (`doctor` to the first `qa`, four still rounds) | 22 minutes |
| The fix pass (one text-timing edit: plan, four stills, the 4K still, four approvals, render with three shots reused, assemble, qa) | 9 minutes |
| `render`, first full pass: 465 blender frames at 1080p (EEVEE on OpenGL, 64 samples) | 687 s; s01 1.35 s per frame, s02 1.84 s (the close-up at f/2.8: EEVEE's depth of field costs), s03 1.34 s, s04 1.30 s; the text plate of s04 through the html lane 60 ms per frame (120 frames in 7.1 s) |
| `render`, fix pass | 165 s: s01 to s03 reused from the cache (their keys were unchanged), s04 re-rendered at 1.30 s per frame plus its text plate |
| `render`'s own estimate after the first three-frame batch | 2.4 s per frame (s01, s03, s04) and 7.4 s (s02): a ceiling, 1.8 to 4 times the measured rate, since that batch carries Blender's start |
| A blender still at 1080p (128 samples, denoised) through the gate | 5.4 to 5.8 s per frame, 7 to 9 s per command |
| A blender still at 4K (`--scale 2`) | 62.7 s |
| A three-lane still at 1080p | 2.6 s per frame, 5.4 s per command (the browser's start included) |
| `assemble --job` (450 frames, grade, grain, x264 CRF 16, probe) | 21.9 s |
| `qa --job` | 12.1 s |

## The still loop, round by round

The gate's three checks per round (composition problems, the lowest text contrast ratio, the still's average luma YAVG against the obsidian band 30 to 60), and the faults named from the still and its 100 percent crops. The sheet `still-rounds-sheet.png` shows every round.

| Round (job) | Shot | Gate | Faults named | Change for the next round |
| --- | --- | --- | --- | --- |
| 1 (210ecfb3) | s01 blender MS push-in | pass (0, no text, 37.8) | the body reads as matte white plastic with one soft specular; the floor's horizon runs as a hard band at the bottle's base; the right edge merges with the backdrop (no rim separation) | `rimIntensity` 0.6 to 1.3 on every shot (one rig change) |
| 1 | s02 three CU high light-sweep | fail: exposure 66.7 | flat light at the sweep's end; the backdrop a mid-gray void, not the look's near-black; the cap reads as dark plastic; a hard shadow slab bottom-left; a bloom halo on the top edge | `angle` high to eye, `exposureOffsetEv` 0 to −0.7 |
| 1 | s03 blender MS low arc-left | fail: `blender-render`, black on every rung | the `low` angle (15 degrees below the centre of a 16 cm bottle at 1.41 m) puts the camera 41 cm under the stage floor (scene.json camera z −0.413); nothing to judge | `angle` low to eye (reported as a seam) |
| 1 | s04 blender MS breathe + title | pass (0, 11.72:1, 37.6) | the title floats low, far from the bottle's base; the title's floor band is the brightest part of the frame; the right edge merges with the backdrop | title box `y` 0.72 to 0.64 |
| 2 (3a2a13d3) | s01 | pass (0, no text, 40.0) | the shadow side is near black at 1:12; one specular only; the horizon band | `fillRatio` 12 to 8 on every shot |
| 2 | s02 three CU eye | pass (0, no text, 43.4) | the body reads as gray plastic next to the pale blender body (continuity); flat key at the sweep's end (the key at 105 degrees); a bloom fringe on the cap and the right edge; the base's dark lip | `exposureOffsetEv` −0.7 to −0.5, sweep `amplitude` 0.5 to 0.35 |
| 2 | s03 eye arc-left | pass (0, no text, 37.0) | the cap's top a dark disc; the horizon band; the shadow side black on the right third | fill ratio as above |
| 2 | s04 | pass (0, 9.85:1, 39.8) | the title sits well now; the title has no relationship to the floor (no reflection or shadow); the shadow side black | fill ratio as above |
| 3 (521e31ba) | s01, s03, s04 | pass (40.6, 38.0, 40.2; title 9.72:1) | the shadow side lifts a little; the horizon band stays (the cyc's floor-to-wall edge is the stage's geometry, not a parameter); the cap small at MS | none: 16 to 17 of 20 each |
| 3 | s02 three | pass (0, no text, 47.2) | still a gray plastic read with the key edge-on at 91 degrees; palette off the look's pale primary; the bloom halo; continuity against the blender neighbours: 15 of 20 (materials 1, light 1, palette 1, continuity 1, artifacts 1) | third round reached: the rubric's rule says change the design, not the parameters: `lane` three to blender |
| 4 (99e9af87) | s02 blender CU eye light-sweep | pass (0, no text, 36.1) | the cap's top reads dark (the HDRI's reflection); the left two thirds of the frame are empty (golden-right anchor); the body's rim highlight only on the left; 16 of 20 | none; every shot approved, 4K still of s03, render, assemble, qa |
| 4 | the delivery, viewed | qa: 10 of 11 checks pass | the title was still 22 percent visible on the last frame (an exit from `outFrame` 120 completes at the cut, so frame 119 is mid-exit), a ghost at the loop join | `outFrame` 120 to 110 (the exit completes ten frames before the cut) |
| 5 (559117d6) | all four | pass (the numbers of round 4) | the last frame is clean; the delivery | the review found four sentences of the treatment describing earlier rounds (a low arc, a close-up from above, a three-lane plate, a tempo reason contradicting the 3.5 s opener): the prose corrected, no shot changed |
| 6 (88f8e97b) | all four | pass (the numbers of round 4; the 1080p stills byte-identical to round 5's) | none new; the final delivery, byte-identical to round 5's | none |

Rounds 1 to 3 are the three rounds of the still loop; round 4 is the design change the rubric prescribes after the cap (the macro's lane), round 5 a timing fix found by viewing the delivery, round 6 the treatment's prose brought in line with the shots after the review. Each is a new job folder because the documents changed; a folder whose documents did not change reuses its render cache (the fix pass reused 345 of 465 frames, the sixth round all 465 and the text plate).

## The QA report (88f8e97b, after the integration pass)

`<scratch>/out/88f8e97b/qa/88f8e97b.qa.json` written by `qa --job` after the re-assemble: eleven checks and four hero comparisons, every one passing, the job `delivered`. The slice's own run had ended `failed` on `hero-still-match` (0.942, 0.853 and 0.919 on three shots: the check then compared the still with the delivery frame after grain and x264, where the encode alone costs 0.045 of planar-RGB SSIM on dark gradients); the measurement below that table is kept as the record of why the check changed.

| Check | Result | Measured | Detail |
| --- | --- | --- | --- |
| dimensions | pass | 1920x1080 | as expected |
| fps | pass | 30 | as expected |
| duration | pass | 450 frames | 15.00 s as expected |
| black-frames | pass | 0 | none |
| frozen-frames | pass | 0 | none |
| pops | pass | 0.9793 | lowest adjacent-frame SSIM at frame 345, the last frame of the cross-fade; the three planned cuts excluded; limit 0.6 |
| exposure-drift | pass | 3.4 | largest change in average luma between consecutive ranges (limit 40) |
| text-contrast | pass | 9.98:1 | lowest contrast at frame 356; both boxes (frames 330 and 356) at or above 4.5:1 |
| loudness, true-peak | pass (skipped) | | no audio stream |
| hero-still-match s01 | pass | 1.0 | frame 94 of the render against s01-r1.raw.png (the render reused the still's frame) |
| hero-still-match s02 | pass | 0.9997 | frame 109 of the render against s02-r1.raw.png (a blender still has more samples and denoising than its clip) |
| hero-still-match s04 | pass | 1.0 | frame 26 of the render against s04-r1.raw.png |
| hero-still-match s03 | pass | 0.9999 | frame 109 of the render against s03-r2.raw.png |

Why hero-still-match fails, measured with ffmpeg directly for this record only:

| Comparison | Planar-RGB SSIM (the check's measure) | Luma SSIM (BT.709 Y plane) | Planar-RGB PSNR |
| --- | --- | --- | --- |
| s01 raw still against the cached render frame 94 (the clip's own frame, before the grade) | 0.99997 | | 45.0 dB |
| s01 finished still against the delivery frame 94 | 0.942 | 0.9885 | 43.1 dB |
| s02 finished still against the delivery frame 214 | 0.853 | 0.9895 | 43.5 dB |
| s04 finished still against the delivery frame 356 | 0.919 | 0.9831 | 42.1 dB |
| s01 finished still through libx264 CRF 16 alone (no grain), decoded with BT.709 named | 0.955 | | |
| s01 finished still against the delivery frame 94 with a 3x3 median on both (the grain averaged out) | 0.952 | | |

So the still and the render agree (0.99997), and the loss is the delivery's encode: on a dark, finely gradated frame the x264 round trip alone costs 0.045 of planar-RGB SSIM (the G plane 0.89), and the grain a little more; the luma SSIM stays above 0.98 and the PSNR above 42 dB, which is the 41.6 dB ADR 0008 measured for the CRF 16 round trip. The 0.98 planar-RGB threshold was calibrated on flat fixture frames (`tests/cli/rendered-job.ts` measured 0.99 there) and does not hold on real content; and the check compares against the delivery, after grain and encode, where ADR 0006 decision 7 says "before grain". The fix belongs in `src/qa` (not this module's files) and is described under the report's skipped seams; nothing in the delivery was changed to pass it.

## Viewing notes (honest)

Viewed as the 30 frames of `delivery-sheet.png`, the full-size frames at the loop join (0 and 449), at the cuts (104/105, 224/225), inside the dissolve (332, 337, 342, 345, and their 100 percent crops of the bottle) and in the title's hold (360, 440), and the 100 percent crops of the title and the subject. Not played in real time: the review tool reads images, so the motion is judged from the frame steps, not from playback; the owner should play the file in a looping player before judging. The first version of these notes called the dissolve "a slight double image"; the review's 100 percent crops showed what it is, and the note below is corrected.

- **s01 Open (0 to 104)**: the bottle stands centred on a dark cyc under a single key from the upper right, the floor a soft gray gradient up to a hard horizon at the bottle's base. The push-in is slow and reads as intended (the bottle grows by about a tenth over 95 frames). The body reads as a pale coated cylinder with one soft specular and a sharp highlight line on the cap: convincing as satin plastic or ceramic, not as frosted glass; nothing translucent. The cap is small at MS. The right edge of the body separates from the backdrop by the rim, just.
- **The cut 104/105**: MS to CU on the same subject, the lighting continuous, one film. The jump is clean.
- **s02 Cap and shoulder (105 to 224)**: the close-up fills 80 percent of the height on the golden-right line, the left two thirds of the frame empty dark. The key sweeps across the body over the shot, the specular travelling from front-right to the edge; this is the shot where the materials show: the cap's satin ring, the neck's second highlight, the coat's soft hot spot. The body still reads as a glossy pale solid, not glass: the brief's frosted glass is the one promise the lanes cannot keep (no transmission), and it was said in the treatment. At 100 percent a small notch shows where the neck's top meets the cap's underside (a primitive-modelling seam, visible in the 4K crop too).
- **The cut 224/225**: CU back to MS, the camera beginning the arc. Clean.
- **s03 Hero arc (225 to 344)**: a slow 30-degree orbit to the left at eye level; the specular slides across the body as the camera moves and the shadow side comes round. The stature the low angle would have given is lost (the low angle rendered black, see the seam); the shot reads as a calm product turn, which the arc delivers better than a turntable would on a symmetric stand-in. The 4K still of its end frame is clean at 100 percent except at the cap-neck join named above, where the shadow terminator is a jagged notch (`hero-still-s03-4k-crop-100.png`, top edge): no aliasing on the silhouette edges, no banding in the floor gradient, no grain (stills carry none).
- **The dissolve 330 to 344**: in the slice's own run the assembler mapped the grammar's `dissolve` to ffmpeg's xfade `dissolve`, which is not a cross-fade but a per-pixel random switch between the two shots, and the pale bottle on the black backdrop carried a dense salt-and-pepper speckle for all fifteen frames; no QA check saw it (`pops` read 0.969 at frame 345, far above its 0.6 limit). The integration pass mapped the grammar's dissolve to xfade `fade`, the linear cross-fade, and re-assembled the job from the same frames: `dissolve-frame-0337-crop-100.png` now shows the arc's end pose blending softly into the eye-level hold, with no speckle. The review that caught it is the reason this paragraph exists.
- **s04 Name (330 to 449)**: the title "Vela" rises in under the bottle at frame 342 (Space Grotesk, about 140 px, tracking −0.02 em), holds, and leaves between frames 431 and 440; the last ten frames are the bottle alone on the opening pose. At 100 percent the title is crisp with the grain visible on the backdrop behind it; the contrast 9.98:1. The breathe is a 0.25 percent drift, invisible on the sheet, which is the intent.
- **The loop join (449 to 0)**: the same pose, the same light, no text; measured PSNR 47 dB. A viewer sees the bottle hold and the film start again with the push-in.
- **What a viewer would notice**: a clean, quiet, dark product film with one material read (a pale satin solid) and one light; the brushed metal and the frosted glass of the brief are suggested by colour and roughness, not shown; the cyc's horizon line behind the bottle's base is the one element that reads as a studio set rather than a void, and it is a hard line; the bottle is a plain cylinder stack and reads as a stand-in; the typography is the strongest element; the grain at 0.15 is visible on the dark backdrop at 100 percent and reads as film, not noise, at full-frame size. The hero-to-name cross-fade is soft and reads as time passing.

## Known artifacts

- The noise dissolve at frames 330 to 344 was a pipeline defect in `src/assemble/graph.ts`; fixed in the integration pass and absent from the delivery as it stands.
- The notch at the cap-neck join, visible at 100 percent in the close-up and the 4K still: the two primitives' faces coincided; `src/shared/subject/primitives.ts` now runs the neck a tenth of the cap's height into the cap, which re-keys every bottle shot, so the delivery and the 4K still here still carry the notch (they were not re-rendered after the fix).
- The `hero-still-match` failures of the slice's run were a measurement defect: the check compared the grain-free still with the delivery frame after grain and x264 in planar RGB. It now compares the approved still's raw frame with frame k of the shot's render in the cache, the comparison ADR 0006 decision 7 names; the four shots read 1.0, 0.9997, 0.9999 and 1.0.

## What is not verified

- Real-time playback (see above).
- The camera-under-floor check that the first round's black render led to (`plan` and the still gate now refuse a camera below the stage floor) has not been run against this piece's documents, whose shots are all at eye level.
- The loop as a player loops it: the measurement is of the two frames, not of a player's seek.
- The delivery and the 4K still with the cap-neck overlap: not re-rendered (every bottle shot's key changed with the primitive, so a re-render is a full 687 s pass); the next production renders without the notch.
