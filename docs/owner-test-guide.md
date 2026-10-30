# Owner's test guide (v0.1.0)

How to test Vision.Forge yourself, in the order that tells you the most for the least time. Every step says what to run, what to look at and what "good" is. Written 2026-10-29 against commit `09069a6` and later; the numbers are from the owner's machine (Windows 11, i7-9700K, RTX 2060, Edge 156, ffmpeg 9.0.2, Blender 5.2.3).

The end goal, in one sentence: an English prompt goes into Claude Code, and a finished film or still comes out that you would put beside a Higgsfield result and not be embarrassed by. Everything below tests that path from the inside out.

## 0. Ten minutes: does the machine pass its own checks

Open a terminal in the clone.

```bash
node scripts/cli.ts doctor --data-dir "%LOCALAPPDATA%\VisionForge" --out out --pretty
```

Good: `ok: true`, `lanes` all `true` (`audio` is true when ffmpeg has its encoders; narration itself installs later), `problems: []`. If Blender is missing, `lanes.blender` is `false` and `missing[]` carries the winget line; the other lanes still work.

```bash
npm run check
```

Good: typecheck on both tsconfigs, the house-rules lint, the schema drift check, the license allowlist and then the whole suite: about 1,765 tests, 0 failures, 3 skipped (two are platform-specific, one needs the network), in about 2.5 minutes. The browser tests open headless Edge; the one real-Blender test renders a 64x36 frame. Nothing here needs the network.

## 1. Twenty minutes: the shipped product film, through the commands

This is the piece recorded in `docs/evidence/m7/`. Reproduce it from its documents, then compare.

```bash
set DATA=%LOCALAPPDATA%\VisionForge
set EX=skills\cinematic-studio\examples\product-film
node scripts/cli.ts assets --fetch hdri:studio_small_03-1k,hdri:studio_small_03-2k --data-dir %DATA% --out out
node scripts/cli.ts plan --brief %EX%\brief.json --treatment %EX%\treatment.json --shot-spec %EX%\shot-spec.json --look %EX%\look.json --data-dir %DATA% --out out --pretty
```

