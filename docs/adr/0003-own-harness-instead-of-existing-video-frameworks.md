# ADR 0003: Our own render harness instead of an existing code-to-video framework

Status: accepted, 2026-10-26.

## Context

Several frameworks already turn code into video. Each was checked against the hard constraints (free and open source, no GSAP, deterministic, distributable as a Claude Code skill):

| Framework | License | Why not |
| --- | --- | --- |
| Remotion | Source-available; companies with more than three employees need a paid Company License ([LICENSE.md](https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md)) | Not FOSS. Its ideas are reused: a frame is a pure function of the frame number; `interpolate`/`spring`; transition math `total = sum(scenes) - sum(transitions)` ([flickering guide](https://www.remotion.dev/docs/flickering)). |
| Theatre.js studio | AGPL-3.0-only, development moved private ([repository](https://github.com/theatre-js/theatre)) | Copyleft incompatible with distribution inside an Apache-2.0 skill. |
| Motion Canvas | MIT, last release 3.17.2 on 2024-12-14 ([npm](https://registry.npmjs.org/@motion-canvas/core)) | Stale and editor/Vite-centric. Its timeline combinators (`all`, `chain`, `sequence`, `waitUntil`) are reimplemented in-house. |
| HyperFrames | Apache-2.0, GSAP by default ([repository](https://github.com/heygen-com/hyperframes)) | GSAP (ADR 0002). Its `beginFrame` capture path works only on Linux headless-shell. |
| blender-mcp | MIT ([repository](https://github.com/ahujasid/blender-mcp)) | Runs arbitrary Python over an unauthenticated socket and integrates keyed, paid generative APIs; violates two constraints. |
| p5.js | LGPL-2.1 | Not needed; LGPL adds notice obligations for no benefit. |
| Lottie, Rive | MIT runtimes | Content comes from external authoring tools, not from code; not a lane. |

Three.js (MIT, 0.186.1), Playwright core (Apache-2.0, 1.64.1), ffmpeg (external program) and Blender (external program) are enough to build the three lanes directly.

## Decision

Build our own harness:

- One static loopback server (ADR 0005) and one Playwright-driven system browser (Edge first, Chrome fallback) for the `html` and `three` lanes, capturing one frame per `page.screenshot` after an explicit `seek(frame)` (ADR 0006).
- One Blender process per shot attempt, driven by a fully resolved `scene.json` and a logic-free `apply_scene.py` (ADR 0004).
- ffmpeg for finishing, assembly and QA (ADR 0008), ffprobe for measurements.

## Consequences

- All timing, easing, camera and composition logic lives in `src/shared/` and is unit-tested once.
- The harness is small enough to read in one sitting, which matters for an owner who reviews every line.
- Nothing in the repository carries a copyleft or proprietary runtime; the narration component is the one exception and is isolated (ADR 0007).
