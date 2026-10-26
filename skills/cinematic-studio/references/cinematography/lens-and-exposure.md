# Lens and exposure

One physical camera model drives every lane (ADR 0008): a 36 mm sensor on the larger image axis, a focal length in millimetres, an f-stop, a focus distance in metres and a shutter angle in degrees. The html lane derives its CSS perspective from the same vertical field of view, so 2.5D parallax matches the 3D lanes.

## Focal lengths

| `focalMm` | Vertical field of view at 16:9 | Look | Use |
| --- | --- | --- | --- |
| 14 | 71 degrees | extreme wide; strong perspective, edges stretch | abstract environments only |
| 18 | 58 degrees | wide; depth exaggerated | establishing shots of sets |
| 24 | 45 degrees | wide; environmental | `ELS`, atmosphere plates |
| 28 | 40 degrees | mild wide | `LS` of sets |
| 35 | 32 degrees | natural width | `LS`, explainer stages |
| 50 | 23 degrees | the human-eye standard | `MLS`, `FS`, diagrams, titles |
| 65 | 18 degrees | mild telephoto | `MS` with context |
| 85 | 14 degrees | portrait; flattering compression | `MS` and `MCU` heroes |
| 100 | 12 degrees | macro-friendly telephoto | `CU`, `ECU` details |
| 135 | 9 degrees | telephoto; flat, compressed | `CU` from far away, isolation |
| 200 | 6 degrees | long telephoto; stacked planes | rare; a single compressed detail |

Field of view, vertical, in degrees: `2 · atan(sensorHeight / (2 · focalMm))` with `sensorHeight = 36 / aspect` (20.25 mm at 16:9). Distance creates perspective; the focal length only crops. To make a product look monumental, move the camera close with a wider lens and a low angle; to make it look precise, move back with 85 to 135 mm.

## Aperture and depth of field

| `fStop` | Depth of field at 85 mm, 1 m | Look | Use |
| --- | --- | --- | --- |
| 1.4 | about 1.5 cm | razor thin; only one plane sharp | one `ECU` per film at most |
| 2 | about 2 cm | thin; subject edge soft | `CU` details with a soft background |
| 2.8 | about 3 cm | shallow; the classic macro look | `ECU`, `CU` |
| 4 | about 4.5 cm | moderate; a product fully sharp, background soft | `MS` hero |
| 5.6 | about 6 cm | deep enough for a set | `MLS`, `FS` |
| 8 | about 9 cm | deep; everything in a set sharp | `LS`, `ELS`, overhead layouts |
| 11 | about 12 cm | very deep; graphic | flat-lay, charts rendered in 3D |
| 16 | about 18 cm | everything sharp | rarely; diffraction softens real lenses |

The three lane maps f-stop and focus distance to its bokeh pass by thin-lens math; Blender uses `aperture_fstop` and `focus_distance` directly. Focus distance equals the solved camera distance unless a `rack-focus` sets two points.

## Shutter angle and motion blur

| `shutterAngleDeg` | Exposure per frame at 30 fps | Look |
| --- | --- | --- |
| 90 | 1/120 s | crisp, staccato; action and stingers |
| 180 | 1/60 s | the cinema standard; natural blur |
| 360 | 1/30 s | smeared; dream-like; slow drifts only |

Blender: `motion_blur_shutter = shutterAngleDeg / 360`. three: sub-frame accumulation across the shutter window. html: no motion blur (type must stay crisp); fast moves there are kept under 8 pixels per frame instead.

## Exposure

- The look bible sets a base exposure in EV; a shot's `exposureOffsetEv` nudges it by at most two stops. Both lanes apply it as a multiplier of 2^EV before tone mapping.
- Tone mapping is a look token: `agx` for photographic looks (both 3D lanes), `standard` for graphic looks and everything the html lane composites.
- The QA check reads the average luma (YAVG, 0 to 255 limited range) of each shot and holds it inside the look's `qa.yavgMin` to `qa.yavgMax`; neighbouring shots may not differ by more than 40 without a transition.
- Highlights: nothing white that is not a light source; speculars may clip, surfaces may not. Check the hero still at 100 percent before approving it.

## Defaults per use case

| Use case | Lens | f-stop | Shutter | Note |
| --- | --- | --- | --- | --- |
| Product hero | 85 mm | 4 | 180 | the whole product sharp, backdrop soft |
| Product macro detail | 100 mm | 2.8 | 180 | one surface sharp |
| Product context | 50 mm | 5.6 | 180 | set and product sharp |
| Explainer stage (2.5D) | 50 mm | 8 | 180 | perspective only; depth of field faked per layer |
| Title over an environment | 50 mm | 2 | 180 | text crisp (html plate), environment soft (three plate) |
| Atmosphere plate | 35 mm | 2.8 | 360 | slow drift, smeared highlights |
