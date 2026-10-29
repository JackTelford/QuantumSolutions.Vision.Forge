# Handoff

The single source of truth for where this repository stands. Newest milestone first. Every claim here points at a test or a file under `docs/evidence/`; anything else is listed under "Untested".

## M4: the three lane, the calibration parity and the lookdev sheet (2026-10-29)

### Done

- **Seams** (hand-written before the fan-out): the subject as primitives (`src/shared/subject/primitives.ts`), the lighting placement in world space (`src/shared/lighting/placement.ts`: azimuth around the subject from the camera, elevation, a sphere whose radius grows with the subject, the fill opposite the key), the thin-lens bokeh (`src/shared/camera/bokeh.ts`), the environment reference in the page spec and its resolution from the data directory (`src/render/environment.ts`: the rig's HDRI when `assets --fetch` installed it, else null and the lane's built-in room environment), `scene: 'calibration'` in the page spec.
- **The three lane in the browser** (`src/browser/three/`, every number computed in `src/shared/three/` so Node tests hold it): a `WebGLRenderer` on one canvas (no antialias, no alpha, drawing buffer preserved, sRGB output, AgX or linear tone mapping per the look, PCF shadow map); a 36 mm film-gauge `PerspectiveCamera` set per (sub-)frame from the baked camera through `setFocalLength`, so `projectThroughPose` agrees with `project.ts` to 1e-9; the stage (floor, wall, quarter-cylinder cyc, one `MeshStandardMaterial` in the palette's surface colour); the subject's parts as meshes (box, cylinder, sphere, capsule, torus) in the look's materials; the rig as one `RectAreaLight` per placed light with radiance = intensity × scalar × d² / A (the relative intensity is an irradiance on the subject, so the fill lights it at a third of the key as the ratio says) plus a shadow-casting `DirectionalLight` along the key; the key orbit of the light-sweep move re-places the lights per sub-frame; PMREM from the HDRI (`HDRLoader`) or `RoomEnvironment`; seeded motes as `Points` drifting as a pure function of the fractional frame; the post pipeline (`SSAARenderPass`, `UnrealBloomPass` when the look has halation, `BokehPass` with the thin-lens aperture, `OutputPass`, then an accumulation pass that sums N sub-frames across the shutter window into a float target and presents the sum once per frame: six sub-frames at 1080p, one at 640 px and below); `dispose()` frees every target, geometry, material and the context, and the runtime disposes the previous lane before building the next.
- **Calibration parity** (`src/calibration/`, `scripts/probes/m4-calibration.ts`, `tests/calibration/parity.integration.test.ts`): the calibration scene of ADR 0008 laid out on the camera's anchor plane in the three lane (every patch's corners project onto its box to 1e-9) and as flat patches in the html lane; the measurement (crop + BT.709 conversion + `signalstats` for YAVG, an area-scaled 1x1 crop for the mean RGB, hexcone hue and saturation for the swatches); the probe that renders both lanes under both tone mappings, with the studio HDRI and with the room environment, at 1080p and 480x270, and writes `docs/evidence/m4/calibration.md`; the parity test that renders both lanes at 480x270 through the real browser and holds the gray card to 117.3 ± 5 in both lanes and the two lanes' gray cards within 6 of each other (10 tests, 13 s).
- **Light scalars by measurement** (`src/shared/three/calibration-scalars.ts`, `docs/evidence/m4/calibration-tuning.md`): keyIntensityScalar agx 2.57, standard 3.25, shadowKeyShare 0.6, keyedEnvironmentIntensity 0.05, set in three trials.
- **White balance** (both lanes, `whiteBalancedKelvinRgb` in `src/shared/look/css-tokens.ts`; the integrator's fix for the review's finding that the three lane's gray card read 125, 115, 109 under a 5600 K key): every light's black-body colour is divided by the rig's key colour and scaled to a largest channel of 255, so the key renders neutral, a warmer fill warm and a cooler rim blue, as a camera balanced to its key records them; the three lane's neutrals now read 117, 117, 117. ADR 0008 decision 2 amended.
- **Luma measured with BT.709** (`rgbToLumaConversion` in `src/qa/text-contrast.ts`, used by the still gate's exposure and text-contrast checks and by the calibration measurement): `scale=out_color_matrix=bt709` before `format=yuv420p`, since ffmpeg's BT.601 default put the html lane's coloured swatches up to 22 YAVG from the expectation the delivery's tag implies; the html lane's nine patches now sit within tolerance. ADR 0008 decision 3 amended.
- **Focus warning in `plan`** (`focusWarnings` in `src/shared/composition/checks.ts`): when the lens focuses away from the solved subject distance by more than a circle of confusion of 0.2 percent of the frame and the move is not a rack focus, the warning names the distance to set. Found because every three-lane lookdev still was at the bokeh cap with the fixture's old 1.2 m focus; the fixture now focuses at 1.68 m.
- **Look presets as data** (`src/shared/look/presets.ts`): the seven looks of the look bible, each validated against the schema and the semantic checks, every text colour at 4.5:1 or more over the background and the surface.
- **Lookdev sheet** (`scripts/probes/m4-lookdev.ts`, `docs/evidence/m4/lookdev-sheet.png`, `lookdev.md`): the html title card and the three product shot for every look at 960x540, graded, with each still's YAVG against the look's band, one sentence per still written after looking at the sheet, and the six questions for the owner with the default taken for each.
- **Goldens for both lanes** (`tests/render/determinism.integration.test.ts`, `tests/goldens/html/`, `tests/goldens/three/`): ten fresh launches per lane; the html lane byte-identical; the three lane identical to within GPU noise (a run whose hash differs must keep PSNR ≥ 80 dB against the first; `VF_KEEP_RUNS=1` keeps the frames for a diff). ADR 0006 decision 6 amended.
- **The three lane end to end** through the CLI in a fresh data directory: doctor, `assets --fetch hdri:studio_small_09-1k`, plan, still for the two three shots and the html shot (all three passed the gate), approve, render (315 frames at 1080p in 39.7 s through one browser). `docs/evidence/m4/README.md`.
- Docs: ADR 0006 and 0008 amended as above, the cookbook's per-lane table (irradiance rule, environment intensity, white balance), SKILL.md status, README, `docs/evidence/m4/`, this section, the milestone note.
- Process: two stages of the fan-out (the three lane; then the calibration, parity and lookdev tooling), each built, adversarially reviewed and fixed: 20 findings, 20 applied. The second fix agent died before reporting with every edit on disk; the integrator pass picked up where it stopped (the refocused lookdev stills and their sentences), then closed the seams above.

### Evidence

| Claim | Number | Where |
| --- | --- | --- |
| Type checks, house rules, schema drift, licenses | `npm run check` exit 0 (405 files linted) | run locally 2026-10-29 |
| Unit and integration tests | `npm test`: see the CI row below for the count on this commit; 1474 tests, 0 failures, 3 skipped before the integrator's last changes | same |
| The three camera matches the pinhole projection | `projectThroughPose` agrees with `project()` to 1e-9 over five moves and four frames | `tests/shared/three/camera-mapping.test.ts` |
| Gray card parity | html 117.0; three 116.6 (agx) and 117.2 (standard) under the studio HDRI, 119.8 and 120.2 under the room environment, against 117.3 ± 5; three's neutrals 117, 117, 117 | `docs/evidence/m4/calibration.md`, `tests/calibration/parity.integration.test.ts` |
| html patches | 9 of 9 within tolerance under both tone mappings (BT.709 measurement) | `docs/evidence/m4/calibration.md` |
| Three-lane determinism | 10 fresh launches: frames 0, 26, 60, 104 of s01 at 480x270 one hash each in the committed run; across three batches 2 of 180 captures differed by one pixel one code value (PSNR 104 dB) | `docs/evidence/m4/determinism-three.md`, `tests/render/determinism.integration.test.ts` |
| html-lane determinism after the white balance | 10 fresh launches byte-identical; golden rewritten (the sheen is now neutral under the 5600 K key), SSIM 1.00000 on the check run | `docs/evidence/m4/determinism-html.md` |
| Goldens | `tests/goldens/three/product-shot-480x270-f060.png`, `tests/goldens/html/title-card-480x270-f026.png`, each with a fingerprint sidecar | same test |
| The three lane end to end | still s01 7.1 s including the launch, gate passed (exposure 44.7 in 24 to 140); render 105 + 90 + 120 frames in 39.7 s at 1080p: 125.4, 104.7 and 124.0 ms per frame | `docs/evidence/m4/README.md` |
| Cost per frame | calibration scene 1080p with four sub-frames and SSAA 2: 75 to 84 ms (html 49 ms); 480x270: 20 ms; lookdev 960x540: 46.7 ms (html 48.9) | `docs/evidence/m4/calibration.md`, `lookdev.md` |
| Lookdev | fourteen stills, seven looks; two three-lane stills outside their look's band (studio-clean 168.6, sunset-gradient 48.7) | `docs/evidence/m4/lookdev-sheet.png`, `lookdev.md` |
| Continuous integration | run RUN_ID_PLACEHOLDER: RESULT_PLACEHOLDER | GitHub Actions |

### Untested

- The three lane has run only on this machine's hardware renderer; the software renderer (SwiftShader) has not rendered the three lane here. The ubuntu CI job renders the three golden on SwiftShader and compares loosely (SSIM ≥ 0.95); the float accumulation target uses nearest filtering so a renderer without `OES_texture_float_linear` still presents.
- The scalars are measured under the product-studio rig; the other fifteen rigs reuse them unmeasured, so a rig whose lights stand at another distance inherits whatever the d²/A rule gives it.
- The rig's own `exposureEv` (high-key's +1 EV in `lighting/rigs.ts`) is applied by neither lane; the three lane's exposure is the look's EV plus the baked frame's (which already carries the shot's offset).
- The white and black patches of the three lane are reported, not gated (AgX rolls the white to 172; the environment lifts the black to 56 to 62); the parity test's bands for them are wider than the scene's tolerances, as its test names say.
- Only the studio_small_09 HDRI has been rendered; the other nine catalogue entries and the room environment for the rigs that name them have not been looked at beyond the lookdev sheet.
- The lookdev sentences are one reader's look at the sheet; nobody has scored the stills against the vision rubric (M7).
- The look bible's QA bands have not been reconciled with what a lit product shot can reach (two three-lane stills miss their bands; sunset-gradient's band is unreachable for its violet palette).

