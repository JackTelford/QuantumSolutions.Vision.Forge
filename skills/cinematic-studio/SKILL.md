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

The first command of every session is `doctor`. It finds ffmpeg and ffprobe, Microsoft Edge or Google Chrome, the GPU and, optionally, Blender 5.2, records their paths and versions in `tools.json` under the data directory, and lists which lanes can run. Until it reports `ok: true`, do not plan or render.

Read its result as follows. `data.lanes` has one boolean per lane (`html`, `three`, `blender`, `audio`); plan only with lanes that are `true`. `data.missing` lists `{ tool, hint, required }` for every program it did not find; Blender is `required: false`. `data.problems` holds warnings in plain sentences, such as an unsupported Blender version, a software WebGL renderer or a non-interactive desktop session; repeat them to the user when they touch the piece being made. `ok: false` with code `tool-missing` means a required program is absent: repeat the hint, which is the exact install command, and stop. Pass `--require <lane>` when the piece needs one lane in particular; the command then fails with the same code when that lane cannot run.

## The order of a production

`doctor`, then `assets --fetch` for every HDRI the shots will name, then `plan`, then for every shot `still` (look at the still, run `sheet` over `<job>/stills/`, judge it by `references/direction/review-rubric.md`, fix the shot spec and run `still` again, at most three rounds), `still --approve` for each still that passes, then `render`, then `assemble` and `qa` (the assembly plan is built from the job's frame patterns; M7 automates this step). Every command reads and updates `<out>/<jobId>/job.json`, so the job folder is the state of the production.

## Commands available now

- `plan --brief <file> --treatment <file> --shot-spec <file> --look <file>`: validates the four documents, checks them against each other (ids, beats, fps and size, the transition arithmetic, the pacing rules) and runs the composition solver's geometric checks on every shot; writes `<out>/<jobId>/` with copies of the four documents and `job.json` (`evidence[0]`), one key per shot. `data.warnings` lists pacing and composition warnings; repeat them to the user. Exit 1 with code `cross-document` or `schema-validation` lists every problem as a sentence: fix the documents, never the job folder. Asset ids named in the brief or shot spec must already be in the ledger, so run `assets` before `plan` once it exists.
- `still --job <folder or job.json> --shot <id> [--frame <k>] [--renderer hardware|software|any] [--scale <n>]`: renders one frame of the shot through the lane and the harness exactly as `render` will, grades it like the delivery (no grain), runs the still gate (composition checks 1 to 5 with the look's type scale, the browser's own measurement of every text box, WCAG contrast behind every text box on the finished still, average luma inside the look's band) and pins the render profile into the job folder's shot spec, which changes the shot's key once. Writes `<job>/stills/<shot>-r<round>.png` (`artifacts[0]`), the raw frame beside it, `<shot>-r<round>.gate.json` (`evidence[0]`) and, with `--scale 2`, a 4K `<shot>-r<round>-2x.png`. The default frame is the one where the last text element has finished entering (else the end of the camera move, else the middle). Exit 1 with code `still-gate` lists every failing check: fix the shot spec or the look, never the still, and run again. `still --job <...> --shot <id> --approve` marks a passed still approved; `render` refuses shots that are not. Other codes: `still-rounds` (the three-round cap: change the shot's design), `lane-unavailable` (a blender shot before M5), `renderer-mismatch` (pass `--renderer any`), `page-init` and `page-seek` (the page's own sentence; report it), `browser-profile-in-use`, `data-file` (run `doctor` first).
- `render --job <folder or job.json> [--shot <id>] [--renderer hardware|software|any] [--frames <a-b>] [--force] [--allow-unapproved]`: renders every frame of every approved html or three shot (or the named one) into `<data dir>/cache/<key>/frames/f%06d.png` with a render manifest beside them (`evidence[]`), one browser for the whole run; frames already in a complete manifest are reused, `--force` re-renders. `data.shots[]` carries `framePattern` (the ffmpeg pattern an assembly plan's clip source takes), `frames`, `msPerFrame` and `reused`. Confirm before a long render: about 110 ms per 1080p frame on the owner's machine, so 600 frames take about 70 s. Codes: `shot-not-approved` (run `still` and `still --approve` first), `render-profile-mismatch` (the still gate pinned the other renderer), plus the still command's browser codes.
- `assets [--list] [--fetch <id,id>] [--all] [--verify] [--credits] [--credits-path <path>]`: the pinned catalogue of CC0 Poly Haven HDRIs (`hdri:<name>-1k` and `-2k`, ten entries). `--list` (the default) shows what is installed; `--fetch` downloads named ids into `<data dir>/assets/hdri/` through the allowlisted downloader, verifies size and MD5 and records the ledger (`assets.json`); `--verify` re-hashes installed files (exit 1 code `asset-integrity` names a changed file, which is set aside so `--fetch` downloads it again); `--credits` writes `CREDITS.md` with every downloaded asset and the four bundled OFL fonts. Fonts (Inter, Space Grotesk, Playfair Display, JetBrains Mono) ship with the skill and need no download.
- `validate <file>`: checks any pipeline document (brief, treatment, shot spec, look bible, job, assembly plan, QA report, assets ledger) against its schema and the semantic rules of its kind; the error lists every problem as a sentence. Asset ids named in a brief or shot spec must already be in the ledger under the data directory.
- `assemble --plan <assembly-plan.json>`: joins the clips with their transitions, mixes narration and music, applies the finishing grade and encodes the delivery. `artifacts` holds the delivery and its `.srt` when the plan has captions; `data.verified` holds the probed frame count, frame rate and size.
- `qa --video <file> [--plan <file>] [--text-boxes <json>] [--still <png> --still-frame <k>] [--report <file>] [--loudness-target <LUFS>] [--no-fail]`: measures the delivery and writes a QA report (`evidence[0]`, by default `<out>/qa/<video name>.qa.json`). Exit 1 with code `qa-failed` names the failing checks unless `--no-fail` is given. Read the report's `checks[]` and repeat each failing check's `detail` to the user; never pass a piece the report failed.
- `sheet --frames <dir of PNGs or JSON list> [--output <png>] [--columns <n>] [--thumb-width <px>]`: tiles labelled frames into one contact sheet (`artifacts[0]`). Look at the sheet before judging a shot.

## Behavior rules

1. Ask at most one clarifying question before starting. Otherwise choose sensible defaults, state them and go.
2. Never claim a result is photoreal, or that a shot looks right, without inspecting the rendered frames or the contact sheet. Say what you saw.
3. State the limits up front when the brief asks for people, faces, animals or a live-action look, and propose the stylized or abstract alternative before any render.
4. Narration uses a small local voice model that the user installs on request; always offer the user's own recording as the alternative. Music is user-supplied or absent.
5. Confirm before a long render: give the frame count and the time estimate, and wait for a yes.
6. Never invent asset ids, file paths or tool versions. Use only what a command returned.
7. Fail loudly: when a command fails, repeat its `message` and `hint`, say which step stopped, and never pretend the step succeeded or silently skip it.

## Blender rule

Run `doctor` first. If Blender is missing or is not 5.2.x, say so, offer the setup script (`Setup-VisionForge.cmd` or `scripts/setup.ps1 -Install` on Windows, `scripts/setup.sh` elsewhere; it asks for approval and installs about 350 MB) and continue with the `html` and `three` lanes. Never download Blender yourself and never run a Blender build the user did not install. When the user declines Blender, pass `-SkipBlender` (or `--skip-blender`) so the script installs only what the other lanes need.

## Status

Implemented today (M3): `help`, `version`, `doctor`, `validate`, `plan`, `still`, `render`, `assets`, `assemble`, `qa` and `sheet`; the `html` lane renders (title cards, lower thirds, kinetic type over a 2.5D stage with a stand-in for the subject). Planned: the `three` lane (M4), the `blender` lane (M5), `audio` (M6), the assembly plan built from the job (M7); `audio` exits 2 with a `not-implemented` error until then, and a `three` or `blender` shot fails `still` with `page-init` or `lane-unavailable`. `help` prints the live table with every option. The state of the whole repository, with what is and is not verified, is in `docs/handoff.md` at the plugin root: `${CLAUDE_PLUGIN_ROOT}/docs/handoff.md`.

## Knowledge base

Read a reference only when the step needs it. The outline, with one line per file and its status, is [references/README.md](references/README.md); open it to find the file, then open the file. The tables in the references are the vocabulary of the shot spec and the look bible: a value that is not in them is not a direction.
