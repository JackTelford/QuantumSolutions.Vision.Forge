# Handoff

The single source of truth for where this repository stands. Newest milestone first. Every claim here points at a test or a file under `docs/evidence/`; anything else is listed under "Untested".

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

- Continuous integration has not run: the workflows exist but nothing has been pushed since they were written. The first push after approval is the first run on both operating systems; the Chocolatey ffmpeg shim on Windows runners and the Node 26 job are unexercised.
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