### Risks

- `BokehPass` (three's addon) leaves a thin bright halo along in-focus edges over the blurred wall and ring-shaped near-focus motes, from its fixed kernel; the blur is capped at 1.5 percent of the frame to keep the halo small. A depth-aware blur is a later option. Its depth pass clears with the scene background instead of white, harmless while the wall covers the frame.
- Under AgX the scene background is tone mapped, so the three lane's surround is the look's background only approximately while the html lane's is exact; a cut between the lanes on a flat background will show it unless the three shot's background is a stage, which it is for every non-calibration shot.
- The GPU noise on the three lane means a re-rendered shot can differ from its cached frames by a pixel; the render cache compares by hash and would treat such a frame as changed only if someone re-hashed it, which nothing does today. The hero-still comparison (SSIM ≥ 0.98) is unaffected.
- The three lane's 1080p frame costs 105 to 125 ms with six sub-frames; a minute of film is about four minutes of render. The sub-frame count is tied to the width, not a quality setting.
- The html lane's sheen and gradient changed colour with the white balance (neutral under a 5600 K key where they were warm); the M3 golden was rewritten for it, and any M3 still a reader kept will differ slightly.

### Deliberately not done

- The blender lane (M5), the assembly plan from the job (M7), narration (M6).
- A depth-aware bokeh; volumetric haze in three (the atmosphere is motes only).
- Per-rig scalars; a `gated` flag on the calibration patches.
- Text in the three lane: text is the html lane's and is composited at assembly (ADR 0008 decision 4).

### Review guide

Read these five in order (about 900 lines):

1. `src/shared/three/lights.ts` and `src/shared/look/css-tokens.ts` (`whiteBalancedKelvinRgb`): the irradiance rule and the white balance, the two decisions that make the lanes agree.
2. `src/browser/three/lane.ts` and `src/browser/three/post.ts`: init, the sub-frame loop and the accumulation.
3. `src/shared/three/sub-frame.ts` and `src/shared/three/camera-mapping.ts`: how a baked frame becomes a three camera, and how sub-frames are interpolated.
4. `src/calibration/measure.ts` and `tests/calibration/parity.integration.test.ts`: what the parity numbers mean and what gates them.
5. `docs/evidence/m4/lookdev-sheet.png` with `lookdev.md`: the six questions for the owner and the defaults taken.

### Next: M5

The blender lane: the resolver from shot, look, bake and environment to the closed `blender-scene` document (`schemas/blender-scene.schema.json`, already committed with `blender/apply_scene.py` and the axis mapping of ADR 0008), the runner with the attempt ladder inside `still` (EEVEE opengl → vulkan → Cycles OptiX → CUDA → CPU for stills only), the success predicate (exit code, every frame present, frame 0 not black, no new crash log), the estimator and resumable batches, `still` and `render` dispatching blender shots, the lane code hash covering `src/lanes/blender/`, the acceptance evidence under `docs/evidence/m5/` (engine list, devices, one-frame renders per engine with timings, the exit-code matrix, a 1080p still, a 30-frame clip, a 5 s turntable, the Blender column on the lookdev sheet) and an honest quality assessment.

## M3: the browser harness, the html lane, the still gate and the still, render and assets commands (2026-10-29)

### Done

- **Page protocol and seams** (`src/shared/harness/protocol.ts`, `src/harness/types.ts`, written by hand before the fan-out): the `ShotPageSpec` a page receives (shot, look, size, the camera baked per frame, the base distance, the font and asset URL prefixes), the `__vfInit(specJson)` / `__vfSeek(frame)` globals with their JSON reports (fonts loaded, running animations, the WebGL renderer string, each text box's measured overflow), the renderer policy (`hardware`, `software`, `any`), the ANGLE backend per platform and the `BrowserRenderer` interface the render code is tested against with a fake.
- **CSS stage transform** (`src/shared/camera/css-transform.ts`): the baked camera as a `perspective` and a `matrix3d` for a 2.5D stage, derived so that CSS projects every stage point exactly where `project.ts` puts it (tests hold the two to 1e-5 px through a push-in, an arc, a tilt, a dutch roll and a zoom); the stage scale is fixed from the base pose and the perspective follows the focal length, which is how a zoom and a dolly differ on the stage.
- **Typography** (`src/shared/typography/`): the four bundled OFL variable fonts (Inter, Space Grotesk, Playfair Display, JetBrains Mono from google/fonts commit 6157dfaa, SHA-256 pinned and checked by a test, OFL texts beside them under `skills/cinematic-studio/assets/fonts/`), the role sizes at both scale ratios, line heights, weights, tracking and case, the `@font-face` rules the page carries; the six text animations as pure functions of the frame (fixed durations and easings, exits mirrored at two thirds with `standard-accelerate`, word stagger, counters); and the fit (`fit.ts`): the role's scale size shrunk one pixel at a time until the greedy-wrapped lines fit the box, never below the composition floor, so the lane and the planner's check 5 agree.
- **Browser runtime and html lane** (`src/browser/runtime/`, `src/browser/html/`, with every computable style under `src/shared/html/`, `src/shared/lighting/rigs.ts` and `src/shared/look/css-tokens.ts`): the runtime loads the look's faces through `document.fonts.load`, reads `UNMASKED_RENDERER_WEBGL`, builds the lane, measures every text box in its shown state, draws frame 0 and runs the DOM check (no `<video>`, `<iframe>`, SMIL, shadow root, `getAnimations().length === 0`); `render(frame)` rewrites every inline style from scratch. The html lane is a 2.5D stage (`perspective` viewport with the rig's lit gradient, a `preserve-3d` stage under the camera matrix, a backdrop plate four frames wide at −0.6 m, a haze plate, a floor shadow, the subject stand-in shaped by the primitive with a sheen and a box-shadow that follow the key light and the light-sweep orbit, seeded motes) under a flat text overlay (one box per text element at its frame fractions, plates for lower thirds, scrims for captions, one span per word for `stagger-words`, counters counting). The 16 lighting rigs of the cookbook are data with per-shot overrides.
- **Node harness** (`src/harness/browser-session.ts`, `fingerprint.ts`, `served-roots.ts`, `page-error.ts`; `src/lanes/html/page.ts`, `src/lanes/lane-code-hash.ts`): `openBrowserRenderer` launches the persistent context with exactly `browserLaunchFlags` plus `--use-angle`, reads the renderer through the capability page, enforces the policy (`any` falls back to SwiftShader when hardware has no context) and removes its profile on close; `capture` opens the page, fails at once on a non-OK HTTP answer, waits for the protocol, bounds init by 60 s, repeats the page's own sentences and the last ten console errors in `page-init` / `page-seek` errors, honours aborts, and screenshots each frame after a synchronous seek. The fingerprint reads AppliedDPI and the four ClearType values from the registry on Windows. The lane code hash covers `src/shared/`, `src/browser/runtime/`, `src/browser/<lane>/`, the page document and the font files, and enters every shot key through `plan`, `still` and `render` alike.
- **Render orchestration** (`src/render/`): the cache folder `<data>/cache/<key>/frames/f%06d.png` with a validated render manifest beside it (pixel hashes from ffmpeg `framehash` in batches of thirty, the fingerprint and its hash), resumable and reused; the still gate (composition checks 1 to 5 with the look's type scale, the browser's text measurement, the WCAG ratio behind every text box on the finished still, the still's YAVG inside the look's band); the still finishing (the look's LUT and vignette, no grain); the job state (load the folder's copies, pin the render profile into the shot spec copy and re-key the shot).
- **`still`, `render`, `assets`** (`src/cli/commands/`): see SKILL.md for the options and codes. `still` renders one frame through the same path as `render`, grades it, writes `stills/<shot>-r<n>.png` with the raw frame and the gate report, pins the profile (the key changes once), optionally renders a 4K `-2x.png`, and `--approve` marks a passed still approved; `render` renders every approved html shot with one browser, reuses complete manifests, refuses a renderer that disagrees with the pinned profile; `assets` lists, fetches (size and MD5 verified, ledger recorded, `.corrupt` set aside on a failed verify), verifies and writes `CREDITS.md` for ten pinned Poly Haven HDRIs.
- **`plan`** keys every shot with its lane's code hash and, on a rerun over the same folder, carries the render profile the still gate pinned for every shot the documents did not change (`src/plan/pinned-profiles.ts`), so approvals and renders survive a replan; the composition check runs with the look's type scale.
- **Docs**: ADR 0006 (decision 8 amended: lane code hash coverage, browser fallback, the profile in the key; decision 10 added: the page protocol and the still gate), SKILL.md (the order of a production, the three commands and their codes), README, SETUP (data directory layout, fonts, troubleshooting), `docs/evidence/m3/`.
- Process: four modules by parallel agents (browser runtime and html lane, Node harness, render orchestration and commands, assets), each adversarially reviewed and fixed: 40 findings (browser 11, harness 12, render 11, assets 6), 40 applied (3 refused with reasons), then the integrator pass: the text fit and the measured overflow (both agents flagged the title spilling its box), the lane code hash and the profile carry in `plan`, the browser fallback in the key, the test browser preference for Linux CI, the determinism test and the golden, the timing run, ffmpeg 7.0.2.

### Evidence

| Claim | Number | Where |
| --- | --- | --- |
| Type checks, house rules, schema drift, licenses | `npm run typecheck` exit 0 both configs; `npm run lint`: no findings in 353 files; 11 contracts up to date; 32 packages, 0 failed | run locally 2026-10-29 |
| Unit and integration tests | `npm test`: 1345 tests in 331 suites, 0 failures, 3 skipped (two macOS or Linux only, the Poly Haven network test) | same |
| The CSS stage agrees with the pinhole projection | every stage point within 1e-5 px of `project()` through five moves and four frames | `tests/shared/camera/css-transform.test.ts` |
| The first rendered frame passes the gate | `still` on the fixture's s03 at 1080p: composition 0 problems, text-contrast 11.23:1, exposure YAVG 33.4 in 24 to 140; 4.1 s including the launch | `docs/evidence/m3/README.md`, `title-card-s03-r1-640.png` |
| Same machine, same fingerprint: byte identity | ten fresh Edge launches, frames 0, 26, 60, 119 at 480x270: one framehash per frame; Chrome gives the same four hashes and SSIM 1.00000 against the Edge golden | `tests/render/determinism.integration.test.ts`, `docs/evidence/m3/README.md` |
| Golden | `tests/goldens/html/title-card-480x270-f026.png` with its fingerprint sidecar; SSIM 0.99 on the same fingerprint, 0.95 elsewhere | same test |
| Timing | 600 frames at 1920x1080 in 66.1 s, 110.2 ms per frame including hashing; 120 frames in 14.0 s | `docs/evidence/m3/README.md` |
| Harness against the real browser | policy `any` picks the D3D11 renderer, `software` reports SwiftShader, three captured frames decode to the expected pixels, an aborted capture lands exactly the frames before the abort, a failing fixture page surfaces its sentence, a 404 fails in 92 ms, the profile directory is removed on close | 15 tests, `tests/harness/browser-session.integration.test.ts` |
| Render orchestration without a browser | resume skips hashed frames, a failing renderer marks the manifest failed with the frames kept, the whole-shot reuse reports the requested count | `tests/render/render-shot.test.ts` and the rest of `tests/render/` |
| still and render end to end at 480x270 | still exit 0 with the gate passed and the profile pinned; render 12 frames, 12 reused on the second run, 120 complete on the whole-shot run, nothing launched when everything is cached | `tests/cli/still.test.ts`, `tests/cli/render.test.ts` |
| assets | loopback downloads record the ledger, a wrong MD5 records nothing, a modified byte fails `--verify`; the real `hdri:studio_small_09-1k` download: 1615248 bytes, MD5 matched, SHA-256 e7cfda5f…, 0.2 s | `tests/assets/`, `tests/cli/assets.test.ts` |
| ffmpeg 7.0.2 | the six ffmpeg-dependent M3 suites: 43 tests, 0 failures on the Gyan 7.0.2 full build | run locally 2026-10-29 |
| Continuous integration | run RUN_ID_PLACEHOLDER: RESULT_PLACEHOLDER | GitHub Actions |

### Untested

- Linux and macOS have not run the harness here; the ubuntu CI job runs the integration tests on Chrome (the tests prefer Chrome on Linux because Edge times out at launch on that runner). Policy `any` on a runner without a GPU takes the SwiftShader fallback and records `software`.
- No golden exists for the software renderer; its frames are classified and launched but not compared.
- The still gate measures text boxes and luma; nobody has yet judged a still by the vision rubric (that is the M7 loop). The handheld move, the motes and the sheen have been looked at on one fixture only.
- The lighting gradient's angle convention (`src/shared/look/css-tokens.ts`: a key at camera-right lights the right side) was chosen by the builder against the brief's literal formula and verified by eye on one frame; the three lane (M4) will show whether html and three agree on the lit side.
- The floor shadow is a camera-facing ellipse just below the subject (a plate rotated into the floor is invisible at eye level); on the dark obsidian look it does not show at all.
- `assets --fetch` has only run against Poly Haven's CDN once; the catalogue's ten MD5s were read from api.polyhaven.com on 2026-10-29.

### Risks

- The text fit is an estimate (average character widths per family); the browser's measurement reports what the estimate missed, and the gate fails on it, but a box the estimate fills exactly may still wrap one word in the browser. Widen boxes rather than fight the estimate.
- The html lane renders the three lane's shots as "the three lane arrives in M4": a shot spec with `three` shots passes `plan` and fails `still`.
- The key changes at the still gate (the profile enters it); `plan` carries the profile forward only when a shot is byte-for-byte unchanged apart from it. Editing any field of a shot re-keys it and sends it back through the gate, as intended.
- `render` keeps one page directory per job (`<job>/page`) while `still` uses `<cache>/<key>/page`; both serve the same document, but a job whose shots had different sizes would need one page per size (the schema forbids that today).
- 110 ms per 1080p frame is twice the P5 screenshot time; PNG encoding of a 1080p frame and the style writes account for the rest. A faster path (`readPixels`, or a lossless video stream from the browser) was not needed yet.

### Deliberately not done

- The three and blender lanes (M4, M5); the assembly plan built from the job's frame patterns (M7); narration (M6).
- The vision review loop (contact sheet, rubric scores in the QA report) stays with the skill's instructions; `still` and `sheet` give it the pictures.
- `assets` has no model entries yet (M5 brings glTF).

### Review guide

Read these five in order (about 1,100 lines):

1. `src/shared/harness/protocol.ts` then `src/browser/runtime/boot.ts`: what crosses between Node and the page.
2. `src/harness/browser-session.ts`: the launch, the policy, the capture loop and every way it fails.
3. `src/shared/camera/css-transform.ts` and `src/shared/html/stage.ts`: how the baked camera becomes a CSS stage.
4. `src/render/render-shot.ts` and `src/render/still-gate.ts`: the cache, the manifest, the resume and the gate.
5. `src/cli/commands/still.ts`: the one command that ties the gate, the profile pin and the job together.

### Next: M4

The three lane: scene builders (PMREM from the bundled HDRIs or `RoomEnvironment`, `RectAreaLight` rigs from `lighting/rigs.ts`, a shadow-casting key, SSAA, bloom, bokeh from the thin-lens model, AgX or standard tone mapping), the shared camera applied through `filmGauge 36` and `setFocalLength`, the GPU assertion through the renderer policy, the calibration parity scene of ADR 0008 rendered in both lanes with the gray card's YAVG held to 117 ± 5, the lookdev swatch sheet of the seven looks (html and three) for the owner's taste decisions, and the three lane's own frame cost.

## M2: camera, motion, composition and the plan command (2026-10-29)

### Done

- **Easing** (`src/shared/motion/easing.ts`, written by hand before the fan-out so every module shares it): the thirteen tokens of `references/motion/easing-grammar.md` as pure functions: CSS cubic Béziers (Newton then bisection, the CSS reference `ease(0.5) = 0.8024`), `sine-in-out`, and the one canonical spring (mass 1, stiffness 100, damping ratio 0.75, overshoot 2.8 percent under the 4 percent cap, settle time 0.921 s).
- **Timeline** (`src/shared/motion/timeline.ts`, `durations.ts`, `text-timing.ts`): `interpolate` with clamp, extend and identity extrapolation, `spring`, segments with `sequence`, `stagger`, `delay`, `loop`, a `Timeline` of named frame events, the duration table (small 150 to 250 ms, medium 300 to 400, full-screen 450 to 600, stagger 40 to 80, nothing but the camera over 600 ms), the 30 percent entrance overlap, the 10-frame quiet tail before a cut, reading holds (words × 0.3 s + 0.8 s, 2 s for numbers) and the caption lead and tail.
- **Calibration scene** (`src/shared/calibration/scene.ts`): the ADR 0008 scene as data for M4: 18 percent gray card `#767676`, 90 percent white, 2 percent black, six 80 percent swatches, a glossy and a matte sphere, a 48 px text line, each with its frame box and expected limited-range luma (computed on the encoded channels; the gray card expects 117 ± 5).
- **Camera** (`src/shared/camera/`): vectors and quaternions, the 36 mm physical model (vertical and horizontal field of view, CSS perspective, thin-lens depth of field with a 0.03 mm circle of confusion), size-to-distance and the angle placements of `shot-grammar.md`, pinhole projection of points and boxes to frame fractions, the 26-move catalogue of `camera-moves.md` with caps, default easings, lanes and the ends-at-cut flag, seeded handheld noise (a hashed PRNG, cosine-interpolated value noise at 1.5 Hz, fade envelope), and `bake(shot, spec, base)` / `cameraFrameAt(...)`: per frame position, rotation, focal length, f-stop, focus distance (tracking the camera so a push-in keeps the same surface sharp), shutter angle, exposure, turntable rotation, key-light orbit and stage offset. Time-exact windows (ADR 0006 decision 9).
- **Composition** (`src/shared/composition/`): the shot-size fraction table, grid anchors, safe areas, the solver (distance for the size and lens, sphere placement, one closed-form slide onto the grid point, headroom placement for MS, MCU and CU, lead-room as a minimum) and the five geometric checks of `composition/rules.md` (subject in action safe, anchor on the grid within 4 percent, text in title safe and off the subject, headroom in range, text floors per role with 42 or 60 characters per line, 3 lines, no orphan) plus the competing-text warning.
- **`plan`** (`src/plan/`, `src/cli/commands/plan.ts`): reads and validates the brief, treatment, shot spec and look bible (schema, semantic rules, ledger), checks them against each other (ids, beats, fps and size, transition arithmetic, pacing rules 1 and 2 as problems, beat lengths, dissolves, end fades, rig changes and narration order as warnings), runs the composition solver's checks on every shot's base framing, computes one key per shot (ADR 0006 decision 8; the lane code hash is empty until M3), writes `<out>/<jobId>/` with copies of the four documents and `job.json`, keeps shot statuses on a rerun when the key is unchanged, and prints one line per shot with the totals against the brief.
- **Docs**: ADR 0006 (launch flag set and the time-exact bake), ADR 0008 (calibration luma on encoded channels; Blender's Z-up mapping), `camera-moves.md` (the crane-reveal cap cell), `lens-and-exposure.md` (the depth-of-field column's circle of confusion), SKILL.md and README (the `plan` command, the layout).
- Process: four modules by parallel agents (composition started when the camera build landed), each adversarially reviewed and fixed: 32 findings (timeline 7, camera 8, plan 10, composition 7), 31 applied, 7 skipped and either done here (the doc amendments, the composition wiring into `plan`) or recorded below.

### Evidence

| Claim | Number | Where |
| --- | --- | --- |
| Type checks, house rules, schema drift, licenses | `npm run typecheck` exit 0 both configs; `npm run lint`: no findings in 265 files; 11 contracts up to date; 32 packages, 0 failed | run locally 2026-10-29 |
| Unit and integration tests | `npm test`: 1081 tests in 251 suites, 0 failures, 2 skipped (macOS or Linux only) | same |
| Easing matches the CSS reference and the spring stays under its cap | `ease(0.5) = 0.8024 ± 0.001`, every token 0 → 0 and 1 → 1, monotonic except the spring, spring peak in [1.02, 1.04] | `tests/shared/motion/easing.test.ts` |
| Timeline, durations, text timing, calibration arithmetic | 71 tests | `tests/shared/motion/`, `tests/shared/calibration/` |
| Camera: zero velocity at both ends except turntable and the cut moves, arc keeps its distance within 1e-6, dolly-zoom keeps the projected anchor height constant, same seed same shake, bake equals cameraFrameAt frame by frame, `verticalFovDegrees(50, 16/9) = 22.9`, `cssPerspectivePx(50, 16/9, 1080) = 2667` | 84 tests | `tests/shared/camera/` |
| Composition: an MS hero on `thirds-left` lands at x 0.333, headroom 10 percent on a CU puts the subject top at 0.10, overlapping text, a 20 px caption, a 4-line body and a 50-character title line are all reported | 39 tests | `tests/shared/composition/` |
| `plan`: every cross-document rule with a passing and a failing example, keys stable and sensitive to the shot, the look and the browser major, job id stable, statuses kept on rerun, the command end to end (exit 0 with a valid job folder; 1 with `schema-validation`, `cross-document` including a text box on the subject, `data-file`; 2 usage) | 50 tests | `tests/plan/`, `tests/cli/plan.test.ts` |
| Continuous integration | run 40898208265 (commit 0efd956) passed on all four jobs (windows-2025 and ubuntu-24.04, Node 24 and 26) | GitHub Actions |

### Untested

- No frame has been rendered: the camera and composition numbers are checked against the references' tables and the physics, not against a picture. M3's first title card is the first visual check of the projection, the handedness (arc-right and truck-right travel toward the camera's right, pan-right turns the view right, positive dutch roll drops the right side) and the CSS perspective.
- The Blender Z-up mapping in ADR 0008 is stated from the axis conventions, not from a rendered frame; M5 confirms it with one eye-level and one overhead shot.
- The handheld shake, the spring and the easing curves have not been judged by eye; the lookdev sheet in M4 is where taste enters.
- Portrait aspects go through the camera model's sensor rule but no composition test uses one; `ground` with MS, MCU or CU fails the headroom check by construction (a level camera at the subject's base frames from below), so the planner pairs `ground` with MLS or wider.
- Only the bottle fixture (0.08 × 0.25 × 0.08 m at 85 mm) and its variants have gone through the solver; a real planned shot spec arrives with M7's treatment.

### Risks

- The references and the code disagree in two small places, both recorded in the references: `lens-and-exposure.md`'s depth-of-field column was computed with a 0.045 mm circle of confusion while `thinLens` uses the standard 0.03 mm (about a third shallower); `crane-reveal` and `top-down-reveal` keep `emphasized-decelerate`, which starts with velocity, against rule 2's zero-velocity start (the table is the specification; the test exempts the two).
- The shot key changes once when M3 fills the lane code hash, and keys planned before `doctor` ran differ from keys planned after (no browser major). Both are by design; the still gate re-renders in each case.
- `browserLaunchFlags` (`--force-device-scale-factor=1`, `--disable-lcd-text`) is part of the key, so M3's harness must launch with exactly that set plus the `--use-angle` choice the render profile records (ADR 0006 decision 3, amended).
- For MS, MCU and CU the headroom percentage decides the subject's vertical position and the grid's y is ignored; `composition/rules.md` says "anchor within tolerance of the grid point", which the solver meets horizontally for those sizes. Change the rule or the solver in M3 if the first stills look wrong.
- The shot spec has no field for a fade-out after the last shot; pacing rule 3 ("ends on a fade-black") is read as the transition into the last shot. A `fadeOut` field may be needed when M7 assembles the product film.

### Deliberately not done

- No lane consumes the baked frames yet (M3 and later); the lane mappings in ADR 0008 and `src/shared/camera/types.ts` are the contract they will follow.
- A 360-degree arc loop is not expressible (the cap is 60 degrees); a loop count is a later addition.
- The contrast and luma checks (6 and 7 of `composition/rules.md`) stay in `qa`, where the rendered frame is.

### Review guide

Read these five in order (about 1,000 lines):

1. `src/shared/camera/types.ts`: the frame record every lane will read, with the axis conventions.
2. `src/shared/camera/bake.ts` then `pose-moves.ts`: the window arithmetic and the per-move pose math.
3. `src/shared/composition/solver.ts`: distance, placement and the closed-form slide onto the grid.
4. `src/plan/cross-checks.ts`: the rules that make four documents one job.
5. `tests/shared/camera/bake-moves.test.ts`: what each of the 26 moves is held to.

### Next: M3

The browser harness runtime (`init(spec)` / `render(frame)` protocol, seek-based capture, renderer policy and fingerprint per ADR 0006), the html lane (title card and lower third from the look bible's tokens, bundled OFL fonts served by the harness), the `still`, `render` and `assets` commands, the determinism test (ten renders, framehash table), the 600-frame timing, the first goldens at 480x270 and the still gate that runs `compositionProblems` on the rendered frame before any vision review.

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
