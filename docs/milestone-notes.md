# Milestone notes

One short note per milestone for the owner, newest first: what finished, what to look at, what changed underfoot. The full report with evidence is in `handoff.md`.

## M3 finished (2026-10-29): the first frames

- The html lane renders. `still` produces a graded 1080p frame through the still gate in about four seconds; `render` does 110 ms per frame (600 frames in 66 s). Ten fresh browser launches give byte-identical frames; Chrome matches Edge pixel for pixel.
- New commands: `still` (with `--approve`), `render`, `assets`. The order is doctor, assets, plan, still, approve, render.
- Look at `docs/evidence/m3/title-card-s03-r1-640.png`: the first frame the pipeline made. The gold bottle is a stand-in shape; real product geometry comes with the three lane (M4) and Blender (M5).
- Two things changed underfoot: every shot key now includes the lane code hash and, after the still gate, the render profile; `plan` run again keeps approvals for unchanged shots. Text is sized to fit its box (never below the floor) and the browser reports any box it still overflows.
- Review in this order: `src/shared/harness/protocol.ts`, `src/harness/browser-session.ts`, `src/shared/camera/css-transform.ts`, `src/render/render-shot.ts`, `src/cli/commands/still.ts`.
