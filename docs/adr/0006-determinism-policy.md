# ADR 0006: Determinism policy for the browser lanes

Status: accepted, 2026-10-26.

## Context

The constraint: the same spec and the same tool versions produce the same frames, within a documented tolerance; animate by frame number, never by wall-clock time or `requestAnimationFrame`.

Facts that shape the design (sources in `docs/research.md`): Playwright's `channel` launches the branded Edge or Chrome, where the headless-shell determinism switches do nothing; `page.screenshot({animations: 'disabled'})` finishes animations and destroys a seeked frame; `page.clock` cannot drive CSS or Web Animations; Windows text anti-aliasing reads per-user ClearType settings; system browsers auto-update.

Probe P5 (`docs/evidence/m0/p5-determinism.md`) measured on the owner's machine with Edge 156 and Chrome 156:

- Ten fresh launches with identical hardware flags produced identical pixel hashes at frames 0, 15, 30 and 59 of a page with a CSS animation, a Web Animations API animation, two WebGL2 canvases and two text blocks.
- Chrome produced the same hashes as Edge.
- `--disable-lcd-text`, `--disable-font-subpixel-positioning`, the content-level half of `--deterministic-mode`, and omitting `--force-device-scale-factor=1` changed nothing (Playwright already emulates device scale factor 1).
- The software renderer (`--use-angle=swiftshader-webgl`) was internally repeatable (three identical runs) but differed from hardware where WebGL geometry was drawn: SSIM 0.980, PSNR 21–28 dB against the hardware frames.
- The seeked CSS transform landed on the expected pixel column at every frame without any threaded-animation flag.
- Both WebGL2 canvases, one created with `preserveDrawingBuffer: false` and one with `true`, showed the expected per-frame clear color in the screenshot when `render(frame)` ran synchronously in the same `page.evaluate` as the seek.
- The `animations: 'disabled'` control put the CSS box at column 0 instead of 200 at frame 15, confirming the trap.
- One 1080p screenshot took about 50 ms (hardware) and 61 ms (software): 600 frames in about 30 s, 1800 in about 90 s, before any rendering cost.

## Decision

1. **Authoring model is frame-pure.** Every template exports `init(spec)` and `render(frame)` and sets inline styles, transforms and uniforms from the shared timeline. CSS animations, transitions, SMIL, `<video>`, `<iframe>`, shadow roots, `animation-timeline`, `requestAnimationFrame`, `setTimeout`, `Date`, `performance.now` and unseeded `Math.random` are rejected by the lint in page mode and by a DOM check at `init`. `document.getAnimations()` pause-and-seek remains only as a guard.
2. **Capture protocol.** One `page.evaluate` runs `seek(frame)`: pause any animation, set `currentTime = frame * 1000 / fps`, call `render(frame)` synchronously (WebGL contexts created with `antialias: false`, `alpha: false` and `preserveDrawingBuffer: true` as a cheap safety default, although P5 showed capture works without it; `EffectComposer.render(1 / fps)` explicit). Then `page.screenshot({type: 'png', animations: 'allow', caret: 'hide', scale: 'css'})`. Never `animations: 'disabled'`, never `toHaveScreenshot`.
3. **Launch.** `chromium.launchPersistentContext` on the channel `doctor` found working (Edge first, Chrome fallback), headless, viewport 1920x1080, `deviceScaleFactor: 1`, with `--force-device-scale-factor=1` and an explicit `--use-angle=d3d11` (hardware) or `--use-angle=swiftshader-webgl` (software). No other stability flags; P5 showed they change nothing here.
4. **Renderer policy.** `expect: 'hardware' | 'software' | 'any'`. The harness reads `UNMASKED_RENDERER_WEBGL` at startup and exits 1 on a mismatch; CI uses `any`.
5. **Fingerprint.** Every render manifest records browser full version, renderer string, launch flags, `AppliedDPI`, the four ClearType registry values, and the Node, three and ffmpeg versions. Pixel hashes come from ffmpeg `framehash` (decoded pixels), never from PNG bytes.
6. **What "deterministic" means in the docs.** Same machine, same fingerprint: byte-identical frames, verified by at least ten runs in the M3 determinism test and re-verified when the fingerprint changes. Different fingerprint (another machine, a browser update, a driver update, software versus hardware): SSIM and PSNR thresholds, calibrated per lane from the M3 and M4 fixtures, starting strict for html (SSIM ≥ 0.99).
7. **Two QA comparisons, named separately.** Approved still versus frame k of the render (same fingerprint, strict, before grain) and fixture versus committed golden (fingerprint sidecar; relaxed threshold and a warning when the fingerprint differs). Hash equality is a cache-validation aid and a warning, never the only gate.
8. **Shot hash.** Browser major version plus the launch-flag set, the lane code hash, the shot spec, the look bible and the render profile. A weekly browser patch does not invalidate every cached shot; the fingerprint in the manifest still records the exact build.

## Consequences

- Resume, re-render-failing-shots-only and parallel frame ranges are valid because a frame never depends on order or time.
- The README states the same-machine scope of byte identity and the SSIM gates elsewhere.
- The three lane's own frame cost (SSAA, bloom, bokeh) is measured in M4; P5 only priced the screenshot path.
