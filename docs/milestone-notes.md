# Milestone notes

One short note per milestone for the owner, newest first: what finished, what to look at, what changed underfoot. The full report with evidence is in `handoff.md`.

## Explainer finished (2026-10-30): the second film

- The 45-second explainer of `docs/blind-test.md` was made from its prompt through the commands only: narration first (seven sentences by the local voice, their timings as the clock), seven html cards on a paper stage, captions burnt in, 1350 frames in 152 s, 25 minutes from `doctor` to a passing `qa`. Its documents ship as `skills/cinematic-studio/examples/explainer/`; the record is `docs/evidence/explainer/README.md` and the blind-test write-up with its blank scoring sheet is `docs/evidence/blind-test/our-side-explainer.md`. The delivery is `out/62fedd4e/62fedd4e.mp4` on this machine; play it with sound.
- It exposed four faults, all fixed with tests: the voice's own true-peak check failed by 0.1 dB (loudnorm now aims lower); the paper-flat exposure band was one no paper frame could meet (now 170 to 225); QA called a 2.5D stage under a breathe a frozen render (planned holds are now tolerated, nothing else); burnt-in captions were ffmpeg's stock white Arial (now the look's face and colours).
- Honest limits: the "diagrams" are typographic cards, the card is a plain slate stand-in, the hash rows wear the lower-third chip, and I passed the treatment gate on your standing permission; your own run through Claude Code stops at the treatment for your yes.
- Two new pages for people: `docs/getting-started.md` for someone with no technical background (install, add the plugin, one prompt, play the MP4) and a "Getting the most out of it" section in the README for developers (how to brief, steer, pick looks, use the still loop, narration, the cache, running the commands, extending).
- Review in this order: `docs/evidence/blind-test/our-side-explainer.md`, `src/qa/plan-context.ts`, `src/assemble/captions.ts`, `src/assemble/plan-from-job.ts`, `skills/cinematic-studio/examples/explainer/README.md`.

## M8 finished (2026-10-29): v0.1.0

- The plugin installs from the clone's marketplace manifest (`claude plugin install vision-forge@quantum-solutions`: one skill, about 220 always-on tokens) and is installed on this machine at scope `user` for your testing. `package.json` says 0.1.0; no git tag was made without your word.
- Start with `docs/owner-test-guide.md`: the machine's own checks (ten minutes), the shipped product film through the commands (twenty), then the three blind-test prompts through Claude Code with what Claude must do at each step and what "good" looks like.
- README's limits are final for this pass: stand-in subjects, a job keyed on its documents, one text plate per shot, two of the three blind-test pieces still to be produced.
- Everything else is in `docs/handoff.md`, newest first, with a review guide of five files per milestone.

## M7 finished (2026-10-29): the first film

- The first piece of `docs/blind-test.md`, a 15-second product film, was made from its prompt through the commands only: four shots on the blender lane, a text plate for the name, 465 frames in 687 s, 31 minutes from `doctor` to `qa` including six planning rounds. Its documents ship as `skills/cinematic-studio/examples/product-film/`; the record with every command, timing, still round and honest viewing note is `docs/evidence/m7/README.md`. Look at `delivery-sheet.png` there, and play the delivery when you run it yourself.
- `assemble --job` and `qa --job` close the loop: a job goes from `plan` to `delivered` through the commands with no hand-written plan. Text in a three or blender shot is now its own plate, laid over the graded picture.
- The slice found four defects a viewer would see, all fixed before this note: the dissolve was ffmpeg's noise dissolve (now a cross-fade); the QA hero check failed every real production (now compares the still with the render, as ADR 0006 says); a low angle put the camera under the floor (now refused with the height); the cap and neck faces coincided (now overlapped). `sheet --video` tiles a delivery.
- SKILL.md now holds the whole flow Claude follows from a prompt: questionnaire, treatment gate, shot list, stills with three named faults each, approval, render estimate, narration before durations lock, assemble, qa, what to tell you.
- Review in this order: `skills/cinematic-studio/SKILL.md`, `src/render/text-plate.ts`, `src/assemble/plan-from-job.ts`, `src/cli/commands/qa.ts`, `docs/evidence/m7/README.md`.

## M6 finished (2026-10-29): narration

- The `audio` command exists: `audio install` shows the sizes and the third-party notices and installs the Kokoro component into the data directory only after `--yes` (about 11 s here); `audio voices` lists the four offered voices; `audio synth --text "..."` turns text into a −16 LUFS WAV, an SRT and per-sentence frame timings (8 s of speech in about 8 s on the CPU).
- The DirectML question of ADR 0007 is answered by measurement: DirectML.dll is not mapped into the process during a synthesis. Every `narration.json` records the check.
- Two things the review caught: frame timings drifted by one frame at 25 fps (now computed from sample counts), and a model present at the right size but with wrong bytes escaped as a stack trace (now a coded error with a hint). `doctor` also used to report the weights unverified after a good install; fixed.
- Nothing installs unless you ask. The skill asks before `--yes`, and the notices are in `THIRD-PARTY.md`.
- Review in this order: `src/audio/install.ts`, `src/audio/kokoro-loader.ts`, `src/audio/synth.ts`, `src/audio/timing.ts`, `src/audio/voices.ts`.

## M5 finished (2026-10-29): the blender lane

- The `blender` lane renders. A blender shot goes through the same plan, still gate, approve and render commands; `still` tries EEVEE on OpenGL, EEVEE on Vulkan, then Cycles on OptiX, CUDA and the CPU, pins the first that renders, and `render` runs that one in batches of thirty frames per Blender process. On this machine: a 1080p still in 7 s, a 480x270 clip at about 0.4 s per frame.
- Look at `docs/evidence/m5/lookdev-sheet.png`: the seven looks in three columns now (html, three, blender). The Blender column agrees with the three lane on the gray card within a few code values; its shadows are softer and its cap reflects the real HDRI. `acceptance.md` under it holds every Blender command line, exit code and timing, and the quality notes.
- Two bugs the review caught before you did: the HDRI was turned 180 degrees away from the key, and a still rendered without motion blur because keyframes stopped at the batch's edge. Both fixed with renders as proof.
- Known limits: the fixture bottle is a stack of cylinders, so the turntable shows no turn; the brief's frosted glass is an opaque coated body until a transmission material exists; Blender never runs on CI.
- Review in this order: `src/lanes/blender/resolve-scene.ts`, `src/lanes/blender/runner.ts`, `src/lanes/blender/success.ts`, `src/lanes/blender/ladder.ts`, `src/render/blender-shot.ts`.

## M4 finished (2026-10-29): the three lane

- The `three` lane renders: the bottle as real geometry on a cyc under the cookbook's rigs as area lights, an HDRI or room environment, depth of field from the lens, motion blur from the shutter, bloom from the look's halation. A 1080p frame costs 105 to 125 ms. The same still gate and render commands drive it; `assets --fetch hdri:studio_small_09-1k` before `plan` gives the studio HDRI.
- Look at `docs/evidence/m4/lookdev-sheet.png`: the seven looks, html on the left and three on the right. `lookdev.md` under it lists six questions (look, fonts, colours, length, music, narration) with the default taken for each; the defaults stand until you say otherwise.
- Two decisions the integration pass made on its own, both in ADR 0008: every light is white-balanced to the rig's key (the three lane's gray card had a warm cast that luma alone could not show), and every luma measurement converts RGB with BT.709 (ffmpeg's BT.601 default put the coloured swatches off by up to 22). The html golden was rewritten for the first.
- Three bugs found by the review and closed: every three-lane lookdev still was out of focus (the fixture focused at 1.2 m with the bottle at 1.68 m; `plan` now warns and names the distance), the fill outshone the key (the relative intensity is an irradiance, so area lights scale by d²/A), and the first lane was never disposed on a second init.
- Found by the ten-launch test: the GPU flips one pixel by one code value in about one capture in fifty on the three lane. The html lane stays byte-identical; the three lane is "identical to within GPU noise" (PSNR ≥ 80 dB), recorded in ADR 0006.
- Review in this order: `src/shared/three/lights.ts`, `src/shared/look/css-tokens.ts` (`whiteBalancedKelvinRgb`), `src/browser/three/lane.ts`, `src/browser/three/post.ts`, `tests/calibration/parity.integration.test.ts`.

## M3 finished (2026-10-29): the first frames

- The html lane renders. `still` produces a graded 1080p frame through the still gate in about four seconds; `render` does 110 ms per frame (600 frames in 66 s). Ten fresh browser launches give byte-identical frames; Chrome matches Edge pixel for pixel.
- New commands: `still` (with `--approve`), `render`, `assets`. The order is doctor, assets, plan, still, approve, render.
- Look at `docs/evidence/m3/title-card-s03-r1-640.png`: the first frame the pipeline made. The gold bottle is a stand-in shape; real product geometry comes with the three lane (M4) and Blender (M5).
- Two things changed underfoot: every shot key now includes the lane code hash and, after the still gate, the render profile; `plan` run again keeps approvals for unchanged shots. Text is sized to fit its box (never below the floor) and the browser reports any box it still overflows.
- Review in this order: `src/shared/harness/protocol.ts`, `src/harness/browser-session.ts`, `src/shared/camera/css-transform.ts`, `src/render/render-shot.ts`, `src/cli/commands/still.ts`.
