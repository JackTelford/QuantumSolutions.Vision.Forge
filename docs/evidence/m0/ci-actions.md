# CI actions pinned by commit SHA

## Update after the first run (2026-10-26, run 40407107859)

The first run on `main` printed "Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24" for both v4 pins, and the `ubuntu-24.04 / node 24` job hung for over 14 minutes inside `sudo apt-get install -y ffmpeg` and was cancelled; both Windows jobs passed. The workflow now pins:

| Action | Tag | Commit SHA | Resolved from |
| --- | --- | --- | --- |
| `actions/checkout` | `v7` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | `https://api.github.com/repos/actions/checkout/git/ref/tags/v7` (object type `commit`) |
| `actions/setup-node` | `v7` | `949feb2413d6458794dcd2491c4babbbce0c15c1` | `https://api.github.com/repos/actions/setup-node/git/ref/tags/v7` (object type `commit`) |
| `FedericoCarboni/setup-ffmpeg` | `v3.1` (latest release, 2024-02-04) | `37062fbf7149fc5578d6c57e08aed62458b375d6` | `https://api.github.com/repos/FedericoCarboni/setup-ffmpeg/tags` |

`setup-ffmpeg` downloads a static ffmpeg build from GitHub releases on both runners and replaces the apt and Chocolatey steps. It is the one third-party action in the workflow; the SHA pin is the control. It still targets the Node 20 action runtime (GitHub forces it onto Node 24 with a warning); the pin is bumped when the action publishes a Node 24 release.

Result: run 40410446831 (commit 4bd4b78) passed on all four jobs: windows-2025 / node 24 in 52 s, windows-2025 / node 26 in 1 m 3 s, ubuntu-24.04 / node 24 in 26 s, ubuntu-24.04 / node 26 in 27 s. The two tests that failed on Linux in the first run (`tests/harness/static-roots.test.ts` treating `C:\Windows\win.ini` as absolute, `tests/process/child-process-runner.test.ts` using a Windows path for the shell-shim case) were platform-specific test expectations, not code defects, and were split by platform.

## Update after the M1 run (2026-10-27, runs 40438685381, 40441114654 and 40441503367)

The M1 push (commit 012ac3a) passed both Windows jobs and failed both Ubuntu jobs. `setup-ffmpeg` installs the johnvansickle `ffmpeg-release-amd64-static` build on Linux, which was 7.0.2 and has no `drawtext` filter; the Windows jobs run the Gyan 9.0.2 full build. Reproducing on the owner's machine with the Gyan 7.0.2 full build (downloaded from the `GyanD/codexffmpeg` 7.0.2 release and checked against the SHA-256 in the winget manifest, `0AA623FE…`) showed that every Linux failure was an ffmpeg-version difference, not a Linux one:

| Symptom on 7.0.2 | Cause | Fix |
| --- | --- | --- |
| every plan with a transition failed to encode (`libx264 … -22 Invalid argument`) | `xfade` on 7.0 refuses an input whose frame rate is unknown, and `setpts` leaves it unknown ("current rate of 1/0 is invalid"); 9.0 tolerates it | each normalized clip ends with `fps=<fps>` again (`src/assemble/normalize.ts`) |
| hero-still-match measured SSIM 0.82 against the frame's own extraction | `ssim` on 7.0 pairs a one-image input with the wrong frame when the frame is selected inside the same graph; `setpts` and `trim` did not help | frame k is extracted to a PNG first and two images are compared (`src/qa/still-match.ts`) |
| a second encode with grain was not byte-identical (2 to 5 frames differed; `-filter_complex_threads 1` made it identical) | the `noise` filter on 7.0 slices across threads in an order that varies run to run; 9.0 is reproducible either way | `threads=1` on the noise filter only (`src/finishing/finishing-chain.ts`) |
| `doctor` closed the html lane, `sheet` crashed inside ffmpeg | `drawtext` was in the lane-required filter set | `drawtext` and `tile` form a contact-sheet set that doctor reports without closing lanes; `sheet` names the gap from `tools.json` |

Four tests hard-coded Windows paths (`C:\vf\out\film.mp4` joined on POSIX) or Edge; they are platform-neutral now. Edge 155 on `ubuntu-24.04` times out in `launchPersistentContext` after 30 s while Chrome launches and reports SwiftShader WebGL2; `doctor` records that as a problem sentence and the capability test requires one working browser, not every browser.

