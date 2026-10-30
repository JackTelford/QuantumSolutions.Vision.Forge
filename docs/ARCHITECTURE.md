# Architecture

Vision.Forge is a studio driven by an AI model: a Claude Code skill or, through MCP, any client's model. The model reads `skills/cinematic-studio/SKILL.md` (as the skill, or served as a resource with the directing prompt), turns an English brief into a treatment, a shot list and a look bible using the knowledge base under `references/`, and then calls one command-line program, `node scripts/cli.ts`, or the MCP tool of the same name, for everything that touches a renderer, ffmpeg or the file system. No generative model is involved; the directing model is the only model, and it also reviews rendered contact sheets.

## Two front doors

The studio has two ways in and one way through. Claude Code enters through the skill: SKILL.md carries the plugin's data directory and project directory as substituted paths and calls `node scripts/cli.ts` with them. Every other AI app enters through the MCP server, `node scripts/mcp.ts` over stdio (ADR 0009): one tool per command, the knowledge base as `vision-forge://` resources and the directing flow as the `cinematic-studio` prompt and the initialize instructions. Both doors open onto `src/cli/run.ts`, which runs a command in-process from an argv and returns the one result document, so a tool call and a command line do exactly the same thing with the same gates; `scripts/cli.ts` is a thin shell around it that prints the result, and `src/mcp/` wraps it in JSON-RPC, adds background tasks for the long commands and returns stills and sheets as images.

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

- `scripts/cli.ts` — the command-line entry point; one file per command under `src/cli/commands/`, run through `src/cli/run.ts`.
- `scripts/mcp.ts` and `src/mcp/` — the MCP entry point: the JSON-RPC server over stdio, the command tools and tasks, the knowledge-base resources, the directing prompt.
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
