# Architecture

Vision.Forge is a Claude Code skill. Claude reads `skills/cinematic-studio/SKILL.md`, turns an English brief into a treatment, a shot list and a look bible using the knowledge base under `references/`, and then calls one command-line program, `node scripts/cli.ts`, for everything that touches a renderer, ffmpeg or the file system. Claude is the only model; it also reviews rendered contact sheets.

## Pipeline

brief → treatment → shot spec → look bible → still per shot (gate) → full render → assemble → QA → deliver

Every stage reads and writes JSON documents validated against the schemas under `schemas/`. For narrated pieces, narration audio is produced before shot durations are locked, because sentence lengths are the clock of an explainer.

## Lanes

| Lane | Renders | Runtime |
| --- | --- | --- |
| `html` | titles, lower thirds, kinetic type, charts, explainers | system Edge or Chrome driven by Playwright; CSS and inline styles set per frame |
| `three` | stylized and procedural 3D | the same browser with Three.js (WebGL, hardware or software renderer, verified at startup) |
| `blender` | products, environments, near-photoreal objects | Blender 5.2 LTS as an external program; TypeScript resolves a complete `scene.json`, one logic-free Python file applies it |

All three consume the same baked camera (ADR 0008) and the same timeline (`src/shared/`), so motion and framing are identical everywhere.

## Determinism

A frame is a pure function of its frame number. The browser harness calls `seek(frame)` and then takes one screenshot; nothing runs on the wall clock. Blender receives per-frame keyframes. Every render manifest records a fingerprint (browser version, WebGL renderer, launch flags, DPI and ClearType settings, tool versions); comparisons are only meaningful between identical fingerprints (ADR 0006).

## Repository map

- `scripts/cli.ts` — the single entry point; one file per command under `src/cli/commands/`.
- `src/shared/` — pure TypeScript that runs in Node and the browser: contracts (generated from schemas), camera, easing, timeline, composition, grade, hashing.
- `src/browser/` — the frame protocol runtime, html templates and three scenes.
- `src/harness/` — the loopback server that serves TypeScript stripped to JavaScript, and the capture driver.
- `src/tools/`, `src/process/`, `src/net/` — external program wrappers, the process runner seam, the only HTTP downloader.
- `src/lanes/`, `src/finishing/`, `src/assemble/`, `src/qa/` — lane runners, the grade, assembly, measurable checks.
- `blender/apply_scene.py` — the only Python file.
- `skills/cinematic-studio/` — SKILL.md, the creative knowledge base, bundled fonts and HDRIs.
- `schemas/`, `tests/`, `docs/` — contracts, tests and goldens, documentation with ADRs, evidence and the handoff log.

## External programs

ffmpeg and ffprobe (assembly, finishing, QA) and Blender (one lane) are installed by the user and discovered by `doctor`. They are never bundled and never downloaded by the skill.
