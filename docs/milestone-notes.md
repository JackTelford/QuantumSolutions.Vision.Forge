# Milestone notes

One short note per milestone for the owner, newest first: what finished, what to look at, what changed underfoot. The full report with evidence is in `handoff.md`.

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