The Linux job now downloads a BtbN GPL build instead of using the action:

| Item | Value |
| --- | --- |
| Release | `BtbN/FFmpeg-Builds` tag `autobuild-2026-10-26-14-25` (2026-10-26T14:26Z) |
| Asset | `ffmpeg-n8.1.3-24-g92611900bb-linux64-gpl-8.1.tar.xz`, 150,312,288 bytes |
| SHA-256 | `d113aa5b57ab0dcfee171d835240ce3ea5db826a0ee80ed7528c8d26a61e87a4`, read from the asset's `digest` field through `gh release view autobuild-2026-10-26-14-25 --repo BtbN/FFmpeg-Builds --json assets` and checked with `sha256sum --check` in the workflow before extraction |
| Reported version | `n8.1.3-24-g92611900bb-20261026`; `parseFfmpegVersion` drops the leading `n` |

The action remains for Windows (`if: runner.os == 'Windows'`). Moving to a newer BtbN tag means reading the new asset name and digest the same way and changing the two `env` values in `ci.yml`.

Result: run 40441114654 (commit 1e5eed0) passed three of the four jobs; `ubuntu-24.04 / node 24` failed one assertion, the doctor profile of Edge (which times out at launch there) still being present when the test looked, while `ubuntu-24.04 / node 26` passed the same test. The test now requires a removed profile only for a browser whose check ran (commit 1561578). Run 40441503367 (commit 1561578) passed on all four jobs: windows-2025 node 24 in 2 m 24 s, node 26 in 2 m 26 s, ubuntu-24.04 node 24 in 1 m 17 s, node 26 in 49 s.

The table and procedure below are the original M0b record.

Recorded 2026-10-26T20:47Z for `.github/workflows/ci.yml` by reading the GitHub API with a fetch tool and confirming with `git ls-remote --tags` from the owner's machine. Nothing was installed and no workflow was run.

## Pins used in ci.yml

| Action | Major tag | Same commit also tagged | Commit SHA | API object type |
| --- | --- | --- | --- | --- |
| `actions/checkout` | `v4` | `v4.4.0` | `11d5960a326750d5838078e36cf38b85af677262` | `commit` |
| `actions/setup-node` | `v4` | `v4.4.0` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | `commit` |

## How each SHA was resolved

1. `https://api.github.com/repos/actions/checkout/git/ref/tags/v4` returned `ref: refs/tags/v4`, `object.type: commit`, `object.sha: 11d5960a326750d5838078e36cf38b85af677262`.
2. `https://api.github.com/repos/actions/setup-node/git/ref/tags/v4` returned `ref: refs/tags/v4`, `object.type: commit`, `object.sha: 49933ea5288caeca8642d1e84afbd3f7d6820020`.
3. Both refs point at commit objects (lightweight tags), so no annotated-tag dereference through `git/tags/<sha>` was needed.
4. `git ls-remote --tags https://github.com/actions/checkout.git` and the same for `setup-node` listed each SHA under both `refs/tags/v4` and `refs/tags/v4.4.0`, which is the version named in the trailing `# v4.4.0` comment of each `uses:` line.

```text
11d5960a326750d5838078e36cf38b85af677262  refs/tags/v4
11d5960a326750d5838078e36cf38b85af677262  refs/tags/v4.4.0
49933ea5288caeca8642d1e84afbd3f7d6820020  refs/tags/v4
49933ea5288caeca8642d1e84afbd3f7d6820020  refs/tags/v4.4.0
```

## Newer majors seen, not used

The same `git ls-remote` listing showed major tags `v5`, `v6` and `v7` for both actions on 2026-10-26 (`actions/checkout` `v7` at `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-node` `v7` at `949feb2413d6458794dcd2491c4babbbce0c15c1`). The workflow pins `v4` as the M0b plan specified. `v4` of both actions runs on the Node 20 action runtime, which GitHub is retiring in favor of Node 24; if the first CI run prints a runtime deprecation warning or refuses the action, bump both pins to the newest major by repeating steps 1 to 4 above for that tag and update this file.

## Runner images

Both workflows name a runner image, not a `-latest` label: `ci.yml` runs its matrix on `windows-2025` and `ubuntu-24.04`, and `blender-manual.yml` runs on `windows-2025`. The image-specific facts below (the Chocolatey ffmpeg shim, winget availability) hold for those images; moving to a newer image is a deliberate change made in both workflows and recorded here. `ci.yml` also accepts `workflow_dispatch`, so a run can be repeated by hand without a new commit.

