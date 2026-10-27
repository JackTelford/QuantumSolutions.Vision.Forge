# Handoff

The single source of truth for where this repository stands. Newest milestone first. Every claim here points at a test or a file under `docs/evidence/`; anything else is listed under "Untested".

## M1: contracts, doctor, assemble, QA and contact sheets (2026-10-27)

### Done

- **Contracts** (`schemas/`, `src/shared/contracts/`): six new schemas (`brief`, `treatment`, `shot-spec`, `look-bible`, `job`, `assets-ledger`) beside the three from M0b and the two from M1 groundwork (`assembly-plan`, `qa-report`); `schemas/vocabulary.json` holds every shared enumeration once (30 entries: lanes, use cases, aspects, frame rates, shot sizes, the 26 camera moves, easing tokens, focal lengths, lighting presets, looks, fonts, text animations, transitions, codecs, statuses) and style rule 16 plus `tests/schema/vocabulary.test.ts` keep every schema's copy identical to it. The QA report's subject kind is named `QaSubjectKind` so it does not collide with the brief's `SubjectKind`. Eleven generated contract files are committed and drift-checked.
- **`validate <file>`** (`src/cli/commands/validate.ts`, `src/schema/checks/`): schema validation followed by the semantic rules of the kind, one file per kind with a shared `Rule<T>` shape: brief (5 rules: even dimensions, aspect within 1 percent, duration, music path versus policy, assets in the ledger), treatment (3), shot spec (9: unique ids, frames inside the shot, legal move per lane, text in the title-safe area, focus distance, assets in the ledger, render profile only after the still gate), look bible (4, including WCAG 4.5:1 text contrast through `src/shared/color/contrast.ts`), job (3), assets ledger (2: unique and sorted ids), assembly plan (1: the transition-series math). Every problem is one sentence; the error's hint names the rule file.
- **`doctor`** (`src/cli/commands/doctor.ts`, `src/tools/`): finds Node, ffmpeg and ffprobe (version, filter and encoder lists checked against the required sets), Edge and Chrome (version, then a headless WebGL capability page: renderer string, WebGL2, `EXT_color_buffer_float`, hardware or software), the GPU (nvidia-smi or Win32_VideoController), the desktop session, long-path support and Blender (`BLENDER`, the known folder, the registry ProgID with the launcher swapped for `blender.exe`, PATH; Store builds refused; 5.2.x only; an optional `--python-expr` probe for engines, devices, the action-slot API and `media_type`, parsed from one `PROBE {json}` line). Writes `tools.json` (schema extended with `Browser.webgl`, the Blender probe fields and a root `problems[]`), prints one line per tool and decides the four lanes (`html`, `three`, `blender`, `audio`). A missing Blender is a warning with the install command, not a failure; `--require <lane>` makes a closed lane exit 1 with code `tool-missing` (ADR 0004 amended).
- **Setup scripts** (`Setup-VisionForge.cmd`, `scripts/setup.ps1`, `scripts/setup.sh`): check mode by default with a table and the exact install command under each missing row; `-Install` / `--install` installs through winget (exact ids, Blender 5.2.3 pinned), Homebrew or apt and snap; `-SkipBlender`; then `npm ci --ignore-scripts` and `doctor`. No prompts; exit 1 with a next-step sentence when a required program is missing.
- **`assemble --plan <file>`** (`src/assemble/`, `src/finishing/`, `src/shared/grade/`): every clip is normalized (fps, size, square pixels, yuv420p), joined with `concat` or `xfade` per the plan's transition list, mixed (narration lines placed by frame, music ducked under narration with `sidechaincompress`, two-pass `loudnorm` to the plan's LUFS and true-peak targets), captioned (SRT sidecar, burned in when asked), graded (the look-bible grade baked by TypeScript into a 33-point `.cube` applied by `lut3d` in 16-bit RGB, then vignette and seeded grain), tagged BT.709 and encoded (H.264 CRF with `+faststart`, HEVC or ProRes 422 HQ). The delivery is probed back and must match the plan's frame count exactly, its rate, size and square pixels. A scratch folder beside the output keeps the three ffmpeg logs on failure.
- **`qa --video <file>`** (`src/qa/`): eleven measured checks written as a `qa-report` document: dimensions, fps and duration against the plan; black frames (`blackdetect`), frozen frames (`freezedetect`, a planned hold at a clip tail tolerated), pops (adjacent-frame SSIM below 0.6 away from a planned cut), exposure drift (`signalstats` YAVG between clips or one-second windows), text contrast (frames extracted and the luma behind each text box turned into a WCAG ratio against the text colour, one shared implementation), loudness and true peak (`ebur128`), hero-still match (SSIM of the approved still against its frame). Exit 1 with code `qa-failed` names the failing checks and lists the report as evidence; `--no-fail` writes the report and exits 0.
- **`sheet --frames <dir or json>`** (`src/sheet/`): labelled thumbnails tiled with `scale`, `drawtext` and `xstack` into one PNG; a system font is passed explicitly because the Windows ffmpeg build crashes on two `drawtext` filters without one.
- **Shared** (`src/shared/color/contrast.ts`, `src/shared/grade/grade.ts`): WCAG 2.2 luminance and contrast; the grade as ASC CDL (offset, slope, power) plus saturation, contrast around a pivot and split toning, sampled into a `.cube` LUT; the grade's TypeScript type is the generated look-bible contract.
- **Docs**: README (status, commands table, quick start with the setup flags, layout, verified list, limits), `docs/SETUP.md` (setup script flags, file locations, the font note), `SKILL.md` (how to read `doctor`'s result, the commands available now, the Blender rule), `schemas/README.md` (rule 16, the kinds table).
- **ffmpeg 7.0 support** (after the first CI run): every normalized clip ends with `fps` again because `xfade` on 7.0 refuses an input whose rate `setpts` left unknown; hero-still-match extracts frame k to a PNG and compares two images because `ssim` on 7.0 paired a still with the wrong selected frame; the grain filter runs with `threads=1` because `noise` on 7.0 slices across threads in a varying order and a second encode differed; `drawtext` and `tile` form a contact-sheet filter set that `doctor` reports without closing the lanes and `sheet` names from `tools.json`. The Linux job downloads a pinned BtbN 8.1 build verified by SHA-256 (`docs/evidence/m0/ci-actions.md`).
- Process: four modules were built by parallel agents from written briefs, each reviewed adversarially and fixed (64 findings: contracts 14, doctor 19, assemble 17, QA 14; 63 applied, 12 skipped and either done by the integrator or recorded below), then the integrator resolved the seams between them (one WCAG implementation, the grade type, the plan loader shared by `assemble` and `qa`, evidence on failed results, the required manifest fields) and read the command files again.

### Evidence

| Claim | Number | Where |
| --- | --- | --- |
| Type checks pass under both configurations | `npm run typecheck` exit 0 | run locally 2026-10-27 |
| House rules hold across the repository | `npm run lint`: no findings in 214 files | same |
| Generated contracts match the schemas | `npm run schema:check`: 11 files up to date | same |
| Every installed package is on the license allowlist | `npm run licenses`: 32 packages checked, 0 failed | same |
| Unit and integration tests pass (ffmpeg 9.0.2 present, so every ffmpeg integration test ran) | `npm test`: 836 tests in 184 suites, 0 failures, 2 skipped (both need macOS or Linux) | same |
| `doctor` on this machine | exit 0; lanes html, three and audio open, blender closed; Edge 156.0.4314.42 and Chrome 156.0.8078.48 both report WebGL2 on `ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 ... D3D11)`, hardware; ffmpeg 9.0.2; RTX 2060 driver 610.88; interactive session; long paths off; Blender listed under `missing` with the winget command, `required: false` | run 2026-10-27, `tests/cli/doctor.test.ts` repeats it |
| Every schema follows the style guide and matches the vocabulary | 99 style-guide tests over 11 schemas, 17 vocabulary tests | `tests/schema/` |
| Semantic rules fire once per problem and stay quiet on a valid example of every kind | `tests/schema/checks/`, `tests/schema/documents/` (one shared valid example per kind) | same |
| `validate` end to end: exit 0 with `{ kind, path, checks }`, exit 1 `schema-validation` with the problem in the message, ledger lookup through `--data-dir`, exit 1 `data-file` on a malformed ledger, exit 2 usage | 8 tests spawning `scripts/cli.ts` | `tests/cli/validate.test.ts` |
| Tool discovery, version parsing, capability page, Blender gate and probe, registry, GPU, session, lane rules | 85 tests (fake file trees and scripted runners; the capability tests launch the real Edge) | `tests/tools/` |
| Setup scripts parse and check | 9 tests (PowerShell parse of `setup.ps1`, `bash -n` of `setup.sh`, `-CheckOnly` run on Windows) | `tests/setup/` |
| Assembly frame counts are exact: cut 60, dissolve of 10 over two 30-frame clips 50, wipe 15 plus fade-black 15 over three clips 60 | integration tests against synthetic 320x180 sources | `tests/assemble/assembler.integration.test.ts` |
| Loudness lands on target | two sine narration lines over a tone bed: measured -23.25 LUFS in, -16.0 LUFS out, within 1 LU | same |
| Grade is applied, not dropped | identity cube: PSNR 57.99 dB against the ungraded delivery; a non-identity cube and vignette or grain above 0: PSNR under 40 dB; vignette and grain byte-identical across two runs | same |
| Captions burn in | SSIM 0.9787 against the sidecar-free delivery with "Hello captions" rendered | same |
| HEVC and ProRes encode and probe back with square pixels; a source one PNG short fails verification | integration cases (h), (i), (j) | same |
| Assemble argv builders, graph, audio mix, normalization, probe parsing, finishing chain, `.cube` text | 99 tests across the assemble set | `tests/assemble/`, `tests/finishing/`, `tests/shared/grade/`, `tests/cli/assemble.test.ts` |
| QA finds the planted faults in synthetic clips: black frames at [30], frozen frames at [30, 45] without a plan and [45] with one, a pop at a cut only when unplanned, exposure drift between two patterns, a text box below 4.5:1, a quiet track below target | 86 tests in `tests/qa/`, 19 in `tests/cli/qa*.test.ts` | `tests/qa/`, `tests/cli/` |
| Contact sheet from six PNGs with labels, custom columns and thumbnail width | 17 tests | `tests/sheet/`, `tests/cli/sheet.test.ts` |
| WCAG contrast matches published figures (#767676 on white 4.54, #808080 on white 3.95) | `tests/shared/contrast.test.ts` | same |
| The ffmpeg-dependent suites pass on ffmpeg 7.0.2 as well as 9.0.2 | with `FFMPEG` pointing at the Gyan 7.0.2 full build (SHA-256 checked against the winget manifest): assemble, finishing and the assemble CLI 87 tests, qa, sheet, finishing and ffmpeg-info 124 tests, still-match and the qa CLI 15 tests, 0 failures; the same graded plan encoded twice is byte-identical on both versions | run locally 2026-10-27 |
| Continuous integration | run 40441503367 (commit 1561578) passed on all four jobs: windows-2025 node 24 in 2 m 24 s, node 26 in 2 m 26 s, ubuntu-24.04 node 24 in 1 m 17 s, node 26 in 49 s (Windows on Gyan 9.0.2, Ubuntu on BtbN 8.1); the two runs before it and what they found are in the evidence file | `docs/evidence/m0/ci-actions.md` |

### Untested

- Nothing has run in a real Blender: it is not installed here. Discovery walked a faked file tree and a faked registry; the probe expression was syntax-checked by CPython 3.14 but never executed by Blender's Python; the exit-code matrix (3 for a Python exception, the 0xC0000005 teardown crash) is handled by parsing only. M5 starts with the acceptance probes.
- `setup.ps1 -Install` and both `setup.sh` modes were not executed (parse tests and `-CheckOnly` on Windows only); the Linux snap fallback rests on today's snapcraft listing, which shows no 5.2 track.
- macOS and Linux discovery (app bundles, PATH names, `/snap/bin`) and font lookup are verified with fake directory trees only; the ubuntu-24.04 job covers the Linux paths of `doctor`, `assemble`, `qa` and `sheet` with Chrome and the BtbN build, but not Edge (it times out at launch there and is recorded as a problem) and not a GPU.
- On the Linux runner Edge's profile folder can outlive a timed-out launch; `doctor` logs that it could not remove it and the test tolerates it for a browser whose check failed. The cause (the browser still exiting when the removal retries run out) is not confirmed; M3's harness cleanup should wait for the process before removing a profile.
- ffmpeg versions between 7.0.2 and 8.1 (the distribution packages of Ubuntu 24.04 and Debian ship 6.1 and 7.1) were not run; 6.x is below the stated minimum because its `xfade`, `ssim` and `noise` behaviour was not measured.
- Ducking is not measured (only the final loudness is); `sidechaincompress` at threshold 0.05 may not duck under quiet narration.
- A non-identity LUT is checked for effect (PSNR), not against a reference look; `vignetteSoftness` is accepted by the schema and ignored by the chain (ffmpeg's `vignette` has a fixed falloff).
- `loudnorm` on deliveries under about 3 s falls back to its dynamic mode; only a 3 s delivery was measured. Cancellation through `AbortSignal` is not tested in assemble. The probe time budget (100 ms per frame) is an estimate.
- Every ffmpeg line format (`blackdetect`, `freezedetect`, `ebur128`, `signalstats`) is verified against ffmpeg 9.0.2 only; the exposure-drift threshold (40 YAVG) and the pop threshold (SSIM 0.6) are as specified, not calibrated on real material. `qa` has only seen synthetic 320x180 clips.
- `validate` with the per-OS default data directory (no `--data-dir`) was not exercised; every test passes an explicit one.
- The fix that `assemble` keeps its scratch folder when `loudnorm` prints no final measurement is covered by a scripted runner, not a real ffmpeg.

### Risks

- `validate` on a brief or shot spec requires every named asset id to be in `<dataDir>/assets.json`: run before `assets` has downloaded anything, it exits 1 by design. The `plan` command (M2) must download or stub assets before validating, or M3's `assets` must come first in the skill's order.
- `tools.json` records every ffmpeg filter and encoder name (hundreds of strings). Harmless, but a reader of the file sees noise; trimming to the required sets is a one-line change in `src/tools/ffmpeg-info.ts` when wanted.
- The Windows ffmpeg build (gyan) has no fontconfig: two `drawtext` filters without a font file crash with an access violation. `sheet` passes Segoe UI, Arial or Helvetica, or DejaVu Sans; a machine without any of them fails inside ffmpeg with a hint, and M3's text plates must never rely on `drawtext` defaults.
- The grade's gamma is applied as an ASC CDL power (above 1 darkens midtones) after the review round; no look bible exists yet, so nothing had to be regenerated, but the look presets written in M4 must be judged on rendered swatches, not assumed from the numbers.
- `doctor` records `hardware: false` when the browser reports SwiftShader or WARP; on the ubuntu CI runner that is expected, and the doctor test tolerates it. The `three` lane stays open there, so CI renders in M4 will be software renders with relaxed thresholds, as planned.
- ffmpeg versions differ in ways the tests only catch when a second version runs them: three such differences surfaced between 9.0.2 and 7.0.2 on the first Linux run. Every new ffmpeg invocation (M3 to M6) should be run against the 7.0.2 build kept for this purpose before it is called done.

### Deliberately not done

- No real media: every test source is synthetic (`testsrc2`, `color`, `sine`, generated PNGs). The first rendered frames arrive with M3.
- `plan`, `still`, `render`, `assets` and `audio` still answer `not-implemented` with their milestone.
- Blender is not installed; installing it is M5's first, consented step.
- `doctor` hashes `blender.exe` only; ffmpeg's SHA-256 is not computed, to keep `doctor` fast.
- The review found that the assembly chain feeds the 16-bit LUT and the 10-bit ProRes mezzanine from 8-bit 4:2:0 normalized clips; a true 10-bit path is deferred until a lane produces more than 8 bits.

### Review guide

Read these five in order (about 1,100 lines):

1. `src/tools/tools-manifest.ts`: how `doctor` turns what it found into lanes and problem sentences.
2. `src/assemble/invocation.ts`: the three ffmpeg argv builders (mix, measure, encode) and the filter graph; every golden test pins them.
3. `src/shared/grade/grade.ts`: the colour math behind the `.cube`.
4. `src/qa/motion-checks.ts`: black frames, frozen frames and pops judged against the plan.
5. `src/schema/checks/shot-spec.ts`: the richest set of semantic rules, with the frame and title-safe conventions in its header.

Then, if time allows, `scripts/setup.ps1` (the install story a new user meets first).

### Next: M2

Camera, easing, timeline and the composition solver as pure TypeScript under `src/shared/` with numeric tests: the 26 camera moves of `references/cinematography/camera-moves.md` baked per frame from one physical camera model, the easing tokens of `references/motion/easing-grammar.md` with one canonical spring, sequence and stagger combinators with named time events, and the solver of `references/composition/rules.md` (subject bounds plus shot size and lens to camera placement, grid anchoring, safe areas, headroom, text overlap). The calibration fixture for M4 is defined there too.

## M0b: core infrastructure, checks and packaging (2026-10-26)

### Done

- **CLI foundation** (`scripts/cli.ts`, `src/cli/`): one JSON result document on standard output (`schemas/cli-result.schema.json`), progress on standard error, exit codes 0/1/2/130, explicit `--data-dir` and `--out` with per-OS defaults, `help` and `version` implemented, every other planned command answers `not-implemented` with its milestone. The CLI never reads `CLAUDE_PLUGIN_*` from the environment (lint rule `no-plugin-env`).
- **Error taxonomy** (`src/errors/vision-forge-error.ts`): closed classes with code, message, hint and exit code; `describeError` for anything thrown.
- **Process runner** (`src/process/`): `ProcessRunner` seam, `ChildProcessRunner` (absolute `.exe` paths only, no shell, time limit, cancellation, output mirrored to files) and the scripted `FakeProcessRunner` under `tests/fakes/`.
- **Files and hashing** (`src/fs/`, `src/shared/`): atomic JSON writes, per-OS data directory, Windows path-length guard, directory removal with retry, canonical JSON and SHA-256 through Web Crypto (shared with the browser).
- **Network** (`src/net/`): the allowlist as (host, redirect hosts) pairs from probe P7, an `HttpDownloader` with manual redirect checks per hop, Range resume, idle watchdog, streaming SHA-256/MD5 verification, salvage of a complete partial, query strings stripped from recorded URLs, and the `assets.json` ledger. It is the only file under `src/` allowed to call `fetch`.
- **Harness server** (`src/harness/`): `serve.ts` as the only importer of Node's type stripper, run as a child process with `--disable-warning=ExperimentalWarning`; a reusable `request-handler.ts` (allowlisted roots, traversal guard, `.ts` → `text/javascript`, `nosniff`, `no-store`, loopback Host check, 405/404/400/500 policy); `HarnessServer` start/stop with validated roots, port reporting and an idempotent in-flight stop; the three import map.
- **Contracts** (`schemas/`, `scripts/gen-types.ts`, `src/schema/`): the style guide, three schemas (`cli-result`, `tools`, `render-manifest`), generated and committed `src/shared/contracts/*.ts` with `<Name>Values` arrays, a drift check (`npm run schema:check`), and an Ajv 2020 validator with an own `date-time` format and problem lines that name the instance path.
- **House-rule lint** (`scripts/lint.ts`, `src/lint/`): 13 rules on the TypeScript compiler API (decorators, erasable syntax, `import type`, `.ts` extensions, JSDoc and explicit return types on exports and public methods, no `any`, import direction, stripper and `fetch` confinement, plugin environment variables, key-like strings, page mode for `src/browser/`, file length).
- **License check** (`scripts/licenses.ts`, `src/licenses/`): SPDX expression parsing against a short allowlist, production versus development from the lockfile, symlinked packages followed, `THIRD-PARTY.md` and `docs/licenses/` (license texts and NOTICE files of production dependencies) generated and kept current by a staleness test.
- **Packaging**: `.claude-plugin/plugin.json` (plugin `vision-forge`, no pinned version), `.claude-plugin/marketplace.json` (marketplace `quantum-solutions`), `skills/cinematic-studio/SKILL.md` v0 (portable frontmatter, the one-command contract, result reading, behavior rules, the Blender rule, an honest status section) and `references/README.md` (the knowledge-base outline with milestones).
- **CI**: `.github/workflows/ci.yml` (windows-2025 and ubuntu-24.04, Node 24 required and 26 informational, actions pinned by commit SHA, ffmpeg installed, `npm ci --ignore-scripts`, typecheck, lint, schema check, licenses, tests, `workflow_dispatch`); `blender-manual.yml` as `workflow_dispatch`-only M5 scaffolding.
- Process: the six modules were built by parallel agents from written briefs, each reviewed adversarially (54 findings, 52 applied, 2 skipped and recorded below), then read again by the integrator.

### Evidence

| Claim | Number | Where |
| --- | --- | --- |
| Type checks pass under both configurations | `npm run typecheck` exit 0 | run locally 2026-10-26 |
| House rules hold across the repository | `npm run lint`: no findings in 95 files | same |
| Generated contracts match the schemas | `npm run schema:check`: 3 files up to date | same |
| Every installed package is on the license allowlist | `npm run licenses`: 32 packages checked, 0 failed | same |
| Unit and integration tests pass | `npm test`: 307 tests in 58 suites, 0 failures, 0 skipped | same |
| Downloader resumes after an interruption and refuses bad hashes and hosts | 49 tests in `tests/net/` against a loopback server with Range, redirect, drop and hang modes | `tests/net/http-downloader.test.ts` |
| Harness server strips `.ts`, refuses traversal (including `..%5C` on Windows), survives a stripper error, reports exact HEAD lengths, stops its child | 49 tests in `tests/harness/` | `tests/harness/harness-server.test.ts` |
| Lint rules fire exactly once per violation and not on clean fixtures | 27 tests over 30 fixture files | `tests/lint/lint.test.ts` |
| Schemas follow the style guide and the validator names paths | 74 tests | `tests/schema/` |
| License check parses SPDX, walks nested and scoped packages, generates stable notices | 41 tests | `tests/licenses/` |
| Plugin manifests and skill frontmatter are well-formed | 9 tests | `tests/packaging/packaging.test.ts` |
| The CLI result contract round-trips through its schema | `successResult`/`failureResult` validate against `cli-result.schema.json` | `tests/schema/validator.test.ts` |

### Untested

- Continuous integration: verified after the push. The first run (40407107859) passed on both Windows jobs, hung in `apt-get` on Ubuntu and showed two Linux-only test expectations written for Windows paths; after pinning the actions to v7, switching to the SHA-pinned `setup-ffmpeg` action and fixing the two tests, run 40410446831 passed on all four jobs (windows-2025 and ubuntu-24.04, Node 24 and 26) in under a minute each (`docs/evidence/m0/ci-actions.md`).
- `claude plugin validate .` passed with one warning, the deliberately absent `version` in plugin.json (the commit SHA versions the cache); installing the plugin from the marketplace and loading it with `--plugin-dir` on a clean profile is M8's check.
- The downloader's path where a server answers 206 at the wrong offset, and the write-failure path when running as root on Linux (the test skips as root), have no test.
- The harness server's '(aborted)' log marker, the config-directory removal warning and the SIGTERM handler on Windows are verified by reading, not by tests.
- The downloader has only talked to a loopback server; the production allowlist and the real redirect chains are verified by unit tests against probe P7's recording, not by downloading from the real hosts.
- `${CLAUDE_PROJECT_DIR}` substitution in skill bodies is taken from the Claude Code docs, not observed.
- Nothing renders yet: no lane, no `doctor`, no setup scripts (M1).

### Risks

- A browser or Node update may change what the lint's page-mode and the stripper accept; the lint tests and the Node 26 CI job are the early warning.
- `tests/fixtures/licenses/node_modules/` is tracked through a `.gitignore` negation; a tool that ignores `node_modules` by convention (an editor, a scanner) may hide it.
- The license allowlist is deliberately short; the first dependency under another permissive license (MPL-2.0, Zlib) will fail the check and needs a reviewed addition.
- `THIRD-PARTY.md` and `docs/licenses/` are written non-atomically; an interrupted `--write` is repaired by running it again.

### Deliberately not done

- No `doctor`, no `validate`, no setup scripts, no assemble or QA code: M1.
- No `src/browser/` code yet, so the page-mode lint rule is proven only by fixtures.
- No atomic writes for the generated notice files; no NOTICE copies for development dependencies.
- The loopback fixture has no "resume from zero" mode (the one skipped test).

### Review guide

Read in this order:

1. `scripts/cli.ts` and `src/cli/result.ts` — the one program the skill calls and the one document it returns.
2. `src/net/http-downloader.ts` with `src/net/allowlist.ts` — every network byte goes through here.
3. `src/harness/request-handler.ts` and `src/harness/harness-server.ts` — what the browser will talk to.
4. `src/lint/export-rules.ts` and `src/lint/page-mode.ts` — the house rules as code.
5. `skills/cinematic-studio/SKILL.md` — what Claude reads.

### Next: M1

Contracts and validation for the remaining documents (brief, treatment, shot spec, look bible, job, QA report, assets ledger); `doctor` writing `tools.json` with the setup scripts (`-CheckOnly`/`-Install`); `assemble` (normalize, xfade, mix, captions, H.264 CRF 16 BT.709 +faststart, optional ProRes/HEVC); the finishing module (`.cube` generation, lut3d/vignette chain); QA metrics (ffprobe, blackdetect, freezedetect, adjacent SSIM, signalstats drift, ebur128, text-contrast sampling); the contact sheet. Synthetic tests only. Then stop and report.

## M0a: research, probes and decisions (2026-10-26)

### Done

- Repository hygiene: `.gitattributes` (LF everywhere, CRLF for `.cmd`/`.bat`, binaries marked), `.editorconfig`, `.gitignore` (whole roots only), `LICENSE` (Apache-2.0), `NOTICE` (bpy/GPL compatibility stated), `AGENTS.md` (working and code rules), `CLAUDE.md` (pointer).
- Dependencies pinned exactly: `ajv` 8.20.0, `playwright-core` 1.64.1, `three` 0.186.1; dev `typescript` 6.0.3, `@types/node` 24.19.2, `@types/three` 0.186.0 (owner-approved), `json-schema-to-typescript` 16.0.0. Lockfile v3. `engines.node >= 24.12.0`.
- TypeScript configuration: `tsconfig.base.json` (strict, erasable syntax only, verbatim module syntax, `.ts` imports) with `tsconfig.node.json` and `tsconfig.browser.json`; `src/shared/` compiles under both.
- Seven machine probes under `scripts/probes/` with reports under `docs/evidence/m0/`: dependency install (P1), TypeScript flags (P2), TypeScript served to the browser (P3), headless WebGL renderer matrix (P4), capture determinism (P5), ffmpeg finishing and QA filters (P6), download redirect hosts (P7). The probes stay in the repository so they can be re-run when a tool updates.
- Eight ADRs under `docs/adr/`: TypeScript on Node type stripping; no GSAP; own harness; Blender lane (5.2 LTS, winget install, logic-free applier, engine pinned at the still gate); shared TypeScript in the browser; determinism policy; narration as an opt-in component; one camera and one grade across lanes.
- Documentation: `README.md`, `docs/SETUP.md`, `docs/ARCHITECTURE.md`, `docs/research.md` (every external fact with source and status), `docs/blind-test.md` (the three briefs and the scoring sheet, fixed before any milestone optimizes against them).
- First shared module and test: `src/shared/frame-time.ts`, `tests/shared/frame-time.test.ts` (3 passing).
- Owner decisions recorded (2026-10-26): Blender through winget 5.2.3; narration opt-in with license disclosure; `@types/three` and a direct `@huggingface/transformers` pin approved; push to `origin/main` after each approved milestone report.

### Evidence

| Claim | Number | Where |
| --- | --- | --- |
| `npm ci --ignore-scripts` fits the plugin install budget | 8.3 s, 97 MB, 32 packages | `docs/evidence/m0/p1-npm-install.md` |
| TypeScript 6.0.3 honors every flag the repository relies on | 25 of 25 checks as expected | `docs/evidence/m0/p2-tsc-flags.md` |
| Shared `.ts` served through Node's stripper with an import map loads three and two addons in Edge and Chrome | `document.title` = `OK 1 r186 function function`, 193 ms and 380 ms | `docs/evidence/m0/p3-tsserve.md` |
| `file://` module loading is blocked; a decorator fails loudly | CORS error recorded; `SyntaxError: Invalid or unexpected token` | same |
| Headless Edge and Chrome use the GPU by default on Windows | `ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 ... Direct3D11)` with no flags; SwiftShader and WARP selectable by `--use-angle`; WebGL2 and `EXT_color_buffer_float` on all | `docs/evidence/m0/p4-webgl.md` |
| Seek-based capture is byte-identical on the same machine | 10 of 10 hardware runs identical at frames 0, 15, 30, 59; Chrome identical to Edge; stability flags changed nothing | `docs/evidence/m0/p5-determinism.md` |
| The seeked CSS value is what the pixels show, with no compositor flag | expected 200 px, measured 200 px at frame 15 (and 0, 400, 786 at the others) | same |
| WebGL canvases are captured with and without `preserveDrawingBuffer` | both sampled the expected clear color at every frame | same |
| `animations: 'disabled'` destroys a seeked frame | CSS box at 0 px instead of 200 px | same |
| Screenshot cost | ~50 ms per 1080p frame on hardware, ~61 ms on SwiftShader; 1800 frames ≈ 90 s before render cost | same |
| ffmpeg finishing and QA chain works as designed | 18 of 18 checks: identity LUT lossless (PSNR ∞), seeded noise reproducible per sequence but position-dependent, BT.709 round trip 41.6 dB, xfade 45 frames, scdet cut at t = 1.0 with score 30.7, blackdetect/freezedetect/signalstats keys, contact sheet 1956x196, two-pass loudnorm → −16.0 LUFS | `docs/evidence/m0/p6-ffmpeg.md`, `p6-contact-sheet.png` |
| Redirect hosts behind the allowlist | huggingface.co → `us.aws.cdn.hf.co`; github.com → `raw.githubusercontent.com`, `release-assets.githubusercontent.com`; Poly Haven and npm direct | `docs/evidence/m0/p7-redirects.md` |
| Unit tests and type checks pass | `npm test` 3/3; `npm run typecheck` both configs | run locally 2026-10-26 |

Local tool versions: Node 24.13.0, npm 11.6.2, TypeScript 6.0.3, ffmpeg 9.0.2, Edge 156.0.4314.42, Chrome 156.0.8078.47, NVIDIA driver 610.88, Windows 11 Pro.

### Untested

- Nothing has run in Blender: it is not installed on this machine. Every Blender statement in ADR 0004 and `docs/research.md` comes from the 5.2 source and release notes. The M5 acceptance script must confirm the engine list, the `bl_rna` probe, a non-black EEVEE frame from a Node child process under OpenGL and Vulkan, a Cycles OptiX frame, the exit-code matrix and the crash-log behavior.
- Continuous integration has not run: no workflow exists yet (M0b) and nothing has been pushed.
- Cross-machine rendering differences were not measured by design; only same-machine runs were compared.
- Three.js rendering cost (SSAA, bloom, bokeh) is not measured; P5 priced only the screenshot path.
- Whether `onnxruntime.dll` loads `DirectML.dll` on the CPU path (M6).
- `npm ci` time on a slow connection or cold cache.
- Install scripts, `doctor` and the harness server as a child process do not exist yet (M0b and M1); the probes used an in-process server.

### Risks

- Browser auto-updates change the fingerprint and invalidate same-machine byte identity until the fingerprint is re-recorded; mitigated by the fingerprint in every manifest and the SSIM gate (ADR 0006).
- EEVEE in background mode on Windows is unproven here; if it fails, the Blender lane defaults to Cycles with a smaller feature contract and longer renders (ADR 0004).
- Blender 5.3 will become the winget default with Vulkan as the GPU backend; `doctor` refuses it until proven, which will surprise users who install the latest version. The setup script pins `--version 5.2.3`.
- `module.stripTypeScriptTypes` is still marked release candidate and prints an experimental warning; confined to one file with `amaro` as the fallback (ADR 0005).
- The narration component's GPL, LGPL and proprietary parts are disclosed but not yet exercised; the plugin works without it (ADR 0007).

### Deliberately not done

- No `scripts/cli.ts`, no `doctor`, no setup scripts, no CI workflow, no `SKILL.md`: these are M0b and M1 per the approved plan, split so each review stays small.
- No lookdev or taste questions yet; they come with rendered swatches at the end of M4.
- No portable Blender download by the skill (constraint), no Blender 4.5 support, no bundler for browser code.

### Review guide

Read in this order:

1. `docs/adr/0006-determinism-policy.md` and `docs/evidence/m0/p5-determinism.md` — the decision the whole browser side rests on, with the numbers.
2. `docs/adr/0004-blender-lane-version-install-and-applier.md` — the Blender lane design and what is still unproven.
3. `scripts/probes/lib.ts` and `scripts/probes/p5-determinism.ts` — the style every later module will follow (explicit types, no shell, one comment per decision).
4. `docs/research.md` — every fact with its source and status.
5. `README.md` and `docs/SETUP.md` — what a new user sees.

### Next: M0b

Core infrastructure with CI green on Windows and Ubuntu: error taxonomy and exit codes; CLI dispatcher with one JSON result on stdout and `--data-dir`/`--out`; `ProcessRunner` with a scripted fake and argv golden tests; atomic JSON and path-length guard; canonical-JSON content hash; `HttpDownloader` with the (host, redirect hosts) allowlist from P7, resume, checksums and the asset ledger; `scripts/lint.ts` for the house rules; the harness server as a child process with import map and HTTP tests; schema style guide, `gen-types.ts` and the drift check; license allowlist check; plugin packaging (`plugin.json`, `marketplace.json`, `SKILL.md` v0); CI workflow on both OSes. Then stop and report.
