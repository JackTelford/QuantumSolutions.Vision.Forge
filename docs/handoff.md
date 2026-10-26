# Handoff

The single source of truth for where this repository stands. Newest milestone first. Every claim here points at a test or a file under `docs/evidence/`; anything else is listed under "Untested".

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