## Workflow facts worth knowing before the first run

- `actions/setup-node` with `cache: npm` needs `package-lock.json` at the repository root, which exists.
- `node-version: '26'` resolves to the newest 26.x in the Node release manifest; Node 26 becomes Active LTS on 2026-10-28 (ADR 0001). That job is `continue-on-error`, so its failure does not fail the workflow.
- On `windows-2025`, `choco install ffmpeg` puts a Chocolatey shim `ffmpeg.exe` on `PATH`, not the real binary. The shim is a real `.exe`, so `child_process.spawn` without a shell works, but `doctor` (M1) must accept a shim path or resolve it to the installed binary when it records `tools.json`.
- `blender-manual.yml` is `workflow_dispatch` only and never runs on push or pull request; it is M5 scaffolding.

## Local checks (2026-10-26, owner's machine, Node 24.13.0)

| Check | How | Result |
| --- | --- | --- |
| Subset YAML parse of both workflows | A 130-line Node script kept outside the repository: rejects CR, tabs, trailing spaces, a missing final newline and odd indentation; parses block mappings, block sequences, flow sequences, quoted scalars and literal block scalars to JSON | both OK: `ci.yml` 1 job, 11 steps, matrix `os` x `node` = 2 x 2, `fail-fast: false`, `continue-on-error: ${{ matrix.node == '26' }}`; `blender-manual.yml` 1 job, 3 steps, `on: workflow_dispatch` only |
| Independent parse with `js-yaml` 5.5.0 | `import('node_modules/js-yaml/dist/js-yaml.mjs')` (a transitive dependency of `json-schema-to-typescript`, not a declared one) | identical structure; both `uses:` values carry the SHAs above; `BLENDER_EXE` keeps its backslashes |
| Byte hygiene of the seven files this module owns | Node byte count | 0 CR, 0 tabs, 0 trailing spaces, final LF in every file |
| Manifests | `JSON.parse` | `plugin.json` has keys name, description, author, homepage, repository, license, keywords and no `version`; `marketplace.json` has name `quantum-solutions`, owner, one plugin with `source: "./"` |
| `SKILL.md` limits | script | 94 lines; description 847 characters; frontmatter keys name, description, license, metadata; the 14 reference links match the 14 outline rows in `references/README.md` |
| CLI claims in `SKILL.md` | `node scripts/cli.ts help`, `doctor`, `version` | exit 0 with the command table; exit 2 with `not-implemented` and a hint naming M1; exit 0 with `0.0.0`, `v24.13.0`, `win32-x64` |

## Changes after review (2026-10-26)

- The structural checks in the table above now live in the repository as `tests/packaging/packaging.test.ts` (node:test, no new dependency) and run with `npm test`: name and `source` parity between `marketplace.json` and `plugin.json`, the `SKILL.md` frontmatter keys and description length, byte hygiene of both workflows, every npm script that `check` runs being named in `ci.yml`, and the 14 outline rows of `references/README.md`.
- `SKILL.md` no longer repeats the 14 reference links (the README table is the single outline) and `metadata.version` is gone, so the row above describing 94 lines and the link/row parity check is superseded.
- `marketplace.json` no longer repeats the plugin description; `plugin.json` holds it.
- `blender-manual.yml` derives the MSI file name and URL from `BLENDER_VERSION`, accepts msiexec exit 3010 (success, reboot required), resets `$LASTEXITCODE` after the MSI fallback and silences the download progress bar; the `$ErrorActionPreference` lines are gone because GitHub sets it for every `pwsh` step.

## Not verified

- CI itself has not run: nothing has been pushed since the workflows were written, so no job has executed on a hosted runner. The first push to `main` is the test.
- Both YAML files were checked locally with a small Node script (indentation, line endings, a subset parse to JSON) and with the transitively installed `js-yaml`; GitHub's own workflow parser has not seen them.
- Whether `choco install ffmpeg` and `apt-get install ffmpeg` finish inside the job's 30-minute limit, and which ffmpeg versions they install.
- Whether winget is available on `windows-2025` for the Blender workflow; the MSI fallback with SHA-256 verification exists for that case and is equally unproven.
