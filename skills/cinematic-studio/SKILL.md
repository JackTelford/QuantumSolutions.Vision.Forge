---
name: cinematic-studio
description: Turns an English brief into a finished video or still using only code, with no generative image or video model. Use it for a cinematic product shot, an explainer, a title sequence, a lower third, a kinetic-type animation or any short video or still whose look must be directed shot by shot and reproduced exactly. It writes a treatment, a shot list with real camera, lens, lighting and composition values and a look bible, renders each shot deterministically in one of three lanes (html for typography and charts, three for stylized 3D, blender for near-photoreal objects), reviews one still per shot before the full render, then assembles, grades and checks the result with ffmpeg. Every operation runs through one command-line program; nothing calls a paid or keyed API. Needs ffmpeg and Microsoft Edge or Google Chrome; Blender 5.2 is optional.
license: Apache-2.0
metadata:
  author: Quantum Solutions
---

# Cinematic Studio

Vision.Forge turns a brief into a finished film or still with code: HTML and CSS, Three.js and Blender render the frames, ffmpeg assembles and checks them, and you direct the shots and review the rendered contact sheets. This file is the router. The creative knowledge base under `references/` is read only when a step needs it.

## What it does and does not do

It does:

- Take a brief such as "a 15-second studio product film of a frosted-glass bottle" and produce a treatment, a shot list with real camera, lens, lighting and composition parameters, one still per shot for review, the full render and an H.264 delivery.
- Keep one look across every shot and lane: one physical camera model, one lighting cookbook, one finishing grade.
- Render deterministically: a frame is a function of its frame number, and the same inputs on the same machine produce the same pixels.

It does not (say so up front, then offer the stylized or abstract alternative):

- Photoreal people, faces or animals, or a live-action look.
- Generative image or video models, paid or keyed APIs, or music from the internet: music is user-supplied or absent.
- Byte-identical frames across machines; quality gates between machines use SSIM and PSNR.
- EEVEE without an interactive desktop session: the blender lane then falls back to Cycles, which is slower.
- Narration in any language but English. Narration uses a small local voice model that is installed separately on request; the user's own recording is always the alternative.

## The one command

Every operation that touches a renderer, ffmpeg or the file system goes through one program:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.ts" <command> --data-dir "${CLAUDE_PLUGIN_DATA}" --out <dir>
```

`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${CLAUDE_PROJECT_DIR}` are substituted by Claude Code when it loads this file, so by the time you read this they are absolute paths. They are not environment variables of the shell you run commands in, and the CLI never reads them from the environment: always pass `--data-dir` and `--out` explicitly, exactly as above, and keep the quotes (on Windows the substituted paths use forward slashes, which Node accepts). `--out <dir>` is where deliverables go: pass `--out "${CLAUDE_PROJECT_DIR}/out"` unless the user names a directory. Caches, tool records and browser profiles stay under the data directory; a command the user runs by hand (for example `doctor` from the README quick start) must pass the same `--data-dir "${CLAUDE_PLUGIN_DATA}"` to share those caches, otherwise run `doctor` again through this skill. Nothing else is ever run: no `npm`, no `npx`, no direct `ffmpeg` or `blender` call.

Add `--pretty` to read a result by eye, `--quiet` to silence progress and `--verbose` for detail. Progress and errors go to standard error; standard output carries the result only.

## Reading a result

Standard output carries exactly one JSON object:

- `ok`: `true` when the command succeeded.
- `command` and `data`: the command name and its payload; each command documents its shape.
- `artifacts`: absolute paths of files produced for the user. `evidence`: absolute paths of reports and contact sheets.
- `errors[]`: on failure, one entry with `code`, `message` and `hint`. `message` says what went wrong and `hint` says what to do next; repeat both to the user.

Exit codes: `0` success, `1` failure, `2` usage or not yet implemented (a `usage` error: fix the invocation; a `not-implemented` error: the hint names the milestone, tell the user and stop), `130` cancelled by the user (run the command again to resume; finished shots are kept).

## First step: doctor

The first command of every session is `doctor`. It finds ffmpeg, a browser and, optionally, Blender, records their paths and versions, and lists which lanes are available. Until it reports `ok: true`, do not plan or render.

`doctor` is not implemented yet: it arrives with milestone M1. In the current state (M0b) only `help` and `version` run; every other command exits 2 with a `not-implemented` error that names its milestone. Tell the user so and stop; do not improvise with other tools.

## Behavior rules

1. Ask at most one clarifying question before starting. Otherwise choose sensible defaults, state them and go.
2. Never claim a result is photoreal, or that a shot looks right, without inspecting the rendered frames or the contact sheet. Say what you saw.
3. State the limits up front when the brief asks for people, faces, animals or a live-action look, and propose the stylized or abstract alternative before any render.
4. Narration uses a small local voice model that the user installs on request; always offer the user's own recording as the alternative. Music is user-supplied or absent.
5. Confirm before a long render: give the frame count and the time estimate, and wait for a yes.
6. Never invent asset ids, file paths or tool versions. Use only what a command returned.
7. Fail loudly: when a command fails, repeat its `message` and `hint`, say which step stopped, and never pretend the step succeeded or silently skip it.

## Blender rule

Run `doctor` first. If Blender is missing or is not 5.2.x, say so, offer the setup script (`Setup-VisionForge.cmd` or `scripts/setup.ps1 -Install` on Windows, `scripts/setup.sh` elsewhere; it asks for approval and installs about 350 MB) and continue with the `html` and `three` lanes. Never download Blender yourself and never run a Blender build the user did not install. The setup scripts arrive with M1.

## Status

Implemented today (M0b): `help` and `version`. Planned: `doctor`, `validate`, `assemble`, `qa` (M1); `plan` (M2); `still`, `render`, `sheet`, `assets` (M3); `audio` (M6). `help` prints the live table. The state of the whole repository, with what is and is not verified, is in `docs/handoff.md` at the plugin root: `${CLAUDE_PLUGIN_ROOT}/docs/handoff.md`.

## Knowledge base

Read a reference only when the step needs it. The outline, with the file for each step and the milestone that fills it, is [references/README.md](references/README.md); open it to find the file, then open the file. None of the reference files exists yet.