Good: `ok: true`, `data.warnings: []`, `data.jobDir` names `out\<jobId>` (the id is the content hash of the four documents, so it is the same on every machine: `88f8e97b` before the cap-neck fix, a new id after it, since `shot-spec.json` did not change but the primitive did and the key includes the lane's code).

For each shot, the still gate (about 7 to 9 s each on the blender lane, the first one longer while Blender compiles its shaders):

```bash
node scripts/cli.ts still --job out\<jobId> --shot s01 --data-dir %DATA% --out out --pretty
```

Repeat for `s02`, `s03`, `s04`. Good: every `still` exits 0 with `passed: true`; `renderProfile` reads `eevee / opengl / hardware` (the ladder's first rung); the three checks read composition 0 problems, text-contrast "no text" (9.7:1 on `s04`), exposure inside 30 to 60. Look at `out\<jobId>\stills\s0N-r1.png`: a pale satin bottle on a dark cyc, lit from the upper right, a soft shadow to the left; `s04-r1.png` carries the title "Vela" bottom-centre, and `s04-r1.text.png` beside it is the title alone over transparency (that is the text plate).

Then the 4K still of the hero (about 60 s), the approvals, the render (about 11 minutes: 465 frames at 1.3 to 1.8 s each), the assembly and the QA:

```bash
node scripts/cli.ts still --job out\<jobId> --shot s03 --scale 2 --data-dir %DATA% --out out
node scripts/cli.ts still --job out\<jobId> --shot s01 --approve --data-dir %DATA% --out out
node scripts/cli.ts still --job out\<jobId> --shot s02 --approve --data-dir %DATA% --out out
node scripts/cli.ts still --job out\<jobId> --shot s03 --approve --data-dir %DATA% --out out
node scripts/cli.ts still --job out\<jobId> --shot s04 --approve --data-dir %DATA% --out out
node scripts/cli.ts render --job out\<jobId> --data-dir %DATA% --out out --pretty
node scripts/cli.ts assemble --job out\<jobId> --data-dir %DATA% --out out --pretty
node scripts/cli.ts qa --job out\<jobId> --data-dir %DATA% --out out --pretty
node scripts/cli.ts sheet --video out\<jobId>\<jobId>.mp4 --every 15 --columns 6 --data-dir %DATA% --out out
```

Good: `render` reports four shots with `estimate` after the first three-frame batch (a ceiling; the real rate is 1.3 to 1.8 s per frame) and `textFramePattern` on `s04`; `assemble` reports `verified: 450 frames, 30 fps, 1920x1080, bt709`; `qa` exits 0 with every check `ok` (eleven checks and four hero comparisons at SSIM 1.0, 0.9997, 0.9999, 1.0) and the job's `status` is `delivered`; the sheet is `out\sheets\<jobId>.png`.

Then play `out\<jobId>\<jobId>.mp4` in a looping player (VLC with loop on, or `ffplay -loop 0`). What to look for, in order:

- The loop join (frame 449 to 0): the bottle holds, the film starts again with the push-in; no jump.
- The two cuts (105, 225): same bottle, same light, one film.
- The cross-fade (330 to 344): the arc's end pose blends into the eye-level hold; a soft double image for half a second, no speckle.
- The title "Vela": crisp at 100 percent; it rises in at frame 342, holds, and leaves before frame 440.
- The grain on the dark backdrop: visible at 100 percent, film-like at full-frame size.
- What is not there yet: frosted glass (the body is an opaque satin solid), brushed metal (a satin cap), any product geometry beyond a stack of cylinders. The treatment says so; the steering table is where that honesty comes from.

Compare `out\<jobId>\stills\s03-r2-2x.png` (3840x2160) with `docs/evidence/m7/hero-still-s03-4k-640.png` and its 100 percent crop: the same frame, and after the cap-neck fix the notch at the top edge of the crop is gone.

## 2. An hour: the three blind-test prompts through Claude Code

This is the real test. Open Claude Code in any folder (not the clone: the skill must find its own files), with the plugin installed:

```bash
claude plugin marketplace update quantum-solutions
claude plugin install vision-forge@quantum-solutions
```

(The marketplace `quantum-solutions` was added from this clone on 2026-10-29 and the plugin installed at scope `user`; `claude plugin list` shows it. To load the working tree instead, start Claude with `claude --plugin-dir C:\Code\QuantumSolutions.Vision.Forge`.)

Then type `/vision-forge:cinematic-studio` followed by one of the three prompts of `docs/blind-test.md`, verbatim:

1. **Product shot**: `A 15-second studio product film of a frosted-glass cosmetic bottle with a brushed-metal cap on a dark backdrop. Macro details, a slow hero reveal, and the product name on screen at the end. Loopable. 16:9.`
2. **Explainer**: `A 45-second narrated explainer that teaches what a content hash is and why it makes renders resumable. Clean, friendly, diagram-led. Captions on screen.`
3. **Title sequence**: `A 12-second cinematic title sequence for a documentary called 'Deep Field'. Dark, atmospheric, a light sweep revealing the title, a tagline, fade to black.`

What Claude should do, step by step (SKILL.md, "The order of a production"); stop it if it skips one:

1. Ask at most one question, then fill the director's questionnaire from the prompt and show you a one-page treatment: logline, beats, the look and why, the lane per shot, the substitutions from the steering table (for the product film: the frosted glass becomes an opaque coated body, and it says so), the risks. **It waits for your yes.** A substitution you have not heard about is a defect.
2. Write the shot list and the look, run `doctor`, fetch the HDRIs the rigs name, run `plan`, and show you the warnings.
3. Render one still per shot, look at it, name three faults, fix the shot spec or the look, and run `still` again, at most three rounds; show you the contact sheet of the stills (`sheet --frames <job>/stills`).
4. Ask you to approve the stills, then quote the render estimate and wait for your yes before `render`.
5. For the explainer: offer narration (the component installs only after you see the sizes and the licenses and say yes to `audio install --yes`), synthesize it before the shot durations are locked, and use its sentence timings as the clock of the shots.
6. `assemble --job`, `qa --job`, a delivery sheet (`sheet --video`), then tell you the delivery path, the QA summary and the limits.

Good, per piece:

- Product shot: what section 1 produced, in about 30 minutes of wall clock with the still loop (the recorded run took 31). If Claude writes different documents, that is fine; the gate is the rubric, not the example.
- Explainer: a narrated 45 s piece on the html lane (diagrams and type), captions burnt in or as an SRT beside the delivery, the loudness at −16 LUFS, the sentences cut on their own timings. This piece has not been produced end to end yet; it exercises `audio synth` and `assemble --job` with narration. Expect the first attempt to need a round or two of your steering on the diagram content.
- Title sequence: a 12 s html or three piece with the light sweep and the fade to black; the typography system (Playfair or Space Grotesk, title safe, the reading hold) is the thing to judge. Also not produced end to end yet.

Then score each piece against the comparison side on the five criteria of `docs/blind-test.md`, 1 to 5, and record the sheet under `docs/evidence/blind-test/` (the product film's write-up, `our-side-product.md`, has the blank sheet).

## 3. The lanes one at a time (when something looks wrong)

- **html lane**: `node scripts/cli.ts still --job <job> --shot <an html shot>`; the title card of the fixture is the golden `tests/goldens/html/title-card-480x270-f026.png`. Byte-identical across launches on one machine.
- **three lane**: the fixture's `s01` and `s02` are three shots (`tests/plan/fixtures.ts`); the golden is `tests/goldens/three/product-shot-480x270-f060.png`. Identical to within GPU noise (one pixel, one code value, about one capture in fifty). The seven looks on both browser lanes: `docs/evidence/m4/lookdev-sheet.png`.
- **blender lane**: `docs/evidence/m5/acceptance.md` has every command line Blender receives, every exit code and timing; `node scripts/probes/run.ts m5-acceptance` with `VF_PROBE_DATA_DIR=<a data dir where doctor and assets --fetch hdri:studio_small_09-1k ran>` re-runs it (about 5 minutes). The three-column lookdev sheet: `docs/evidence/m5/lookdev-sheet.png`.
- **narration**: `node scripts/cli.ts audio install --data-dir %DATA% --out out --pretty` prints the sizes and the notices and stops; `--yes` installs (about 11 s on a warm npm cache, 500 MB on disk, 92 MB downloaded); `audio voices`; `audio synth --text "The bottle holds 500 ml. Made by hand, since 1998." --out out --data-dir %DATA% --pretty` writes `out\narration\narration.wav`, `captions.srt` and `narration.json` (listen to the WAV; read the SRT; `directMlMapped` is `false`).
- **calibration across the lanes**: `docs/evidence/m4/calibration.md` and `docs/evidence/m5/calibration.md`: the 18 percent gray card reads 117.3 ± 5 on every lane; the neutral patches are neutral (equal channels) since the white balance.

## 4. What to read if you want to review the code

`docs/handoff.md`, newest milestone first: each section has Done, Evidence (every claim with its number and where to find it), Untested, Risks, Deliberately not done, and a review guide of five files. `docs/milestone-notes.md` is the short version. `docs/adr/` holds the eight decisions and their amendments with dates.

## 5. Known limits you will meet

- A job is keyed on its four documents: every still-loop edit plans into a new job folder (the render cache keeps the frames, so re-renders are cheap; the stills re-render).
- The ladder tries every Blender engine when a scene renders black (84 s); `plan` now refuses the one cause seen (a camera under the floor).
- The three lane's coated body reads grayer than the blender lane's under the low-key rig; the product film moved its macro to Blender for that reason.
- Blender never runs on CI; the runners have no GPU, so the browser lanes run on SwiftShader there with a looser golden threshold.
- The title sequence has not been produced yet; the product film and the explainer have, once each (`skills/cinematic-studio/examples/`). The explainer's diagrams are typographic cards, and its treatment gate was passed on your standing permission, not on a yes to the page: your own run stops there.
