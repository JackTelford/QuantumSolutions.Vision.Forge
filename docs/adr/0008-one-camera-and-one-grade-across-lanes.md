# ADR 0008: One physical camera model and one finishing grade across all lanes

Status: accepted, 2026-10-26.

## Context

A film reads as one piece when lens, light and grade rhyme across shots. The three lanes have different native conventions:

- Blender's camera uses a 36 mm sensor width with `sensor_fit = 'AUTO'` (36 mm on the larger image axis), `lens` in mm, `dof.aperture_fstop`, `dof.focus_distance`, and `render.motion_blur_shutter` in frames (0.5 = a 180-degree shutter).
- three.js `PerspectiveCamera` defaults to `filmGauge = 35` on the larger axis and a vertical `fov`; the same "50 mm" therefore frames differently unless `filmGauge` is set to 36. `BokehPass.aperture` is not an f-number.
- The html lane is a 2D stage; CSS `perspective` in pixels sets its vanishing geometry.
- AgX in the 3D lanes compresses saturated colors; the html lane is display-referred sRGB.

ffmpeg facts from probe P6: an identity 33³ `.cube` through `lut3d` with `format=gbrp16le` is lossless once the filter path is quoted correctly; seeded `noise` is reproducible run to run, but the grain on a frame processed alone differs from the same frame inside a sequence; RGB to `yuv420p` must name `out_color_matrix=bt709` or players shift hues; the round trip through libx264 CRF 16 measures 41.6 dB PSNR.

## Decision

1. `src/shared/camera/` bakes, per frame: position, rotation quaternion, focal length in mm on a 36 mm sensor (larger axis), f-stop, focus distance in meters, shutter angle in degrees, exposure offset in EV. Lane mappings: three sets `filmGauge = 36` and `setFocalLength(mm)`, derives `BokehPass` parameters by thin-lens math and renders motion blur by sub-frame accumulation across the shutter window; Blender sets `sensor_width = 36`, `sensor_fit = 'AUTO'`, `lens`, `dof.*`, `motion_blur_shutter = angle / 360`; html sets `perspective` from the vertical field of view so 2.5D parallax matches.
2. Each look in the look bible carries a tone-mapping token (`agx` for photographic looks in both 3D lanes, `standard` for graphic looks) and brand-critical surfaces use an unlit "graphic" material path. The calibration scene is defined as data in `src/shared/calibration/scene.ts` (added 2026-10-29): the expected `YAVG` of a patch is computed on the gamma-encoded sRGB channels, Y' = 16 + 219 × (0.2126 R' + 0.7152 G' + 0.0722 B'), because `signalstats` reads the encoded luma plane of the delivery; the 18 percent gray card (`#767676`) therefore expects 117 ± 5, not the 55 a linear-light luma would give. Blender's world is Z-up, so the blender lane maps a baked world position and the quaternion's vector part (x, y, z) → (x, −z, y) before writing `scene.json`; the camera-local −Z/+Y convention needs no change. A calibration scene (18 % gray card, white and black patches, six saturated swatches, glossy and matte spheres, 48 px text) is rendered by every lane and sets per-lane light-intensity scalars so the gray card's `YAVG` matches within ±5 and hue deltas are reported.
3. `src/finishing/` turns look tokens into a 33³ `.cube` and one ffmpeg filter chain: `format=gbrp16le`, `lut3d` (tetrahedral), `vignette`, then `scale=out_color_matrix=bt709:out_range=tv` and a dithered `yuv420p` conversion with BT.709 tags. Grain (`noise` with an explicit seed) is applied only at assemble, never on stills, so the approved still can be compared with frame k of the render before grain.
4. Picture plates are graded; text plates from the html lane are overlaid after the grade, and contrast and legibility checks run on the finished frame.
5. The `.cube` file hash and the tone-mapping token are part of the shot hash.

## Consequences

- "85 mm f/2 push-in" means the same framing and perspective in every lane, which is what makes the composition solver and the lighting cookbook lane-independent.
- Mixed-lane films (html type over three atmosphere over a Blender product) share one grade.
- Cross-lane exposure parity is measured, not asserted; the scalars live in the lighting cookbook and are re-run on tool upgrades.
